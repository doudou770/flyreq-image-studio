import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearModelCatalogCache,
  getModelCatalogCache,
  isModelCatalogCacheStale,
  loadModelCatalogCache,
  MODEL_CATALOG_CACHE_STALE_AFTER_MS,
  saveModelCatalogCache,
} from '@/lib/model-catalog-cache';

describe('模型目录缓存', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('持久化成功获取的目录并去重模型 ID', () => {
    const now = 1_700_000_000_000;
    saveModelCatalogCache({
      channelId: 'channel-a',
      protocol: 'openai',
      baseUrl: 'https://example.com',
      fetchedAt: now,
      options: [
        { id: 'model-b', name: 'B' },
        { id: 'model-a', name: 'A' },
        { id: 'model-a', name: 'A duplicate' },
      ],
    });

    expect(loadModelCatalogCache()['channel-a']).toMatchObject({
      channelId: 'channel-a',
      fetchedAt: now,
      options: [
        { id: 'model-a', name: 'A duplicate' },
        { id: 'model-b', name: 'B' },
      ],
    });
    expect(getModelCatalogCache('channel-a', { protocol: 'google' })).toBeUndefined();
    expect(getModelCatalogCache('channel-a', { protocol: 'openai', baseUrl: 'https://example.com' })).toBeDefined();
  });

  it('清理指定渠道并按时间标记过期目录', () => {
    saveModelCatalogCache({ channelId: 'channel-a', protocol: 'openai', baseUrl: 'https://a.example', options: [] });
    saveModelCatalogCache({ channelId: 'channel-b', protocol: 'openai', baseUrl: 'https://b.example', options: [] });
    clearModelCatalogCache('channel-a');

    expect(getModelCatalogCache('channel-a')).toBeUndefined();
    expect(getModelCatalogCache('channel-b')).toBeDefined();
    expect(isModelCatalogCacheStale(100, 100 + MODEL_CATALOG_CACHE_STALE_AFTER_MS)).toBe(true);
    expect(isModelCatalogCacheStale(100, 100 + MODEL_CATALOG_CACHE_STALE_AFTER_MS - 1)).toBe(false);
  });

  it('缓存写入失败时不阻断设置流程', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => saveModelCatalogCache({ channelId: 'channel-a', protocol: 'openai', baseUrl: 'https://a.example', options: [] })).not.toThrow();
    setItem.mockRestore();
  });
});
