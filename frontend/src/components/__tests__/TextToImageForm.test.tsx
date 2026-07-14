import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { TextToImageForm } from '../TextToImageForm'
import { LanguageProvider } from '../LanguageProvider'

vi.mock('@/lib/image-actions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/image-actions')>()
  return {
    ...actual,
    dispatchImageActionToast: vi.fn(),
  }
})

import { dispatchImageActionToast } from '@/lib/image-actions'

const TEST_REGISTRY = {
  imageModels: [{
    id: 'flyreq-gpt-image-2',
    protocol: 'openai',
    name: 'FlyReq',
    modelId: 'gpt-image-2',
    apiKey: 'test-api-key',
    baseUrl: 'https://api.openai.com',
    builtinPreset: 'gpt-image-2',
    maxRefImages: 16,
    maxOutputSize: '4K',
    supportsAdvancedParams: true,
  }],
  textModels: [],
  defaults: { textToImage: 'flyreq-gpt-image-2', imageToImage: 'flyreq-gpt-image-2' },
}

/**
 * 渲染文生图表单并等待异步设置恢复完成。
 * @param props 传递给文生图表单的组件属性。
 * @returns 已完成初始化的渲染结果，可用于安全执行交互断言。
 */
async function renderForm(props: React.ComponentProps<typeof TextToImageForm>) {
  let rendered: ReturnType<typeof render> | undefined
  await act(async () => {
    rendered = render(
      <LanguageProvider initialLocale="zh">
        <TextToImageForm {...props} />
      </LanguageProvider>
    )
    await new Promise<void>(resolve => queueMicrotask(resolve))
  })
  return rendered!
}

describe('TextToImageForm', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('flyreq-model-registry', JSON.stringify(TEST_REGISTRY))
    vi.mocked(dispatchImageActionToast).mockClear()
  })

  it('renders the form with placeholder text', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })

    expect(screen.getByPlaceholderText('描述你想要生成的图像...')).toBeInTheDocument()
    expect(screen.getByText('发送：Enter · 换行：Shift + Enter')).toBeInTheDocument()
  })

  it('submit button is disabled when prompt is empty', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })

    const submitButton = screen.getByRole('button', { name: '' }) // Arrow icon button
    expect(submitButton).toBeDisabled()
  })

  it('submit button is enabled when prompt has text', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })

    const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
    fireEvent.change(textarea, { target: { value: 'A beautiful sunset' } })

    const submitButton = screen.getByRole('button', { name: '' })
    expect(submitButton).not.toBeDisabled()
  })

  it('calls onSubmit with prompt when Enter is pressed by default', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })

    const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
    fireEvent.change(textarea, { target: { value: 'A beautiful sunset' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompts: ['A beautiful sunset'],
      outputSize: 'auto',
      aspectRatio: 'auto',
      temperature: 1,
      model: 'flyreq-gpt-image-2',
      gptImageQuality: 'auto',
      gptImageStyle: 'auto',
      gptImageBackground: 'auto',
      gptImageOutputFormat: 'png',
      parallelCount: 1,
    }))
  })

  it('keeps the prompt and shows a message when no image model is selected', async () => {
    const onSubmit = vi.fn()
    localStorage.removeItem('flyreq-model-registry')
    localStorage.setItem('flyreq-t2i-settings', JSON.stringify({ model: '' }))
    await renderForm({ onSubmit })

    const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
    fireEvent.change(textarea, { target: { value: 'A beautiful sunset' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('A beautiful sunset')
    expect(dispatchImageActionToast).toHaveBeenCalledWith(
      '请先选择图片模型，或在设置中配置可用的图片模型。',
      'error',
    )
  })

  it('shows image params control for GPT Image 2 model', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit, initialData: { model: 'flyreq-gpt-image-2' } })

    expect(await screen.findByTitle('图像参数')).toBeInTheDocument()
  })

  it('submits default image params for GPT Image 2 model when left on auto', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit, initialData: { model: 'flyreq-gpt-image-2', prompt: 'Cut out the subject' } })

    const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
    await screen.findByTitle('图像参数')
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      model: 'flyreq-gpt-image-2',
      gptImageQuality: 'auto',
      gptImageStyle: 'auto',
      gptImageBackground: 'auto',
      gptImageOutputFormat: 'png',
    }))
  })

  it('does NOT submit when Shift+Enter is pressed by default', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })

    const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
    fireEvent.change(textarea, { target: { value: 'A beautiful sunset' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('uses and persists the selected Shift+Enter submission shortcut', async () => {
    const onSubmit = vi.fn()
    const { unmount } = await renderForm({ onSubmit })

    fireEvent.click(screen.getByRole('button', { name: '发送快捷键' }))
    fireEvent.click(screen.getByText('Shift + Enter 发送'))

    expect(localStorage.getItem('flyreq-prompt-submission-shortcut')).toBe('shift-enter')
    expect(screen.getByText('发送：Shift + Enter · 换行：Enter')).toBeInTheDocument()
    expect(dispatchImageActionToast).toHaveBeenCalledWith('已设置：Shift + Enter 发送，Enter 换行', 'success')

    const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
    fireEvent.change(textarea, { target: { value: 'A beautiful sunset' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).toHaveBeenCalled()

    unmount()
    await renderForm({ onSubmit: vi.fn() })
    expect(screen.getByTitle('发送快捷键：Shift + Enter 发送，Enter 换行')).toBeInTheDocument()
  })

  it('requires clicking the send button on small viewports', async () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    const onSubmit = vi.fn()
    const { unmount } = await renderForm({ onSubmit })

    try {
      const textarea = screen.getByPlaceholderText('描述你想要生成的图像...')
      fireEvent.change(textarea, { target: { value: 'A beautiful sunset' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('发送：点击发送按钮 · 换行：Enter 或 Shift + Enter')).toBeInTheDocument()

      const submitButton = screen.getAllByRole('button').find(button => button.querySelector('.lucide-arrow-up'))
      fireEvent.click(submitButton!)
      expect(onSubmit).toHaveBeenCalled()
    } finally {
      unmount()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      fireEvent(window, new Event('resize'))
    }
  })

  it('shows configuration prompt when disabled prop is true', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit, disabled: true })

    expect(screen.getByText('API 密钥未配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '配置' })).toBeInTheDocument()
  })
})
