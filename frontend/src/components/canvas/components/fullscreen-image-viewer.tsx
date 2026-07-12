"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Download, ImagePlus, Maximize2, Pencil, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImageAnnotationEditor } from "@/components/canvas/components/image-annotation-editor";
import { applyAnnotatedImageAsReference, runImageAction, type ImageActionPayload } from "@/lib/image-actions";

interface FullscreenImageViewerProps {
  src: string;
  title?: string;
  onClose: () => void;
  actionPayload?: ImageActionPayload;
}

/**
 * 全屏图片查看器（rAF 批量变换 + 复制/素材库/图生图参考）。
 */
export function FullscreenImageViewer({ src, title, onClose, actionPayload }: FullscreenImageViewerProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<number | null>(null);
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const [scaleState, setScaleState] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [showAnnotationEditor, setShowAnnotationEditor] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  const applyTransform = useCallback(() => {
    const image = imageRef.current;
    if (!image) return;
    image.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0) scale(${scaleRef.current})`;
  }, []);

  const scheduleTransform = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      applyTransform();
    });
  }, [applyTransform]);

  const setScale = useCallback((value: number | ((prev: number) => number)) => {
    setScaleState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      scaleRef.current = next;
      scheduleTransform();
      return next;
    });
  }, [scheduleTransform]);

  const setPos = useCallback((value: { x: number; y: number }) => {
    posRef.current = value;
    scheduleTransform();
  }, [scheduleTransform]);

  const resetView = useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); }, [setScale, setPos]);
  const zoomIn = useCallback(() => setScale((p) => Math.min(p + 0.5, 10)), [setScale]);
  const zoomOut = useCallback(() => setScale((p) => { const n = p - 0.5; return n <= 1 ? 1 : n; }), [setScale]);

  // 新图片加载时重置视图
  useEffect(() => { queueMicrotask(resetView); }, [src, resetView]);

  // 立即应用变换（切换图片时）
  useLayoutEffect(() => { applyTransform(); }, [applyTransform]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  }, [zoomIn, zoomOut]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { ...posRef.current };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPos({
      x: posStart.current.x + (e.clientX - dragStart.current.x),
      y: posStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, [dragging, setPos]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleAnnotationSubmit = useCallback((annotatedDataUrl: string, prompt: string) => {
    setShowAnnotationEditor(false);
    void applyAnnotatedImageAsReference(annotatedDataUrl, prompt).then(() => {
      onClose();
    }).catch((err) => {
      console.error('标注图片发送失败:', err);
    });
  }, [onClose]);

  if (showAnnotationEditor) {
    return (
      <ImageAnnotationEditor
        src={src}
        title={title}
        onClose={() => setShowAnnotationEditor(false)}
        onSubmit={handleAnnotationSubmit}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9999] select-none bg-background/80 backdrop-blur-sm"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
      onWheel={handleWheel}
    >
      {/* 顶部标题栏 */}
      <div className="absolute top-0 left-0 right-0 z-20 flex h-12 items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-4">
        <span className="text-sm font-medium text-foreground">{title || "图片查看"}</span>
        <Button variant="ghost" size="icon" onClick={onClose} title="关闭">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* 底部缩放控件 */}
      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-background/90 px-2 py-1.5 shadow-lg ring-1 ring-border backdrop-blur-sm">
        <button onClick={zoomOut} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="缩小">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
        </button>
        <span className="min-w-[44px] text-center text-xs tabular-nums text-muted-foreground">{Math.round(scaleState * 100)}%</span>
        <button onClick={zoomIn} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="放大">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button onClick={resetView} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="重置视图">
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => setShowAnnotationEditor(true)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="画笔标注编辑">
          <Pencil className="w-4 h-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => { if (actionPayload) void runImageAction('download', actionPayload); }} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="下载">
          <Download className="w-4 h-4" />
        </button>
        {actionPayload && (
          <>
            <button onClick={() => void runImageAction('copy', actionPayload)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="复制图片">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={() => void runImageAction('add-to-assets', actionPayload)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="添加到素材库">
              <ImagePlus className="w-4 h-4" />
            </button>
            <button onClick={() => void runImageAction('use-as-reference', actionPayload)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="作为图生图参考">
              <Wand2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* 图片拖拽区域 */}
      <div
        className="absolute inset-0 overflow-hidden pt-12"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={title || ""}
          draggable={false}
          className="h-full w-full origin-center object-contain will-change-transform"
          style={{ transition: dragging ? 'none' : 'transform 120ms ease-out' }}
        />
      </div>
    </div>
  );
}
