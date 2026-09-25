'use client';

import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import {
  generateModelId,
  type DefaultModels,
  type FlyreqModelRegistry,
  type ImageModelConfig,
  type TextModelConfig,
  type VideoModelConfig,
} from '@/lib/flyreq-models';

/** 模型配置文本的版本前缀，用于阻止把其他文本误当作配置导入。 */
export const MODEL_CONFIG_TRANSFER_PREFIX = 'FISCFG2.';

type CompactModelConfig = {
  s: 2;
  i: ImageModelConfig[];
  v: VideoModelConfig[];
  t: TextModelConfig[];
  d: DefaultModels;
};

/** 浏览器端将字节编码为不含换行的 Base64URL 文本。 */
function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 将 Base64URL 文本解码为原始字节。 */
function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** 判断值是否为可继续做字段校验的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验压缩配置载荷的顶层结构，避免导入部分损坏数据。 */
function validateCompactConfig(value: unknown): CompactModelConfig {
  if (!isRecord(value) || value.s !== 2 || !Array.isArray(value.i) || !Array.isArray(value.v) || !Array.isArray(value.t) || !isRecord(value.d)) {
    throw new Error('配置文本格式无效或版本不受支持');
  }
  const defaults = value.d as Partial<DefaultModels>;
  const defaultKeys: (keyof DefaultModels)[] = ['textToImage', 'imageToImage', 'reversePrompt', 'agent', 'promptOptimize', 'imageDescribe', 'videoGeneration'];
  if (defaultKeys.some(key => typeof defaults[key] !== 'string')) {
    throw new Error('配置文本中的默认模型字段无效');
  }
  for (const [kind, models] of [['图片', value.i], ['视频', value.v], ['文本', value.t]] as const) {
    const ids = new Set<string>();
    for (const model of models) {
      if (!isRecord(model) || typeof model.id !== 'string' || !model.id.trim() || ids.has(model.id)) {
        throw new Error(`${kind}模型列表包含无效或重复的内部 ID`);
      }
      ids.add(model.id);
    }
  }
  return {
    s: 2,
    i: value.i as ImageModelConfig[],
    v: value.v as VideoModelConfig[],
    t: value.t as TextModelConfig[],
    d: defaults as DefaultModels,
  };
}

/** 生成模型配置的紧凑压缩文本，供复制到其他设备。 */
export function exportModelConfigText(registry: FlyreqModelRegistry): string {
  const compact: CompactModelConfig = {
    s: 2,
    i: registry.imageModels,
    v: registry.videoModels,
    t: registry.textModels,
    d: registry.defaults,
  };
  const compressed = zlibSync(strToU8(JSON.stringify(compact)), { level: 9 });
  return `${MODEL_CONFIG_TRANSFER_PREFIX}${encodeBase64Url(compressed)}`;
}

/** 解码并校验模型配置文本，返回尚未写入浏览器存储的配置载荷。 */
export function importModelConfigText(text: string): CompactModelConfig {
  const normalized = text.trim();
  if (!normalized.startsWith(MODEL_CONFIG_TRANSFER_PREFIX)) {
    throw new Error('请输入有效的模型配置文本');
  }
  try {
    const encoded = normalized.slice(MODEL_CONFIG_TRANSFER_PREFIX.length);
    if (!encoded) throw new Error('配置文本为空');
    const json = strFromU8(unzlibSync(decodeBase64Url(encoded)));
    return validateCompactConfig(JSON.parse(json));
  } catch (error) {
    if (error instanceof Error && error.message !== '配置文本为空') {
      throw new Error(`配置文本解析失败：${error.message}`);
    }
    throw error;
  }
}

/** 为导入模型生成不与当前注册表冲突的新 ID，并返回源 ID 到新 ID 的映射。 */
function createImportedIds(ids: string[], prefix: string, usedIds: Set<string>): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const sourceId of ids) {
    let nextId = generateModelId(prefix);
    while (usedIds.has(nextId)) nextId = generateModelId(prefix);
    usedIds.add(nextId);
    mapping.set(sourceId, nextId);
  }
  return mapping;
}

/** 将导入配置直接追加到当前注册表，并把默认模型引用重映射到新模型。 */
export function appendImportedModelConfig(registry: FlyreqModelRegistry, imported: CompactModelConfig): FlyreqModelRegistry {
  const usedIds = new Set([
    ...registry.imageModels.map(model => model.id),
    ...registry.videoModels.map(model => model.id),
    ...registry.textModels.map(model => model.id),
  ]);
  const imageIds = createImportedIds(imported.i.map(model => model.id), 'img', usedIds);
  const videoIds = createImportedIds(imported.v.map(model => model.id), 'video', usedIds);
  const textIds = createImportedIds(imported.t.map(model => model.id), 'txt', usedIds);
  return {
    schemaVersion: 2,
    imageModels: [...registry.imageModels, ...imported.i.map(model => ({ ...model, id: imageIds.get(model.id)! }))],
    videoModels: [...registry.videoModels, ...imported.v.map(model => ({ ...model, id: videoIds.get(model.id)! }))],
    textModels: [...registry.textModels, ...imported.t.map(model => ({ ...model, id: textIds.get(model.id)! }))],
    defaults: {
      ...registry.defaults,
      textToImage: imageIds.get(imported.d.textToImage) || registry.defaults.textToImage,
      imageToImage: imageIds.get(imported.d.imageToImage) || registry.defaults.imageToImage,
      reversePrompt: textIds.get(imported.d.reversePrompt) || registry.defaults.reversePrompt,
      agent: textIds.get(imported.d.agent) || registry.defaults.agent,
      promptOptimize: textIds.get(imported.d.promptOptimize) || registry.defaults.promptOptimize,
      imageDescribe: textIds.get(imported.d.imageDescribe) || registry.defaults.imageDescribe,
      videoGeneration: videoIds.get(imported.d.videoGeneration) || registry.defaults.videoGeneration,
    },
  };
}
