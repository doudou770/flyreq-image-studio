import { describe, expect, it } from 'vitest';

import { composeEffectiveImagePrompt, getEffectiveImagePrompt } from '@/lib/prompt-variants';

describe('单图实际提示词', () => {
  it('将主提示词和本张附加指令组合为上游实际使用的提示词', () => {
    expect(composeEffectiveImagePrompt('一位骑士', '侧身站立')).toBe('一位骑士\n\n本张图要求：\n侧身站立');
  });

  it('优先使用新版任务持久化的实际提示词，并兼容旧任务字段', () => {
    expect(getEffectiveImagePrompt('一位骑士', ['侧身站立'])).toBe('一位骑士\n\n本张图要求：\n侧身站立');
    expect(getEffectiveImagePrompt('一位骑士', ['侧身站立'], '已保存的完整提示词')).toBe('已保存的完整提示词');
  });
});
