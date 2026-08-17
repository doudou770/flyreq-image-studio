'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

export const PROMPT_SUBMISSION_SHORTCUT_STORAGE_KEY = LOCAL_STORAGE_KEYS.promptSubmissionShortcut;
const PROMPT_SUBMISSION_SHORTCUT_CHANGE_EVENT = 'flyreq-prompt-submission-shortcut-changed';
const DEFAULT_PROMPT_SUBMISSION_SHORTCUT: PromptSubmissionShortcut = 'enter';
const SMALL_VIEWPORT_MAX_WIDTH = 639;
let fallbackPromptSubmissionShortcut: PromptSubmissionShortcut = DEFAULT_PROMPT_SUBMISSION_SHORTCUT;

export type PromptSubmissionShortcut = 'enter' | 'shift-enter';

/** 窄屏提示词输入区需要展示的本地化快捷键文案。 */
export interface PromptSubmissionShortcutMobileLabels {
  submission: string;
  newline: string;
}

/**
 * 获取指定发送快捷键对应的发送和换行按键文案。
 * @param shortcut 当前发送快捷键。
 * @returns 发送与换行按键的展示文案。
 */
export function getPromptSubmissionShortcutLabels(shortcut: PromptSubmissionShortcut) {
  return shortcut === 'enter'
    ? { submission: 'Enter', newline: 'Shift + Enter' }
    : { submission: 'Shift + Enter', newline: 'Enter' };
}

/**
 * 获取当前视口下实际生效的发送和换行提示文案。
 * @param shortcut 用户保存的桌面发送快捷键。
 * @param isSmallViewport 当前视口是否为窄屏。
 * @param mobileLabels 窄屏场景下随界面语言变化的提示文案。
 * @returns 当前视口实际可用的发送与换行提示文案。
 */
export function getEffectivePromptSubmissionShortcutLabels(
  shortcut: PromptSubmissionShortcut,
  isSmallViewport: boolean,
  mobileLabels: PromptSubmissionShortcutMobileLabels,
) {
  if (isSmallViewport) {
    return mobileLabels;
  }
  return getPromptSubmissionShortcutLabels(shortcut);
}

/**
 * 判断当前视口是否属于手机等窄屏场景。
 * @returns 窄屏时返回 true，否则返回 false。
 */
function getIsSmallViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= SMALL_VIEWPORT_MAX_WIDTH;
}

/**
 * 订阅浏览器窗口尺寸变化，以便即时切换窄屏输入规则。
 * @param onStoreChange 视口尺寸变化后的刷新回调。
 * @returns 解除订阅的清理函数。
 */
function subscribeToViewportSize(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

/**
 * 从浏览器存储中读取提示词发送快捷键，并在无效或缺失时使用默认值。
 * @returns 当前可用的发送快捷键，默认值为 Enter 发送。
 */
function getStoredPromptSubmissionShortcut(): PromptSubmissionShortcut {
  if (typeof window === 'undefined') return DEFAULT_PROMPT_SUBMISSION_SHORTCUT;
  try {
    fallbackPromptSubmissionShortcut = window.localStorage.getItem(PROMPT_SUBMISSION_SHORTCUT_STORAGE_KEY) === 'shift-enter'
      ? 'shift-enter'
      : DEFAULT_PROMPT_SUBMISSION_SHORTCUT;
    return fallbackPromptSubmissionShortcut;
  } catch {
    return fallbackPromptSubmissionShortcut;
  }
}

/**
 * 订阅当前页面和其他标签页对发送快捷键的修改。
 * @param onStoreChange 外部存储变化后的刷新回调。
 * @returns 解除订阅的清理函数。
 */
function subscribeToPromptSubmissionShortcut(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  /**
   * 仅响应当前快捷键对应的跨标签页存储变化。
   * @param event 浏览器派发的存储事件。
   * @returns 无返回值。
   */
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === null || event.key === PROMPT_SUBMISSION_SHORTCUT_STORAGE_KEY) {
      fallbackPromptSubmissionShortcut = event.newValue === 'shift-enter'
        ? 'shift-enter'
        : DEFAULT_PROMPT_SUBMISSION_SHORTCUT;
      onStoreChange();
    }
  };

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener(PROMPT_SUBMISSION_SHORTCUT_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener(PROMPT_SUBMISSION_SHORTCUT_CHANGE_EVENT, onStoreChange);
  };
}

/**
 * 管理图片提示词输入框的发送快捷键，并将用户选择持久化到浏览器本地存储。
 * @returns 当前快捷键及其更新函数。
 */
export function usePromptSubmissionShortcut() {
  const submissionShortcut = useSyncExternalStore(
    subscribeToPromptSubmissionShortcut,
    getStoredPromptSubmissionShortcut,
    () => DEFAULT_PROMPT_SUBMISSION_SHORTCUT,
  );
  const isSmallViewport = useSyncExternalStore(
    subscribeToViewportSize,
    getIsSmallViewport,
    // 服务端无法确认视口宽度时优先采用按钮发送，避免手机水合完成前误提交。
    () => true,
  );

  /**
   * 更新发送快捷键并立即持久化，使下次打开页面时保持相同选择。
   * @param shortcut 用户选择的发送快捷键。
   * @returns 无返回值。
   */
  const updateSubmissionShortcut = useCallback((shortcut: PromptSubmissionShortcut) => {
    if (typeof window === 'undefined') return;
    fallbackPromptSubmissionShortcut = shortcut;
    try {
      window.localStorage.setItem(PROMPT_SUBMISSION_SHORTCUT_STORAGE_KEY, shortcut);
    } catch {
      // 浏览器禁止本地存储时仍在当前会话保留用户选择，避免影响提示词输入。
      fallbackPromptSubmissionShortcut = shortcut;
    }
    window.dispatchEvent(new Event(PROMPT_SUBMISSION_SHORTCUT_CHANGE_EVENT));
  }, []);

  return { submissionShortcut, isSmallViewport, updateSubmissionShortcut };
}
