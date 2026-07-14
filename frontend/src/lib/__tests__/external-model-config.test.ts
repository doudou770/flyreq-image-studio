import { describe, expect, it } from 'vitest';
import {
  getCleanUrlAfterExternalModelConfig,
  getExternalImageModelMatch,
  parseExternalModelConfig,
} from '@/lib/external-model-config';
import type { ImageModelConfig } from '@/lib/flyreq-models';

describe('external model config URL parser', () => {
  it('parses image model config from a single provider JSON parameter', () => {
    const provider = encodeURIComponent(JSON.stringify({
      type: 'image',
      preset: 'gpt-image-2',
      provider: 'openai',
      modelKey: 'flyreq-gpt-image-2',
      name: 'FlyReq',
      modelId: 'gpt-image-2',
      baseUrl: 'https://flyreq.com',
      apiKey: 'json-key',
      maxRefImages: 16,
      maxOutputSize: '4K',
    }));
    const url = new URL(`https://example.com/zh/?provider=${provider}`);

    expect(parseExternalModelConfig(url)).toMatchObject({
      type: 'image',
      preset: 'gpt-image-2',
      protocol: 'openai',
      modelKey: 'flyreq-gpt-image-2',
      name: 'FlyReq',
      modelId: 'gpt-image-2',
      baseUrl: 'https://flyreq.com',
      apiKey: 'json-key',
      maxRefImages: 16,
      maxOutputSize: '4K',
    });
  });

  it('also accepts raw JSON in the provider parameter', () => {
    const url = new URL('https://example.com/zh/?provider={"type":"image","preset":"gpt-image-2","provider":"openai","name":"FlyReq","modelId":"gpt-image-2","baseUrl":"https://flyreq.com","apiKey":"raw-key"}');

    expect(parseExternalModelConfig(url)).toMatchObject({
      type: 'image',
      preset: 'gpt-image-2',
      protocol: 'openai',
      name: 'FlyReq',
      modelId: 'gpt-image-2',
      baseUrl: 'https://flyreq.com',
      apiKey: 'raw-key',
    });
  });

  it('parses Gemini temperature capability and the Lite preset from a provider URL', () => {
    const provider = encodeURIComponent(JSON.stringify({
      type: 'image',
      preset: 'gemini-3.1-flash-lite-image',
      provider: 'google',
      modelId: 'gemini-3.1-flash-lite-image',
      supportsTemperature: false,
    }));
    const url = new URL(`https://example.com/zh/?provider=${provider}`);

    expect(parseExternalModelConfig(url)).toMatchObject({
      preset: 'gemini-3.1-flash-lite-image',
      protocol: 'google',
      supportsTemperature: false,
    });
  });

  it('removes external config params and hash from URL', () => {
    const provider = encodeURIComponent(JSON.stringify({ type: 'image', name: 'FlyReq', apiKey: 'secret' }));
    const url = new URL(`https://example.com/zh/?provider=${provider}&keep=1#debug`);

    expect(getCleanUrlAfterExternalModelConfig(url)).toBe('/zh/?keep=1');
  });

  it('keeps legacy multi-param URLs parseable', () => {
    const url = new URL('https://example.com/zh/?configureModel=1&type=image&preset=gpt-image-2&protocol=openai&name=FlyReq&modelId=gpt-image-2&baseUrl=https%3A%2F%2Fflyreq.com&apiKey=query-key&maxRefImages=16&maxOutputSize=4K');

    expect(parseExternalModelConfig(url)).toMatchObject({
      type: 'image',
      protocol: 'openai',
      apiKey: 'query-key',
      maxOutputSize: '4K',
    });
  });

  it('matches existing image model by stable key or signature', () => {
    const models: ImageModelConfig[] = [{
      id: 'flyreq-gpt-image-2',
      protocol: 'openai',
      name: 'FlyReq',
      modelId: 'gpt-image-2',
      apiKey: '',
      baseUrl: 'https://flyreq.com/',
      builtinPreset: 'gpt-image-2',
      maxRefImages: 16,
      maxOutputSize: '4K',
      supportsAdvancedParams: true,
    }];

    expect(getExternalImageModelMatch(models, {
      type: 'image',
      name: 'FlyReq',
      modelId: 'gpt-image-2',
      baseUrl: 'https://flyreq.com',
    })?.id).toBe('flyreq-gpt-image-2');
  });
});
