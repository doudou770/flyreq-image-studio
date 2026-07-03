import { useEffect, useRef } from 'react';
import { flyreqTaskSocket } from '@/lib/flyreq-task-socket';
import { finalizeCompletedServerTask, type SubmitActions } from '@/lib/workspace-task-service';
import type { StoredJob } from '@/lib/job-store';
import { classifyTaskFailure } from '@/lib/task-failure';
import type { FlyreqTaskResponse } from '@/lib/flyreq-task-client';

function isWaitingJob(job: StoredJob): boolean {
  return job.status === 'processing' || job.status === 'queued' || job.status === '排队中';
}

/**
 * 用 WebSocket 替代原有的 HTTP 轮询：
 * - 每个等待中的 serverTaskId 走 flyreqTaskSocket.subscribeTask
 * - 收到 processing → replaceJob 改状态
 * - 收到 completed → finalizeCompletedServerTask
 * - 收到 failed/expired → failJob，并根据 classifyTaskFailure 标记 terminal
 * - jobs 变化时新增/取消订阅；卸载时全部取消
 *
 * 不再有 visibilitychange 主动 abort/restart 逻辑（旧版有 race，会重复轮询或卡死）。
 * socket 自身负责重连、心跳、HTTP 兜底，详见 flyreq-task-socket.ts。
 */
export function useServerTaskPolling(
  jobs: StoredJob[],
  actions: SubmitActions,
  hasJob: (jobId: string) => boolean,
) {
  const mountedRef = useRef(false);
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map());
  const actionsRef = useRef(actions);
  const hasJobRef = useRef(hasJob);

  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { hasJobRef.current = hasJob; }, [hasJob]);

  useEffect(() => {
    mountedRef.current = true;
    const subscriptions = subscriptionsRef.current;
    return () => {
      mountedRef.current = false;
      for (const unsubscribe of subscriptions.values()) {
        try { unsubscribe(); } catch { /* ignore */ }
      }
      subscriptions.clear();
    };
  }, []);

  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    const activeTaskIds = new Set<string>();

    for (const job of jobs) {
      if (!isWaitingJob(job) || !job.serverTaskId) continue;
      activeTaskIds.add(job.serverTaskId);
      if (subscriptions.has(job.serverTaskId)) continue;

      const jobId = job.id;
      const taskId = job.serverTaskId;
      const handler = (task: FlyreqTaskResponse) => {
        if (!mountedRef.current) return;
        if (!hasJobRef.current(jobId)) return;
        const actions = actionsRef.current;
        // 取最新 job 快照，避免使用订阅时捕获的过期闭包覆盖较新状态。
        const currentJob = actions.getJob?.(jobId) ?? job;

        if (task.status === 'completed') {
          // 幂等：重连重订阅或 HTTP 兜底可能重复投递 completed；已完成且已 ack 则跳过，
          // 避免重复下载图片与重复 ack。
          if (currentJob.status === 'completed' && currentJob.serverTaskAcked) return;
          // finalizeCompletedServerTask 会在内部完成图片入库 + ack；
          // .catch 兜底下载阶段可能抛出的未处理 rejection。
          void finalizeCompletedServerTask(currentJob, task, actions).catch(() => { /* 已落库 */ });
          return;
        }
        if (task.status === 'failed' || task.status === 'expired') {
          const { terminal } = classifyTaskFailure(task);
          const message = task.error || task.warning
            || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败');
          void actions.failJob(jobId, message, { terminal, completedAt: task.completedAt });
          return;
        }
        if (task.status === 'processing') {
          actions.replaceJob(jobId, current => ({ ...current, status: 'processing', created_at: task.createdAt || current.created_at }));
          return;
        }
        if (task.status === 'queued' || task.status === '排队中') {
          actions.replaceJob(jobId, current => ({ ...current, status: '排队中', created_at: task.createdAt || current.created_at }));
        }
      };
      const unsubscribe = flyreqTaskSocket.subscribeTask(taskId, handler);
      subscriptions.set(taskId, unsubscribe);
    }

    // 任务从等待状态消失（已完成/已删除）→ 取消订阅
    for (const [taskId, unsubscribe] of subscriptions) {
      if (!activeTaskIds.has(taskId)) {
        try { unsubscribe(); } catch { /* ignore */ }
        subscriptions.delete(taskId);
      }
    }
  }, [jobs]);

  return subscriptionsRef;
}
