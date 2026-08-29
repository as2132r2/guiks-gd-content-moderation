import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { config } from '../src/config.js';
import { getWorkflowRepository } from '../src/db/repository.js';
import { app } from '../src/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

const mutableConfig = config as unknown as { upstreamUrl: string; upstreamKey: string };
const originalUpstream = {
  url: config.upstreamUrl,
  key: config.upstreamKey,
};

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

afterEach(() => {
  mutableConfig.upstreamUrl = originalUpstream.url;
  mutableConfig.upstreamKey = originalUpstream.key;
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createAdmitted(title: string): Promise<string> {
  const response = await request('/api/workbench', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      sourceType: 'notice',
      sourceText: '模拟素材：全市召开项目推进会，各部门汇报阶段进展。',
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { manuscript: { id: string; status: string } };
  expect(body.manuscript.status).toBe('admitted');
  return body.manuscript.id;
}

const generate = async (id: string): Promise<Response> =>
  await request(`/api/workbench/${id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'generated', role: 'editor' }),
  });

function upstreamResponse(call: number): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: `模拟模型生成稿件 ${call}。第二句。` } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function withDeadline<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), 2_000).unref();
    }),
  ]);
}

describe('canonical transition concurrency', () => {
  it('serializes one manuscript across the upstream await and writes one generation only', async () => {
    mutableConfig.upstreamUrl = 'https://controlled-upstream.example/v1';
    mutableConfig.upstreamKey = 'test-key';
    const id = await createAdmitted('同稿并发生成');

    const firstEntered = deferred<void>();
    const release = deferred<void>();
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        firstEntered.resolve();
        await release.promise;
        active -= 1;
        return upstreamResponse(calls);
      }),
    );

    const first = generate(id);
    const second = generate(id);
    await firstEntered.promise;
    // Let both authenticated HTTP requests reach the transition executor while
    // the first real upstream call is held open. This is the race that used to
    // let both requests read `admitted` before either persisted `generated`.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();

    const responses = await withDeadline(
      Promise.all([first, second]),
      'same-manuscript transitions did not settle after the upstream was released',
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rejected = responses.find((response) => response.status === 409)!;
    expect(await rejected.json()).toMatchObject({ error: 'illegal_transition' });
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);

    const aggregate = getWorkflowRepository().getAggregate(id)!;
    expect(aggregate.manuscript.status).toBe('generated');
    expect(aggregate.artifacts).toHaveLength(2);
    expect(aggregate.trace.filter((event) => event.kind === 'artifact-created')).toHaveLength(2);
    expect(
      aggregate.trace.filter(
        (event) =>
          event.kind === 'status-changed' &&
          event.data.from === 'admitted' &&
          event.data.to === 'generated',
      ),
    ).toHaveLength(1);
    expect(
      aggregate.trace.some(
        (event) =>
          event.kind === 'status-changed' &&
          event.data.from === 'generated' &&
          event.data.to === 'generated',
      ),
    ).toBe(false);
  });

  it('does not serialize transitions for different manuscripts', async () => {
    mutableConfig.upstreamUrl = 'https://controlled-upstream.example/v1';
    const [firstId, secondId] = await Promise.all([
      createAdmitted('并发稿件 A'),
      createAdmitted('并发稿件 B'),
    ]);

    const overlapReached = deferred<void>();
    const release = deferred<void>();
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active >= 2) overlapReached.resolve();
        await release.promise;
        active -= 1;
        return upstreamResponse(calls);
      }),
    );

    const first = generate(firstId);
    const second = generate(secondId);
    await withDeadline(overlapReached.promise, 'different manuscript ids were serialized globally');
    release.resolve();

    const responses = await withDeadline(
      Promise.all([first, second]),
      'different-manuscript transitions did not settle',
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(maxActive).toBeGreaterThanOrEqual(2);
    expect(calls).toBe(4);
    expect(getWorkflowRepository().getAggregate(firstId)?.artifacts).toHaveLength(2);
    expect(getWorkflowRepository().getAggregate(secondId)?.artifacts).toHaveLength(2);
  });

  it('releases the manuscript key after an upstream exception so a retry can succeed', async () => {
    mutableConfig.upstreamUrl = 'https://controlled-upstream.example/v1';
    const id = await createAdmitted('异常后重试');

    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response('', { status: 503 });
        return upstreamResponse(calls);
      }),
    );

    const failed = await generate(id);
    expect(failed.status).toBe(502);

    const retried = await withDeadline(generate(id), 'failed transition retained its manuscript key');
    expect(retried.status).toBe(200);
    expect(calls).toBe(3);

    const aggregate = getWorkflowRepository().getAggregate(id)!;
    expect(aggregate.manuscript.status).toBe('generated');
    expect(aggregate.artifacts).toHaveLength(2);
    expect(aggregate.trace.filter((event) => event.kind === 'artifact-created')).toHaveLength(2);
    expect(
      aggregate.trace.filter(
        (event) =>
          event.kind === 'status-changed' &&
          event.data.from === 'admitted' &&
          event.data.to === 'generated',
      ),
    ).toHaveLength(1);
  });
});
