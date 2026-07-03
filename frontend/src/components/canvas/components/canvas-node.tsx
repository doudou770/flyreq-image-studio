"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, Clock, FileText, Hash, Images, RefreshCw, Save, Sparkles, Upload } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { canvasTheme } from "../lib/canvas-theme";
import { formatBytes } from "../lib/image-utils";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { Spinner } from "./canvas-ui";
import { TextAnnotationNodeBody } from "./canvas-node-text-annotation";

export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const RETRY_COOLDOWN_MS = 3000;

const STATUS_LABELS: Record<string, string> = {
  submitting: "提交中…",
  queued: "排队中",
  processing: "生成中",
  loading: "加载中",
};

type CanvasNodeProps = {
  data: CanvasNodeData;
  imageUrl?: string;
  isSelected: boolean;
  isRelated: boolean;
  isConnectionTarget: boolean;
  referenceLimitExceeded?: boolean;
  zIndex: number;
  showImageInfo: boolean;
  onPointerDownNode: (event: React.PointerEvent, nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
  onConnectStart: (event: React.PointerEvent, nodeId: string, handleType: "source" | "target") => void;
  onResizeStart: (event: React.PointerEvent, nodeId: string, corner: ResizeCorner) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onUploadToNode?: (nodeId: string) => void;
  onImportToNode?: (nodeId: string) => void;
  onImportTextToNode?: (nodeId: string) => void;
  onSaveToAssets?: (node: CanvasNodeData) => void;
  onSaveTextToAssets?: (node: CanvasNodeData) => void;
  onRetry?: (node: CanvasNodeData) => void;
  onRefreshProgress?: (node: CanvasNodeData) => void | Promise<void>;
  onOpenImage?: (node: CanvasNodeData) => void;
  onAiGenerate?: (nodeId: string) => void;
  onToggleRenderMode?: (nodeId: string) => void;
  renderPanel?: (node: CanvasNodeData, onSelect: () => void) => React.ReactNode;
};

export const CanvasNode = React.memo(function CanvasNode({
  data,
  imageUrl,
  isSelected,
  isRelated,
  isConnectionTarget,
  referenceLimitExceeded = false,
  zIndex,
  showImageInfo,
  onPointerDownNode,
  onSelectNode,
  onContextMenu,
  onConnectStart,
  onResizeStart,
  onContentChange,
  onUploadToNode,
  onImportToNode,
  onImportTextToNode,
  onSaveToAssets,
  onSaveTextToAssets,
  onRetry,
  onRefreshProgress,
  onOpenImage,
  onAiGenerate,
  onToggleRenderMode,
  renderPanel,
}: CanvasNodeProps) {
  const theme = canvasTheme;
  const status = data.metadata?.status ?? "idle";
  const borderColor = referenceLimitExceeded ? "var(--destructive)" : isSelected || isConnectionTarget ? theme.node.activeStroke : isRelated ? theme.node.muted : theme.node.stroke;
  const boxShadow = referenceLimitExceeded
    ? "0 0 0 4px color-mix(in srgb, var(--destructive) 18%, transparent)"
    : isSelected
      ? `0 0 0 4px color-mix(in srgb, ${theme.node.activeStroke} 18%, transparent)`
      : undefined;

  return (
    <div
      data-node-id={data.id}
      className="group absolute [&_button]:cursor-pointer"
      style={{ left: data.position.x, top: data.position.y, width: data.width, height: data.height, zIndex }}
      onPointerDown={(event) => onPointerDownNode(event, data.id)}
      onContextMenu={(event) => onContextMenu(event, data.id)}
    >
      <div
        className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border-2 shadow-sm transition-[border-color,box-shadow]"
        style={{ borderColor, background: theme.node.fill, boxShadow }}
      >
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium" style={{ color: theme.node.label }}>
          <span className="truncate">{data.title}</span>
        </div>

        <div className="relative min-h-0 flex-1">
          {data.type === CanvasNodeType.Image ? (
            <ImageNodeBody data={data} imageUrl={imageUrl} status={status} showImageInfo={showImageInfo} onUploadToNode={onUploadToNode} onImportToNode={onImportToNode} onSaveToAssets={onSaveToAssets} onRetry={onRetry} onRefreshProgress={onRefreshProgress} onOpenImage={onOpenImage} />
          ) : data.type === CanvasNodeType.Text ? (
            <TextNodeBody data={data} onContentChange={onContentChange} onSelectNode={onSelectNode} onImportTextToNode={onImportTextToNode} onSaveTextToAssets={onSaveTextToAssets} onAiGenerate={onAiGenerate} onToggleRenderMode={onToggleRenderMode} />
          ) : data.type === CanvasNodeType.TextAnnotation ? (
            <TextAnnotationNodeBody data={data} onContentChange={onContentChange} onSelectNode={onSelectNode} />
          ) : (
            <div className="h-full w-full" data-canvas-no-zoom>
              {renderPanel?.(data, () => onSelectNode(data.id))}
            </div>
          )}

          {/* 通用 loading overlay（非图片节点的旧式 loading） */}
          {status === "loading" && data.type !== CanvasNodeType.Image && (
            <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
              <Spinner className="size-6 text-primary" />
            </div>
          )}
        </div>
      </div>

      {/* 连接手柄：选中常驻 / 悬停显示，命中区域更大 */}
      <button
        type="button"
        aria-label="连接输出"
        className={cn(
          "absolute top-1/2 -right-3.5 grid size-7 -translate-y-1/2 place-items-center transition-opacity",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onPointerDown={(event) => {
          event.stopPropagation();
          onConnectStart(event, data.id, "source");
        }}
      >
        <span className="size-3 rounded-full border-2 border-background bg-primary shadow-sm" />
      </button>
      <button
        type="button"
        aria-label="连接输入"
        className={cn(
          "absolute top-1/2 -left-3.5 grid size-7 -translate-y-1/2 place-items-center transition-opacity",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onPointerDown={(event) => {
          event.stopPropagation();
          onConnectStart(event, data.id, "target");
        }}
      >
        <span className="size-3 rounded-full border-2 border-background bg-muted-foreground shadow-sm" />
      </button>

      {/* 缩放手柄：选中显示，命中区域更大 */}
      {isSelected &&
        (["top-left", "top-right", "bottom-left", "bottom-right"] as ResizeCorner[]).map((corner) => (
          <div
            key={corner}
            className={cn(
              "absolute grid size-6 place-items-center",
              corner === "top-left" && "-top-3 -left-3 cursor-nwse-resize",
              corner === "top-right" && "-top-3 -right-3 cursor-nesw-resize",
              corner === "bottom-left" && "-bottom-3 -left-3 cursor-nesw-resize",
              corner === "bottom-right" && "-right-3 -bottom-3 cursor-nwse-resize",
            )}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onResizeStart(event, data.id, corner);
            }}
          >
            <span className="size-3 rounded-sm border-2 border-primary bg-background shadow-sm" />
          </div>
        ))}
    </div>
  );
});

function ImageNodeBody({
  data,
  imageUrl,
  status,
  showImageInfo,
  onUploadToNode,
  onImportToNode,
  onSaveToAssets,
  onRetry,
  onRefreshProgress,
  onOpenImage,
}: {
  data: CanvasNodeData;
  imageUrl?: string;
  status: string;
  showImageInfo: boolean;
  onUploadToNode?: (nodeId: string) => void;
  onImportToNode?: (nodeId: string) => void;
  onSaveToAssets?: (node: CanvasNodeData) => void;
  onRetry?: (node: CanvasNodeData) => void;
  onRefreshProgress?: (node: CanvasNodeData) => void | Promise<void>;
  onOpenImage?: (node: CanvasNodeData) => void;
}) {
  const fallbackContent = data.metadata?.content;
  // 不渲染刷新后失效的 blob: URL（避免 ERR_FILE_NOT_FOUND）；由上层 imageUrl（storageKey 解析）提供有效地址
  const url = imageUrl || (fallbackContent && !fallbackContent.startsWith("blob:") ? fallbackContent : undefined);
  const isGenerating = status === "submitting" || status === "queued" || status === "processing";
  const isError = status === "error";

  return (
    <div className="relative h-full w-full">
      {/* 有图片时显示图片 */}
      {url && (
        <img src={url} alt={data.title} className="h-full w-full object-contain" draggable={false} onDoubleClick={() => onOpenImage?.(data)} />
      )}

      {/* 空状态：无图片且不在生成中 */}
      {!url && !isGenerating && !isError && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground" data-canvas-no-zoom>
          <Images className="size-6 opacity-70" />
          <p className="max-w-[15rem] text-[11px] leading-snug">该节点可作为参考图或目标图节点</p>
          <div className="mt-1 flex flex-row items-center justify-center gap-2">
            <button type="button" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted" onClick={() => onUploadToNode?.(data.id)}>
              <Upload className="size-3.5" /> 上传图片
            </button>
            <button type="button" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted" onClick={() => onImportToNode?.(data.id)}>
              <Images className="size-3.5" /> 从素材库导入
            </button>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {isError && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
          <AlertCircle className="size-6 text-destructive" />
          <span className="line-clamp-3 text-xs text-destructive">{data.metadata?.errorDetails || "生成失败"}</span>
          {onRetry && (
            <RetryButton onRetry={() => onRetry(data)} />
          )}
        </div>
      )}

      {/* 生成中 overlay（覆盖在图片上方，图片可能已有一部分） */}
      {isGenerating && <GenerationStatusOverlay data={data} status={status} onRefreshProgress={onRefreshProgress} />}

      {/* 存素材按钮（仅在有图片且非生成中时显示） */}
      {url && !isGenerating && onSaveToAssets && (
        <button
          type="button"
          data-canvas-no-zoom
          title="存入我的素材"
          className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[10px] text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onSaveToAssets(data)}
        >
          <Save className="size-3.5" /> 存素材
        </button>
      )}

      {/* 图片信息（尺寸/大小） */}
      {url && !isGenerating && showImageInfo && (data.metadata?.naturalWidth || data.metadata?.bytes) && (
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
          {data.metadata?.naturalWidth ? `${data.metadata.naturalWidth}×${data.metadata.naturalHeight}` : ""} {data.metadata?.bytes ? formatBytes(data.metadata.bytes) : ""}
        </div>
      )}
    </div>
  );
}

/** 生成状态 overlay：显示状态、用时、任务 ID。 */
function GenerationStatusOverlay({ data, status, onRefreshProgress }: { data: CanvasNodeData; status: string; onRefreshProgress?: (node: CanvasNodeData) => void | Promise<void> }) {
  const startedAt = data.metadata?.generationStartedAt;
  const taskId = data.metadata?.generationTaskId;
  const [elapsed, setElapsed] = useState(() => (startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 p-3 backdrop-blur-sm" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
      <Spinner className="size-5 text-primary" />
      <span className="text-xs font-medium text-foreground">{STATUS_LABELS[status] || "生成中"}</span>
      {startedAt && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="size-3" /> {formatElapsed(elapsed)}
        </span>
      )}
      {taskId && (
        <span className="max-w-[10rem] truncate text-[10px] text-muted-foreground" title={taskId}>
          <Hash className="mr-0.5 inline size-3" />{taskId.slice(0, 8)}…
        </span>
      )}
      {taskId && onRefreshProgress && (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void Promise.resolve(onRefreshProgress(data)).finally(() => setRefreshing(false));
          }}
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          获取当前进度
        </button>
      )}
    </div>
  );
}

/** 重试按钮（带 3s 冷却防连点）。 */
function RetryButton({ onRetry }: { onRetry: () => void }) {
  const [cooldown, setCooldown] = useState(0);

  const handleClick = () => {
    if (cooldown > 0) return;
    onRetry();
    setCooldown(RETRY_COOLDOWN_MS / 1000);
  };

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  return (
    <button
      type="button"
      data-canvas-no-zoom
      className={cn(
        "mt-1 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
        cooldown > 0 ? "cursor-not-allowed bg-muted text-muted-foreground" : "bg-background text-foreground hover:bg-muted",
      )}
      onClick={handleClick}
      disabled={cooldown > 0}
    >
      <RefreshCw className={cn("size-3.5", cooldown > 0 && "animate-spin")} />
      {cooldown > 0 ? `${cooldown}s` : "重新生成"}
    </button>
  );
}

function TextNodeBody({
  data,
  onContentChange,
  onSelectNode,
  onImportTextToNode,
  onSaveTextToAssets,
  onAiGenerate,
  onToggleRenderMode,
}: {
  data: CanvasNodeData;
  onContentChange: (nodeId: string, content: string) => void;
  onSelectNode: (nodeId: string) => void;
  onImportTextToNode?: (nodeId: string) => void;
  onSaveTextToAssets?: (node: CanvasNodeData) => void;
  onAiGenerate?: (nodeId: string) => void;
  onToggleRenderMode?: (nodeId: string) => void;
}) {
  const content = data.metadata?.content || "";
  const isMarkdown = data.metadata?.renderMode === "markdown";

  return (
    <div className="relative h-full w-full">
      {isMarkdown ? (
        <div
          data-canvas-no-zoom
          className="h-full w-full overflow-auto px-2.5 py-1.5 pb-9 text-sm leading-relaxed [&>*:first-child]:mt-0 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2"
          style={{ fontSize: data.metadata?.fontSize || 14 }}
          onPointerDown={() => onSelectNode(data.id)}
        >
          {content.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <span className="text-muted-foreground">Markdown 预览为空</span>
          )}
        </div>
      ) : (
        <textarea
          data-canvas-no-zoom
          value={content}
          onChange={(event) => onContentChange(data.id, event.target.value)}
          placeholder="输入文本…"
          className="h-full w-full cursor-text resize-none bg-transparent px-2.5 py-1.5 pb-9 text-sm outline-none placeholder:text-muted-foreground"
          style={{ fontSize: data.metadata?.fontSize || 14 }}
          onPointerDown={() => onSelectNode(data.id)}
        />
      )}

      <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" data-canvas-no-zoom>
        {onToggleRenderMode && (
          <button
            type="button"
            title={isMarkdown ? "切换为纯文本" : "切换为 Markdown 预览"}
            className="inline-flex items-center justify-center rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onToggleRenderMode(data.id)}
          >
            <span className="text-[10px] font-bold">{isMarkdown ? "Tx" : "Md"}</span>
          </button>
        )}
        {onAiGenerate && (
          <button
            type="button"
            title="AI 生成文本"
            className="inline-flex items-center justify-center rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onAiGenerate(data.id)}
          >
            <Sparkles className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="导入提示词素材"
          className="inline-flex items-center justify-center rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onImportTextToNode?.(data.id)}
        >
          <FileText className="size-3.5" />
        </button>
        {content.trim() && (
          <button
            type="button"
            title="存为提示词素材"
            className="inline-flex items-center justify-center rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSaveTextToAssets?.(data)}
          >
            <Save className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
