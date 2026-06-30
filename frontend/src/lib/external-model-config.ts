import type { BuiltinImagePresetId, ImageModelConfig, ImageOutputSize, ProviderProtocol } from '@/lib/flyreq-models';

export type ExternalModelConfig = {
  type: 'image';
  modelKey?: string;
  preset?: BuiltinImagePresetId;
  protocol?: ProviderProtocol;
  name?: string;
  modelId?: string;
  baseUrl?: string;
  apiKey?: string;
  maxRefImages?: number;
  maxOutputSize?: ImageOutputSize;
  streamImages?: boolean;
};

const CONFIG_QUERY_KEYS = new Set([
  'provider',
]);

function normalizePreset(value: string | null): BuiltinImagePresetId | undefined {
  return value === 'gemini-2.5-flash-image'
    || value === 'gemini-3-pro-image-preview'
    || value === 'gemini-3.1-flash-image-preview'
    || value === 'gpt-image-2'
    ? value
    : undefined;
}

function normalizeProvider(value: string | null): ProviderProtocol | undefined {
  return value === 'openai' || value === 'google' ? value : undefined;
}

function normalizeOutputSize(value: string | null): ImageOutputSize | undefined {
  return value === '512' || value === '1K' || value === '2K' || value === '4K' ? value : undefined;
}

function readTrimmed(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseProviderJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeProviderPayload(payload: Record<string, unknown>): ExternalModelConfig | null {
  const type = readString(payload.type) || 'image';
  if (type !== 'image') return null;
  const protocol = readString(payload.provider) || readString(payload.protocol);

  return {
    type: 'image',
    modelKey: readString(payload.modelKey),
    preset: normalizePreset(readString(payload.preset) || null),
    protocol: normalizeProvider(protocol || null),
    name: readString(payload.name),
    modelId: readString(payload.modelId),
    baseUrl: readString(payload.baseUrl),
    apiKey: readString(payload.apiKey),
    maxRefImages: readNumber(payload.maxRefImages),
    maxOutputSize: normalizeOutputSize(readString(payload.maxOutputSize) || null),
    streamImages: readBoolean(payload.streamImages),
  };
}

export function parseExternalModelConfig(url: URL): ExternalModelConfig | null {
  const providerPayload = parseProviderJson(url.searchParams.get('provider'));
  if (providerPayload) return normalizeProviderPayload(providerPayload);

  if (url.searchParams.get('configureModel') !== '1') return null;
  if ((url.searchParams.get('type') || 'image') !== 'image') return null;

  const maxRefImagesRaw = Number(url.searchParams.get('maxRefImages'));
  const maxRefImages = Number.isFinite(maxRefImagesRaw) && maxRefImagesRaw > 0
    ? Math.floor(maxRefImagesRaw)
    : undefined;

  return {
    type: 'image',
    modelKey: readTrimmed(url.searchParams, 'modelKey'),
    preset: normalizePreset(url.searchParams.get('preset')),
    protocol: normalizeProvider(url.searchParams.get('protocol') || url.searchParams.get('provider')),
    name: readTrimmed(url.searchParams, 'name'),
    modelId: readTrimmed(url.searchParams, 'modelId'),
    baseUrl: readTrimmed(url.searchParams, 'baseUrl'),
    apiKey: readTrimmed(url.searchParams, 'apiKey'),
    maxRefImages,
    maxOutputSize: normalizeOutputSize(url.searchParams.get('maxOutputSize')),
    streamImages: readBoolean(url.searchParams.get('streamImages') ?? undefined),
  };
}

export function getCleanUrlAfterExternalModelConfig(url: URL): string {
  const clean = new URL(url.toString());
  for (const key of CONFIG_QUERY_KEYS) {
    clean.searchParams.delete(key);
  }
  clean.hash = '';
  return `${clean.pathname}${clean.search}${clean.hash}`;
}

export function getExternalImageModelMatch(models: ImageModelConfig[], config: ExternalModelConfig): ImageModelConfig | undefined {
  if (config.modelKey) {
    const byKey = models.find((model) => model.id === config.modelKey);
    if (byKey) return byKey;
  }

  const name = config.name?.trim().toLowerCase();
  const modelId = config.modelId?.trim().toLowerCase();
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '').toLowerCase();
  if (!name || !modelId || !baseUrl) return undefined;

  return models.find((model) => (
    model.name.trim().toLowerCase() === name
    && model.modelId.trim().toLowerCase() === modelId
    && model.baseUrl.trim().replace(/\/+$/, '').toLowerCase() === baseUrl
  ));
}
