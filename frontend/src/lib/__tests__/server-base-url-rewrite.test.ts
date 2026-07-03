import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

function loadRewriteHelpers(): {
  resolveOutboundBaseUrl: (protocol: string, baseUrl: string, env: Record<string, string>) => string;
} {
  const start = serverSource.indexOf('function normalizeBaseUrl');
  const end = serverSource.indexOf('function resolveImageModelKeyGuide');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to locate Base URL rewrite helpers in backend/server.js');
  }

  const source = `${serverSource.slice(start, end)}\nreturn { resolveOutboundBaseUrl };`;
  return new Function(source)() as {
    resolveOutboundBaseUrl: (protocol: string, baseUrl: string, env: Record<string, string>) => string;
  };
}

describe('backend Base URL rewrite map', () => {
  const { resolveOutboundBaseUrl } = loadRewriteHelpers();

  it('rewrites public OpenAI-compatible URLs to Docker internal URLs', () => {
    const env = {
      FLYREQ_BASE_URL_REWRITE_MAP: '{"https://flyreq.com":"http://new-api:3000"}',
    };

    expect(resolveOutboundBaseUrl('openai', 'https://flyreq.com/v1', env)).toBe('http://new-api:3000');
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

    expect(resolveOutboundBaseUrl('openai', 'https://other.example.com/v1', env)).toBe('https://other.example.com');
  });
});
