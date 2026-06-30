"use client";

/**
 * 画布生成服务：把节点生成接入【宿主任务队列】（不改后端、不改队列）。
 * 仅使用 host 的 flyreq-task-client（createFlyreqTask / getFlyreqTask / ackFlyreqTask）。
 * 视频/音频不在范围内；图生图无 mask（队列不支持）。
 */
import { ackFlyreqTask, createFlyreqTask, getFlyreqTask, resolveImageTaskProvider, type FlyreqTaskResponse, type FlyreqTaskStatus, type ImageReference } from "@/lib/flyreq-task-client";
import { normalizeModel } from "@/lib/model-capabilities";
import { compressReferenceDataUrl } from "./lib/image-utils";
import { uploadImage } from "./lib/image-storage";
import type { CanvasGenerationConfig } from "./types";
import type { ReferenceImage } from "./types-media";

export type { CanvasGenerationConfig };

export type CanvasGeneratedImage = {
  storageKey: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
};

export class CanvasApiKeyMissingError extends Error {
  constructor() {
    super("请先配置 API 密钥");
    this.name = "CanvasApiKeyMissingError";
  }
}

const POLL_INTERVAL = 2500;
const MAX_WAIT_MS = 30 * 60 * 1000;

async function toImageReference(image: ReferenceImage): Promise<ImageReference | null> {
  if (!image.dataUrl || image.dataUrl.length < 100) return null; // 过滤空/无效 dataUrl
  // 发送前压缩，避免未压缩 PNG 把请求体顶过后端 10MB 上限导致连接重置
  const { dataUrl, mimeType } = await compressReferenceDataUrl(image.dataUrl);
  const data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return { data, mimeType: mimeType || image.type || "image/png" };
}

/** 合成实际提交用模型 ID。 */
function resolveTaskModel(config: CanvasGenerationConfig): string {
  return normalizeModel(config.model);
}

/** 提交单个节点的生成任务（count=1），返回 taskId。 */
export async function submitNodeGeneration(args: {
  prompt: string;
  referenceImages: ReferenceImage[];
  config: CanvasGenerationConfig;
}): Promise<string> {
  const provider = resolveImageTaskProvider(resolveTaskModel(args.config));
  const apiKey = provider.apiKey;
  if (!apiKey) throw new CanvasApiKeyMissingError();

  const imageRefs = (await Promise.all(args.referenceImages.map(toImageReference))).filter((ref): ref is ImageReference => ref !== null);
  const taskId = await createFlyreqTask({
    apiKey,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    mode: imageRefs.length > 0 ? "image-to-image" : "text-to-image",
    prompt: args.prompt,
    outputSize: args.config.outputSize,
    customSize: args.config.customSize,
    aspectRatio: args.config.aspectRatio,
    temperature: args.config.temperature,
    model: provider.modelId,
    gptImageQuality: args.config.gptImageQuality,
    gptImageStyle: args.config.gptImageStyle,
    gptImageBackground: args.config.gptImageBackground,
    gptImageOutputFormat: args.config.gptImageOutputFormat,
    streamImages: provider.streamImages,
    parallelCount: 1,
    images: imageRefs,
  });
  return taskId;
}

/** 轮询单个任务直到终态；通过 onStatus 回调实时通知调用方。 */
export async function pollNodeTask(
  taskId: string,
  onStatus: (status: FlyreqTaskStatus) => void,
  signal?: AbortSignal,
): Promise<CanvasGeneratedImage[]> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const task = await getFlyreqTask(taskId);
    onStatus(task.status);
    if (task.status === "completed" || task.status === "failed" || task.status === "expired") {
      const images = task.result?.images || [];
      if (task.status !== "completed" || images.length === 0) {
        throw new Error(task.error || (task.status === "expired" ? "该任务已超出取回时间" : "生成失败"));
      }
      const stored = (await Promise.all(images.map(storeResultImage))).filter((item): item is CanvasGeneratedImage => Boolean(item));
      void ackFlyreqTask(taskId);
      if (stored.length === 0) throw new Error("生成结果保存失败");
      return stored;
    }
    if (Date.now() > deadline) throw new Error("生成超时，请稍后重试");
    await delay(POLL_INTERVAL, signal);
  }
}

/** 检查已有任务的当前状态（用于刷新页面后恢复进行中的任务）。 */
export async function checkExistingTask(taskId: string): Promise<{ status: FlyreqTaskResponse["status"]; images?: CanvasGeneratedImage[]; error?: string }> {
  const task = await getFlyreqTask(taskId);
  if (task.status === "completed" && task.result?.images?.length) {
    const stored = (await Promise.all(task.result.images.map(storeResultImage))).filter((item): item is CanvasGeneratedImage => Boolean(item));
    void ackFlyreqTask(taskId);
    return { status: "completed", images: stored };
  }
  if (task.status === "failed" || task.status === "expired") {
    return { status: task.status, error: task.error || (task.status === "expired" ? "该任务已超出取回时间" : "生成失败") };
  }
  return { status: task.status };
}

/**
 * 提交一次生成任务到宿主队列并等待结果（兼容旧调用：一次任务按 config.count 返回多张图）。
 * @deprecated 新逻辑使用 submitNodeGeneration + pollNodeTask 逐节点提交。
 */
export async function generateCanvasImages(args: {
  prompt: string;
  referenceImages: ReferenceImage[];
  config: CanvasGenerationConfig;
  onStatus?: (status: FlyreqTaskStatus) => void;
  signal?: AbortSignal;
}): Promise<CanvasGeneratedImage[]> {
  const provider = resolveImageTaskProvider(resolveTaskModel(args.config));
  const apiKey = provider.apiKey;
  if (!apiKey) throw new CanvasApiKeyMissingError();

  const imageRefs = (await Promise.all(args.referenceImages.map(toImageReference))).filter((ref): ref is ImageReference => ref !== null);
  const taskId = await createFlyreqTask({
    apiKey,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    mode: imageRefs.length > 0 ? "image-to-image" : "text-to-image",
    prompt: args.prompt,
    outputSize: args.config.outputSize,
    customSize: args.config.customSize,
    aspectRatio: args.config.aspectRatio,
    temperature: args.config.temperature,
    model: provider.modelId,
    gptImageQuality: args.config.gptImageQuality,
    gptImageStyle: args.config.gptImageStyle,
    gptImageBackground: args.config.gptImageBackground,
    gptImageOutputFormat: args.config.gptImageOutputFormat,
    streamImages: provider.streamImages,
    parallelCount: args.config.count,
    images: imageRefs,
  });

  const images = await pollNodeTask(taskId, (s) => args.onStatus?.(s), args.signal);
  return images;
}

/** 结果可能是 data URL 或 `URL:/api/flyreq/images/...`；统一下载为 blob 存入本地 IndexedDB。 */
async function storeResultImage(image: string): Promise<CanvasGeneratedImage | null> {
  const realUrl = image.startsWith("URL:") ? image.slice(4) : image;
  if (!realUrl) return null;
  try {
    const stored = await uploadImage(realUrl);
    return { storageKey: stored.storageKey, url: stored.url, width: stored.width, height: stored.height, mimeType: stored.mimeType, bytes: stored.bytes };
  } catch {
    return null;
  }
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort);
    }
  });
}
