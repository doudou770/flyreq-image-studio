import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canEnablePromptOptimize,
  hasAnyApiKey,
  hasConfiguredImageModel,
  hasConfiguredTextModel,
  isPromptOptimizeEnabled,
  setPromptOptimizeEnabled,
} from '@/lib/settings-storage';
import { BUILTIN_IMAGE_PRESETS, getResolvedImageModelId, loadRegistry } from '@/lib/flyreq-models';
import { resolveImageTaskProvider } from '@/lib/flyreq-task-client';

const storage = new Map<string, string>();

function writeRegistry(registry: unknown) {
  storage.set('flyreq-model-registry', JSON.stringify(registry));
}

describe('settings-storage model availability', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
    });
  });

  afterEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it('unlocks image workflows with only a complete image model', () => {
    writeRegistry({
      imageModels: [{
        id: 'img-1',
        protocol: 'openai',
        name: 'Image',
        modelId: 'gpt-image-2',
        apiKey: 'key',
        baseUrl: 'https://api.openai.com',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 16,
        maxOutputSize: '4K',
        supportsAdvancedParams: true,
      }],
      textModels: [],
      defaults: { textToImage: 'img-1', imageToImage: 'img-1' },
    });

    expect(hasConfiguredImageModel()).toBe(true);
    expect(hasConfiguredTextModel()).toBe(false);
    expect(hasAnyApiKey()).toBe(true);
  });

  it('does not treat incomplete text-only config as image workflow availability', () => {
    writeRegistry({
      imageModels: [],
      textModels: [{
        id: 'txt-1',
        protocol: 'openai',
        name: 'Text',
        modelId: 'gpt-5.4-mini',
        apiKey: 'key',
        baseUrl: 'https://api.openai.com',
      }],
      defaults: { agent: 'txt-1' },
    });

    expect(hasConfiguredImageModel()).toBe(false);
    expect(hasConfiguredTextModel()).toBe(true);
    expect(hasAnyApiKey()).toBe(true);
  });

  it('keeps prompt optimize disabled by default', () => {
    expect(isPromptOptimizeEnabled()).toBe(false);
  });

  it('ships a default FlyReq image model without unlocking image workflows before the key is filled', () => {
    const registry = loadRegistry();
    expect(registry.imageModels[0]).toMatchObject({
      protocol: 'openai',
      name: 'FlyReq',
      modelId: '',
      usesPresetModelId: true,
      apiKey: '',
      baseUrl: 'https://flyreq.com',
      builtinPreset: 'gpt-image-2',
      maxRefImages: 16,
      maxOutputSize: '4K',
    });
    expect(getResolvedImageModelId(registry.imageModels[0])).toBe('gpt-image-2');
    expect(hasConfiguredImageModel()).toBe(false);
  });

  it('uses gpt-image-2 when a GPT Image 2 configuration leaves its model ID blank', () => {
    writeRegistry({
      imageModels: [{
        id: 'img-gpt-image-2',
        protocol: 'openai',
        name: 'GPT Image 2',
        modelId: '  ',
        apiKey: 'key',
        baseUrl: 'https://api.openai.com',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 16,
        maxOutputSize: '4K',
        supportsAdvancedParams: true,
      }],
      textModels: [],
      defaults: { textToImage: 'img-gpt-image-2', imageToImage: 'img-gpt-image-2' },
    });

    const [model] = loadRegistry().imageModels;
    expect(model).toMatchObject({ modelId: '', usesPresetModelId: true });
    expect(getResolvedImageModelId(model)).toBe('gpt-image-2');
    expect(resolveImageTaskProvider('img-gpt-image-2').modelId).toBe('gpt-image-2');
    expect(hasConfiguredImageModel()).toBe(true);
  });

  it('uses every built-in preset model ID when its configured model ID is blank', () => {
    const imageModels = Object.values(BUILTIN_IMAGE_PRESETS).map((preset) => ({
      id: `img-${preset.id}`, protocol: preset.protocol, name: preset.name, modelId: '',
      apiKey: 'key', baseUrl: preset.baseUrl, builtinPreset: preset.id,
      maxRefImages: preset.maxRefImages, maxOutputSize: preset.maxOutputSize,
      supportsAdvancedParams: preset.supportsAdvancedParams,
    }));
    writeRegistry({
      imageModels,
      textModels: [],
      defaults: { textToImage: imageModels[0].id, imageToImage: imageModels[0].id },
    });

    const registry = loadRegistry();
    for (const preset of Object.values(BUILTIN_IMAGE_PRESETS)) {
      const model = registry.imageModels.find((item) => item.builtinPreset === preset.id);
      expect(model).toMatchObject({ modelId: '', usesPresetModelId: true });
      expect(getResolvedImageModelId(model!)).toBe(preset.modelId);
      expect(resolveImageTaskProvider(`img-${preset.id}`).modelId).toBe(preset.modelId);
    }
    expect(hasConfiguredImageModel()).toBe(true);
  });

  it('does not turn a legacy OpenAI configuration without a preset into GPT Image 2', () => {
    writeRegistry({
      imageModels: [{
        id: 'img-legacy-openai',
        protocol: 'openai',
        name: 'Legacy OpenAI',
        modelId: '',
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
        maxRefImages: 1,
        maxOutputSize: '1K',
        supportsAdvancedParams: false,
      }],
      textModels: [],
      defaults: { textToImage: 'img-legacy-openai', imageToImage: 'img-legacy-openai' },
    });

    const [model] = loadRegistry().imageModels;
    expect(getResolvedImageModelId(model)).toBe('');
    expect(hasConfiguredImageModel()).toBe(false);
  });

  it('normalizes legacy Grok configurations to its immutable API contract', () => {
    writeRegistry({
      imageModels: [{
        id: 'img-legacy-grok',
        protocol: 'google',
        name: 'Grok Imagine',
        modelId: 'grok-imagine-image',
        apiKey: 'key',
        baseUrl: 'https://api.x.ai',
        maxRefImages: 4,
        maxOutputSize: '4K',
        supportsAdvancedParams: true,
        streamImages: true,
      }],
      textModels: [],
      defaults: { textToImage: 'img-legacy-grok', imageToImage: 'img-legacy-grok' },
    });

    expect(loadRegistry().imageModels[0]).toMatchObject({
      protocol: 'openai',
      builtinPreset: 'grok-imagine-image',
      maxRefImages: 1,
      maxOutputSize: '2K',
      supportsAdvancedParams: false,
      streamImages: false,
    });
  });

  it('blocks prompt optimize when no complete text model exists', () => {
    writeRegistry({
      imageModels: [],
      textModels: [],
      defaults: {},
    });

    expect(canEnablePromptOptimize()).toBe(false);
    expect(setPromptOptimizeEnabled(true)).toBe(false);
    expect(isPromptOptimizeEnabled()).toBe(false);
  });

  it('allows prompt optimize when a complete text model exists', () => {
    writeRegistry({
      imageModels: [],
      textModels: [{
        id: 'txt-1',
        protocol: 'openai',
        name: 'Text',
        modelId: 'gpt-5.4-mini',
        apiKey: 'key',
        baseUrl: 'https://api.openai.com',
      }],
      defaults: { promptOptimize: 'txt-1' },
    });

    expect(canEnablePromptOptimize()).toBe(true);
    expect(setPromptOptimizeEnabled(true)).toBe(true);
    expect(isPromptOptimizeEnabled()).toBe(true);
  });
});
