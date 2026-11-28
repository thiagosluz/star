'use client';

import { useState } from 'react';

import { slugifyTitle } from '@/domain/events/schedule-ux-rules';
import {
  PROPOSAL_KINDS,
  PROPOSAL_KIND_LABELS,
  type ProposalKind,
} from '@/domain/proposals/call-rules';
import { describeProposalKindDefaults } from '@/domain/review/review-ux-rules';
import { Field, SelectField } from '@/components/admin/admin-form';
import { Label, Textarea } from '@/components/ui';

interface Option {
  value: string;
  label: string;
}

/**
 * Campos reativos de criação de chamada de propostas (FASE 137 · ADR-532):
 *   - Título primeiro, gerando automaticamente o slug da URL até edição manual;
 *   - Dica contextual por tipo de proposta (científica × atividade/palestrante);
 *   - Orientações ao proponente em `<Textarea>` multilinha;
 *   - Todos os `name` preservados para compatibilidade total com `saveCallAction` e No-JS.
 */
export function CallCreateFields({
  eventTimezone,
  trackOptions,
  blindOptions,
  blindHint,
}: {
  eventTimezone: string;
  trackOptions: Option[];
  blindOptions: Option[];
  blindHint: string;
}) {
  const [kind, setKind] = useState<ProposalKind>('PAPER');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const kindOptions = PROPOSAL_KINDS.map((item) => ({
    value: item,
    label: PROPOSAL_KIND_LABELS[item],
  }));

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = event.target.value;
    setTitle(nextTitle);
    if (!slugTouched) {
      setSlug(slugifyTitle(nextTitle));
    }
  };

  const handleSlugChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextSlug = event.target.value;
    setSlugTouched(nextSlug.trim().length > 0);
    setSlug(nextSlug);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field
          label="Título da chamada"
          name="title"
          required
          value={title}
          onChange={handleTitleChange}
          placeholder="Ex.: Chamada de artigos científicos 2026"
        />
      </div>

      <SelectField
        label="Tipo de proposta"
        name="kind"
        options={kindOptions}
        value={kind}
        onChange={(event) => setKind(event.target.value as ProposalKind)}
      />

      <Field
        label="Identificador na URL"
        name="slug"
        required
        value={slug}
        onChange={handleSlugChange}
        placeholder="chamada-artigos-2026"
        hint="Preenchido automaticamente pelo título; você pode ajustar. Minúsculas, números e hífen."
      />

      <p
        className="sm:col-span-2 rounded-md border border-border bg-surface-low/60 px-3 py-2 text-xs text-muted-foreground"
        data-testid="call-kind-hint"
      >
        {describeProposalKindDefaults(kind)}
      </p>

      <div className="sm:col-span-2">
        <Field
          label="Resumo"
          name="summary"
          hint="Uma linha que a página pública mostra no cartão."
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2" data-field="instructions">
        <Label htmlFor="call-instructions">Orientações ao proponente</Label>
        <Textarea
          id="call-instructions"
          name="instructions"
          rows={3}
          placeholder="Explique formato esperado, critérios de avaliação e o que deve ser anexado."
        />
        <p className="text-xs text-muted-foreground">
          O que precisa ser dito a quem vai propor: formato, critérios, o que anexar.
        </p>
      </div>

      <Field
        label="Abre em"
        name="opensAt"
        type="datetime-local"
        hint={`No fuso do evento (${eventTimezone}).`}
      />
      <Field
        label="Encerra em"
        name="closesAt"
        type="datetime-local"
        hint={`No fuso do evento (${eventTimezone}).`}
      />
      <SelectField
        label="Revisão cega"
        name="requiresBlindReview"
        options={blindOptions}
        defaultValue=""
        hint={blindHint}
      />
      <Field
        label="Propostas por autor"
        name="maxSubmissionsPerAuthor"
        type="number"
        min={0}
        defaultValue={0}
        hint="0 = sem limite."
      />
      <div className="sm:col-span-2">
        <SelectField
          label="Trilha"
          name="trackId"
          options={trackOptions}
          defaultValue=""
          hint="A trilha traz a rubrica e a afinidade dos revisores. Chamada de palestrante não precisa."
        />
      </div>
    </div>
  );
}
