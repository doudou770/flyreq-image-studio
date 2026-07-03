import type { StoredJob } from '@/lib/job-store';

export function parseJobTime(value?: string): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

export function getJobDurationSeconds(job: Pick<StoredJob, 'created_at' | 'completed_at'>, now = Date.now()): number | undefined {
  const startedAt = parseJobTime(job.created_at);
  if (startedAt === undefined) return undefined;
  const finishedAt = parseJobTime(job.completed_at) ?? now;
  return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds > 0 ? `${minutes} 分 ${restSeconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
}

export function formatJobDateTime(value?: string): string {
  const time = parseJobTime(value);
  if (time === undefined) return '';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(time));
}
