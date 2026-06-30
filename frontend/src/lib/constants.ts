/**
 * 项目级共享常量
 * 统一管理魔术数字、外部链接等，避免在多文件中重复定义
 */

// ===== 外部 URL =====

/** BA 随机人物图片 */
export const BA_RANDOM_URL = 'https://img.catcdn.cn/ba/';

/** Bing 每日壁纸 */
export const BING_WALLPAPER_URL = 'https://bing.img.run/rand_uhd.php';

/** 图片模型 Key 配置指引，可按部署需要自由修改 */
export const IMAGE_MODEL_KEY_GUIDE = {
  title: '还没有图片模型 API Key？',
  description: '默认已为你准备 FlyReq 的 GPT Image 2 图片模型，只需要前往 FlyReq 获取 API Key，填入后保存即可开始生成图片。',
  ctaLabel: '前往 flyreq.com',
  url: 'https://flyreq.com',
};

// ===== 文件大小限制 =====

/** 上传文件最大字节数（10MB） */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

// ===== 时间间隔（毫秒） =====

/** 冷却/防抖间隔 */
export const COOLDOWN_MS = 5000;

/** Agent 轮询间隔 */
export const AGENT_POLL_INTERVAL_MS = 4000;

// ===== 图像处理 =====

/** 预览图最大边长 */
export const PREVIEW_MAX_SIDE = 512;
