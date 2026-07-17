import { useEffect, useState } from 'react';

export const IMAGE_MODEL_DEFAULT_UPDATED_EVENT = 'flyreq-image-model-default-updated';

/**
 * 通知已挂载的生图表单重新读取首次保存的图片模型默认值。
 * @returns 无返回值。
 */
export function notifyImageModelDefaultUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(IMAGE_MODEL_DEFAULT_UPDATED_EVENT));
}

/**
 * 订阅首次图片模型默认值更新事件，并返回用于触发表单初始化的版本号。
 * @returns 每次收到默认模型更新事件都会递增的版本号。
 */
export function useImageModelDefaultRefresh(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion(current => current + 1);
    window.addEventListener(IMAGE_MODEL_DEFAULT_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(IMAGE_MODEL_DEFAULT_UPDATED_EVENT, refresh);
  }, []);

  return version;
}
