export const LOCALES = ['en', 'zh'] as const;
export type Locale = typeof LOCALES[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'nova-locale';

const dictionaries = {
  en: {
    'app.title': 'FlyReq Image',
    'app.subtitle': 'Batch API image generator',
    'app.metadataTitle': 'FlyReq Image - AI Image Generator',
    'app.metadataDescription': 'FlyReq Image AI image generation workspace',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.retry': 'Retry',
    'common.settings': 'Settings',
    'common.close': 'Close',
    'common.loading': 'Loading',
    'common.configure': 'Configure',
    'theme.label': 'Theme',
    'theme.switch': 'Switch theme',
    'theme.system': 'System',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'language.label': 'Language',
    'language.switch': 'Switch language',
    'language.en': 'English',
    'language.zh': 'Chinese',
    'tabs.agent': 'Agent',
    'tabs.imageGeneration': 'Image Studio',
    'tabs.canvas': 'Canvas',
    'tabs.assets': 'Assets',
    'tabs.reversePrompt': 'Prompt Reverse',
    'tabs.gif': 'GIF',
    'tabs.promptGallery': 'Prompt Gallery',
    'toolbar.randomImage': 'Random Image',
    'toolbar.baPeople': 'BA People',
    'toolbar.bingWallpaper': 'Bing Wallpaper',
    'toolbar.wideMode': 'Wide',
    'toolbar.exitWideMode': 'Exit Wide',
    'queue.concurrency': 'Active {count}',
    'queue.queued': 'Queued {count}',
    'queue.queuedMax': 'Queued {count} (max {max})',
    'queue.status': 'Status {status}',
    'queue.statusOpen': 'Open',
    'queue.statusClosed': 'Closed',
    'queue.unknown': 'Queue status unknown',
    'history.generationTitle': 'Generation Jobs',
    'history.reverseTitle': 'Reverse Prompt History',
    'history.noRecords': 'No records',
    'history.clearRecords': 'Clear records',
    'history.summary': 'Total {total} · Completed {completed} · Processing {processing} · Queued {queued}',
    'history.filterAll': 'Show both',
    'history.filterTextToImage': 'Text to image',
    'history.filterImageToImage': 'Image to image',
    'history.emptyTextToImage': 'Submit a text prompt to generate images',
    'history.emptyImageToImage': 'Upload images and enter a prompt to transform them',
    'history.emptyGenerationAll': 'Submit a prompt or upload images to start generating',
    'history.waitQueued': 'Queued...',
    'history.waitGenerating': 'Generating...',
    'history.waitGeneratingMany': 'Generating (x{count})...',
    'history.waitConverting': 'Converting...',
    'history.waitConvertingMany': 'Converting (x{count})...',
    'history.elapsed': 'Elapsed {seconds}s · {model}',
    'history.checkProgress': 'Check progress',
    'history.failed': 'Task failed',
    'promptGallery.verifyTitle': 'Prompt Gallery Verification',
    'promptGallery.verifyMessage': 'Enter the password to open Prompt Gallery.',
    'promptGallery.verifyAction': 'Verify',
    'promptGallery.passwordWrong': 'Incorrect password',
    'promptGallery.passwordFailed': 'Password verification failed',
    'missingApiKey.title': 'Configure an API key first',
    'missingApiKey.description': 'Nova mode needs an API key before it can generate or transform images.',
  },
  zh: {
    'app.title': 'FlyReq Image',
    'app.subtitle': '批量 API 图像生成器',
    'app.metadataTitle': 'FlyReq Image - AI 图像生成器',
    'app.metadataDescription': 'FlyReq Image AI 图像生成工作台',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.delete': '删除',
    'common.retry': '重试',
    'common.settings': '设置',
    'common.close': '关闭',
    'common.loading': '加载中',
    'common.configure': '配置',
    'theme.label': '主题',
    'theme.switch': '切换主题',
    'theme.system': '跟随系统',
    'theme.light': '明亮',
    'theme.dark': '黑暗',
    'language.label': '语言',
    'language.switch': '切换语言',
    'language.en': 'English',
    'language.zh': '中文',
    'tabs.agent': 'Agent',
    'tabs.imageGeneration': '生图工作台',
    'tabs.canvas': '无限画布',
    'tabs.assets': '我的素材',
    'tabs.reversePrompt': '反推提示词',
    'tabs.gif': '动图生成',
    'tabs.promptGallery': '提示词广场',
    'toolbar.randomImage': '随机图片',
    'toolbar.baPeople': 'BA人物',
    'toolbar.bingWallpaper': 'Bing壁纸',
    'toolbar.wideMode': '宽屏',
    'toolbar.exitWideMode': '退出宽屏',
    'queue.concurrency': '并发 {count}',
    'queue.queued': '排队 {count}',
    'queue.queuedMax': '排队 {count} (最大{max})',
    'queue.status': '状态 {status}',
    'queue.statusOpen': '开启',
    'queue.statusClosed': '关闭',
    'queue.unknown': '排队状态未知',
    'history.generationTitle': '生图任务',
    'history.reverseTitle': '反推历史',
    'history.noRecords': '暂无记录',
    'history.clearRecords': '清空记录',
    'history.summary': '共 {total} 条 · 完成 {completed} · 处理中 {processing} · 排队 {queued}',
    'history.filterAll': '同时显示',
    'history.filterTextToImage': '文生图',
    'history.filterImageToImage': '图生图',
    'history.emptyTextToImage': '提交一段文字描述来生成图片',
    'history.emptyImageToImage': '上传图片并输入描述来转换',
    'history.emptyGenerationAll': '提交提示词或上传图片开始生成',
    'history.waitQueued': '排队中...',
    'history.waitGenerating': '生成中...',
    'history.waitGeneratingMany': '生成中 (x{count})...',
    'history.waitConverting': '转换中...',
    'history.waitConvertingMany': '转换中 (x{count})...',
    'history.elapsed': '已用 {seconds} 秒 · {model}',
    'history.checkProgress': '查看进度',
    'history.failed': '任务失败',
    'promptGallery.verifyTitle': '提示词广场验证',
    'promptGallery.verifyMessage': '请输入密码以开启提示词广场。',
    'promptGallery.verifyAction': '验证',
    'promptGallery.passwordWrong': '密码错误',
    'promptGallery.passwordFailed': '密码验证失败',
    'missingApiKey.title': '请先配置 API 密钥',
    'missingApiKey.description': 'Nova 模式需要先配置 API 密钥，配置完成后即可生成或转换图片。',
  },
} as const;

export type I18nKey = keyof typeof dictionaries.en;

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeToHtmlLang(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function getLocaleFromPathname(pathname: string): Locale | null {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return isLocale(firstSegment) ? firstSegment : null;
}

export function getPathForLocale(pathname: string, locale: Locale): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 0 && isLocale(parts[0])) {
    parts[0] = locale;
  } else {
    parts.unshift(locale);
  }
  return `/${parts.join('/')}/`;
}

export function translate(locale: Locale, key: I18nKey, values?: Record<string, string | number>): string {
  const template = dictionaries[locale][key] || dictionaries.en[key] || key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}
