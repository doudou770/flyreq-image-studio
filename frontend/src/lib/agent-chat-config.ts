// Agent 模式的模型、指令、工具 schema 与类型定义
// 文本对话模型从 nova-models 注册表动态读取，支持 Google 和 OpenAI 两种协议
// 开源版：不再硬编码模型，由用户在设置中配置

import type { GptImageBackground, GptImageQuality, GptImageStyle } from '@/lib/model-capabilities';

// 默认值仅用于初始化，实际使用时从注册表读取
export const AGENT_TEXT_MODEL_FALLBACK = 'gpt-5.4-mini';
export const AGENT_DEFAULT_IMAGE_MODEL_FALLBACK = 'gemini-3-pro-image-preview';

// ===== 上下文系统数据结构 =====

export type AgentMessageRole = 'user' | 'assistant' | 'system-note' | 'context-divider';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  text: string;
  /** 助手消息的思考摘要（reasoning summary，仅展示用，不回传给模型） */
  reasoning?: string;
  /** 该消息关联的图片登记 id（用户上传或生成结果） */
  imageIds?: string[];
  /** 关联的生图任务 id */
  taskId?: string;
  /** system-note 专用：是否可撤回（取消生图后用于回退最后一轮对话） */
  withdrawable?: boolean;
  /** 该消息生图时使用的提案数据，用于重新编辑 */
  proposalData?: AgentProposalData;
  /** 该消息是否使用了联网搜索 */
  webSearchUsed?: boolean;
  createdAt: number;
}

export type AgentImageSource = 'uploaded' | 'asset' | 'generated';

/**
 * 图片登记表记录：只保存「描述 + 缩略图 + 字节引用」，不保存进对话上下文。
 * 真实字节存在 nova-image-db 的 blobs store，key 命名空间用 imgId（index 固定 0）。
 */
export interface AgentImageRecord {
  imgId: string;
  source: AgentImageSource;
  /** 用于聊天流内展示的小缩略图 dataURL */
  thumbnail: string;
  /** 视觉模型生成的中文描述，仅此进入文本模型上下文 */
  description: string;
  mimeType: string;
  /** 上传图片原始字节的 SHA-256，用于重复上传去重复用；生成图无此字段 */
  contentHash?: string;
  /** 生成类图片对应的后端任务 id */
  sourceTaskId?: string;
  /** 图片自然像素宽度（用于按上传图比例预填生图参数） */
  width?: number;
  /** 图片自然像素高度 */
  height?: number;
  createdAt: number;
}

// ===== 意图抽取：函数调用结果 =====

export type AgentActionType = 'generate' | 'edit';

export interface AgentProposal {
  action: AgentActionType;
  prompt: string;
  referencedImageIds: string[];
  reason: string;
  /** 用户语言明确指定的比例/方向（优先级最高），如 "16:9"；未明确则 undefined */
  requestedAspectRatio?: string;
  /** Agent 智能推荐的比例（兜底用），如 "1:1" */
  suggestedAspectRatio?: string;
  /** 用户明确要求的清晰度档位，如 "4K"/"2K"/"1K"/"512"/"auto"；未明确则 undefined */
  requestedOutputSize?: string;
  /** 建议温度（0-2），仅对支持温度的模型有效 */
  temperature?: number;
  /** 建议并行生成数量（1-4） */
  parallelCount?: number;
  /** GPT Image 2 质量参数 */
  gptImageQuality?: GptImageQuality;
  /** GPT Image 2 风格参数；自动时不传给上游 */
  gptImageStyle?: GptImageStyle;
  /** GPT Image 2 背景参数 */
  gptImageBackground?: GptImageBackground;
  /** Agent 根据用户语言匹配的模型 id（来自可用模型列表）；未指定则 undefined */
  requestedModelId?: string;
}

/**
 * 已确认并成功执行的生图提案数据，用于重新编辑重建提案。
 * 字段尽量保持扁平以避免 import 循环依赖。
 */
export interface AgentProposalData {
  action: AgentActionType;
  prompt: string;
  referencedImageIds: string[];
  model: string;
  outputSize: string;
  customSize?: string;
  aspectRatio: string;
  temperature: number;
  gptImageQuality?: GptImageQuality;
  gptImageStyle?: GptImageStyle;
  gptImageBackground?: GptImageBackground;
  parallelCount: number;
}

// ===== System 指令 =====

export const AGENT_SYSTEM_INSTRUCTIONS = `你是一个图像生成与编辑助手，全程使用简体中文与用户自然对话。

你的能力：
- 与用户连续对话，帮助澄清他们想要的画面。
- 当你判断用户想要「生成一张新图」或「修改已有图片」时，调用 propose_image_action 工具，把建议的提示词和参考图交给用户确认，而不是把提示词直接写进聊天回复里。

关于图片目录：
- 每轮对话我都会在指令里附上一份「当前可用图片目录」，列出每张图片的 id（如 img_1）和文字描述。
- 这是你唯一能看到的图片信息来源（你看不到图片本身，只能靠描述判断）。
- 当用户提到「这张图 / 刚才那张 / 把它改成…」时，结合最近对话和目录描述推断他指的是哪个 id。

调用 propose_image_action 的规则：
- action="generate"：从零生成新图。一般 referenced_image_ids 为空；若用户希望参考已有图片的风格/主体，可放入相关 id。
- action="edit"：在已有图片基础上修改。referenced_image_ids 必须从目录里挑出要参考或被修改的图片 id，支持多张。
- prompt 要写成一段完整、可直接用于绘图模型的高质量中文提示词，聚焦于用户想要的画面效果、风格和修改意图。
- ⚠️ 禁止在 prompt 中描述参考图的具体内容（如"一只橘猫""蓝色天空"等），因为图片模型本身支持图片输入，文字描述反而会干扰模型对图片的理解。请在 prompt 中用"图1""图2""图3"指代参考图，编号按 referenced_image_ids 数组顺序（第1个=图1，第2个=图2）。例如：写"参考图1的风格，将主体替换为图2中的建筑"而非"参考一张有蓝色天空和橘猫的图片"。
- reason 用一句话向用户说明你的判断（例如「你想把这张橘猫的帽子换成红色，我建议这样改」）。

关于生图参数（你只给「语义建议」，系统会按用户当前选择的图像模型自动合法化，你不用关心具体像素或某个模型支不支持）：
- requested_aspect_ratio：只有当用户用语言明确表达了画面比例或方向时才填，否则给 null。横屏类填 "16:9"，竖屏/手机屏填 "9:16"，正方形填 "1:1"，可用 "w:h" 形式（如 "3:2"、"4:5"）。这是最高优先级。
- suggested_aspect_ratio：无论用户是否说过，都给一个你认为最合适的比例（如肖像给 "2:3"、风景给 "16:9"、图标给 "1:1"）。当用户没明确指定、也没有可参考的上传图时作为兜底。
- requested_output_size：只有当用户明确要求清晰度/分辨率档位时才填，取值 "512"/"1K"/"2K"/"4K"/"auto" 之一，否则给 null。
- temperature：用户表达「更随机/更有创意」给偏高值（接近 2），「更精确/更稳定」给偏低值（接近 0），无明确倾向给 1 或 null。
- parallel_count：用户要「多出几张/多个方案」时给 2-4，否则给 1 或 null。
- gpt_image_quality：当用户明确要求 GPT Image 2 的质量档位时填 "high"/"medium"/"low"，无明确需求给 "auto" 或 null。
- gpt_image_style：当用户明确要求鲜明、夸张、强表现力时填 "vivid"；要求自然、写实时填 "natural"；无明确需求给 null。
- gpt_image_background：用户明确要求透明背景、抠图、无背景时填 "transparent"；明确要求实底/不透明时填 "opaque"；否则给 "auto" 或 null。
- 不要假设具体像素尺寸，也不要因为某个比例「可能不被支持」而回避；系统会自动贴合到最近的合法比例与档位。

关于模型选择：
- 每轮对话我也会在指令里附上一份「当前可用图像模型」列表，每项包含模型 id、名称和最大分辨率。
- requested_model_id：只有当用户用语言明确指定了某个模型时才填对应的 id（如用户说「用 Banana Pro」则填该模型的 id），否则给 null。系统会自动验证该 id 是否有效。
- 如果用户要求了某个分辨率档位（如「画一张4K的图」），填 requested_output_size，系统会自动选择支持该分辨率的模型，你不需要判断模型是否支持。
- 如果用户既没指定模型也没指定分辨率，requested_model_id 给 null，系统会使用当前已选模型。

什么时候不要调用工具：
- 纯闲聊、提问、澄清需求时，正常用文字回答。
- 信息不足、拿不准用户到底要不要画图时，先用文字追问，不要急着调用工具。

注意：最终是否执行由用户在确认面板里决定，用户可以修改你的提示词、增删参考图，或直接取消。`;

// ===== 工具 schema（Responses API 扁平结构）=====

export const PROPOSE_IMAGE_ACTION_TOOL = {
  type: 'function' as const,
  name: 'propose_image_action',
  description: '当判断用户想要生成新图或修改已有图片时调用，提交一份生图/改图提案交给用户确认。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'edit'],
        description: 'generate=从零生成新图；edit=在已有图片基础上修改',
      },
      prompt: {
        type: 'string',
        description: '建议的完整中文绘图提示词。聚焦用户想要的画面效果和修改意图，不要描述参考图的具体内容（图片模型本身支持图片输入，文字描述反而干扰理解）。用"图1""图2"指代 referenced_image_ids 中对应位置的参考图（第1个=图1，第2个=图2），例如"参考图1的风格，将主体替换为图2中的建筑"',
      },
      referenced_image_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '要参考或被修改的图片 id（来自图片目录），generate 通常为空数组',
      },
      reason: {
        type: 'string',
        description: '一句话向用户说明这次提案的判断依据',
      },
      requested_aspect_ratio: {
        type: ['string', 'null'],
        description: '用户明确指定的比例/方向时填（横屏="16:9"，竖屏="9:16"，正方形="1:1"，或 "w:h"），否则 null',
      },
      suggested_aspect_ratio: {
        type: ['string', 'null'],
        description: '你推荐的最合适比例（始终尽量给出，如 "2:3"/"16:9"/"1:1"），无把握时可为 null',
      },
      requested_output_size: {
        type: ['string', 'null'],
        enum: ['512', '1K', '2K', '4K', 'auto', null],
        description: '用户明确要求的清晰度档位，否则 null',
      },
      temperature: {
        type: ['number', 'null'],
        description: '建议温度 0-2，无明确倾向给 null',
      },
      parallel_count: {
        type: ['integer', 'null'],
        description: '建议并行生成数量 1-4，无明确需求给 null',
      },
      gpt_image_quality: {
        type: ['string', 'null'],
        enum: ['auto', 'high', 'medium', 'low', null],
        description: 'GPT Image 2 质量参数；无明确需求给 auto 或 null',
      },
      gpt_image_style: {
        type: ['string', 'null'],
        enum: ['vivid', 'natural', null],
        description: 'GPT Image 2 风格参数；自动时给 null',
      },
      gpt_image_background: {
        type: ['string', 'null'],
        enum: ['auto', 'transparent', 'opaque', null],
        description: 'GPT Image 2 背景参数；无明确需求给 auto 或 null',
      },
      requested_model_id: {
        type: ['string', 'null'],
        description: '用户明确指定的模型 id（来自当前可用图像模型列表），否则 null',
      },
    },
    required: [
      'action',
      'prompt',
      'referenced_image_ids',
      'reason',
      'requested_aspect_ratio',
      'suggested_aspect_ratio',
      'requested_output_size',
      'temperature',
      'parallel_count',
      'gpt_image_quality',
      'gpt_image_style',
      'gpt_image_background',
      'requested_model_id',
    ],
    additionalProperties: false,
  },
  strict: true,
} as const;

// ===== 视觉描述提示词 =====

export const AGENT_IMAGE_DESCRIBE_PROMPT = `用一到两句简体中文描述这张图片，覆盖主体、风格、主要颜色和关键元素，便于后续判断是否复用它作为参考图。只输出描述本身，不要任何前缀、解释或标点装饰。`;
