'use client';

import { useRef, useState } from 'react';
import { ImageUp, Loader2, Plus, Trash2 } from 'lucide-react';

import { uploadAssetFile, type AssetUploadAction } from '@/components/admin/asset-upload';
import type { BlockContentValues } from '@/components/admin/block-content-values';
import { Button, Input, Label } from '@/components/ui';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  IMAGE_INPUT_LABEL,
  MAX_IMAGE_BYTES,
  WEBP_STORAGE_NOTICE,
  formatBytes,
} from '@/domain/events/image-rules';

export interface BlockUploadContext {
  tenantSlug: string;
  eventId: string;
  requestUploadAction: AssetUploadAction;
  confirmUploadAction: AssetUploadAction;
}

/** Editor isolado de galeria de imagens com upload presigned sob demanda e reuso do acervo. */
export function GalleryBlockFields({
  initialGallery,
  libraryOptions,
  uploadContext,
}: {
  initialGallery: BlockContentValues['gallery'];
  libraryOptions: { value: string; label: string }[];
  uploadContext?: BlockUploadContext;
}) {
  const [gallery, setGallery] = useState(initialGallery);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingIndexRef = useRef<number | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const index = pendingIndexRef.current;

    event.target.value = '';
    pendingIndexRef.current = null;

    if (!file || index === null || !uploadContext) return;

    setUploadMessage(null);
    setUploadingIndex(index);

    const result = await uploadAssetFile({
      file,
      tenantSlug: uploadContext.tenantSlug,
      eventId: uploadContext.eventId,
      target: 'GALLERY',
      requestUploadAction: uploadContext.requestUploadAction,
      confirmUploadAction: uploadContext.confirmUploadAction,
    });

    setUploadingIndex(null);

    if (!result.ok) {
      setUploadMessage(result.message);
      return;
    }

    setGallery((current) =>
      current.map((image, i) =>
        i === index ? { ...image, url: result.url, caption: image.caption || file.name } : image,
      ),
    );
    setUploadMessage('Imagem enviada. Salve o bloco para publicá-la na página.');
  }

  return (
    <div className="space-y-3">
      <Label>Imagens</Label>

      {uploadContext ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTRIBUTE}
            onChange={handleFile}
            className="hidden"
            aria-label="Escolher imagem para a galeria"
            data-testid="gallery-file-input"
          />
          <p className="text-xs text-muted-foreground">
            Envie do computador ({IMAGE_INPUT_LABEL} · até {formatBytes(MAX_IMAGE_BYTES.GALLERY)}) ou informe o
            endereço de uma imagem já publicada. {WEBP_STORAGE_NOTICE}
          </p>
        </>
      ) : null}

      {gallery.map((image, index) => (
        <div key={index} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Imagem {index + 1}</span>

            <div className="flex items-center gap-2">
              {uploadContext ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`gallery-upload-${index}`}
                  disabled={uploadingIndex !== null}
                  onClick={() => {
                    pendingIndexRef.current = index;
                    fileInputRef.current?.click();
                  }}
                >
                  {uploadingIndex === index ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ImageUp className="size-3.5" aria-hidden />
                  )}
                  {uploadingIndex === index ? 'Enviando…' : 'Enviar imagem'}
                </Button>
              ) : null}

              {gallery.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover imagem ${index + 1}`}
                  onClick={() => setGallery((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Remover
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3">
            {image.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.url} alt="" className="size-16 shrink-0 rounded-sm border border-border object-cover" />
            ) : null}

            <div className="min-w-0 flex-1 space-y-2">
              {libraryOptions.length > 0 ? (
                <select
                  aria-label={`Usar imagem do acervo na imagem ${index + 1}`}
                  data-testid={`gallery-library-${index}`}
                  value=""
                  onChange={(event) => {
                    const url = event.target.value;
                    if (!url) return;
                    setGallery((current) => current.map((row, i) => (i === index ? { ...row, url } : row)));
                  }}
                  className="h-9 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground"
                >
                  <option value="">Usar imagem do acervo…</option>
                  {libraryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : null}

              <Input
                name="galleryUrl"
                value={image.url}
                onChange={(event) =>
                  setGallery((current) =>
                    current.map((row, i) => (i === index ? { ...row, url: event.target.value } : row)),
                  )
                }
                placeholder="https://cdn.exemplo.br/foto.jpg"
                aria-label={`URL da imagem ${index + 1}`}
              />
              <Input
                name="galleryCaption"
                value={image.caption}
                onChange={(event) =>
                  setGallery((current) =>
                    current.map((row, i) => (i === index ? { ...row, caption: event.target.value } : row)),
                  )
                }
                placeholder="Legenda (opcional)"
                aria-label={`Legenda da imagem ${index + 1}`}
              />
            </div>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="add-gallery-row"
        onClick={() => setGallery((current) => [...current, { url: '', caption: '' }])}
      >
        <Plus className="size-3.5" aria-hidden />
        Adicionar imagem
      </Button>

      {uploadMessage ? (
        <p role="status" className="text-xs text-muted-foreground" data-testid="gallery-upload-status">
          {uploadMessage}
        </p>
      ) : null}
    </div>
  );
}
