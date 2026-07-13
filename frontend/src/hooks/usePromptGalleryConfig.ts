'use client';

import { useEffect, useState } from 'react';
import { applyBuiltinImagePresetModelIds, type BuiltinImagePresetModelIds } from '@/lib/flyreq-models';

// 1 = 常驻（直接显示） 2 = 私密（需密码） 3 = 关闭（完全隐藏）
export type PromptGalleryMode = '1' | '2' | '3';

export function usePromptGalleryConfig() {
  const [mode, setMode] = useState<PromptGalleryMode>('2'); // 默认私密
  const [passwordEnabled, setPasswordEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/flyreq/config', { cache: 'no-store' })
      .then(res => res.json())
      .then((data: { promptGalleryMode?: string; promptGalleryPasswordEnabled?: boolean; imagePresetModelIds?: BuiltinImagePresetModelIds }) => {
        if (cancelled) return;
        applyBuiltinImagePresetModelIds(data.imagePresetModelIds);
        const raw = data.promptGalleryMode;
        setMode(raw === '1' || raw === '3' ? raw : '2');
        setPasswordEnabled(Boolean(data.promptGalleryPasswordEnabled));
      })
      .catch(() => {
        // 网络失败时保持默认值 '2'
      });

    return () => { cancelled = true; };
  }, []);

  return { mode, passwordEnabled };
}
