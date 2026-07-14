import { describe, expect, it } from 'vitest';

import {
  GPT_IMAGE_QUALITY_OPTIONS,
  getGptImageResolution,
  getAspectRatioOptions,
  getCompatibleRetryData,
  getOutputSizeLabel,
  getSupportsTemperature,
  getSizeOptions,
  getValidOutputSizes,
  isRetryLayoutCompatible,
  supportsCustomSize,
  supportsGptImageAdvancedParams,
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

  it('exposes Grok Imagine native layouts without GPT Image-only controls', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [{
        id: 'grok-imagine-quality',
        protocol: 'openai',
        name: 'Grok Imagine Quality',
        modelId: 'grok-imagine-image-quality',
        apiKey: 'test-key',
        baseUrl: 'https://api.x.ai',
        builtinPreset: 'grok-imagine-image-quality',
        maxRefImages: 1,
        maxOutputSize: '2K',
        supportsAdvancedParams: false,
      }],
      textModels: [],
      defaults: { textToImage: 'grok-imagine-quality', imageToImage: 'grok-imagine-quality' },
    }));

    expect(getValidOutputSizes('grok-imagine-quality')).toEqual(['1K', '2K']);
    expect(getSizeOptions('grok-imagine-quality')).toEqual([
      { value: '1K', label: '1k', disabled: false, disabledReason: undefined },
      { value: '2K', label: '2k', disabled: false, disabledReason: undefined },
    ]);
    expect(getAspectRatioOptions('grok-imagine-quality', '1K').map(option => option.value)).toContain('19.5:9');
    expect(getAspectRatioOptions('grok-imagine-quality', '1K').map(option => option.value)).toContain('auto');
    expect(supportsGptImageAdvancedParams('grok-imagine-quality')).toBe(false);
    expect(supportsCustomSize('grok-imagine-quality')).toBe(false);
  });

  it('limits Banana 2 Lite to 1K while preserving all fourteen reference slots', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [{
        id: 'banana-lite', protocol: 'google', name: 'Banana 2 Lite',
        modelId: 'gemini-3.1-flash-lite-image', apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        builtinPreset: 'gemini-3.1-flash-lite-image', maxRefImages: 14,
        maxOutputSize: '1K', supportsAdvancedParams: false,
      }], textModels: [], defaults: { textToImage: 'banana-lite', imageToImage: 'banana-lite' },
    }));

    expect(getValidOutputSizes('banana-lite')).toEqual(['1K']);
    expect(getAspectRatioOptions('banana-lite', '1K')).toHaveLength(14);
    expect(isRetryLayoutCompatible('banana-lite', '1K', '16:9')).toBe(true);
    expect(isRetryLayoutCompatible('banana-lite', '2K', '16:9')).toBe(false);
  });

  it('only enables temperature when the configured image model explicitly supports it', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [
        {
          id: 'temperature-enabled', protocol: 'google', name: 'Temperature Enabled',
          modelId: 'gemini-3.1-flash-image-preview', apiKey: 'test-key',
          baseUrl: 'https://generativelanguage.googleapis.com',
          builtinPreset: 'gemini-3.1-flash-image-preview', maxRefImages: 14,
          maxOutputSize: '4K', supportsAdvancedParams: false, supportsTemperature: true,
        },
        {
          id: 'temperature-disabled', protocol: 'google', name: 'Temperature Disabled',
          modelId: 'custom-image-model', apiKey: 'test-key',
          baseUrl: 'https://generativelanguage.googleapis.com',
          builtinPreset: 'gemini-3.1-flash-image-preview', maxRefImages: 1,
          maxOutputSize: '1K', supportsAdvancedParams: false,
        },
      ],
      textModels: [],
      defaults: { textToImage: 'temperature-disabled', imageToImage: 'temperature-disabled' },
    }));

    expect(getSupportsTemperature('temperature-enabled')).toBe(true);
    expect(getSupportsTemperature('temperature-disabled')).toBe(false);
  });

  it('retries a split child task as one image with its complete effective prompt', () => {
    localStorage.setItem('flyreq-model-registry', JSON.stringify({
      imageModels: [{
        id: 'retry-model', protocol: 'openai', name: 'Retry Model', modelId: 'gpt-image-2',
        apiKey: 'test-key', baseUrl: 'https://api.openai.com', builtinPreset: 'gpt-image-2',
        maxRefImages: 1, maxOutputSize: '1K', supportsAdvancedParams: false,
      }],
      textModels: [],
      defaults: { textToImage: 'retry-model', imageToImage: 'retry-model' },
    }));

    const retry = getCompatibleRetryData({
      id: 'child-job', status: 'completed', mode: 'text-to-image',
      prompt: '主提示词', originalPrompt: '主提示词', promptVariants: ['本张附加提示词'],
      effectivePrompt: '主提示词\n\n本张图要求：\n本张附加提示词',
      output_size: '1K', temperature: 1, aspect_ratio: '1:1', model: 'retry-model', created_at: '2026-07-14T00:00:00.000Z',
    });

    expect(retry.prompt).toBe('主提示词\n\n本张图要求：\n本张附加提示词');
    expect(retry.parallelCount).toBe(1);
    expect(retry.promptVariants).toBeUndefined();
  });
});
