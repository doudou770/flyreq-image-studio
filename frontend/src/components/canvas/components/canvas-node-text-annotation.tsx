"use client";

import React from "react";

import { type CanvasNodeData } from "../types";

type TextAnnotationNodeBodyProps = {
  data: CanvasNodeData;
  onContentChange: (nodeId: string, content: string) => void;
  onSelectNode: (nodeId: string) => void;
};

export const TextAnnotationNodeBody = React.memo(function TextAnnotationNodeBody({
  data,
  onContentChange,
  onSelectNode,
}: TextAnnotationNodeBodyProps) {
  const content = data.metadata?.content || "";
  const fontSize = data.metadata?.fontSize || 14;
  const bgColor = data.metadata?.backgroundColor || "";
  const textColor = data.metadata?.textColor || "";

  return (
    <div className="relative h-full w-full">
      <textarea
        data-canvas-no-zoom
        value={content}
        onChange={(event) => onContentChange(data.id, event.target.value)}
        placeholder="输入注释..."
        className="h-full w-full cursor-text resize-none bg-transparent px-2.5 py-1.5 pb-8 text-sm outline-none placeholder:text-muted-foreground"
        style={{
          fontSize,
          backgroundColor: bgColor || undefined,
          color: textColor || undefined,
        }}
        onPointerDown={() => onSelectNode(data.id)}
      />
      {content.length > 0 && (
        <div
          className="pointer-events-none absolute right-2 bottom-1 text-[10px] text-muted-foreground/60"
          data-canvas-no-zoom
        >
          {content.length} 字
        </div>
      )}
    </div>
  );
});
