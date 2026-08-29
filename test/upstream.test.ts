import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, parseUpstreamProfiles, type UpstreamProfile } from '../src/config.js';
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
  upstreamThinking: 'provider-default' | 'enabled' | 'disabled';
  upstreamProfiles: UpstreamProfile[];
};
const original = {
  upstreamUrl: config.upstreamUrl,
  upstreamKey: config.upstreamKey,
  upstreamModel: config.upstreamModel,
  upstreamThinking: config.upstreamThinking,
  upstreamProfiles: [...config.upstreamProfiles],
};

afterEach(() => {
  mutableConfig.upstreamUrl = original.upstreamUrl;
  mutableConfig.upstreamKey = original.upstreamKey;
  mutableConfig.upstreamModel = original.upstreamModel;
  mutableConfig.upstreamThinking = original.upstreamThinking;
  mutableConfig.upstreamProfiles = [...original.upstreamProfiles];
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
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('thinking');
  });

  it('can disable provider thinking for low-latency DeepSeek generation', async () => {
    mutableConfig.upstreamUrl = 'https://api.deepseek.com';
    mutableConfig.upstreamKey = 'test-key';
    mutableConfig.upstreamModel = 'deepseek-v4-flash';
    mutableConfig.upstreamThinking = 'disabled';
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: '生成完成。' } }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callUpstream([{ role: 'user', content: '生成短视频文案' }]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: false,
      thinking: { type: 'disabled' },
    });
  });

  it('routes a selected GLM model through its own provider profile', async () => {
    mutableConfig.upstreamModel = 'deepseek-v4-flash';
    mutableConfig.upstreamProfiles = [
      {
        model: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        provider: 'DeepSeek',
        url: 'https://api.deepseek.example',
        key: 'deepseek-test-key',
        thinking: 'disabled',
        timeoutMs: 45_000,
      },
      {
        model: 'glm-5.3-flash',
        label: 'GLM-5.3-Flash',
        provider: '智谱 GLM',
        url: 'https://glm.example/api/paas/v4',
        key: 'glm-test-key',
        thinking: 'provider-default',
        timeoutMs: 120_000,
      },
    ];
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          model: 'glm-5.3-flash',
          choices: [{ message: { content: 'GLM 已生成。' } }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callUpstream(messages, 'glm-5.3-flash');

    expect(result.model).toBe('glm-5.3-flash');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://glm.example/api/paas/v4/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer glm-test-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'glm-5.3-flash' });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('thinking');
  });

  it('rejects models outside the configured profile allowlist before any network call', async () => {
    mutableConfig.upstreamProfiles = [
      {
        model: 'glm-5.3',
        label: 'GLM-5.3',
        provider: '智谱 GLM',
        url: 'https://glm.example/api/paas/v4',
        key: 'glm-test-key',
        thinking: 'provider-default',
        timeoutMs: 120_000,
      },
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(callUpstream(messages, 'unconfigured-model')).rejects.toMatchObject({
      code: 'upstream_model_not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('multi-model profile configuration', () => {
  it('parses profiles while applying safe labels and defaults', () => {
    expect(
      parseUpstreamProfiles(
        JSON.stringify([
          {
            model: 'glm-5.3',
            url: 'https://open.bigmodel.cn/api/paas/v4/',
            key: 'test-key',
            timeoutMs: 120000,
          },
        ]),
      ),
    ).toEqual([
      {
        model: 'glm-5.3',
        label: 'glm-5.3',
        provider: '智谱 GLM',
        url: 'https://open.bigmodel.cn/api/paas/v4',
        key: 'test-key',
        thinking: 'provider-default',
        timeoutMs: 120000,
      },
    ]);
  });

  it('does not echo a credential when profile JSON is invalid', () => {
    const secret = 'credential-that-must-not-leak';
    expect(() => parseUpstreamProfiles(`[{"model":"glm-5.3","key":"${secret}"}`)).toThrow(
      'UPSTREAM_PROFILES_JSON must be valid JSON',
    );
    try {
      parseUpstreamProfiles(`[{"model":"glm-5.3","key":"${secret}"}`);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
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
