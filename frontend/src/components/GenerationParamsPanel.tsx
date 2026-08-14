'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, SlidersHorizontal, Thermometer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/components/LanguageProvider';
import { cn } from '@/lib/utils';
import { MODEL_OPTIONS, type ModelId } from '@/lib/gemini-config';
import {
  getAspectRatioOptions,
  getCustomSizeMaxSide,
  getGptImageAdvancedParamsForModel,
  getOutputSizeLabel,
  getSupportsTemperature,
  getSizeOptions,
  MAX_IMAGE_PARALLEL_COUNT,
  normalizeCustomImageSize,
  PARALLEL_COUNT_OPTIONS,
  supportsAutoLayout,
  supportsCustomSize,
  supportsGptImageAdvancedParams,
  GPT_IMAGE_BACKGROUND_OPTIONS,
  GPT_IMAGE_QUALITY_OPTIONS,
  type GptImageAdvancedParams,
  type GptImageBackground,
  type GptImageQuality,
  type ParallelCount,
} from '@/lib/model-capabilities';
import type { AspectRatio, OutputSize } from '@/lib/job-store';

export interface GenerationParamsPanelValue {
  model: ModelId;
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  parallelCount: ParallelCount;
  gptImageAdvancedParams: GptImageAdvancedParams;
  customSizeAlignMultiple: boolean;
}

interface GenerationParamsPanelProps {
  value: GenerationParamsPanelValue;
  onChange: (patch: Partial<GenerationParamsPanelValue>) => void;
  modelUnavailable?: boolean;
  children?: ReactNode;
}

/** 计算比例预览框尺寸，确保不同画幅在统一网格中保持可比较的视觉比例。 */
function getPreviewDimensions(ratio: AspectRatio): { width: number; height: number } {
  if (ratio === 'auto') return { width: 38, height: 28 };
  const [widthRatio, heightRatio] = ratio.split(':').map(Number);
  const scale = Math.min(48 / widthRatio, 36 / heightRatio);
  return { width: Math.max(6, widthRatio * scale), height: Math.max(6, heightRatio * scale) };
}

/** 将模型返回的像素尺寸拆成可编辑的宽、高文本。
 * @param size 模型返回的宽高字符串。
 * @returns 可直接绑定到输入框的宽高文本。
 */
function parseCustomSize(size?: string): { width: string; height: string } {
  const match = String(size || '').match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/);
  return { width: match?.[1] || '1024', height: match?.[2] || '1024' };
}

/** 根据当前模型、清晰度和画幅获得面板中应展示的推荐分辨率。
 * @param options 当前清晰度下的画幅选项。
 * @param ratio 当前选中的画幅。
 * @returns 模型支持的像素尺寸；没有映射时返回空字符串。
 */
function getRecommendedResolution(options: { value: AspectRatio; resolution: string }[], ratio: AspectRatio): string {
  return options.find(option => option.value === ratio)?.resolution || '';
}

/** 渲染生图工作台的展开式生成参数面板。
 * @param props 当前参数、变更回调和模型可用状态。
 * @returns 响应式生成参数面板。
 */
export function GenerationParamsPanel({ value, onChange, modelUnavailable = false, children }: GenerationParamsPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 767px)').matches);
  const model = value.model;
  const sizeOptions = getSizeOptions(model);
  const aspectOptions = getAspectRatioOptions(model, value.outputSize);
  const autoLocked = supportsAutoLayout(model) && value.outputSize === 'auto';
  const supportsAdvanced = supportsGptImageAdvancedParams(model);
  const supportsTemperature = getSupportsTemperature(model);
  const customSizeMaxSide = getCustomSizeMaxSide(model) || 3840;
  const alignCustomSize = value.customSizeAlignMultiple;
  const [parallelMenuOpen, setParallelMenuOpen] = useState(false);
  const recommendedResolution = getRecommendedResolution(aspectOptions, value.aspectRatio);
  const [customWidth, setCustomWidth] = useState(() => parseCustomSize(value.customSize || recommendedResolution).width);
  const [customHeight, setCustomHeight] = useState(() => parseCustomSize(value.customSize || recommendedResolution).height);

  /** 判断当前尺寸按钮是否对应当前画幅下的预设分辨率。
   * @param option 待判断的清晰度选项。
   * @returns 当前选项处于选中状态时返回 true，否则返回 false。
   */
  const isPresetResolutionSelected = (option: { value: OutputSize }): boolean => {
    if (value.outputSize !== option.value) return false;
    if (!value.customSize) return true;

    const optionResolution = getRecommendedResolution(
      getAspectRatioOptions(model, option.value),
      value.aspectRatio,
    );
    return Boolean(optionResolution && value.customSize === optionResolution);
  };

  useEffect(() => {
    const next = parseCustomSize(value.customSize || recommendedResolution);
    queueMicrotask(() => {
      setCustomWidth(next.width);
      setCustomHeight(next.height);
    });
  }, [recommendedResolution, value.customSize]);

  /** 根据输入框的宽高更新可提交的自定义分辨率。
   * @param width 宽度文本。
   * @param height 高度文本。
   * @returns 无返回值，输入完整且合法时同步更新 customSize。
   */
  const updateCustomSize = (width: string, height: string) => {
    setCustomWidth(width);
    setCustomHeight(height);
    const widthValue = Number(width);
    const heightValue = Number(height);
    if (!Number.isInteger(widthValue) || !Number.isInteger(heightValue) || widthValue <= 0 || heightValue <= 0) return;
    const normalized = normalizeCustomImageSize(`${widthValue}x${heightValue}`, customSizeMaxSide, alignCustomSize);
    if (normalized) onChange({ customSize: normalized });
  };

  /** 将当前自定义分辨率规整到 16 的倍数并写回表单。
   * @param checked 是否开启 16 倍数对齐。
   * @returns 无返回值。
   */
  const handleAlignCustomSizeChange = (checked: boolean) => {
    if (!checked) {
      onChange({ customSizeAlignMultiple: false });
      return;
    }
    const normalized = normalizeCustomImageSize(`${customWidth}x${customHeight}`, customSizeMaxSide);
    if (!normalized) return;
    const next = parseCustomSize(normalized);
    setCustomWidth(next.width);
    setCustomHeight(next.height);
    onChange({ customSize: normalized, customSizeAlignMultiple: checked });
  };

  /** 切换图片模型并同步校正该模型支持的尺寸、画幅和高级参数。
   * @param nextModel 用户选择的目标模型。
   * @returns 无返回值，通过 onChange 提交规范化后的参数补丁。
   */
  const handleModelChange = (nextModel: ModelId) => {
    const nextAdvanced = getGptImageAdvancedParamsForModel(nextModel, value.gptImageAdvancedParams);
    const nextSizes = getSizeOptions(nextModel).filter(option => !option.disabled);
    const nextOutputSize: OutputSize = value.outputSize === 'auto' && supportsAutoLayout(nextModel)
      ? 'auto'
      : (nextSizes.find(option => option.value === value.outputSize)?.value || nextSizes[0]?.value || '1K');
    const nextAspectOptions = getAspectRatioOptions(nextModel, nextOutputSize);
    const nextAspectRatio = nextAspectOptions.some(option => option.value === value.aspectRatio)
      ? value.aspectRatio
      : (nextAspectOptions[0]?.value || '1:1');
    const nextResolution = getRecommendedResolution(nextAspectOptions, nextAspectRatio);
    onChange({
      model: nextModel,
      outputSize: nextOutputSize,
      customSize: supportsCustomSize(nextModel)
        ? (normalizeCustomImageSize(value.customSize || nextResolution, getCustomSizeMaxSide(nextModel), alignCustomSize) || undefined)
        : undefined,
      aspectRatio: nextAspectRatio,
      gptImageAdvancedParams: nextAdvanced,
    });
  };

  /** 切换输出尺寸并在当前画幅不可用时回退到该尺寸的首个可用画幅。
   * @param nextSize 用户选择的输出尺寸。
   * @returns 无返回值，通过 onChange 更新尺寸和画幅。
   */
  const handleSizeChange = (nextSize: OutputSize) => {
    if (sizeOptions.find(option => option.value === nextSize)?.disabled) return;
    const nextAspectOptions = getAspectRatioOptions(model, nextSize);
    const nextAspectRatio = nextAspectOptions.some(option => option.value === value.aspectRatio)
      ? value.aspectRatio
      : (nextAspectOptions[0]?.value || '1:1');
    const nextResolution = getRecommendedResolution(nextAspectOptions, nextAspectRatio);
    onChange({
      outputSize: nextSize,
      customSize: supportsCustomSize(model) ? (normalizeCustomImageSize(nextResolution, customSizeMaxSide) || undefined) : undefined,
      aspectRatio: nextAspectRatio,
    });
  };

  /** 更新 GPT 图片模型的背景模式。
   * @param background 用户选择的背景模式。
   * @returns 无返回值，通过 onChange 合并高级参数。
   */
  const updateBackground = (background: GptImageBackground) => onChange({ gptImageAdvancedParams: { ...value.gptImageAdvancedParams, background } });

  /** 更新 GPT 图片模型的质量档位。
   * @param quality 用户选择的质量档位。
   * @returns 无返回值，通过 onChange 合并高级参数。
   */
  const updateQuality = (quality: GptImageQuality) => onChange({ gptImageAdvancedParams: { ...value.gptImageAdvancedParams, quality } });

  /** 处理数量菜单选择，并将字符串菜单值转换为合法整数。
   * @param nextCount 菜单返回的数量值。
   * @returns 无返回值，通过 onChange 更新生成数量。
   */
  const handleParallelMenuChange = (nextCount: string) => {
    const count = Number(nextCount);
    if (!Number.isInteger(count)) return;
    setParallelMenuOpen(false);
    onChange({ parallelCount: Math.max(1, Math.min(MAX_IMAGE_PARALLEL_COUNT, count)) });
  };

  return (
    <section className="rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(current => !current)} aria-expanded={expanded}>
        <span className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4 text-primary" />{t('workbench.generationParams')}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform md:hidden', expanded && 'rotate-180')} />
      </button>

      <div className={cn('mt-4 space-y-4', !expanded && 'hidden md:block')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('workbench.model')}</label>
            {modelUnavailable ? (
              <button type="button" disabled title={t('common.notConfigured')} className="h-8 w-full rounded-lg border border-input px-2.5 text-left text-sm text-muted-foreground">{t('common.notConfigured')}</button>
            ) : (
              <Select<ModelId> value={model} onValueChange={handleModelChange} size="sm" options={MODEL_OPTIONS.map(option => ({ value: option.value, label: option.label }))} placeholder={t('common.notConfigured')} />
            )}
          </div>
          {supportsAdvanced && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('workbench.quality')}</label>
              <div className="grid grid-cols-4 gap-1.5">
                {GPT_IMAGE_QUALITY_OPTIONS.map(option => (
                  <button key={option.value} type="button" onClick={() => updateQuality(option.value)} className={cn('h-8 rounded-md border border-border text-xs transition-colors hover:bg-muted', value.gptImageAdvancedParams.quality === option.value && 'border-primary bg-primary/10 font-medium text-primary')}>
                    {t(`workbench.quality.${option.value}` as 'workbench.quality.auto')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {sizeOptions.length > 1 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">{t('workbench.resolution')}</label><span className="text-xs text-muted-foreground">{value.customSize || recommendedResolution || getOutputSizeLabel(value.outputSize)}</span></div>
            <div className="flex flex-wrap gap-1.5">
              {sizeOptions.map(option => <button key={option.value} type="button" disabled={option.disabled || autoLocked} onClick={() => handleSizeChange(option.value)} className={cn('h-8 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50', isPresetResolutionSelected(option) && 'border-primary bg-primary/10 font-medium text-primary')}>{option.label}</button>)}
              {supportsAutoLayout(model) && <button type="button" onClick={() => onChange(autoLocked ? { outputSize: '1K', aspectRatio: '1:1' } : { outputSize: 'auto', aspectRatio: 'auto', customSize: undefined })} className={cn('h-8 rounded-md border border-border px-3 text-xs', autoLocked && 'border-primary bg-primary/10 text-primary')}>{t('workbench.autoSize')}</button>}
            </div>
          </div>
        )}

        {supportsCustomSize(model) && !autoLocked && (
          <div className="space-y-2 rounded-lg border border-border/70 bg-background/40 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">{t('workbench.customResolution')}</label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('workbench.alignMultiple16')}</span>
                <Switch checked={alignCustomSize} onCheckedChange={handleAlignCustomSizeChange} aria-label={t('workbench.alignMultiple16')} />
              </label>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">{t('workbench.width')}</span>
                <Input type="number" min={16} max={customSizeMaxSide} step={alignCustomSize ? 16 : 1} value={customWidth} onChange={event => updateCustomSize(event.target.value, customHeight)} />
              </label>
              <span className="pb-2 text-sm text-muted-foreground">×</span>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">{t('workbench.height')}</span>
                <Input type="number" min={16} max={customSizeMaxSide} step={alignCustomSize ? 16 : 1} value={customHeight} onChange={event => updateCustomSize(customWidth, event.target.value)} />
              </label>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t('workbench.customResolutionHint', { max: customSizeMaxSide })}</p>
          </div>
        )}

        <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">{t('workbench.aspectRatio')}</label><div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {aspectOptions.map(option => <button key={option.value} type="button" aria-label={option.value} disabled={autoLocked} onClick={() => onChange({ aspectRatio: option.value, customSize: supportsCustomSize(model) ? (normalizeCustomImageSize(option.resolution, customSizeMaxSide) || undefined) : undefined })} className={cn('relative flex h-24 flex-col items-center justify-between rounded-md border border-border px-2.5 py-3 text-xs transition-colors hover:bg-muted disabled:opacity-50', value.aspectRatio === option.value && 'border-primary bg-primary/10 font-medium text-primary')}>
            {value.aspectRatio === option.value && <Check className="absolute right-1.5 top-1.5 size-3" />}
            <span className="flex min-h-0 flex-1 items-center justify-center">
              <span data-testid={`aspect-ratio-preview-${option.value.replace(/[^0-9a-z]+/gi, '-')}`} className="block shrink-0 rounded-[2px] border-2 border-current" style={getPreviewDimensions(option.value)} />
            </span>
            <span className="shrink-0 text-[10px] leading-4 text-muted-foreground">{option.value}</span>
          </button>)}
        </div></div>

        {supportsAdvanced && <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">{t('workbench.background')}</label><div className="grid grid-cols-3 gap-1.5">{GPT_IMAGE_BACKGROUND_OPTIONS.map(option => <button key={option.value} type="button" onClick={() => updateBackground(option.value)} className={cn('h-8 rounded-md border border-border text-xs', value.gptImageAdvancedParams.background === option.value && 'border-primary bg-primary/10 font-medium text-primary')}>{t(`workbench.background.${option.value}` as 'workbench.background.auto')}</button>)}</div></div>}

        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">{t('workbench.parallelCount')}</label><div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <button type="button" aria-label={t('workbench.parallelCount')} aria-expanded={parallelMenuOpen} onClick={() => setParallelMenuOpen(current => !current)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted">
              <span>x{value.parallelCount}</span><ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', parallelMenuOpen && 'rotate-180')} />
            </button>
            {parallelMenuOpen && (
              <div role="listbox" aria-label={t('workbench.parallelCount')} className="absolute left-0 top-full z-50 mt-1 grid w-56 grid-cols-4 gap-1 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md">
                {PARALLEL_COUNT_OPTIONS.map(count => <button key={count} type="button" role="option" aria-selected={value.parallelCount === count} onClick={() => handleParallelMenuChange(String(count))} className={cn('h-8 rounded-md text-xs transition-colors hover:bg-muted', value.parallelCount === count && 'bg-primary/10 font-medium text-primary')}>{count}</button>)}
              </div>
            )}
          </div>
          <Input aria-label={t('workbench.parallelCount')} type="number" min={1} max={MAX_IMAGE_PARALLEL_COUNT} step={1} value={value.parallelCount} onChange={event => onChange({ parallelCount: Math.max(1, Math.min(MAX_IMAGE_PARALLEL_COUNT, Math.round(Number(event.target.value) || 1))) })} className="h-8 w-20 text-center" />
        </div></div>{supportsTemperature && <div className="space-y-1.5"><div className="flex items-center justify-between"><label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Thermometer className="size-3" />{t('workbench.temperature')}</label><span className="text-xs text-muted-foreground">{value.temperature.toFixed(2)}</span></div><Slider value={[value.temperature]} onValueChange={values => onChange({ temperature: values[0] })} min={0} max={2} step={0.01} /></div>}</div>
        {children}
      </div>
    </section>
  );
}
