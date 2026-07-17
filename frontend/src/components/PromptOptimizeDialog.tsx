'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface PromptOptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalPrompt: string;
  optimizedPrompt: string;
  loading: boolean;
  error: string | null;
  onAccept: () => void;
  onCancel: () => void;
}

export function PromptOptimizeDialog({
  open,
  onOpenChange,
  originalPrompt,
  optimizedPrompt,
  loading,
  error,
  onAccept,
  onCancel,
}: PromptOptimizeDialogProps) {
  /**
   * 关闭弹窗并终止当前优化请求，确保取消回调只执行一次。
   * @returns 无返回值。
   */
  const handleClose = () => {
    onCancel();
    onOpenChange(false);
  };

  /**
   * 接受优化后的提示词并关闭弹窗。
   * @returns 无返回值。
   */
  const handleAccept = () => {
    onAccept();
    onOpenChange(false);
  };

  /**
   * 同步 Dialog 的开关事件；关闭时统一走取消清理逻辑。
   * @param nextOpen Dialog 请求设置的开关状态。
   * @returns 无返回值。
   */
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose();
      return;
    }
    onOpenChange(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            提示词优化
            {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* 原始提示词 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">原始提示词</span>
            <div className="min-h-[120px] max-h-[300px] overflow-y-auto rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {originalPrompt || <span className="text-muted-foreground italic">（空）</span>}
            </div>
          </div>

          {/* 优化后提示词 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-primary">优化后</span>
            <div className={cn(
              'min-h-[120px] max-h-[300px] overflow-y-auto rounded-lg border px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
              loading
                ? 'border-primary/30 bg-primary/5'
                : optimizedPrompt
                  ? 'border-primary/30 bg-card'
                  : 'border-border bg-muted/20',
            )}>
              {loading && !optimizedPrompt ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在优化...
                </span>
              ) : optimizedPrompt ? (
                <>
                  {optimizedPrompt}
                  {loading && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-primary/70" />}
                </>
              ) : (
                <span className="text-muted-foreground italic">等待优化结果...</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleAccept}
            disabled={loading || !optimizedPrompt || !!error}
          >
            接受优化
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
