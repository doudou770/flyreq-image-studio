import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamPromptOptimize } from '@/lib/prompt-optimize-client';

describe('提示词优化客户端', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('使用用户为提示词优化选择的模型发起请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);

    const handle = streamPromptOptimize(
      {
        apiKey: 'test-key',
        protocol: 'openai',
        model: 'custom-prompt-model',
        mode: 'text-to-image',
        prompt: '测试提示词',
      },
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (error) => { throw error; },
      },
      'https://example.com',
    );

    await handle.promise;

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe('custom-prompt-model');
    expect(request.requestBody.model).toBe('custom-prompt-model');
  });

  it('使用 Gemini 协议时透传原生请求体并解析文本片段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"优化"}]}}]}\n\n'
      + 'data: {"candidates":[{"content":{"parts":[{"text":"结果"}]}}]}\n\n',
    ));
    vi.stubGlobal('fetch', fetchMock);
    const onDelta = vi.fn();
    const onDone = vi.fn();

    const handle = streamPromptOptimize(
      {
        apiKey: 'test-key',
        protocol: 'google',
        model: 'gemini-2.5-flash',
        mode: 'text-to-image',
        prompt: '测试提示词',
        images: [{ dataUrl: 'data:image/png;base64,aW1hZ2U=', mimeType: 'image/png' }],
      },
      { onDelta, onDone, onError: (error) => { throw error; } },
      'https://example.com',
    );

    await handle.promise;

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.protocol).toBe('google');
    expect(request.requestBody.contents[0].parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('测试提示词') }),
      { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
    ]));
    expect(onDelta).toHaveBeenNthCalledWith(1, '优化');
    expect(onDelta).toHaveBeenNthCalledWith(2, '结果');
    expect(onDone).toHaveBeenCalledWith('优化结果');
  });

  it('流式输出开始后断线时不重试，避免拼接两次优化结果', async () => {
    let sentFirstChunk = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sentFirstChunk) {
          sentFirstChunk = true;
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"首段"}\n\n'));
          return;
        }
        controller.error(new Error('连接中断'));
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', fetchMock);
    const onDelta = vi.fn();
    const onError = vi.fn();

    const handle = streamPromptOptimize(
      { apiKey: 'test-key', protocol: 'openai', model: 'custom-prompt-model', mode: 'text-to-image', prompt: '测试提示词' },
      { onDelta, onDone: () => undefined, onError },
      'https://example.com',
    );

    await handle.promise;

    expect(onDelta).toHaveBeenCalledWith('首段');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('优化超时后上报错误，避免界面持续显示优化中', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();

    const handle = streamPromptOptimize(
      { apiKey: 'test-key', protocol: 'openai', model: 'custom-prompt-model', mode: 'text-to-image', prompt: '测试提示词' },
      { onDelta: () => undefined, onDone: () => undefined, onError },
      'https://example.com',
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await handle.promise;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'TimeoutError', message: '优化请求超时' }));
  });

  it('用户主动取消时不把空响应当作优化完成', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const onError = vi.fn();

    const handle = streamPromptOptimize(
      { apiKey: 'test-key', protocol: 'openai', model: 'custom-prompt-model', mode: 'text-to-image', prompt: '测试提示词' },
      { onDelta: () => undefined, onDone, onError },
      'https://example.com',
    );
    handle.abort();
    await handle.promise;

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
