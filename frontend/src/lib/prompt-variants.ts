/** 单张图片附加提示词在上游请求中的固定分隔文本。 */
const PROMPT_VARIANT_SEPARATOR = '\n\n本张图要求：\n';

/**
 * 组合一张图片实际发送给上游的完整提示词。
 * @param prompt 批量任务共享的主提示词。
 * @param promptVariant 当前图片的可选附加提示词。
 * @returns 包含附加提示词的完整提示词；没有附加提示词时返回主提示词。
 */
export function composeEffectiveImagePrompt(prompt: string, promptVariant?: string): string {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedVariant = String(promptVariant || '').trim();
  if (!normalizedVariant) return normalizedPrompt;
  return normalizedPrompt ? `${normalizedPrompt}${PROMPT_VARIANT_SEPARATOR}${normalizedVariant}` : normalizedVariant;
}

/**
 * 获取历史任务中本张图片实际使用的完整提示词。
 * @param prompt 任务保存的主提示词。
 * @param promptVariants 任务保存的单张附加提示词列表。
 * @param effectivePrompt 新版任务直接保存的完整提示词。
 * @returns 优先返回持久化的完整提示词；旧任务按历史字段即时合成。
 */
export function getEffectiveImagePrompt(
  prompt: string,
  promptVariants?: string[],
  effectivePrompt?: string,
): string {
  const savedPrompt = String(effectivePrompt || '').trim();
  return savedPrompt || composeEffectiveImagePrompt(prompt, promptVariants?.[0]);
}
