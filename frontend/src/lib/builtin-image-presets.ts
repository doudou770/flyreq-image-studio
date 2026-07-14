'use client';

/** 图片内置预设的稳定标识。 */
export type BuiltinImagePresetId =
  | 'gemini-2.5-flash-image'
  | 'gemini-3-pro-image-preview'
  | 'gemini-3.1-flash-image-preview'
  | 'gemini-3.1-flash-lite-image'
  | 'gpt-image-2'
  | 'grok-imagine-image'
  | 'grok-imagine-image-quality';

/** 内置图片预设允许使用的协议。 */
export type ProviderProtocol = 'google' | 'openai';

/** 内置图片预设允许使用的输出档位。 */
export type ImageOutputSize = '512' | '1K' | '2K' | '4K';

/** 单个内置图片预设的可配置默认值。 */
export interface BuiltinImagePreset {
  id: BuiltinImagePresetId;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  baseUrl: string;
  maxRefImages: number;
  maxOutputSize: ImageOutputSize;
  supportsAdvancedParams: boolean;
  /** 是否允许向 Gemini 图片接口发送温度参数。 */
  supportsTemperature: boolean;
  streamImages?: boolean;
}

/** 环境运行时允许覆盖的模板 ID 到实际模型 ID 映射。 */
export type BuiltinImagePresetModelIds = Partial<Record<BuiltinImagePresetId, string>>;

/**
 * 图片模型预设的唯一配置源。
 * 修改此处即可同时更新新增模型、留空模型 ID、默认地址和能力上限。
 */
const DEFAULT_BUILTIN_IMAGE_PRESETS: Record<BuiltinImagePresetId, BuiltinImagePreset> = {
  'gemini-2.5-flash-image': { id: 'gemini-2.5-flash-image', protocol: 'google', name: 'Banana', modelId: 'gemini-2.5-flash-image', baseUrl: 'https://generativelanguage.googleapis.com', maxRefImages: 3, maxOutputSize: '1K', supportsAdvancedParams: false, supportsTemperature: true, streamImages: false },
  'gemini-3-pro-image-preview': { id: 'gemini-3-pro-image-preview', protocol: 'google', name: 'Banana Pro', modelId: 'gemini-3-pro-image-preview', baseUrl: 'https://generativelanguage.googleapis.com', maxRefImages: 14, maxOutputSize: '4K', supportsAdvancedParams: false, supportsTemperature: true, streamImages: false },
  'gemini-3.1-flash-image-preview': { id: 'gemini-3.1-flash-image-preview', protocol: 'google', name: 'Banana 2', modelId: 'gemini-3.1-flash-image-preview', baseUrl: 'https://generativelanguage.googleapis.com', maxRefImages: 14, maxOutputSize: '4K', supportsAdvancedParams: false, supportsTemperature: true, streamImages: false },
  'gemini-3.1-flash-lite-image': { id: 'gemini-3.1-flash-lite-image', protocol: 'google', name: 'Banana 2 Lite', modelId: 'gemini-3.1-flash-lite-image', baseUrl: 'https://generativelanguage.googleapis.com', maxRefImages: 14, maxOutputSize: '1K', supportsAdvancedParams: false, supportsTemperature: true, streamImages: false },
  'gpt-image-2': { id: 'gpt-image-2', protocol: 'openai', name: 'GPT Image 2', modelId: 'gpt-image-2', baseUrl: 'https://api.openai.com', maxRefImages: 16, maxOutputSize: '4K', supportsAdvancedParams: true, supportsTemperature: false, streamImages: false },
  'grok-imagine-image': { id: 'grok-imagine-image', protocol: 'openai', name: 'Grok Imagine', modelId: 'grok-imagine-image', baseUrl: 'https://api.x.ai', maxRefImages: 1, maxOutputSize: '2K', supportsAdvancedParams: false, supportsTemperature: false, streamImages: false },
  'grok-imagine-image-quality': { id: 'grok-imagine-image-quality', protocol: 'openai', name: 'Grok Imagine Quality', modelId: 'grok-imagine-image-quality', baseUrl: 'https://api.x.ai', maxRefImages: 1, maxOutputSize: '2K', supportsAdvancedParams: false, supportsTemperature: false, streamImages: false },
};

/** 当前浏览器会话实际使用的预设配置。 */
export const BUILTIN_IMAGE_PRESETS: Record<BuiltinImagePresetId, BuiltinImagePreset> = Object.fromEntries(
  Object.entries(DEFAULT_BUILTIN_IMAGE_PRESETS).map(([presetId, preset]) => [presetId, { ...preset }]),
) as Record<BuiltinImagePresetId, BuiltinImagePreset>;

/**
 * 应用后端下发的模板模型 ID 映射，不接受未知模板或空模型 ID。
 * @param modelIds 经后端校验后的模板 ID 到模型 ID 映射。
 * @returns 无返回值；直接更新当前浏览器会话的预设配置。
 */
export function applyBuiltinImagePresetModelIds(modelIds?: BuiltinImagePresetModelIds): void {
  for (const presetId of Object.keys(DEFAULT_BUILTIN_IMAGE_PRESETS) as BuiltinImagePresetId[]) {
    BUILTIN_IMAGE_PRESETS[presetId].modelId = DEFAULT_BUILTIN_IMAGE_PRESETS[presetId].modelId;
  }
  if (!modelIds || typeof modelIds !== 'object') return;
  for (const [presetId, modelId] of Object.entries(modelIds)) {
    const preset = BUILTIN_IMAGE_PRESETS[presetId as BuiltinImagePresetId];
    if (preset && typeof modelId === 'string' && modelId.trim()) preset.modelId = modelId.trim();
  }
}
