import type { AspectRatio, OutputSize } from '@/lib/gemini-config';
import type { GptImageBackground, GptImageOutputFormat, GptImageQuality, GptImageStyle } from '@/lib/model-capabilities';
import {
  getCompleteImageModels,
  getCompleteTextModels,
  getCompleteVideoModels,
  getImageModelById,
  getResolvedImageModelId,
  getResolvedVideoModelId,
  getTextModelById,
  loadRegistry,
  getImageApiFlavor,
  type ImageApiFlavor,
  type ProviderProtocol,
} from '@/lib/flyreq-models';
import {
  normalizeModelBaseUrl,
} from '@/lib/model-endpoints';

export interface ImageReference {
  data: string;
  mimeType: string;
}

export interface ModelStatus {
  modelId: string;
  available: boolean;
  actualName?: string;
  message?: string;
}

const MODEL_CHECK_TIMEOUT = 30000;
const TASK_REQUEST_TIMEOUT = 30000;
const CREATE_TASK_TIMEOUT = 60000;

export type FlyreqTaskMode = 'text-to-image' | 'image-to-image';
export type FlyreqTaskStatus = 'queued' | '排队中' | 'processing' | 'completed' | 'failed' | 'expired';

export interface FlyreqTaskSseResult {
  responses: number;
  requests: number;
}

export interface RemoteModelOption {
  id: string;
  name: string;
}

/**
 * 根据用户填写的上游地址、密钥和协议获取可选模型目录。
 * @param input 上游 Base URL、API Key 与协议。
 * @returns 去重并按模型标识排序的远端模型选项。
 */
export async function fetchRemoteModels(input: { baseUrl: string; apiKey: string; protocol: ProviderProtocol }): Promise<RemoteModelOption[]> {
  if (!input.baseUrl.trim() || !input.apiKey.trim()) throw new Error('请先填写 Base URL 和 API Key');
  const response = await fetch('/api/flyreq/proxy/models', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as {
    data?: Array<{ id?: string; model?: string; displayName?: string; name?: string }>;
    models?: Array<{ id?: string; model?: string; displayName?: string; name?: string }>;
    error?: string | { message?: string };
  };
  if (!response.ok) {
    const detail = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(detail || `获取模型失败（HTTP ${response.status}）`);
  }
  const rows = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
  const unique = new Map<string, RemoteModelOption>();
  for (const row of rows) {
    const id = String(row?.id || row?.model || '').replace(/^models\//, '').trim();
    if (!id) continue;
    unique.set(id, { id, name: String(row?.displayName || row?.name || id).trim() || id });
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export interface CreateFlyreqTaskInput {
  apiKey: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  imageApiFlavor?: ImageApiFlavor;
  mode: FlyreqTaskMode;
  prompt: string;
  outputSize: OutputSize;
  customSize?: string;
  customSizeAlignMultiple?: boolean;
  aspectRatio: AspectRatio;
  temperature?: number;
  model: string;
  gptImageQuality?: GptImageQuality;
  gptImageStyle?: GptImageStyle;
  gptImageBackground?: GptImageBackground;
  gptImageOutputFormat?: GptImageOutputFormat;
  streamImages?: boolean;
  parallelCount: number;
  promptVariants?: string[];
  /** 每张拆分图片实际发送给上游的完整提示词。 */
  effectivePrompts?: string[];
  images: ImageReference[];
}

export interface FlyreqTaskResponse {
  id: string;
  status: FlyreqTaskStatus;
  mode?: FlyreqTaskMode;
  result?: { images?: string[]; sse?: FlyreqTaskSseResult };
  error?: string;
  warning?: string;
  createdAt?: string;
  completedAt?: string;
  expiresAt?: string;
}

export interface FlyreqQueueStatus {
  concurrencyLimit: number;
  configuredConcurrency: number;
  processingCount: number;
  queuedCount: number;
  pendingCount?: number;
  processingSlots?: number;
  queuedSlots?: number;
  pendingSlots?: number;
  maxQueueSize?: number;
  remainingQueueSlots?: number;
  displayConcurrency: number;
  displayQueued: number;
  acceptingNewTasks: boolean;
  rateLimitWindowMs?: number;
  rateLimitMaxRequestsPerIp?: number;
  rateLimitMaxRequestsPerApiKey?: number;
  retryAfterSeconds?: number;
  serverMessage?: string;
}

export class FlyreqTaskError extends Error {
  statusCode: number;
  code?: string;
  retryAfter?: number;

  constructor(message: string, statusCode: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'FlyreqTaskError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

interface CreateTaskResponse {
  taskId?: string;
}

interface CreateTaskBatchResponse {
  taskIds?: string[];
}

function getObjectProperty(data: unknown, key: string): unknown {
  return typeof data === 'object' && data !== null && key in data
    ? (data as Record<string, unknown>)[key]
    : undefined;
}

async function parseTaskResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = getObjectProperty(data, 'error');
    const code = getObjectProperty(data, 'code');
    const retryAfter = getObjectProperty(data, 'retryAfter');
    throw new FlyreqTaskError(
      typeof error === 'string' ? error : `任务请求失败: ${response.status}`,
      response.status,
      typeof code === 'string' ? code : undefined,
      typeof retryAfter === 'number' ? retryAfter : undefined,
    );
  }
  return data as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function normalizeModelCheckError(error: unknown): Error {
  const errorMessage = getErrorMessage(error);
  const lowerMessage = errorMessage.toLowerCase();

  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('abort') ||
    lowerMessage.includes('请求超时')
  ) {
    return new Error('模型检查超时，请稍后重试。');
  }

  if (
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('networkerror') ||
    lowerMessage.includes('network request failed') ||
    lowerMessage.includes('load failed') ||
    lowerMessage.includes('network connection was lost') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('socket hang up') ||
    lowerMessage.includes('terminated')
  ) {
    return new Error('网络连接失败。请检查网络连接或稍后重试。');
  }

  return error instanceof Error ? error : new Error(errorMessage);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = MODEL_CHECK_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('请求超时');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 创建一个兼容旧调用方的服务端生图任务。
 * @param input 单个服务端任务的完整请求参数。
 * @returns 新建服务端任务标识。
 */
export async function createFlyreqTask(input: CreateFlyreqTaskInput): Promise<string> {
  const response = await fetchWithTimeout('/api/flyreq/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, CREATE_TASK_TIMEOUT);
  const data = await parseTaskResponse<CreateTaskResponse>(response);
  if (!data?.taskId) throw new Error('创建任务失败：后端未返回任务 ID');
  return data.taskId;
}

/**
 * 原子创建多张图片对应的独立服务端任务。
 * @param input 多图提交参数，parallelCount 表示需要创建的独立任务数量。
 * @returns 按图片序号排序的服务端任务标识列表。
 */
export async function createFlyreqTasks(input: CreateFlyreqTaskInput): Promise<string[]> {
  const response = await fetchWithTimeout('/api/flyreq/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, CREATE_TASK_TIMEOUT);
  const data = await parseTaskResponse<CreateTaskBatchResponse>(response);
  if (!Array.isArray(data?.taskIds) || data.taskIds.length !== input.parallelCount || data.taskIds.some(taskId => !taskId)) {
    throw new Error('创建任务失败：后端未返回完整任务 ID 列表');
  }
  return data.taskIds;
}

export async function checkModelsAvailability(
  targetModelIds?: string[],
): Promise<ModelStatus[]> {
  try {
    const registry = loadRegistry();
    const completeImageModels = getCompleteImageModels(registry);
    const completeTextModels = getCompleteTextModels(registry);
    const completeVideoModels = getCompleteVideoModels(registry);
    const configuredModels = [
      ...completeImageModels.map((model) => ({
        id: model.id,
        name: model.name,
        protocol: model.protocol,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelId: getResolvedImageModelId(model),
      })),
      ...completeTextModels.map((model) => ({
        id: model.id,
        name: model.name,
        protocol: model.protocol,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelId: model.modelId,
      })),
      ...completeVideoModels.map((model) => ({
        id: model.id,
        name: model.name,
        // 三种视频协议均通过 Bearer 认证的 /v1/models 执行可用性检查。
        protocol: 'openai' as const,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelId: getResolvedVideoModelId(model),
      })),
    ];

    const filteredModels = targetModelIds && targetModelIds.length > 0
      ? configuredModels.filter((model) => targetModelIds.includes(model.id))
      : configuredModels;

    if (filteredModels.length === 0) {
      return [];
    }

    return Promise.all(filteredModels.map(async (model) => {
      try {
        const normalizedBaseUrl = normalizeModelBaseUrl(model.protocol, model.baseUrl);
        if (!normalizedBaseUrl || !model.apiKey || !model.modelId) {
          return {
            modelId: model.id,
            actualName: model.name,
            available: false,
            message: '模型配置不完整',
          };
        }

        // 复用安全的 POST 目录请求，确保 API Key 不会进入查询字符串和访问日志。
        const remoteModels = await fetchRemoteModels({ baseUrl: normalizedBaseUrl, apiKey: model.apiKey, protocol: model.protocol });
        const exists = remoteModels.some(item => item.id === model.modelId);
        return {
          modelId: model.id,
          actualName: model.name,
          available: exists,
          message: exists ? model.modelId : `未在 /models 中找到 ${model.modelId}`,
        };
      } catch (error) {
        return {
          modelId: model.id,
          actualName: model.name,
          available: false,
          message: getErrorMessage(error),
        };
      }
    }));
  } catch (error) {
    throw normalizeModelCheckError(error);
  }
}

/**
 * 根据渠道配置解析请求凭据，并允许工作台覆盖本次请求使用的远端模型 ID。
 * @param modelId 图片渠道的内部配置 ID。
 * @param selectedModelId 工作台选择的远端模型 ID；为空时回退渠道默认模型。
 * @returns 当前请求需要的协议、凭据、模型和渠道能力标识。
 */
export function resolveImageTaskProvider(modelId: string, selectedModelId?: string): { apiKey: string; baseUrl: string; protocol: ProviderProtocol; modelId: string; imageApiFlavor?: ImageApiFlavor; streamImages?: boolean; supportsTemperature?: boolean } {
  const registry = loadRegistry();
  const model = getImageModelById(registry, modelId);
  if (!model) throw new Error(`未找到图片模型配置: ${modelId}`);
  const normalizedBaseUrl = normalizeModelBaseUrl(model.protocol, model.baseUrl);
  return {
    apiKey: model.apiKey,
    baseUrl: normalizedBaseUrl,
    protocol: model.protocol,
    modelId: selectedModelId?.trim() || getResolvedImageModelId(model),
    imageApiFlavor: getImageApiFlavor(model),
    streamImages: model.protocol === 'openai' ? Boolean(model.streamImages) : false,
    supportsTemperature: model.protocol === 'google' && model.supportsTemperature === true,
  };
}

export function resolveTextTaskProvider(modelId: string): { apiKey: string; baseUrl: string; protocol: ProviderProtocol } {
  const registry = loadRegistry();
  const model = getTextModelById(registry, modelId);
  if (!model) throw new Error(`未找到文本模型配置: ${modelId}`);
  const normalizedBaseUrl = normalizeModelBaseUrl(model.protocol, model.baseUrl);
  return {
    apiKey: model.apiKey,
    baseUrl: normalizedBaseUrl,
    protocol: model.protocol,
  };
}

export async function getFlyreqTask(taskId: string): Promise<FlyreqTaskResponse> {
  const response = await fetchWithTimeout(`/api/flyreq/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    cache: 'no-store',
  }, TASK_REQUEST_TIMEOUT);
  return parseTaskResponse(response);
}

export async function getFlyreqQueueStatus(): Promise<FlyreqQueueStatus> {
  const response = await fetchWithTimeout('/api/flyreq/queue-status', {
    method: 'GET',
    cache: 'no-store',
  }, TASK_REQUEST_TIMEOUT);
  return parseTaskResponse(response);
}

export async function ackFlyreqTask(taskId: string): Promise<void> {
  await fetch(`/api/flyreq/tasks/${encodeURIComponent(taskId)}/ack`, {
    method: 'POST',
  }).catch(() => undefined);
}

