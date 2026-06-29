// Agent 模式的浏览器直连客户端
// 文本对话与视觉描述都打外部 API /v1/responses（与反推提示词一致，不经过自有后端）。
// 对话请求带 tools，解析文字 delta 与 function_call 事件；描述请求为非流式一次性取全文。

import {
  AGENT_TEXT_MODEL_FALLBACK,
  AGENT_SYSTEM_INSTRUCTIONS,
  AGENT_IMAGE_DESCRIBE_PROMPT,
  PROPOSE_IMAGE_ACTION_TOOL,
  type AgentMessage,
  type AgentProposal,
  type AgentActionType,
} from '@/lib/agent-chat-config';
import {
  normalizeGptImageBackground,
  normalizeGptImageQuality,
  normalizeGptImageStyle,
  type AgentModelCatalogEntry,
} from '@/lib/model-capabilities';

import { readSseStream } from '@/lib/sse-stream-parser';

const AGENT_GPT_REQUEST_MAX_ATTEMPTS = 3;
const AGENT_CHAT_ATTEMPT_TIMEOUT_MS = 45_000;
const AGENT_IMAGE_DESCRIBE_ATTEMPT_TIMEOUT_MS = 20_000;

class AgentRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`请求超过 ${Math.round(timeoutMs / 1000)} 秒未响应`);
    this.name = 'AgentRequestTimeoutError';
  }
}

export interface AgentCatalogEntry {
  imgId: string;
  description: string;
}

export interface StreamAgentInput {
  apiKey: string;
  model: string;
  /** 历史消息（不含本轮，需按时间正序传入） */
  history: AgentMessage[];
  /** 当前可用图片目录 */
  catalog: AgentCatalogEntry[];
  /** 当前可用图像模型目录（供 Agent 选择模型） */
  modelCatalog: AgentModelCatalogEntry[];
  /** 是否启用联网搜索工具 */
  webSearch?: boolean;
}

export interface StreamAgentCallbacks {
  onDelta(token: string): void;
  /** 思考摘要增量（reasoning summary，非原始 CoT） */
  onReasoning(token: string): void;
  /** 模型完成本回合：fullText 为对话文本，proposal 为解析出的工具调用（无则 null） */
  onDone(fullText: string, proposal: AgentProposal | null): void;
  onRetry?(attempt: number, maxAttempts: number, err: Error): void;
  onResetAttempt?(): void;
  onError(err: Error): void;
}

export interface StreamAgentHandle {
  abort(): void;
  promise: Promise<void>;
}

function buildInstructions(catalog: AgentCatalogEntry[], modelCatalog: AgentModelCatalogEntry[]): string {
  let instructions = AGENT_SYSTEM_INSTRUCTIONS;

  // 模型目录
  if (modelCatalog.length > 0) {
    const modelLines = modelCatalog
      .map(m => `- id: ${m.id}, 名称: "${m.name}", 最大分辨率: ${m.maxOutputSize}`)
      .join('\n');
    instructions += `\n\n当前可用图像模型：\n${modelLines}`;
  } else {
    instructions += '\n\n当前可用图像模型：（空，请在设置中配置）';
  }

  // 图片目录
  if (catalog.length === 0) {
    instructions += '\n\n当前可用图片目录：（空，还没有任何图片）';
  } else {
    const lines = catalog.map(entry => `[${entry.imgId}] ${entry.description}`).join('\n');
    instructions += `\n\n当前可用图片目录：\n${lines}`;
  }

  return instructions;
}

function buildInputMessages(history: AgentMessage[]) {
  return history
    .filter(message => message.role !== 'system-note' && message.role !== 'context-divider' && message.text.trim().length > 0)
    .map(message => (
      message.role === 'user'
        ? { role: 'user' as const, content: [{ type: 'input_text' as const, text: message.text }] }
        : { role: 'assistant' as const, content: [{ type: 'output_text' as const, text: message.text }] }
    ));
}

interface ResponsesEventEnvelope {
  type?: string;
  delta?: string;
  text?: string;
  arguments?: string;
  item?: {
    type?: string;
    name?: string;
    arguments?: string;
  };
  response?: {
    output_text?: string;
    output?: Array<{ type?: string; name?: string; arguments?: string }>;
  };
  error?: { message?: string };
  message?: string;
}

function normalizeAction(value: unknown): AgentActionType {
  return value === 'edit' ? 'edit' : 'generate';
}

function parseProposalArguments(raw: string): AgentProposal | null {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const action = normalizeAction(parsed.action);
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    const ids = Array.isArray(parsed.referenced_image_ids)
      ? parsed.referenced_image_ids.filter((id): id is string => typeof id === 'string')
      : [];
    if (prompt.trim().length === 0) return null;

    const requestedAspectRatio = typeof parsed.requested_aspect_ratio === 'string' && parsed.requested_aspect_ratio.trim().length > 0
      ? parsed.requested_aspect_ratio.trim()
      : undefined;
    const suggestedAspectRatio = typeof parsed.suggested_aspect_ratio === 'string' && parsed.suggested_aspect_ratio.trim().length > 0
      ? parsed.suggested_aspect_ratio.trim()
      : undefined;
    const requestedOutputSize = typeof parsed.requested_output_size === 'string' && parsed.requested_output_size.trim().length > 0
      ? parsed.requested_output_size.trim()
      : undefined;
    const temperature = typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)
      ? parsed.temperature
      : undefined;
    const parallelCount = typeof parsed.parallel_count === 'number' && Number.isFinite(parsed.parallel_count)
      ? parsed.parallel_count
      : undefined;
    const gptImageQuality = normalizeGptImageQuality(typeof parsed.gpt_image_quality === 'string' ? parsed.gpt_image_quality : undefined);
    const gptImageStyle = normalizeGptImageStyle(typeof parsed.gpt_image_style === 'string' ? parsed.gpt_image_style : undefined);
    const gptImageBackground = normalizeGptImageBackground(typeof parsed.gpt_image_background === 'string' ? parsed.gpt_image_background : undefined);
    const requestedModelId = typeof parsed.requested_model_id === 'string' && parsed.requested_model_id.trim().length > 0
      ? parsed.requested_model_id.trim()
      : undefined;

    return {
      action,
      prompt,
      reason,
      referencedImageIds: ids,
      requestedAspectRatio,
      suggestedAspectRatio,
      requestedOutputSize,
      temperature,
      parallelCount,
      gptImageQuality,
      gptImageStyle,
      gptImageBackground,
      requestedModelId,
    };
  } catch {
    return null;
  }
}

export function streamAgentChat(
  input: StreamAgentInput,
  callbacks: StreamAgentCallbacks,
  baseUrl: string = '',
): StreamAgentHandle {
  const controller = new AbortController();

  const promise = (async () => {
    try {
      await runAgentStreamWithRetry(baseUrl, input, callbacks, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      callbacks.onError(normalizeStreamError(err));
    }
  })();

  return {
    abort: () => controller.abort(),
    promise,
  };
}

async function runAgentStreamWithRetry(
  baseUrl: string,
  input: StreamAgentInput,
  callbacks: StreamAgentCallbacks,
  signal: AbortSignal,
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= AGENT_GPT_REQUEST_MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) return;
    try {
      await runAttemptWithTimeout(
        attemptSignal => runAgentStream(baseUrl, input, callbacks, attemptSignal),
        signal,
        AGENT_CHAT_ATTEMPT_TIMEOUT_MS,
      );
      return;
    } catch (err) {
      if (signal.aborted) return;
      const normalized = normalizeStreamError(err);
      lastError = normalized;
      if (attempt >= AGENT_GPT_REQUEST_MAX_ATTEMPTS || !isRetryableAgentError(err)) {
        throw normalized;
      }
      callbacks.onResetAttempt?.();
      callbacks.onRetry?.(attempt + 1, AGENT_GPT_REQUEST_MAX_ATTEMPTS, normalized);
    }
  }
  throw lastError || new Error('模型请求失败');
}

async function runAgentStream(
  baseUrl: string,
  input: StreamAgentInput,
  callbacks: StreamAgentCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const body = {
    model: input.model || AGENT_TEXT_MODEL_FALLBACK,
    stream: true,
    reasoning: { effort: 'medium' as const, summary: 'detailed' as const },
    instructions: buildInstructions(input.catalog, input.modelCatalog),
    tools: input.webSearch
      ? [PROPOSE_IMAGE_ACTION_TOOL, { type: 'web_search' as const }]
      : [PROPOSE_IMAGE_ACTION_TOOL],
    tool_choice: 'auto' as const,
    input: buildInputMessages(input.history),
  };

  const response = await fetch('/api/nova/proxy/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: 'openai',
      baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      stream: true,
      requestBody: body,
    }),
    signal,
  });

  if (!response.ok) {
    throw await readHttpError(response);
  }
  if (!response.body) {
    throw new Error('响应没有可读流');
  }

  let accumulated = '';
  let toolArgs = '';
  let fired = false;

  const fireDone = () => {
    if (fired) return;
    fired = true;
    callbacks.onDone(accumulated, parseProposalArguments(toolArgs));
  };

  await readSseStream(response.body, signal, (event) => {
    if (!event.data) return;
    if (event.data === '[DONE]') {
      fireDone();
      return;
    }

    let payload: ResponsesEventEnvelope;
    try {
      payload = JSON.parse(event.data) as ResponsesEventEnvelope;
    } catch {
      return;
    }

    const eventType = payload.type || event.event || '';

    if (eventType === 'response.reasoning_summary_text.delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      if (delta) callbacks.onReasoning(delta);
      return;
    }

    if (eventType === 'response.reasoning_summary_part.added') {
      // 多段思考之间补一个换行，避免粘连
      callbacks.onReasoning('\n');
      return;
    }

    if (eventType === 'response.output_text.delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      if (delta) {
        accumulated += delta;
        callbacks.onDelta(delta);
      }
      return;
    }

    if (eventType === 'response.output_text.done') {
      if (typeof payload.text === 'string' && payload.text.length > accumulated.length) {
        const tail = payload.text.slice(accumulated.length);
        if (tail) {
          accumulated = payload.text;
          callbacks.onDelta(tail);
        }
      }
      return;
    }

    if (eventType === 'response.function_call_arguments.delta') {
      if (typeof payload.delta === 'string') {
        toolArgs += payload.delta;
      }
      return;
    }

    if (eventType === 'response.function_call_arguments.done') {
      if (typeof payload.arguments === 'string' && payload.arguments.length > 0) {
        toolArgs = payload.arguments;
      }
      return;
    }

    if (eventType === 'response.output_item.done') {
      if (payload.item?.type === 'function_call' && typeof payload.item.arguments === 'string' && payload.item.arguments.length > 0) {
        toolArgs = payload.item.arguments;
      }
      return;
    }

    if (eventType === 'response.completed') {
      const fullText = payload.response?.output_text;
      if (typeof fullText === 'string' && fullText.length > accumulated.length) {
        const tail = fullText.slice(accumulated.length);
        if (tail) {
          accumulated = fullText;
          callbacks.onDelta(tail);
        }
      }
      const call = payload.response?.output?.find(item => item.type === 'function_call' && typeof item.arguments === 'string');
      if (call?.arguments && toolArgs.trim().length === 0) {
        toolArgs = call.arguments;
      }
      fireDone();
      return;
    }

    if (eventType === 'error' || eventType === 'response.error') {
      const message = payload.error?.message || payload.message || '模型返回错误';
      throw new Error(message);
    }
  });

  fireDone();
}

// ===== 非流式视觉描述 =====

export async function describeImage(
  apiKey: string,
  model: string,
  imageDataUrl: string,
  signal?: AbortSignal,
  baseUrl: string = '',
): Promise<string> {
  return runAgentRequestWithRetry(
    attemptSignal => requestImageDescription(baseUrl, apiKey, model, imageDataUrl, attemptSignal),
    signal,
    AGENT_IMAGE_DESCRIBE_ATTEMPT_TIMEOUT_MS,
  );
}

async function requestImageDescription(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const body = {
    model: model || AGENT_TEXT_MODEL_FALLBACK,
    stream: false,
    reasoning: { effort: 'low' as const },
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: AGENT_IMAGE_DESCRIBE_PROMPT },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      },
    ],
  };

  const response = await fetch('/api/nova/proxy/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: 'openai',
      baseUrl,
      apiKey,
      model,
      stream: false,
      requestBody: body,
    }),
    signal,
  });

  if (!response.ok) {
    throw await readHttpError(response);
  }

  const data = await response.json().catch(() => null) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  } | null;

  if (!data) return '';

  if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
    return data.output_text.trim();
  }

  const fromOutput = data.output
    ?.flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('')
    .trim();

  return fromOutput || '';
}

// ===== 工具函数 =====

function createAttemptSignal(parentSignal?: AbortSignal): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  if (!parentSignal) {
    return {
      signal: controller.signal,
      abort: reason => controller.abort(reason),
      cleanup: () => undefined,
    };
  }
  if (parentSignal.aborted) controller.abort(parentSignal.reason);
  const abortFromParent = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', abortFromParent, { once: true });
  return {
    signal: controller.signal,
    abort: reason => controller.abort(reason),
    cleanup: () => parentSignal.removeEventListener('abort', abortFromParent),
  };
}

async function runAttemptWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const attempt = createAttemptSignal(parentSignal);
  const timeoutError = new AgentRequestTimeoutError(timeoutMs);
  const timeoutId = window.setTimeout(() => {
    if (!attempt.signal.aborted) attempt.abort(timeoutError);
  }, timeoutMs);

  try {
    return await request(attempt.signal);
  } catch (err) {
    if (attempt.signal.reason instanceof AgentRequestTimeoutError) {
      throw attempt.signal.reason;
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    attempt.cleanup();
  }
}

async function runAgentRequestWithRetry<T>(
  request: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= AGENT_GPT_REQUEST_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    try {
      return await runAttemptWithTimeout(request, signal, timeoutMs);
    } catch (err) {
      if (signal?.aborted) throw err;
      const normalized = normalizeStreamError(err);
      lastError = normalized;
      if (attempt >= AGENT_GPT_REQUEST_MAX_ATTEMPTS || !isRetryableAgentError(err)) {
        throw normalized;
      }
    }
  }
  throw lastError || new Error('模型请求失败');
}

async function readHttpError(response: Response): Promise<Error> {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    // ignore
  }
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      const message = parsed?.error?.message || parsed?.error || parsed?.message;
      if (typeof message === 'string' && message.length > 0) {
        return new Error(`${response.status} ${response.statusText}: ${message}`);
      }
    } catch {
      // 不是 JSON
    }
  }
  return new Error(`${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
}

function isRetryableAgentError(error: unknown): boolean {
  if (error instanceof AgentRequestTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return [
    '408',
    '409',
    '425',
    '429',
    '500',
    '502',
    '503',
    '504',
    'failed to fetch',
    'network',
    'load failed',
    'econnreset',
    'terminated',
    'timeout',
    'timed out',
    '超时',
    '超过',
    'rate limit',
    'temporarily',
    'overloaded',
  ].some(keyword => lower.includes(keyword));
}

function normalizeStreamError(error: unknown): Error {
  if (error instanceof AgentRequestTimeoutError) {
    return new Error(`${error.message}，已自动重试 ${AGENT_GPT_REQUEST_MAX_ATTEMPTS} 次仍未成功`);
  }
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes('failed to fetch')
      || lower.includes('network')
      || lower.includes('load failed')
      || lower.includes('econnreset')
      || lower.includes('terminated')
    ) {
      return new Error(`网络连接失败，已自动重试 ${AGENT_GPT_REQUEST_MAX_ATTEMPTS} 次仍未成功`);
    }
    return error;
  }
  return new Error(String(error));
}
