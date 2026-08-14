'use client';

import { useEffect } from 'react';
import { Bot, Film, Frame, Images, LibraryBig, PanelLeftClose, PanelLeftOpen, ScanSearch, Settings, Shuffle, Sparkles, User, Video, Wallpaper, X } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button, buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useBranding } from '@/components/BrandProvider';
import { useI18n } from '@/components/LanguageProvider';
import type { FlyreqQueueStatus } from '@/lib/flyreq-task-client';
import { BA_RANDOM_URL, BING_WALLPAPER_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface WorkspaceModeTabsProps {
  activeTab: string;
  collapsed: boolean;
  mobileOpen: boolean;
  queueStatus: FlyreqQueueStatus | null;
  showPromptGalleryEntry: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
  onOpenPromptGallery: () => void;
  onOpenRandomImage: (url: string, title: string) => void;
}

const tabs = [
  { value: 'image-generation', icon: Sparkles, labelKey: 'tabs.imageGeneration' },
  { value: 'video-generation', icon: Video, labelKey: 'tabs.videoGeneration' },
  { value: 'canvas', icon: Frame, labelKey: 'tabs.canvas' },
  { value: 'assets', icon: Images, labelKey: 'tabs.assets' },
  { value: 'reverse-prompt', icon: ScanSearch, labelKey: 'tabs.reversePrompt' },
  { value: 'gif', icon: Film, labelKey: 'tabs.gif' },
  { value: 'agent', icon: Bot, labelKey: 'tabs.agent' },
] as const;

/**
 * 渲染统一的响应式主导航，包括桌面收缩栏和手机侧滑抽屉。
 * @param props 当前工作台、导航状态、队列状态及快捷操作回调。
 * @returns 桌面侧栏或手机抽屉形式的工作台导航。
 */
export function WorkspaceModeTabs({
  activeTab,
  collapsed,
  mobileOpen,
  queueStatus,
  showPromptGalleryEntry,
  onMobileOpenChange,
  onToggleCollapsed,
  onOpenSettings,
  onOpenPromptGallery,
  onOpenRandomImage,
}: WorkspaceModeTabsProps) {
  const { t } = useI18n();
  const { platformName, logoUrl } = useBranding();
  const processingSlots = queueStatus?.processingSlots ?? queueStatus?.processingCount ?? 0;
  const queuedSlots = queueStatus?.queuedSlots ?? queueStatus?.queuedCount ?? 0;
  const pendingSlots = queueStatus?.pendingSlots ?? (
    typeof processingSlots === 'number' && typeof queuedSlots === 'number'
      ? processingSlots + queuedSlots
      : undefined
  );
  const labelsHidden = collapsed ? 'lg:hidden' : '';

  useEffect(() => {
    if (!mobileOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    /** 按下 Escape 时关闭手机导航抽屉。 */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileOpenChange(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen, onMobileOpenChange]);

  return (
    <div className={cn('fixed inset-0 z-50 lg:static lg:z-auto lg:block lg:h-full lg:shrink-0', mobileOpen ? 'block' : 'hidden lg:block')}>
      <button
        type="button"
        className="absolute inset-0 bg-black/35 backdrop-blur-[1px] lg:hidden"
        onClick={() => onMobileOpenChange(false)}
        aria-label={t('navigation.closeMenu')}
      />
      <aside
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label={t('navigation.menu')}
        className={cn(
          'absolute inset-y-0 left-0 flex w-[min(88vw,320px)] flex-col border-r border-border bg-card p-3 shadow-2xl transition-[width] duration-200 lg:relative lg:inset-auto lg:h-full lg:max-h-full lg:w-[220px] lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:shadow-none',
          collapsed && 'lg:w-14 lg:px-2',
        )}
      >
        <div className={cn('flex h-11 items-center gap-2', collapsed ? 'lg:justify-center' : 'justify-between')}>
          <div className={cn('flex min-w-0 items-center gap-2', collapsed && 'lg:justify-center')}>
            <img src={logoUrl} alt={`${platformName} logo`} className="size-8 shrink-0 rounded-lg object-cover ring-1 ring-border/60" />
            <div className={cn('min-w-0', labelsHidden)}>
              <p className="truncate text-sm font-semibold">{platformName}</p>
              <p className="truncate text-[10px] text-muted-foreground">{t('app.subtitle')}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => onMobileOpenChange(false)} title={t('navigation.closeMenu')}>
            <X className="size-4" />
          </Button>
        </div>

        <TabsList className="mt-4 flex h-auto w-full flex-col gap-1 rounded-none bg-transparent p-0">
          {tabs.map(({ value, icon: Icon, labelKey }) => (
            <TabsTrigger
              key={value}
              value={value}
              onClick={() => onMobileOpenChange(false)}
              title={collapsed ? t(labelKey) : undefined}
              className={cn(
                'h-10 w-full flex-none justify-start gap-3 rounded-lg px-3 text-xs data-active:bg-primary/10 data-active:text-primary data-active:shadow-none',
                collapsed && 'lg:justify-center lg:px-0',
              )}
            >
              <Icon className="size-4" />
              <span className={labelsHidden}>{t(labelKey)}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="my-3 h-px bg-border" />
        <div className="space-y-1">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'h-9 w-full justify-start gap-3 rounded-lg px-3 text-xs',
                collapsed && 'lg:justify-center lg:px-0',
              )}
              title={collapsed ? t('toolbar.randomImage') : undefined}
              aria-label={t('toolbar.randomImage')}
            >
              <Shuffle className="size-4 shrink-0" />
              <span className={labelsHidden}>{t('toolbar.randomImage')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4}>
              <DropdownMenuItem onClick={() => { onMobileOpenChange(false); onOpenRandomImage(BA_RANDOM_URL, t('toolbar.baPeople')); }}>
                <User className="size-4" />
                {t('toolbar.baPeople')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { onMobileOpenChange(false); onOpenRandomImage(BING_WALLPAPER_URL, t('toolbar.bingWallpaper')); }}>
                <Wallpaper className="size-4" />
                {t('toolbar.bingWallpaper')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {showPromptGalleryEntry && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-9 w-full justify-start gap-3 rounded-lg px-3 text-xs',
                activeTab === 'prompt-gallery' && 'bg-primary/10 text-primary',
                collapsed && 'lg:justify-center lg:px-0',
              )}
              onClick={() => { onMobileOpenChange(false); onOpenPromptGallery(); }}
              title={collapsed ? t('tabs.promptGallery') : undefined}
              aria-label={t('tabs.promptGallery')}
            >
              <LibraryBig className="size-4 shrink-0" />
              <span className={labelsHidden}>{t('tabs.promptGallery')}</span>
            </Button>
          )}
        </div>

        <div className="mt-auto space-y-2 pt-3">
          <div className={cn('space-y-1 border-t border-border pt-3', collapsed && 'lg:flex lg:justify-center')}>
            {collapsed ? (
              <span
                className={cn(
                  'hidden size-2 rounded-full lg:block',
                  !queueStatus ? 'bg-muted-foreground' : queueStatus.acceptingNewTasks ? 'bg-emerald-500' : 'bg-destructive',
                )}
                title={queueStatus
                  ? `${t('queue.concurrency', { count: processingSlots })} · ${typeof pendingSlots === 'number' && typeof queueStatus.maxQueueSize === 'number' ? t('queue.capacity', { count: pendingSlots, max: queueStatus.maxQueueSize }) : t('queue.queued', { count: queuedSlots })} · ${t('queue.status', { status: queueStatus.acceptingNewTasks ? t('queue.statusOpen') : t('queue.statusClosed') })}`
                  : t('queue.unknown')}
              />
            ) : queueStatus ? (
              <div className="space-y-1 text-[10px]">
                <p className="px-1 font-medium text-muted-foreground">{t('queue.overview')}</p>
                <div className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-muted-foreground" title={t('queue.concurrencyHint')}>
                  <span>{t('queue.concurrencyLabel')}</span>
                  <strong className="font-medium tabular-nums text-foreground">{processingSlots}</strong>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-muted-foreground" title={t('queue.capacityHint')}>
                  <span>{typeof queueStatus.maxQueueSize === 'number' ? t('queue.capacityLabel') : t('queue.queuedLabel')}</span>
                  <strong className="font-medium tabular-nums text-foreground">{typeof pendingSlots === 'number' && typeof queueStatus.maxQueueSize === 'number' ? `${pendingSlots}/${queueStatus.maxQueueSize}` : queuedSlots}</strong>
                </div>
                <div className={cn('flex items-center justify-between rounded-md px-2 py-1', queueStatus.acceptingNewTasks ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive')} title={t('queue.statusHint')}>
                  <span>{t('queue.statusLabel')}</span>
                  <strong className="font-medium">{queueStatus.acceptingNewTasks ? t('queue.statusOpen') : t('queue.statusClosed')}</strong>
                </div>
              </div>
            ) : (
              <p className="text-center text-[10px] text-muted-foreground">{t('queue.unknown')}</p>
            )}
          </div>
          <div className={cn(
            'grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1 [&>[data-slot=button]]:w-full [&_[data-slot=dropdown-menu-trigger]]:w-full [&_[data-slot=dropdown-menu-trigger]]:justify-center',
            collapsed && 'lg:grid-cols-1',
          )}>
            <ThemeToggle iconOnly />
            <LanguageToggle iconOnly />
            <Button variant="ghost" size="icon-sm" className="w-full rounded-md" onClick={() => { onMobileOpenChange(false); onOpenSettings(); }} title={t('common.settings')} aria-label={t('common.settings')}>
              <Settings className="size-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={cn('hidden h-9 w-full justify-start gap-3 rounded-lg px-3 text-xs lg:flex', collapsed && 'lg:justify-center lg:px-0')}
            onClick={onToggleCollapsed}
            title={collapsed ? t('navigation.expandMenu') : t('navigation.collapseMenu')}
            aria-label={collapsed ? t('navigation.expandMenu') : t('navigation.collapseMenu')}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            <span className={labelsHidden}>{collapsed ? t('navigation.expandMenu') : t('navigation.collapseMenu')}</span>
          </Button>
        </div>
      </aside>
    </div>
  );
}
