'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createFlyreqTask, getFlyreqTask, ackFlyreqTask, resolveImageTaskProvider, type ImageReference } from '@/lib/flyreq-task-client';
import { flyreqTaskSocket } from '@/lib/flyreq-task-socket';
import { generateUUID } from '@/lib/uuid';
import {
  downloadAndStoreImages,
  resolveStoredImageRef,
  revokeBlobUrls,
  makeStoredBlobRef,
  deleteStoredBlobs,
} from '@/lib/image-downloader';
import type { RefImageData } from '@/lib/job-store';
import {
  GIF_GRID_ASPECT_RATIO,
  GIF_GRID_CUSTOM_SIZE,
  GIF_GRID_OUTPUT_SIZE,
  loadActiveGifJob,
  loadGifTemplate,
  saveActiveGifJob,
  type ActiveGifJob,
  type GifStatus,
} from '@/lib/gif-job-store';
import { buildGifPrompt } from '@/lib/gif-prompt';
import { encodeGifFromGrid, encodeFramesToGif, triggerGifDownload } from '@/lib/gif-encoder';
import {
  getGptImageAdvancedParamsForModel,
  type GptImageBackground,
  type GptImageOutputFormat,
  type GptImageQuality,
  type GptImageStyle,
} from '@/lib/model-capabilities';

export interface SubmitInput {
  prompt: string;
  loop: boolean;
  closedLoop: boolean;
  model: string;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  gptImageOutputFormat: GptImageOutputFormat;
  refImages: RefImageData[];
  frameDelayMs: number;
  loopCount: number;
  framePadding: number;
}

export interface UseGifWorkflowResult {
  job: ActiveGifJob | null;
  gridImageUrl: string | null;
  gifBlob: Blob | null;
  gifReady: boolean;
  startedAt: number | null;
  isApiKeyMissing: boolean;
  isSyncing: boolean;
  submitGrid: (input: SubmitInput) => Promise<void>;
  encodeGif: (params: GifEncodeParams) => Promise<void>;
  encodeTunedGif: (frames: ImageData[], params: GifEncodeParams) => void;
  downloadGif: () => void;
  resetJob: () => Promise<void>;
  refreshFromServer: (onStatus?: (message: string) => void) => Promise<void>;
  updateJobStatus: (status: GifStatus) => void;
}

export interface GifEncodeParams {
  loop: boolean;
  frameDelayMs: number;
  loopCount: number;
  framePadding: number;
}

function buildImageReferences(template: { data: string; mimeType: string }, refs: RefImageData[]): ImageReference[] {
  const result: ImageReference[] = [{ data: template.data, mimeType: template.mimeType || 'image/png' }];
  for (const ref of refs) {
    const base64 = ref.dataUrl.includes(',') ? ref.dataUrl.split(',')[1] : ref.dataUrl;
    result.push({ data: base64, mimeType: ref.mimeType || 'image/png' });
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function useGifWorkflow(): UseGifWorkflowResult {
  const [job, setJobState] = useState<ActiveGifJob | null>(null);
  const [gridImageUrl, setGridImageUrl] = useState<string | null>(null);
  const [gifBlob, setGifBlob] = useState<Blob | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [isApiKeyMissing, setIsApiKeyMissing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const jobRef = useRef<ActiveGifJob | null>(null);
  const subscriptionRef = useRef<(() => void) | null>(null);
  const resolvedBlobUrlsRef = useRef<string[]>([]);

  const persistJob = useCallback((next: ActiveGifJob | null) => {
    jobRef.current = next;
    setJobState(next);
    saveActiveGifJob(next);
  }, []);

  const updateJob = useCallback((updater: (prev: ActiveGifJob) => ActiveGifJob) => {
    const current = jobRef.current;
    if (!current) return;
    const next = updater(current);
    persistJob(next);
  }, [persistJob]);

  const clearSubscription = useCallback(() => {
    if (subscriptionRef.current) {
      try { subscriptionRef.current(); } catch { /* ignore */ }
      subscriptionRef.current = null;
    }
  }, []);

  const revokeResolvedUrls = useCallback(() => {
    if (resolvedBlobUrlsRef.current.length > 0) {
      revokeBlobUrls(resolvedBlobUrlsRef.current);
      resolvedBlobUrlsRef.current = [];
    }
  }, []);

  const loadGridImageUrl = useCallback(async (target: ActiveGifJob): Promise<string | null> => {
    const ref = target.gridImageRef;
    if (!ref) return null;
    if (ref.startsWith('URL:')) return ref.substring(4);
    if (ref.startsWith('IDB:') || ref.startsWith('blob:')) {
      const resolved = await resolveStoredImageRef(target.id, ref, 0);
      if (resolved.blobUrl) {
        resolvedBlobUrlsRef.current.push(resolved.blobUrl);
      }
      return resolved.image && resolved.image !== ref ? resolved.image : null;
    }
    return ref;
  }, []);

  const finalizeGrid = useCallback(async (
    target: ActiveGifJob,
    images: string[],
    serverTaskId: string,
  ): Promise<void> => {
    const first = images[0];
    if (!first) {
      persistJob({
        ...target,
        status: 'failed',
        error: '后端返回的图片为空',
        updatedAt: nowIso(),
      });
      return;
    }

    let nextRef = first;
    let immediateBlobUrl: string | null = null;
    if (first.startsWith('URL:')) {
      try {
        const result = await downloadAndStoreImages(target.id, [first]);
        // 优先使用 downloadAndStoreImages 返回的 blobUrl，避免 IndexedDB 时序竞争
        if (result.successCount > 0 && result.blobUrls[0]) {
          immediateBlobUrl = result.blobUrls[0];
          nextRef = makeStoredBlobRef(target.id, 0);
        }
      } catch {
        // 下载失败：保留 URL: 引用，仍可走 HTTP 渲染
      }
    }

    const completed: ActiveGifJob = {
      ...target,
      status: 'review_grid',
      gridImageRef: nextRef,
      error: undefined,
      updatedAt: nowIso(),
    };
    persistJob(completed);

    try { await ackFlyreqTask(serverTaskId); } catch { /* ignore */ }

    revokeResolvedUrls();
    if (immediateBlobUrl) {
      resolvedBlobUrlsRef.current.push(immediateBlobUrl);
      setGridImageUrl(immediateBlobUrl);
    } else {
      const url = await loadGridImageUrl(completed);
      setGridImageUrl(url);
    }
  }, [persistJob, revokeResolvedUrls, loadGridImageUrl]);

  const subscribeServerTask = useCallback((taskId: string) => {
    clearSubscription();
    const unsubscribe = flyreqTaskSocket.subscribeTask(taskId, task => {
      const current = jobRef.current;
      if (!current || current.serverTaskId !== taskId) return;
      if (task.status === 'completed') {
        const images = task.result?.images || [];
        void finalizeGrid(current, images, taskId);
        clearSubscription();
        return;
      }
      if (task.status === 'failed' || task.status === 'expired') {
        persistJob({
          ...current,
          status: 'failed',
          error: task.error || task.warning || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败'),
          updatedAt: nowIso(),
        });
        clearSubscription();
        return;
      }
      if (task.status === 'processing' || task.status === 'queued' || task.status === '排队中') {
        if (current.status !== 'generating_grid') {
          persistJob({ ...current, status: 'generating_grid', updatedAt: nowIso() });
        }
      }
    });
    subscriptionRef.current = unsubscribe;
  }, [clearSubscription, finalizeGrid, persistJob]);

  useEffect(() => {
    queueMicrotask(() => {
      const initial = loadActiveGifJob();
      if (!initial) {
        setIsApiKeyMissing(false);
        return;
      }
      jobRef.current = initial;
      setJobState(initial);

    if (initial.gridImageRef) {
      void loadGridImageUrl(initial).then(setGridImageUrl);
    }

    if (initial.status === 'generating_grid' && initial.serverTaskId) {
      setStartedAt(Date.parse(initial.createdAt) || Date.now());
      getFlyreqTask(initial.serverTaskId)
        .then(task => {
          const current = jobRef.current;
          if (!current || current.serverTaskId !== initial.serverTaskId) return;
          if (task.status === 'completed') {
            void finalizeGrid(current, task.result?.images || [], initial.serverTaskId!);
          } else if (task.status === 'failed' || task.status === 'expired') {
            persistJob({
              ...current,
              status: 'failed',
              error: task.error || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败'),
              updatedAt: nowIso(),
            });
          } else {
            subscribeServerTask(initial.serverTaskId!);
          }
        })
        .catch(() => subscribeServerTask(initial.serverTaskId!));
    }

      setIsApiKeyMissing(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      clearSubscription();
      revokeResolvedUrls();
    };
  }, [clearSubscription, revokeResolvedUrls]);

  const cleanupJobAssets = useCallback(async (target: ActiveGifJob | null) => {
    if (!target) return;
    try {
      await deleteStoredBlobs(target.id, 1);
    } catch {
      // ignore cleanup error
    }
  }, []);

  const submitGrid = useCallback(async (input: SubmitInput) => {
    let provider;
    try {
      provider = resolveImageTaskProvider(input.model);
    } catch {
      setIsApiKeyMissing(true);
      throw new Error('请先完成 GIF 图片模型配置');
    }
    if (!provider.apiKey || !provider.baseUrl) {
      setIsApiKeyMissing(true);
      throw new Error('请先完成 GIF 图片模型配置');
    }
    setIsApiKeyMissing(false);

    const previousJob = jobRef.current;
    clearSubscription();
    revokeResolvedUrls();
    setGridImageUrl(null);
    setGifBlob(null);

    const template = await loadGifTemplate();
    const refsForSubmit = input.refImages.slice(0, 6);
    const advancedParams = getGptImageAdvancedParamsForModel(input.model, {
      quality: input.gptImageQuality,
      style: input.gptImageStyle,
      background: input.gptImageBackground,
      outputFormat: input.gptImageOutputFormat,
    });
    const finalPrompt = buildGifPrompt({
      userPrompt: input.prompt,
      refImageCount: refsForSubmit.length,
      loop: input.loop,
      closedLoop: input.closedLoop,
    });

    const next: ActiveGifJob = {
      id: generateUUID(),
      status: 'generating_grid',
      prompt: input.prompt,
      loop: input.loop,
      closedLoop: input.closedLoop,
      model: input.model,
      gptImageQuality: advancedParams.quality,
      gptImageStyle: advancedParams.style,
      gptImageBackground: advancedParams.background,
      gptImageOutputFormat: advancedParams.outputFormat,
      refImages: refsForSubmit,
      frameDelayMs: input.frameDelayMs,
      loopCount: input.loopCount,
      framePadding: input.framePadding,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    persistJob(next);
    setStartedAt(Date.now());

    void cleanupJobAssets(previousJob);

    try {
      // TODO: 从模型注册表读取实际的 baseUrl 和 protocol
      const serverTaskId = await createFlyreqTask({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        mode: 'image-to-image',
        prompt: finalPrompt,
        outputSize: GIF_GRID_OUTPUT_SIZE,
        customSize: GIF_GRID_CUSTOM_SIZE,
        aspectRatio: GIF_GRID_ASPECT_RATIO,
        temperature: 1,
        model: provider.modelId,
        gptImageQuality: advancedParams.quality,
        gptImageStyle: advancedParams.style,
        gptImageBackground: advancedParams.background,
        gptImageOutputFormat: advancedParams.outputFormat,
        streamImages: provider.streamImages,
        parallelCount: 1,
        images: buildImageReferences(template, refsForSubmit),
      });

      const withTaskId: ActiveGifJob = { ...next, serverTaskId, updatedAt: nowIso() };
      persistJob(withTaskId);
      subscribeServerTask(serverTaskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      persistJob({
        ...next,
        status: 'failed',
        error: message,
        updatedAt: nowIso(),
      });
      throw error;
    }
  }, [cleanupJobAssets, clearSubscription, persistJob, revokeResolvedUrls, subscribeServerTask]);

  const encodeGif = useCallback(async (params: GifEncodeParams) => {
    const current = jobRef.current;
    if (!current || current.status !== 'review_grid') return;
    let imageUrl = gridImageUrl;
    if (!imageUrl) {
      imageUrl = await loadGridImageUrl(current);
      if (imageUrl) setGridImageUrl(imageUrl);
    }
    if (!imageUrl) {
      updateJob(prev => ({ ...prev, status: 'failed', error: '无法读取网格图，请重新生成', updatedAt: nowIso() }));
      return;
    }

    // 更新 job 中的 GIF 参数
    updateJob(prev => ({
      ...prev,
      status: 'generating_gif',
      error: undefined,
      loop: params.loop,
      frameDelayMs: params.frameDelayMs,
      loopCount: params.loopCount,
      framePadding: params.framePadding,
      updatedAt: nowIso(),
    }));

    try {
      const repeat = params.loop ? Math.max(0, Math.floor(params.loopCount)) : -1;
      const blob = await encodeGifFromGrid(imageUrl, {
        frameDelayMs: params.frameDelayMs,
        repeat,
        framePaddingPercent: params.framePadding,
      });
      setGifBlob(blob);
      triggerGifDownload(blob, `gif-${current.id}.gif`);
      updateJob(prev => ({ ...prev, status: 'done', updatedAt: nowIso() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateJob(prev => ({ ...prev, status: 'failed', error: message, updatedAt: nowIso() }));
    }
  }, [gridImageUrl, loadGridImageUrl, updateJob]);

  const encodeTunedGif = useCallback((frames: ImageData[], params: GifEncodeParams) => {
    const current = jobRef.current;
    if (!current) return;
    updateJob(prev => ({
      ...prev,
      status: 'generating_gif',
      error: undefined,
      loop: params.loop,
      frameDelayMs: params.frameDelayMs,
      loopCount: params.loopCount,
      framePadding: params.framePadding,
      updatedAt: nowIso(),
    }));
    try {
      const repeat = params.loop ? Math.max(0, Math.floor(params.loopCount)) : -1;
      const blob = encodeFramesToGif(frames, {
        frameDelayMs: params.frameDelayMs,
        repeat,
      });
      setGifBlob(blob);
      triggerGifDownload(blob, `gif-${current.id}.gif`);
      updateJob(prev => ({ ...prev, status: 'done', updatedAt: nowIso() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateJob(prev => ({ ...prev, status: 'failed', error: message, updatedAt: nowIso() }));
    }
  }, [updateJob]);

  const downloadGif = useCallback(() => {
    const current = jobRef.current;
    if (!gifBlob || !current) return;
    triggerGifDownload(gifBlob, `gif-${current.id}.gif`);
  }, [gifBlob]);

  const updateJobStatus = useCallback((status: GifStatus) => {
    updateJob(prev => ({ ...prev, status, updatedAt: nowIso() }));
  }, [updateJob]);

  const resetJob = useCallback(async () => {
    const previous = jobRef.current;
    clearSubscription();
    revokeResolvedUrls();
    setGridImageUrl(null);
    setGifBlob(null);
    setStartedAt(null);
    persistJob(null);
    await cleanupJobAssets(previous);
  }, [cleanupJobAssets, clearSubscription, persistJob, revokeResolvedUrls]);

  const refreshFromServer = useCallback(async (onStatus?: (message: string) => void) => {
    const current = jobRef.current;
    if (!current?.serverTaskId || isSyncing) return;
    setIsSyncing(true);
    onStatus?.('正在查询任务状态…');
    try {
      const task = await getFlyreqTask(current.serverTaskId);
      if (task.status === 'completed') {
        onStatus?.('生成完成，正在下载图片…');
        await finalizeGrid(current, task.result?.images || [], current.serverTaskId);
      } else if (task.status === 'failed' || task.status === 'expired') {
        const errorMsg = task.error || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败');
        persistJob({
          ...current,
          status: 'failed',
          error: errorMsg,
          updatedAt: nowIso(),
        });
        onStatus?.(`任务失败：${errorMsg}`);
      } else if (task.status === 'processing') {
        persistJob({ ...current, status: 'generating_grid', updatedAt: nowIso() });
        onStatus?.('任务正在生成中，请稍候…');
      } else if (task.status === 'queued' || task.status === '排队中') {
        persistJob({ ...current, status: 'generating_grid', updatedAt: nowIso() });
        onStatus?.('任务排队中，请耐心等待…');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      persistJob({
        ...current,
        status: 'failed',
        error: message,
        updatedAt: nowIso(),
      });
      onStatus?.(`查询失败：${message}`);
    } finally {
      setIsSyncing(false);
    }
  }, [finalizeGrid, isSyncing, persistJob]);

  const gifReady: boolean = !!job && job.status === 'done';

  return {
    job,
    gridImageUrl,
    gifBlob,
    gifReady,
    startedAt,
    isApiKeyMissing,
    isSyncing,
    submitGrid,
    encodeGif,
    encodeTunedGif,
    downloadGif,
    resetJob,
    refreshFromServer,
    updateJobStatus,
  };
}

export type { GifStatus };
