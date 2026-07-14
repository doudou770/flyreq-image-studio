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
import type { ProviderProtocol } from '@/lib/flyreq-models';

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
  /** 所选文本模型的上游协议。 */
  protocol: ProviderProtocol;
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

/**
 * 使用用户选择的文本模型发起一次 Agent 流式对话。
 * @param input 包含模型协议、鉴权、历史消息和工具目录的请求参数。
 * @param callbacks 接收文本、推理摘要、提案和错误状态的回调集合。
 * @param baseUrl 文本模型服务的基础地址。
 * @returns 可取消本次对话并等待其结束的句柄。
 */
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

/**
 * 在可恢复错误时重试 Agent 流式请求，并在每次重试前通知界面清空旧输出。
 * @param baseUrl 文本模型服务的基础地址。
 * @param input 包含模型协议、鉴权和聊天上下文的请求参数。
 * @param callbacks 接收流式状态的回调集合。
 * @param signal 用户取消请求使用的中止信号。
 * @returns 流式请求成功结束时无返回值；最终失败时抛出错误。
 */
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

/**
 * 按文本模型协议选择 OpenAI 或 Gemini 流式对话实现。
 * @param baseUrl 文本模型服务的基础地址。
 * @param input 包含模型协议、鉴权和聊天上下文的请求参数。
 * @param callbacks 接收文本、提案和错误状态的回调集合。
 * @param signal 当前尝试的取消与超时信号。
 * @returns 流结束后无返回值；超时或上游错误时抛出错误。
 */
async function runAgentStream(
  baseUrl: string,
  input: StreamAgentInput,
  callbacks: StreamAgentCallbacks,
  signal: AbortSignal,
): Promise<void> {
  if (input.protocol === 'google') {
    await runGeminiAgentStream(baseUrl, input, callbacks, signal);
    return;
  }

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

  const response = await fetch('/api/flyreq/proxy/text', {
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

  if (signal.aborted) {
    if (signal.reason instanceof AgentRequestTimeoutError) throw signal.reason;
    return;
  }
  fireDone();
}

interface GeminiAgentPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: unknown };
}

interface GeminiAgentStreamChunk {
  candidates?: Array<{ content?: { parts?: GeminiAgentPart[] } }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * 将 Agent 聊天历史转换为 Gemini GenerateContent 的角色消息格式。
 * @param history 按时间正序排列的 Agent 历史消息。
 * @returns Gemini 可接受的 user/model 消息数组。
 */
function buildGeminiAgentContents(history: AgentMessage[]) {
  return history
    .filter(message => message.role !== 'system-note' && message.role !== 'context-divider' && message.text.trim().length > 0)
    .map(message => ({
      role: message.role === 'user' ? 'user' : 'model',
      parts: [{ text: message.text }],
    }));
}

/**
 * 构建 Gemini 原生函数调用声明，保持提案字段与 OpenAI Responses 版本一致。
 * @param webSearch 是否为本轮对话启用 Google 搜索工具。
 * @returns Gemini GenerateContent 的工具配置数组。
 */
function buildGeminiAgentTools(webSearch: boolean) {
  const functionTool = {
    functionDeclarations: [{
      name: PROPOSE_IMAGE_ACTION_TOOL.name,
      description: PROPOSE_IMAGE_ACTION_TOOL.description,
      parametersJsonSchema: PROPOSE_IMAGE_ACTION_TOOL.parameters,
    }],
  };
  return webSearch ? [functionTool, { googleSearch: {} }] : [functionTool];
}

/**
 * 构建 Gemini Agent 流式对话的请求体。
 * @param input 包含历史、图片目录、模型目录和联网配置的输入参数。
 * @returns 可直接发送至 Gemini GenerateContent 端点的请求对象。
 */
function buildGeminiAgentRequest(input: StreamAgentInput) {
  return {
    systemInstruction: { parts: [{ text: buildInstructions(input.catalog, input.modelCatalog) }] },
    contents: buildGeminiAgentContents(input.history),
    tools: buildGeminiAgentTools(Boolean(input.webSearch)),
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
  };
}

/**
 * 将 Gemini 函数调用参数转换成统一的提案 JSON 文本。
 * @param value Gemini 返回的函数调用参数。
 * @returns 可交给提案解析器处理的 JSON 字符串；无有效参数时返回空字符串。
 */
function stringifyGeminiFunctionArgs(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * 使用 Gemini 原生流式 API 执行 Agent 对话并解析文本和提案函数调用。
 * @param baseUrl Gemini 服务基础地址。
 * @param input 包含模型、鉴权和聊天上下文的输入参数。
 * @param callbacks 接收文本、提案和错误状态的回调集合。
 * @param signal 当前请求的取消与超时信号。
 * @returns 流结束后无返回值；超时或上游错误时抛出错误。
 */
async function runGeminiAgentStream(
  baseUrl: string,
  input: StreamAgentInput,
  callbacks: StreamAgentCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/flyreq/proxy/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: 'google',
      baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      stream: true,
      requestBody: buildGeminiAgentRequest(input),
    }),
    signal,
  });

  if (!response.ok) throw await readHttpError(response);
  if (!response.body) throw new Error('响应没有可读流');

  let accumulated = '';
  let toolArgs = '';
  let fired = false;
  const fireDone = () => {
    if (fired) return;
    fired = true;
    callbacks.onDone(accumulated, parseProposalArguments(toolArgs));
  };

  await readSseStream(response.body, signal, event => {
    if (!event.data || event.data === '[DONE]') return;
    let chunk: GeminiAgentStreamChunk;
    try {
      chunk = JSON.parse(event.data) as GeminiAgentStreamChunk;
    } catch {
      return;
    }
    if (chunk.error?.message) throw new Error(chunk.error.message);
    if (chunk.promptFeedback?.blockReason) throw new Error(`内容被拦截: ${chunk.promptFeedback.blockReason}`);

    for (const candidate of chunk.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.functionCall?.name === PROPOSE_IMAGE_ACTION_TOOL.name) {
          const args = stringifyGeminiFunctionArgs(part.functionCall.args);
          if (args) toolArgs = args;
          continue;
        }
        // Gemini 的 thought 片段属于内部推理，不展示给用户。
        if (part.thought === true || typeof part.text !== 'string' || !part.text) continue;
        accumulated += part.text;
        callbacks.onDelta(part.text);
      }
    }
  });

  if (signal.aborted) {
    if (signal.reason instanceof AgentRequestTimeoutError) throw signal.reason;
    return;
  }
  fireDone();
}

// ===== 非流式视觉描述 =====

/**
 * 使用用户选择的文本模型为图片生成简短描述。
 * @param apiKey 上游 API 密钥。
 * @param model 文本模型标识。
 * @param imageDataUrl 待描述图片的 Data URL。
 * @param signal 可选的取消信号。
 * @param baseUrl 文本模型服务的基础地址。
 * @param protocol 文本模型的上游协议。
 * @returns 图片描述文本；模型无文本输出时返回空字符串。
 */
export async function describeImage(
  apiKey: string,
  model: string,
  imageDataUrl: string,
  signal?: AbortSignal,
  baseUrl: string = '',
  protocol: ProviderProtocol = 'openai',
): Promise<string> {
  return runAgentRequestWithRetry(
    attemptSignal => requestImageDescription(baseUrl, apiKey, model, imageDataUrl, protocol, attemptSignal),
    signal,
    AGENT_IMAGE_DESCRIBE_ATTEMPT_TIMEOUT_MS,
  );
}

/**
 * 按协议请求一次图片描述，并将超时处理交由上层重试器统一管理。
 * @param baseUrl 文本模型服务的基础地址。
 * @param apiKey 上游 API 密钥。
 * @param model 文本模型标识。
 * @param imageDataUrl 待描述图片的 Data URL。
 * @param protocol 文本模型的上游协议。
 * @param signal 当前请求的取消与超时信号。
 * @returns 图片描述文本；模型无文本输出时返回空字符串。
 */
async function requestImageDescription(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  protocol: ProviderProtocol,
  signal: AbortSignal,
): Promise<string> {
  if (protocol === 'google') {
    return requestGeminiImageDescription(baseUrl, apiKey, model, imageDataUrl, signal);
  }
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

  const response = await fetch('/api/flyreq/proxy/text', {
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

/**
 * 将图片 Data URL 拆分为 Gemini 内联图片所需的 MIME 类型和 Base64 数据。
 * @param imageDataUrl 原始图片 Data URL 或 Base64 文本。
 * @returns Gemini inlineData 结构所需的 MIME 类型与图片正文。
 */
function toGeminiInlineImage(imageDataUrl: string): { mimeType: string; data: string } {
  const matched = imageDataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  return {
    mimeType: matched?.[1] || 'image/jpeg',
    data: matched?.[2] || imageDataUrl.split(',')[1] || imageDataUrl,
  };
}

/**
 * 使用 Gemini 非流式 GenerateContent 接口生成图片文字描述。
 * @param baseUrl Gemini 服务基础地址。
 * @param apiKey 上游 API 密钥。
 * @param model Gemini 模型标识。
 * @param imageDataUrl 待描述图片的 Data URL。
 * @param signal 当前请求的取消与超时信号。
 * @returns 去除空白后的图片描述；模型未输出文本时返回空字符串。
 */
async function requestGeminiImageDescription(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch('/api/flyreq/proxy/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: 'google',
      baseUrl,
      apiKey,
      model,
      stream: false,
      requestBody: {
        contents: [{
          role: 'user',
          parts: [
            { text: AGENT_IMAGE_DESCRIBE_PROMPT },
            { inlineData: toGeminiInlineImage(imageDataUrl) },
          ],
        }],
      },
    }),
    signal,
  });
  if (!response.ok) throw await readHttpError(response);

  const data = await response.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  } | null;
  return data?.candidates
    ?.flatMap(candidate => candidate.content?.parts || [])
    .map(part => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim() || '';
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
