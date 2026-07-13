import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

function loadRewriteHelpers(): {
  resolveOutboundBaseUrl: (protocol: string, baseUrl: string, env: Record<string, string>) => string;
  appendProtocolApiPath: (protocol: string, baseUrl: string, apiPath: string) => string;
  shouldAuthorizeRemoteImageDownload: (imageUrl: string, request: { protocol: string; baseUrl: string }, env?: Record<string, string>) => boolean;
  resolveOutboundBaseUrlDetails: (protocol: string, baseUrl: string, env: Record<string, string>) => {
    baseUrl: string;
    originalBaseUrl: string;
    rewritten: boolean;
  };
  resolveAndLogOutboundBaseUrl: (requestType: string, protocol: string, baseUrl: string, env: Record<string, string>) => {
    baseUrl: string;
    originalBaseUrl: string;
    rewritten: boolean;
  };
} {
  const start = serverSource.indexOf('function normalizeBaseUrl');
  const end = serverSource.indexOf('function resolveImageModelKeyGuide');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to locate Base URL rewrite helpers in backend/server.js');
  }

  const source = `${serverSource.slice(start, end)}\nreturn { resolveOutboundBaseUrl, resolveOutboundBaseUrlDetails, resolveAndLogOutboundBaseUrl, appendProtocolApiPath, shouldAuthorizeRemoteImageDownload };`;
  return new Function(source)() as {
    resolveOutboundBaseUrl: (protocol: string, baseUrl: string, env: Record<string, string>) => string;
    appendProtocolApiPath: (protocol: string, baseUrl: string, apiPath: string) => string;
    shouldAuthorizeRemoteImageDownload: (imageUrl: string, request: { protocol: string; baseUrl: string }, env?: Record<string, string>) => boolean;
    resolveOutboundBaseUrlDetails: (protocol: string, baseUrl: string, env: Record<string, string>) => {
      baseUrl: string;
      originalBaseUrl: string;
      rewritten: boolean;
    };
    resolveAndLogOutboundBaseUrl: (requestType: string, protocol: string, baseUrl: string, env: Record<string, string>) => {
      baseUrl: string;
      originalBaseUrl: string;
      rewritten: boolean;
    };
  };
}

describe('backend Base URL rewrite map', () => {
  const { resolveOutboundBaseUrl, resolveOutboundBaseUrlDetails, resolveAndLogOutboundBaseUrl, appendProtocolApiPath, shouldAuthorizeRemoteImageDownload } = loadRewriteHelpers();

  it('rewrites public OpenAI-compatible URLs to Docker internal URLs', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000"}',
    };

    expect(resolveOutboundBaseUrl('openai', 'https://flyreq.com', env)).toBe('http://new-api:3000');
    expect(resolveOutboundBaseUrl('openai', 'https://flyreq.com/v1', env)).toBe('http://new-api:3000/v1');
  });

  it('supports multiple mappings', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000","https://api.example.com":"http://example-new-api:3000"}',
    };

    expect(resolveOutboundBaseUrl('openai', 'https://api.example.com', env)).toBe('http://example-new-api:3000');
  });

  it('keeps the original URL when no mapping matches', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000"}',
    };

    expect(resolveOutboundBaseUrl('openai', 'https://other.example.com/v1', env)).toBe('https://other.example.com/v1');
  });

  it('reports rewrite details for diagnostics', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000"}',
    };

    expect(resolveOutboundBaseUrlDetails('openai', 'https://flyreq.com', env)).toEqual({
      baseUrl: 'http://new-api:3000',
      originalBaseUrl: 'https://flyreq.com',
      rewritten: true,
    });
    expect(resolveOutboundBaseUrlDetails('openai', 'https://flyreq.com/v1', env)).toEqual({
      baseUrl: 'http://new-api:3000/v1',
      originalBaseUrl: 'https://flyreq.com/v1',
      rewritten: true,
    });
  });

  it('logs the original and rewritten Base URL only after a rewrite is applied', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000"}',
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      expect(resolveAndLogOutboundBaseUrl('图片生成', 'openai', 'https://flyreq.com/v1', env)).toMatchObject({
        baseUrl: 'http://new-api:3000/v1',
        originalBaseUrl: 'https://flyreq.com/v1',
        rewritten: true,
      });
      expect(info).toHaveBeenCalledWith('[base-url-rewrite] 状态=已应用 请求=图片生成 协议=openai 原始Base URL=https://flyreq.com/v1 映射Base URL=http://new-api:3000/v1');

      resolveAndLogOutboundBaseUrl('图片生成', 'openai', 'https://other.example.com/v1', env);
      expect(info).toHaveBeenCalledTimes(1);
    } finally {
      info.mockRestore();
    }
  });

  it('does not duplicate protocol API prefixes when building URLs', () => {
    expect(appendProtocolApiPath('openai', 'http://new-api:3000', '/v1/images/generations')).toBe('http://new-api:3000/v1/images/generations');
    expect(appendProtocolApiPath('openai', 'http://new-api:3000/v1', '/v1/images/generations')).toBe('http://new-api:3000/v1/images/generations');
    expect(appendProtocolApiPath('google', 'http://new-api:3000/v1beta', '/v1beta/models/gemini:generateContent')).toBe('http://new-api:3000/v1beta/models/gemini:generateContent');
  });

  it('only authorizes remote image downloads for configured or rewritten API origins', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000"}',
    };
    const request = { protocol: 'openai', baseUrl: 'https://flyreq.com/v1' };

    expect(shouldAuthorizeRemoteImageDownload('https://flyreq.com/v1/files/image-1', request, env)).toBe(true);
    expect(shouldAuthorizeRemoteImageDownload('http://new-api:3000/v1/files/image-1', request, env)).toBe(true);
    expect(shouldAuthorizeRemoteImageDownload('https://cdn.example.com/image-1.png', request, env)).toBe(false);
  });
});
