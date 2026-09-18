'use client';

import { useRef, useState } from 'react';
import { ImageUp, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button, Input, Label, Textarea } from '@/components/ui';
import { BLOCK_DESCRIPTIONS, type PageBlockType } from '@/domain/events/landing-page';
import { IMAGE_ACCEPT_ATTRIBUTE, MAX_IMAGE_BYTES, formatBytes } from '@/domain/events/image-rules';
import { uploadAssetFile, type AssetUploadAction } from '@/components/admin/asset-upload';
import type { BlockContentValues } from '@/components/admin/block-content-values';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMPOS DO BLOCO, POR TIPO (FASE 17, item E3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM COMPONENTE POR TIPO, E NÃO UM CAMPO "CONTEÚDO" EM JSON
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O caminho curto seria uma `<textarea>` com o JSON do bloco. Ele é inaceitável
 *  por dois motivos: quem opera uma instituição não escreve JSON, e um campo livre
 *  transferiria para o organizador a responsabilidade de respeitar o schema — que é
 *  exatamente o que o domínio existe para garantir.
 *
 *  Cada tipo declara os campos que TEM, e o mesmo schema que valida no servidor
 *  (`blockContentSchemas`) é o que a tela reflete campo a campo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  LISTAS REPETÍVEIS (perguntas frequentes, galeria)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Linhas numeradas com "adicionar" e "remover". Deixar uma linha em branco é
 *  permitido e ela é descartada na validação (`validateBlockContent`), mas uma linha
 *  PELA METADE é recusada com o número dela — o organizador não precisa adivinhar
 *  qual pergunta ficou incompleta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Rótulo envolvente sem `id`: a página tem um formulário por bloco (armadilha 5). */
function Shell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function BlockContentFields({
  type,
  values,
  tierOptions,
  uploadContext,
}: {
  type: PageBlockType;
  values: BlockContentValues;
  /** Cotas disponíveis, para o filtro do bloco de patrocinadores. */
  tierOptions: { value: string; label: string }[];
  /**
   * Contexto de upload (FASE 23, item E10). Presente apenas quando a tela tem como
   * enviar imagem — o componente continua funcionando sem ele, e aí a galeria aceita
   * apenas URL (útil em teste e em quem hospeda fora).
   */
  uploadContext?: {
    tenantSlug: string;
    eventId: string;
    requestUploadAction: AssetUploadAction;
    confirmUploadAction: AssetUploadAction;
  };
}) {
  const [faq, setFaq] = useState(values.faq);
  const [gallery, setGallery] = useState(values.gallery);
  /** Índice da linha que está enviando imagem agora (uma por vez). */
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingIndexRef = useRef<number | null>(null);

  /**
   * Envio de imagem da galeria.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O INPUT DE ARQUIVO É UM SÓ, FORA DAS LINHAS
   * ─────────────────────────────────────────────────────────────────────────────
   *  Cada linha tem o seu botão "Enviar imagem", mas o `<input type="file">` é único
   *  e fica escondido: o botão guarda o ÍNDICE da linha e abre o seletor. Vinte
   *  inputs de arquivo no mesmo formulário seriam vinte `id`s para manter e um
   *  formulário mais pesado — e o índice já diz para onde a imagem vai.
   *
   *  A URL devolvida é gravada na LINHA (estado local). O vínculo definitivo acontece
   *  quando o bloco é salvo: o conteúdo passa pela validação do domínio, que só
   *  aceita URL http(s) — a mesma regra vale para imagem enviada e para imagem
   *  colada de outro site.
   */
  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const index = pendingIndexRef.current;

    // Limpa o input para que escolher o MESMO arquivo de novo dispare o evento.
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
      <p className="text-xs text-muted-foreground">{BLOCK_DESCRIPTIONS[type]}</p>

      {/* Título: comum a quase todos os tipos; rótulos fixos só quando há padrão. */}
      {type !== 'RICH_TEXT' && type !== 'CUSTOM_HTML' ? (
        <Shell label="Título da seção" hint="Vazio usa o título padrão do bloco.">
          <Input name="title" defaultValue={values.title} aria-label="Título da seção" />
        </Shell>
      ) : null}

      {type === 'RICH_TEXT' ? (
        <>
          <Shell label="Título" hint="Vazio usa “Sobre o evento”.">
            <Input name="title" defaultValue={values.title} aria-label="Título" />
          </Shell>
          <Shell
            label="Texto"
            hint="Parágrafos são preservados. HTML NÃO é interpretado — o texto aparece literal."
          >
            <Textarea name="body" defaultValue={values.body} rows={6} aria-label="Texto" />
          </Shell>
        </>
      ) : null}

      {type === 'FAQ' ? (
        <div className="space-y-3">
          <Label>Perguntas frequentes</Label>
          {faq.map((item, index) => (
            <div key={index} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Pergunta {index + 1}</span>
                {faq.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover pergunta ${index + 1}`}
                    onClick={() => setFaq((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Remover
                  </Button>
                ) : null}
              </div>
              <Input
                name="faqQuestion"
                defaultValue={item.question}
                placeholder="Onde será o evento?"
                aria-label={`Pergunta ${index + 1}`}
              />
              <Textarea
                name="faqAnswer"
                defaultValue={item.answer}
                rows={2}
                placeholder="No Centro de Convenções, com transmissão online."
                aria-label={`Resposta ${index + 1}`}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="add-faq-row"
            onClick={() => setFaq((current) => [...current, { question: '', answer: '' }])}
          >
            <Plus className="size-3.5" aria-hidden />
            Adicionar pergunta
          </Button>
        </div>
      ) : null}

      {type === 'GALLERY' ? (
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
                Envie do computador (PNG, JPEG, WebP ou AVIF · até{' '}
                {formatBytes(MAX_IMAGE_BYTES.GALLERY)}) ou informe o endereço de uma imagem já
                publicada.
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
                  <img
                    src={image.url}
                    alt=""
                    className="size-16 shrink-0 rounded-sm border border-border object-cover"
                  />
                ) : null}

                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    name="galleryUrl"
                    value={image.url}
                    onChange={(event) =>
                      setGallery((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, url: event.target.value } : row,
                        ),
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
                        current.map((row, i) =>
                          i === index ? { ...row, caption: event.target.value } : row,
                        ),
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
            onClick={() =>
              setGallery((current) => [...current, { url: '', caption: '' }])
            }
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
      ) : null}

      {type === 'SPONSORS' ? (
        <Shell
          label="Mostrar apenas uma cota"
          hint="Sem escolha, o bloco exibe todos os patrocinadores do evento, agrupados por cota."
        >
          <select
            name="tierId"
            defaultValue={values.tierId}
            aria-label="Mostrar apenas uma cota"
            className="h-11 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">Todas as cotas</option>
            {tierOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Shell>
      ) : null}

      {type === 'COUNTDOWN' ? (
        <Shell label="Rótulo" hint="Vazio usa “Começa em”.">
          <Input name="label" defaultValue={values.label} aria-label="Rótulo" />
        </Shell>
      ) : null}

      {type === 'REGISTRATION_CTA' ? (
        <>
          <Shell label="Descrição" hint="Uma linha explicando por que se inscrever.">
            <Input name="description" defaultValue={values.description} aria-label="Descrição" />
          </Shell>
          <Shell label="Texto do botão" hint="O destino é sempre a programação do evento.">
            <Input name="ctaLabel" defaultValue={values.ctaLabel} aria-label="Texto do botão" />
          </Shell>
        </>
      ) : null}

      {type === 'CUSTOM_HTML' ? (
        <>
          <Shell label="Título" hint="Vazio usa “HTML personalizado”.">
            <Input name="title" defaultValue={values.title} aria-label="Título" />
          </Shell>
          <Shell
            label="Código"
            hint="Exibido como TEXTO na página: HTML não é interpretado, por segurança."
          >
            <Textarea name="html" defaultValue={values.html} rows={5} aria-label="Código" />
          </Shell>
        </>
      ) : null}
    </div>
  );
}
