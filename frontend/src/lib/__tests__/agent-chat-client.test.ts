import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeImage, streamAgentChat } from '@/lib/agent-chat-client';

describe('Agent 文本客户端', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('使用 Gemini 原生工具调用生成图片提案', async () => {
    const proposal = {
      action: 'generate',
      prompt: '一座云端城市，电影感广角构图',
      referenced_image_ids: [],
      reason: '用户明确要求生成新图片',
      requested_aspect_ratio: null,
      suggested_aspect_ratio: '16:9',
      requested_output_size: null,
      temperature: 1,
      parallel_count: 1,
      gpt_image_quality: 'auto',
      gpt_image_style: null,
      gpt_image_background: 'auto',
      requested_model_id: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [
          { text: '我为你准备好了提案。' },
          { functionCall: { name: 'propose_image_action', args: proposal } },
        ] } }],
      })}\n\n`,
    ));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();

    const handle = streamAgentChat(
      {
        apiKey: 'test-key',
        protocol: 'google',
        model: 'gemini-2.5-flash',
        history: [{ id: 'user-1', role: 'user', text: '帮我画一座云端城市', createdAt: 1 }],
        catalog: [],
        modelCatalog: [],
        webSearch: false,
      },
      { onDelta: () => undefined, onReasoning: () => undefined, onDone, onError: (error) => { throw error; } },
      'https://generativelanguage.googleapis.com',
    );

    await handle.promise;

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.protocol).toBe('google');
    expect(request.requestBody.systemInstruction.parts[0].text).toContain('图像生成与编辑助手');
    expect(request.requestBody.tools[0].functionDeclarations[0].name).toBe('propose_image_action');
    expect(onDone).toHaveBeenCalledWith('我为你准备好了提案。', expect.objectContaining({
      action: 'generate',
      prompt: proposal.prompt,
      suggestedAspectRatio: '16:9',
    }));
  });

  it('使用 Gemini 非流式接口描述图片', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '蓝色调城市夜景，霓虹灯光。' }] } }],
    })));
    vi.stubGlobal('fetch', fetchMock);

    const description = await describeImage(
      'test-key',
      'gemini-2.5-flash',
      'data:image/png;base64,aW1hZ2U=',
      undefined,
      'https://generativelanguage.googleapis.com',
      'google',
    );

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.protocol).toBe('google');
    expect(request.stream).toBe(false);
    expect(request.requestBody.contents[0].parts).toEqual(expect.arrayContaining([
      { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
    ]));
    expect(description).toBe('蓝色调城市夜景，霓虹灯光。');
  });
});
