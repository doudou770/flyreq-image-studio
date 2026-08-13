const fs = require('fs');
const path = require('path');
const {
  getVideoUpstreamLogMaxChars,
  isVideoUpstreamLogEnabled,
  sanitizeVideoLogUrl,
  sanitizeVideoLogValue,
  summarizeVideoRequestBody,
  summarizeVideoRequestHeaders,
} = require('./video-upstream-logger');

const DEFAULT_LOG_DIR = path.join(__dirname, 'logs', 'image-upstream');
const initializedLogDirectories = new Map();
const warnedLogErrors = new Set();

/**
 * 判断图片上游日志是否启用。
 * @param {unknown} value 环境变量中的日志开关值。
 * @returns {boolean} 未配置时返回 true，仅 false、0、no、off 会关闭日志。
 */
function isImageUpstreamLogEnabled(value) {
  return isVideoUpstreamLogEnabled(value);
}

/**
 * 解析图片上游响应正文的最大日志字符数。
 * @param {unknown} value 环境变量中的字符数。
 * @returns {number} 限制在 1024 至 1048576 之间的字符数。
 */
function getImageUpstreamLogMaxChars(value) {
  return getVideoUpstreamLogMaxChars(value);
}

/**
 * 解析图片上游日志落盘目录。
 * @param {unknown} value 环境变量中的日志目录。
 * @returns {string} 绝对日志目录；未配置时返回后端默认目录。
 */
function getImageUpstreamLogDir(value) {
  const configured = String(value ?? '').trim();
  return path.resolve(configured || DEFAULT_LOG_DIR);
}

/**
 * 按进程本地时区生成日志日期。
 * @param {Date} [date] 用于计算日期的时间，默认使用当前时间。
 * @returns {string} YYYY-MM-DD 格式的本地日期。
 */
function getImageUpstreamLogDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取指定日期的图片上游日志文件路径。
 * @param {string} logDir 日志根目录。
 * @param {Date} [date] 用于确定文件日期的时间。
 * @returns {string} 当天 JSONL 日志文件的绝对路径。
 */
function getImageUpstreamLogFilePath(logDir, date = new Date()) {
  return path.join(getImageUpstreamLogDir(logDir), `image-upstream-${getImageUpstreamLogDate(date)}.log`);
}

/**
 * 确保图片日志目录存在，并复用同一目录的初始化任务。
 * @param {string} logDir 日志根目录。
 * @returns {Promise<void>} 目录创建完成后兑现的 Promise。
 */
function ensureImageUpstreamLogDir(logDir) {
  const resolved = getImageUpstreamLogDir(logDir);
  if (!initializedLogDirectories.has(resolved)) {
    initializedLogDirectories.set(resolved, fs.promises.mkdir(resolved, { recursive: true }));
  }
  return initializedLogDirectories.get(resolved);
}

/**
 * 将单条图片上游诊断记录追加到当天文件。
 * @param {'request'|'response'} event 请求或响应事件。
 * @param {'info'|'error'} level 日志级别。
 * @param {Record<string, unknown>} diagnostics 已脱敏的诊断内容。
 * @param {{ logDir?: string }} [options] 日志目录选项。
 * @returns {Promise<void>} 文件追加完成后兑现的 Promise；失败仅告警，不中断生图任务。
 */
function appendImageUpstreamLog(event, level, diagnostics, options = {}) {
  const logDir = getImageUpstreamLogDir(options.logDir);
  const timestamp = new Date();
  const line = JSON.stringify({ timestamp: timestamp.toISOString(), level, event, ...diagnostics }) + '\n';
  return ensureImageUpstreamLogDir(logDir)
    .then(() => fs.promises.appendFile(getImageUpstreamLogFilePath(logDir, timestamp), line, 'utf8'))
    .catch((error) => {
      // 日志失败不能影响图片任务；同一目录仅告警一次，避免持续刷屏。
      if (warnedLogErrors.has(logDir)) return;
      warnedLogErrors.add(logDir);
      console.warn(`[image-upstream] 日志文件写入失败 dir=${logDir}`, error?.message || error);
    });
}

/**
 * 估算 Base64 图片正文解码后的字节数。
 * @param {unknown} value Base64 编码值。
 * @returns {number} 去除填充后的近似字节数。
 */
function estimateImageBase64Bytes(value) {
  const compact = String(value || '').replace(/\s/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
}

/**
 * 递归替换 OpenAI 和 Gemini 请求/响应中的裸 Base64 图片字段。
 * @param {unknown} value 待处理的结构化值。
 * @param {string} [key] 当前字段名。
 * @param {string} [parentKey] 父级字段名。
 * @returns {unknown} 图片正文已替换为字节数摘要的结构。
 */
function summarizeImagePayload(value, key = '', parentKey = '') {
  const normalizedKey = String(key).toLowerCase().replace(/[-_]/g, '');
  const normalizedParentKey = String(parentKey).toLowerCase().replace(/[-_]/g, '');
  const isBase64Image = normalizedKey === 'b64json'
    || (normalizedKey === 'data' && normalizedParentKey === 'inlinedata');
  if (isBase64Image && typeof value === 'string') {
    return `<图片 Base64 已省略；字节数=${estimateImageBase64Bytes(value)}>`;
  }
  if (Array.isArray(value)) return value.map(item => summarizeImagePayload(item, '', key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    summarizeImagePayload(childValue, childKey, key),
  ]));
}

/**
 * 汇总图片上游请求体，保留参数并移除认证信息和图片正文。
 * @param {unknown} body fetch 请求体。
 * @returns {unknown} 可安全写入日志的请求体摘要。
 */
function summarizeImageRequestBody(body) {
  if (typeof body !== 'string') return summarizeVideoRequestBody(body);
  try {
    return sanitizeVideoLogValue(summarizeImagePayload(JSON.parse(body)));
  } catch {
    return summarizeVideoRequestBody(body);
  }
}

/**
 * 汇总图片上游响应正文并限制最大日志长度。
 * @param {string|undefined|null} responseText 已读取的响应正文。
 * @param {number} maxChars 最大日志字符数。
 * @returns {unknown} 安全的结构化响应或截断文本。
 */
function summarizeImageResponseBody(responseText, maxChars) {
  if (responseText === undefined || responseText === null) return '<响应正文未读取>';
  const raw = String(responseText);
  let serialized;
  try {
    serialized = JSON.stringify(sanitizeVideoLogValue(summarizeImagePayload(JSON.parse(raw))), null, 2);
  } catch {
    serialized = String(sanitizeVideoLogValue(raw));
  }
  if (serialized.length <= maxChars) {
    try { return JSON.parse(serialized); } catch { return serialized || '<empty>'; }
  }
  return `${serialized.slice(0, maxChars)}\n...[响应已截断，脱敏后字符数=${serialized.length}]`;
}

/**
 * 记录一次图片上游请求。
 * @param {string} stage 请求阶段。
 * @param {string|URL} url 上游请求地址。
 * @param {RequestInit} init fetch 请求参数。
 * @param {Record<string, unknown>} context 任务诊断上下文。
 * @param {{ enabled?: boolean, logDir?: string }} [options] 日志配置。
 * @returns {void} 无返回值；启用时同步输出控制台并异步落盘。
 */
function logImageUpstreamRequest(stage, url, init = {}, context = {}, options = {}) {
  if (options.enabled === false) return;
  const diagnostics = sanitizeVideoLogValue({
    stage,
    method: init.method || 'GET',
    url: sanitizeVideoLogUrl(url),
    headers: summarizeVideoRequestHeaders(init.headers),
    context,
    body: summarizeImageRequestBody(init.body),
  });
  console.info('[image-upstream] 上游请求\n' + JSON.stringify(diagnostics, null, 2));
  void appendImageUpstreamLog('request', 'info', diagnostics, options);
}

/**
 * 记录一次图片上游响应，错误响应使用错误日志级别。
 * @param {string} stage 请求阶段。
 * @param {string|URL} url 上游请求地址。
 * @param {Response} response 上游 HTTP 响应。
 * @param {string|undefined|null} responseText 已读取的响应正文。
 * @param {Record<string, unknown>} context 任务诊断上下文。
 * @param {{ enabled?: boolean, maxChars?: number, isError?: boolean, logDir?: string }} [options] 日志配置。
 * @returns {void} 无返回值；启用时同步输出控制台并异步落盘。
 */
function logImageUpstreamResponse(stage, url, response, responseText, context = {}, options = {}) {
  if (options.enabled === false) return;
  const diagnostics = sanitizeVideoLogValue({
    stage,
    url: sanitizeVideoLogUrl(url),
    status: response.status,
    statusText: response.statusText,
    headers: summarizeVideoRequestHeaders(response.headers),
    context,
    body: summarizeImageResponseBody(responseText, getImageUpstreamLogMaxChars(options.maxChars)),
  });
  const isError = Boolean(options.isError || !response.ok);
  (isError ? console.error : console.info)('[image-upstream] 上游响应\n' + JSON.stringify(diagnostics, null, 2));
  void appendImageUpstreamLog('response', isError ? 'error' : 'info', diagnostics, options);
}

module.exports = {
  appendImageUpstreamLog,
  getImageUpstreamLogDate,
  getImageUpstreamLogDir,
  getImageUpstreamLogFilePath,
  getImageUpstreamLogMaxChars,
  isImageUpstreamLogEnabled,
  logImageUpstreamRequest,
  logImageUpstreamResponse,
  summarizeImagePayload,
  summarizeImageRequestBody,
  summarizeImageResponseBody,
};
