"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Copy, Crop, Eraser, Grid3x3, Maximize2, PaintBucket, RefreshCw, Rotate3d, Sparkles, Text, Trash2, Type } from "lucide-react";

import { CanvasNodeType, type CanvasNodeData, type ContextMenuState } from "../types";

export type CanvasContextMenuActions = {
  onGenerate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDeleteImageOnly: () => void;
  onRetry: () => void;
  onCrop: () => void;
  onSplit: () => void;
  onUpscale: () => void;
  onAngle: () => void;
  onDeleteConnection: () => void;
  onToggleRenderMode?: () => void;
  onAiGenerateText?: (prompt: string) => void;
  onAnnotationChangeColor?: () => void;
  onAnnotationChangeFontSize?: () => void;
};

export function CanvasContextMenu({ state, node, onClose, actions }: { state: ContextMenuState | null; node?: CanvasNodeData; onClose: () => void; actions: CanvasContextMenuActions }) {
  useEffect(() => {
    if (!state) return;
    const handle = () => onClose();
    const handleKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", handle);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handle);
      window.removeEventListener("keydown", handleKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  const isImage = state.type === "node" && node?.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
  const canGenerate = state.type === "node" && node?.type === CanvasNodeType.Config;
  const canRetry = state.type === "node" && node?.type === CanvasNodeType.Image && node.metadata?.status === "error";
  const isText = state.type === "node" && node?.type === CanvasNodeType.Text;
  const isAnnotation = state.type === "node" && node?.type === CanvasNodeType.TextAnnotation;

  const items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] = [];
  if (state.type === "connection") {
    items.push({ label: "删除连线", icon: <Trash2 className="size-4" />, onClick: actions.onDeleteConnection, danger: true });
  } else {
    if (canGenerate) items.push({ label: "生成", icon: <Sparkles className="size-4" />, onClick: actions.onGenerate });
    if (isImage) {
      items.push({ label: "裁剪", icon: <Crop className="size-4" />, onClick: actions.onCrop });
      items.push({ label: "分割", icon: <Grid3x3 className="size-4" />, onClick: actions.onSplit });
      items.push({ label: "放大", icon: <Maximize2 className="size-4" />, onClick: actions.onUpscale });
      items.push({ label: "视角", icon: <Rotate3d className="size-4" />, onClick: actions.onAngle });
      items.push({ label: "删除图片", icon: <Eraser className="size-4" />, onClick: actions.onDeleteImageOnly });
    }
    if (isText) {
      if (actions.onToggleRenderMode) {
        items.push({ label: "切换 Markdown / 纯文本", icon: <Text className="size-4" />, onClick: actions.onToggleRenderMode });
      }
    }
    if (isAnnotation) {
      if (actions.onAnnotationChangeColor) {
        items.push({ label: "更换背景色", icon: <PaintBucket className="size-4" />, onClick: actions.onAnnotationChangeColor });
      }
      if (actions.onAnnotationChangeFontSize) {
        items.push({ label: "调整字号", icon: <Type className="size-4" />, onClick: actions.onAnnotationChangeFontSize });
      }
    }
    if (canRetry) items.push({ label: "重新生成", icon: <RefreshCw className="size-4" />, onClick: actions.onRetry });
    items.push({ label: "复制", icon: <Copy className="size-4" />, onClick: actions.onDuplicate });
    items.push({ label: "删除", icon: <Trash2 className="size-4" />, onClick: actions.onDelete, danger: true });
  }

  return createPortal(
    <div
      data-canvas-no-zoom
      className="fixed z-[130] min-w-40 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted ${item.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground"}`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
