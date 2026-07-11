'use client';

import { useState, useCallback } from 'react';
import { Brain, Copy, Check, Clock, Loader2, RefreshCw, Sparkles, Image as ImageIcon, MessageSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderReasoning } from '@/lib/render-reasoning';
import { MAX_PARALLEL_COUNT } from '@/lib/model-capabilities';
import type { AgentPhase } from '@/hooks/useAgentChat';

interface AgentGenerationResultProps {
  text: string;
  reasoning?: string;
}

interface AgentGenerationProgressProps {
  analysis: string;
  reasoning?: string;
  prompt: string;
  parallelCount: number;
  phase: AgentPhase;
  elapsedSeconds: number;
  taskId?: string;
  isSyncing?: boolean;
  checkNowDisabled?: boolean;
  checkNowLabel?: string;
  onCheckNow?: () => void;
  onSkipDescribing?: () => void;
}

interface ParsedSection {
  label: string;
  content: string;
  icon: React.ReactNode;
  color: string;
}

interface GenerationSectionCardProps {
  section: ParsedSection;
  copiedText: string | null;
  onCopy: (content: string, label: string) => void;
}

function parseGenerationText(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  
  // 解析分析部分
  const analysisMatch = text.match(/分析：([\s\S]*?)(?=优化提示词：|$)/);
  if (analysisMatch) {
    sections.push({
      label: '分析',
      content: analysisMatch[1].trim(),
      icon: <Brain className="h-3.5 w-3.5" />,
      color: 'text-blue-500',
    });
  }
  
  // 解析优化提示词部分
  const promptMatch = text.match(/优化提示词：([\s\S]*?)(?=结果：|$)/);
  if (promptMatch) {
    sections.push({
      label: '优化提示词',
      content: promptMatch[1].trim(),
      icon: <Sparkles className="h-3.5 w-3.5" />,
      color: 'text-purple-500',
    });
  }
  
  // 解析结果部分
  const resultMatch = text.match(/结果：([\s\S]*?)$/);
  if (resultMatch) {
    sections.push({
      label: '结果',
      content: resultMatch[1].trim(),
      icon: <ImageIcon className="h-3.5 w-3.5" />,
      color: 'text-green-500',
    });
  }
  
  // 如果没有匹配到任何部分，返回原始文本作为分析
  if (sections.length === 0) {
    sections.push({
      label: '分析',
      content: text,
      icon: <Brain className="h-3.5 w-3.5" />,
      color: 'text-blue-500',
    });
  }
  
  return sections;
}

function getProgressLabel(phase: AgentPhase, hasTaskId: boolean): string {
  switch (phase) {
    case 'generating':
      return hasTaskId ? '正在生成图片' : '正在提交任务';
    case 'loading':
      return '正在取回图片';
    case 'describing':
      return '正在识别图片描述';
    default:
      return '正在准备生成';
  }
}

function GenerationSectionCard({ section, copiedText, onCopy }: GenerationSectionCardProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-3 transition-colors hover:bg-card">
      <div className="mb-2 flex items-center justify-between">
        <div className={cn('flex items-center gap-2 text-xs font-medium', section.color)}>
          {section.icon}
          {section.label}
        </div>
        <button
          type="button"
          onClick={() => onCopy(section.content, section.label)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title={`复制${section.label}`}
        >
          {copiedText === section.label ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copiedText === section.label ? '已复制' : '复制'}
        </button>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {section.content}
      </div>
    </div>
  );
}

export function AgentGenerationResult({ text, reasoning }: AgentGenerationResultProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const sections = parseGenerationText(text);
  
  const handleCopy = useCallback(async (content: string, label: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // 剪贴板写入失败静默忽略
    }
  }, []);
  
  return (
    <div className="space-y-3">
      {/* 思考过程（可折叠） */}
      {reasoning && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            思考过程
            <span className="text-[10px] opacity-60 group-open:rotate-90 transition-transform">▶</span>
          </summary>
          <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <div dangerouslySetInnerHTML={{ __html: renderReasoning(reasoning) }} />
          </div>
        </details>
      )}
      
      {/* 结构化显示三个部分 */}
      {sections.map((section, index) => (
        <GenerationSectionCard
          key={index}
          section={section}
          copiedText={copiedText}
          onCopy={handleCopy}
        />
      ))}
    </div>
  );
}

export function AgentGenerationProgress({
  analysis,
  reasoning,
  prompt,
  parallelCount,
  phase,
  elapsedSeconds,
  taskId,
  isSyncing = false,
  checkNowDisabled = false,
  checkNowLabel = '主动查询',
  onCheckNow,
  onSkipDescribing,
}: AgentGenerationProgressProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const progressLabel = getProgressLabel(phase, Boolean(taskId));
  const placeholderCount = Math.max(1, Math.min(MAX_PARALLEL_COUNT, Math.trunc(parallelCount) || 1));
  const sections: ParsedSection[] = [
    {
      label: '分析',
      content: analysis || '根据你的描述，正在生成图片。',
      icon: <Brain className="h-3.5 w-3.5" />,
      color: 'text-blue-500',
    },
    {
      label: '优化提示词',
      content: prompt,
      icon: <Sparkles className="h-3.5 w-3.5" />,
      color: 'text-purple-500',
    },
  ];

  const handleCopy = useCallback(async (content: string, label: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // 剪贴板写入失败静默忽略
    }
  }, []);

  return (
    <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      {reasoning && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            思考过程
            <span className="text-[10px] opacity-60 transition-transform group-open:rotate-90">▶</span>
          </summary>
          <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <div dangerouslySetInnerHTML={{ __html: renderReasoning(reasoning) }} />
          </div>
        </details>
      )}

      {sections.map((section, index) => (
        <GenerationSectionCard
          key={index}
          section={section}
          copiedText={copiedText}
          onCopy={handleCopy}
        />
      ))}

      <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="font-medium text-foreground">{progressLabel}</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="h-3.5 w-3.5" />
            {elapsedSeconds}s
          </span>
          {taskId && (
            <span className="min-w-0 max-w-[14rem] truncate rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] sm:max-w-[18rem]">
              {taskId}
            </span>
          )}
          {(phase === 'describing') && onSkipDescribing && (
            <button
              type="button"
              onClick={() => {
                if (confirm('跳过后图片将直接显示，但不会生成文字描述。确定要跳过吗？')) {
                  onSkipDescribing();
                }
              }}
              className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title="跳过图片识别，直接显示图片"
            >
              <X className="h-3 w-3" />
              跳过识别
            </button>
          )}
          {phase === 'generating' && taskId && onCheckNow && (
            <button
              type="button"
              onClick={onCheckNow}
              disabled={checkNowDisabled}
              className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              title={checkNowDisabled ? '请稍候再查询' : '立即查询任务状态'}
            >
              {isSyncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {checkNowLabel}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: placeholderCount }, (_, index) => (
          <div
            key={index}
            className="relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-muted"
            aria-label={`第 ${index + 1} 张图片正在生成`}
          >
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted via-background/70 to-muted" />
            <div className="absolute inset-y-0 -left-full w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <ImageIcon className="h-4 w-4" />
              <span>生成中</span>
              <span className="tabular-nums">#{index + 1}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
