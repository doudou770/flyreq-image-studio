import type { AspectRatio, OutputSize } from "@/lib/gemini-config";
import type { GptImageBackground, GptImageQuality, GptImageStyle, ParallelCount } from "@/lib/model-capabilities";

export type Position = {
  x: number;
  y: number;
};

export type ViewportTransform = {
  x: number;
  y: number;
  k: number;
};

export enum CanvasNodeType {
  Image = "image",
  Text = "text",
  Config = "config",
  TextAnnotation = "textAnnotation",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "submitting" | "queued" | "processing" | "error";
/** 移植后画布只生成图像（走宿主任务队列），不含 video/audio。 */
export type CanvasGenerationMode = "image";
export type CanvasImageGenerationType = "generation" | "edit";

/** 单个配置/编排节点的生成参数（写在节点上）。 */
export type CanvasGenerationConfig = {
  model: string;
  outputSize: OutputSize;
  aspectRatio: AspectRatio;
  customSize?: string;
  temperature: number;
  count: ParallelCount;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
};

export type CanvasNodeMetadata = {
  content?: string;
  composerContent?: string;
  prompt?: string;
  status?: CanvasNodeStatus;
  errorDetails?: string;
  fontSize?: number;
  generationMode?: CanvasGenerationMode;
  generationType?: CanvasImageGenerationType;
  model?: string;
  size?: string;
  quality?: string;
  count?: number;
  references?: string[];
  naturalWidth?: number;
  naturalHeight?: number;
  freeResize?: boolean;
  isBatchRoot?: boolean;
  batchRootId?: string;
  batchChildIds?: string[];
  batchUsesReferenceImages?: boolean;
  primaryImageId?: string;
  imageBatchExpanded?: boolean;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  /** 配置节点的逐节点生成参数 */
  genConfig?: CanvasGenerationConfig;
  /** 配置节点：锁定结果节点模式 */
  lockResultNodes?: boolean;
  /** 单节点生成任务 ID（用于轮询 + 刷新恢复） */
  generationTaskId?: string;
  /** 单节点生成开始时间戳（用于计算用时） */
  generationStartedAt?: number;
  /** 画布导入流程中的节点角色，用于空目标图节点也能被编排节点 @ 引用。 */
  canvasRole?: "reference" | "target" | "reference-prompt";
  /** Text 节点：渲染模式 */
  renderMode?: "plain" | "markdown";
  /** Text 节点：是否启用 AI 生成 */
  aiGenerationEnabled?: boolean;
  /** Text 节点：AI 生成流式预览内容 */
  streamPreview?: string;
  /** Text 节点：是否正在流式生成中 */
  isStreaming?: boolean;
  /** TextAnnotation 节点：背景色 */
  backgroundColor?: string;
  /** TextAnnotation 节点：文字颜色 */
  textColor?: string;
};

export type CanvasNodeData = {
  id: string;
  type: CanvasNodeType;
  title: string;
  position: Position;
  width: number;
  height: number;
  metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type ConnectionHandle = {
  nodeId: string;
  handleType: "source" | "target";
};

export type SelectionBox = {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  initialSelectedNodeIds: string[];
};

export type ContextMenuState =
  | {
      type: "node";
      x: number;
      y: number;
      nodeId: string;
    }
  | {
      type: "connection";
      x: number;
      y: number;
      connectionId: string;
    };
