import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

function loadImageStreamParser(): (text: string) => string {
  const start = serverSource.indexOf('function parseJsonSafely');
  const end = serverSource.indexOf('async function parseGptImageResponse');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to locate image stream parser functions in backend/server.js');
  }

  const source = `${serverSource.slice(start, end)}\nreturn extractImagePayloadFromEventStream;`;
  return new Function(source)() as (text: string) => string;
}

describe('backend image stream parser', () => {
  const extractImagePayloadFromEventStream = loadImageStreamParser();

  it('uses a completed image event before partial image previews', () => {
    const sse = [
      'event: image_generation.partial_image',
      'data: {"type":"image_generation.partial_image","b64_json":"partial"}',
      '',
      'event: image_generation.completed',
      'data: {"type":"image_generation.completed","b64_json":"final"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    expect(extractImagePayloadFromEventStream(sse)).toBe('final');
  });

  it('falls back to the last partial image when no completed image arrives', () => {
    const sse = [
      'event: image_generation.partial_image',
      'data: {"type":"image_generation.partial_image","b64_json":"partial-1"}',
      '',
      'event: image_generation.partial_image',
      'data: {"type":"image_generation.partial_image","b64_json":"partial-2"}',
      '',
      'data: {"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    expect(extractImagePayloadFromEventStream(sse)).toBe('partial-2');
  });

  it('extracts URLs from New API JSON-as-stream completed events', () => {
    const sse = [
      'event: image_generation.completed',
      'data: {"type":"image_generation.completed","url":"https://example.com/image.png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    expect(extractImagePayloadFromEventStream(sse)).toBe('URL:https://example.com/image.png');
  });
});
