import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '../src/config.js';
import { callUpstream } from '../src/lib/upstream.js';

const mutableConfig = config as unknown as {
  upstreamUrl: string;
  upstreamKey: string;
  upstreamModel: string;
};

const original = {
  upstreamUrl: config.upstreamUrl,
  upstreamKey: config.upstreamKey,
  upstreamModel: config.upstreamModel,
};

afterEach(() => {
  mutableConfig.upstreamUrl = original.upstreamUrl;
  mutableConfig.upstreamKey = original.upstreamKey;
  mutableConfig.upstreamModel = original.upstreamModel;
  vi.unstubAllGlobals();
});

describe('OpenAI-compatible GLM upstream', () => {
  it('posts chat/completions with the configured model and bearer key', async () => {
    mutableConfig.upstreamUrl = 'https://model.example/v1';
    mutableConfig.upstreamKey = 'test-key';
    mutableConfig.upstreamModel = 'GLM-5.2';
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '模型回复' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callUpstream([{ role: 'user', content: '生成播报稿' }]);
    expect(result.text).toBe('模型回复');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://model.example/v1/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'GLM-5.2', stream: false });
  });

  it('fails visibly when a configured upstream fails', async () => {
    mutableConfig.upstreamUrl = 'https://model.example/v1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('', { status: 503 }),
      ),
    );

    await expect(callUpstream([{ role: 'user', content: '生成播报稿' }])).rejects.toThrow(
      'upstream 503',
    );
  });
});
