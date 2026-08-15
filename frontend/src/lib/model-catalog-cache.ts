import { LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

export interface ModelCatalogCacheOption {
  id: string;
  name: string;
}

export interface ModelCatalogCacheEntry {
  channelId: string;
  protocol: string;
  baseUrl: string;
  fetchedAt: number;
  options: ModelCatalogCacheOption[];
}

interface PersistedModelCatalogCache {
  version: 1;
  catalogs: Record<string, ModelCatalogCacheEntry>;
}

export const MODEL_CATALOG_CACHE_UPDATED_EVENT = 'flyreq-model-catalog-updated';
export const MODEL_CATALOG_CACHE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MODEL_CATALOG_CACHE_VERSION = 1 as const;

/**
 * 判断模型目录是否超过 24 小时未刷新；过期目录仍可继续使用。
 * @param fetchedAt 目录最后成功获取的时间戳。
 * @param now 用于比较的当前时间戳。
 * @returns 已超过刷新时限时返回 true，否则返回 false。
 */
export function isModelCatalogCacheStale(fetchedAt?: number, now: number = Date.now()): boolean {
  return Number.isFinite(fetchedAt) && now - Number(fetchedAt) >= MODEL_CATALOG_CACHE_STALE_AFTER_MS;
}

/**
 * 获取可用的浏览器本地存储；服务端渲染或存储不可用时返回 null。
 * @returns 可用的 Storage 实例；当前环境不可持久化时返回 null。
 */
function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  const storage = window.localStorage;
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null;
}

/**
 * 将远端模型目录项去重并规范成稳定的 ID/名称结构。
 * @param value 待清洗的任意目录项集合。
 * @returns 去重、排序后的模型目录项。
 */
function normalizeOptions(value: unknown): ModelCatalogCacheOption[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ModelCatalogCacheOption>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; name?: unknown };
    const id = String(row.id || '').trim();
    if (!id) continue;
    unique.set(id, { id, name: String(row.name || id).trim() || id });
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 规范化单个缓存目录，过滤损坏字段并确保缓存不会携带密钥。
 * @param channelId 当前缓存记录的渠道 ID。
 * @param value 从本地存储读取的原始目录对象。
 * @returns 合法缓存记录；字段损坏时返回 null。
 */
function normalizeEntry(channelId: string, value: unknown): ModelCatalogCacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ModelCatalogCacheEntry>;
  const id = String(raw.channelId || channelId).trim();
  const protocol = String(raw.protocol || '').trim();
  const baseUrl = String(raw.baseUrl || '').trim();
  const fetchedAt = Number(raw.fetchedAt);
  if (!id || !protocol || !baseUrl || !Number.isFinite(fetchedAt)) return null;
  return {
    channelId: id,
    protocol,
    baseUrl,
    fetchedAt,
    options: normalizeOptions(raw.options),
  };
}

/**
 * 读取所有已持久化的模型目录缓存；缓存损坏时安全降级为空对象。
 * @returns 按渠道 ID 索引的缓存目录集合。
 */
export function loadModelCatalogCache(): Record<string, ModelCatalogCacheEntry> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(LOCAL_STORAGE_KEYS.modelCatalog) || '') as Partial<PersistedModelCatalogCache>;
    if (parsed.version !== MODEL_CATALOG_CACHE_VERSION || !parsed.catalogs || typeof parsed.catalogs !== 'object') return {};
    const catalogs: Record<string, ModelCatalogCacheEntry> = {};
    for (const [channelId, value] of Object.entries(parsed.catalogs)) {
      const entry = normalizeEntry(channelId, value);
      if (entry) catalogs[entry.channelId] = entry;
    }
    return catalogs;
  } catch {
    return {};
  }
}

/**
 * 读取指定渠道的模型目录缓存，并校验来源协议和地址是否仍然匹配。
 * @param channelId 要读取的渠道 ID。
 * @param source 当前渠道的协议和 Base URL。
 * @returns 来源匹配的目录缓存；不存在或来源不匹配时返回 undefined。
 */
export function getModelCatalogCache(
  channelId: string,
  source?: { protocol?: string; baseUrl?: string },
): ModelCatalogCacheEntry | undefined {
  const entry = loadModelCatalogCache()[channelId];
  if (!entry) return undefined;
  if (source?.protocol !== undefined && entry.protocol !== source.protocol.trim()) return undefined;
  if (source?.baseUrl !== undefined && entry.baseUrl !== source.baseUrl.trim()) return undefined;
  return entry;
}

/**
 * 保存一次成功获取的远端模型目录，并通知工作台刷新模型选择项。
 * @param input 渠道来源、模型目录和可选获取时间。
 * @returns 无返回值；存储不可用时安全忽略持久化失败。
 */
export function saveModelCatalogCache(input: {
  channelId: string;
  protocol: string;
  baseUrl: string;
  options: ModelCatalogCacheOption[];
  fetchedAt?: number;
}): void {
  const storage = getStorage();
  if (!storage) return;
  const entry = normalizeEntry(input.channelId, {
    ...input,
    fetchedAt: input.fetchedAt || Date.now(),
  });
  if (!entry) return;
  const catalogs = loadModelCatalogCache();
  catalogs[entry.channelId] = entry;
  try {
    storage.setItem(LOCAL_STORAGE_KEYS.modelCatalog, JSON.stringify({ version: MODEL_CATALOG_CACHE_VERSION, catalogs } satisfies PersistedModelCatalogCache));
    window.dispatchEvent(new Event(MODEL_CATALOG_CACHE_UPDATED_EVENT));
  } catch {
    // 浏览器禁止写入时保留当前页面内的请求结果，不影响本次设置操作。
  }
}

/**
 * 删除指定渠道的模型目录缓存，并通知订阅者清理过期的模型选项。
 * @param channelId 要清除的渠道 ID。
 * @returns 无返回值；没有对应缓存时保持不变。
 */
export function clearModelCatalogCache(channelId: string): void {
  const storage = getStorage();
  if (!storage) return;
  const catalogs = loadModelCatalogCache();
  if (!catalogs[channelId]) return;
  delete catalogs[channelId];
  try {
    storage.setItem(LOCAL_STORAGE_KEYS.modelCatalog, JSON.stringify({ version: MODEL_CATALOG_CACHE_VERSION, catalogs } satisfies PersistedModelCatalogCache));
    window.dispatchEvent(new Event(MODEL_CATALOG_CACHE_UPDATED_EVENT));
  } catch {
    // 清理失败时不抛出异常，避免阻断设置表单编辑。
  }
}

/**
 * 删除不再存在的渠道缓存，避免长期保留无效目录和旧地址信息。
 * @param channelIds 当前注册表中仍然存在的渠道 ID。
 * @returns 无返回值；缓存写入失败时保留原数据。
 */
export function pruneModelCatalogCache(channelIds: string[]): void {
  const storage = getStorage();
  if (!storage) return;
  const validIds = new Set(channelIds);
  const catalogs = loadModelCatalogCache();
  let changed = false;
  for (const channelId of Object.keys(catalogs)) {
    if (!validIds.has(channelId)) {
      delete catalogs[channelId];
      changed = true;
    }
  }
  if (!changed) return;
  try {
    storage.setItem(LOCAL_STORAGE_KEYS.modelCatalog, JSON.stringify({ version: MODEL_CATALOG_CACHE_VERSION, catalogs } satisfies PersistedModelCatalogCache));
    window.dispatchEvent(new Event(MODEL_CATALOG_CACHE_UPDATED_EVENT));
  } catch {
    // 清理失败时保留原缓存，不影响模型配置保存。
  }
}
