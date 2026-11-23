'use client';

import type { BlockContentValues } from '@/components/admin/block-content-values';
import { BlockFieldShell } from '@/components/admin/block-fields/block-field-shell';
import { Checkbox, Input, Textarea } from '@/components/ui';

export function RichTextBlockFields({ values }: { values: BlockContentValues }) {
  return (
    <>
      <BlockFieldShell label="Título" hint="Vazio usa “Sobre o evento”.">
        <Input name="title" defaultValue={values.title} aria-label="Título" />
      </BlockFieldShell>
      <BlockFieldShell
        label="Texto"
        hint="Parágrafos são preservados. HTML NÃO é interpretado — o texto aparece literal."
      >
        <Textarea name="body" defaultValue={values.body} rows={6} aria-label="Texto" />
      </BlockFieldShell>
    </>
  );
}

export function SponsorsBlockFields({
  values,
  tierOptions,
}: {
  values: BlockContentValues;
  tierOptions: { value: string; label: string }[];
}) {
  return (
    <>
      <BlockFieldShell label="Descrição de apoio" hint="Uma linha de agradecimento sob o título do bloco (opcional).">
        <Input name="description" defaultValue={values.description} aria-label="Descrição de apoio" />
      </BlockFieldShell>
      <BlockFieldShell
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
      </BlockFieldShell>
    </>
  );
}

export function TeamBlockFields({
  values,
  teamOptions,
}: {
  values: BlockContentValues;
  teamOptions: { value: string; label: string }[];
}) {
  return (
    <>
      <BlockFieldShell label="Descrição de apoio" hint="Uma linha sob o título do bloco (opcional).">
        <Input name="description" defaultValue={values.description} aria-label="Descrição de apoio" />
      </BlockFieldShell>
      <BlockFieldShell
        label="Mostrar apenas uma equipe"
        hint="Sem escolha, o bloco exibe todas as equipes ativas do evento, com a etiqueta de cada uma."
      >
        <select
          name="teamId"
          defaultValue={values.teamId}
          aria-label="Mostrar apenas uma equipe"
          className="h-11 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="">Todas as equipes do evento</option>
          {teamOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </BlockFieldShell>
    </>
  );
}

export function CountdownBlockFields({ values }: { values: BlockContentValues }) {
  return (
    <BlockFieldShell label="Rótulo" hint="Vazio usa “Começa em”.">
      <Input name="label" defaultValue={values.label} aria-label="Rótulo" />
    </BlockFieldShell>
  );
}

export function RegistrationCtaBlockFields({ values }: { values: BlockContentValues }) {
  return (
    <>
      <BlockFieldShell label="Descrição" hint="Uma linha explicando por que se inscrever.">
        <Input name="description" defaultValue={values.description} aria-label="Descrição" />
      </BlockFieldShell>
      <BlockFieldShell label="Texto do botão" hint="O destino é sempre a programação do evento.">
        <Input name="ctaLabel" defaultValue={values.ctaLabel} aria-label="Texto do botão" />
      </BlockFieldShell>
    </>
  );
}

export function CallForProposalsBlockFields({ values }: { values: BlockContentValues }) {
  return (
    <>
      <BlockFieldShell
        label="Texto de apoio"
        hint="Uma linha explicando o que a pessoa deve fazer. Vazio usa o texto padrão."
      >
        <Input name="description" defaultValue={values.description} aria-label="Texto de apoio" />
      </BlockFieldShell>

      <label className="flex items-start gap-2 text-sm font-medium text-foreground">
        <Checkbox name="includeClosed" defaultChecked={values.includeClosed} />
        <span>
          Incluir também as chamadas encerradas
          <span className="block text-xs font-normal text-muted-foreground">
            Sem marcar, o bloco mostra só as abertas e as agendadas.
          </span>
        </span>
      </label>

      <p className="text-xs text-muted-foreground">
        As chamadas exibidas são as <strong>publicadas</strong> no painel de chamadas do evento. Para criar,
        editar ou publicar uma chamada, use “Chamadas de propostas” no painel do evento.
      </p>
    </>
  );
}

export function CustomHtmlBlockFields({ values }: { values: BlockContentValues }) {
  return (
    <>
      <BlockFieldShell label="Título" hint="Vazio usa “HTML personalizado”.">
        <Input name="title" defaultValue={values.title} aria-label="Título" />
      </BlockFieldShell>
      <BlockFieldShell label="Código" hint="Exibido como TEXTO na página: HTML não é interpretado, por segurança.">
        <Textarea name="html" defaultValue={values.html} rows={5} aria-label="Código" />
      </BlockFieldShell>
    </>
  );
}
