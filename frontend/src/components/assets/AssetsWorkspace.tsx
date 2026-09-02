'use client';

import { LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileArchive,
  FileText,
  Grid3X3,
  HardDrive,
  ImageIcon,
  FileAudio,
  FileVideo,
  ImagePlus,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/components/workspace/dialogs/ConfirmDialog';
import { HistoryImagePreview } from '@/components/workspace/results/HistoryImagePreview';
import { useImageLazyLoad } from '@/hooks/useImageLazyLoad';
import {
  addImageAsset,
  addMediaAsset,
  addTextAsset,
  deleteAsset,
  formatAssetSize,
  getAssetBlob,
  getAssetThumbnailBlob,
  getSourceKindLabel,
  listAssets,
  updateMediaAsset,
  type AssetItem,
  type AssetSourceKind,
  type ImageAsset,
  type MediaAsset,
  type TextAsset,
  isImageAsset as isStoredImageAsset,
  isMediaAsset,
} from '@/lib/asset-store';
import { generateAssetMetadata, type AssetMetadataSuggestion } from '@/lib/asset-metadata-client';
import { dispatchImageActionToast, runImageAction, type ImageActionPayload } from '@/lib/image-actions';
import { loadJsonFromStorage, saveJsonToStorage } from '@/lib/settings-storage';
import { requireDefaultConfiguredTextModel } from '@/lib/model-endpoints';
import { prepareUploadImage } from '@/lib/upload-image-cache';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/LanguageProvider';

interface AssetsWorkspaceProps {
  wideMode?: boolean;
  active?: boolean;
}

const SETTINGS_KEY = LOCAL_STORAGE_KEYS.assetsSettings;
const PAGE_SIZE = 48;
const PROMPT_TAG = '提示词';
const SORT_OPTIONS: Array<{ value: 'newest' | 'oldest' | 'used' }> = [
  { value: 'newest' },
  { value: 'oldest' },
  { value: 'used' },
];
const VIEW_SIZE_OPTIONS: Array<{ value: AssetViewSize }> = [
  { value: 'compact' },
  { value: 'normal' },
  { value: 'large' },
];
type AssetViewSize = 'compact' | 'normal' | 'large';
type AssetSettings = { sort: 'newest' | 'oldest' | 'used'; viewSize: AssetViewSize };

export function loadAssetSettings(): AssetSettings {
  if (typeof window === 'undefined') return { sort: 'newest', viewSize: 'normal' };
  const saved = loadJsonFromStorage<AssetSettings>(SETTINGS_KEY);
  return {
    sort: saved.sort === 'oldest' || saved.sort === 'used' ? saved.sort : 'newest',
    viewSize: saved.viewSize === 'compact' || saved.viewSize === 'large' ? saved.viewSize : 'normal',
  };
}

function splitTags(input: string): string[] {
  return input.split(/[,\s，、]+/).map(tag => tag.trim()).filter(Boolean);
}

function isTextAsset(asset: AssetItem): asset is TextAsset {
  return asset.kind === 'text';
}

function isImageAsset(asset: AssetItem): asset is ImageAsset {
  return isStoredImageAsset(asset);
}

function uniqueTags(assets: AssetItem[]): string[] {
  const tags = new Set<string>();
  let hasTextAsset = false;
  for (const asset of assets) {
    if (isTextAsset(asset)) {
      hasTextAsset = true;
      continue;
    }
    for (const tag of asset.tags) tags.add(tag);
  }
  const imageTags = Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return hasTextAsset ? [PROMPT_TAG, ...imageTags.filter(tag => tag !== PROMPT_TAG)] : imageTags;
}

function makePayload(asset: ImageAsset): ImageActionPayload {
  return {
    id: asset.id,
    name: asset.name,
    assetId: asset.id,
    mimeType: asset.mimeType,
    sourceKind: asset.sourceKind,
    sourceLabel: asset.sourceLabel,
    sourceRef: asset.sourceRef || asset.id,
    prompt: asset.prompt,
    note: asset.note,
  };
}

function getZipEntryName(asset: ImageAsset | MediaAsset): string {
  const safeName = (asset.name || asset.id).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || asset.id;
  const ext = asset.mimeType.includes('jpeg') ? 'jpg' : asset.mimeType.split('/')[1] || 'png';
  return safeName.toLowerCase().endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`;
}

async function prepareAssetMetadataImage(asset: ImageAsset, blob: Blob): Promise<string> {
  const prepared = await prepareUploadImage(new File([blob], getZipEntryName(asset), { type: asset.mimeType || blob.type || 'image/png' }));
  return prepared.dataUrl;
}

function getTextEntryName(asset: TextAsset): string {
  const content = asset.content.trim().split(/\s+/).join('-').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  return `${content || asset.id}.txt`;
}

function matchesAsset(asset: AssetItem, query: string, tag: string, source: string, kind: string): boolean {
  if (tag === PROMPT_TAG && !isTextAsset(asset)) return false;
  if (tag && tag !== PROMPT_TAG && (!isImageAsset(asset) || !asset.tags.includes(tag))) return false;
  if (source && asset.sourceKind !== source) return false;
  if (kind && asset.kind !== kind && !(kind === 'image' && isImageAsset(asset))) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (isTextAsset(asset)) {
    return [
      asset.content,
      asset.sourceLabel,
      asset.sourceRef || '',
    ].some(value => value.toLowerCase().includes(q));
  }
  return [
    asset.name,
    asset.note,
    asset.sourceLabel,
    asset.sourceRef || '',
    isImageAsset(asset) ? asset.prompt || '' : '',
    asset.tags.join(' '),
  ].some(value => value.toLowerCase().includes(q));
}

/** 将媒体时长格式化为适合卡片显示的分钟秒数。 */
function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function StorageEstimate({ totalBytes }: { totalBytes: number }) {
  const { t } = useI18n();
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then(value => {
        if (!cancelled) setEstimate({ usage: value.usage, quota: value.quota });
      });
    }
    return () => { cancelled = true; };
  }, [totalBytes]);

  const usage = estimate?.usage;
  const quota = estimate?.quota;
  const lowSpace = typeof usage === 'number' && typeof quota === 'number' && quota > 0
    && (usage / quota >= 0.9 || quota - usage <= 250 * 1024 * 1024);
  const browserUsage = usage && quota
    ? t('assets.browserUsage', { usage: (usage / 1024 / 1024).toFixed(0), quota: (quota / 1024 / 1024).toFixed(0) })
    : '';
  const formattedTotal = totalBytes > 0 ? formatAssetSize(totalBytes) : t('assets.unknownSize');

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', lowSpace ? 'text-warning' : 'text-muted-foreground')}>
      <HardDrive className="h-3.5 w-3.5" />
      {t('assets.storage', { size: formattedTotal, browser: browserUsage })}
      {lowSpace && <span className="font-medium">{t('assets.storageLow')}</span>}
    </span>
  );
}

function AssetThumbnail({
  asset,
  viewSize,
  onPreview,
}: {
  asset: ImageAsset;
  viewSize: AssetViewSize;
  onPreview: () => void;
}) {
  const lazyLoad = useImageLazyLoad<HTMLButtonElement>({ rootMargin: '300px' });
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!lazyLoad.isVisible) return;
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
  }, [asset, lazyLoad.isVisible]);

  const { elementRef, isLoaded, handleImageLoad } = lazyLoad;

  return (
    <button
      ref={elementRef}
      type="button"
      onClick={onPreview}
      className="relative block aspect-square w-full overflow-hidden bg-muted"
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={asset.name}
          className="h-full w-full object-cover transition-opacity"
          loading="lazy"
          onLoad={handleImageLoad}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className={cn('opacity-50', viewSize === 'compact' ? 'h-5 w-5' : 'h-7 w-7')} />
        </div>
      )}
      {!isLoaded && thumbUrl && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted via-muted/50 to-muted" />
      )}
    </button>
  );
}

/** 渲染视频或音频素材的轻量预览卡片，避免读取完整文件造成布局抖动。 */
function MediaThumbnail({ asset, onPreview }: { asset: MediaAsset; onPreview: () => void }) {
  const lazyLoad = useImageLazyLoad<HTMLButtonElement>({ rootMargin: '300px' });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!lazyLoad.isVisible) return;
    let active = true;
    let objectUrl: string | null = null;
    void getAssetBlob(asset.id).then(blob => {
      if (!blob || !active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.id, lazyLoad.isVisible]);
  const { elementRef } = lazyLoad;
  return (
    <button ref={elementRef} type="button" onClick={onPreview} className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-muted">
      {asset.kind === 'video' && url ? <video src={url} className="h-full w-full object-cover" muted preload="metadata" /> : null}
      {asset.kind === 'audio' && <FileAudio className="h-10 w-10 text-primary/70" />}
      {!url && asset.kind === 'video' && <FileVideo className="h-10 w-10 text-primary/70" />}
      <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{formatDuration(asset.durationSeconds)}</span>
    </button>
  );
}

export function AssetsWorkspace({ wideMode = false, active = true }: AssetsWorkspaceProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 180);
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedKind, setSelectedKind] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'used'>(() => loadAssetSettings().sort);
  const [viewSize, setViewSize] = useState<AssetViewSize>(() => loadAssetSettings().viewSize);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewMedia, setPreviewMedia] = useState<{ asset: MediaAsset; url: string } | null>(null);
  const [editingAsset, setEditingAsset] = useState<ImageAsset | MediaAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetItem | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [packing, setPacking] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
  const [sortPopoverOpen, setSortPopoverOpen] = useState(false);
  const [metadataGenerating, setMetadataGenerating] = useState(false);
  const [metadataSuggestion, setMetadataSuggestion] = useState<AssetMetadataSuggestion | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editNote, setEditNote] = useState('');
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [textContent, setTextContent] = useState('');
  const fullObjectUrlsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagDragRef = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, dragged: false });

  const revokeFullObjectUrls = useCallback(() => {
    for (const url of fullObjectUrlsRef.current) URL.revokeObjectURL(url);
    fullObjectUrlsRef.current = [];
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const nextAssets = await listAssets();
    setAssets(nextAssets);
    setLoading(false);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  useEffect(() => {
    saveJsonToStorage(SETTINGS_KEY, { sort, viewSize });
  }, [sort, viewSize]);

  const filteredAssets = useMemo(() => {
    const filtered = assets.filter(asset => matchesAsset(asset, debouncedQuery, selectedTag, selectedSource, selectedKind));
    if (sort === 'oldest') {
      return filtered.sort((a, b) => a.createdAt - b.createdAt);
    }
    if (sort === 'used') {
      return filtered.sort((a, b) => (b.lastUsedAt || b.updatedAt || b.createdAt) - (a.lastUsedAt || a.updatedAt || a.createdAt));
    }
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, debouncedQuery, selectedKind, selectedSource, selectedTag, sort]);

  const visibleAssets = useMemo(() => filteredAssets.slice(0, visibleCount), [filteredAssets, visibleCount]);
  useEffect(() => {
    if (!active) return;
    setPreviewIndex(null);
    revokeFullObjectUrls();
    setPreviewImages([]);
  }, [active, revokeFullObjectUrls, visibleAssets]);

  useEffect(() => {
    if (!active) {
      revokeFullObjectUrls();
      setPreviewImages([]);
      setPreviewIndex(null);
    }
  }, [active, revokeFullObjectUrls]);

  useEffect(() => () => revokeFullObjectUrls(), [revokeFullObjectUrls]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedQuery, selectedKind, selectedSource, selectedTag, sort]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const allTags = useMemo(() => uniqueTags(assets), [assets]);
  const sources = useMemo<AssetSourceKind[]>(() => Array.from(new Set(assets.map(asset => asset.sourceKind))).sort(), [assets]);
  const totalBytes = useMemo(() => {
    const seen = new Set<string>();
    let total = 0;
    for (const asset of assets) {
      if (isImageAsset(asset)) {
        if (seen.has(asset.blobKey)) continue;
        seen.add(asset.blobKey);
      }
      total += asset.sizeBytes || 0;
    }
    return total;
  }, [assets]);
  const selectedCount = selectedAssetIds.size;
  const allVisibleSelected = visibleAssets.length > 0 && visibleAssets.every(asset => selectedAssetIds.has(asset.id));
  const selectedSourceLabel = selectedSource ? getSourceKindLabel(selectedSource as AssetSourceKind) : t('assets.allSources');
  const selectedKindLabel = selectedKind === 'video' ? t('assets.video') : selectedKind === 'audio' ? t('assets.audio') : selectedKind === 'image' ? t('assets.image') : selectedKind === 'text' ? t('assets.prompt') : t('assets.allTypes');
  const sortLabels = {
    newest: t('assets.sortNewest'),
    oldest: t('assets.sortOldest'),
    used: t('assets.sortUsed'),
  };
  const viewSizeLabels = {
    compact: t('assets.viewCompact'),
    normal: t('assets.viewNormal'),
    large: t('assets.viewLarge'),
  };
  const sortLabel = sortLabels[sort];

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSelectedAssetIds(prev => {
      const validIds = new Set(assets.map(asset => asset.id));
      const next = new Set(Array.from(prev).filter(id => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [assets]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openPreview = useCallback(async (assetId: string) => {
    revokeFullObjectUrls();
    const imageAssets = visibleAssets.filter(isImageAsset);
    const urls = await Promise.all(imageAssets.map(async asset => {
      const blob = await getAssetBlob(asset.id);
      if (!blob) return '';
      const url = URL.createObjectURL(blob);
      fullObjectUrlsRef.current.push(url);
      return url;
    }));
    setPreviewImages(urls);
    setPreviewIndex(Math.max(0, imageAssets.findIndex(asset => asset.id === assetId)));
  }, [revokeFullObjectUrls, visibleAssets]);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
    revokeFullObjectUrls();
    setPreviewImages([]);
  }, [revokeFullObjectUrls]);

  /** 打开视频或音频素材预览，并在关闭时释放对象 URL。 */
  const openMediaPreview = useCallback(async (asset: MediaAsset) => {
    const blob = await getAssetBlob(asset.id);
    if (!blob) return;
    if (previewMedia?.url) URL.revokeObjectURL(previewMedia.url);
    setPreviewMedia({ asset, url: URL.createObjectURL(blob) });
  }, [previewMedia]);

  useEffect(() => () => { if (previewMedia?.url) URL.revokeObjectURL(previewMedia.url); }, [previewMedia]);

  const handleImportFiles = useCallback(async (files: FileList | File[]) => {
    const media = Array.from(files).filter(file => /^(image|video|audio)\//.test(file.type));
    if (media.length === 0) {
      dispatchImageActionToast(t('assets.invalidMedia'), 'error');
      return;
    }
    setImporting(true);
    try {
      let imported = 0;
      for (const file of media) {
        if (file.type.startsWith('image/')) {
          await addImageAsset({ blob: file, name: file.name, sourceKind: 'manual', sourceLabel: t('assets.manualSource'), sourceRef: file.name });
        } else {
          await addMediaAsset({ blob: file, kind: file.type.startsWith('video/') ? 'video' : 'audio', name: file.name, sourceKind: 'manual', sourceLabel: t('assets.manualSource'), sourceRef: file.name });
        }
        imported++;
      }
      await reload();
      dispatchImageActionToast(t('assets.imported', { count: imported }), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.importFailed'), 'error');
    } finally {
      setImporting(false);
    }
  }, [reload, t]);

  const saveTextAsset = useCallback(async () => {
    try {
      await addTextAsset({
        content: textContent,
        sourceKind: 'manual',
        sourceLabel: t('assets.manualSource'),
      });
      setTextContent('');
      setTextDialogOpen(false);
      await reload();
      dispatchImageActionToast(t('assets.promptSaved'), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.promptSaveFailed'), 'error');
    }
  }, [reload, t, textContent]);

  const openEdit = useCallback((asset: ImageAsset | MediaAsset) => {
    setEditingAsset(asset);
    setEditName(asset.name);
    setEditTags(asset.tags.join(' '));
    setEditNote(asset.note);
    setMetadataSuggestion(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingAsset || metadataGenerating) return;
    try {
      await updateMediaAsset(editingAsset.id, {
        name: editName,
        tags: splitTags(editTags),
        note: editNote,
      });
      setEditingAsset(null);
      await reload();
      dispatchImageActionToast(t('assets.updated'), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.updateFailed'), 'error');
    }
  }, [editName, editNote, editTags, editingAsset, metadataGenerating, reload, t]);

  /** 下载单个视频或音频素材，并使用素材名称作为文件名。 */
  const downloadMediaAsset = useCallback(async (asset: MediaAsset): Promise<void> => {
    try {
      const blob = await getAssetBlob(asset.id);
      if (!blob) throw new Error(t('assets.readFailed'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = asset.name || `${asset.kind}-${asset.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.exportFailed'), 'error');
    }
  }, [t]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteAsset(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
      dispatchImageActionToast(t('assets.deletedSingle'), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.deleteFailed'), 'error');
    }
  }, [deleteTarget, reload, t]);

  const confirmDeleteSelected = useCallback(async () => {
    if (selectedAssetIds.size === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    try {
      const idsToDelete = new Set(selectedAssetIds);
      let deletedCount = 0;
      for (const asset of assets) {
        if (!idsToDelete.has(asset.id)) continue;
        await deleteAsset(asset.id);
        deletedCount++;
      }
      setDeleteSelectedOpen(false);
      setSelectedAssetIds(prev => {
        const next = new Set(prev);
        for (const id of idsToDelete) next.delete(id);
        return next;
      });
      await reload();
      dispatchImageActionToast(t('assets.deleted', { count: deletedCount }), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.deleteFailed'), 'error');
    } finally {
      setBulkDeleting(false);
    }
  }, [assets, bulkDeleting, reload, selectedAssetIds, t]);

  const toggleAssetSelection = useCallback((assetId: string) => {
    setSelectedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const toggleSelectVisible = useCallback(() => {
    setSelectedAssetIds(prev => {
      if (visibleAssets.length === 0) return prev;
      const next = new Set(prev);
      const shouldClear = visibleAssets.every(asset => next.has(asset.id));
      for (const asset of visibleAssets) {
        if (shouldClear) next.delete(asset.id);
        else next.add(asset.id);
      }
      return next;
    });
  }, [visibleAssets]);

  const downloadSelectedAssets = useCallback(async () => {
    if (selectedAssetIds.size === 0 || packing) return;
    setPacking(true);
    try {
      const zip = new JSZip();
      let readme = `${t('assets.title')}\n\n`;
      let count = 0;
      for (const asset of assets.filter(item => selectedAssetIds.has(item.id))) {
        if (isTextAsset(asset)) {
          zip.file(getTextEntryName(asset), asset.content);
          count++;
          continue;
        }
        const blob = await getAssetBlob(asset.id);
        if (!blob) continue;
        const fileName = getZipEntryName(asset);
        zip.file(fileName, blob);
        readme += `${fileName}\n`;
        readme += `  ${t('assets.name')}: ${asset.name}\n`;
        readme += `  ${t('assets.source', { value: '' }).replace(/：$|: $/, '')}: ${asset.sourceLabel}\n`;
        readme += `  ${t('assets.tags')}: ${asset.tags.join(', ') || t('assets.noTags')}\n`;
        readme += `  ${t('assets.note')}: ${asset.note || t('assets.noNote')}\n\n`;
        count++;
      }
      if (count === 0) throw new Error(t('assets.exportEmpty'));
      zip.file('README.txt', readme);
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `flyreq-assets-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dispatchImageActionToast(t('assets.exported', { count }), 'success');
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.exportFailed'), 'error');
    } finally {
      setPacking(false);
    }
  }, [assets, packing, selectedAssetIds, t]);

  const generateEditMetadata = useCallback(async () => {
    if (!editingAsset || metadataGenerating) return;
    let textModel;
    try {
      textModel = requireDefaultConfiguredTextModel('imageDescribe');
    } catch {
      dispatchImageActionToast(t('assets.configureDescribe'), 'error');
      return;
    }
    setMetadataGenerating(true);
    setMetadataSuggestion(null);
    try {
      const blob = await getAssetBlob(editingAsset.id);
      if (!blob) throw new Error(t('assets.readFailed'));
      if (!isImageAsset(editingAsset)) throw new Error(t('assets.metadataFailed'));
      const imageDataUrl = await prepareAssetMetadataImage(editingAsset, blob);
      const suggestion = await generateAssetMetadata({
        apiKey: textModel.apiKey,
        baseUrl: textModel.baseUrl,
        model: textModel.modelId,
        imageDataUrl,
        currentName: editName,
        currentTags: splitTags(editTags),
        currentNote: editNote,
      });
      setMetadataSuggestion(suggestion);
    } catch (error) {
      dispatchImageActionToast(error instanceof Error ? error.message : t('assets.metadataFailed'), 'error');
    } finally {
      setMetadataGenerating(false);
    }
  }, [editName, editNote, editTags, editingAsset, metadataGenerating, t]);

  const applyMetadataSuggestion = useCallback(() => {
    if (!metadataSuggestion || metadataGenerating) return;
    setEditName(metadataSuggestion.name);
    setEditTags(metadataSuggestion.tags.join(' '));
    setEditNote(metadataSuggestion.note);
    setMetadataSuggestion(null);
  }, [metadataGenerating, metadataSuggestion]);

  return (
    <section className={cn('min-w-0 space-y-4 overflow-hidden', wideMode && 'xl:flex xl:h-full xl:min-h-0 xl:flex-col')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-medium text-foreground">{t('assets.title')}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">{t('assets.count', { total: assets.length, filtered: filteredAssets.length })}</p>
            <StorageEstimate totalBytes={totalBytes} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteSelectedOpen(true)}
            disabled={selectedCount === 0 || bulkDeleting}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {selectedCount > 0 ? t('assets.deleteCount', { count: selectedCount }) : t('assets.delete')}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void downloadSelectedAssets()}
            disabled={selectedCount === 0 || packing}
            className="gap-1.5"
          >
            {packing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
            {selectedCount > 0 ? t('assets.downloadZipCount', { count: selectedCount }) : t('assets.downloadZip')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            className="hidden"
            onChange={event => {
              if (event.target.files) void handleImportFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing} className="gap-1.5">
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {t('assets.importMedia')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTextDialogOpen(true)} className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {t('assets.newPrompt')}
          </Button>
        </div>
      </div>

      <div className="min-w-0 space-y-3 overflow-hidden rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('assets.searchPlaceholder')}
              className="pl-8"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={t('assets.clearSearch')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Popover open={sourcePopoverOpen} onOpenChange={setSourcePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="justify-between gap-2">
                {t('assets.source', { value: selectedSourceLabel })}
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-2">
              <div className="space-y-1">
                {[{ value: '', label: t('assets.allSources') }, ...sources.map(source => ({ value: source, label: getSourceKindLabel(source) }))].map(option => (
                  <button
                    key={option.value || 'all'}
                    type="button"
                    onClick={() => {
                      setSelectedSource(option.value);
                      setSourcePopoverOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      selectedSource === option.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    )}
                  >
                    {option.label}
                    {selectedSource === option.value && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="justify-between gap-2">{t('assets.type', { value: selectedKindLabel })}<ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-36 p-2">
              {['', 'image', 'video', 'audio', 'text'].map(kind => (
                <button key={kind || 'all'} type="button" onClick={() => setSelectedKind(kind)} className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm', selectedKind === kind ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                  {kind === '' ? t('assets.allTypes') : kind === 'image' ? t('assets.image') : kind === 'video' ? t('assets.video') : kind === 'audio' ? t('assets.audio') : t('assets.prompt')}
                  {selectedKind === kind && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover open={sortPopoverOpen} onOpenChange={setSortPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="justify-between gap-2">
                {t('assets.sort', { value: sortLabel })}
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-2">
              <div className="space-y-1">
                {SORT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSort(option.value);
                      setSortPopoverOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      sort === option.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    )}
                  >
                    {sortLabels[option.value]}
                    {sort === option.value && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex h-7 items-center rounded-lg border border-border bg-background p-0.5">
            {VIEW_SIZE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setViewSize(option.value)}
                className={cn(
                  'flex h-6 min-w-7 items-center justify-center rounded-md px-2 text-xs transition-colors',
                  viewSize === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                title={t('assets.displayArea', { value: viewSizeLabels[option.value] })}
              >
                <Grid3X3 className="mr-1 h-3 w-3" />
                {viewSizeLabels[option.value]}
              </button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div
            className="flex gap-1.5 overflow-x-auto touch-pan-x select-none overscroll-x-contain [&::-webkit-scrollbar]:hidden"
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
              {t('assets.allTags')}
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
      </div>

      {visibleAssets.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={toggleSelectVisible} className="gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {allVisibleSelected ? t('assets.clearPageSelection') : t('assets.selectPage')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('assets.selectedCount', { count: selectedCount })}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-60 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : visibleAssets.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8 opacity-60" />
          <p className="text-sm">{assets.length === 0 ? t('assets.empty') : t('assets.noMatch')}</p>
          <p className="text-xs">{t('assets.emptyHint')}</p>
        </div>
      ) : (
        <div className={cn(
          'grid items-start gap-3',
          viewSize === 'compact' && 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6',
          viewSize === 'normal' && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
          viewSize === 'large' && 'grid-cols-2 sm:grid-cols-1 lg:grid-cols-2',
          wideMode && viewSize === 'compact' && 'xl:min-h-0 xl:flex-1 xl:auto-rows-max xl:items-start xl:overflow-y-auto xl:pr-1 2xl:grid-cols-8',
          wideMode && viewSize === 'normal' && 'xl:min-h-0 xl:flex-1 xl:auto-rows-max xl:items-start xl:overflow-y-auto xl:pr-1 2xl:grid-cols-5',
          wideMode && viewSize === 'large' && 'xl:min-h-0 xl:flex-1 xl:auto-rows-max xl:items-start xl:overflow-y-auto xl:pr-1 2xl:grid-cols-3'
        )}>
          {visibleAssets.map((asset) => {
            const selected = selectedAssetIds.has(asset.id);
            if (isTextAsset(asset)) {
              return (
                <div
                  key={asset.id}
                  className={cn(
                    'relative flex min-h-36 flex-col overflow-hidden rounded-lg border bg-card p-3 transition-colors hover:border-muted-foreground/40',
                    selected ? 'border-primary ring-1 ring-primary/30' : 'border-border'
                  )}
                >
                  <label className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white shadow-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAssetSelection(asset.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-primary"
                      title={t('assets.selectAsset')}
                    />
                  </label>
                  <p className={cn(
                    'min-h-0 whitespace-pre-wrap leading-relaxed text-foreground',
                    viewSize === 'compact' ? 'line-clamp-5 pl-6 text-xs' : 'line-clamp-8 pl-7 text-sm'
                  )}>
                    {asset.content}
                  </p>
                  <div className="mt-auto flex justify-end gap-1 pt-2">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        void navigator.clipboard?.writeText(asset.content);
                        dispatchImageActionToast(t('assets.promptCopied'), 'success');
                      }}
                      title={t('assets.copyPrompt')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleteTarget(asset)} title={t('assets.deleteAsset')} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              );
            }
            if (isMediaAsset(asset)) {
              return (
                <div key={asset.id} className={cn('relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-muted-foreground/40', selected ? 'border-primary ring-1 ring-primary/30' : 'border-border')}>
                  <label className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white shadow-sm">
                    <input type="checkbox" checked={selected} onChange={() => toggleAssetSelection(asset.id)} className="h-3.5 w-3.5 cursor-pointer accent-primary" title={t('assets.selectAsset')} />
                  </label>
                  <MediaThumbnail asset={asset} onPreview={() => void openMediaPreview(asset)} />
                  <div className="flex min-h-24 flex-col p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground" title={asset.name}>{asset.name}</p><p className="truncate text-[11px] text-muted-foreground">{asset.sourceLabel} · {formatAssetSize(asset.sizeBytes)}</p></div>
                      <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon-xs" onClick={() => openEdit(asset)} title={t('assets.edit')}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon-xs" onClick={() => void downloadMediaAsset(asset)} title={t('assets.download')}><Download className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon-xs" onClick={() => setDeleteTarget(asset)} title={t('assets.deleteAsset')} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button></div>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-muted-foreground"><span>{asset.kind === 'video' ? t('assets.video') : t('assets.audio')}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}</span><span>{formatDuration(asset.durationSeconds)}</span></div>
                  </div>
                </div>
              );
            }
            const payload = makePayload(asset);
            return (
              <div
                key={asset.id}
                className={cn(
                  'relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-muted-foreground/40',
                  viewSize === 'large' && 'sm:flex sm:min-h-44',
                  selected ? 'border-primary ring-1 ring-primary/30' : 'border-border'
                )}
              >
                <label className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white shadow-sm">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleAssetSelection(asset.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    title={t('assets.selectAsset')}
                  />
                </label>
                <div className={cn(viewSize === 'large' && 'sm:w-40 sm:shrink-0 2xl:w-44')}>
                  <AssetThumbnail asset={asset} viewSize={viewSize} onPreview={() => void openPreview(asset.id)} />
                </div>
                <div className={cn(
                  'flex flex-col p-2',
                  viewSize === 'compact' && 'p-1.5',
                  viewSize === 'normal' && 'min-h-24',
                  viewSize === 'large' && 'min-h-20 sm:min-h-44 sm:min-w-0 sm:flex-1'
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn('min-w-0', viewSize === 'large' && 'flex-1')}>
                      <p className={cn('truncate font-medium text-foreground', viewSize === 'compact' ? 'text-xs' : 'text-sm')} title={asset.name}>{asset.name}</p>
                      {viewSize !== 'compact' && (
                        <p className="truncate text-[11px] text-muted-foreground">{asset.sourceLabel} · {formatAssetSize(asset.sizeBytes)}</p>
                      )}
                    </div>
                    <button type="button" onClick={() => openEdit(asset)} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('assets.edit')}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {viewSize === 'normal' && (
                    <div className="mt-2 flex h-4 flex-wrap gap-1 overflow-hidden">
                      {asset.tags.slice(0, 3).map(tag => <Badge key={tag} variant="outline" className="h-4 px-1.5 text-[10px]">{tag}</Badge>)}
                    </div>
                  )}
                  {viewSize === 'large' && (
                    <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-hidden">
                      <div className="flex min-h-5 flex-wrap gap-1 overflow-hidden">
                        {asset.tags.length > 0
                          ? asset.tags.slice(0, 6).map(tag => <Badge key={tag} variant="outline" className="h-5 px-1.5 text-[10px]">{tag}</Badge>)
                          : <span className="text-[11px] text-muted-foreground">{t('assets.noTags')}</span>}
                      </div>
                      <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                        {asset.note || asset.prompt || t('assets.noNote')}
                      </p>
                    </div>
                  )}
                  <div className={cn(
                    'flex justify-end gap-1',
                    viewSize === 'compact' ? 'pt-1' : 'mt-auto pt-2'
                  )}>
                    <Button variant="ghost" size="icon-xs" onClick={() => void runImageAction('copy', payload)} title={t('assets.copyImage')}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => void runImageAction('download', payload)} title={t('assets.download')}><Download className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => void runImageAction('use-as-reference', payload)} title={t('assets.useReference')}><Wand2 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleteTarget(asset)} title={t('assets.deleteAsset')} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {visibleCount < filteredAssets.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
            {t('assets.loadMore')}
          </Button>
        </div>
      )}

      {previewIndex !== null && previewImages[previewIndex] && createPortal(
        <HistoryImagePreview
          images={previewImages}
          alt={t('assets.imageAlt')}
          initialIndex={previewIndex}
          onClose={closePreview}
          actionPayloads={visibleAssets.filter(isImageAsset).map(makePayload)}
          showAddToAssets={false}
        />,
        document.body,
      )}

      <Dialog
        open={!!editingAsset}
        onOpenChange={open => {
          if (!open && !metadataGenerating) {
            setEditingAsset(null);
            setMetadataSuggestion(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus className="h-4 w-4" />
              {t('assets.editTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('assets.name')}</label>
              <Input value={editName} onChange={event => setEditName(event.target.value)} disabled={metadataGenerating} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('assets.tags')}</label>
              <Input value={editTags} onChange={event => setEditTags(event.target.value)} placeholder={t('assets.tagsPlaceholder')} disabled={metadataGenerating} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('assets.note')}</label>
              <Textarea value={editNote} onChange={event => setEditNote(event.target.value)} rows={4} disabled={metadataGenerating} />
            </div>
            {editingAsset && (
              <p className="text-xs text-muted-foreground">
                {t('assets.sourceInfo', { source: editingAsset.sourceLabel, details: `${editingAsset.width && editingAsset.height ? `${editingAsset.width}×${editingAsset.height} · ` : ''}${formatAssetSize(editingAsset.sizeBytes)}` })}
              </p>
            )}
            {editingAsset && isImageAsset(editingAsset) && <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">{t('assets.aiMetadata')}</p>
                  <p className="text-[11px] text-muted-foreground">{t('assets.aiMetadataHint')}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void generateEditMetadata()}
                  disabled={metadataGenerating}
                >
                  {metadataGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {metadataGenerating ? t('assets.generating') : t('assets.generateSuggestion')}
                </Button>
              </div>
              {metadataSuggestion && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">{t('assets.suggestedTitle')}</p>
                    <p className="rounded-md bg-background px-2 py-1 text-sm">{metadataSuggestion.name}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">{t('assets.suggestedTags')}</p>
                    <div className="flex flex-wrap gap-1 rounded-md bg-background p-2">
                      {metadataSuggestion.tags.map(tag => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">{t('assets.suggestedNote')}</p>
                    <p className="whitespace-pre-wrap rounded-md bg-background px-2 py-1 text-sm leading-relaxed">{metadataSuggestion.note}</p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setMetadataSuggestion(null)} disabled={metadataGenerating}>{t('assets.discardSuggestion')}</Button>
                    <Button size="sm" onClick={applyMetadataSuggestion} disabled={metadataGenerating}>{t('assets.applySuggestion')}</Button>
                  </div>
                </div>
              )}
            </div>}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingAsset(null);
                  setMetadataSuggestion(null);
                }}
                disabled={metadataGenerating}
              >
                {t('assets.cancel')}
              </Button>
              <Button onClick={() => void saveEdit()} disabled={metadataGenerating}>
                {t('assets.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={textDialogOpen} onOpenChange={setTextDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t('assets.newPromptTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={textContent}
              onChange={event => setTextContent(event.target.value)}
              rows={8}
              placeholder={t('assets.promptPlaceholder')}
            />
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="outline"
                onClick={() => {
                  setTextDialogOpen(false);
                  setTextContent('');
                }}
              >
                {t('assets.cancel')}
              </Button>
              <Button onClick={() => void saveTextAsset()} disabled={!textContent.trim()}>
                {t('assets.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewMedia)} onOpenChange={open => { if (!open) { if (previewMedia?.url) URL.revokeObjectURL(previewMedia.url); setPreviewMedia(null); } }}>
        <DialogContent className="max-w-3xl overflow-hidden p-2 sm:p-4">
          <DialogHeader className="px-2 pt-2"><DialogTitle className="truncate text-sm">{previewMedia?.asset.name}</DialogTitle></DialogHeader>
          {previewMedia?.asset.kind === 'video' ? <video src={previewMedia.url} controls autoPlay className="max-h-[70vh] w-full bg-black object-contain" /> : previewMedia ? <audio src={previewMedia.url} controls autoPlay className="w-full" /> : null}
        </DialogContent>
      </Dialog>

      {deleteTarget && createPortal(
        <ConfirmDialog
          title={t('assets.deleteConfirmTitle')}
          message={t('assets.deleteConfirm', { name: isTextAsset(deleteTarget) ? deleteTarget.content.slice(0, 30) || t('assets.newPromptTitle') : deleteTarget.name })}
          confirmText={t('assets.delete')}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />,
        document.body,
      )}

      {deleteSelectedOpen && createPortal(
        <ConfirmDialog
          title={t('assets.deleteSelectedTitle')}
          message={t('assets.deleteSelectedConfirm', { count: selectedCount })}
          confirmText={t('assets.delete')}
          onConfirm={() => void confirmDeleteSelected()}
          onCancel={() => setDeleteSelectedOpen(false)}
        />,
        document.body,
      )}
    </section>
  );
}
