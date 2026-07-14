import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/workspace/dialogs/ConfirmDialog';
import type { PromptGalleryMode } from '@/hooks/usePromptGalleryConfig';
import { translate, type Locale } from '@/lib/i18n';

export function usePromptGalleryAccess(
  mode: PromptGalleryMode,
  passwordEnabled: boolean,
  onError: (message: string) => void,
  onUnlocked?: () => void,
  locale: Locale = 'en',
) {
  const [showPromptGallery, setShowPromptGallery] = useState(mode === '1');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [, setClickCount] = useState(0);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (mode === '2') return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setShowPromptGallery(mode === '1');
    });
    return () => { cancelled = true; };
  }, [mode]);

  const handlePromptGalleryEntry = useCallback(() => {
    if (mode === '3') return;
    if (mode === '1' || (mode === '2' && !passwordEnabled)) {
      setShowPromptGallery(true);
      onUnlocked?.();
      return;
    }
    if (showPromptGallery) return;

    setClickCount((prev) => {
      const next = prev + 1;
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (next >= 7) {
        setPasswordDialogOpen(true);
        return 0;
      }
      clickTimerRef.current = setTimeout(() => {
        setClickCount(0);
      }, 2000);
      return next;
    });
  }, [mode, onUnlocked, passwordEnabled, showPromptGallery]);

  const handlePasswordSubmit = useCallback(async () => {
    try {
      const response = await fetch('/api/flyreq/prompt-gallery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await response.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setShowPromptGallery(true);
        setPasswordDialogOpen(false);
        setPasswordInput('');
        onUnlocked?.();
      } else {
        onError(translate(locale, 'promptGallery.passwordWrong'));
        setPasswordInput('');
      }
    } catch {
      onError(translate(locale, 'promptGallery.passwordFailed'));
    }
  }, [locale, onError, onUnlocked, passwordInput]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  return {
    showPromptGallery,
    passwordDialogOpen,
    passwordInput,
    setPasswordDialogOpen,
    setPasswordInput,
    handlePromptGalleryEntry,
    handlePasswordSubmit,
  };
}

export function PromptGalleryAccessDialog({
  open,
  passwordInput,
  onPasswordChange,
  onClose,
  onSubmit,
  locale = 'en',
}: {
  open: boolean;
  passwordInput: string;
  onPasswordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  locale?: Locale;
}) {
  if (!open) return null;

  return (
    <ConfirmDialog
      title={translate(locale, 'promptGallery.verifyTitle')}
      message={(
        <div className="space-y-3">
          <p>{translate(locale, 'promptGallery.verifyMessage')}</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => onPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit();
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none"
            autoFocus
          />
        </div>
      )}
      confirmText={translate(locale, 'promptGallery.verifyAction')}
      variant="default"
      onConfirm={onSubmit}
      onCancel={onClose}
    />
  );
}
