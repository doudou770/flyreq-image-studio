'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, FileAudio, FileText, FileVideo, Grid3X3, ImageIcon, Loader2, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getAssetThumbnailBlob,
  getAssetBlob,
  listImageAssets,
  listTextAssets,
  listAssets,
  isImageAsset,
  isMediaAsset,
  isTextAsset,
  touchAsset,
  type ImageAsset,
  type MediaAsset,
  type TextAsset,
  type AssetItem,
} from '@/lib/asset-store';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/LanguageProvider';

interface AgentAssetPickerDialogProps {
  open: boolean;
  maxSelected?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (assets: ImageAsset[]) => void;
}

/** 视频工作台使用的媒体素材选择器属性。 */
export interface MediaAssetPickerDialogProps {
  open: boolean;
  kind: 'video' | 'audio';
  maxSelected?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (assets: MediaAsset[]) => void;
}

/** 统一素材选择器属性，供同时支持图片、视频、音频和文本的工作流使用。 */
export interface UnifiedAssetPickerDialogProps {
  open: boolean;
  maxSelected?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (assets: AssetItem[]) => void;
}

/** 加载统一素材选择器中的图片缩略图或视频首帧预览。 */
function UnifiedAssetPreview({ asset, fallback }: { asset: AssetItem; fallback: ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const load = async (): Promise<void> => {
      const blob = isImageAsset(asset) ? await getAssetThumbnailBlob(asset) : isMediaAsset(asset) ? await getAssetBlob(asset.id) : null;
      if (!blob || !active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    };
    void load();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset]);
  if (isImageAsset(asset) && url) return <img src={url} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />;
  if (asset.kind === 'video' && url) return <video src={url} className="h-full w-full object-cover" muted preload="metadata" />;
  return <div className="flex h-full w-full items-center justify-center">{fallback}</div>;
}

/** 在一个素材库弹窗中选择任意类型的素材。 */
export function UnifiedAssetPickerDialog({ open, maxSelected = 8, onOpenChange, onConfirm }: UnifiedAssetPickerDialogProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'text' | 'image' | 'video' | 'audio'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listAssets().then(setAssets).finally(() => setLoading(false));
  }, [open]);
  useEffect(() => {
    if (!open) { setQuery(''); setKind('all'); setSelected(new Set()); }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const filtered = useMemo(() => assets.filter(asset => {
    if (kind !== 'all' && asset.kind !== kind && !(kind === 'image' && !asset.kind)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${isTextAsset(asset) ? asset.content : asset.name} ${!isTextAsset(asset) ? `${asset.tags.join(' ')} ${asset.note}` : ''}`.toLowerCase().includes(q);
  }), [assets, kind, query]);
  const labels: Array<{ value: typeof kind; label: string }> = [
    { value: 'all', label: t('assets.allTypes') },
    { value: 'text', label: t('assets.prompt') },
    { value: 'image', label: t('assets.image') },
    { value: 'video', label: t('assets.video') },
    { value: 'audio', label: t('assets.audio') },
  ];
  /** 根据素材类型返回统一选择器中的预览图标。 */
  const iconFor = (asset: AssetItem) => isTextAsset(asset) ? <FileText className="h-8 w-8" /> : asset.kind === 'video' ? <FileVideo className="h-8 w-8" /> : asset.kind === 'audio' ? <FileAudio className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen flex-col sm:h-auto sm:max-h-[86dvh] sm:w-full sm:max-w-3xl sm:rounded-xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Grid3X3 className="h-4 w-4" />{t('assetPicker.importAllTitle')}</DialogTitle></DialogHeader>
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <div className="relative min-w-48 flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('assetPicker.searchAll')} className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30" /></div>
        <span className="text-xs text-muted-foreground">{selected.size}/{maxSelected}</span>
        <Button size="sm" onClick={() => { onConfirm(assets.filter(asset => selected.has(asset.id))); onOpenChange(false); }} disabled={selected.size === 0}>{t('common.import')}</Button>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">{labels.map(option => <button key={option.value} type="button" onClick={() => setKind(option.value)} className={cn('shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors', kind === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}>{option.label}</button>)}</div>
      {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : filtered.length === 0 ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">{t('assetPicker.noAllAssets')}</div> : <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">{filtered.map(asset => { const isSelected = selected.has(asset.id); const displayName = isTextAsset(asset) ? asset.content.slice(0, 80) : asset.name; return <button key={asset.id} type="button" onClick={() => setSelected(prev => { const next = new Set(prev); if (next.has(asset.id)) next.delete(asset.id); else if (next.size < maxSelected) next.add(asset.id); return next; })} className={cn('relative overflow-hidden rounded-md border bg-card text-left transition-colors', isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-muted-foreground/40')}><div className="flex aspect-video items-center justify-center bg-muted text-primary/70"><UnifiedAssetPreview asset={asset} fallback={iconFor(asset)} />{isSelected && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}</div><div className="p-2"><p className="truncate text-xs font-medium">{displayName}</p><p className="truncate text-[10px] text-muted-foreground">{asset.kind === 'text' ? t('assets.prompt') : asset.kind === 'image' || !asset.kind ? t('assets.image') : asset.kind === 'video' ? t('assets.video') : t('assets.audio')}</p></div></button>; })}</div>}
    </DialogContent>
  </Dialog>;
}

/** 选择素材库中的视频或音频，并返回用户选中的媒体记录。 */
export function MediaAssetPickerDialog({ open, kind, maxSelected = 3, onOpenChange, onConfirm }: MediaAssetPickerDialogProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listAssets(kind).then(items => setAssets(items.filter(isMediaAsset))).finally(() => setLoading(false));
  }, [kind, open]);
  useEffect(() => { if (!open) { setQuery(''); setSelected(new Set()); } }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const filtered = useMemo(() => assets.filter(asset => !query.trim() || `${asset.name} ${asset.tags.join(' ')} ${asset.note}`.toLowerCase().includes(query.trim().toLowerCase())), [assets, query]);
  const selectedAssets = useMemo(() => assets.filter(asset => selected.has(asset.id)), [assets, selected]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen flex-col sm:h-auto sm:max-h-[86dvh] sm:w-full sm:max-w-2xl sm:rounded-xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2">{kind === 'video' ? <FileVideo className="h-4 w-4" /> : <FileAudio className="h-4 w-4" />}{kind === 'video' ? t('assetPicker.videoAssets') : t('assetPicker.audioAssets')}</DialogTitle></DialogHeader>
      <div className="flex items-center gap-2 border-b pb-2"><div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('assetPicker.searchMedia')} className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30" /></div><span className="text-xs text-muted-foreground">{selected.size}/{maxSelected}</span><Button size="sm" onClick={() => { onConfirm(selectedAssets); onOpenChange(false); }} disabled={selected.size === 0}>{t('common.import')}</Button></div>
      {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : filtered.length === 0 ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">{t('assetPicker.noMediaAssets')}</div> : <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">{filtered.map(asset => { const isSelected = selected.has(asset.id); return <button key={asset.id} type="button" onClick={() => setSelected(prev => { const next = new Set(prev); if (next.has(asset.id)) next.delete(asset.id); else if (next.size < maxSelected) next.add(asset.id); return next; })} className={cn('overflow-hidden rounded-md border text-left transition-colors', isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-muted-foreground/40')}><div className="flex aspect-video items-center justify-center bg-muted text-primary/70">{kind === 'video' ? <FileVideo className="h-8 w-8" /> : <FileAudio className="h-8 w-8" />} {isSelected && <span className="absolute m-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}</div><div className="p-2"><p className="truncate text-xs font-medium">{asset.name}</p><p className="text-[10px] text-muted-foreground">{asset.sizeBytes ? `${(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}</p></div></button>; })}</div>}
    </DialogContent>
  </Dialog>;
}

interface AgentTextAssetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (asset: TextAsset) => void;
}

const COLS = { mobile: 2, sm: 4, md: 5, lg: 6 } as const;
const CARD_GAP = 8; // gap-2
const CARD_META_HEIGHT = 110; // min-h-[110px]

function matchesAsset(asset: ImageAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    asset.name,
    asset.note,
    asset.sourceLabel,
    asset.prompt || '',
    asset.tags.join(' '),
  ].some(value => value.toLowerCase().includes(q));
}

function matchesTextAsset(asset: TextAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    asset.content,
    asset.sourceLabel,
    asset.sourceRef || '',
  ].some(value => value.toLowerCase().includes(q));
}

function AssetThumb({ asset }: { asset: ImageAsset }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void getAssetThumbnailBlob(asset).then(blob => {
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setThumbUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset]);

  if (!thumbUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <ImageIcon className="h-4 w-4 opacity-50" />
      </div>
    );
  }

  return <img src={thumbUrl} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />;
}

export function AgentTextAssetPickerDialog({
  open,
  onOpenChange,
  onConfirm,
}: AgentTextAssetPickerDialogProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<TextAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      if (prevOpenRef.current) {
        setQuery('');
        setSelectedId('');
      }
      prevOpenRef.current = false;
      return;
    }
    if (!prevOpenRef.current) {
      prevOpenRef.current = true;
      setLoading(true);
      void listTextAssets()
        .then(nextAssets => {
          setAssets(nextAssets);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open]);

  const filteredAssets = useMemo(
    () => assets.filter(asset => matchesTextAsset(asset, query)),
    [assets, query],
  );

  const selectedAsset = useMemo(
    () => assets.find(asset => asset.id === selectedId) || null,
    [assets, selectedId],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedAsset) return;
    onConfirm(selectedAsset);
    void touchAsset(selectedAsset.id);
    onOpenChange(false);
  }, [onConfirm, onOpenChange, selectedAsset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen flex-col sm:h-auto sm:max-h-[86dvh] sm:w-full sm:max-w-3xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t('assetPicker.importPromptTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b pb-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('assetPicker.searchPrompts')}
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={t('common.clearSearch')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selectedAsset}>
            {t('common.import')}
          </Button>
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileText className="h-8 w-8 opacity-50" />
            <p className="text-sm">{assets.length === 0 ? t('assetPicker.noPromptAssets') : t('assetPicker.noMatchingPrompts')}</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {filteredAssets.map(asset => {
              const selected = selectedId === asset.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setSelectedId(asset.id)}
                  onDoubleClick={() => {
                    onConfirm(asset);
                    void touchAsset(asset.id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    'w-full rounded-md border bg-card p-3 text-left transition-colors',
                    selected ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-muted-foreground/30'
                  )}
                  title={asset.content}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                    )}>
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{asset.content}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 根据容器宽度计算列数：手机端2列，电脑端按可用宽度增加密度 */
function calcCols(width: number): number {
  if (width >= 960) return COLS.lg;
  if (width >= 760) return COLS.md;
  if (width >= 560) return COLS.sm;
  return COLS.mobile;
}

export function AgentAssetPickerDialog({
  open,
  maxSelected = 5,
  onOpenChange,
  onConfirm,
}: AgentAssetPickerDialogProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const tagDragRef = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, dragged: false });
  const [cols, setCols] = useState<number>(COLS.mobile);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void listImageAssets()
      .then(nextAssets => {
        if (cancelled) return;
        setAssets(nextAssets);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedTag('');
      setSelectedIds(new Set());
    }
  }, [open]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const asset of assets) {
      for (const tag of asset.tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [assets]);

  const filteredAssets = useMemo(
    () => assets.filter(asset => {
      if (selectedTag && !asset.tags.includes(selectedTag)) return false;
      return matchesAsset(asset, query);
    }),
    [assets, query, selectedTag],
  );

  const selectedAssets = useMemo(
    () => assets.filter(asset => selectedIds.has(asset.id)),
    [assets, selectedIds],
  );

  // 监听容器宽度变化以动态计算列数。列表容器在加载/空状态不会渲染，需要等结果出现后再绑定。
  useEffect(() => {
    if (!open || loading || filteredAssets.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const applyWidth = (width: number) => {
      setContainerWidth(width);
      setCols(calcCols(width));
    };
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        applyWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    applyWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [filteredAssets.length, loading, open]);

  const rowCount = Math.ceil(filteredAssets.length / cols);
  const rowHeight = useMemo(() => {
    if (!containerWidth) return 260;
    const totalGap = CARD_GAP * Math.max(0, cols - 1);
    const cardWidth = Math.floor((containerWidth - totalGap) / cols);
    return Math.max(0, cardWidth) + CARD_META_HEIGHT + CARD_GAP;
  }, [cols, containerWidth]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [cols, filteredAssets.length, rowVirtualizer]);

  const toggleAsset = useCallback((assetId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
        return next;
      }
      if (next.size >= maxSelected) return next;
      next.add(assetId);
      return next;
    });
  }, [maxSelected]);

  const handleConfirm = useCallback(() => {
    if (selectedAssets.length === 0) return;
    onConfirm(selectedAssets);
    onOpenChange(false);
  }, [onConfirm, onOpenChange, selectedAssets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen flex-col sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-5xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3X3 className="h-4 w-4" />
            {t('assetPicker.importImageTitle')}
            <span className="text-xs font-normal text-muted-foreground">
              {t('assetPicker.selectedCount', { selected: selectedIds.size, max: maxSelected })}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b pb-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('assetPicker.searchImages')}
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={t('common.clearSearch')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={selectedIds.size === 0}>
            {t('common.import')}
          </Button>
        </div>

        {allTags.length > 0 && (
          <div
            className="flex gap-1.5 overflow-x-auto border-b pb-2 touch-pan-x select-none overscroll-x-contain [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none' }}
            onPointerDown={event => {
              const el = event.currentTarget;
              if (!el || (event.pointerType === 'mouse' && event.button !== 0) || el.scrollWidth <= el.clientWidth) return;
              tagDragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: el.scrollLeft, dragged: false };
            }}
            onPointerMove={event => {
              const el = event.currentTarget;
              const state = tagDragRef.current;
              if (state.pointerId !== event.pointerId) return;
              const deltaX = event.clientX - state.startX;
              if (Math.abs(deltaX) > 4) state.dragged = true;
              if (state.dragged) { el.scrollLeft = state.scrollLeft - deltaX; event.preventDefault(); }
            }}
            onPointerUp={() => {
              tagDragRef.current.pointerId = -1;
            }}
            onPointerLeave={() => {
              tagDragRef.current.pointerId = -1;
              tagDragRef.current.dragged = false;
            }}
            onClickCapture={event => {
              if (!tagDragRef.current.dragged) return;
              event.preventDefault();
              event.stopPropagation();
              tagDragRef.current.dragged = false;
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedTag('')}
              className={cn('inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs leading-tight transition-colors', !selectedTag ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}
            >
              {t('assetPicker.allTags')}
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={cn('inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs leading-tight transition-colors', selectedTag === tag ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-50" />
            <p className="text-sm">{assets.length === 0 ? t('assetPicker.noImageAssets') : t('assetPicker.noMatchingImages')}</p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div
              className="relative w-full"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const rowStart = virtualRow.index * cols;
                const rowItems = filteredAssets.slice(rowStart, rowStart + cols);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="grid gap-2 pb-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                      {rowItems.map(asset => {
                        const selected = selectedIds.has(asset.id);
                        const disabled = !selected && selectedIds.size >= maxSelected;
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => toggleAsset(asset.id)}
                            onDragStart={(e) => e.preventDefault()}
                            disabled={disabled}
                            className={cn(
                              'group flex min-h-0 flex-col overflow-hidden rounded-md border bg-card text-left transition-colors',
                              selected ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-muted-foreground/30',
                              disabled && 'cursor-not-allowed opacity-45'
                            )}
                            title={asset.name}
                          >
                            <div className="relative aspect-square w-full overflow-hidden bg-muted">
                              <AssetThumb asset={asset} />
                              <span className={cn(
                                'absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border shadow-sm',
                                selected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/70 bg-black/35 text-white'
                              )}>
                                {selected && <Check className="h-3 w-3" />}
                              </span>
                            </div>
                            <div className="flex min-h-[110px] flex-col gap-1.5 p-2">
                              <p className="truncate text-sm font-medium text-foreground">{asset.name}</p>
                              <div className="flex min-h-5 flex-wrap gap-1 overflow-hidden">
                                {asset.tags.length > 0
                                  ? asset.tags.slice(0, 3).map(tag => <Badge key={tag} variant="outline" className="h-auto min-h-5 max-w-full px-1.5 py-0.5 text-[10px] leading-tight">{tag}</Badge>)
                                  : <span className="text-[11px] text-muted-foreground">{t('assetPicker.noTags')}</span>}
                              </div>
                              <p className="line-clamp-2 min-w-0 text-xs leading-relaxed text-muted-foreground">
                                {asset.note || asset.prompt || t('assetPicker.noNotes')}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
