import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '../src/config.js';
import {
  callUpstream,
  parseOpenAiReply,
  type ChatMessage,
  UpstreamError,
} from '../src/lib/upstream.js';

const messages: ChatMessage[] = [{ role: 'user', content: '请生成一条模拟播报稿。' }];
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
        JSON.stringify({
          model: 'GLM-5.2-served',
          choices: [{ message: { content: '模型回复' } }],
          usage: { prompt_tokens: 12, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callUpstream([{ role: 'user', content: '生成播报稿' }]);
    expect(result).toMatchObject({
      text: '模型回复',
      model: 'GLM-5.2-served',
      tokens: { in: 12, out: 5 },
      usageSource: 'provider',
    });
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

    await expect(callUpstream([{ role: 'user', content: '生成播报稿' }])).rejects.toMatchObject({
      code: 'upstream_http_error',
      status: 503,
    });
  });
});

describe('OpenAI-compatible upstream telemetry', () => {
  it('uses provider model and usage when the response supplies them', () => {
    const reply = parseOpenAiReply(
      {
        model: 'glm-5.2-served',
        choices: [{ message: { content: '生成完成。' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      },
      messages,
      'glm-5.2-requested',
    );

    expect(reply).toMatchObject({
      text: '生成完成。',
      model: 'glm-5.2-served',
      tokens: { in: 12, out: 5 },
      usageSource: 'provider',
      mode: 'upstream',
      protocol: 'openai',
      modelSource: 'provider',
    });
  });

  it('labels token counts as estimated when provider usage is incomplete', () => {
    const reply = parseOpenAiReply(
      {
        choices: [{ message: { content: '生成完成。' } }],
        usage: { prompt_tokens: 12 },
      },
      messages,
      'deepseek-chat',
    );

    expect(reply.model).toBe('deepseek-chat');
    expect(reply.modelSource).toBe('requested');
    expect(reply.usageSource).toBe('estimated');
    expect(reply.tokens.in).toBeGreaterThan(0);
    expect(reply.tokens.out).toBeGreaterThan(0);
  });

  it('rejects a malformed success response instead of creating an empty artifact', () => {
    expect(() => parseOpenAiReply({ choices: [] }, messages, 'glm-5.2')).toThrowError(
      expect.objectContaining<Partial<UpstreamError>>({ code: 'upstream_invalid_response' }),
    );
  });
});
