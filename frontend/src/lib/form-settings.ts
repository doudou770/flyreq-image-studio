/**
 * 文本生图 / 图生图 共享的表单设置类型
 * 两个表单（TextToImageForm、ImageToImageForm）的设置字段完全一致，
 * 统一定义于此避免重复。
 */

import type { ModelId } from '@/lib/gemini-config';
import type { OutputSize, AspectRatio } from '@/lib/job-store';
import type { GptImageBackground, GptImageOutputFormat, GptImageQuality, GptImageStyle, ParallelCount } from '@/lib/model-capabilities';
import { LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

export interface ImageFormSettings {
  model: ModelId;
  /** 当前工作台选择的远端模型 ID；缺失时回退到渠道配置中的模型 ID。 */
  modelId?: string;
  /** 新版工作台使用的渠道 ID，旧缓存仍通过 model 字段兼容。 */
  channelId?: ModelId;
  outputSize: OutputSize;
  customSize?: string;
  /** 自定义分辨率是否自动对齐到 16 的倍数。 */
  customSizeAlignMultiple?: boolean;
  aspectRatio: AspectRatio;
  temperature: number;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  gptImageOutputFormat: GptImageOutputFormat;
  parallelCount: ParallelCount;
  promptVariants?: string[];
}

export const IMAGE_FORM_SETTINGS_STORAGE_KEYS = [
  LOCAL_STORAGE_KEYS.imageWorkbenchSettings,
  LOCAL_STORAGE_KEYS.textToImageSettings,
  LOCAL_STORAGE_KEYS.imageToImageSettings,
] as const;

/**
 * 将首次保存的图片模型写入所有生图表单的本地默认设置，同时保留其他表单参数。
 * @param modelId 首个配置完整的图片模型内部标识。
 * @returns 无返回值；存储不可用或单项缓存损坏时会继续处理其余表单缓存。
 */
export function saveFirstImageModelAsFormDefault(modelId: ModelId): void {
  if (typeof window === 'undefined') return;

  for (const key of IMAGE_FORM_SETTINGS_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      const existing = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      window.localStorage.setItem(key, JSON.stringify({ ...existing, model: modelId }));
    } catch {
      // 单个缓存项不可读或不可写时，不影响其余生图表单恢复新默认模型。
    }
  }
}
