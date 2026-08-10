import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVideoBlob } from '@/lib/video-job-store';

/**
 * 构造视频下载测试使用的最小响应对象。
 * @param body 响应视频字节。
 * @param contentLength 响应声明的完整字节数。
 * @returns 可供视频缓存函数读取的响应对象。
 */
function createVideoResponse(body: string, contentLength: number): Response {
  const blob = new Blob([body], { type: 'video/mp4' });
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      'content-length': String(contentLength),
      'content-type': 'video/mp4',
    }),
    blob: async () => blob,
  } as Response;
}

describe('视频结果缓存', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('完整响应通过字节校验并禁用 HTTP 缓存', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createVideoResponse('video', 5));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await fetchVideoBlob('/api/flyreq/videos/task-one');

    expect(blob.size).toBe(5);
    expect(fetchMock).toHaveBeenCalledWith('/api/flyreq/videos/task-one', { cache: 'no-store', signal: undefined });
  });

  it('响应字节不足时重试三次且拒绝返回半文件', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(createVideoResponse('bad', 8));
    vi.stubGlobal('fetch', fetchMock);

    const result = expect(fetchVideoBlob('/api/flyreq/videos/task-two')).rejects.toThrow('视频响应不完整');
    await vi.runAllTimersAsync();

    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('请求开始前已取消时不发起任何视频下载', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(fetchVideoBlob('/api/flyreq/videos/task-three', controller.signal)).rejects.toThrow('视频下载已取消');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
