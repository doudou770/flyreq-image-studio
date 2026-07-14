'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ImageGenerationWorkbench } from '@/components/ImageGenerationWorkbench';
import { ReversePromptForm } from '@/components/ReversePromptForm';
import { GifGenerationWorkspace } from '@/components/GifGenerationWorkspace';
import { AgentChatWorkspace } from '@/components/agent/AgentChatWorkspace';
import { AssetsWorkspace } from '@/components/assets/AssetsWorkspace';
import { CanvasWorkspace } from '@/components/canvas/CanvasWorkspace';
import { PromptGallery } from '@/components/PromptGallery';
import { SettingsModal } from '@/components/SettingsModal';
import { MissingApiKeyDialog } from '@/components/MissingApiKeyDialog';
import { useQueueStatus } from '@/hooks/useQueueStatus';
import { useWideMode } from '@/hooks/useWideMode';
import { useServerTaskPolling } from '@/hooks/useServerTaskPolling';
import { useWorkspaceJobs } from '@/hooks/useWorkspaceJobs';
import { WorkspaceHeader, type WorkspaceHeaderRef } from '@/components/workspace/WorkspaceHeader';
import { WorkspaceModeTabs } from '@/components/workspace/WorkspaceModeTabs';
import { HistoryJobList, type GenerationHistoryFilter, type HistoryClearScope } from '@/components/workspace/results/HistoryJobList';
import { PromptGalleryAccessDialog, usePromptGalleryAccess } from '@/components/workspace/PromptGalleryAccess';
import { usePromptGalleryConfig } from '@/hooks/usePromptGalleryConfig';
import { ConfirmDialog } from '@/components/workspace/dialogs/ConfirmDialog';
import { Toast, type ToastData } from '@/components/workspace/Toast';
import { Button, buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useI18n } from '@/components/LanguageProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Shuffle, Settings, User, Wallpaper, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { getFlyreqTask } from '@/lib/flyreq-task-client';
import { finalizeCompletedServerTask, getTaskSseMetadata } from '@/lib/workspace-task-service';
import { classifyTaskFailure } from '@/lib/task-failure';
import type { RefImageData, StoredJob } from '@/lib/job-store';
import { subscribeImageActionToasts, subscribeUseAsImageReference } from '@/lib/image-actions';
import {
  submitImageToImage,
  submitTextToImage,
  type SubmitActions,
} from '@/lib/workspace-task-service';
import { cn } from '@/lib/utils';
import { BA_RANDOM_URL, BING_WALLPAPER_URL } from '@/lib/constants';
import { getCleanUrlAfterExternalModelConfig, parseExternalModelConfig, type ExternalModelConfig } from '@/lib/external-model-config';

export function WorkspaceShell() {
  const { locale, t } = useI18n();
  const queueStatus = useQueueStatus();
  const processingSlots = queueStatus?.processingSlots ?? queueStatus?.processingCount ?? 0;
  const queuedSlots = queueStatus?.queuedSlots ?? queueStatus?.queuedCount ?? 0;
  const pendingSlots = queueStatus?.pendingSlots ?? (
    typeof processingSlots === 'number' && typeof queuedSlots === 'number'
      ? processingSlots + queuedSlots
      : undefined
  );
  const { wideMode, toggleWideMode } = useWideMode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [externalModelConfig, setExternalModelConfig] = useState<ExternalModelConfig | null>(null);
  const [missingApiKeyDialogOpen, setMissingApiKeyDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'image-generation' | 'agent' | 'canvas' | 'assets' | 'reverse-prompt' | 'gif' | 'prompt-gallery'>('agent');
  const [generationHistoryFilter, setGenerationHistoryFilter] = useState<GenerationHistoryFilter>('all');
  const [generationClearScope, setGenerationClearScope] = useState<HistoryClearScope | null>(null);
  const [referenceDraft, setReferenceDraft] = useState<{ id: number; refImages: RefImageData[]; prompt?: string } | null>(null);
  const workspace = useWorkspaceJobs();
  const galleryConfig = usePromptGalleryConfig();
  const promptGallery = usePromptGalleryAccess(galleryConfig.mode, galleryConfig.passwordEnabled, setError, () => setActiveTab('prompt-gallery'), locale);

  // Toast state
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const toastIdRef = useRef(0);
  const headerRef = useRef<WorkspaceHeaderRef>(null);
  const referenceDraftIdRef = useRef(0);
  const externalConfigParsedRef = useRef(false);

  const showToast = useCallback((message: string, type: ToastData['type']) => {
    const id = `toast-${++toastIdRef.current}`;
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => subscribeImageActionToasts(detail => showToast(detail.message, detail.type)), [showToast]);

  useEffect(() => {
    if (externalConfigParsedRef.current) return;

    const url = new URL(window.location.href);
    const config = parseExternalModelConfig(url);
    if (!config) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      externalConfigParsedRef.current = true;
      setExternalModelConfig(config);
      setSettingsOpen(true);
      window.history.replaceState(null, '', getCleanUrlAfterExternalModelConfig(url));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => subscribeUseAsImageReference(detail => {
    workspace.setRetryData(null);
    setReferenceDraft({ id: ++referenceDraftIdRef.current, refImages: detail.refImages, prompt: detail.prompt });
    setActiveTab('image-generation');
  }), [workspace]);

  const handleImageDraftConsumed = useCallback(() => {
    workspace.setRetryData(null);
    setReferenceDraft(null);
  }, [workspace]);

  // Checking debounce state
  const [checkingJobIds, setCheckingJobIds] = useState<Set<string>>(new Set());
  // Cooldown state: jobId -> cooldown end timestamp
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(new Map());

  const submitActions = useMemo<SubmitActions>(() => ({
    addJob: workspace.addJob,
    replaceJob: workspace.replaceJob,
    completeJob: workspace.completeJob,
    failJob: workspace.failJob,
    getJob: workspace.getJob,
  }), [workspace.addJob, workspace.completeJob, workspace.failJob, workspace.replaceJob, workspace.getJob]);

  useServerTaskPolling(workspace.jobs, submitActions, workspace.hasJob);

  const handleSubmitError = useCallback((message: string) => {
    if (message === '请先配置 API 密钥' || message === 'Please configure an API key first') {
      setError(null);
      setMissingApiKeyDialogOpen(true);
      return;
    }
    showToast(message, 'error');
  }, [showToast]);

  const handleCheckStatus = useCallback(async (job: StoredJob) => {
    if (!job.serverTaskId || checkingJobIds.has(job.id) || cooldowns.has(job.id)) return;
    setCheckingJobIds(prev => new Set(prev).add(job.id));
    // Set 5s cooldown
    setCooldowns(prev => new Map(prev).set(job.id, Date.now() + 5000));
    try {
      const task = await getFlyreqTask(job.serverTaskId);
      if (task.status === 'completed') {
        showToast(locale === 'zh' ? '生成完成，正在下载图片…' : 'Generation complete. Downloading images...', 'success');
        await finalizeCompletedServerTask(job, task, submitActions);
      } else if (task.status === 'failed' || task.status === 'expired') {
        const { terminal } = classifyTaskFailure(task);
        const message = task.error || task.warning
          || (task.status === 'expired' ? (locale === 'zh' ? '该任务已超出取回时间' : 'This task has expired') : t('history.failed'));
        void submitActions.failJob(job.id, message, { terminal, completedAt: task.completedAt, ...getTaskSseMetadata(task) });
        showToast(locale === 'zh' ? `任务失败：${message}` : `Task failed: ${message}`, 'error');
      } else if (task.status === 'processing') {
        submitActions.replaceJob(job.id, cur => ({
          ...cur,
          ...getTaskSseMetadata(task),
          status: 'processing',
          created_at: task.createdAt || cur.created_at,
        }));
        showToast(locale === 'zh' ? '任务正在生成中，请稍候…' : 'The task is still generating. Please wait...', 'info');
      } else if (task.status === 'queued' || task.status === '排队中') {
        submitActions.replaceJob(job.id, cur => ({ ...cur, status: '排队中', created_at: task.createdAt || cur.created_at }));
        showToast(locale === 'zh' ? '任务排队中，请耐心等待…' : 'The task is queued. Please wait...', 'info');
      }
    } catch {
      showToast(locale === 'zh' ? '查询失败，请稍后重试' : 'Status check failed. Please try again later.', 'error');
    } finally {
      setCheckingJobIds(prev => { const next = new Set(prev); next.delete(job.id); return next; });
      // Cleanup cooldown after 5s
      setTimeout(() => {
        setCooldowns(prev => {
          const next = new Map(prev);
          next.delete(job.id);
          return next;
        });
      }, 5000);
    }
  }, [checkingJobIds, cooldowns, locale, submitActions, showToast, t]);

  const generationInitialData = useMemo(() => (
    workspace.retryData
      ? {
        prompt: workspace.retryData.prompt,
        outputSize: workspace.retryData.outputSize,
        customSize: workspace.retryData.customSize,
        aspectRatio: workspace.retryData.aspectRatio,
        temperature: workspace.retryData.temperature,
        model: workspace.retryData.model,
        gptImageQuality: workspace.retryData.gptImageQuality,
        gptImageStyle: workspace.retryData.gptImageStyle,
        gptImageBackground: workspace.retryData.gptImageBackground,
        gptImageOutputFormat: workspace.retryData.gptImageOutputFormat,
        parallelCount: workspace.retryData.parallelCount,
        promptVariants: workspace.retryData.promptVariants,
        refImages: workspace.retryData.refImages,
      }
      : undefined
  ), [workspace.retryData]);

  const generationJobs = useMemo(
    () => [...workspace.textJobs, ...workspace.imageJobs].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [workspace.imageJobs, workspace.textJobs]
  );
  const filteredGenerationJobs = useMemo(
    () => generationHistoryFilter === 'all'
      ? generationJobs
      : generationJobs.filter(job => job.mode === generationHistoryFilter),
    [generationHistoryFilter, generationJobs]
  );
  const generationEmptyDescription = generationHistoryFilter === 'text-to-image'
    ? t('history.emptyTextToImage')
    : generationHistoryFilter === 'image-to-image'
      ? t('history.emptyImageToImage')
      : t('history.emptyGenerationAll');
  const clearScopeLabel = generationClearScope === 'all'
    ? `${t('history.filterTextToImage')} / ${t('history.filterImageToImage')}`
    : generationClearScope === 'text-to-image'
      ? t('history.filterTextToImage')
      : generationClearScope === 'image-to-image'
        ? t('history.filterImageToImage')
        : locale === 'zh' ? '当前模式' : 'current mode';

  const handleConfirmClearGeneration = useCallback(() => {
    if (!generationClearScope) return;
    const scope = generationClearScope;
    setGenerationClearScope(null);
    if (scope === 'all') {
      void Promise.all([
        workspace.clearJobsByMode('text-to-image'),
        workspace.clearJobsByMode('image-to-image'),
      ]);
      return;
    }
    if (scope === 'text-to-image' || scope === 'image-to-image') {
      void workspace.clearJobsByMode(scope);
    }
  }, [generationClearScope, workspace]);

  return (
    <div
      className={cn(
        'mx-auto flex min-h-screen w-full flex-col gap-4 overflow-x-hidden px-3 py-3 transition-[max-width] duration-200 sm:gap-5 sm:px-6 sm:py-5 lg:px-8',
        wideMode ? 'max-w-none xl:h-dvh xl:min-h-0 xl:gap-3 xl:py-3 xl:overflow-hidden' : 'max-w-5xl',
        !wideMode && activeTab === 'agent' && 'h-dvh min-h-0 overflow-hidden'
      )}
    >
      <div className={cn(
        'flex-1 bg-transparent shadow-none sm:rounded-3xl sm:bg-card/95 sm:shadow-sm sm:border sm:border-border/70',
        wideMode && 'flex min-h-0 flex-col',
        !wideMode && activeTab === 'agent' && 'flex min-h-0 flex-col'
      )}>
        <div className={cn(
          'p-0 sm:p-5',
          wideMode
            ? 'flex h-full flex-1 flex-col min-h-0 sm:p-3'
            : activeTab === 'agent'
              ? 'flex h-full flex-1 flex-col min-h-0 gap-4'
              : 'space-y-4'
        )}>
          <WorkspaceHeader
            ref={headerRef}
            queueStatus={queueStatus}
            wideMode={wideMode}
            onToggleWideMode={toggleWideMode}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogoClick={promptGallery.handlePromptGalleryEntry}
            sidebarMode={wideMode}
          />

          <Tabs
            value={activeTab}
            onValueChange={value => setActiveTab(value as typeof activeTab)}
            orientation={wideMode ? 'vertical' : 'horizontal'}
            className={cn(
              wideMode
                ? 'gap-4 xl:flex-row xl:flex-1 xl:min-h-0'
                : activeTab === 'agent'
                  ? 'gap-2 flex flex-col flex-1 min-h-0'
                  : 'gap-2'
            )}
          >
            <div className={cn('flex flex-col', wideMode && 'self-stretch sticky top-4 h-full xl:shrink-0')}>
              {wideMode && (
                <button
                  type="button"
                  onClick={promptGallery.handlePromptGalleryEntry}
                  className="flex items-center gap-2 px-2 pt-3 pb-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="FlyReq Image logo"
                >
                  <img
                    src="/favicon.png"
                    alt="FlyReq Image"
                    className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-border/60"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold tracking-tight leading-tight">FlyReq Image</h2>
                    <p className="truncate text-[11px] text-muted-foreground leading-tight">{t('app.subtitle')}</p>
                  </div>
                </button>
              )}
              <div className={cn(wideMode ? 'flex flex-col py-4 flex-1' : 'flex flex-col py-1')}>
                <WorkspaceModeTabs wideMode={wideMode} showPromptGallery={promptGallery.showPromptGallery} />
              </div>

              {wideMode && (
                <div className="hidden flex-col gap-1 xl:flex xl:min-h-0">
                  <div className="flex flex-col gap-1">
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full justify-start gap-2 rounded-xl px-3 text-xs')}
                        title={t('toolbar.randomImage')}
                        aria-label={t('toolbar.randomImage')}
                      >
                        <Shuffle className="size-4 shrink-0" />
                        {t('toolbar.randomImage')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" sideOffset={4}>
                        <DropdownMenuItem onClick={() => headerRef.current?.openRandomImage(BA_RANDOM_URL, t('toolbar.baPeople'))}>
                          <User className="w-4 h-4" />
                          {t('toolbar.baPeople')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => headerRef.current?.openRandomImage(BING_WALLPAPER_URL, t('toolbar.bingWallpaper'))}>
                          <Wallpaper className="w-4 h-4" />
                          {t('toolbar.bingWallpaper')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-col gap-1">
                    <Button variant="outline" size="sm" className="w-full justify-start gap-2 rounded-xl px-3 text-xs" onClick={toggleWideMode}>
                      {wideMode ? <PanelLeftClose className="size-4 shrink-0" /> : <PanelLeftOpen className="size-4 shrink-0" />}
                      {wideMode ? t('toolbar.exitWideMode') : t('toolbar.wideMode')}
                    </Button>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="h-px bg-border" />
                    {queueStatus ? (
                      <div className="flex flex-col gap-1">
                        <span className="rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
                          {t('queue.concurrency', { count: processingSlots })}
                        </span>
                        <span className={cn(
                          'rounded-full px-3 py-1 text-center text-xs',
                          typeof pendingSlots === 'number' && typeof queueStatus.maxQueueSize === 'number' && pendingSlots >= queueStatus.maxQueueSize
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          {typeof pendingSlots === 'number' && typeof queueStatus.maxQueueSize === 'number'
                            ? t('queue.capacity', { count: pendingSlots, max: queueStatus.maxQueueSize })
                            : t('queue.queued', { count: queuedSlots })}
                        </span>
                        <span className="rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
                          {t('queue.status', { status: queueStatus.acceptingNewTasks ? t('queue.statusOpen') : t('queue.statusClosed') })}
                        </span>
                        {queueStatus.serverMessage && (
                          <span className="rounded-xl bg-destructive/10 px-3 py-1 text-center text-xs text-destructive">
                            {queueStatus.serverMessage}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-center text-xs text-muted-foreground">{t('queue.unknown')}</span>
                    )}
                  </div>
                  <div className="mt-auto flex flex-col gap-1 pt-3">
                    <div className="h-px bg-border" />
                    <div className="grid grid-cols-3 gap-0.5 rounded-xl border border-border bg-background p-0.5 shadow-sm dark:border-input dark:bg-input/20">
                      <ThemeToggle iconOnly />
                      <LanguageToggle iconOnly />
                      <Button variant="ghost" size="icon-sm" className="w-full rounded-lg" onClick={() => setSettingsOpen(true)} title={t('common.settings')} aria-label={t('common.settings')}>
                        <Settings className="size-4 shrink-0" />
                      </Button>
                    </div>
                  </div>
                </div>)}
            </div>

            <div className={cn(
              wideMode && 'xl:flex xl:flex-1 xl:min-h-0 xl:min-w-0',
              wideMode && (activeTab === 'image-generation' || activeTab === 'agent'
                ? 'xl:overflow-hidden'
                : 'xl:overflow-y-auto xl:overflow-x-hidden'),
              !wideMode && activeTab === 'agent' && 'flex flex-1 flex-col min-h-0'
            )}>
              <TabsContent value="image-generation" keepMounted className={cn(wideMode ? 'space-y-6 xl:flex xl:min-h-0 xl:space-y-0' : 'space-y-3')}>
                <div className={cn(wideMode ? 'grid items-start gap-5 xl:h-full xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(460px,0.95fr)_minmax(0,1.35fr)] xl:items-stretch' : 'space-y-3')}>
                  <div className={cn(wideMode && 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1')}>
                    <ImageGenerationWorkbench
                      wideMode={wideMode}
                      onSubmitText={data => void submitTextToImage(data, submitActions, handleSubmitError)}
                      onSubmitImage={data => void submitImageToImage(data, submitActions, handleSubmitError)}
                      disabled={!workspace.hasApiKey}
                      onConfigureApiKey={() => setSettingsOpen(true)}
                      onDraftConsumed={handleImageDraftConsumed}
                      initialData={generationInitialData}
                      referenceDraft={referenceDraft}
                    />
                  </div>
                  <HistoryJobList
                    wideMode={wideMode}
                    active={activeTab === 'image-generation'}
                    title={t('history.generationTitle')}
                    mode="text-to-image"
                    historyFilter={generationHistoryFilter}
                    onHistoryFilterChange={setGenerationHistoryFilter}
                    hasAnyJobs={generationJobs.length > 0}
                    emptyDescription={generationEmptyDescription}
                    jobs={filteredGenerationJobs}
                    loadedImages={workspace.loadedImages}
                    checkingJobIds={checkingJobIds}
                    cooldowns={cooldowns}
                    onRetry={job => {
                      workspace.retryJob(job);
                      setActiveTab('image-generation');
                    }}
                    onRetryDownload={workspace.retryDownload}
                    onClear={jobId => void workspace.removeJob(jobId)}
                    onClearAll={scope => setGenerationClearScope(scope)}
                    onCancel={jobId => workspace.setCancelJobId(jobId)}
                    onCheckStatus={handleCheckStatus}
                  />
                </div>
              </TabsContent>

              <TabsContent
                value="agent"
                keepMounted
                className={cn('flex-1 flex flex-col min-h-0', wideMode && 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col')}
              >
                <AgentChatWorkspace
                  wideMode={wideMode}
                  disabled={false}
                  onConfigureApiKey={() => setSettingsOpen(true)}
                />
              </TabsContent>

              <TabsContent value="canvas" keepMounted className={cn('min-h-0', wideMode ? 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col' : 'space-y-6')}>
                <CanvasWorkspace
                  wideMode={wideMode}
                  onConfigureApiKey={() => setSettingsOpen(true)}
                  onEnableWideMode={() => { if (!wideMode) toggleWideMode(); }}
                  showToast={showToast}
                  showPromptGallery={promptGallery.showPromptGallery}
                />
              </TabsContent>

              <TabsContent value="assets" keepMounted className={cn(wideMode ? 'space-y-6 xl:min-h-0 xl:min-w-0 xl:flex xl:flex-col' : 'space-y-6')}>
                <AssetsWorkspace wideMode={wideMode} active={activeTab === 'assets'} />
              </TabsContent>

              <TabsContent value="reverse-prompt" keepMounted className={cn(wideMode ? 'space-y-6 xl:min-h-0 xl:flex xl:flex-col' : 'space-y-6')}>
                <ReversePromptForm
                  wideMode={wideMode}
                  disabled={false}
                  onConfigureApiKey={() => setSettingsOpen(true)}
                />
              </TabsContent>

              <TabsContent value="gif" keepMounted className={cn(wideMode ? 'space-y-6 xl:min-h-0 xl:flex xl:flex-col' : 'space-y-6')}>
                <GifGenerationWorkspace
                  wideMode={wideMode}
                  hasApiKey={workspace.hasApiKey}
                  onConfigureApiKey={() => setSettingsOpen(true)}
                  onError={message => showToast(message, 'error')}
                  showToast={showToast}
                />
              </TabsContent>

              {promptGallery.showPromptGallery && (
                <TabsContent value="prompt-gallery" keepMounted>
                  <div className={cn('bg-transparent p-0 shadow-none sm:rounded-2xl sm:bg-card sm:p-4 sm:shadow-sm sm:border sm:border-border', wideMode && 'sm:p-5')}>
                    <PromptGallery wideMode={wideMode} />
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>
        </div>
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onApiKeyChange={workspace.setHasApiKey}
        externalModelConfig={externalModelConfig}
        onExternalModelConfigConsumed={() => setExternalModelConfig(null)}
      />

      <MissingApiKeyDialog
        open={missingApiKeyDialogOpen}
        onOpenChange={setMissingApiKeyDialogOpen}
        onConfigure={() => setSettingsOpen(true)}
      />

      <PromptGalleryAccessDialog
        open={promptGallery.passwordDialogOpen}
        passwordInput={promptGallery.passwordInput}
        onPasswordChange={promptGallery.setPasswordInput}
        onClose={() => promptGallery.setPasswordDialogOpen(false)}
        onSubmit={() => void promptGallery.handlePasswordSubmit()}
        locale={locale}
      />

      {workspace.cancelJobId && createPortal(
        <ConfirmDialog
          title={locale === 'zh' ? '取消生成任务' : 'Cancel generation task'}
          message={
            <>
              {locale === 'zh' ? '取消后会删除本地任务记录并停止前端等待流程。' : 'Cancelling will delete the local task record and stop the frontend waiting flow.'}
              <span className="mt-1 block text-warning">
                {locale === 'zh' ? '如果任务已进入服务端队列，可能仍会继续执行。' : 'If the task already entered the server queue, it may still continue running.'}
              </span>
            </>
          }
          confirmText={locale === 'zh' ? '取消并删除' : 'Cancel and delete'}
          onConfirm={() => {
            const jobId = workspace.cancelJobId;
            workspace.setCancelJobId(null);
            if (jobId) {
              void workspace.removeJob(jobId);
            }
          }}
          onCancel={() => workspace.setCancelJobId(null)}
        />,
        document.body
      )}

      {generationClearScope && createPortal(
        <ConfirmDialog
          title={locale === 'zh' ? '清空记录' : 'Clear records'}
          message={locale === 'zh' ? `确定要清空${clearScopeLabel}历史记录吗？此操作无法撤销。` : `Clear ${clearScopeLabel} history records? This cannot be undone.`}
          confirmText={locale === 'zh' ? '清空' : 'Clear'}
          onConfirm={handleConfirmClearGeneration}
          onCancel={() => setGenerationClearScope(null)}
        />,
        document.body
      )}

      {error && createPortal(
        <div className="fixed bottom-4 right-4 z-[10000] max-w-sm rounded-xl border border-destructive/20 bg-card px-4 py-3 text-sm text-destructive shadow-lg">
          {error}
        </div>,
        document.body
      )}

      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
