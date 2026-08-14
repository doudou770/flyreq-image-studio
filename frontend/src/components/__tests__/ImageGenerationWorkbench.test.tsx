import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/components/LanguageProvider';
import { ImageGenerationWorkbench } from '@/components/ImageGenerationWorkbench';

describe('ImageGenerationWorkbench', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('flyreq-locale', 'en');
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
});
