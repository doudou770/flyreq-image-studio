import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  storage.set('flyreq-model-registry', JSON.stringify({
    imageModels: [{
      id: 'flyreq-gpt-image-2',
      protocol: 'openai',
      name: 'FlyReq',
      modelId: 'gpt-image-2',
      apiKey: 'test-api-key',
      baseUrl: 'https://api.openai.com',
      builtinPreset: 'gpt-image-2',
      maxRefImages: 16,
      maxOutputSize: '4K',
      supportsAdvancedParams: true,
    }],
    textModels: [],
    defaults: { textToImage: 'flyreq-gpt-image-2', imageToImage: 'flyreq-gpt-image-2' },
  }));
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() { return storage.size; },
    } as Storage,
    configurable: true,
  });
});

import { ackFlyreqTask, createFlyreqTask, resolveImageTaskProvider, type FlyreqTaskResponse } from '@/lib/flyreq-task-client';
import { downloadAndStoreImages } from '@/lib/image-downloader';
import type { StoredJob } from '@/lib/job-store';
import {
  finalizeCompletedServerTask,
  submitTextToImage,
  type SubmitActions,
} from '@/lib/workspace-task-service';
vi.mock('@/lib/flyreq-task-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/flyreq-task-client')>();
  return {
    ...actual,
    ackFlyreqTask: vi.fn(),
    createFlyreqTask: vi.fn(),
    resolveImageTaskProvider: vi.fn(),
  };
});

vi.mock('@/lib/image-downloader', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/image-downloader')>();
  return {
    ...actual,
    downloadAndStoreImages: vi.fn(),
  };
});

const mockedAckFlyreqTask = vi.mocked(ackFlyreqTask);
const mockedCreateFlyreqTask = vi.mocked(createFlyreqTask);
const mockedDownloadAndStoreImages = vi.mocked(downloadAndStoreImages);
const mockedResolveImageTaskProvider = vi.mocked(resolveImageTaskProvider);

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job-1',
    status: 'processing',
    mode: 'text-to-image',
    prompt: 'prompt',
    output_size: '1K',
    temperature: 1,
    aspect_ratio: '1:1',
    model: 'gemini-3-pro-image-preview',
    created_at: '2026-06-07T00:00:00.000Z',
    serverTaskId: 'task-1',
    ...overrides,
  };
}

function makeCompletedTask(images: string[]): FlyreqTaskResponse {
  return {
    id: 'task-1',
    status: 'completed',
    createdAt: '2026-06-07T00:00:01.000Z',
    completedAt: '2026-06-07T00:00:19.000Z',
    result: { images },
  };
}

function createActions(initialJob: StoredJob): { actions: SubmitActions; getJob: () => StoredJob } {
  let currentJob = initialJob;
  const actions: SubmitActions = {
    addJob: vi.fn(),
    replaceJob: vi.fn((_jobId, updater) => {
      currentJob = updater(currentJob);
    }),
    completeJob: vi.fn(async (_jobId, job) => {
      currentJob = job;
    }),
    failJob: vi.fn(async (_jobId, error) => {
      currentJob = { ...currentJob, status: 'failed', error };
    }),
  };

  return {
    actions,
    getJob: () => currentJob,
  };
}

beforeEach(() => {
  mockedAckFlyreqTask.mockReset();
  mockedAckFlyreqTask.mockResolvedValue(undefined);
  mockedCreateFlyreqTask.mockReset();
  mockedCreateFlyreqTask.mockResolvedValue('task-advanced-1');
  mockedDownloadAndStoreImages.mockReset();
  mockedResolveImageTaskProvider.mockReset();
  mockedResolveImageTaskProvider.mockReturnValue({
    apiKey: 'test-api-key',
    baseUrl: 'https://api.openai.com',
    protocol: 'openai',
    modelId: 'gpt-image-2',
  });
});

describe('submitTextToImage', () => {
  it('passes GPT Image advanced params into createFlyreqTask payload', async () => {
    const job = makeJob();
    const { actions, getJob } = createActions(job);
    mockedResolveImageTaskProvider.mockReturnValue({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.openai.com',
      protocol: 'openai',
      modelId: 'gpt-image-2',
      streamImages: true,
    });

    await submitTextToImage({
      prompts: ['cut out subject'],
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1,
      model: 'flyreq-gpt-image-2',
      gptImageQuality: 'high',
      gptImageStyle: 'vivid',
      gptImageBackground: 'transparent',
      gptImageOutputFormat: 'webp',
      parallelCount: 1,
    }, actions, vi.fn());

    expect(mockedCreateFlyreqTask).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-api-key',
      mode: 'text-to-image',
      model: 'gpt-image-2',
      gptImageQuality: 'high',
      gptImageStyle: 'vivid',
      gptImageBackground: 'transparent',
      gptImageOutputFormat: 'webp',
      streamImages: true,
    }));
    expect(actions.addJob).toHaveBeenCalledWith(expect.objectContaining({
      gptImageQuality: 'high',
      gptImageStyle: 'vivid',
      gptImageBackground: 'transparent',
      gptImageOutputFormat: 'webp',
    }));
    expect(getJob().serverTaskId).toBe('task-advanced-1');
  });
});

describe('finalizeCompletedServerTask', () => {
  it('全部 URL 图片缓存成功后替换为 blob URL 并 ack 服务端任务', async () => {
    mockedDownloadAndStoreImages.mockImplementation(async (_jobId, _imageRefs, options) => {
      options?.onProgress?.({ index: 0, status: 'downloading', loadedBytes: 5, totalBytes: 10, percent: 50 });
      options?.onProgress?.({ index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 });
      return {
        successCount: 1,
        failCount: 0,
        blobUrls: ['blob:cached-0'],
        items: [{ index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 }],
      };
    });
    const job = makeJob();
    const { actions, getJob } = createActions(job);

    await finalizeCompletedServerTask(job, makeCompletedTask(['URL:/api/flyreq/images/task-1/0']), actions);

    expect(actions.completeJob).toHaveBeenCalledTimes(2);
    expect(getJob().images).toEqual(['blob:cached-0']);
    expect(getJob().created_at).toBe('2026-06-07T00:00:01.000Z');
    expect(getJob().completed_at).toBe('2026-06-07T00:00:19.000Z');
    expect(getJob().serverTaskAcked).toBe(true);
    expect(getJob().imageDownloadProgress).toBeUndefined();
    expect(mockedAckFlyreqTask).toHaveBeenCalledWith('task-1');
  });

  it('部分 URL 图片缓存失败时保留 URL 引用和失败进度且不 ack', async () => {
    mockedDownloadAndStoreImages.mockImplementation(async (_jobId, _imageRefs, options) => {
      options?.onProgress?.({ index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 });
      options?.onProgress?.({ index: 1, status: 'failed', loadedBytes: 2, totalBytes: 10, percent: 20, error: 'stream failed' });
      return {
        successCount: 1,
        failCount: 1,
        blobUrls: ['blob:cached-0', ''],
        items: [
          { index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 },
          { index: 1, status: 'failed', loadedBytes: 2, totalBytes: 10, percent: 20, error: 'stream failed' },
        ],
      };
    });
    const job = makeJob();
    const { actions, getJob } = createActions(job);

    await finalizeCompletedServerTask(job, makeCompletedTask([
      'URL:/api/flyreq/images/task-1/0',
      'URL:/api/flyreq/images/task-1/1',
    ]), actions);

    expect(getJob().images).toEqual([
      'blob:cached-0',
      'URL:/api/flyreq/images/task-1/1',
    ]);
    expect(getJob().serverTaskAcked).toBe(false);
    expect(getJob().warning).toContain('1 张图片本地缓存失败');
    expect(getJob().imageDownloadProgress?.failed).toBe(1);
    expect(mockedAckFlyreqTask).not.toHaveBeenCalled();
  });
});
