import { describe, expect, it } from 'vitest';

import {
  GPT_IMAGE_QUALITY_OPTIONS,
  getGptImageResolution,
  getOutputSizeLabel,
  getSizeOptions,
  getValidOutputSizes,
} from '@/lib/model-capabilities';

describe('model capabilities', () => {
  it('keeps GPT Image quality labels separate from resolution labels', () => {
    expect(GPT_IMAGE_QUALITY_OPTIONS).toEqual([
      { value: 'auto', label: '自动' },
      { value: 'high', label: '高' },
      { value: 'medium', label: '中' },
      { value: 'low', label: '低' },
    ]);
  });

  it('displays output size labels as compact resolution tiers', () => {
    expect(getOutputSizeLabel('1K')).toBe('1k');
    expect(getOutputSizeLabel('2K')).toBe('2k');
    expect(getOutputSizeLabel('4K')).toBe('4k');
  });

  it('keeps GPT Image generated sizes inside OpenAI documented limits', () => {
    expect(getGptImageResolution('1K', '1:1')).toBe('1024x1024');
    expect(getGptImageResolution('2K', '1:1')).toBe('2048x2048');
    expect(getGptImageResolution('4K', '16:9')).toBe('3840x2160');
    expect(getGptImageResolution('4K', '1:1')).toBe('2880x2880');
  });

  it('marks output sizes above the configured model maximum as disabled', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [{
        id: 'limited-gpt-image',
        protocol: 'openai',
        name: 'Limited GPT Image',
        modelId: 'gpt-image-2',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 16,
        maxOutputSize: '2K',
        supportsAdvancedParams: true,
      }],
      textModels: [],
      defaults: { textToImage: 'limited-gpt-image', imageToImage: 'limited-gpt-image' },
    }));

    expect(getValidOutputSizes('limited-gpt-image')).toEqual(['auto', '1K', '2K']);
    expect(getSizeOptions('limited-gpt-image')).toEqual([
      { value: '1K', label: '1k', disabled: false, disabledReason: undefined },
      { value: '2K', label: '2k', disabled: false, disabledReason: undefined },
      {
        value: '4K',
        label: '4k',
        disabled: true,
        disabledReason: '当前模型最大分辨率为 2k，不支持 4k',
      },
    ]);
  });
});
