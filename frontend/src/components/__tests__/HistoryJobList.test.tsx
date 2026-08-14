import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { HistoryJobList } from '@/components/workspace/results/HistoryJobList';
import type { StoredJob } from '@/lib/job-store';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 200,
    getVirtualItems: () => [{ index: 0, lane: 0, start: 0 }],
    measureElement: () => undefined,
  }),
}));

/**
 * 创建用于任务卡片交互测试的基础图片任务。
 * @param status 当前任务状态。
 * @returns 包含 2K、16:9 和实际提示词的测试任务。
 */
function createJob(status: StoredJob['status']): StoredJob {
  return {
    id: `${status}-job`,
    status,
    mode: 'text-to-image',
    prompt: '画一座山',
    effectivePrompt: '画一座山\n\n使用日落光线',
    output_size: '2K',
    aspect_ratio: '16:9',
    temperature: 1,
    model: 'gpt-image-2',
    created_at: '2026-08-14T00:00:00.000Z',
    ...(status === 'failed' ? { error: '上游服务错误' } : {}),
  };
}

/**
 * 渲染单个生图历史任务，复用生产环境中的国际化与操作回调。
 * @param job 需要展示的任务。
 * @param onRetry 用户点击重试后的回调。
 * @returns 测试库的渲染结果。
 */
function renderHistoryJob(job: StoredJob, onRetry = vi.fn()) {
  return render(
    <LanguageProvider initialLocale="zh">
      <HistoryJobList
        active
        title="生成记录"
        mode="text-to-image"
        jobs={[job]}
        loadedImages={new Set()}
        checkingJobIds={new Set()}
        cooldowns={new Map()}
        onRetry={onRetry}
        onClear={vi.fn()}
        onClearAll={vi.fn()}
        onCancel={vi.fn()}
        onCheckStatus={vi.fn()}
      />
    </LanguageProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HistoryJobList 非完成任务操作', () => {
  it('进行中的任务展示生成规格，并能复制实际提示词和带参重试', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onRetry = vi.fn();
    const job = createJob('processing');

    renderHistoryJob(job, onRetry);

    expect(screen.getByText('2k')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Copy the effective prompt'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('画一座山\n\n使用日落光线'));

    fireEvent.click(screen.getByTitle('Retry with this effective prompt'));
    expect(onRetry).toHaveBeenCalledWith(job);
  });

  it('失败任务展示生成规格，并保留复制提示词和重试操作', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onRetry = vi.fn();
    const job = createJob('failed');

    renderHistoryJob(job, onRetry);

    expect(screen.getByText('2k')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Copy the effective prompt'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('画一座山\n\n使用日落光线'));

    fireEvent.click(screen.getByTitle('Retry with this effective prompt'));
    expect(onRetry).toHaveBeenCalledWith(job);
  });
});
