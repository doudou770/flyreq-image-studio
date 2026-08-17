/**
 * 浏览器存储契约：集中声明所有持久化 key、数据库结构、归属域与备份策略。
 * 业务模块只能引用本文件导出的标识，禁止再次硬编码存储名称。
 */

export type StorageOwner =
  | 'platform'
  | 'models'
  | 'image-generation'
  | 'video-generation'
  | 'reverse-prompt'
  | 'agent'
  | 'gif'
  | 'assets'
  | 'canvas';

export interface LocalStorageContractEntry {
  key: string;
  owner: StorageOwner;
  backup: boolean;
}

export interface IndexedDbIndexContract {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

export interface IndexedDbStoreContract {
  name: string;
  keyPath?: string | string[];
  autoIncrement?: boolean;
  indexes?: readonly IndexedDbIndexContract[];
}

export interface IndexedDbContract {
  name: string;
  version: number;
  owner: StorageOwner;
  backup: boolean;
  stores: readonly IndexedDbStoreContract[];
}

export interface LocalForageContract {
  name: string;
  storeName: string;
  owner: StorageOwner;
  backup: boolean;
}

export const STORAGE_CONTRACT_VERSION = 1;

export const LOCAL_STORAGE_KEYS = {
  modelRegistry: 'flyreq-model-registry',
  modelCatalog: 'flyreq-model-catalog',
  imageJobs: 'flyreq-jobs',
  imageWorkbenchSettings: 'flyreq-image-generation-settings',
  textToImageSettings: 'flyreq-t2i-settings',
  imageToImageSettings: 'flyreq-i2i-settings',
  reversePromptSettings: 'flyreq-reverse-prompt-settings',
  theme: 'theme',
  locale: 'flyreq-locale',
  wideMode: 'flyreq-wide-mode',
  navigationCollapsed: 'flyreq-navigation-collapsed',
  promptSubmissionShortcut: 'flyreq-prompt-submission-shortcut',
  promptOptimizeEnabled: 'flyreq-prompt-optimize-enabled',
  agentParams: 'flyreq-agent-params',
  agentWebSearch: 'flyreq-agent-web-search',
  agentIntentRecognition: 'flyreq-agent-intent-recognition',
  gifSettings: 'flyreq-gif-settings',
  gifActiveJob: 'flyreq-gif-active-job',
  gifTunerMobileHintHidden: 'flyreq-gif-tuner-mobile-hint-hidden',
  videoJobs: 'flyreq-video-jobs',
  assetsSettings: 'flyreq-assets-settings',
  canvasConfig: 'flyreq-image:canvas_config',
  canvasStoreFallback: 'flyreq-image:canvas_store',
} as const;

export const LOCAL_STORAGE_CONTRACT: readonly LocalStorageContractEntry[] = [
  { key: LOCAL_STORAGE_KEYS.modelRegistry, owner: 'models', backup: true },
  { key: LOCAL_STORAGE_KEYS.modelCatalog, owner: 'models', backup: true },
  { key: LOCAL_STORAGE_KEYS.imageJobs, owner: 'image-generation', backup: true },
  { key: LOCAL_STORAGE_KEYS.imageWorkbenchSettings, owner: 'image-generation', backup: true },
  { key: LOCAL_STORAGE_KEYS.textToImageSettings, owner: 'image-generation', backup: true },
  { key: LOCAL_STORAGE_KEYS.imageToImageSettings, owner: 'image-generation', backup: true },
  { key: LOCAL_STORAGE_KEYS.reversePromptSettings, owner: 'reverse-prompt', backup: true },
  { key: LOCAL_STORAGE_KEYS.theme, owner: 'platform', backup: true },
  { key: LOCAL_STORAGE_KEYS.locale, owner: 'platform', backup: true },
  { key: LOCAL_STORAGE_KEYS.wideMode, owner: 'platform', backup: true },
  { key: LOCAL_STORAGE_KEYS.navigationCollapsed, owner: 'platform', backup: true },
  { key: LOCAL_STORAGE_KEYS.promptSubmissionShortcut, owner: 'platform', backup: true },
  { key: LOCAL_STORAGE_KEYS.promptOptimizeEnabled, owner: 'platform', backup: true },
  { key: LOCAL_STORAGE_KEYS.agentParams, owner: 'agent', backup: true },
  { key: LOCAL_STORAGE_KEYS.agentWebSearch, owner: 'agent', backup: true },
  { key: LOCAL_STORAGE_KEYS.agentIntentRecognition, owner: 'agent', backup: true },
  { key: LOCAL_STORAGE_KEYS.gifSettings, owner: 'gif', backup: true },
  { key: LOCAL_STORAGE_KEYS.gifActiveJob, owner: 'gif', backup: true },
  { key: LOCAL_STORAGE_KEYS.gifTunerMobileHintHidden, owner: 'gif', backup: true },
  { key: LOCAL_STORAGE_KEYS.videoJobs, owner: 'video-generation', backup: true },
  { key: LOCAL_STORAGE_KEYS.assetsSettings, owner: 'assets', backup: true },
  { key: LOCAL_STORAGE_KEYS.canvasConfig, owner: 'canvas', backup: true },
  { key: LOCAL_STORAGE_KEYS.canvasStoreFallback, owner: 'canvas', backup: true },
];

export const INDEXED_DB = {
  images: {
    name: 'flyreq-image-db',
    version: 2,
    owner: 'image-generation',
    backup: true,
    stores: [
      { name: 'images', keyPath: 'id' },
      { name: 'blobs', keyPath: 'key' },
    ],
  },
  reversePrompt: {
    name: 'flyreq-reverse-db',
    version: 1,
    owner: 'reverse-prompt',
    backup: true,
    stores: [{ name: 'reverse-results', keyPath: 'slot' }],
  },
  uploadCache: {
    name: 'flyreq-upload-cache',
    version: 1,
    owner: 'image-generation',
    backup: true,
    stores: [{ name: 'images', keyPath: 'key' }],
  },
  agent: {
    name: 'flyreq-agent-db',
    version: 1,
    owner: 'agent',
    backup: true,
    stores: [
      { name: 'messages', keyPath: 'id' },
      { name: 'images', keyPath: 'imgId' },
      { name: 'meta', keyPath: 'key' },
    ],
  },
  assets: {
    name: 'flyreq-assets-db',
    version: 1,
    owner: 'assets',
    backup: true,
    stores: [
      {
        name: 'assets',
        keyPath: 'id',
        indexes: [
          { name: 'hash', keyPath: 'hash', unique: false },
          { name: 'createdAt', keyPath: 'createdAt', unique: false },
        ],
      },
      { name: 'asset-blobs', keyPath: 'key' },
    ],
  },
  videoResults: {
    name: 'flyreq-video-results',
    version: 1,
    owner: 'video-generation',
    backup: true,
    stores: [{ name: 'videos' }],
  },
} as const satisfies Record<string, IndexedDbContract>;

export const INDEXED_DB_CONTRACTS: readonly IndexedDbContract[] = Object.values(INDEXED_DB);

export const LOCAL_FORAGE = {
  canvasState: {
    name: 'flyreq-image',
    storeName: 'canvas_app_state',
    owner: 'canvas',
    backup: true,
  },
  canvasImages: {
    name: 'flyreq-image',
    storeName: 'canvas_image_files',
    owner: 'canvas',
    backup: true,
  },
} as const satisfies Record<string, LocalForageContract>;

export const LOCAL_FORAGE_KEYS = {
  canvasStore: LOCAL_STORAGE_KEYS.canvasStoreFallback,
} as const;

export const LOCAL_FORAGE_CONTRACTS: readonly LocalForageContract[] = Object.values(LOCAL_FORAGE);

/**
 * 返回需要进入完整备份的 localStorage key。
 * @returns 按契约声明顺序排列的持久化 key。
 */
export function getBackedUpLocalStorageKeys(): string[] {
  return LOCAL_STORAGE_CONTRACT.filter(entry => entry.backup).map(entry => entry.key);
}

/**
 * 返回需要进入完整备份的 IndexedDB 数据库契约。
 * @returns 所有启用备份的数据库结构定义。
 */
export function getBackedUpIndexedDbContracts(): IndexedDbContract[] {
  return INDEXED_DB_CONTRACTS.filter(contract => contract.backup);
}

/**
 * 返回需要进入完整备份的 localForage store 契约。
 * @returns 所有启用备份的 localForage 实例定义。
 */
export function getBackedUpLocalForageContracts(): LocalForageContract[] {
  return LOCAL_FORAGE_CONTRACTS.filter(contract => contract.backup);
}

/**
 * 按契约创建缺失的 IndexedDB object store 与索引。
 * @param db 当前正在升级的数据库连接。
 * @param transaction 当前版本升级事务，用于访问已经存在的 object store。
 * @param contract 目标数据库的完整结构契约。
 * @returns 无返回值，结构变更写入当前升级事务。
 */
export function ensureIndexedDbSchema(
  db: IDBDatabase,
  transaction: IDBTransaction | null,
  contract: IndexedDbContract,
): void {
  for (const storeContract of contract.stores) {
    let store: IDBObjectStore;
    if (db.objectStoreNames.contains(storeContract.name)) {
      if (!transaction) continue;
      store = transaction.objectStore(storeContract.name);
    } else {
      const options: IDBObjectStoreParameters = {};
      if (storeContract.keyPath !== undefined) options.keyPath = storeContract.keyPath;
      if (storeContract.autoIncrement !== undefined) options.autoIncrement = storeContract.autoIncrement;
      store = db.createObjectStore(storeContract.name, options);
    }

    for (const indexContract of storeContract.indexes || []) {
      if (store.indexNames.contains(indexContract.name)) continue;
      store.createIndex(indexContract.name, indexContract.keyPath, {
        unique: indexContract.unique ?? false,
        multiEntry: indexContract.multiEntry ?? false,
      });
    }
  }
}

/**
 * 在其他页面升级或删除数据库时主动释放当前连接，避免完整恢复永久停在 blocked 状态。
 * @param db 需要管理生命周期的 IndexedDB 连接。
 * @param onClosed 连接因版本变化关闭后需要执行的可选缓存失效回调。
 * @returns 无返回值，处理器直接安装到数据库连接。
 */
export function closeIndexedDbOnVersionChange(db: IDBDatabase, onClosed?: () => void): void {
  db.onversionchange = () => {
    db.close();
    onClosed?.();
  };
}
