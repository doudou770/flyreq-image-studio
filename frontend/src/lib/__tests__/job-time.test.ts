import { describe, expect, it } from 'vitest';

import { formatDuration, getJobDurationSeconds } from '@/lib/job-time';

describe('job time helpers', () => {
  it('calculates duration from created_at and completed_at', () => {
    expect(getJobDurationSeconds({
      created_at: '2026-07-03T10:00:00.000Z',
      completed_at: '2026-07-03T10:00:18.400Z',
    })).toBe(18);
  });

  it('formats short and long durations', () => {
    expect(formatDuration(18)).toBe('18 秒');
    expect(formatDuration(125)).toBe('2 分 5 秒');
    expect(formatDuration(7200)).toBe('2 小时');
  });
});
