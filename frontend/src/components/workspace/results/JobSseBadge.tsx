import { Badge } from '@/components/ui/badge';
import type { StoredJob } from '@/lib/job-store';

/**
 * 根据服务端确认的 SSE 响应统计渲染任务传输标签。
 * @param job 已包含 SSE 响应数量和请求总数的本地任务。
 * @returns 未确认 SSE 时返回 null；否则返回完整或部分命中的 SSE 标签。
 */
export function JobSseBadge({ job }: { job: StoredJob }) {
  const responses = job.sseResponses;
  const requests = job.sseRequests;
  if (!responses || !requests) return null;

  const partial = responses < requests;
  const label = partial ? `SSE ${responses}/${requests}` : 'SSE';
  const title = partial
    ? `上游 ${responses}/${requests} 个请求实际返回 SSE`
    : '上游实际返回 SSE';

  return (
    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 py-0 text-[10px] font-medium" title={title}>
      {label}
    </Badge>
  );
}
