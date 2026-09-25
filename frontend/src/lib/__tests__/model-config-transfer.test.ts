import { describe, expect, it } from 'vitest';
import {
  appendImportedModelConfig,
  exportModelConfigText,
  importModelConfigText,
} from '@/lib/model-config-transfer';
import type { FlyreqModelRegistry } from '@/lib/flyreq-models';

/** 构造模型配置传输测试使用的最小注册表。 */
function createRegistry(): FlyreqModelRegistry {
  return {
    schemaVersion: 2,
    imageModels: [{
      id: 'image-current', protocol: 'openai', name: '当前图片', modelId: 'image-a', apiKey: 'key-a', baseUrl: 'https://image.example', builtinPreset: 'gpt-image-2', maxRefImages: 4, maxOutputSize: '1K', supportsAdvancedParams: true,
    }],
    videoModels: [],
    textModels: [],
    defaults: { textToImage: 'image-current', imageToImage: 'image-current', reversePrompt: '', agent: '', promptOptimize: '', imageDescribe: '', videoGeneration: '' },
  };
}

describe('model config transfer', () => {
  it('压缩并恢复完整模型配置', () => {
    const registry = createRegistry();
    const encoded = exportModelConfigText(registry);
    expect(encoded.startsWith('FISCFG2.')).toBe(true);
    expect(encoded.length).toBeLessThan(JSON.stringify(registry).length);
    expect(importModelConfigText(encoded)).toMatchObject({ i: registry.imageModels, d: registry.defaults });
  });

  it('直接追加模型并重映射默认模型 ID', () => {
    const current = createRegistry();
    const imported = importModelConfigText(exportModelConfigText({
      ...current,
      imageModels: [{ ...current.imageModels[0], id: 'image-imported' }],
      defaults: { ...current.defaults, textToImage: 'image-imported', imageToImage: 'image-imported' },
    }));
    const merged = appendImportedModelConfig(current, imported);
    expect(merged.imageModels).toHaveLength(2);
    expect(merged.imageModels[1].id).not.toBe('image-imported');
    expect(merged.defaults.textToImage).toBe(merged.imageModels[1].id);
    expect(merged.imageModels[0].id).toBe('image-current');
  });

  it('拒绝没有版本前缀的文本', () => {
    expect(() => importModelConfigText('{"i":[]}')).toThrow('请输入有效的模型配置文本');
  });
});
