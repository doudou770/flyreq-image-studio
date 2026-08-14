'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Copy, Loader2, RefreshCw, RotateCcw, Thermometer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getBatchImageMarker, getStoredJobDisplayPrompt, type Mode, type StoredJob } from '@/lib/job-store';
import { cn } from '@/lib/utils';
import { formatDuration, formatJobDateTime, getJobDurationSeconds } from '@/lib/job-time';
import { getModelDisplayName, getOutputSizeLabel, getSupportsTemperature } from '@/lib/model-capabilities';
import { getEffectiveImagePrompt } from '@/lib/prompt-variants';
import { CompletedJobCard } from '@/components/workspace/results/CompletedJobCard';
import { JobSseBadge } from '@/components/workspace/results/JobSseBadge';
import { useI18n } from '@/components/LanguageProvider';
import { dispatchImageActionToast } from '@/lib/image-actions';

export type GenerationHistoryFilter = 'all' | 'text-to-image' | 'image-to-image';
export type HistoryClearScope = GenerationHistoryFilter;

const historyFilterOptions: { value: GenerationHistoryFilter; labelKey: 'history.filterAll' | 'history.filterTextToImage' | 'history.filterImageToImage' }[] = [
  { value: 'all', labelKey: 'history.filterAll' },
  { value: 'text-to-image', labelKey: 'history.filterTextToImage' },
  { value: 'image-to-image', labelKey: 'history.filterImageToImage' },
];

function isWaitingJob(job: StoredJob): boolean {
  return job.status === 'processing' || job.status === 'queued' || job.status === '排队中';
}

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

/**
 * 复制任务实际发送给上游的完整提示词。
 * @param job 需要复制提示词的图片任务。
 * @param messages 复制成功、浏览器不支持和复制失败时的提示文本。
 * @returns 复制成功返回 true，浏览器不支持或复制失败时返回 false。
 */
async function copyJobEffectivePrompt(
  job: StoredJob,
  messages: { success: string; unsupported: string; failed: string },
): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error(messages.unsupported);
    await navigator.clipboard.writeText(getEffectiveImagePrompt(job.prompt, job.promptVariants, job.effectivePrompt));
    dispatchImageActionToast(messages.success, 'success');
    return true;
  } catch (error) {
    dispatchImageActionToast(error instanceof Error ? error.message : messages.failed, 'error');
    return false;
  }
}

/**
 * 展示等待或失败任务的已选生成规格，保持与完成任务的模型、档位和比例信息一致。
 * @param props 任务数据。
 * @param props.job 需要展示生成规格的图片任务。
 * @returns 任务规格信息行。
 */
const JobGenerationMetadata = memo(function JobGenerationMetadata({ job }: { job: StoredJob }) {
  const outputSizeLabel = job.custom_size || getOutputSizeLabel(job.output_size);
  const supportsTemperature = getSupportsTemperature(job.model);

  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>{getModelDisplayName(job.model)}</span>
      <span>·</span>
      <span>{outputSizeLabel}</span>
      {job.aspect_ratio !== 'auto' && <><span>·</span><span className="rounded border border-border bg-muted px-1.5 py-0.5 text-sm font-medium leading-none text-foreground">{job.aspect_ratio}</span></>}
      {supportsTemperature && <><span>·</span><Thermometer className="w-3 h-3" /><span>{job.temperature?.toFixed(2) ?? 1}</span></>}
    </p>
  );
});

/**
 * 为非完成任务提供复制实际提示词的图标按钮，并在成功后短暂显示完成状态。
 * @param props 任务数据。
 * @param props.job 需要复制提示词的图片任务。
 * @returns 可复制任务实际提示词的按钮。
 */
const JobPromptCopyButton = memo(function JobPromptCopyButton({ job }: { job: StoredJob }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  /**
   * 复制当前任务的实际提示词并更新按钮的成功状态。
   * @returns 无返回值；复制失败时由共享提示条展示原因。
   */
  const handleCopy = async (): Promise<void> => {
    if (!await copyJobEffectivePrompt(job, {
      success: t('task.promptCopied'),
      unsupported: t('task.copyPromptUnsupported'),
      failed: t('task.copyPromptFailed'),
    })) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void handleCopy()}
      title={t('task.copyPrompt')}
      aria-label={t('task.copyPrompt')}
    >
      {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
});

const WaitingJobCard = memo(function WaitingJobCard({
  job,
  now,
  isChecking,
  cooldownEnd,
  onCancel,
  onCheckStatus,
  onRetry,
}: {
  job: StoredJob;
  now: number;
  isChecking: boolean;
  cooldownEnd: number | undefined;
  onCancel: (jobId: string) => void;
  onCheckStatus: (job: StoredJob) => void;
  onRetry: (job: StoredJob) => void;
}) {
  const { t } = useI18n();
  const parallelCount = job.parallelCount || 1;
  const statusText = job.status === 'queued' || job.status === '排队中'
    ? t('history.waitQueued')
    : job.mode === 'text-to-image'
      ? (parallelCount > 1 ? t('history.waitGeneratingMany', { count: parallelCount }) : t('history.waitGenerating'))
      : (parallelCount > 1 ? t('history.waitConvertingMany', { count: parallelCount }) : t('history.waitConverting'));
  const elapsedSeconds = getJobDurationSeconds(job, now) ?? 0;
  const requestedAtLabel = formatJobDateTime(job.created_at);
  const batchImageIndex = job.batchId && typeof job.batchIndex === 'number' ? job.batchIndex + 1 : null;
  const displayedPrompt = getStoredJobDisplayPrompt(job);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {batchImageIndex && <span className="shrink-0 text-sm font-medium text-primary" title={t('task.batchImage', { index: batchImageIndex })} aria-label={t('task.batchImage', { index: batchImageIndex })}>{getBatchImageMarker(batchImageIndex)}</span>}
            <p className="min-w-0 flex-1 truncate text-base text-foreground">&quot;{displayedPrompt}&quot;</p>
            <JobSseBadge job={job} />
            <JobPromptCopyButton job={job} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{statusText}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('history.elapsed', { seconds: elapsedSeconds, model: getModelDisplayName(job.model) })}
          </p>
          <JobGenerationMetadata job={job} />
          {requestedAtLabel && (
            <p className="mt-0.5 text-xs text-muted-foreground">{t('task.requestedAt', { time: requestedAtLabel })}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-border pt-2">
          {job.serverTaskId && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCheckStatus(job)}
              disabled={isChecking || (cooldownEnd !== undefined && now < cooldownEnd)}
              title={t('history.checkProgress')}
              className="sm:size-7"
            >
              {isChecking
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRetry(job)}
            title={t('task.retryWithPrompt')}
            className="text-muted-foreground hover:text-primary sm:size-7"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCancel(job.id)}
            title={t('common.cancel')}
            className="text-muted-foreground hover:text-destructive sm:size-7"
          >
            <X className="w-4 h-4" />
          </Button>
      </div>
    </div>
  );
});

function JobsHeader({
  title,
  jobsList,
  hasAnyJobs,
  filter,
  onFilterChange,
  onClearAll,
}: {
  title: string;
  jobsList: StoredJob[];
  hasAnyJobs: boolean;
  filter?: GenerationHistoryFilter;
  onFilterChange?: (filter: GenerationHistoryFilter) => void;
  onClearAll: () => void;
}) {
  const { t } = useI18n();
  if (!hasAnyJobs) return null;

  const completed = jobsList.filter(job => job.status === 'completed').length;
  const queued = jobsList.filter(job => job.status === 'queued' || job.status === '排队中').length;
  const processing = jobsList.filter(job => job.status === 'processing').length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">
          {t('history.summary', { total: jobsList.length, completed, processing, queued })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filter && onFilterChange && (
          <div className="flex rounded-lg border border-border bg-background p-0.5">
            {historyFilterOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => onFilterChange(option.value)}
                className={cn(
                  'h-6 rounded-md px-2 text-xs transition-colors',
                  filter === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" onClick={onClearAll} disabled={jobsList.length === 0}>
          {t('history.clearRecords')}
        </Button>
      </div>
    </div>
  );
}

function useColumnCount(
  ref: React.RefObject<HTMLDivElement | null>,
  wideMode: boolean,
  ready: boolean,
  singleColumn: boolean,
) {
  const [columns, setColumns] = useState(() => (singleColumn ? 1 : (wideMode && ready ? 2 : 1)));

  useEffect(() => {
    if (singleColumn || !wideMode || !ready) {
      queueMicrotask(() => setColumns(1));
      return;
    }
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const width = el.clientWidth;
      setColumns(width >= 1080 ? 3 : width >= 680 ? 2 : 1);
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, singleColumn, wideMode, ready]);

  return singleColumn || !wideMode ? 1 : columns;
}

function VirtualJobList({
  jobs,
  active,
  wideMode,
  singleColumn,
  renderJobCard,
}: {
  jobs: StoredJob[];
  active: boolean;
  wideMode: boolean;
  singleColumn: boolean;
  renderJobCard: (job: StoredJob) => React.ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldRender = active && jobs.length > 0;
  const columns = useColumnCount(parentRef, wideMode, shouldRender, singleColumn);
  const gutter = 16;

  const virtualizer = useVirtualizer({
    count: active ? jobs.length : 0,
    getItemKey: index => jobs[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
    lanes: columns,
  });

  if (!shouldRender) return null;

  return (
    <div
      ref={parentRef}
      className={cn('relative virtual-scroll-container', wideMode && 'min-h-0 flex-1')}
      style={{
        height: wideMode ? undefined : (jobs.length > 3 ? '70vh' : 'auto'),
        maxHeight: wideMode ? undefined : '70vh',
        minHeight: jobs.length > 0 ? '200px' : '0',
        overflow: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const lane = columns > 1 ? virtualRow.lane : 0;
          return (
            <div
              key={jobs[virtualRow.index].id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0"
              style={{
                left: `${(100 / columns) * lane}%`,
                width: `${100 / columns}%`,
                paddingLeft: columns > 1 ? gutter / 2 : 0,
                paddingRight: columns > 1 ? gutter / 2 : 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="mb-4">
                {renderJobCard(jobs[virtualRow.index])}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface HistoryJobListProps {
  active: boolean;
  wideMode?: boolean;
  singleColumn?: boolean;
  largeThumbnail?: boolean;
  title: string;
  mode: Mode;
  historyFilter?: GenerationHistoryFilter;
  hasAnyJobs?: boolean;
  emptyDescription?: string;
  jobs: StoredJob[];
  loadedImages: Set<string>;
  checkingJobIds: Set<string>;
  cooldowns: Map<string, number>;
  onRetry: (job: StoredJob) => void;
  onRetryDownload?: (job: StoredJob) => void | Promise<void>;
  onClear: (jobId: string) => void;
  onClearAll: (scope: HistoryClearScope) => void;
  onHistoryFilterChange?: (filter: GenerationHistoryFilter) => void;
  onCancel: (jobId: string) => void;
  onCheckStatus: (job: StoredJob) => void;
}

export function HistoryJobList({
  active,
  wideMode = false,
  singleColumn = false,
  largeThumbnail = false,
  title,
  mode,
  historyFilter,
  hasAnyJobs,
  emptyDescription,
  jobs,
  loadedImages,
  checkingJobIds,
  cooldowns,
  onRetry,
  onRetryDownload,
  onClear,
  onClearAll,
  onHistoryFilterChange,
  onCancel,
  onCheckStatus,
}: HistoryJobListProps) {
  const { t } = useI18n();
  const hasActiveTimers = useMemo(() => active && jobs.some(job => isWaitingJob(job)), [active, jobs]);
  const now = useNow(hasActiveTimers);
  const clearScope: HistoryClearScope = historyFilter || (mode === 'image-to-image' ? 'image-to-image' : 'text-to-image');

  const renderJobCard = (job: StoredJob) => {
    const hasImage = job.status === 'completed' && (job.images || job.imageData) && loadedImages.has(job.id);
    if (isWaitingJob(job)) {
      return <WaitingJobCard job={job} now={now} isChecking={checkingJobIds.has(job.id)} cooldownEnd={cooldowns.get(job.id)} onCancel={onCancel} onCheckStatus={onCheckStatus} onRetry={onRetry} />;
    }
    if (hasImage) {
      return <CompletedJobCard job={job} largeThumbnail={largeThumbnail} onClear={() => onClear(job.id)} onRetry={onRetry} onRetryDownload={onRetryDownload} />;
    }
    if (job.status === 'failed') {
      // terminal=true → 后端明确判定不可恢复，不显示"查看进度"
      // 其他情况（默认 / 网络错误 / 未分类）都允许"查看进度"，让用户兜底
      const allowCheckStatus = !job.terminal && !!job.serverTaskId;
      const requestedAtLabel = formatJobDateTime(job.created_at);
      const durationLabel = formatDuration(getJobDurationSeconds(job));
      const batchImageIndex = job.batchId && typeof job.batchIndex === 'number' ? job.batchIndex + 1 : null;
      const displayedPrompt = getStoredJobDisplayPrompt(job);
      return (
        <div className="rounded-xl border border-destructive/20 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 space-y-1">
              {batchImageIndex && <span className="inline-flex text-sm font-medium text-primary" title={t('task.batchImage', { index: batchImageIndex })} aria-label={t('task.batchImage', { index: batchImageIndex })}>{getBatchImageMarker(batchImageIndex)}</span>}
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate text-base text-foreground">&quot;{displayedPrompt}&quot;</p>
                <JobPromptCopyButton job={job} />
              </div>
              <p className="max-h-20 overflow-y-auto text-sm text-destructive">{job.error || t('history.failed')}</p>
              <JobGenerationMetadata job={job} />
              {(requestedAtLabel || durationLabel) && (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  {requestedAtLabel && <span>{t('task.requestedAt', { time: requestedAtLabel })}</span>}
                  {requestedAtLabel && durationLabel && <span>·</span>}
                  {durationLabel && <span>{t('task.duration', { time: durationLabel })}</span>}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-border pt-2">
              {allowCheckStatus && (
                <Button variant="ghost" size="icon" className="sm:size-7" onClick={() => onCheckStatus(job)} disabled={checkingJobIds.has(job.id) || (cooldowns.get(job.id) !== undefined && now < cooldowns.get(job.id)!)} title={t('history.checkProgress')}>
                  {checkingJobIds.has(job.id)
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <RefreshCw className="w-4 h-4" />}
                </Button>
              )}
              <Button variant="ghost" size="icon" className="sm:size-7" onClick={() => onRetry(job)} title={t('task.retryWithPrompt')}>
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="sm:size-7" onClick={() => onClear(job.id)} title={t('common.delete')}>
                <X className="w-4 h-4" />
              </Button>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <section className={cn(wideMode ? 'flex h-full min-h-0 flex-col space-y-4' : 'space-y-3')}>
      <JobsHeader
        title={title}
        jobsList={jobs}
        hasAnyJobs={hasAnyJobs ?? jobs.length > 0}
        filter={historyFilter}
        onFilterChange={onHistoryFilterChange}
        onClearAll={() => onClearAll(clearScope)}
      />
      {active && jobs.length === 0 ? (
        <div className={cn(
          'flex flex-col items-center justify-center text-center text-muted-foreground',
          wideMode ? 'flex-1 py-16' : 'py-6'
        )}>
          <p className="text-sm">{t('history.noRecords')}</p>
          <p className="mt-1 text-xs opacity-70">
            {emptyDescription || (mode === 'text-to-image' ? t('history.emptyTextToImage') : t('history.emptyImageToImage'))}
          </p>
        </div>
      ) : (
        <VirtualJobList jobs={jobs} active={active} wideMode={wideMode} singleColumn={singleColumn} renderJobCard={renderJobCard} />
      )}
    </section>
  );
}
