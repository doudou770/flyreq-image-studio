"use client";

import { CircleDot, Grid2x2, Image as ImageIcon, Info, LayoutDashboard, LibraryBig, Redo2, Settings2, Square, Trash2, Type, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import type { CanvasBackgroundMode } from "../lib/canvas-theme";
import { CanvasTooltip } from "./canvas-ui";

type CanvasToolbarProps = {
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
  showPromptGallery?: boolean;
  onAddImage: () => void;
  onAddText: () => void;
  onAddAnnotation: () => void;
  onAddConfig: () => void;
  onImportPromptGallery: () => void;
  onOpenTemplate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
  onShowImageInfoChange: (value: boolean) => void;
};

export function CanvasToolbar({
  selectedCount,
  canUndo,
  canRedo,
  backgroundMode,
  showImageInfo,
  showPromptGallery = true,
  onAddImage,
  onAddText,
  onAddAnnotation,
  onAddConfig,
  onImportPromptGallery,
  onOpenTemplate,
  onUndo,
  onRedo,
  onDelete,
  onBackgroundModeChange,
  onShowImageInfoChange,
}: CanvasToolbarProps) {
  return (
    <div
      data-canvas-no-zoom
      className="absolute top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-border bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <CanvasTooltip label="添加图片节点">
        <Button variant="ghost" size="icon-sm" onClick={onAddImage} aria-label="添加图片节点">
          <ImageIcon className="size-4" />
        </Button>
      </CanvasTooltip>
      <CanvasTooltip label="添加文本节点">
        <Button variant="ghost" size="icon-sm" onClick={onAddText} aria-label="添加文本节点">
          <Type className="size-4" />
        </Button>
      </CanvasTooltip>
      <CanvasTooltip label="添加注释节点">
        <Button variant="ghost" size="icon-sm" onClick={onAddAnnotation} aria-label="添加注释节点">
          <Square className="size-4" />
        </Button>
      </CanvasTooltip>
      <CanvasTooltip label="添加编排节点（提示词 + 参数 + 生成）">
        <Button variant="ghost" size="icon-sm" onClick={onAddConfig} aria-label="添加编排节点">
          <Settings2 className="size-4" />
        </Button>
      </CanvasTooltip>
      {showPromptGallery && (
        <CanvasTooltip label="从提示词广场导入">
          <Button variant="ghost" size="icon-sm" onClick={onImportPromptGallery} aria-label="从提示词广场导入">
            <LibraryBig className="size-4" />
          </Button>
        </CanvasTooltip>
      )}
      <CanvasTooltip label="画布流程模板">
        <Button variant="ghost" size="icon-sm" onClick={onOpenTemplate} aria-label="画布流程模板">
          <LayoutDashboard className="size-4" />
        </Button>
      </CanvasTooltip>

      <div className="mx-1 h-5 w-px bg-border" />

      <CanvasTooltip label="撤销">
        <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={onUndo} aria-label="撤销">
          <Undo2 className="size-4" />
        </Button>
      </CanvasTooltip>
      <CanvasTooltip label="重做">
        <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={onRedo} aria-label="重做">
          <Redo2 className="size-4" />
        </Button>
      </CanvasTooltip>

      <div className="mx-1 h-5 w-px bg-border" />

      <Segmented
        value={backgroundMode}
        onChange={onBackgroundModeChange}
        options={[
          { value: "lines", icon: <Grid2x2 />, title: "网格" },
          { value: "dots", icon: <CircleDot />, title: "圆点" },
          { value: "blank", icon: <Square />, title: "空白" },
        ]}
      />

      <CanvasTooltip label="显示图片信息">
        <label className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground">
          <Info className="size-3.5" />
          <Switch checked={showImageInfo} onCheckedChange={onShowImageInfoChange} />
        </label>
      </CanvasTooltip>

      {selectedCount > 0 && (
        <>
          <div className="mx-1 h-5 w-px bg-border" />
          <CanvasTooltip label={`删除选中（${selectedCount}）`}>
            <Button variant="destructive" size="icon-sm" onClick={onDelete} aria-label="删除选中">
              <Trash2 className="size-4" />
            </Button>
          </CanvasTooltip>
        </>
      )}
    </div>
  );
}
