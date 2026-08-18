import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { ImageGenerationWorkbench } from '@/components/ImageGenerationWorkbench';
import { dispatchImageActionToast } from '@/lib/image-actions';
import { getModelCatalogCache } from '@/lib/model-catalog-cache';
import { loadRegistry, saveRegistry } from '@/lib/flyreq-models';

vi.mock('@/lib/image-actions', () => ({
  dispatchImageActionToast: vi.fn(),
}));

describe('ImageGenerationWorkbench', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    localStorage.setItem('flyreq-locale', 'en');
    vi.mocked(dispatchImageActionToast).mockClear();
  });

  it('keeps the complete editor visible and guides configuration when the image model is unavailable', async () => {
    const onConfigureApiKey = vi.fn();
    render(
      <LanguageProvider initialLocale="en">
        <ImageGenerationWorkbench
          disabled
          onSubmitText={vi.fn()}
          onSubmitImage={vi.fn()}
          onConfigureApiKey={onConfigureApiKey}
        />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByPlaceholderText('Describe the image you want to generate...')).toBeInTheDocument());
    expect(screen.getByText('Reference images (optional)')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByTitle('Not configured')).toBeDisabled();
    expect(screen.getByText('Configure an image model to generate')).toBeInTheDocument();
    expect(screen.getByTitle('Configure the default text model first')).toBeDisabled();

    const configureButtons = screen.getAllByRole('button', { name: 'Configure image model' });
    const enabledConfigureButton = configureButtons.find(button => !button.hasAttribute('disabled'));
    const disabledSubmitButton = configureButtons.find(button => button.hasAttribute('disabled'));
    expect(enabledConfigureButton).toBeDefined();
    expect(disabledSubmitButton).toBeDisabled();

    fireEvent.click(enabledConfigureButton!);
    expect(onConfigureApiKey).toHaveBeenCalledOnce();
  });

  it('shows proportional visual frames when choosing an aspect ratio', async () => {
    render(
      <LanguageProvider initialLocale="en">
        <ImageGenerationWorkbench
          disabled
          onSubmitText={vi.fn()}
          onSubmitImage={vi.fn()}
          onConfigureApiKey={vi.fn()}
        />
      </LanguageProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '1:1' }));

    const squarePreview = await screen.findByTestId('aspect-ratio-preview-1-1');
    const landscapePreview = await screen.findByTestId('aspect-ratio-preview-3-2');
    expect(squarePreview).toHaveStyle({ width: '36px', height: '36px' });
    expect(landscapePreview).toHaveStyle({ width: '48px', height: '32px' });
    expect(screen.getByText('1:1')).toBeInTheDocument();
    expect(screen.getByText('3:2')).toBeInTheDocument();
    expect(screen.queryByText('Square')).not.toBeInTheDocument();
    expect(screen.queryByText('Landscape')).not.toBeInTheDocument();
  });

  it('refreshes the selected channel model catalog and reports the result', async () => {
    const registry = loadRegistry();
    registry.imageModels[0] = {
      ...registry.imageModels[0],
      id: 'image-test',
      name: 'Image Test',
      modelId: 'image-model',
      apiKey: 'test-key',
      baseUrl: 'https://image.example.com',
    };
    registry.defaults.textToImage = 'image-test';
    saveRegistry(registry);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'image-model', displayName: 'Image Model' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LanguageProvider initialLocale="en">
        <ImageGenerationWorkbench onSubmitText={vi.fn()} onSubmitImage={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh models' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(dispatchImageActionToast).toHaveBeenCalledWith('1 models refreshed.', 'success'));
    expect(getModelCatalogCache('image-test', { protocol: 'openai', baseUrl: 'https://image.example.com' })?.options).toEqual([
      { id: 'image-model', name: 'Image Model' },
    ]);
  });
});
