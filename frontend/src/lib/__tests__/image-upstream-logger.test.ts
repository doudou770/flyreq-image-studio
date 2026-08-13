import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const logger = await import('../../../../backend/image-upstream-logger.js');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('图片上游日志', () => {
  it('按本地日期生成独立的图片日志文件名', () => {
    const filePath = logger.getImageUpstreamLogFilePath('C:/logs/image-upstream', new Date(2026, 7, 14, 1));

    expect(filePath.replace(/\\/g, '/')).toBe('C:/logs/image-upstream/image-upstream-2026-08-14.log');
  });

  it('请求日志会脱敏认证信息并摘要 data URL 图片', () => {
    const secret = 'sk-image-request-secret';
    const image = 'aGVsbG8gaW1hZ2U=';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logger.logImageUpstreamRequest(
      'generate',
      `https://upstream.example/v1/images/generations?api_key=${secret}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ prompt: 'hi', image: `data:image/png;base64,${image}` }),
      },
      { protocol: 'openai' },
    );

    const output = info.mock.calls.flat().join('\n');
    expect(output).toContain('[image-upstream]');
    expect(output).toContain('11 bytes');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(image);
  });

  it('响应日志摘要 OpenAI 与 Gemini 的 Base64 图片', () => {
    const openAiImage = 'b3BlbmFpLWltYWdl';
    const geminiImage = 'Z2VtaW5pLWltYWdl';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
    };

    logger.logImageUpstreamResponse('generate', 'https://upstream.example/openai', response, JSON.stringify({ data: [{ b64_json: openAiImage }] }));
    logger.logImageUpstreamResponse('generate', 'https://upstream.example/google', response, JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: geminiImage, mimeType: 'image/png' } }] } }] }));

    const output = info.mock.calls.flat().join('\n');
    expect(output).toContain('<图片 Base64 已省略；字节数=12>');
    expect(output).not.toContain(openAiImage);
    expect(output).not.toContain(geminiImage);
  });

  it('将脱敏的图片请求记录追加为 JSONL 文件', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flyreq-image-log-'));
    try {
      await logger.appendImageUpstreamLog('request', 'info', { stage: 'generate', body: { model: 'gpt-image-2' } }, { logDir });
      const files = await fs.promises.readdir(logDir);
      const record = JSON.parse((await fs.promises.readFile(path.join(logDir, files[0]), 'utf8')).trim());

      expect(files).toEqual([`image-upstream-${logger.getImageUpstreamLogDate()}.log`]);
      expect(record).toMatchObject({ event: 'request', level: 'info', stage: 'generate' });
    } finally {
      await fs.promises.rm(logDir, { recursive: true, force: true });
    }
  });
});
