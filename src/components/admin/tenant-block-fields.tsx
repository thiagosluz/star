'use client';

import { useState } from 'react';

import { Button, Input, Label, Textarea } from '@/components/ui';
import { blockContentToValues, type BlockContentValues } from '@/components/admin/block-content-values';
import type { PageBlockType } from '@/domain/events/landing-page';
import { TENANT_BLOCK_DESCRIPTIONS, type TenantPageBlockType } from '@/domain/tenancy/tenant-public-page';
import { tenantBlockTypeNotice } from '@/domain/tenancy/tenant-page-editor';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMPOS DO BLOCO DA PÁGINA DA INSTITUIÇÃO, POR TIPO (FASE 64 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO REUSA O COMPONENTE DO EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `block-content-fields.tsx` é do editor do EVENTO: metade dos tipos dele não
 *  existe nesta página (agenda, palestrantes, galeria, contagem regressiva), e os
 *  que existem pedem dado que só o evento tem — cotas de patrocínio, equipes do
 *  evento, imagens do acervo daquela edição. Reusá-lo obrigaria a página da
 *  instituição a passar opções vazias para campos que ela nunca mostra.
 *
 *  O que É compartilhado continua compartilhado, e é o que importa: a conversão do
 *  conteúdo gravado em valores de formulário (`blockContentToValues`, módulo
 *  neutro) e a RÉGUA de validação, que é do domínio e roda no servidor.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O BLOCO SEM RENDERIZADOR NÃO GANHA FORMULÁRIO, E A TELA DIZ ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `HERO`, `TEAM` e `SPONSORS` estão em `TENANT_BLOCK_WITHOUT_RENDERER`: são aceitos
 *  e salvos, e a página ainda não desenha nada deles. Um formulário completo aqui
 *  seria a promessa de que aquilo aparece — quem preenchesse perderia o tempo. O
 *  aviso vem do domínio (`tenantBlockTypeNotice`), e não de um `if` na tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const LIMITES_DE_HISTORICO = [3, 6, 12, 18, 24] as const;

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

/** O conteúdo como objeto — `{}` para qualquer coisa que não seja um registro. */
function comoObjeto(content: unknown): Record<string, unknown> {
  return typeof content === 'object' && content !== null && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
}

function lerTexto(content: unknown, key: string): string {
  if (typeof content !== 'object' || content === null) return '';

  const value = comoObjeto(content)[key];
  return typeof value === 'string' ? value : '';
}

function lerNumero(content: unknown, key: string, padrao: number): number {
  const value = comoObjeto(content)[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : padrao;
}

/**
 * Os valores do formulário vindos do conteúdo GRAVADO.
 *
 * `ABOUT`, `PAST_EVENTS` e `CONTACT` não existem no catálogo do evento — a conversão
 * só conhece os tipos compartilhados. Ela continua sendo UMA (a mesma função), e o
 * que os três tipos exclusivos leem a mais (`foundedLabel`, `limit`, endereço) é
 * lido do `content` cru logo abaixo, campo a campo.
 */
function valoresDoConteudo(type: TenantPageBlockType, content: unknown): BlockContentValues {
  const doEvento =
    type === 'ABOUT' || type === 'PAST_EVENTS' || type === 'CONTACT'
      ? null
      : (type as PageBlockType);

  return doEvento
    ? blockContentToValues(doEvento, comoObjeto(content))
    : {
        title: lerTexto(content, 'title'),
        body: lerTexto(content, 'body'),
        label: '',
        description: lerTexto(content, 'description'),
        ctaLabel: '',
        tierId: '',
        teamId: '',
        html: '',
        includeClosed: false,
        faq: [],
        gallery: [],
      };
}

export function TenantBlockFields({
  type,
  content,
}: {
  type: TenantPageBlockType;
  /**
   * `unknown` de propósito: o conteúdo de um bloco é `Json` no banco, e a leitura
   * aqui é defensiva como a do renderizador — uma linha gravada antes de uma regra
   * existir não pode derrubar a tela. O campo é lido, nunca injetado.
   */
  content: unknown;
}) {
  const values = valoresDoConteudo(type, content);
  const [faq, setFaq] = useState(
    values.faq.length > 0 ? values.faq : [{ question: '', answer: '' }],
  );

  const aviso = tenantBlockTypeNotice(type);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{TENANT_BLOCK_DESCRIPTIONS[type]}</p>

      {aviso ? (
        <p
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-xs text-warning-strong"
          role="status"
          data-testid={`tenant-block-notice-${type}`}
        >
          {aviso}
        </p>
      ) : null}

      {type === 'RICH_TEXT' || type === 'CUSTOM_HTML' ? (
        <Shell label="Título" hint="Vazio usa o título padrão do bloco.">
          <Input name="title" defaultValue={values.title} aria-label="Título" />
        </Shell>
      ) : null}

      {type === 'RICH_TEXT' ? (
        <Shell
          label="Texto"
          hint="Parágrafos são preservados. HTML NÃO é interpretado — o texto aparece literal."
        >
          <Textarea name="body" defaultValue={values.body} rows={6} aria-label="Texto" />
        </Shell>
      ) : null}

      {type === 'ABOUT' ? (
        <>
          <Shell label="Título" hint="Vazio usa “Sobre a instituição”.">
            <Input name="title" defaultValue={values.title} aria-label="Título" />
          </Shell>
          <Shell
            label="Ano de fundação"
            hint="Texto livre: “1957” e “séc. XIX” são ambos legítimos. Ele aparece como “Fundada em …”."
          >
            <Input
              name="foundedLabel"
              defaultValue={lerTexto(content, 'foundedLabel')}
              aria-label="Ano de fundação"
            />
          </Shell>
          <Shell
            label="Apresentação"
            hint="A história da casa. Até 8.000 caracteres — Parágrafos são preservados."
          >
            <Textarea name="body" defaultValue={values.body} rows={10} aria-label="Apresentação" />
          </Shell>
        </>
      ) : null}

      {type === 'PAST_EVENTS' ? (
        <>
          <Shell label="Título" hint="Vazio usa “Histórico de eventos”.">
            <Input name="title" defaultValue={values.title} aria-label="Título" />
          </Shell>
          <Shell label="Descrição de apoio" hint="Uma linha sob o título (opcional).">
            <Input name="description" defaultValue={values.description} aria-label="Descrição de apoio" />
          </Shell>
          <Shell
            label="Quantos eventos mostrar"
            hint="A lista é lida do sistema na hora de desenhar — os eventos que já terminaram, do mais recente."
          >
            <select
              name="limit"
              defaultValue={String(lerNumero(content, 'limit', 6))}
              aria-label="Quantos eventos mostrar"
              className="h-11 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground"
            >
              {LIMITES_DE_HISTORICO.map((limite) => (
                <option key={limite} value={limite}>
                  {limite} evento(s)
                </option>
              ))}
            </select>
          </Shell>
        </>
      ) : null}

      {type === 'CONTACT' ? (
        <>
          <Shell label="Título" hint="Vazio usa “Contato e localização”.">
            <Input name="title" defaultValue={values.title} aria-label="Título" />
          </Shell>
          <Shell label="Endereço" hint="Texto de exibição — não vira mapa. O mapa é o campo abaixo.">
            <Input name="address" defaultValue={lerTexto(content, 'address')} aria-label="Endereço" />
          </Shell>
          <Shell label="E-mail de contato">
            <Input name="email" defaultValue={lerTexto(content, 'email')} aria-label="E-mail de contato" />
          </Shell>
          <Shell label="Telefone">
            <Input name="phone" defaultValue={lerTexto(content, 'phone')} aria-label="Telefone" />
          </Shell>
          <Shell
            label="Link do mapa"
            hint="Endereço absoluto http(s) — é ele que abre no mapa. Vazio não mostra o item."
          >
            <Input
              name="mapUrl"
              defaultValue={lerTexto(content, 'mapUrl')}
              placeholder="https://maps.exemplo.br/..."
              aria-label="Link do mapa"
            />
          </Shell>
        </>
      ) : null}

      {type === 'FAQ' ? (
        <div className="space-y-3">
          <Shell label="Título" hint="Vazio usa “Perguntas frequentes”.">
            <Input name="title" defaultValue={values.title} aria-label="Título" />
          </Shell>

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
                    Remover
                  </Button>
                ) : null}
              </div>
              <Input
                name="faqQuestion"
                defaultValue={item.question}
                placeholder="Precisa de inscrição para assistir?"
                aria-label={`Pergunta ${index + 1}`}
              />
              <Textarea
                name="faqAnswer"
                defaultValue={item.answer}
                rows={2}
                placeholder="Não: as atividades abertas são de acesso livre."
                aria-label={`Resposta ${index + 1}`}
              />
            </div>
          ))}

          {/*
            Linha em branco é permitida e descartada na validação do domínio; linha
            PELA METADE é recusada com o número dela — o organizador não precisa
            adivinhar qual pergunta ficou incompleta.
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="tenant-add-faq-row"
            onClick={() => setFaq((current) => [...current, { question: '', answer: '' }])}
          >
            Adicionar pergunta
          </Button>
        </div>
      ) : null}

      {type === 'CUSTOM_HTML' ? (
        <Shell
          label="Código"
          hint="Exibido como TEXTO na página: HTML não é interpretado, por segurança."
        >
          <Textarea name="html" defaultValue={values.html} rows={5} aria-label="Código" />
        </Shell>
      ) : null}
    </div>
  );
}
