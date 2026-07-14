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

import { ackFlyreqTask, createFlyreqTasks, resolveImageTaskProvider, type FlyreqTaskResponse } from '@/lib/flyreq-task-client';
import { downloadAndStoreImages } from '@/lib/image-downloader';
import type { StoredJob } from '@/lib/job-store';
import {
  finalizeCompletedServerTask,
  getTaskSseMetadata,
  submitImageToImage,
  submitTextToImage,
  type SubmitActions,
} from '@/lib/workspace-task-service';
vi.mock('@/lib/flyreq-task-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/flyreq-task-client')>();
  return {
    ...actual,
    ackFlyreqTask: vi.fn(),
    createFlyreqTasks: vi.fn(),
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
const mockedCreateFlyreqTasks = vi.mocked(createFlyreqTasks);
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
  mockedCreateFlyreqTasks.mockReset();
  mockedCreateFlyreqTasks.mockImplementation(async input => (
    Array.from({ length: input.parallelCount }, (_, index) => `task-advanced-${index + 1}`)
  ));
  mockedDownloadAndStoreImages.mockReset();
  mockedResolveImageTaskProvider.mockReset();
  mockedResolveImageTaskProvider.mockReturnValue({
    apiKey: 'test-api-key',
    baseUrl: 'https://api.openai.com',
    protocol: 'openai',
    modelId: 'gpt-image-2',
  });
});

describe('getTaskSseMetadata', () => {
  it('only exposes a tag state for upstream responses confirmed as SSE', () => {
    expect(getTaskSseMetadata({
      id: 'task-sse',
      status: 'completed',
      result: { images: ['URL:/api/image.png'], sse: { responses: 2, requests: 3 } },
    })).toEqual({ sseResponses: 2, sseRequests: 3 });

    expect(getTaskSseMetadata({
      id: 'task-json',
      status: 'completed',
      result: { images: ['URL:/api/image.png'] },
    })).toEqual({});
  });
});

describe('submitTextToImage', () => {
  it('passes GPT Image advanced params into the batch task payload', async () => {
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

    expect(mockedCreateFlyreqTasks).toHaveBeenCalledWith(expect.objectContaining({
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

  it('omits temperature from the upstream task payload when the model does not support it', async () => {
    const job = makeJob();
    const { actions } = createActions(job);
    mockedResolveImageTaskProvider.mockReturnValue({
      apiKey: 'test-key',
      baseUrl: 'https://generativelanguage.googleapis.com',
      protocol: 'google',
      modelId: 'custom-image-model',
      supportsTemperature: false,
    });

    await submitTextToImage({
      prompts: ['测试'],
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1.5,
      model: 'custom-image-model',
      gptImageQuality: 'auto',
      gptImageStyle: 'auto',
      gptImageBackground: 'auto',
      gptImageOutputFormat: 'png',
      parallelCount: 1,
    }, actions, vi.fn());

    const payload = mockedCreateFlyreqTasks.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('temperature');
  });

  it('splits text-to-image outputs into independent tasks with their own prompt variant', async () => {
    const job = makeJob();
    const { actions } = createActions(job);
    const promptVariants = ['正面半身', '侧身站姿', ''];

    await submitTextToImage({
      prompts: ['保持同一角色身份，生成一组宣传图'],
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1,
      model: 'flyreq-gpt-image-2',
      gptImageQuality: 'auto',
      gptImageStyle: 'auto',
      gptImageBackground: 'auto',
      gptImageOutputFormat: 'png',
      parallelCount: 3,
      promptVariants,
    }, actions, vi.fn());

    expect(mockedCreateFlyreqTasks).toHaveBeenCalledTimes(1);
    expect(mockedCreateFlyreqTasks.mock.calls.map(([payload]) => ({
      parallelCount: payload.parallelCount,
      promptVariants: payload.promptVariants,
      effectivePrompts: payload.effectivePrompts,
    }))).toEqual([
      {
        parallelCount: 3,
        promptVariants,
        effectivePrompts: [
          '保持同一角色身份，生成一组宣传图\n\n本张图要求：\n正面半身',
          '保持同一角色身份，生成一组宣传图\n\n本张图要求：\n侧身站姿',
          '保持同一角色身份，生成一组宣传图',
        ],
      },
    ]);
    expect(actions.addJob).toHaveBeenCalledTimes(3);
    expect(actions.addJob.mock.calls.map(([createdJob]) => ({
      parallelCount: createdJob.parallelCount,
      promptVariants: createdJob.promptVariants,
      effectivePrompt: createdJob.effectivePrompt,
    }))).toEqual([
      { parallelCount: 1, promptVariants: undefined, effectivePrompt: '保持同一角色身份，生成一组宣传图' },
      { parallelCount: 1, promptVariants: ['侧身站姿'], effectivePrompt: '保持同一角色身份，生成一组宣传图\n\n本张图要求：\n侧身站姿' },
      { parallelCount: 1, promptVariants: ['正面半身'], effectivePrompt: '保持同一角色身份，生成一组宣传图\n\n本张图要求：\n正面半身' },
    ]);
  });

  it('passes the Grok Imagine API flavor into the server task payload', async () => {
    const job = makeJob();
    const { actions } = createActions(job);
    mockedResolveImageTaskProvider.mockReturnValue({
      apiKey: 'xai-test-key',
      baseUrl: 'https://api.x.ai',
      protocol: 'openai',
      modelId: 'grok-imagine-image',
      imageApiFlavor: 'xai-imagine',
    });

    await submitTextToImage({
      prompts: ['A neon city at night'],
      outputSize: '2K',
      aspectRatio: '19.5:9',
      temperature: 1,
      model: 'grok-imagine',
      gptImageQuality: 'auto',
      gptImageStyle: 'auto',
      gptImageBackground: 'auto',
      gptImageOutputFormat: 'png',
      parallelCount: 1,
    }, actions, vi.fn());

    expect(mockedCreateFlyreqTasks).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.x.ai',
      model: 'grok-imagine-image',
      imageApiFlavor: 'xai-imagine',
      outputSize: '2K',
      aspectRatio: '19.5:9',
    }));
  });
});

describe('submitImageToImage', () => {
  it('splits image-to-image outputs into independent tasks', async () => {
    const job = makeJob({ mode: 'image-to-image' });
    const { actions } = createActions(job);

    await submitImageToImage({
      prompt: '将参考图改为水彩画',
      files: [{ id: 'ref-1', name: 'reference.png', dataUrl: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }],
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1,
      model: 'flyreq-gpt-image-2',
      gptImageQuality: 'auto',
      gptImageStyle: 'auto',
      gptImageBackground: 'auto',
      gptImageOutputFormat: 'png',
      parallelCount: 2,
      promptVariants: ['水彩风', '铅笔素描'],
    }, actions, vi.fn());

    expect(mockedCreateFlyreqTasks).toHaveBeenCalledTimes(1);
    expect(mockedCreateFlyreqTasks.mock.calls.map(([payload]) => ({
      mode: payload.mode,
      parallelCount: payload.parallelCount,
      promptVariants: payload.promptVariants,
      effectivePrompts: payload.effectivePrompts,
      imageCount: payload.images.length,
    }))).toEqual([
      {
        mode: 'image-to-image',
        parallelCount: 2,
        promptVariants: ['水彩风', '铅笔素描'],
        effectivePrompts: [
          '将参考图改为水彩画\n\n本张图要求：\n水彩风',
          '将参考图改为水彩画\n\n本张图要求：\n铅笔素描',
        ],
        imageCount: 1,
      },
    ]);
    expect(actions.addJob).toHaveBeenCalledTimes(2);
    expect(actions.addJob.mock.calls.map(([createdJob]) => createdJob.effectivePrompt)).toEqual([
      '将参考图改为水彩画\n\n本张图要求：\n铅笔素描',
      '将参考图改为水彩画\n\n本张图要求：\n水彩风',
    ]);
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
