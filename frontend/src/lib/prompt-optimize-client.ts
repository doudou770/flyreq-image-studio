// 提示词优化流式客户端。
// 根据用户配置的 OpenAI 或 Gemini 协议构造请求，并按模式附带不同的系统规则。
// 图生图/动图模式会将参考图随同一次流式请求发送。

import { readSseStream } from '@/lib/sse-stream-parser';
import type { ProviderProtocol } from '@/lib/flyreq-models';

const OPTIMIZE_TIMEOUT_MS = 30_000;
const OPTIMIZE_MAX_ATTEMPTS = 2;

// ===== 模式与输入 =====

export type PromptOptimizeMode = 'text-to-image' | 'image-to-image' | 'gif' | 'agent' | 'canvas-prompt-gallery-import' | 'canvas-prompt-gallery-config';

export interface OptimizeImageInput {
  dataUrl: string;
  mimeType: string;
}

export interface StreamPromptOptimizeInput {
  apiKey: string;
  /** 所选文本模型的上游协议。 */
  protocol: ProviderProtocol;
  model: string;
  mode: PromptOptimizeMode;
  prompt: string;
  images?: OptimizeImageInput[];
  /** 仅 agent 模式使用的对话上下文参考 */
  context?: string;
}

export interface StreamPromptOptimizeCallbacks {
  onDelta(token: string): void;
  onDone(fullText: string): void;
  onError(err: Error): void;
}

export interface StreamPromptOptimizeHandle {
  abort(): void;
  promise: Promise<void>;
}

// ===== System Prompts =====

const SYSTEM_PROMPTS: Record<PromptOptimizeMode, string> = {
  'text-to-image': `你是一位专业的 AI 绘图提示词优化专家。
你的任务是将用户的简短描述优化为高质量的文生图提示词。
优化规则：
- 保留用户的原始意图和核心描述
- 补充画面主体的细节（外观、材质、姿态等）
- 添加合适的艺术风格描述（如摄影、插画、油画等）
- 补充光影、色调、氛围描述
- 优化构图和视角描述
- 使用简洁精准的中文描述
- 不要添加与画面无关的说明文字
只输出优化后的提示词本身，不要输出任何解释、前缀或额外说明。`,

  'image-to-image': `你是一位专业的图生图提示词优化专家。
你的任务是结合参考图和用户描述，优化为精准的图生图提示词。
优化规则：
- 观察参考图的内容、风格、色调、构图
- 结合用户的修改意图，生成精准的图生图提示词
- 保留用户想要保留的参考图元素
- 明确描述用户想要修改的部分
- 使用简洁精准的中文描述
- 不要添加与画面无关的说明文字
只输出优化后的提示词本身，不要输出任何解释、前缀或额外说明。`,

  gif: `你是一位专业的动图生成提示词优化专家。
你的任务是结合参考图和用户描述，优化为适合生成 3×4 = 12 帧网格动画的提示词。
优化规则：
- 观察参考图（如有）的内容、风格、色调
- 描述必须适合 1:1 正方形帧构图
- 强调动作的连续性和逐帧变化，确保 12 帧之间动作流畅衔接
- 描述一个完整、有节奏的动作过程（如眨眼、点头、转身等）
- 动作幅度适中，适合在 12 帧内完成一个循环
- 如有首尾帧闭合需求，确保第 12 帧自然过渡回第 1 帧
- 使用简洁精准的中文描述
- 不要添加与画面无关的说明文字
只输出优化后的提示词本身，不要输出任何解释、前缀或额外说明。`,

  agent: `你是一位描述润色助手。
你的任务是优化用户的自然语言描述，使其更加清晰、准确和详细。
优化规则：
- 修正语病和错别字
- 增强表达的清晰度和逻辑性
- 补充必要的细节描述，使意图更加明确
- 保持用户原始意图不变，不要改变其核心需求
- 保持自然口语化风格，不要过度书面化
我们会提供一段对话上下文供你参考（包含最近的聊天记录和图片描述），让你了解用户当前在做什么。
但上下文仅是参考，不要被其束缚——你的主要任务仍是优化用户输入的那段文本。
只输出优化后的描述文本，不要输出任何解释、前缀或额外说明。`,

  'canvas-prompt-gallery-import': `你是一位无限画布提示词适配专家。
用户会从提示词广场导入模板提示词，画布会额外提供参考图节点、用户上传的目标角色/OC图节点和生成配置说明。
你的任务是把提示词广场原文改写为适合该画布流程使用的参考提示词。
改写规则：
- 移除或改写所有依赖具体图片编号的表达，例如“图1”“图2”“第一张图”“第二张图”“image 1”“image 2”。
- 将编号绑定的角色替换关系改成“模板参考图中的角色占位由用户上传角色/OC特征替换”。
- 明确用户上传角色/OC是唯一角色身份来源，模板参考图只提供姿势、动作、构图、背景、光影、风格和行为。
- 保留原提示词里的关键画面要求、姿势、动作、风格、构图、道具和限制条件。
- 削弱或移除模板参考图自身人物身份、五官、发型、服装、配饰等会与用户上传角色冲突的描述。
- 不要让多张模板参考图互相模仿、互相替换或混合身份。
- 不要描述图片输入顺序，画布生成配置会负责指定参考图和用户上传图。
- 使用简洁精准的中文。
只输出改写后的提示词本身，不要输出解释、前缀、编号或额外说明。`,

  'canvas-prompt-gallery-config': `你是一位无限画布配置节点提示词优化专家。
用户正在把提示词广场模板套用到自己上传的目标角色/OC图上。模板参考图不会提供给你，避免你把模板图内容误解成角色身份；你最多只会收到用户上传的目标角色/OC图。
你的任务是优化配置节点提示词，让后续生图模型更稳定地参考用户上传图片完成角色替换。
优化规则：
- 必须保留所有 @[node:...] 节点引用 token，不能删除、改写、重排或新造 token。
- 不要用文字描述用户上传图片里的具体外貌、发型、服装、配饰、颜色或身份细节；生图模型会直接读取图片，文字复述反而会干扰。
- 用“目标角色图”“用户上传角色图”“参考目标角色图”这类指代强调角色身份来源，而不是把图片内容展开成文字。
- 如果没有收到目标角色/OC图，也不要根据模板参考图或提示词猜测角色外观，只保留目标角色图引用和等待图片输入的语义。
- 明确模板参考图只提供姿势、手势、口型、构图、背景、光影、风格和行为，最终角色身份以用户上传角色图为准。
- 保留原提示词中的画面结构、动作、风格、构图、道具和限制条件。
- 不要让模板参考图之间互相模仿、互相替换或混合人物身份。
- 使用简洁精准的中文。
只输出改写后的提示词本身，不要输出解释、前缀、编号或额外说明。`,
};

/**
 * 使用用户配置的文本模型流式优化提示词。
 * @param input 包含鉴权信息、所选模型、优化模式及输入内容。
 * @param callbacks 接收增量文本、完成结果和错误的回调集合。
 * @param baseUrl 文本模型服务的基础地址。
 * @returns 可用于取消请求及等待请求完成的句柄。
 */
export function streamPromptOptimize(
  input: StreamPromptOptimizeInput,
  callbacks: StreamPromptOptimizeCallbacks,
  baseUrl: string = '',
): StreamPromptOptimizeHandle {
  const controller = new AbortController();

  const promise = (async () => {
    try {
      await runWithRetry(baseUrl, input, callbacks, controller);
    } catch (err) {
      const timeoutError = getTimeoutAbortError(controller.signal);
      if (controller.signal.aborted && !timeoutError) return;
      callbacks.onError(timeoutError || normalizeError(err));
    }
  })();

  return {
    abort: () => controller.abort(),
    promise,
  };
}

/**
 * 在未收到任何输出前，对可恢复的上游错误执行有限次数重试。
 * @param baseUrl 文本模型服务的基础地址。
 * @param input 包含模型协议、鉴权和提示词内容的请求参数。
 * @param callbacks 接收流式文本和错误的回调集合。
 * @param controller 用于超时和用户取消的请求控制器。
 * @returns 请求成功完成时无返回值；不可恢复错误时抛出规范化错误。
 */
async function runWithRetry(
  baseUrl: string,
  input: StreamPromptOptimizeInput,
  callbacks: StreamPromptOptimizeCallbacks,
  controller: AbortController,
): Promise<void> {
  const signal = controller.signal;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= OPTIMIZE_MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) {
      const timeoutError = getTimeoutAbortError(signal);
      if (timeoutError) throw timeoutError;
      return;
    }
    let receivedOutput = false;
    try {
      await runAttempt(baseUrl, input, callbacks, controller, () => { receivedOutput = true; });
      return;
    } catch (err) {
      if (signal.aborted) {
        const timeoutError = getTimeoutAbortError(signal);
        if (timeoutError) throw timeoutError;
        return;
      }
      const normalized = normalizeError(err);
      lastError = normalized;
      // 已经把本次结果展示给用户时，重试会把另一份文本拼接到末尾，必须停止。
      if (receivedOutput || attempt >= OPTIMIZE_MAX_ATTEMPTS || !isRetryable(err)) {
        throw normalized;
      }
    }
  }
  throw lastError || new Error('优化请求失败');
}

type OptimizeContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

interface SsePayload {
  type?: string;
  delta?: string;
  text?: string;
  message?: string;
  response?: { output_text?: string };
  error?: { message?: string };
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiStreamChunk {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * 组合供两种上游协议共同使用的提示词正文。
 * @param input 包含优化模式、用户输入、参考图和可选上下文的请求参数。
 * @returns 已附加系统规则和上下文的用户输入文本。
 */
function buildOptimizeUserText(input: StreamPromptOptimizeInput): string {
  let userText = `${SYSTEM_PROMPTS[input.mode]}\n\n---\n\n`;
  if (input.context) {
    userText += `${input.context}\n\n---\n\n`;
  }
  return `${userText}用户输入：\n${input.prompt}`;
}

/**
 * 构建 OpenAI Responses API 所需的提示词优化请求体。
 * @param input 包含模型、参考图和提示词的请求参数。
 * @param userText 已组合完成的用户提示词正文。
 * @returns 可直接透传给 OpenAI 兼容服务的请求对象。
 */
function buildOpenAiOptimizeRequest(input: StreamPromptOptimizeInput, userText: string) {
  const content: OptimizeContentPart[] = [{ type: 'input_text', text: userText }];
  for (const image of input.images || []) {
    content.push({ type: 'input_image', image_url: image.dataUrl });
  }
  return {
    model: input.model,
    stream: true,
    reasoning: { effort: 'low' as const },
    input: [{ role: 'user', content }],
  };
}

/**
 * 将 Data URL 或纯 Base64 参考图标准化为 Gemini 可接受的内联数据。
 * @param image 待发送的参考图。
 * @returns 包含 MIME 类型和 Base64 正文的 Gemini 内联数据对象。
 */
function toGeminiInlineData(image: OptimizeImageInput): { mimeType: string; data: string } {
  const matched = image.dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  return {
    mimeType: matched?.[1] || image.mimeType || 'image/jpeg',
    data: matched?.[2] || image.dataUrl.split(',')[1] || image.dataUrl,
  };
}

/**
 * 构建 Gemini GenerateContent API 所需的提示词优化请求体。
 * @param input 包含参考图和提示词的请求参数。
 * @param userText 已组合完成的用户提示词正文。
 * @returns 可直接透传给 Gemini 服务的请求对象。
 */
function buildGeminiOptimizeRequest(input: StreamPromptOptimizeInput, userText: string) {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: userText },
        ...((input.images || []).map(image => ({ inlineData: toGeminiInlineData(image) }))),
      ],
    }],
  };
}

/**
 * 使用当前选择的协议向上游发起一次提示词优化流式请求。
 * @param baseUrl 文本模型服务的基础地址。
 * @param input 包含模型协议、鉴权和提示词内容的请求参数。
 * @param callbacks 接收流式文本和错误的回调集合。
 * @param controller 用于超时和用户取消的请求控制器。
 * @param onOutput 在收到首个可展示文本片段时标记本次请求已开始输出。
 * @returns 请求正常结束时无返回值；上游或流式解析失败时抛出错误。
 */
async function runAttempt(
  baseUrl: string,
  input: StreamPromptOptimizeInput,
  callbacks: StreamPromptOptimizeCallbacks,
  controller: AbortController,
  onOutput: () => void,
): Promise<void> {
  const signal = controller.signal;
  const userText = buildOptimizeUserText(input);
  const requestBody = input.protocol === 'google'
    ? buildGeminiOptimizeRequest(input, userText)
    : buildOpenAiOptimizeRequest(input, userText);

  const timeoutId = window.setTimeout(() => {
    if (!signal.aborted) {
      controller.abort(new DOMException('优化请求超时', 'TimeoutError'));
    }
  }, OPTIMIZE_TIMEOUT_MS);

  try {
    const response = await fetch('/api/flyreq/proxy/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: input.protocol,
        baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        stream: true,
        requestBody,
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
    let fired = false;

    const fireDone = () => {
      if (fired) return;
      fired = true;
      callbacks.onDone(accumulated);
    };

    await readSseStream(response.body, signal, (event) => {
      if (!event.data) return;
      if (event.data === '[DONE]') {
        fireDone();
        return;
      }

      let payload: SsePayload | GeminiStreamChunk;
      try {
        payload = JSON.parse(event.data) as SsePayload | GeminiStreamChunk;
      } catch {
        return;
      }

      if (input.protocol === 'google') {
        const chunk = payload as GeminiStreamChunk;
        if (chunk.error?.message) throw new Error(chunk.error.message);
        if (chunk.promptFeedback?.blockReason) throw new Error(`内容被拦截: ${chunk.promptFeedback.blockReason}`);
        for (const candidate of chunk.candidates || []) {
          for (const part of candidate.content?.parts || []) {
            if (part.thought === true || typeof part.text !== 'string' || !part.text) continue;
            accumulated += part.text;
            onOutput();
            callbacks.onDelta(part.text);
          }
        }
        return;
      }

      const openAiPayload = payload as SsePayload;
      const eventType = openAiPayload.type || event.event || '';

      if (eventType === 'response.output_text.delta') {
        const delta = typeof openAiPayload.delta === 'string' ? openAiPayload.delta : '';
        if (delta) {
          accumulated += delta;
          onOutput();
          callbacks.onDelta(delta);
        }
        return;
      }

      if (eventType === 'response.output_text.done') {
        if (typeof openAiPayload.text === 'string' && openAiPayload.text.length > accumulated.length) {
          const tail = openAiPayload.text.slice(accumulated.length);
          if (tail) {
            accumulated = openAiPayload.text;
            onOutput();
            callbacks.onDelta(tail);
          }
        }
        return;
      }

      if (eventType === 'response.completed') {
        const fullText = openAiPayload.response?.output_text;
        if (typeof fullText === 'string' && fullText.length > accumulated.length) {
          const tail = fullText.slice(accumulated.length);
          if (tail) {
            accumulated = fullText;
            onOutput();
            callbacks.onDelta(tail);
          }
        }
        fireDone();
        return;
      }

      if (eventType === 'error' || eventType === 'response.error') {
        const message = openAiPayload.error?.message || openAiPayload.message || '模型返回错误';
        throw new Error(message);
      }
    });

    if (signal.aborted) {
      const timeoutError = getTimeoutAbortError(signal);
      if (timeoutError) throw timeoutError;
      return;
    }
    fireDone();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ===== 工具函数 =====

/**
 * 判断请求是否因客户端设置的优化超时而被取消。
 * @param signal 当前流式请求使用的中止信号。
 * @returns 超时对应的错误对象；非超时取消时返回 null。
 */
function getTimeoutAbortError(signal: AbortSignal): Error | null {
  const reason = signal.reason as unknown;
  if (!reason || typeof reason !== 'object' || !('name' in reason) || reason.name !== 'TimeoutError') {
    return null;
  }
  if (reason instanceof Error) return reason;
  const error = new Error('优化请求超时');
  error.name = 'TimeoutError';
  return error;
}

async function readHttpError(response: Response): Promise<Error> {
  let detail = '';
  try {
    detail = await response.text();
  } catch { /* ignore */ }
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      const message = parsed?.error?.message || parsed?.error || parsed?.message;
      if (typeof message === 'string' && message.length > 0) {
        return new Error(`${response.status} ${response.statusText}: ${message}`);
      }
    } catch { /* not JSON */ }
  }
  return new Error(`${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return [
    '408', '429', '500', '502', '503', '504',
    'failed to fetch', 'network', 'load failed',
    'timeout', 'timed out',
  ].some(keyword => lower.includes(keyword));
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes('failed to fetch')
      || lower.includes('network')
      || lower.includes('load failed')
    ) {
      return new Error('网络连接失败，请检查网络后重试');
    }
    return error;
  }
  return new Error(String(error));
}
