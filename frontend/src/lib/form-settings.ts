/**
 * 文本生图 / 图生图 共享的表单设置类型
 * 两个表单（TextToImageForm、ImageToImageForm）的设置字段完全一致，
 * 统一定义于此避免重复。
 */

import type { ModelId } from '@/lib/gemini-config';
import type { OutputSize, AspectRatio } from '@/lib/job-store';
import type { GptImageBackground, GptImageOutputFormat, GptImageQuality, GptImageStyle, ParallelCount } from '@/lib/model-capabilities';

export interface ImageFormSettings {
  model: ModelId;
  outputSize: OutputSize;
  customSize?: string;
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
  'flyreq-image-generation-settings',
  'flyreq-t2i-settings',
  'flyreq-i2i-settings',
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
