'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  CloudUpload,
  Eraser,
  FileText,
  Globe,
  ImagePlus,
  Layers,
  Loader2,
  Maximize,
  RectangleHorizontal,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Thermometer,
  X,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { AttachmentChips } from '@/components/AttachmentChips';
import { GptImageAdvancedParamsControl } from '@/components/GptImageAdvancedParamsControl';
import { MissingApiKeyDialog } from '@/components/MissingApiKeyDialog';
import { ConfirmDialog } from '@/components/workspace/dialogs/ConfirmDialog';
import { Toast, type ToastData } from '@/components/workspace/Toast';
import { AgentProposalCard } from '@/components/agent/AgentProposalCard';
import { MemoizedAgentMessageBubble } from '@/components/agent/AgentMessageBubble';
import { AgentInputEditor, type AgentInputEditorHandle } from '@/components/agent/AgentInputEditor';
import { AgentAssetPickerDialog, AgentTextAssetPickerDialog } from '@/components/agent/AgentAssetPickerDialog';
import { cn } from '@/lib/utils';
import { renderReasoning, renderMarkdown } from '@/lib/render-reasoning';
import { handleMarkdownCodeCopyButtonClick } from '@/lib/markdown-code-copy';
import { generateUUID } from '@/lib/uuid';
import { prepareUploadImage, getOptimizationBadge } from '@/lib/upload-image-cache';
import { useAgentChat, type PendingUpload, type AgentPhase } from '@/hooks/useAgentChat';
import { MODEL_OPTIONS, type ModelId } from '@/lib/gemini-config';
import { addTextAsset, getAssetBlob, type ImageAsset, type TextAsset } from '@/lib/asset-store';
import type { OutputSize, AspectRatio } from '@/lib/job-store';
import {
  getAspectRatioOptions,
  getCustomSizeMaxSide,
  getGptImageAdvancedParamsForModel,
  getOutputSizeLabel,
  getSizeOptions,
  getSupportsTemperature,
  getValidOutputSizes,
  normalizeCustomImageSize,
  normalizeModel,
  normalizeParallelCount,
  PARALLEL_COUNT_OPTIONS,
  supportsCustomSize,
  supportsGptImageAdvancedParams,
  type GptImageAdvancedParams,
  type GptImageBackground,
  type GptImageOutputFormat,
  type GptImageQuality,
  type GptImageStyle,
  type ParallelCount,
} from '@/lib/model-capabilities';
import { createPortal } from 'react-dom';
import { PromptOptimizeDialog } from '@/components/PromptOptimizeDialog';
import { streamPromptOptimize, type StreamPromptOptimizeHandle } from '@/lib/prompt-optimize-client';
import { requireDefaultConfiguredTextModel } from '@/lib/model-endpoints';
import { AgentImageGallery } from '@/components/agent/AgentImageGallery';
import { AgentGenerationProgress } from '@/components/agent/AgentGenerationResult';
import { CustomSizeDialog } from '@/components/CustomSizeDialog';
import { usePromptOptimizeSetting } from '@/hooks/usePromptOptimizeSetting';
import { useI18n } from '@/components/LanguageProvider';

import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/constants';
import { loadJsonFromStorage, saveJsonToStorage } from '@/lib/settings-storage';

const MAX_AGENT_ASSET_IMPORTS = 5;
const AGENT_PARAMS_KEY = 'flyreq-agent-params';

interface AgentParamsSettings {
  model: ModelId;
  outputSize: OutputSize;
  aspectRatio: AspectRatio;
  temperature: number;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  gptImageOutputFormat: GptImageOutputFormat;
  parallelCount: ParallelCount;
  customSize?: string;
}

interface AgentChatWorkspaceProps {
  wideMode?: boolean;
  disabled?: boolean;
  onConfigureApiKey?: () => void;
}

/**
 * 将 Agent 内部阶段转换为当前界面语言的状态提示。
 * @param phase Agent 当前执行阶段。
 * @param t 当前语言的翻译函数。
 * @returns 可展示的状态文本；空闲或确认阶段返回 null。
 */
function phaseLabel(phase: AgentPhase, t: (key: import('@/lib/i18n').I18nKey) => string): string | null {
  switch (phase) {
    case 'loading': return t('agentWorkspace.phaseLoading');
    case 'describing': return t('agentWorkspace.phaseDescribing');
    case 'streaming': return t('agentWorkspace.phaseStreaming');
    case 'generating': return t('agentWorkspace.phaseGenerating');
    default: return null;
  }
}

export function AgentChatWorkspace({ wideMode = false, disabled = false, onConfigureApiKey }: AgentChatWorkspaceProps) {
  const agent = useAgentChat();
  const { t } = useI18n();
  const { enabled: promptOptimizeEnabled } = usePromptOptimizeSetting();
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [textAssetPickerOpen, setTextAssetPickerOpen] = useState(false);
  const [pendingTextAsset, setPendingTextAsset] = useState<TextAsset | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hasEditorContent, setHasEditorContent] = useState(false);
  const editorRef = useRef<AgentInputEditorHandle>(null);
  const [missingApiKeyDialogOpen, setMissingApiKeyDialogOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastData[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, type: ToastData['type']) => {
    const id = `agent-toast-${++toastIdRef.current}`;
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // 确认弹窗状态：删除单条 / 撤回以下所有
  const [deleteConfirmMsgId, setDeleteConfirmMsgId] = useState<string | null>(null);
  const [rollbackConfirmMsgId, setRollbackConfirmMsgId] = useState<string | null>(null);

  // 主动查询冷却：触发后短暂禁用按钮，避免重复查询
  const [onCooldown, setOnCooldown] = useState(false);
  useEffect(() => {
    if (!onCooldown) return;
    const timer = window.setTimeout(() => setOnCooldown(false), 5000);
    return () => window.clearTimeout(timer);
  }, [onCooldown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const intentRecognition = agent.intentRecognition;

  // ===== 用户参数状态（持久化到 localStorage）=====
  const savedParams = loadJsonFromStorage<AgentParamsSettings>(AGENT_PARAMS_KEY);
  const initialUserModel = normalizeModel(savedParams.model || agent.imageModel);
  const initialUserOutputSizes = getValidOutputSizes(initialUserModel);
  const initialUserOutputSize: OutputSize = savedParams.outputSize && initialUserOutputSizes.includes(savedParams.outputSize)
    ? savedParams.outputSize
    : initialUserOutputSizes[0];
  const initialUserAspectRatios = getAspectRatioOptions(initialUserModel, initialUserOutputSize).map(option => option.value);
  const initialUserAspectRatio: AspectRatio = savedParams.aspectRatio && initialUserAspectRatios.includes(savedParams.aspectRatio)
    ? savedParams.aspectRatio
    : (initialUserAspectRatios[0] || '1:1');
  const initialUserTemperature = typeof savedParams.temperature === 'number' && savedParams.temperature >= 0 && savedParams.temperature <= 2
    ? savedParams.temperature
    : 1;
  const initialUserCustomSize = supportsCustomSize(initialUserModel) && initialUserOutputSize !== 'auto'
    ? normalizeCustomImageSize(savedParams.customSize, getCustomSizeMaxSide(initialUserModel))
    : undefined;

  const [userModel, setUserModel] = useState<ModelId>(initialUserModel);
  const [userOutputSize, setUserOutputSize] = useState<OutputSize>(initialUserOutputSize);
  const [userAspectRatio, setUserAspectRatio] = useState<AspectRatio>(initialUserAspectRatio);
  const [userTemperature, setUserTemperature] = useState<number>(initialUserTemperature);
  const [userAdvancedParams, setUserAdvancedParams] = useState<GptImageAdvancedParams>(() =>
    getGptImageAdvancedParamsForModel(initialUserModel, {
      quality: savedParams.gptImageQuality,
      style: savedParams.gptImageStyle,
      background: savedParams.gptImageBackground,
      outputFormat: savedParams.gptImageOutputFormat,
    })
  );
  const [userParallelCount, setUserParallelCount] = useState<ParallelCount>(
    normalizeParallelCount(savedParams.parallelCount)
  );
  const [userCustomSize, setUserCustomSize] = useState<string | undefined>(initialUserCustomSize);
  const [customSizeDialogOpen, setCustomSizeDialogOpen] = useState(false);

  const supportsTemperature = getSupportsTemperature(userModel);
  const supportsAdvancedParams = supportsGptImageAdvancedParams(userModel);
  const userSizeOptions = getSizeOptions(userModel);
  const userAspectRatioOptions = getAspectRatioOptions(userModel, userOutputSize);
  const userCurrentResolution = userCustomSize
    || userAspectRatioOptions.find(option => option.value === userAspectRatio)?.resolution
    || '';
  const getUserResolutionForSize = (size: OutputSize) => {
    if (size === 'auto') return t('agentWorkspace.auto');
    return getAspectRatioOptions(userModel, size).find(option => option.value === userAspectRatio)?.resolution || '';
  };

  // 参数变化时自动持久化
  useEffect(() => {
    saveJsonToStorage(AGENT_PARAMS_KEY, {
      model: userModel,
      outputSize: userOutputSize,
      aspectRatio: userAspectRatio,
      temperature: userTemperature,
      gptImageQuality: userAdvancedParams.quality,
      gptImageStyle: userAdvancedParams.style,
      gptImageBackground: userAdvancedParams.background,
      gptImageOutputFormat: userAdvancedParams.outputFormat,
      parallelCount: userParallelCount,
      customSize: userCustomSize,
    });
  }, [userModel, userOutputSize, userAspectRatio, userTemperature, userAdvancedParams, userParallelCount, userCustomSize]);

  // Popover 开关状态（用于选择后自动关闭）
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [sizePopoverOpen, setSizePopoverOpen] = useState(false);
  const [aspectPopoverOpen, setAspectPopoverOpen] = useState(false);
  const [tempPopoverOpen, setTempPopoverOpen] = useState(false);
  const [parallelPopoverOpen, setParallelPopoverOpen] = useState(false);

  const applyUserModel = useCallback((candidateModel: string) => {
    const nextModel = normalizeModel(candidateModel);
    const validSizes = getValidOutputSizes(nextModel);
    const nextOutputSize = validSizes.includes(userOutputSize) ? userOutputSize : validSizes[0];
    const validRatios = getAspectRatioOptions(nextModel, nextOutputSize).map(option => option.value);
    const nextAspectRatio = validRatios.includes(userAspectRatio) ? userAspectRatio : (validRatios[0] || '1:1');
    const nextCustomSize = supportsCustomSize(nextModel) && nextOutputSize !== 'auto'
      ? normalizeCustomImageSize(userCustomSize, getCustomSizeMaxSide(nextModel))
      : undefined;

    setUserModel(nextModel);
    setUserOutputSize(nextOutputSize);
    setUserAspectRatio(nextAspectRatio as AspectRatio);
    setUserCustomSize(nextCustomSize);
    setUserAdvancedParams(prev => getGptImageAdvancedParamsForModel(nextModel, prev));
  }, [userAspectRatio, userCustomSize, userOutputSize]);

  const imageMap = useMemo(() => new Map(agent.images.map(img => [img.imgId, img])), [agent.images]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.messages, agent.streamingText, agent.proposal, agent.phase, agent.generationDraft]);

  const busy = agent.phase !== 'idle';
  const canSend = !busy && !uploading && (hasEditorContent || uploads.length > 0);

  const addPreparedUpload = useCallback((prepared: Awaited<ReturnType<typeof prepareUploadImage>> & Pick<PendingUpload, 'source'>) => {
    const uploadId = prepared.id || generateUUID();
    setUploads(prev => prev.some(u => u.id === uploadId)
      ? prev
      : [...prev, {
          id: uploadId,
          name: prepared.name,
          preview: prepared.preview,
          dataUrl: prepared.dataUrl,
          mimeType: prepared.mimeType,
          badge: getOptimizationBadge(prepared.originalSize, prepared.processedSize, prepared.cacheHit),
          source: prepared.source,
        }]);
  }, []);

  const handleCheckNow = useCallback(async () => {
    if (agent.isSyncing || onCooldown) return;
    setOnCooldown(true);
    const result = await agent.checkNow();
    switch (result) {
      case 'completed':
        showToast(t('agentWorkspace.completedRetrieving'), 'success');
        break;
      case 'processing':
        showToast(t('agentWorkspace.stillGenerating'), 'info');
        break;
      case 'queued':
        showToast(t('agentWorkspace.queued'), 'info');
        break;
      case 'failed':
        showToast(t('agentWorkspace.taskFailed'), 'error');
        break;
      case 'error':
        showToast(t('agentWorkspace.checkFailed'), 'error');
        break;
      default:
        break;
    }
  }, [agent, onCooldown, showToast, t]);

  const handleImportAssets = useCallback(async (selectedAssets: ImageAsset[]) => {
    if (!agent.hasApiKey) {
      setMissingApiKeyDialogOpen(true);
      return;
    }
    if (selectedAssets.length === 0) return;
    setUploading(true);
    try {
      for (const asset of selectedAssets.slice(0, MAX_AGENT_ASSET_IMPORTS)) {
        const blob = await getAssetBlob(asset.id);
        if (!blob) continue;
        const file = new File([blob], asset.name, { type: asset.mimeType || blob.type || 'image/png' });
        const prepared = await prepareUploadImage(file);
        addPreparedUpload({ ...prepared, source: 'asset' });
      }
    } finally {
      setUploading(false);
    }
  }, [addPreparedUpload, agent.hasApiKey]);

  const applyTextAsset = useCallback((asset: TextAsset) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setText(asset.content);
    editor.focus();
    setHasEditorContent(asset.content.trim().length > 0);
    setPendingTextAsset(null);
  }, []);

  const handleTextAssetConfirm = useCallback((asset: TextAsset) => {
    const currentText = editorRef.current?.getText() || '';
    if (currentText.trim() && currentText.trim() !== asset.content.trim()) {
      setPendingTextAsset(asset);
      return;
    }
    applyTextAsset(asset);
  }, [applyTextAsset]);

  const handleSavePromptAsset = useCallback(async () => {
    const text = editorRef.current?.getText() || '';
    if (!text.trim()) return;
    try {
      await addTextAsset({
        content: text,
        sourceKind: 'agent',
        sourceLabel: 'Agent',
      });
      showToast(t('agentProposal.promptAssetSaved'), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('agentProposal.promptAssetSaveFailed'), 'error');
    }
  }, [showToast, t]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!agent.hasApiKey) {
      setMissingApiKeyDialogOpen(true);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > MAX_UPLOAD_SIZE_BYTES) continue;
        const prepared = await prepareUploadImage(file);
        const uploadId = prepared.id || generateUUID();
        setUploads(prev => prev.some(u => u.id === uploadId)
          ? prev
          : [...prev, {
              id: uploadId,
              name: prepared.name,
              preview: prepared.preview,
              dataUrl: prepared.dataUrl,
              mimeType: prepared.mimeType,
              badge: getOptimizationBadge(prepared.originalSize, prepared.processedSize, prepared.cacheHit),
            }]);
      }
    } finally {
      setUploading(false);
    }
  }, [agent.hasApiKey]);

  /** 接受 File[]（来自粘贴事件），复用 handleFiles 的逻辑 */
  const handleFileArray = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (!agent.hasApiKey) {
      setMissingApiKeyDialogOpen(true);
      return;
    }
    setUploading(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > MAX_UPLOAD_SIZE_BYTES) continue;
        const prepared = await prepareUploadImage(file);
        const uploadId = prepared.id || generateUUID();
        setUploads(prev => prev.some(u => u.id === uploadId)
          ? prev
          : [...prev, {
              id: uploadId,
              name: prepared.name,
              preview: prepared.preview,
              dataUrl: prepared.dataUrl,
              mimeType: prepared.mimeType,
              badge: getOptimizationBadge(prepared.originalSize, prepared.processedSize, prepared.cacheHit),
            }]);
      }
    } finally {
      setUploading(false);
    }
  }, [agent.hasApiKey]);

  // Ctrl+V 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (busy || uploading) return;
      const target = e.target as HTMLElement;
      if (!containerRef.current?.contains(target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void handleFileArray(imageFiles);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [busy, uploading, handleFileArray]);

  const handleSend = useCallback(() => {
    if (!agent.hasApiKey) {
      setMissingApiKeyDialogOpen(true);
      return;
    }
    if (!canSend) return;
    const editor = editorRef.current;
    if (!editor) return;
    const text = editor.getText();
    const imageRefs = editor.getImageReferences();
    const currentUploads = uploads;
    editor.clear();
    setHasEditorContent(false);
    setUploads([]);
    void agent.sendMessage(text, currentUploads, imageRefs);
  }, [agent, canSend, uploads]);

  // 编辑器通过内部 onSubmit 回调触发发送
  const handleEditorSubmit = useCallback((text: string, imageRefs: string[]) => {
    if (!agent.hasApiKey) {
      setMissingApiKeyDialogOpen(true);
      return;
    }
    if (!canSend && uploads.length === 0 && text.trim().length === 0) return;
    const currentUploads = uploads;
    const editor = editorRef.current;
    if (editor) editor.clear();
    setHasEditorContent(false);
    setUploads([]);
    void agent.sendMessage(text, currentUploads, imageRefs);
  }, [agent, canSend, uploads]);

  // 提示词优化
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizeOriginalPrompt, setOptimizeOriginalPrompt] = useState('');
  const [optimizedText, setOptimizedText] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const optimizeHandleRef = useRef<StreamPromptOptimizeHandle | null>(null);

  const handleOptimize = () => {
    let textModel;
    try {
      textModel = requireDefaultConfiguredTextModel('promptOptimize');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '请先完成默认文本模型配置', 'error');
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    const text = editor.getText();
    if (!text.trim()) return;

    // 构建上下文参考：取最近 5 条有效对话，附图片描述
    const imageMap = new Map(agent.images.map(img => [img.imgId, img]));
    const recentMessages = agent.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-5);

    let context = '';
    if (recentMessages.length > 0) {
      const lines: string[] = ['--- 对话上下文（供参考） ---'];
      for (const msg of recentMessages) {
        const roleLabel = msg.role === 'user' ? '用户' : '助手';
        let line = `${roleLabel}：${msg.text}`;
        if (msg.imageIds && msg.imageIds.length > 0) {
          const descs: string[] = [];
          for (const imgId of msg.imageIds) {
            const img = imageMap.get(imgId);
            if (img?.description) {
              descs.push(img.description);
            }
          }
          if (descs.length > 0) {
            line += `\n  （关联图片描述：${descs.join('；')}）`;
          }
        }
        lines.push(line);
      }
      context = lines.join('\n');
    }

    optimizeHandleRef.current?.abort();
    setOptimizeOriginalPrompt(text);
    setOptimizedText('');
    setOptimizeError(null);
    setOptimizing(true);
    setOptimizeOpen(true);

    const handle = streamPromptOptimize(
      { apiKey: textModel.apiKey, protocol: textModel.protocol, model: textModel.modelId, mode: 'agent', prompt: text, context: context || undefined },
      {
        onDelta(token) { setOptimizedText(prev => prev + token); },
        onDone() { setOptimizing(false); },
        onError(err) { setOptimizeError(err.message); setOptimizing(false); },
      },
      textModel.baseUrl,
    );
    optimizeHandleRef.current = handle;
  };

  const handleClearDraft = useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.clear();
      setHasEditorContent(false);
    }
    setUploads([]);
  }, []);

  const handleOptimizeCancel = useCallback(() => {
    optimizeHandleRef.current?.abort();
    optimizeHandleRef.current = null;
    setOptimizing(false);
    setOptimizedText('');
    setOptimizeError(null);
  }, []);

  const handleOptimizeAccept = useCallback(() => {
    const editor = editorRef.current;
    if (editor && optimizedText) {
      editor.setText(optimizedText);
      setHasEditorContent(true);
    }
    optimizeHandleRef.current = null;
    setOptimizedText('');
    setOptimizeError(null);
  }, [optimizedText]);

  const phaseHint = phaseLabel(agent.phase, t);

  // 生成计时器
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  const activeGenerationStartedAt = agent.generationDraft?.startedAt ?? agent.generatingStartedAt;
  useEffect(() => {
    if (!activeGenerationStartedAt || !['generating', 'loading', 'describing'].includes(agent.phase)) return;

    const id = window.setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [agent.phase, activeGenerationStartedAt]);

  const elapsedSeconds = activeGenerationStartedAt && ['generating', 'loading', 'describing'].includes(agent.phase)
    ? Math.max(0, Math.floor((elapsedNow - activeGenerationStartedAt) / 1000))
    : 0;

  const lastMessageRole = agent.messages[agent.messages.length - 1]?.role;
  const hasContextToClear = agent.messages.some(m => m.role !== 'context-divider')
    && lastMessageRole !== 'context-divider';
  const canClearContext = !busy && hasContextToClear;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full flex-1 min-h-[400px] flex-col rounded-2xl border border-border bg-card/60',
        wideMode && 'h-full min-h-0 w-full'
      )}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setIsDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-primary" />
          Agent
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1 max-sm:w-full">
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 text-muted-foreground"
            onClick={() => agent.clearContext()}
            disabled={!canClearContext}
            title={t('agentWorkspace.clearContextTitle')}
          >
            <Eraser className="h-3.5 w-3.5" />
            {t('agentWorkspace.clearContext')}
          </Button>
          <AgentImageGallery images={agent.images} onRedescribe={agent.redescribeImage} />
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 text-muted-foreground"
            onClick={() => setClearDialogOpen(true)}
            disabled={agent.messages.length === 0 && agent.images.length === 0}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('agentWorkspace.clearSession')}
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {agent.messages.length === 0 && !agent.streamingText && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t('agentWorkspace.emptyTitle')}</p>
            <p className="text-xs opacity-70">{t('agentWorkspace.emptyDescription')}</p>
          </div>
        )}

        {agent.messages.map(message => (
          <MemoizedAgentMessageBubble
            key={message.id}
            message={message}
            imageMap={imageMap}
            onWithdraw={agent.withdrawTurn}
            onReedit={agent.reeditProposal}
            onCopy={() => {
              navigator.clipboard.writeText(message.text).catch(() => {});
              showToast(t('agentWorkspace.copiedToClipboard'), 'success');
            }}
            onDelete={() => setDeleteConfirmMsgId(message.id)}
            onRollback={() => setRollbackConfirmMsgId(message.id)}
            onRedescribe={agent.redescribeImage}
          />
        ))}

        {(agent.streamingText || agent.streamingReasoning) && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex max-w-[80%] flex-col gap-2">
              {agent.streamingReasoning && (
                <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <div className="mb-1 flex items-center gap-1.5 font-medium">
                    <Brain className="h-3.5 w-3.5" />
                    {t('agentWorkspace.thinking')}
                  </div>
                  <div className="leading-relaxed opacity-90">
                    <div dangerouslySetInnerHTML={{ __html: renderReasoning(agent.streamingReasoning) }} />
                  </div>
                </div>
              )}
              {agent.streamingText && (
                <div
                  className="md-streaming rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm"
                  onClick={(e) => {
                    if (!handleMarkdownCodeCopyButtonClick(e.target)) return;
                    e.preventDefault();
                  }}
                >
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(agent.streamingText) }} />
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-primary/70" />
                </div>
              )}
            </div>
          </div>
        )}

        {agent.proposal && agent.phase === 'proposal' && (
          <AgentProposalCard
            proposal={agent.proposal}
            images={agent.images}
            imageModel={intentRecognition ? agent.imageModel : userModel}
            hideControls={!intentRecognition}
            onModelChange={agent.setImageModel}
            onApprove={(prompt, ids, _model, _params) => {
              if (intentRecognition) {
                void agent.approveProposal(prompt, ids, _model, _params);
              } else {
                void agent.approveProposal(prompt, ids, userModel, {
                  outputSize: userOutputSize,
                  customSize: userCustomSize,
                  aspectRatio: userAspectRatio,
                  temperature: userTemperature,
                  gptImageQuality: userAdvancedParams.quality,
                  gptImageStyle: userAdvancedParams.style,
                  gptImageBackground: userAdvancedParams.background,
                  gptImageOutputFormat: userAdvancedParams.outputFormat,
                  parallelCount: userParallelCount,
                });
              }
            }}
            onCancel={agent.cancelProposal}
          />
        )}

        {agent.generationDraft && agent.phase !== 'proposal' && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex max-w-[80%] flex-col gap-2">
              <AgentGenerationProgress
                analysis={agent.generationDraft.analysis}
                reasoning={agent.generationDraft.reasoning}
                prompt={agent.generationDraft.prompt}
                parallelCount={agent.generationDraft.parallelCount}
                phase={agent.phase}
                elapsedSeconds={elapsedSeconds}
                taskId={agent.generationDraft.taskId || agent.generatingTaskId || undefined}
                isSyncing={agent.isSyncing}
                checkNowDisabled={agent.isSyncing || onCooldown}
                onCheckNow={() => void handleCheckNow()}
                onSkipDescribing={() => agent.skipDescribing()}
              />
            </div>
          </div>
        )}

        {phaseHint && agent.phase !== 'proposal' && !agent.generationDraft && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {phaseHint}
            {agent.phase === 'describing' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkipConfirmOpen(true)}
                className="h-6 gap-1 px-2 text-xs"
                title={t('agentGeneration.skipDescription')}
              >
                <X className="h-3 w-3" />
                {t('agentGeneration.skipDescription')}
              </Button>
            )}
            {agent.phase === 'generating' && (
              <span className="tabular-nums">{t('agentWorkspace.elapsed', { seconds: elapsedSeconds })}</span>
            )}
            {agent.phase === 'generating' && agent.generatingTaskId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCheckNow()}
                disabled={agent.isSyncing || onCooldown}
                className="h-6 gap-1 px-2 text-xs"
                title={onCooldown ? t('agentGeneration.waitBeforeCheck') : t('agentWorkspace.checkNowTitle')}
              >
                {agent.isSyncing
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
                {onCooldown ? t('agentWorkspace.wait') : t('agentGeneration.checkNow')}
              </Button>
            )}
          </div>
        )}
      </div>

      {agent.error && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{agent.error}</span>
          <button onClick={agent.dismissError} className="opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="border-t border-border p-3 pt-2">
        {uploads.length > 0 && (
          <div className="mb-2">
            <AttachmentChips
              files={uploads}
              onRemove={id => setUploads(prev => prev.filter(u => u.id !== id))}
              sourceKind="agent"
              sourceLabel={t('agentWorkspace.uploadedImageSource')}
            />
          </div>
        )}
        <div className={cn(
          'flex items-center gap-2 rounded-xl border bg-background px-2 py-1.5 transition-colors',
          isDragOver ? 'border-primary ring-2 ring-primary/20' : 'border-input'
        )}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => { void handleFiles(e.target.files); e.target.value = ''; }}
          />
          <AgentInputEditor
            ref={editorRef}
            images={agent.images}
            disabled={disabled}
            placeholder={disabled ? t('agentWorkspace.inputDisabled') : t('agentWorkspace.inputPlaceholder')}
            onSubmit={handleEditorSubmit}
            onInputChange={(hasContent) => setHasEditorContent(hasContent)}
          />
          {agent.phase === 'streaming' || agent.phase === 'generating' ? (
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              onClick={() => setStopConfirmOpen(true)}
              title={t('agentWorkspace.stop')}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              {promptOptimizeEnabled && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  onClick={handleOptimize}
                  disabled={!hasEditorContent || disabled || busy}
                  title={t('agentProposal.optimizePrompt')}
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                onClick={handleClearDraft}
                disabled={!hasEditorContent && uploads.length === 0}
              title={t('agentWorkspace.clearInput')}
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                className="shrink-0"
                onClick={handleSend}
                disabled={!canSend || disabled}
              title={t('agentWorkspace.send')}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {/* 第二行：上传、联网、意图识别 + 参数控件 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {/* 上传图片 */}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploading || disabled}
            title={t('agentWorkspace.uploadImage')}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
            <span className="text-xs">{t('agentWorkspace.uploadImage')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={() => {
              if (!agent.hasApiKey) {
                setMissingApiKeyDialogOpen(true);
                return;
              }
              setAssetPickerOpen(true);
            }}
            disabled={busy || uploading || disabled}
            title={t('agentWorkspace.importImageAsset')}
          >
            <ImagePlus className="h-4 w-4" />
            <span className="text-xs">{t('agentWorkspace.imageAssets')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={() => setTextAssetPickerOpen(true)}
            disabled={busy || disabled}
            title={t('agentProposal.importPromptAsset')}
          >
            <FileText className="h-4 w-4" />
            <span className="text-xs">{t('agentWorkspace.promptAssets')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={() => void handleSavePromptAsset()}
            disabled={!hasEditorContent || busy || disabled}
            title={t('agentProposal.savePromptAsset')}
          >
            <Save className="h-4 w-4" />
            <span className="text-xs">{t('agentWorkspace.savePrompt')}</span>
          </Button>

          {/* 联网检索 */}
          <Button
            variant={agent.webSearchEnabled ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'shrink-0 gap-1.5',
              agent.webSearchEnabled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'text-muted-foreground'
            )}
            onClick={() => agent.toggleWebSearch()}
            disabled={busy || disabled}
            title={agent.webSearchEnabled ? t('agentWorkspace.webSearchEnabled') : t('agentWorkspace.webSearch')}
          >
            <Globe className="h-4 w-4" />
            <span className="text-xs">{t('agentWorkspace.webSearch')}</span>
          </Button>

          {/* 意图识别开关 */}
          <Button
            variant="outline"
            size="xs"
            className={cn(
              'gap-1',
              intentRecognition
                ? 'border-primary/50 bg-primary/5 text-primary'
                : 'border-destructive/30 bg-destructive/5 text-destructive'
            )}
            onClick={() => agent.toggleIntentRecognition()}
            title={intentRecognition ? t('agentWorkspace.intentRecognitionEnabled') : t('agentWorkspace.intentRecognitionDisabled')}
          >
            <Brain className="h-3 w-3" />
            {t('agentWorkspace.intentRecognition')}
            <span className={cn(
              'ml-0.5 rounded-full px-1 text-[10px] font-medium',
              intentRecognition ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
            )}>
              {intentRecognition ? 'ON' : 'OFF'}
            </span>
          </Button>

          {/* 参数控件：意图识别关闭时显示 */}
          {!intentRecognition && (
            <>
              <span className="h-5 w-px bg-border/60" />

              {/* 模型选择 */}
              <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                <PopoverTrigger
                  className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
                >
                  <ImagePlus className="h-3 w-3" />
                  <span className="shrink-0 truncate text-[11px]">
                    {MODEL_OPTIONS.find(o => o.value === userModel)?.label || userModel}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  {MODEL_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        applyUserModel(option.value);
                        setModelPopoverOpen(false);
                      }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-muted',
                        userModel === option.value && 'bg-muted font-medium'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              {/* 输出尺寸 */}
              <Popover open={sizePopoverOpen} onOpenChange={setSizePopoverOpen}>
                <PopoverTrigger
                  className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
                  title={`${t('agentWorkspace.outputSize')}${userCurrentResolution ? `: ${userCurrentResolution}` : ''}`}
                >
                  <Maximize className="h-3 w-3" />
                  <span className="text-[11px]">{userCustomSize || getOutputSizeLabel(userOutputSize)}</span>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1" align="start">
                  {userSizeOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (option.disabled) return;
                        const nextSize = option.value;
                        const ratios = getAspectRatioOptions(userModel, nextSize).map(a => a.value);
                        const nextRatio = ratios.includes(userAspectRatio) ? userAspectRatio : (ratios[0] || '1:1');
                        setUserOutputSize(nextSize);
                        if (nextRatio !== userAspectRatio) setUserAspectRatio(nextRatio as AspectRatio);
                        setUserCustomSize(undefined);
                        setSizePopoverOpen(false);
                      }}
                      disabled={option.disabled}
                      title={option.disabledReason}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
                        option.value === userOutputSize && !userCustomSize && 'bg-muted font-medium'
                      )}
                    >
                      <span>{option.label}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {getUserResolutionForSize(option.value)}
                        {option.value === userOutputSize && !userCustomSize && <Check className="h-3.5 w-3.5 text-foreground" />}
                      </span>
                    </button>
                  ))}
                  {supportsCustomSize(userModel) && (
                    <button
                      type="button"
                      onClick={() => { setSizePopoverOpen(false); setCustomSizeDialogOpen(true); }}
                      className={cn(
                        'mt-1 flex w-full items-center gap-1.5 rounded-md border-t px-2.5 py-1.5 text-sm hover:bg-muted',
                        userCustomSize && 'bg-muted font-medium'
                      )}
                    >
                      <Maximize className="h-3.5 w-3.5" />
                      {t('agentWorkspace.customSize', { size: userCustomSize ? ` (${userCustomSize})` : '' })}
                    </button>
                  )}
                </PopoverContent>
              </Popover>

              {/* 纵横比 */}
              <Popover open={aspectPopoverOpen} onOpenChange={setAspectPopoverOpen}>
                <PopoverTrigger
                  className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
                >
                  <RectangleHorizontal className="h-3 w-3" />
                  <span className="text-[11px]">{userAspectRatio}</span>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-1" align="start">
                  <div className="grid grid-cols-2 gap-1">
                    {userAspectRatioOptions
                      .filter(o => o.value !== 'auto')
                      .map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => { setUserAspectRatio(option.value as AspectRatio); setAspectPopoverOpen(false); }}
                        className={cn(
                          'flex flex-col items-start rounded-md px-2 py-1.5 text-sm hover:bg-muted',
                          option.value === userAspectRatio && 'bg-muted font-medium'
                        )}
                      >
                        <span>{option.value}</span>
                        {option.resolution && <span className="text-[10px] text-muted-foreground">{option.resolution}</span>}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* 温度 */}
              {supportsTemperature && (
              <Popover open={tempPopoverOpen} onOpenChange={setTempPopoverOpen}>
                <PopoverTrigger
                  className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
                >
                  <Thermometer className="h-3 w-3" />
                  <span className="text-[11px]">{userTemperature.toFixed(2)}</span>
                </PopoverTrigger>
                <PopoverContent className="w-56" align="start">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">{t('agentWorkspace.temperature')}</label>
                      <span className="text-sm text-muted-foreground">{userTemperature.toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[userTemperature]}
                      onValueChange={value => setUserTemperature(value[0])}
                      min={0}
                      max={2}
                      step={0.01}
                      className="w-full"
                    />
                    <div className="flex justify-between gap-2">
                      <Button variant="outline" size="xs" onClick={() => setUserTemperature(0)} className="flex-1">{t('agentWorkspace.precise')}</Button>
                      <Button variant="outline" size="xs" onClick={() => setUserTemperature(1)} className="flex-1">{t('agentWorkspace.balanced')}</Button>
                      <Button variant="outline" size="xs" onClick={() => setUserTemperature(2)} className="flex-1">{t('agentWorkspace.creative')}</Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              )}

              {supportsAdvancedParams && (
                <GptImageAdvancedParamsControl
                  value={userAdvancedParams}
                  onChange={setUserAdvancedParams}
                  variant="outline"
                  size="xs"
                />
              )}

              {/* 生成数量 */}
              <Popover open={parallelPopoverOpen} onOpenChange={setParallelPopoverOpen}>
                <PopoverTrigger
                  className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
                >
                  <Layers className="h-3 w-3" />
                  <span className="text-[11px]">×{userParallelCount}</span>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  <div className="grid grid-cols-5 gap-1">
                  {PARALLEL_COUNT_OPTIONS.map(count => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => { setUserParallelCount(count); setParallelPopoverOpen(false); }}
                      className={cn(
                        'flex h-8 items-center justify-center rounded-md text-sm hover:bg-muted',
                        count === userParallelCount && 'bg-muted font-medium text-primary'
                      )}
                    >
                      {count}
                    </button>
                  ))}
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      </div>

      <MissingApiKeyDialog
        open={missingApiKeyDialogOpen}
        onOpenChange={setMissingApiKeyDialogOpen}
        onConfigure={() => onConfigureApiKey?.()}
      />

      <AgentAssetPickerDialog
        open={assetPickerOpen}
        maxSelected={MAX_AGENT_ASSET_IMPORTS}
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
          title={t('agentWorkspace.clearPromptTitle')}
          message={t('agentWorkspace.clearPromptMessage')}
          confirmText={t('agentWorkspace.clearPromptAction')}
          variant="default"
          onConfirm={() => applyTextAsset(pendingTextAsset)}
          onCancel={() => setPendingTextAsset(null)}
        />,
        document.body,
      )}

      {clearDialogOpen && createPortal(
        <ConfirmDialog
          title={t('agentWorkspace.clearSessionTitle')}
          message={t('agentWorkspace.clearSessionMessage')}
          confirmText={t('agentWorkspace.clearSessionAction')}
          onConfirm={() => {
            setClearDialogOpen(false);
            void agent.clearSession();
          }}
          onCancel={() => setClearDialogOpen(false)}
        />,
        document.body
      )}

      {stopConfirmOpen && createPortal(
        <ConfirmDialog
          title={t('agentWorkspace.stopTaskTitle')}
          message={agent.phase === 'generating'
            ? t('agentWorkspace.stopTaskGenerating')
            : t('agentWorkspace.stopTaskThinking')}
          confirmText={t('agentWorkspace.stop')}
          onConfirm={() => {
            setStopConfirmOpen(false);
            agent.stopStreaming();
          }}
          onCancel={() => setStopConfirmOpen(false)}
        />,
        document.body
      )}

      {skipConfirmOpen && createPortal(
        <ConfirmDialog
          title={t('agentWorkspace.skipTitle')}
          message={t('agentGeneration.skipConfirm')}
          confirmText={t('agentGeneration.skipDescription')}
          onConfirm={() => {
            setSkipConfirmOpen(false);
            agent.skipDescribing();
          }}
          onCancel={() => setSkipConfirmOpen(false)}
        />,
        document.body
      )}

      {deleteConfirmMsgId && createPortal(
        <ConfirmDialog
          title={t('agentWorkspace.deleteMessageTitle')}
          message={t('agentWorkspace.deleteMessage')}
          confirmText={t('common.delete')}
          onConfirm={() => {
            agent.deleteMessage(deleteConfirmMsgId);
            setDeleteConfirmMsgId(null);
          }}
          onCancel={() => setDeleteConfirmMsgId(null)}
        />,
        document.body
      )}

      {rollbackConfirmMsgId && createPortal(
        <ConfirmDialog
          title={t('agentWorkspace.rollbackMessageTitle')}
          message={t('agentWorkspace.rollbackMessage')}
          confirmText={t('agentMessage.withdraw')}
          onConfirm={() => {
            agent.rollbackMessages(rollbackConfirmMsgId);
            setRollbackConfirmMsgId(null);
          }}
          onCancel={() => setRollbackConfirmMsgId(null)}
        />,
        document.body
      )}

      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}

      <PromptOptimizeDialog
        open={optimizeOpen}
        onOpenChange={setOptimizeOpen}
        originalPrompt={optimizeOriginalPrompt}
        optimizedPrompt={optimizedText}
        loading={optimizing}
        error={optimizeError}
        onAccept={handleOptimizeAccept}
        onCancel={handleOptimizeCancel}
      />

      <CustomSizeDialog
        open={customSizeDialogOpen}
        value={userCustomSize}
        maxSide={getCustomSizeMaxSide(userModel) || 2048}
        onOpenChange={setCustomSizeDialogOpen}
        onApply={size => setUserCustomSize(size)}
      />
    </div>
  );
}
