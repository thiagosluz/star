'use client';

import { useRef, useState } from 'react';
import { Loader2, Trash2, Upload, XCircle } from 'lucide-react';

import { Button } from '@/components/ui';
import { uploadAssetFile, type AssetUploadAction } from '@/components/admin/asset-upload';
import {
  IMAGE_INPUT_LABEL,
  MAX_IMAGE_BYTES,
  WEBP_STORAGE_NOTICE,
  formatBytes,
  webpSavingsLabel,
} from '@/domain/events/image-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COMPONENTE — Campo da foto do palestrante (FASE 25 · unificado na FASE 46)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FOTO VIROU UM CAMPO SÓ, USADO PELAS DUAS TELAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 25 escreveu esta esteira dentro do portal, porque só o palestrante podia
 *  enviar a foto. A FASE 46 deu à ORGANIZAÇÃO o mesmo direito — para quem nunca vai
 *  assumir o perfil —, e a segunda cópia divergiria no primeiro ajuste: bastava um
 *  lado ganhar o aviso da conversão para as duas telas contarem histórias diferentes
 *  sobre o mesmo arquivo.
 *
 *  O que muda entre as telas é o que o CHAMADOR diz: de quem é a foto (campos
 *  extras da Server Action), o texto do aviso de sucesso e a nota que explica a
 *  origem da imagem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SpeakerPhotoField({
  tenantSlug,
  eventId,
  speakerProfileId,
  currentUrl,
  requestUploadAction,
  confirmUploadAction,
  inputLabel = 'Foto do palestrante',
  testId,
  successPrefix,
  successSuffix,
  note = null,
}: {
  tenantSlug: string;
  /** Evento que particiona a foto no storage (no portal, o primeiro da agenda). */
  eventId: string;
  /** Ausente no cadastro novo: o perfil ainda não existe quando a foto sobe. */
  speakerProfileId?: string;
  currentUrl: string | null;
  requestUploadAction: AssetUploadAction;
  confirmUploadAction: AssetUploadAction;
  inputLabel?: string;
  testId: string;
  /** Início da frase de sucesso — mantém o texto de cada tela. */
  successPrefix: string;
  successSuffix: string;
  /** Explica de onde veio a foto atual (ex.: enviada pela organização). */
  note?: string | null;
}) {
  const [avatarUrl, setAvatarUrl] = useState(currentUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: 'danger' | 'success' } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Limpa o input: escolher o MESMO arquivo de novo precisa disparar o evento.
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    setFeedback(null);

    const result = await uploadAssetFile({
      file,
      tenantSlug,
      eventId,
      target: 'SPEAKER_AVATAR',
      // O destino do portal exige o perfil; o da organização não tem perfil ainda.
      ...(speakerProfileId ? { extraFormFields: { speakerProfileId } } : {}),
      requestUploadAction,
      confirmUploadAction,
    });

    setUploading(false);

    if (!result.ok) {
      setFeedback({ message: result.message, tone: 'danger' });
      return;
    }

    setAvatarUrl(result.url);

    const savings = webpSavingsLabel(result.sourceBytes, result.sizeBytes);
    setFeedback({
      message: `${successPrefix} e guardada em WebP (${formatBytes(result.sizeBytes)}${
        savings ? ` — ${savings}` : ''
      }). ${successSuffix}`,
      tone: 'success',
    });
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- host do storage é dinâmico
          <img
            src={avatarUrl}
            alt="Foto atual do palestrante"
            width={72}
            height={72}
            className="size-18 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-18 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
            sem foto
          </span>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              data-testid={`${testId}-button`}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-3.5" aria-hidden />
              )}
              {avatarUrl ? 'Trocar foto' : 'Enviar foto'}
            </Button>

            {avatarUrl ? (
              /**
               * ─────────────────────────────────────────────────────────────────────
               *  REMOVER É UMA SAÍDA, NÃO UM EFEITO COLATERAL (FASE 46)
               * ─────────────────────────────────────────────────────────────────────
               *  O aviso ao palestrante diz que ele pode tirar a foto que a organização
               *  publicou. Sem este botão, a única saída seria subir outra imagem —
               *  ou seja, o aviso mentiria. Ele limpa o campo; quem grava é o
               *  "Salvar" do formulário.
               */
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  setAvatarUrl('');
                  setFeedback({
                    message: 'A foto será removida quando você salvar.',
                    tone: 'success',
                  });
                }}
                data-testid={`${testId}-remove`}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Remover foto
              </Button>
            ) : null}
          </div>

          <input
            ref={fileRef}
            type="file"
            aria-label={inputLabel}
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="sr-only"
            onChange={handleFile}
          />
        </div>

        <div className="min-w-48 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {IMAGE_INPUT_LABEL} · até {formatBytes(MAX_IMAGE_BYTES.SPEAKER_AVATAR)}
          </p>
          <p className="text-xs text-muted-foreground">{WEBP_STORAGE_NOTICE}</p>
        </div>
      </div>

      {note ? (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-origin`}>
          {note}
        </p>
      ) : null}

      {feedback ? (
        <p
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
          data-testid={`${testId}-feedback`}
          className={`flex items-start gap-1.5 text-xs ${
            feedback.tone === 'danger' ? 'text-destructive' : 'text-success-strong'
          }`}
        >
          {feedback.tone === 'danger' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : null}
          {feedback.message}
        </p>
      ) : null}

      {/*
        A URL viaja como CAMPO OCULTO: quem grava no banco é a Server Action do
        formulário, na mesma transação dos outros campos. Assim a foto acompanha o
        "Salvar" — e uma foto enviada e não salva não vira vínculo órfão.
      */}
      <input type="hidden" name="avatarUrl" value={avatarUrl} />
    </div>
  );
}
