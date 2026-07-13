'use client';

export type ProviderProtocol = 'google' | 'openai';
export type ImageOutputSize = '512' | '1K' | '2K' | '4K';
export type BuiltinImagePresetId =
  | 'gemini-2.5-flash-image'
  | 'gemini-3-pro-image-preview'
  | 'gemini-3.1-flash-image-preview'
  | 'gpt-image-2'
  | 'grok-imagine-image'
  | 'grok-imagine-image-quality';

export type ImageApiFlavor = 'xai-imagine';

export interface ImageModelConfig {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  /** 模型 ID 留空时是否使用内置模板的默认模型 ID。 */
  usesPresetModelId?: boolean;
  apiKey: string;
  baseUrl: string;
  builtinPreset: BuiltinImagePresetId;
  maxRefImages: number;
  maxOutputSize: ImageOutputSize;
  supportsAdvancedParams: boolean;
  streamImages?: boolean;
}

export interface TextModelConfig {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  note?: string;
}

export interface BuiltinImagePreset {
  id: BuiltinImagePresetId;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  baseUrl: string;
  maxRefImages: number;
  maxOutputSize: ImageOutputSize;
  supportsAdvancedParams: boolean;
  streamImages?: boolean;
}

export interface DefaultModels {
  textToImage: string;
  imageToImage: string;
  reversePrompt: string;
  agent: string;
  promptOptimize: string;
  imageDescribe: string;
}

export interface FlyreqModelRegistry {
  imageModels: ImageModelConfig[];
  textModels: TextModelConfig[];
  defaults: DefaultModels;
}

const REGISTRY_KEY = 'flyreq-model-registry';
const DEFAULT_FLYREQ_IMAGE_MODEL_ID = 'flyreq-gpt-image-2';

export const BUILTIN_IMAGE_PRESETS: Record<BuiltinImagePresetId, BuiltinImagePreset> = {
  'gemini-2.5-flash-image': {
    id: 'gemini-2.5-flash-image',
    protocol: 'google',
    name: 'Banana',
    modelId: 'gemini-2.5-flash-image',
    baseUrl: 'https://generativelanguage.googleapis.com',
    maxRefImages: 3,
    maxOutputSize: '1K',
    supportsAdvancedParams: false,
    streamImages: false,
  },
  'gemini-3-pro-image-preview': {
    id: 'gemini-3-pro-image-preview',
    protocol: 'google',
    name: 'Banana Pro',
    modelId: 'gemini-3-pro-image-preview',
    baseUrl: 'https://generativelanguage.googleapis.com',
    maxRefImages: 11,
    maxOutputSize: '4K',
    supportsAdvancedParams: false,
    streamImages: false,
  },
  'gemini-3.1-flash-image-preview': {
    id: 'gemini-3.1-flash-image-preview',
    protocol: 'google',
    name: 'Banana 2',
    modelId: 'gemini-3.1-flash-image-preview',
    baseUrl: 'https://generativelanguage.googleapis.com',
    maxRefImages: 14,
    maxOutputSize: '4K',
    supportsAdvancedParams: false,
    streamImages: false,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    protocol: 'openai',
    name: 'GPT Image 2',
    modelId: 'gpt-image-2',
    baseUrl: 'https://api.openai.com',
    maxRefImages: 16,
    maxOutputSize: '4K',
    supportsAdvancedParams: true,
    streamImages: false,
  },
  'grok-imagine-image': {
    id: 'grok-imagine-image',
    protocol: 'openai',
    name: 'Grok Imagine',
    modelId: 'grok-imagine-image',
    baseUrl: 'https://api.x.ai',
    maxRefImages: 1,
    maxOutputSize: '2K',
    supportsAdvancedParams: false,
    streamImages: false,
  },
  'grok-imagine-image-quality': {
    id: 'grok-imagine-image-quality',
    protocol: 'openai',
    name: 'Grok Imagine Quality',
    modelId: 'grok-imagine-image-quality',
    baseUrl: 'https://api.x.ai',
    maxRefImages: 1,
    maxOutputSize: '2K',
    supportsAdvancedParams: false,
    streamImages: false,
  },
};

export const BUILTIN_IMAGE_PRESET_OPTIONS = Object.values(BUILTIN_IMAGE_PRESETS).map((preset) => ({
  value: preset.id,
  label: preset.name,
}));

export const DEFAULT_TEXT_MODEL_TEMPLATES = [
  {
    protocol: 'openai' as const,
    name: 'GPT 5.4 Mini',
    modelId: 'gpt-5.4-mini',
    baseUrl: 'https://api.openai.com',
    note: 'OpenAI Response',
  },
  {
    protocol: 'google' as const,
    name: 'Gemini 2.5 Flash',
    modelId: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    note: 'Google Gemini',
  },
];

export function getDefaultTextModelTemplate(protocol: ProviderProtocol) {
  return DEFAULT_TEXT_MODEL_TEMPLATES.find((item) => item.protocol === protocol) || DEFAULT_TEXT_MODEL_TEMPLATES[0];
}

export const DEFAULT_DEFAULTS: DefaultModels = {
  textToImage: '',
  imageToImage: '',
  reversePrompt: '',
  agent: '',
  promptOptimize: '',
  imageDescribe: '',
};

export const DEFAULT_IMAGE_MODELS: ImageModelConfig[] = [
  {
    id: DEFAULT_FLYREQ_IMAGE_MODEL_ID,
    protocol: 'openai',
    name: 'FlyReq',
    modelId: '',
    usesPresetModelId: true,
    apiKey: '',
    baseUrl: 'https://flyreq.com',
    builtinPreset: 'gpt-image-2',
    maxRefImages: 16,
    maxOutputSize: '4K',
    supportsAdvancedParams: true,
    streamImages: false,
  },
];

export function isXaiImaginePresetId(presetId: string): boolean {
  return presetId === 'grok-imagine-image' || presetId === 'grok-imagine-image-quality';
}

export function getImageApiFlavor(model: Pick<ImageModelConfig, 'builtinPreset' | 'modelId'>): ImageApiFlavor | undefined {
  return isXaiImaginePresetId(model.builtinPreset) || isXaiImaginePresetId(model.modelId)
    ? 'xai-imagine'
    : undefined;
}

/**
 * 解析图片模型实际发送给上游的模型 ID。
 * @param model 包含模板、用户自定义模型 ID 与预设标记的图片模型配置。
 * @returns 用户填写的模型 ID；GPT Image 2 留空预设时返回 gpt-image-2。
 */
export function getResolvedImageModelId(
  model: Pick<ImageModelConfig, 'builtinPreset' | 'modelId' | 'usesPresetModelId'>,
): string {
  const customModelId = String(model.modelId || '').trim();
  if (customModelId) return customModelId;
  return model.usesPresetModelId && model.builtinPreset === 'gpt-image-2'
    ? BUILTIN_IMAGE_PRESETS['gpt-image-2'].modelId
    : '';
}

function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return value === 'google' || value === 'openai';
}

function isBuiltinImagePresetId(value: unknown): value is BuiltinImagePresetId {
  return typeof value === 'string' && value in BUILTIN_IMAGE_PRESETS;
}

function normalizeImageOutputSize(value: unknown, fallback: ImageOutputSize): ImageOutputSize {
  return value === '512' || value === '1K' || value === '2K' || value === '4K'
    ? value
    : fallback;
}

function inferBuiltinPresetId(raw: Partial<ImageModelConfig>): BuiltinImagePresetId {
  for (const candidate of [raw.builtinPreset, raw.modelId, raw.id]) {
    if (isBuiltinImagePresetId(candidate)) return candidate;
  }
  if (String(raw.protocol || '').trim() === 'google') return 'gemini-3-pro-image-preview';
  return 'gpt-image-2';
}

/**
 * 归一化图片模型配置，并保留 GPT Image 2 的留空预设状态。
 * @param raw 从本地存储或外部配置读取的原始图片模型数据。
 * @returns 规范化后的图片模型；缺少内部标识时返回 null。
 */
function normalizeImageModelConfig(raw: Partial<ImageModelConfig>): ImageModelConfig | null {
  const presetId = inferBuiltinPresetId(raw);
  const preset = BUILTIN_IMAGE_PRESETS[presetId];
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const isXaiImagine = isXaiImaginePresetId(presetId);
  const protocol = isXaiImagine
    ? preset.protocol
    : (isProviderProtocol(raw.protocol) ? raw.protocol : preset.protocol);
  const configuredModelId = String(raw.modelId || '').trim();
  const usesPresetModelId = presetId === 'gpt-image-2' && (
    raw.usesPresetModelId === true
    || (raw.builtinPreset === 'gpt-image-2' && (!configuredModelId || configuredModelId === preset.modelId))
  );
  return {
    id,
    protocol,
    name: String(raw.name || '').trim(),
    modelId: usesPresetModelId ? '' : configuredModelId,
    usesPresetModelId: usesPresetModelId || undefined,
    apiKey: String(raw.apiKey || '').trim(),
    baseUrl: String(raw.baseUrl || preset.baseUrl).trim(),
    builtinPreset: presetId,
    maxRefImages: isXaiImagine
      ? preset.maxRefImages
      : (Number.isFinite(raw.maxRefImages) && Number(raw.maxRefImages) > 0
        ? Math.max(1, Math.floor(Number(raw.maxRefImages)))
        : preset.maxRefImages),
    maxOutputSize: isXaiImagine
      ? (raw.maxOutputSize === '1K' ? '1K' : preset.maxOutputSize)
      : normalizeImageOutputSize(raw.maxOutputSize, preset.maxOutputSize),
    supportsAdvancedParams: protocol === 'openai' && preset.supportsAdvancedParams
      ? (typeof raw.supportsAdvancedParams === 'boolean' ? raw.supportsAdvancedParams : preset.supportsAdvancedParams)
      : false,
    streamImages: protocol === 'openai' && preset.id === 'gpt-image-2'
      ? Boolean(raw.streamImages ?? preset.streamImages)
      : false,
  };
}

function normalizeTextModelConfig(raw: Partial<TextModelConfig>): TextModelConfig | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const protocol = isProviderProtocol(raw.protocol) ? raw.protocol : 'openai';
  const template = getDefaultTextModelTemplate(protocol);
  return {
    id,
    protocol,
    name: String(raw.name || '').trim(),
    modelId: String(raw.modelId || '').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    baseUrl: String(raw.baseUrl || template.baseUrl).trim(),
    note: typeof raw.note === 'string' ? raw.note : template.note,
  };
}

function isCompleteImageModel(model: Partial<ImageModelConfig>): model is ImageModelConfig {
  return Boolean(
    model.id
    && model.name?.trim()
    && getResolvedImageModelId({
      builtinPreset: model.builtinPreset || 'gpt-image-2',
      modelId: model.modelId || '',
      usesPresetModelId: model.usesPresetModelId,
    })
    && model.apiKey?.trim()
    && model.baseUrl?.trim()
  );
}

function isCompleteTextModel(model: Partial<TextModelConfig>): model is TextModelConfig {
  return Boolean(
    model.id
    && model.name?.trim()
    && model.modelId?.trim()
    && model.apiKey?.trim()
    && model.baseUrl?.trim()
  );
}

function ensureImageModels(raw?: unknown): ImageModelConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_IMAGE_MODELS;
  const models = raw
    .map((item) => normalizeImageModelConfig((item || {}) as Partial<ImageModelConfig>))
    .filter((item): item is ImageModelConfig => Boolean(item))
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
  return models.length > 0 ? models : DEFAULT_IMAGE_MODELS;
}

function ensureTextModels(raw?: unknown): TextModelConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeTextModelConfig((item || {}) as Partial<TextModelConfig>))
    .filter((item): item is TextModelConfig => Boolean(item))
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
}

function ensureDefaults(raw: Partial<DefaultModels> | undefined, imageModels: ImageModelConfig[], textModels: TextModelConfig[]): DefaultModels {
  const completeImageModels = imageModels.filter(isCompleteImageModel);
  const completeTextModels = textModels.filter(isCompleteTextModel);
  const firstImageModelId = completeImageModels[0]?.id || '';
  const firstTextModelId = completeTextModels[0]?.id || '';
  const next = { ...DEFAULT_DEFAULTS, ...raw };

  if (!completeImageModels.some((model) => model.id === next.textToImage)) next.textToImage = firstImageModelId;
  if (!completeImageModels.some((model) => model.id === next.imageToImage)) next.imageToImage = firstImageModelId;
  if (!completeTextModels.some((model) => model.id === next.reversePrompt)) next.reversePrompt = firstTextModelId;
  if (!completeTextModels.some((model) => model.id === next.agent)) next.agent = firstTextModelId;
  if (!completeTextModels.some((model) => model.id === next.promptOptimize)) next.promptOptimize = firstTextModelId;
  if (!completeTextModels.some((model) => model.id === next.imageDescribe)) next.imageDescribe = firstTextModelId;

  return next;
}

function getInitialRegistry(): FlyreqModelRegistry {
  return {
    imageModels: DEFAULT_IMAGE_MODELS,
    textModels: [],
    defaults: DEFAULT_DEFAULTS,
  };
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  const storage = window.localStorage;
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null;
}

export function loadRegistry(): FlyreqModelRegistry {
  const storage = getBrowserStorage();
  if (!storage) return getInitialRegistry();

  try {
    const raw = storage.getItem(REGISTRY_KEY);
    if (!raw) {
      return getInitialRegistry();
    }

    const parsed = JSON.parse(raw) as Partial<FlyreqModelRegistry>;
    const imageModels = ensureImageModels(parsed.imageModels);
    const textModels = ensureTextModels(parsed.textModels);
    const defaults = ensureDefaults(parsed.defaults, imageModels, textModels);
    return { imageModels, textModels, defaults };
  } catch {
    return getInitialRegistry();
  }
}

export function saveRegistry(registry: FlyreqModelRegistry): void {
  const storage = getBrowserStorage();
  if (!storage) return;

  const imageModels = ensureImageModels(registry.imageModels);
  const textModels = ensureTextModels(registry.textModels);
  const normalized: FlyreqModelRegistry = {
    imageModels,
    textModels,
    defaults: ensureDefaults(registry.defaults, imageModels, textModels),
  };

  storage.setItem(REGISTRY_KEY, JSON.stringify(normalized));
}

export function getImageModelById(registry: FlyreqModelRegistry, id: string): ImageModelConfig | undefined {
  return registry.imageModels.find((model) => model.id === id);
}

export function getTextModelById(registry: FlyreqModelRegistry, id: string): TextModelConfig | undefined {
  return registry.textModels.find((model) => model.id === id);
}

export function getDefaultImageModel(
  registry: FlyreqModelRegistry,
  task: keyof Pick<DefaultModels, 'textToImage' | 'imageToImage'>,
): ImageModelConfig | undefined {
  return getImageModelById(registry, registry.defaults[task]);
}

export function getDefaultTextModel(
  registry: FlyreqModelRegistry,
  task: keyof Pick<DefaultModels, 'reversePrompt' | 'agent' | 'promptOptimize' | 'imageDescribe'>,
): TextModelConfig | undefined {
  return getTextModelById(registry, registry.defaults[task]);
}

export function getCompleteImageModels(registry: FlyreqModelRegistry): ImageModelConfig[] {
  return registry.imageModels.filter(isCompleteImageModel);
}

export function getCompleteTextModels(registry: FlyreqModelRegistry): TextModelConfig[] {
  return registry.textModels.filter(isCompleteTextModel);
}

export function getImageModelOutputSizes(model: ImageModelConfig): ImageOutputSize[] {
  switch (model.maxOutputSize) {
    case '4K':
      return model.builtinPreset === 'gemini-3.1-flash-image-preview'
        ? ['512', '1K', '2K', '4K']
        : ['1K', '2K', '4K'];
    case '2K':
      return model.builtinPreset === 'gemini-3.1-flash-image-preview'
        ? ['512', '1K', '2K']
        : ['1K', '2K'];
    case '512':
      return ['512'];
    case '1K':
    default:
      return model.builtinPreset === 'gemini-3.1-flash-image-preview'
        ? ['512', '1K']
        : ['1K'];
  }
}

export function generateModelId(prefix: string = 'model'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
