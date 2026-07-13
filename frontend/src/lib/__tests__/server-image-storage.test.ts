import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

function loadImageStorageHelpers(): {
  saveImageToDisk: (taskId: string, itemIndex: number, subIndex: number, imageBuffer: Uint8Array, mimeType: string) => {
    filePath: string;
    httpUrl: string;
  };
} {
  const start = serverSource.indexOf('function getImageExtension');
  const end = serverSource.indexOf('function getImageMimeType');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to locate image storage helpers in backend/server.js');
  }

  const mockFs = { writeFileSync: () => undefined };
  const source = `${serverSource.slice(start, end)}\nreturn { saveImageToDisk };`;
  return new Function('fs', 'path', 'IMAGE_DIR', source)(mockFs, path, '/tmp/flyreq-images') as {
    saveImageToDisk: (taskId: string, itemIndex: number, subIndex: number, imageBuffer: Uint8Array, mimeType: string) => {
      filePath: string;
      httpUrl: string;
    };
  };
}

describe('backend image storage URLs', () => {
  const { saveImageToDisk } = loadImageStorageHelpers();

  it('keeps every upstream sub-image addressable by its subIndex', () => {
    expect(saveImageToDisk('task-1', 0, 0, new Uint8Array(), 'image/png').httpUrl)
      .toBe('/api/flyreq/images/task-1/0/0');
    expect(saveImageToDisk('task-1', 0, 1, new Uint8Array(), 'image/png').httpUrl)
      .toBe('/api/flyreq/images/task-1/0/1');
  });
});
