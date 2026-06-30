import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canEnablePromptOptimize,
  hasAnyApiKey,
  hasConfiguredImageModel,
  hasConfiguredTextModel,
  isPromptOptimizeEnabled,
  setPromptOptimizeEnabled,
} from '@/lib/settings-storage';
import { loadRegistry } from '@/lib/nova-models';

const storage = new Map<string, string>();

function writeRegistry(registry: unknown) {
  storage.set('nova-model-registry', JSON.stringify(registry));
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
      modelId: 'gpt-image-2',
      apiKey: '',
      baseUrl: 'https://flyreq.com',
      builtinPreset: 'gpt-image-2',
      maxRefImages: 16,
      maxOutputSize: '4K',
    });
    expect(hasConfiguredImageModel()).toBe(false);
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
