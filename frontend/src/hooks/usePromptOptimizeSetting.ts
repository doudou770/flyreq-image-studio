'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isPromptOptimizeEnabled,
  PROMPT_OPTIMIZE_SETTING_EVENT,
  setPromptOptimizeEnabled,
} from '@/lib/settings-storage';

export function usePromptOptimizeSetting() {
  const [enabled, setEnabledState] = useState(false);

  const refresh = useCallback(() => {
    setEnabledState(isPromptOptimizeEnabled());
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) refresh();
    });
    window.addEventListener(PROMPT_OPTIMIZE_SETTING_EVENT, refresh);
    window.addEventListener('flyreq-model-registry-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(PROMPT_OPTIMIZE_SETTING_EVENT, refresh);
      window.removeEventListener('flyreq-model-registry-updated', refresh);
    };
  }, [refresh]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    const applied = setPromptOptimizeEnabled(nextEnabled);
    refresh();
    return applied;
  }, [refresh]);

  return { enabled, setEnabled, refresh };
}
