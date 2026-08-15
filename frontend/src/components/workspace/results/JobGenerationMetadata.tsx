'use client';

import { memo, type ReactNode } from 'react';
import { Thermometer } from 'lucide-react';
import { useI18n } from '@/components/LanguageProvider';
import { getImageModelById, getResolvedImageModelId, loadRegistry } from '@/lib/flyreq-models';
import type { StoredJob } from '@/lib/job-store';
import { getModelDisplayName, getOutputSizeLabel, getSupportsTemperature } from '@/lib/model-capabilities';

interface JobModelInfo {
  channelName: string;
  remoteModelId: string;
}

/**
 * 获取任务的渠道和远端模型信息；旧任务缺少字段或渠道已迁移时回退到当前默认渠道。
 * @param job 需要读取模型信息的生图任务。
 * @returns 渠道显示名和远端模型 ID；无法解析的字段返回空字符串。
 */
function getJobModelInfo(job: StoredJob): JobModelInfo {
  const registry = loadRegistry();
  const channel = getImageModelById(registry, job.model)
    || getImageModelById(registry, registry.defaults.textToImage);
  const savedModelId = String(job.remoteModelId || '').trim();
  return {
    channelName: channel?.name || getModelDisplayName(job.model),
    remoteModelId: savedModelId || (channel ? getResolvedImageModelId(channel) : ''),
  };
}

interface JobGenerationMetadataProps {
  job: StoredJob;
  trailing?: ReactNode;
}

/**
 * 展示任务的渠道、远端模型和生成规格。
 * @param props 任务数据及可选的附加规格节点。
 * @returns 响应式任务规格信息行。
 */
export const JobGenerationMetadata = memo(function JobGenerationMetadata({ job, trailing }: JobGenerationMetadataProps) {
  const { t } = useI18n();
  const { channelName, remoteModelId: configuredRemoteModelId } = getJobModelInfo(job);
  const remoteModelId = configuredRemoteModelId || t('common.notConfigured');
  const outputSizeLabel = job.custom_size || getOutputSizeLabel(job.output_size);
  const supportsTemperature = getSupportsTemperature(job.model);

  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span className="break-words">{t('workbench.channel')}: {channelName}</span>
      <span>·</span>
      <span className="break-all">{t('workbench.model')}: {remoteModelId}</span>
      <span>·</span>
      <span>{outputSizeLabel}</span>
      {job.aspect_ratio !== 'auto' && <><span>·</span><span>{job.aspect_ratio}</span></>}
      {supportsTemperature && <><span>·</span><Thermometer className="size-3" /><span>{job.temperature?.toFixed(2) ?? 1}</span></>}
      {trailing}
    </p>
  );
});
