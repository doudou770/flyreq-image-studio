import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_IMAGE_PRESETS,
  applyBuiltinImagePresetModelIds,
} from '@/lib/builtin-image-presets';

describe('图片内置模板模型 ID 映射', () => {
  afterEach(() => {
    applyBuiltinImagePresetModelIds();
  });

  it('应用当前环境变量映射，并在映射移除后恢复默认模型 ID', () => {
    expect(BUILTIN_IMAGE_PRESETS['gpt-image-2'].modelId).toBe('gpt-image-2');

    applyBuiltinImagePresetModelIds({ 'gpt-image-2': 'deployment-gpt-image' });
    expect(BUILTIN_IMAGE_PRESETS['gpt-image-2'].modelId).toBe('deployment-gpt-image');

    applyBuiltinImagePresetModelIds();
    expect(BUILTIN_IMAGE_PRESETS['gpt-image-2'].modelId).toBe('gpt-image-2');
  });
});
