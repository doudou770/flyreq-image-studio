'use client';

import { LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronDown, CloudUpload, FileText, ImagePlus, Info, Loader2, Save, Sparkles, X, Zap } from 'lucide-react';
import { AttachmentChips } from './AttachmentChips';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { QuickPromptDialog } from '@/components/QuickPromptDialog';
import { PromptOptimizeDialog } from '@/components/PromptOptimizeDialog';
import { AgentAssetPickerDialog, AgentTextAssetPickerDialog } from '@/components/agent/AgentAssetPickerDialog';
import { GenerationParamsPanel, type GenerationParamsPanelValue } from '@/components/GenerationParamsPanel';
import { ConfirmDialog } from '@/components/workspace/dialogs/ConfirmDialog';
import { usePromptOptimizeSetting } from '@/hooks/usePromptOptimizeSetting';
import { useImageModelDefaultRefresh } from '@/hooks/useImageModelDefaultRefresh';
import { getEffectivePromptSubmissionShortcutLabels, usePromptSubmissionShortcut } from '@/hooks/usePromptSubmissionShortcut';
import { PromptSubmissionShortcutMenu } from '@/components/PromptSubmissionShortcutMenu';
import { useI18n } from '@/components/LanguageProvider';
import { streamPromptOptimize, type StreamPromptOptimizeHandle } from '@/lib/prompt-optimize-client';
import { loadJsonFromStorage, saveJsonToStorage } from '@/lib/settings-storage';
import { requireDefaultConfiguredTextModel } from '@/lib/model-endpoints';
import { addTextAsset, getAssetBlob, type ImageAsset, type TextAsset } from '@/lib/asset-store';
import { getDefaultModelId, MODEL_IMAGE_LIMITS, MODEL_OPTIONS, type ModelId } from '@/lib/gemini-config';
import { getImageModelById, getResolvedImageModelId, loadRegistry, updateRegistryDefaults } from '@/lib/flyreq-models';
import { getModelCatalogCache } from '@/lib/model-catalog-cache';
import {
  DEFAULT_GPT_IMAGE_ADVANCED_PARAMS,
  getAspectRatioOptions,
  getCustomSizeMaxSide,
  getGptImageAdvancedParamsForModel,
  getValidOutputSizes,
  MAX_IMAGE_PARALLEL_COUNT,
  normalizeCustomImageSize,
  normalizeModel,
  normalizeParallelCount,
  supportsCustomSize,
  type GptImageAdvancedParams,
  type GptImageBackground,
  type GptImageOutputFormat,
  type GptImageQuality,
  type GptImageStyle,
  type ParallelCount,
} from '@/lib/model-capabilities';
import { prepareUploadImage, getOptimizationBadge } from '@/lib/upload-image-cache';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/constants';
import { dispatchImageActionToast } from '@/lib/image-actions';
import type { AspectRatio, OutputSize, RefImageData } from '@/lib/job-store';
import type { ImageFormSettings } from '@/lib/form-settings';
import type { ImageToImageSubmitInput, TextToImageSubmitInput } from '@/lib/workspace-task-service';
import { cn } from '@/lib/utils';
import { normalizePastedFileName } from '@/lib/pasted-file-naming';

const WORKBENCH_SETTINGS_KEY = LOCAL_STORAGE_KEYS.imageWorkbenchSettings;
const T2I_SETTINGS_KEY = LOCAL_STORAGE_KEYS.textToImageSettings;
const I2I_SETTINGS_KEY = LOCAL_STORAGE_KEYS.imageToImageSettings;
const MAX_ASSET_IMPORTS = 5;

type WorkbenchMode = 'text-to-image' | 'image-to-image';
type WorkbenchSettings = ImageFormSettings;

interface UploadedFile {
  id: string;
  name: string;
  preview: string;
  dataUrl: string;
  mimeType: string;
  badge?: string;
}

interface ImageGenerationWorkbenchProps {
  wideMode?: boolean;
  onSubmitText: (data: TextToImageSubmitInput) => void;
  onSubmitImage: (data: ImageToImageSubmitInput) => void;
  disabled?: boolean;
  onDraftConsumed?: () => void;
  onConfigureApiKey?: () => void;
  initialData?: {
    prompt?: string;
    channelId?: ModelId;
    outputSize?: OutputSize;
    customSize?: string;
    modelId?: string;
    customSizeAlignMultiple?: boolean;
    aspectRatio?: AspectRatio;
    temperature?: number;
    model?: ModelId;
    gptImageQuality?: GptImageQuality;
    gptImageStyle?: GptImageStyle;
    gptImageBackground?: GptImageBackground;
    gptImageOutputFormat?: GptImageOutputFormat;
    parallelCount?: ParallelCount;
    promptVariants?: string[];
    refImages?: RefImageData[];
  };
  referenceDraft?: {
    id: number;
    refImages: RefImageData[];
    prompt?: string;
  } | null;
}

function hasStoredSettings(settings: Partial<WorkbenchSettings>): boolean {
  return Object.keys(settings).length > 0;
}

function getSettingsFallback(preferImageSettings: boolean): Partial<WorkbenchSettings> {
  const saved = loadJsonFromStorage<WorkbenchSettings>(WORKBENCH_SETTINGS_KEY);
  if (hasStoredSettings(saved)) return saved;

  const primary = loadJsonFromStorage<WorkbenchSettings>(preferImageSettings ? I2I_SETTINGS_KEY : T2I_SETTINGS_KEY);
  if (hasStoredSettings(primary)) return primary;

  return loadJsonFromStorage<WorkbenchSettings>(preferImageSettings ? T2I_SETTINGS_KEY : I2I_SETTINGS_KEY);
}

function normalizePromptVariants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_IMAGE_PARALLEL_COUNT)
    .map(item => (typeof item === 'string' ? item : ''));
}

/**
 * 根据渠道缓存和配置默认值确定工作台应展示的远端模型 ID。
 * @param channelId 当前图片渠道的内部配置 ID。
 * @param candidate 初始数据或历史任务携带的远端模型 ID。
 * @returns 缓存中可用的模型 ID，或渠道默认模型 ID。
 */
function getInitialRemoteModelId(channelId: ModelId, candidate?: string): string {
  const normalizedCandidate = candidate?.trim();
  if (normalizedCandidate) return normalizedCandidate;
  const channel = getImageModelById(loadRegistry(), channelId);
  const configuredModelId = channel ? getResolvedImageModelId(channel) : '';
  const catalog = getModelCatalogCache(channelId, channel ? { protocol: channel.protocol, baseUrl: channel.baseUrl } : undefined);
  return catalog?.options.find(option => option.id === configuredModelId)?.id
    || configuredModelId
    || catalog?.options[0]?.id
    || '';
}

export function ImageGenerationWorkbench({
  onSubmitText,
  onSubmitImage,
  disabled = false,
  onDraftConsumed,
  onConfigureApiKey,
  initialData,
  referenceDraft,
}: ImageGenerationWorkbenchProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [model, setModel] = useState<ModelId>(() => getDefaultModelId());
  const [modelId, setModelId] = useState('');
  const [outputSize, setOutputSize] = useState<OutputSize>('1K');
  const [customSize, setCustomSize] = useState<string | undefined>(undefined);
  const [customSizeAlignMultiple, setCustomSizeAlignMultiple] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [temperature, setTemperature] = useState<number>(1);
  const [gptImageAdvancedParams, setGptImageAdvancedParams] = useState<GptImageAdvancedParams>(DEFAULT_GPT_IMAGE_ADVANCED_PARAMS);
  const [parallelCount, setParallelCount] = useState<ParallelCount>(1);
  const [promptVariants, setPromptVariants] = useState<string[]>([]);
  const [promptVariantsOpen, setPromptVariantsOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [quickPromptOpen, setQuickPromptOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [textAssetPickerOpen, setTextAssetPickerOpen] = useState(false);
  const [pendingTextAsset, setPendingTextAsset] = useState<TextAsset | null>(null);

  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizedText, setOptimizedText] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const optimizeHandleRef = useRef<StreamPromptOptimizeHandle | null>(null);
  const { enabled: promptOptimizeEnabled, available: promptOptimizeAvailable } = usePromptOptimizeSetting();
  const promptOptimizeUsable = promptOptimizeEnabled && promptOptimizeAvailable;
  const imageModelDefaultRefreshVersion = useImageModelDefaultRefresh();
  const { submissionShortcut, isSmallViewport, updateSubmissionShortcut } = usePromptSubmissionShortcut();
  const shortcutLabels = getEffectivePromptSubmissionShortcutLabels(submissionShortcut, isSmallViewport, {
    submission: t('workbench.mobileSend'),
    newline: t('workbench.mobileNewline'),
  });

  useEffect(() => () => {
    // 工作台卸载时终止仍在读取的提示词优化流，避免后台请求和卸载后的状态回调继续运行。
    optimizeHandleRef.current?.abort();
    optimizeHandleRef.current = null;
  }, []);

  const maxImages = MODEL_IMAGE_LIMITS[model]?.max || 1;
  const currentMode: WorkbenchMode = pendingFiles.length > 0 ? 'image-to-image' : 'text-to-image';

  /**
   * 合并参数条回传的配置，并在切回单图时清理不可见的逐图附加提示词。
   * @param patch 参数条变更后的局部配置。
   * @returns 无返回值，相关表单状态会同步更新。
   */
  const handleParamsChange = useCallback((patch: Partial<GenerationParamsPanelValue>) => {
    if (patch.model !== undefined) {
      setModel(patch.model);
      updateRegistryDefaults({ [currentMode === 'image-to-image' ? 'imageToImage' : 'textToImage']: patch.model });
    }
    if (patch.modelId !== undefined) setModelId(patch.modelId);
    if (patch.outputSize !== undefined) setOutputSize(patch.outputSize);
    if ('customSize' in patch) setCustomSize(patch.customSize);
    if (patch.customSizeAlignMultiple !== undefined) setCustomSizeAlignMultiple(patch.customSizeAlignMultiple);
    if (patch.aspectRatio !== undefined) setAspectRatio(patch.aspectRatio);
    if (patch.temperature !== undefined) setTemperature(patch.temperature);
    if (patch.parallelCount !== undefined) {
      setParallelCount(patch.parallelCount);
      if (patch.parallelCount <= 1) {
        setPromptVariants([]);
        setPromptVariantsOpen(false);
      }
    }
    if (patch.gptImageAdvancedParams !== undefined) setGptImageAdvancedParams(patch.gptImageAdvancedParams);
  }, [currentMode]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
  }, [prompt]);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      const useInitial = Boolean(initialData);
      const saved = getSettingsFallback(Boolean(initialData?.refImages?.length));
      const requestedChannelId = useInitial
        ? (initialData?.channelId || initialData?.model)
        : (saved.channelId || saved.model);
      const nextModel = normalizeModel(requestedChannelId);
      const candidateChannelId = String(requestedChannelId || '').trim();
      const candidateModelId = candidateChannelId === nextModel
        ? (useInitial ? initialData?.modelId : saved.modelId)
        : undefined;
      const nextModelId = getInitialRemoteModelId(nextModel, candidateModelId);
      const validSizes = getValidOutputSizes(nextModel);
      const nextOutputSize: OutputSize = useInitial && initialData?.outputSize && validSizes.includes(initialData.outputSize)
        ? initialData.outputSize
        : (saved.outputSize && validSizes.includes(saved.outputSize) ? saved.outputSize : validSizes[0]);
      const nextCustomSizeAlignMultiple = useInitial ? initialData?.customSizeAlignMultiple !== false : saved.customSizeAlignMultiple !== false;
      const nextCustomSize = supportsCustomSize(nextModel) && nextOutputSize !== 'auto'
        ? normalizeCustomImageSize(useInitial ? initialData?.customSize : saved.customSize, getCustomSizeMaxSide(nextModel), nextCustomSizeAlignMultiple)
        : undefined;
      const validRatios = getAspectRatioOptions(nextModel, nextOutputSize).map(a => a.value);
      const nextAspectRatio: AspectRatio = useInitial && initialData?.aspectRatio && validRatios.includes(initialData.aspectRatio)
        ? initialData.aspectRatio
        : (saved.aspectRatio && validRatios.includes(saved.aspectRatio) ? saved.aspectRatio : (validRatios[0] || '1:1'));
      const nextTemperature = useInitial && typeof initialData?.temperature === 'number' && initialData.temperature >= 0 && initialData.temperature <= 2
        ? initialData.temperature
        : (typeof saved.temperature === 'number' && saved.temperature >= 0 && saved.temperature <= 2 ? saved.temperature : 1);
      const nextAdvancedParams = getGptImageAdvancedParamsForModel(nextModel, {
        quality: useInitial ? initialData?.gptImageQuality : saved.gptImageQuality,
        style: useInitial ? initialData?.gptImageStyle : saved.gptImageStyle,
        background: useInitial ? initialData?.gptImageBackground : saved.gptImageBackground,
        outputFormat: useInitial ? initialData?.gptImageOutputFormat : saved.gptImageOutputFormat,
      });
      const nextParallelCount = normalizeParallelCount(useInitial ? initialData?.parallelCount : saved.parallelCount, MAX_IMAGE_PARALLEL_COUNT);
      const nextPromptVariants = normalizePromptVariants(useInitial ? initialData?.promptVariants : saved.promptVariants);

      setModel(nextModel);
      setModelId(nextModelId);
      setOutputSize(nextOutputSize);
      setCustomSize(nextCustomSize);
      setCustomSizeAlignMultiple(nextCustomSizeAlignMultiple);
      setAspectRatio(nextAspectRatio);
      setTemperature(nextTemperature);
      setGptImageAdvancedParams(nextAdvancedParams);
      setParallelCount(nextParallelCount);
      setPromptVariants(nextPromptVariants);
      setPromptVariantsOpen(false);
      if (useInitial) {
        setPrompt(initialData?.prompt || '');
        setPendingFiles((initialData?.refImages || []).map(img => ({
          id: img.id,
          name: img.name,
          preview: img.dataUrl,
          dataUrl: img.dataUrl,
          mimeType: img.mimeType,
          badge: img.badge,
        })));
      }

      setSettingsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [imageModelDefaultRefreshVersion, initialData]);

  useEffect(() => {
    if (!settingsReady) return;
    saveJsonToStorage(WORKBENCH_SETTINGS_KEY, {
      model,
      channelId: model,
      modelId,
      outputSize,
      customSize,
      customSizeAlignMultiple,
      aspectRatio,
      temperature,
      gptImageQuality: gptImageAdvancedParams.quality,
      gptImageStyle: gptImageAdvancedParams.style,
      gptImageBackground: gptImageAdvancedParams.background,
      gptImageOutputFormat: gptImageAdvancedParams.outputFormat,
      parallelCount,
      promptVariants,
    });
  }, [model, modelId, outputSize, customSize, customSizeAlignMultiple, aspectRatio, temperature, gptImageAdvancedParams, parallelCount, promptVariants, settingsReady]);

  const handleOptimize = useCallback(() => {
    if (!prompt.trim()) return;
    let textModel;
    try {
      textModel = requireDefaultConfiguredTextModel('promptOptimize');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('workbench.configureDefaultTextModel'), 'error');
      return;
    }

    optimizeHandleRef.current?.abort();
    setOptimizedText('');
    setOptimizeError(null);
    setOptimizing(true);
    setOptimizeOpen(true);

    const images = pendingFiles.map(f => ({ dataUrl: f.dataUrl, mimeType: f.mimeType }));
    const handle = streamPromptOptimize(
      { apiKey: textModel.apiKey, protocol: textModel.protocol, model: textModel.modelId, mode: currentMode, prompt: prompt.trim(), ...(images.length > 0 ? { images } : {}) },
      {
        onDelta(token) { setOptimizedText(prev => prev + token); },
        onDone() { setOptimizing(false); },
        onError(err) { setOptimizeError(err.message); setOptimizing(false); },
      },
      textModel.baseUrl,
    );
    optimizeHandleRef.current = handle;
  }, [currentMode, pendingFiles, prompt, t]);

  const handleOptimizeCancel = useCallback(() => {
    optimizeHandleRef.current?.abort();
    optimizeHandleRef.current = null;
    setOptimizing(false);
    setOptimizedText('');
    setOptimizeError(null);
  }, []);

  const handleOptimizeAccept = useCallback(() => {
    if (optimizedText) setPrompt(optimizedText);
    optimizeHandleRef.current = null;
    setOptimizedText('');
    setOptimizeError(null);
  }, [optimizedText]);

  const consumedDraftRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!referenceDraft?.refImages.length) return;
    if (consumedDraftRef.current === referenceDraft.id) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      consumedDraftRef.current = referenceDraft.id;
      if (referenceDraft.prompt) setPrompt(referenceDraft.prompt);
      setPendingFiles(prev => {
        const existingIds = new Set(prev.map(file => file.id));
        const remainingSlots = Math.max(0, maxImages - prev.length);
        if (remainingSlots <= 0) {
          setUploadError(t('workbench.maxReferenceImages', { model: MODEL_OPTIONS.find(o => o.value === model)?.label || model, count: maxImages }));
          return prev;
        }
        const incoming: UploadedFile[] = referenceDraft.refImages
          .filter(img => !existingIds.has(img.id))
          .slice(0, remainingSlots)
          .map(img => ({
            id: img.id,
            name: img.name,
            preview: img.dataUrl,
            dataUrl: img.dataUrl,
            mimeType: img.mimeType,
            badge: img.badge || t('workbench.referenceBadge'),
          }));
        if (incoming.length < referenceDraft.refImages.length) {
          setUploadError(t('workbench.maxReferenceImagesAdded', { model: MODEL_OPTIONS.find(o => o.value === model)?.label || model, count: maxImages }));
        } else {
          setUploadError(null);
        }
        return incoming.length > 0 ? [...prev, ...incoming] : prev;
      });
      onDraftConsumed?.();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- referenceDraft.id is the stable identity; refImages is consumed via ref guard
  }, [maxImages, model, onDraftConsumed, referenceDraft?.id, t]);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const filesToProcess = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (filesToProcess.length === 0) {
      setUploadError(t('workbench.selectImageFile'));
      return;
    }
    if (pendingFiles.length + filesToProcess.length > maxImages) {
      setUploadError(t('workbench.maxReferenceImages', { model: MODEL_OPTIONS.find(o => o.value === model)?.label || model, count: maxImages }));
      return;
    }

    setLoading(true);
    setUploadError(null);

    try {
      const newFiles: UploadedFile[] = [];

      for (const file of filesToProcess) {
        const optimized = await prepareUploadImage(file);
        if (optimized.processedSize > MAX_UPLOAD_SIZE_BYTES) {
          setUploadError(t('workbench.fileTooLarge', { name: file.name }));
          continue;
        }

        newFiles.push({
          id: optimized.id,
          name: optimized.name,
          preview: optimized.preview,
          dataUrl: optimized.dataUrl,
          mimeType: optimized.mimeType,
          badge: getOptimizationBadge(optimized.originalSize, optimized.processedSize, optimized.cacheHit),
        });
      }

      setPendingFiles(prev => {
        const existingIds = new Set(prev.map(f => f.id));
        const uniqueNew = newFiles.filter(f => !existingIds.has(f.id));
        return uniqueNew.length > 0 ? [...prev, ...uniqueNew] : prev;
      });
    } catch {
      setUploadError(t('workbench.fileReadFailed'));
    } finally {
      setLoading(false);
    }
  }, [maxImages, model, pendingFiles.length, t]);

  const handleImportAssets = useCallback(async (selectedAssets: ImageAsset[]) => {
    if (selectedAssets.length === 0) return;

    const remainingSlots = Math.max(0, maxImages - pendingFiles.length);
    if (remainingSlots <= 0) {
      setUploadError(t('workbench.maxReferenceImages', { model: MODEL_OPTIONS.find(o => o.value === model)?.label || model, count: maxImages }));
      return;
    }

    setLoading(true);
    setUploadError(null);

    try {
      const importedFiles: UploadedFile[] = [];

      for (const asset of selectedAssets.slice(0, Math.min(remainingSlots, MAX_ASSET_IMPORTS))) {
        const blob = await getAssetBlob(asset.id);
        if (!blob) continue;

        const file = new File([blob], asset.name, { type: asset.mimeType || blob.type || 'image/png' });
        const optimized = await prepareUploadImage(file);

        if (optimized.processedSize > MAX_UPLOAD_SIZE_BYTES) {
          setUploadError(t('workbench.fileTooLarge', { name: asset.name }));
          continue;
        }

        importedFiles.push({
          id: optimized.id,
          name: optimized.name,
          preview: optimized.preview,
          dataUrl: optimized.dataUrl,
          mimeType: optimized.mimeType,
          badge: t('workbench.assetLibrary'),
        });
      }

      setPendingFiles(prev => {
        const existingIds = new Set(prev.map(f => f.id));
        const uniqueImported = importedFiles.filter(f => !existingIds.has(f.id));
        return uniqueImported.length > 0 ? [...prev, ...uniqueImported] : prev;
      });

      if (selectedAssets.length > remainingSlots) {
        setUploadError(t('workbench.maxReferenceImagesImported', { model: MODEL_OPTIONS.find(o => o.value === model)?.label || model, count: maxImages }));
      }
    } catch {
      setUploadError(t('workbench.assetImportFailed'));
    } finally {
      setLoading(false);
    }
  }, [maxImages, model, pendingFiles.length, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processFiles(e.target.files);
      e.target.value = '';
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (loading) return;
      const target = e.target as HTMLElement;
      if (!formRef.current?.contains(target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(normalizePastedFileName(file, pendingFiles.length + imageFiles.length));
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void processFiles(imageFiles);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [loading, pendingFiles.length, processFiles]);

  const handleRemovePending = useCallback((id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const applyTextAsset = useCallback((asset: TextAsset) => {
    setPrompt(asset.content);
    setPendingTextAsset(null);
  }, []);

  const handleTextAssetConfirm = useCallback((asset: TextAsset) => {
    if (prompt.trim() && prompt.trim() !== asset.content.trim()) {
      setPendingTextAsset(asset);
      return;
    }
    applyTextAsset(asset);
  }, [applyTextAsset, prompt]);

  const handleSavePromptAsset = useCallback(async () => {
    if (!prompt.trim()) return;
    try {
      await addTextAsset({
        content: prompt,
        sourceKind: currentMode,
        sourceLabel: t('workbench.sourceLabel'),
      });
      dispatchImageActionToast(t('workbench.promptAssetSaved'), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('workbench.promptAssetSaveFailed'), 'error');
    }
  }, [currentMode, prompt, t]);

  const activePromptVariants = useMemo(
    () => Array.from({ length: parallelCount }, (_, index) => promptVariants[index] || ''),
    [parallelCount, promptVariants],
  );
  const submitPromptVariants = useMemo(() => {
    const values = normalizePromptVariants(activePromptVariants).map(item => item.trim());
    return values.some(Boolean) ? values : undefined;
  }, [activePromptVariants]);
  const hasCompletePromptVariants = parallelCount > 1 && activePromptVariants.every(variant => variant.trim().length > 0);

  const handlePromptVariantChange = useCallback((index: number, value: string) => {
    setPromptVariants(prev => {
      const next = prev.slice(0, MAX_IMAGE_PARALLEL_COUNT);
      next[index] = value;
      return next;
    });
  }, []);

  const handleSubmit = () => {
    const mainPrompt = prompt.trim();
    if ((!mainPrompt && !hasCompletePromptVariants) || disabled || loading) return;
    if (!model) {
      dispatchImageActionToast(t('workbench.selectImageModel'), 'error');
      return;
    }

    const modelWithBilling = model;
    if (pendingFiles.length > 0) {
      onSubmitImage({
        prompt: mainPrompt,
        files: pendingFiles,
        outputSize,
        customSize,
        customSizeAlignMultiple,
        aspectRatio,
        temperature,
        model: modelWithBilling,
        modelId,
        gptImageQuality: gptImageAdvancedParams.quality,
        gptImageStyle: gptImageAdvancedParams.style,
        gptImageBackground: gptImageAdvancedParams.background,
        gptImageOutputFormat: gptImageAdvancedParams.outputFormat,
        parallelCount,
        promptVariants: submitPromptVariants,
      });
    } else {
      onSubmitText({
        prompts: [mainPrompt],
        outputSize,
        customSize,
        customSizeAlignMultiple,
        aspectRatio,
        temperature,
        model: modelWithBilling,
        modelId,
        gptImageQuality: gptImageAdvancedParams.quality,
        gptImageStyle: gptImageAdvancedParams.style,
        gptImageBackground: gptImageAdvancedParams.background,
        gptImageOutputFormat: gptImageAdvancedParams.outputFormat,
        parallelCount,
        promptVariants: submitPromptVariants,
      });
    }

    setPendingFiles([]);
    setPrompt('');
    setPromptVariants([]);
    setPromptVariantsOpen(false);
    setUploadError(null);
    onDraftConsumed?.();
  };

  const handleClearDraft = () => {
    setPrompt('');
    setPromptVariants([]);
    setPromptVariantsOpen(false);
    setPendingFiles([]);
    setUploadError(null);
    onDraftConsumed?.();
  };

  /**
   * 根据用户选择的快捷键提交提示词，未匹配的 Enter 按键保留为换行。
   * @param e 文本框键盘事件。
   * @returns 无返回值。
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSmallViewport) return;
    const shouldSubmit = submissionShortcut === 'enter' ? !e.shiftKey : e.shiftKey;
    if (e.key === 'Enter' && shouldSubmit && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = (prompt.trim().length > 0 || hasCompletePromptVariants) && !disabled && !loading;
  const canClear = prompt.trim().length > 0
    || activePromptVariants.some(variant => variant.trim().length > 0)
    || pendingFiles.length > 0;

  return (
    <div ref={formRef} className="space-y-4">
      <div className="bg-muted/50 border border-border rounded-xl shadow-md">
        <>
            <div className="p-4 pb-2">
              <div className="flex gap-3">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={() => setIsDragOver(false)}
                  className={cn(
                    'relative flex-[3] overflow-hidden rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all',
                    isDragOver
                      ? 'border-primary bg-primary/20'
                      : 'cursor-pointer border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10',
                  )}
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    disabled={loading}
                    className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden opacity-0 disabled:cursor-not-allowed"
                    style={{ fontSize: 0 }}
                  />
                  <CloudUpload className={cn('mx-auto mb-1 h-6 w-6', isDragOver ? 'text-primary' : 'text-muted-foreground')} />
                  <p className="text-sm font-medium">
                    {loading ? t('workbench.reading') : isDragOver ? t('workbench.dropImages') : t('workbench.referenceImagesOptional')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('workbench.uploadHint')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('workbench.referenceImageCount', { count: pendingFiles.length, max: maxImages })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAssetPickerOpen(true)}
                  disabled={loading || pendingFiles.length >= maxImages}
                  title={t('workbench.importReferenceImages')}
                  className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-4 text-center transition-all hover:border-primary/50 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('workbench.assetLibrary')}</span>
                  <span className="text-xs text-muted-foreground">{t('workbench.importReferenceImages')}</span>
                </button>
              </div>
            </div>

            {pendingFiles.length > 0 && (
              <div className="px-4 pb-2">
                <AttachmentChips
                  files={pendingFiles}
                  onRemove={handleRemovePending}
                  sourceKind="upload"
                  sourceLabel={t('workbench.referenceSourceLabel')}
                  prompt={prompt}
                  showDownload={false}
                  showCopy
                  showUseAsReference={false}
                />
              </div>
            )}

            <div className="mx-3 mt-1 overflow-hidden rounded-xl border-2 border-primary/35 bg-background/70 shadow-sm transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15 sm:mx-4">
              <label htmlFor="image-generation-prompt" className="block px-3 pt-3 text-xs font-semibold text-primary sm:px-4 sm:pt-4">
                {t('workbench.promptLabel')}
              </label>
              <Textarea
                id="image-generation-prompt"
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pendingFiles.length > 0 ? t('workbench.imageEditPlaceholder') : t('workbench.imageGeneratePlaceholder')}
                rows={6}
                className="min-h-40 resize-none rounded-none border-0 bg-transparent px-3 pt-2.5 placeholder:text-placeholder focus-visible:border-0 focus-visible:ring-0 sm:min-h-48 sm:px-4 sm:pt-2.5"
              />
              <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4" aria-live="polite">
                {t('workbench.shortcutHint', { submission: shortcutLabels.submission, newline: shortcutLabels.newline })}
              </p>
            </div>

            <div className="px-3 pt-2 pb-2 sm:px-4">
              <GenerationParamsPanel
                value={{ model, modelId, outputSize, customSize, customSizeAlignMultiple, aspectRatio, temperature, parallelCount, gptImageAdvancedParams }}
                onChange={handleParamsChange}
                modelUnavailable={disabled}
              >
                {parallelCount > 1 && (
                  <div className="border-t border-border/70 pt-3">
                <button
                  type="button"
                  onClick={() => setPromptVariantsOpen(open => !open)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <span className="font-medium">
                    {t('workbench.perImageInstructions')}
                    {submitPromptVariants && (
                      <span className="ml-1 font-normal text-primary">
                        {submitPromptVariants.filter(Boolean).length}/{parallelCount}
                      </span>
                    )}
                  </span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', promptVariantsOpen && 'rotate-180')} />
                </button>
                {promptVariantsOpen && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {activePromptVariants.map((value, index) => (
                      <Textarea
                        key={index}
                        value={value}
                        onChange={(event) => handlePromptVariantChange(index, event.target.value)}
                        placeholder={t('workbench.additionalInstructionPlaceholder', { index: index + 1 })}
                        rows={2}
                        className="min-h-14 resize-none text-xs placeholder:text-placeholder"
                      />
                    ))}
                  </div>
                )}
                  </div>
                )}
              </GenerationParamsPanel>
            </div>

            {disabled && (
              <div className="mx-3 mb-2 flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 sm:mx-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Info className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{t('workbench.imageModelRequiredTitle')}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t('workbench.imageModelRequiredDescription')}</p>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onConfigureApiKey?.()}>
                  {t('workbench.configureImageModel')}
                </Button>
              </div>
            )}

            <div className="sticky bottom-0 z-20 ml-auto flex w-full justify-end gap-2 border-t border-border/70 bg-muted/95 px-3 py-2 backdrop-blur-sm sm:w-auto sm:px-4">
              <PromptSubmissionShortcutMenu value={submissionShortcut} isSmallViewport={isSmallViewport} onValueChange={updateSubmissionShortcut} />
              <Button variant="ghost" size="icon" onClick={() => setQuickPromptOpen(true)} title={t('workbench.quickPrompt')}>
                <Zap className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setTextAssetPickerOpen(true)} title={t('workbench.importPromptAsset')}>
                <FileText className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void handleSavePromptAsset()} disabled={!prompt.trim()} title={t('workbench.savePromptAsset')}>
                <Save className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleOptimize} disabled={!prompt.trim() || !promptOptimizeUsable} title={promptOptimizeUsable ? t('workbench.optimizePrompt') : promptOptimizeAvailable ? t('workbench.enablePromptOptimizeSetting') : t('workbench.configureDefaultTextModel')}>
                <Sparkles className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={handleClearDraft} disabled={!canClear} title={t('workbench.clearDraft')}>
                <X className="w-5 h-5" />
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit} size="icon" title={disabled ? t('workbench.configureImageModel') : currentMode === 'image-to-image' ? t('workbench.submitImageToImage') : t('workbench.submitTextToImage')}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
              </Button>
            </div>
          </>
      </div>

      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
      <QuickPromptDialog
        open={quickPromptOpen}
        onOpenChange={setQuickPromptOpen}
        currentMode={currentMode}
        currentPrompt={prompt}
        onSelect={setPrompt}
      />
      <PromptOptimizeDialog
        open={optimizeOpen}
        onOpenChange={setOptimizeOpen}
        originalPrompt={prompt}
        optimizedPrompt={optimizedText}
        loading={optimizing}
        error={optimizeError}
        onAccept={handleOptimizeAccept}
        onCancel={handleOptimizeCancel}
      />
      <AgentAssetPickerDialog
        open={assetPickerOpen}
        maxSelected={Math.min(MAX_ASSET_IMPORTS, Math.max(1, maxImages - pendingFiles.length))}
        onOpenChange={setAssetPickerOpen}
        onConfirm={(assets) => void handleImportAssets(assets)}
      />
      <AgentTextAssetPickerDialog
        open={textAssetPickerOpen}
        onOpenChange={setTextAssetPickerOpen}
        onConfirm={handleTextAssetConfirm}
      />
      {pendingTextAsset && createPortal(
        <ConfirmDialog
          title={t('workbench.overwritePromptTitle')}
          message={t('workbench.overwritePromptMessage')}
          confirmText={t('workbench.overwritePromptConfirm')}
          variant="default"
          onConfirm={() => applyTextAsset(pendingTextAsset)}
          onCancel={() => setPendingTextAsset(null)}
        />,
        document.body,
      )}
    </div>
  );
}
