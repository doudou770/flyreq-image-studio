"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AiTextGenerateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalContent: string;
  generatedContent: string;
  loading: boolean;
  error: string | null;
  onPromptSubmit: (prompt: string) => void;
  onAccept: () => void;
  onCancel: () => void;
};

export function AiTextGenerateDialog({
  open,
  onOpenChange,
  originalContent,
  generatedContent,
  loading,
  error,
  onPromptSubmit,
  onAccept,
  onCancel,
}: AiTextGenerateDialogProps) {
  const [prompt, setPrompt] = useState("");

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
    setPrompt("");
  };

  const handleAccept = () => {
    onAccept();
    onOpenChange(false);
    setPrompt("");
  };

  const handleGenerate = () => {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt) onPromptSubmit(trimmedPrompt);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleCancel();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            AI 文本生成
            {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {!generatedContent ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-prompt" className="text-xs font-medium text-muted-foreground">
                输入生成提示词
              </label>
              <Textarea
                id="ai-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.ctrlKey) {
                    event.preventDefault();
                    handleGenerate();
                  }
                }}
                placeholder="描述你想要生成的文本内容..."
                className="max-h-[300px] min-h-[120px] resize-none"
                disabled={loading}
              />
              <p className="text-[10px] text-muted-foreground">按 Ctrl + Enter 快速提交</p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={handleCancel} disabled={loading}>
                取消
              </Button>
              <Button onClick={handleGenerate} disabled={loading || !prompt.trim()}>
                {loading ? "生成中..." : "开始生成"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">原始内容</span>
                <div className="max-h-[300px] min-h-[120px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed text-foreground/80">
                  {originalContent || <span className="text-muted-foreground italic">（空）</span>}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-primary">生成结果</span>
                <div
                  className={cn(
                    "max-h-[300px] min-h-[120px] overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
                    loading
                      ? "border-primary/30 bg-primary/5"
                      : generatedContent
                        ? "border-primary/30 bg-card"
                        : "border-border bg-muted/20",
                  )}
                >
                  {generatedContent}
                  {loading && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-primary/70" />}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={handleCancel} disabled={loading}>
                取消
              </Button>
              <Button onClick={handleAccept} disabled={loading || !generatedContent || !!error}>
                接受生成结果
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
