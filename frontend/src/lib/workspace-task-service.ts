import {
  createFlyreqTasks,
  ackFlyreqTask,
  resolveImageTaskProvider,
  type FlyreqTaskResponse,
  type ImageReference,
} from '@/lib/flyreq-task-client';
import type { ModelId } from '@/lib/gemini-config';
import type { AspectRatio, OutputSize, StoredJob } from '@/lib/job-store';
import {
  getGptImageAdvancedParamsForModel,
  type GptImageBackground,
  type GptImageOutputFormat,
  type GptImageQuality,
  type GptImageStyle,
  type ParallelCount,
} from '@/lib/model-capabilities';
import { generateUUID } from '@/lib/uuid';
import { downloadAndStoreImages, type DownloadResult, type ImageDownloadProgressItem } from '@/lib/image-downloader';
import { composeEffectiveImagePrompt } from '@/lib/prompt-variants';

export interface TextToImageSubmitInput {
  prompts: string[];
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  model: string;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  gptImageOutputFormat: GptImageOutputFormat;
  parallelCount: ParallelCount;
  promptVariants?: string[];
}

export interface ImageToImageSubmitInput {
  prompt: string;
  files: { id: string; name: string; dataUrl: string; mimeType: string }[];
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  model: string;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  gptImageOutputFormat: GptImageOutputFormat;
  parallelCount: ParallelCount;
  promptVariants?: string[];
}

export interface TaskSseMetadata {
  sseResponses?: number;
  sseRequests?: number;
}

export interface FailJobOptions extends TaskSseMetadata {
  terminal?: boolean;
  completedAt?: string;
}

export interface SubmitActions {
  addJob: (job: StoredJob) => void;
  replaceJob: (jobId: string, updater: (job: StoredJob) => StoredJob) => void;
  completeJob: (jobId: string, job: StoredJob) => Promise<void>;
  failJob: (jobId: string, error: string, options?: FailJobOptions) => Promise<void>;
  /** 可选：返回最新 job 快照，供异步流程避免使用过期闭包。 */
  getJob?: (jobId: string) => StoredJob | undefined;
}

/**
 * 从服务端任务结果中提取已经确认的 SSE 统计信息。
 * @param task 服务端返回的任务快照。
 * @returns 可写入本地任务的 SSE 响应数量与总请求数量；数据无效时返回空对象。
 */
export function getTaskSseMetadata(task: FlyreqTaskResponse): TaskSseMetadata {
  const sse = task.result?.sse;
  if (!sse || !Number.isInteger(sse.responses) || !Number.isInteger(sse.requests)) return {};
  if (sse.responses < 1 || sse.requests < sse.responses) return {};
  return { sseResponses: sse.responses, sseRequests: sse.requests };
}

/**
 * 计算图片下载进度的汇总状态。
 * @param items 每张图片当前的下载状态。
 * @returns 供任务卡片展示的下载进度；没有图片时返回 undefined。
 */
function buildImageDownloadProgress(items: ImageDownloadProgressItem[]): StoredJob['imageDownloadProgress'] {
  if (items.length === 0) return undefined;
  return {
    total: items.length,
    completed: items.filter(item => item.status === 'cached').length,
    failed: items.filter(item => item.status === 'failed').length,
    items,
  };
}

/**
 * 为一组服务端图片地址创建初始下载进度。
 * @param images 服务端返回的图片引用列表。
 * @returns 每张图片对应的待下载或已缓存状态。
 */
function createInitialImageDownloadProgress(images: string[]): StoredJob['imageDownloadProgress'] {
  return buildImageDownloadProgress(images.map((image, index) => ({
    index,
    status: image.startsWith('URL:') ? 'pending' : 'cached',
    loadedBytes: 0,
  })));
}

/**
 * 将多图提示词变体收敛为单张图片任务可识别的第一个变体。
 * @param promptVariants 原始多图任务的提示词变体列表。
 * @param imageIndex 当前要创建的图片序号。
 * @returns 当前图片的单元素变体列表；没有有效变体时返回 undefined。
 */
function getSingleImagePromptVariants(promptVariants: string[] | undefined, imageIndex: number): string[] | undefined {
  const promptVariant = promptVariants?.[imageIndex]?.trim();
  return promptVariant ? [promptVariant] : undefined;
}

/**
 * 将单张图片的下载进度同步回本地任务。
 * @param actions 本地任务状态操作集合。
 * @param jobId 需要更新的本地任务标识。
 * @param images 当前任务包含的图片引用。
 * @param item 某张图片最新的下载状态。
 * @returns 无返回值，状态会通过 actions 立即持久化。
 */
function applyImageDownloadProgress(
  actions: SubmitActions,
  jobId: string,
  images: string[],
  item: ImageDownloadProgressItem,
): void {
  actions.replaceJob(jobId, current => {
    const currentItems = current.imageDownloadProgress?.items?.length === images.length
      ? current.imageDownloadProgress.items
      : createInitialImageDownloadProgress(images)?.items || [];
    const items = currentItems.map(existing => (
      existing.index === item.index ? { ...existing, ...item } : existing
    ));
    return {
      ...current,
      imageDownloadProgress: buildImageDownloadProgress(items),
    };
  });
}

/**
 * 将图生图表单中的 Data URL 转换为后端可提交的图片引用。
 * @param files 用户选择的参考图文件列表。
 * @returns 仅包含 Base64 数据和 MIME 类型的图片引用列表。
 */
function buildImageReferences(files: ImageToImageSubmitInput['files']): ImageReference[] {
  return files.map(file => ({
    data: file.dataUrl.split(',')[1] || file.dataUrl,
    mimeType: file.mimeType,
  }));
}

/**
 * 创建一张图片对应的本地历史任务。
 * @param mode 生成模式。
 * @param prompt 本张图片使用的基础提示词。
 * @param outputSize 请求输出尺寸。
 * @param customSize 自定义像素尺寸。
 * @param aspectRatio 图片比例。
 * @param temperature 生成温度。
 * @param model 前端模型标识。
 * @param gptImageQuality 图片质量参数。
 * @param gptImageStyle 图片风格参数。
 * @param gptImageBackground 图片背景参数。
 * @param gptImageOutputFormat 图片输出格式。
 * @param parallelCount 该历史任务包含的图片数量。
 * @param promptVariants 本任务的提示词变体。
 * @param refImages 图生图参考图片。
 * @returns 已初始化、等待关联服务端任务的本地任务对象。
 */
function createBaseJob(
  mode: StoredJob['mode'],
  prompt: string,
  outputSize: OutputSize,
  customSize: string | undefined,
  aspectRatio: AspectRatio,
  temperature: number,
  model: string,
  gptImageQuality: GptImageQuality,
  gptImageStyle: GptImageStyle,
  gptImageBackground: GptImageBackground,
  gptImageOutputFormat: GptImageOutputFormat,
  parallelCount: ParallelCount,
  promptVariants?: string[],
  refImages?: StoredJob['refImages']
): StoredJob {
  const advancedParams = getGptImageAdvancedParamsForModel(model as ModelId, {
    quality: gptImageQuality,
    style: gptImageStyle,
    background: gptImageBackground,
    outputFormat: gptImageOutputFormat,
  });

  return {
    id: generateUUID(),
    status: 'processing',
    mode,
    prompt,
    originalPrompt: prompt,
    output_size: outputSize,
    custom_size: customSize,
    temperature,
    aspect_ratio: aspectRatio,
    model,
    gptImageQuality: advancedParams.quality,
    gptImageStyle: advancedParams.style,
    gptImageBackground: advancedParams.background,
    gptImageOutputFormat: advancedParams.outputFormat,
    parallelCount,
    promptVariants,
    effectivePrompt: composeEffectiveImagePrompt(prompt, promptVariants?.[0]),
    created_at: new Date().toISOString(),
    refImages,
  };
}

/**
 * 根据服务端终态任务构建本地终态任务。
 * @param job 提交时创建的本地任务。
 * @param task 服务端返回的任务快照。
 * @returns 带有结果图片、错误信息和 SSE 元数据的终态任务。
 */
export function buildCompletedJobFromTask(job: StoredJob, task: FlyreqTaskResponse): StoredJob {
  const images = task.result?.images || [];
  const createdAt = task.createdAt || job.created_at;
  const completedAt = task.completedAt || new Date().toISOString();
  const sseMetadata = getTaskSseMetadata(task);
  if (task.status === 'completed' && images.length > 0) {
    return {
      ...job,
      ...sseMetadata,
      status: 'completed',
      created_at: createdAt,
      completed_at: completedAt,
      images,
      imageData: images[0],
      warning: task.warning,
      serverTaskAcked: true,
    };
  }

  return {
    ...job,
    ...sseMetadata,
    status: 'failed',
    created_at: createdAt,
    completed_at: completedAt,
    error: task.error || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败'),
  };
}

/**
 * 完成服务端任务并将所有结果图片缓存到浏览器本地。
 * @param job 当前本地任务快照。
 * @param task 服务端终态任务。
 * @param actions 本地任务状态和持久化操作集合。
 * @returns 无返回值；任务会被更新为完成或失败状态。
 */
export async function finalizeCompletedServerTask(
  job: StoredJob,
  task: FlyreqTaskResponse,
  actions: SubmitActions
): Promise<void> {
  const images = task.result?.images || [];
  const createdAt = task.createdAt || job.created_at;
  const completedAt = task.completedAt || new Date().toISOString();
  const sseMetadata = getTaskSseMetadata(task);

  if (task.status === 'completed' && images.length > 0) {
    const hasUrlImages = images.some(img => img.startsWith('URL:'));

    if (!hasUrlImages) {
      const finalJob: StoredJob = {
        ...job,
        ...sseMetadata,
        status: 'completed',
        created_at: createdAt,
        completed_at: completedAt,
        images,
        imageData: images[0],
        warning: task.warning,
        serverTaskAcked: true,
        imageDownloadProgress: undefined,
      };
      await actions.completeJob(job.id, finalJob);

      if (job.serverTaskId) {
        await ackFlyreqTask(job.serverTaskId);
      }
      return;
    }

    await actions.completeJob(job.id, {
      ...job,
      ...sseMetadata,
      status: 'completed',
      created_at: createdAt,
      completed_at: completedAt,
      images,
      imageData: images[0],
      warning: task.warning,
      serverTaskAcked: false,
      blobUrls: undefined,
      imageDownloadProgress: createInitialImageDownloadProgress(images),
    });

    const result: DownloadResult = await downloadAndStoreImages(job.id, images, {
      onProgress: item => applyImageDownloadProgress(actions, job.id, images, item),
    });
    const finalImages = images.map((img, index) => (
      img.startsWith('URL:') && result.blobUrls[index] ? result.blobUrls[index] : img
    ));
    const blobUrls = result.blobUrls.filter(url => url && url.startsWith('blob:'));
    const remainingUrlCount = finalImages.filter(img => img.startsWith('URL:')).length;
    const allCached = remainingUrlCount === 0;
    const finalJob: StoredJob = {
      ...job,
      ...sseMetadata,
      status: 'completed',
      created_at: createdAt,
      completed_at: completedAt,
      images: finalImages,
      imageData: finalImages[0],
      warning: allCached
        ? task.warning
        : result.successCount === 0
          ? '本地缓存创建失败，已通过远程 URL 渲染。可点击「重新下载」重试缓存，或尽快保存图片（约 12 小时后服务端清理）。'
          : `${result.failCount} 张图片本地缓存失败（已通过远程 URL 渲染），已完成 ${result.successCount} 张。可点击「重新下载」重试缓存。`,
      serverTaskAcked: allCached,
      blobUrls: blobUrls.length > 0 ? blobUrls : undefined,
      imageDownloadProgress: allCached ? undefined : buildImageDownloadProgress(result.items),
    };
    await actions.completeJob(job.id, finalJob);

    if (allCached && job.serverTaskId) {
      await ackFlyreqTask(job.serverTaskId);
    }
    return;
  }

  const finalJob: StoredJob = {
    ...job,
    ...sseMetadata,
    status: 'failed',
    created_at: createdAt,
    completed_at: completedAt,
    error: task.error || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败'),
  };
  await actions.failJob(job.id, finalJob.error || '任务失败', { completedAt, ...sseMetadata });
}

export interface RetryDownloadResult {
  successCount: number;
  failCount: number;
  /** 仍以 URL: 开头、未能缓存到本地的图片张数（部分或全部）。 */
  remainingUrlCount: number;
}

/**
 * 重新下载并缓存仍以 URL: 开头的图片到 IndexedDB。
 * 用于"重新下载"按钮：当首次自动缓存因弱网、浏览器或 IndexedDB 环境原因失败时，
 * 用户可手动触发再次缓存，并复用同一套流式进度反馈。
 *
 * 行为：
 * - 仅对 job.images 中以 URL: 开头的项执行下载；blob:/data:/IDB: 项保持不变。
 * - 全部成功：清空 warning，调用 ackFlyreqTask 让服务端按 2 分钟规则清理。
 * - 部分/全部失败：保留 URL: 前缀，更新 warning 数量，不调用 ack（服务端继续保留）。
 * - 不抛异常；调用方根据返回值显示 toast。
 * @param job 已完成但仍包含远程图片引用的本地任务。
 * @param actions 本地任务状态和持久化操作集合。
 * @returns 本轮缓存成功数、失败数和剩余远程图片数量。
 */
export async function retryDownloadCachedImages(
  job: StoredJob,
  actions: SubmitActions,
): Promise<RetryDownloadResult> {
  const sourceImages = job.images || (job.imageData ? [job.imageData] : []);
  const urlIndices = sourceImages
    .map((img, index) => (img.startsWith('URL:') ? index : -1))
    .filter(index => index >= 0);

  if (urlIndices.length === 0) {
    return { successCount: 0, failCount: 0, remainingUrlCount: 0 };
  }

  actions.replaceJob(job.id, current => ({
    ...current,
    imageDownloadProgress: createInitialImageDownloadProgress(sourceImages),
  }));

  const result = await downloadAndStoreImages(job.id, sourceImages, {
    onProgress: item => applyImageDownloadProgress(actions, job.id, sourceImages, item),
  });
  const mergedImages = sourceImages.map((image, index) => (
    image.startsWith('URL:') && result.blobUrls[index] ? result.blobUrls[index] : image
  ));
  const newBlobUrls = result.blobUrls.filter(url => url && url.startsWith('blob:'));

  const remainingUrlCount = mergedImages.filter(img => img.startsWith('URL:')).length;
  const allCached = remainingUrlCount === 0;
  const existingBlobUrls = job.blobUrls || [];
  const combinedBlobUrls = [...existingBlobUrls, ...newBlobUrls];

  const updatedJob: StoredJob = {
    ...job,
    status: 'completed',
    images: mergedImages,
    imageData: mergedImages[0],
    warning: allCached
      ? undefined
      : `${remainingUrlCount} 张图片本地缓存仍未成功（已通过远程 URL 渲染），可继续点击「重新下载」重试。`,
    serverTaskAcked: allCached ? true : false,
    blobUrls: combinedBlobUrls.length > 0 ? combinedBlobUrls : undefined,
    imageDownloadProgress: allCached ? undefined : buildImageDownloadProgress(result.items),
  };

  await actions.completeJob(job.id, updatedJob);

  if (allCached && job.serverTaskId && !job.serverTaskAcked) {
    await ackFlyreqTask(job.serverTaskId);
  }

  return {
    successCount: result.successCount,
    failCount: result.failCount,
    remainingUrlCount,
  };
}

/**
 * 将文生图的多图请求拆分为多个独立的单图服务端任务。
 * @param input 文生图表单参数，parallelCount 表示需要创建的独立任务数量。
 * @param actions 本地任务状态和持久化操作集合。
 * @param onError 提交前置校验或全局异常的提示回调。
 * @returns 无返回值；每张图片会获得独立的本地任务和服务端任务标识。
 */
export async function submitTextToImage(
  input: TextToImageSubmitInput,
  actions: SubmitActions,
  onError: (message: string) => void
): Promise<void> {
  try {
    const provider = resolveImageTaskProvider(input.model);
    const apiKey = provider.apiKey;

    if (!apiKey) {
      onError('请先配置 API 密钥');
      return;
    }

    for (const prompt of input.prompts) {
      const jobs = Array.from({ length: input.parallelCount }, (_, imageIndex) => {
        const promptVariants = getSingleImagePromptVariants(input.promptVariants, imageIndex);
        return createBaseJob(
          'text-to-image',
          prompt,
          input.outputSize,
          input.customSize,
          input.aspectRatio,
          input.temperature,
          input.model,
          input.gptImageQuality,
          input.gptImageStyle,
          input.gptImageBackground,
          input.gptImageOutputFormat,
          1,
          promptVariants
        );
      });
      [...jobs].reverse().forEach(job => actions.addJob(job));

      try {
        const serverTaskIds = await createFlyreqTasks({
          apiKey,
          baseUrl: provider.baseUrl,
          protocol: provider.protocol,
          imageApiFlavor: provider.imageApiFlavor,
          mode: 'text-to-image',
          prompt,
          outputSize: input.outputSize,
          customSize: input.customSize,
          aspectRatio: input.aspectRatio,
          ...(provider.supportsTemperature ? { temperature: input.temperature } : {}),
          model: provider.modelId,
          gptImageQuality: input.gptImageQuality,
          gptImageStyle: input.gptImageStyle,
          gptImageBackground: input.gptImageBackground,
          gptImageOutputFormat: input.gptImageOutputFormat,
          streamImages: provider.streamImages,
          parallelCount: input.parallelCount,
          promptVariants: input.promptVariants,
          effectivePrompts: Array.from(
            { length: input.parallelCount },
            (_, imageIndex) => composeEffectiveImagePrompt(prompt, input.promptVariants?.[imageIndex]),
          ),
          images: [],
        });
        jobs.forEach((job, imageIndex) => {
          const serverTaskId = serverTaskIds[imageIndex];
          actions.replaceJob(job.id, current => ({
            ...current,
            status: '排队中',
            serverTaskId,
          }));
        });
      } catch (error) {
        for (const job of jobs) {
          await actions.failJob(job.id, error instanceof Error ? error.message : String(error));
        }
      }
    }
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * 将图生图的多图请求拆分为多个独立的单图服务端任务。
 * @param input 图生图表单参数，参考图会复制给每个独立任务。
 * @param actions 本地任务状态和持久化操作集合。
 * @param onError 提交前置校验或全局异常的提示回调。
 * @returns 无返回值；每张图片会获得独立的本地任务和服务端任务标识。
 */
export async function submitImageToImage(
  input: ImageToImageSubmitInput,
  actions: SubmitActions,
  onError: (message: string) => void
): Promise<void> {
  try {
    const provider = resolveImageTaskProvider(input.model);
    const apiKey = provider.apiKey;

    if (!apiKey) {
      onError('请先配置 API 密钥');
      return;
    }

    const refImages = input.files.map(file => ({
      id: file.id,
      name: file.name,
      dataUrl: file.dataUrl,
      mimeType: file.mimeType,
    }));
    const imageReferences = buildImageReferences(input.files);
    const jobs = Array.from({ length: input.parallelCount }, (_, imageIndex) => {
      const promptVariants = getSingleImagePromptVariants(input.promptVariants, imageIndex);
      return createBaseJob(
        'image-to-image',
        input.prompt,
        input.outputSize,
        input.customSize,
        input.aspectRatio,
        input.temperature,
        input.model,
        input.gptImageQuality,
        input.gptImageStyle,
        input.gptImageBackground,
        input.gptImageOutputFormat,
        1,
        promptVariants,
        refImages
      );
    });
    [...jobs].reverse().forEach(job => actions.addJob(job));

    try {
      const serverTaskIds = await createFlyreqTasks({
        apiKey,
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        imageApiFlavor: provider.imageApiFlavor,
        mode: 'image-to-image',
        prompt: input.prompt,
        outputSize: input.outputSize,
        customSize: input.customSize,
        aspectRatio: input.aspectRatio,
        ...(provider.supportsTemperature ? { temperature: input.temperature } : {}),
        model: provider.modelId,
        gptImageQuality: input.gptImageQuality,
        gptImageStyle: input.gptImageStyle,
        gptImageBackground: input.gptImageBackground,
        gptImageOutputFormat: input.gptImageOutputFormat,
        streamImages: provider.streamImages,
        parallelCount: input.parallelCount,
        promptVariants: input.promptVariants,
        effectivePrompts: Array.from(
          { length: input.parallelCount },
          (_, imageIndex) => composeEffectiveImagePrompt(input.prompt, input.promptVariants?.[imageIndex]),
        ),
        images: imageReferences,
      });
      jobs.forEach((job, imageIndex) => {
        const serverTaskId = serverTaskIds[imageIndex];
        actions.replaceJob(job.id, current => ({
          ...current,
          status: '排队中',
          serverTaskId,
        }));
      });
    } catch (error) {
      for (const job of jobs) {
        await actions.failJob(job.id, error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
}
