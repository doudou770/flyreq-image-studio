import type { VideoProtocol } from '@/lib/flyreq-models';
import { closeIndexedDbOnVersionChange, ensureIndexedDbSchema, INDEXED_DB, LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

export interface VideoReferenceMetadata {
  name: string;
  type: string;
  size: number;
  lastModified?: number;
}

export interface VideoReferenceFiles {
  images: File[];
  videos: File[];
  audios: File[];
}

export interface VideoReferenceMetadataGroup {
  images: VideoReferenceMetadata[];
  videos: VideoReferenceMetadata[];
  audios: VideoReferenceMetadata[];
}

export interface StoredVideoJob {
  id: string;
  serverTaskId?: string;
  /** 同一次批量提交的本地分组标识。 */
  batchId?: string;
  /** 当前视频在批量提交中的从零开始序号。 */
  batchIndex?: number;
  status: '排队中' | 'processing' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  /** 当前视频在批量提交中使用的附加提示词。 */
  promptVariant?: string;
  /** 当前视频实际发送给上游的完整提示词。 */
  effectivePrompt?: string;
  modelId: string;
  modelName?: string;
  apiModelId?: string;
  protocol?: VideoProtocol;
  resolution: number;
  videoSize: string;
  aspectRatio?: string;
  seconds: number;
  referenceVideos: VideoReferenceMetadata[];
  referenceAudios: VideoReferenceMetadata[];
  referenceImages: VideoReferenceMetadata[];
  /** 当前任务关联的参考素材二进制存储标识；同一批量任务共享一份素材。 */
  referenceStorageId?: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  durationUpdatedAt?: string;
  videoUrl?: string;
  /** 服务端原始视频地址，用于缓存失效、播放失败和下载修复时重新获取完整文件。 */
  videoSourceUrl?: string;
  cached?: boolean;
  error?: string;
}

const VIDEO_DB_CONTRACT = INDEXED_DB.videoResults;
const VIDEO_JOBS_KEY = LOCAL_STORAGE_KEYS.videoJobs;
const VIDEO_DB_NAME = VIDEO_DB_CONTRACT.name;
const VIDEO_STORE_NAME = VIDEO_DB_CONTRACT.stores[0].name;
const VIDEO_CACHE_RETRY_DELAYS_MS = [0, 1000, 3000];

/**
 * 读取浏览器本地视频任务历史。
 * @returns 按保存顺序存储的视频任务数组。
 */
export function loadVideoJobs(): StoredVideoJob[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(VIDEO_JOBS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 保存轻量视频任务历史。
 * @param jobs 当前视频任务数组。
 * @returns 无返回值。
 */
export function saveVideoJobs(jobs: StoredVideoJob[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(VIDEO_JOBS_KEY, JSON.stringify(jobs.map(job => ({
      ...job,
      // 对象 URL 只在当前页面有效，缓存未完成时也不能写入历史记录。
      videoUrl: job.cached || job.videoUrl?.startsWith('blob:') ? undefined : job.videoUrl,
    }))));
  } catch (error) {
    // 持久化失败时保留当前内存任务，避免 React effect 中的异常导致工作台崩溃。
    console.error('保存视频任务历史到 localStorage 失败', error);
  }
}

/**
 * 打开独立的视频结果 IndexedDB。
 * @returns 可读写视频 Blob 的数据库连接。
 */
function openVideoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, VIDEO_DB_CONTRACT.version);
    request.onupgradeneeded = () => {
      ensureIndexedDbSchema(request.result, request.transaction, VIDEO_DB_CONTRACT);
    };
    request.onsuccess = () => {
      closeIndexedDbOnVersionChange(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 构造视频参考素材在 IndexedDB 中的稳定键。
 * @param storageId 一次提交共享的素材存储标识。
 * @param kind 素材类型。
 * @param index 素材在同类型列表中的从零开始序号。
 * @returns 不会与视频结果任务键冲突的 IndexedDB 键。
 */
function getVideoReferenceKey(storageId: string, kind: keyof VideoReferenceFiles, index: number): string {
  return `reference:${storageId}:${kind}:${index}`;
}

/**
 * 将一次视频提交使用的全部参考素材持久化到 IndexedDB。
 * @param storageId 一次提交共享的素材存储标识。
 * @param files 按图片、视频和音频分类的原始文件。
 * @returns 全部素材写入完成后兑现的 Promise。
 */
export async function cacheVideoReferenceFiles(storageId: string, files: VideoReferenceFiles): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIDEO_STORE_NAME);
      (Object.keys(files) as Array<keyof VideoReferenceFiles>).forEach(kind => {
        files[kind].forEach((file, index) => {
          store.put(file, getVideoReferenceKey(storageId, kind, index));
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    // 大文件写入完成后立即关闭连接，避免阻塞完整备份和数据库恢复。
    db.close();
  }
}

/**
 * 从当前事务中读取一类参考素材并重建为可上传的 File。
 * @param store 视频缓存 object store。
 * @param storageId 一次提交共享的素材存储标识。
 * @param kind 素材类型。
 * @param metadata 用于恢复文件名、MIME 类型和顺序的任务元数据。
 * @returns 完整的参考素材文件；任一记录缺失时拒绝恢复。
 */
function restoreVideoReferenceKind(
  store: IDBObjectStore,
  storageId: string,
  kind: keyof VideoReferenceFiles,
  metadata: VideoReferenceMetadata[],
): Promise<File[]> {
  return Promise.all(metadata.map((item, index) => new Promise<File>((resolve, reject) => {
    const request = store.get(getVideoReferenceKey(storageId, kind, index));
    request.onsuccess = () => {
      const blob = request.result as Blob | undefined;
      if (!blob) {
        reject(new Error(`视频参考素材缓存缺失: ${kind}[${index}]`));
        return;
      }
      resolve(new File([blob], item.name, {
        type: item.type || blob.type,
        lastModified: item.lastModified ?? Date.now() + index,
      }));
    };
    request.onerror = () => reject(request.error);
  })));
}

/**
 * 从 IndexedDB 恢复一次视频提交使用的全部参考素材。
 * @param storageId 一次提交共享的素材存储标识。
 * @param metadata 按图片、视频和音频分类的文件元数据。
 * @returns 可直接重新提交的三类 File 数组。
 */
export async function restoreVideoReferenceFiles(
  storageId: string,
  metadata: VideoReferenceMetadataGroup,
): Promise<VideoReferenceFiles> {
  const db = await openVideoDb();
  try {
    const store = db.transaction(VIDEO_STORE_NAME, 'readonly').objectStore(VIDEO_STORE_NAME);
    const [images, videos, audios] = await Promise.all([
      restoreVideoReferenceKind(store, storageId, 'images', metadata.images),
      restoreVideoReferenceKind(store, storageId, 'videos', metadata.videos),
      restoreVideoReferenceKind(store, storageId, 'audios', metadata.audios),
    ]);
    return { images, videos, audios };
  } finally {
    // 恢复结束后释放数据库连接，避免长期占用大文件缓存数据库。
    db.close();
  }
}

/**
 * 删除一次视频提交缓存的全部参考素材。
 * @param storageId 一次提交共享的素材存储标识。
 * @param metadata 按类型记录的素材元数据，用于确定需要删除的键。
 * @returns 全部对应记录删除完成后兑现的 Promise。
 */
export async function deleteVideoReferenceFiles(
  storageId: string,
  metadata: VideoReferenceMetadataGroup,
): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIDEO_STORE_NAME);
      (Object.keys(metadata) as Array<keyof VideoReferenceMetadataGroup>).forEach(kind => {
        metadata[kind].forEach((_, index) => {
          store.delete(getVideoReferenceKey(storageId, kind, index));
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    // 删除结束后关闭连接，确保后续备份恢复可以独占升级数据库。
    db.close();
  }
}

/**
 * 下载并校验视频响应，防止网络中断产生的半截 Blob 进入本地缓存。
 * @param url 视频服务端地址。
 * @param signal 可选的请求取消信号，用于任务删除或工作台卸载时终止传输。
 * @returns 已完整读取且类型有效的视频 Blob。
 */
export async function fetchVideoBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  let lastError: unknown = new Error('视频缓存下载失败');
  for (let attempt = 0; attempt < VIDEO_CACHE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('视频下载已取消', 'AbortError');
    const delayMs = VIDEO_CACHE_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) await new Promise(resolve => window.setTimeout(resolve, delayMs));
    try {
      const response = await fetch(url, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(`视频下载失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      const contentLength = Number(response.headers?.get('content-length') || 0);
      const contentType = String(response.headers?.get('content-type') || blob.type || '').toLowerCase();
      if (blob.size <= 0 || (contentLength > 0 && blob.size !== contentLength)) {
        throw new Error('视频响应不完整');
      }
      if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
        throw new Error('视频响应类型无效');
      }
      return blob;
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('视频缓存下载失败');
}

/**
 * 将已校验完整的视频 Blob 写入 IndexedDB。
 * @param jobId 本地任务标识。
 * @param blob 已通过完整性校验的视频 Blob。
 * @returns 持久化事务完成后兑现的 Promise。
 */
export async function storeVideoBlob(jobId: string, blob: Blob): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      tx.objectStore(VIDEO_STORE_NAME).put(blob, jobId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    // 无论事务成功或失败都关闭连接，避免后续完整备份恢复被当前页面阻塞。
    db.close();
  }
}

/**
 * 下载并持久化完成视频。
 * @param jobId 本地任务标识。
 * @param url 服务端视频地址。
 * @param signal 可选的请求取消信号。
 * @returns 可立即播放的对象 URL。
 */
export async function cacheVideoBlob(jobId: string, url: string, signal?: AbortSignal): Promise<string> {
  const blob = await fetchVideoBlob(url, signal);
  await storeVideoBlob(jobId, blob);
  return URL.createObjectURL(blob);
}

/**
 * 从 IndexedDB 恢复视频对象 URL。
 * @param jobId 本地任务标识。
 * @returns 视频存在时返回对象 URL，否则返回 undefined。
 */
export async function restoreVideoBlobUrl(jobId: string): Promise<string | undefined> {
  const db = await openVideoDb();
  let blob: Blob | undefined;
  try {
    blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(VIDEO_STORE_NAME, 'readonly').objectStore(VIDEO_STORE_NAME).get(jobId);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    // 读取异常时同样关闭连接，确保数据库可以被升级、删除或完整恢复。
    db.close();
  }
  return blob ? URL.createObjectURL(blob) : undefined;
}

/**
 * 删除浏览器缓存的视频结果。
 * @param jobId 本地任务标识。
 * @returns 无返回值。
 */
export async function deleteVideoBlob(jobId: string): Promise<void> {
  const db = await openVideoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      tx.objectStore(VIDEO_STORE_NAME).delete(jobId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    // 删除失败也必须释放连接，否则用户下一次恢复备份仍会被阻塞。
    db.close();
  }
}
