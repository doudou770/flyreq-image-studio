import type { GptImageBackground, GptImageOutputFormat, GptImageQuality, GptImageStyle } from '@/lib/model-capabilities';
import { makeStoredBlobRef, type ImageDownloadProgressItem } from '@/lib/image-downloader';
import { openImageDb, IMG_STORE } from '@/lib/image-db';

export type Mode = 'text-to-image' | 'image-to-image' | 'prompt-gallery';
export type OutputSize = 'auto' | '512' | '1K' | '2K' | '4K';
export type AspectRatio = 'auto' | '1:1' | '1:2' | '1:4' | '1:8' | '2:1' | '2:3' | '3:2' | '3:4' | '4:1' | '4:3' | '4:5' | '5:4' | '8:1' | '9:16' | '9:19.5' | '9:20' | '16:9' | '19.5:9' | '20:9' | '21:9';

export interface RefImageData {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  badge?: string;
}

export interface ImageDownloadProgress {
  total: number;
  completed: number;
  failed: number;
  items: ImageDownloadProgressItem[];
}

export interface StoredJob {
  id: string;
  status: 'queued' | '排队中' | 'processing' | 'completed' | 'failed';
  mode: Mode;
  prompt: string;
  output_size: OutputSize;
  custom_size?: string;
  temperature: number;
  aspect_ratio: AspectRatio;
  model: string;
  gptImageQuality?: GptImageQuality;
  gptImageStyle?: GptImageStyle;
  gptImageBackground?: GptImageBackground;
  gptImageOutputFormat?: GptImageOutputFormat;
  created_at: string;
  completed_at?: string;
  error?: string;
  networkError?: boolean;
  /** true 表示后端明确判定该失败任务不可恢复（API 错误 / 服务器重启 / 已过期 / 已删除）。
   * 仅在 status==='failed' 时有意义；undefined 视为非终态，允许"查看进度" */
  terminal?: boolean;
  warning?: string;
  imageData?: string;
  parallelCount?: number;
  /** 同一批量提交的稳定分组标识，用于保持每张图片的展示顺序。 */
  batchId?: string;
  /** 同一批量提交共用的提交时间，用于避免轮询回写服务端时间后拆散批次。 */
  batchCreatedAt?: string;
  /** 当前图片在批量提交中的从零开始序号。 */
  batchIndex?: number;
  promptVariants?: string[];
  /** 本张图片实际发送给上游的完整提示词，旧记录缺失时可由主提示词和附加提示词合成。 */
  effectivePrompt?: string;
  images?: string[];
  /** 实际返回 text/event-stream 的上游生成请求数量。 */
  sseResponses?: number;
  /** 当前服务端任务包含的上游生成请求总数。 */
  sseRequests?: number;
  serverTaskId?: string;
  serverTaskAcked?: boolean;
  refImages?: RefImageData[];
  originalPrompt?: string;
  blobUrls?: string[];
  imageDownloadProgress?: ImageDownloadProgress;
}

const JOBS_KEY = 'flyreq-jobs';

// 复用单例连接层；保留这两个导出名以兼容现有调用方（如 useWorkspaceJobs）。
export { IMG_STORE };
export const openDB = openImageDb;

export function getImageSrc(imageData: string): string {
  if (imageData.startsWith('blob:')) {
    return imageData;
  }

  if (imageData.startsWith('URL:')) {
    return imageData.substring(4);
  }

  if (imageData.startsWith('MULTI_URL:')) {
    return imageData.substring(10).split('|||')[0];
  }

  if (imageData.startsWith('IDB:')) {
    return '';
  }

  return `data:image/png;base64,${imageData}`;
}

/**
 * 按提交时间倒序排列任务，并保持同一批量任务按图片序号倒序展示。
 * @param left 待比较的左侧任务。
 * @param right 待比较的右侧任务。
 * @returns 负数表示左侧任务应排在前面，正数表示右侧任务应排在前面。
 */
export function compareStoredJobsByDisplayOrder(left: StoredJob, right: StoredJob): number {
  if (left.batchId && left.batchId === right.batchId) {
    return (right.batchIndex ?? 0) - (left.batchIndex ?? 0);
  }
  const leftCreatedAt = left.batchId ? left.batchCreatedAt || left.created_at : left.created_at;
  const rightCreatedAt = right.batchId ? right.batchCreatedAt || right.created_at : right.created_at;
  return +new Date(rightCreatedAt) - +new Date(leftCreatedAt);
}

/**
 * 为缺少批次提交时间的旧历史任务补齐同批次最早的提交时间。
 * @param jobs 从本地存储读取的历史任务。
 * @returns 已补齐旧批次时间字段的任务列表；已有字段的任务保持不变。
 */
export function restoreStoredJobBatchCreatedAt(jobs: StoredJob[]): StoredJob[] {
  const earliestCreatedAtByBatch = new Map<string, string>();
  for (const job of jobs) {
    if (!job.batchId) continue;
    const candidate = job.batchCreatedAt || job.created_at;
    const earliest = earliestCreatedAtByBatch.get(job.batchId);
    if (!earliest || +new Date(candidate) < +new Date(earliest)) {
      earliestCreatedAtByBatch.set(job.batchId, candidate);
    }
  }

  return jobs.map(job => (
    job.batchId && !job.batchCreatedAt
      ? { ...job, batchCreatedAt: earliestCreatedAtByBatch.get(job.batchId) || job.created_at }
      : job
  ));
}

/**
 * 将批次中的图片序号转换为紧凑的圈号标识。
 * @param index 从一开始的图片序号。
 * @returns 1 至 20 返回对应圈号，其余序号返回普通数字文本。
 */
export function getBatchImageMarker(index: number): string {
  const markers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  return markers[index - 1] || String(index);
}

/**
 * 获取任务卡片应直接展示的提示词，批量任务优先展示本张附加指令。
 * @param job 需要展示的历史任务。
 * @returns 有附加指令时返回该指令，否则返回主提示词。
 */
export function getStoredJobDisplayPrompt(job: StoredJob): string {
  return job.promptVariants?.[0]?.trim() || job.prompt;
}

function toPersistedImageRefs(result: StoredJob): string[] | undefined {
  return result.images?.map((image, index) => (
    image.startsWith('blob:') ? makeStoredBlobRef(result.id, index) : image
  ));
}

export async function saveImage(result: StoredJob) {
  const db = await openDB();
  if (!db) return;

  const images = toPersistedImageRefs(result);

  return new Promise<void>((resolve) => {
    const tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).put({
      id: result.id,
      jobId: result.id,
      status: result.status,
      imageData: images?.[0] || result.imageData,
      images,
      refImages: result.refImages,
      error: result.error,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function deleteImage(jobId: string) {
  const db = await openDB();
  if (!db) return;

  return new Promise<void>((resolve) => {
    const tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).delete(jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function loadJobs(): StoredJob[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: StoredJob[]) {
  if (typeof window === 'undefined') return;

  const lightweight = jobs.map(({ ...job }) => {
    delete job.imageData;
    delete job.images;
    delete job.refImages;
    delete job.blobUrls;
    delete job.imageDownloadProgress;
    return job;
  });
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(lightweight));
  } catch {
    // Keep the in-memory job list usable when storage quota or browser policy blocks writes.
  }
}
