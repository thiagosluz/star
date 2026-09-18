'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button, Input, Label, Textarea } from '@/components/ui';
import { BLOCK_DESCRIPTIONS, type PageBlockType } from '@/domain/events/landing-page';
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
}: {
  type: PageBlockType;
  values: BlockContentValues;
  /** Cotas disponíveis, para o filtro do bloco de patrocinadores. */
  tierOptions: { value: string; label: string }[];
}) {
  const [faq, setFaq] = useState(values.faq);
  const [gallery, setGallery] = useState(values.gallery);

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
          <Label>Imagens (por URL)</Label>
          {gallery.map((image, index) => (
            <div key={index} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Imagem {index + 1}</span>
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
              <Input
                name="galleryUrl"
                defaultValue={image.url}
                placeholder="https://cdn.exemplo.br/foto.jpg"
                aria-label={`URL da imagem ${index + 1}`}
              />
              <Input
                name="galleryCaption"
                defaultValue={image.caption}
                placeholder="Legenda (opcional)"
                aria-label={`Legenda da imagem ${index + 1}`}
              />
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
