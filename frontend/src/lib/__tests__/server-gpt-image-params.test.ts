import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

describe('backend GPT Image advanced params forwarding', () => {
  it('does not contain legacy GPT Image SKU gating or token suffix logic', () => {
    expect(serverSource).not.toContain('gpt-image-2-fast');
    expect(serverSource).not.toContain('gpt-image-2-plus');
    expect(serverSource).not.toContain('gpt-image-2-pro');
    expect(serverSource).not.toContain('TOKEN_SUFFIX');
    expect(serverSource).not.toContain('supportsGptImageAdvancedParams(');
  });

  it('forwards quality/background/output_format and conditional style in multipart edits', () => {
    expect(serverSource).toContain("formData.append('quality', advancedParams.quality)");
    expect(serverSource).toContain("formData.append('background', advancedParams.background)");
    expect(serverSource).toContain("formData.append('output_format', advancedParams.outputFormat)");
    expect(serverSource).toContain("formData.append('style', advancedParams.style)");
  });

  it('forwards quality/background/output_format and conditional style in JSON generations', () => {
    expect(serverSource).toContain('quality: advancedParams.quality');
    expect(serverSource).toContain('background: advancedParams.background');
    expect(serverSource).toContain('output_format: advancedParams.outputFormat');
    expect(serverSource).toContain("advancedParams.style === 'vivid' || advancedParams.style === 'natural' ? { style: advancedParams.style } : {}");
  });

  it('routes OpenAI image endpoint by mode rather than legacy model names', () => {
    expect(serverSource).toContain("request.mode === 'image-to-image'");
    expect(serverSource).toContain("/v1/images/edits");
    expect(serverSource).toContain("/v1/images/generations");
  });

  it('resolves and forwards size for OpenAI image requests', () => {
    expect(serverSource).toContain('function resolveGptImageRequestSize(request)');
    expect(serverSource).toContain('const customSize = normalizeCustomImageSize(request.customSize, 3840)');
    expect(serverSource).toContain('return getSupportedGptImageSize(request.model, request.outputSize, request.aspectRatio)');
    expect(serverSource).toContain('return requestGptImage(apiKey, request, resolveGptImageRequestSize(request), {');
  });

  it('supports optional streaming image requests without retrying non-stream requests', () => {
    expect(serverSource).toContain("formData.append('stream', 'true')");
    expect(serverSource).toContain('...(stream ? { stream: true } : {})');
    expect(serverSource).toContain('streamImages: body.streamImages');
    expect(serverSource).toContain('stream: Boolean(request.streamImages)');
    expect(serverSource).toContain('function isImageEventStreamResponse(response)');
    expect(serverSource).toContain('return { image: await parseGptImageResponse(response), usesSse };');
    expect(serverSource).toContain('let usesSse = false;');
    expect(serverSource).toContain('usesSse = generated.usesSse;');
    expect(serverSource).toContain('usesSse: usesSse || Boolean(error?.usesSse)');
    expect(serverSource).toContain('function recordTaskSseResponse(taskId, requestCount)');
    expect(serverSource).toContain('onSseConfirmed: () => recordTaskSseResponse(taskId, request.parallelCount)');
    expect(serverSource).not.toContain('已回退非流式');
  });

  it('preserves upstream response bodies and prompts retry on gateway timeout', () => {
    expect(serverSource).toContain('function getUpstreamHttpErrorPrefix(status)');
    expect(serverSource).toContain('上游服务错误（HTTP 504，请再次重试）');
    expect(serverSource).toContain('getUpstreamHttpErrorPrefix(response.status)');
  });
});
