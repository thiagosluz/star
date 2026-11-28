'use client';

import { useState } from 'react';

import { CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { useIsInteractive } from '@/hooks/use-is-interactive';
import { EVENT_CATEGORY_OPTIONS } from '@/domain/events/event-category-rules';
import {
  EVENT_MODALITY_OPTIONS,
  type EventModalityValue,
} from '@/domain/events/event-modality-rules';
import { onlineRoomFieldVisibility } from '@/domain/events/event-form-defaults';
import { slugifyTitle } from '@/domain/events/schedule-ux-rules';

interface OptionItem {
  value: string;
  label: string;
}

/**
 * Campos progressivos de criação de evento (FASE 135 · ADR-527):
 *  - Título primeiro + auto-geração do slug (sem sobrescrever edição manual);
 *  - Modalidade reativa revelando o endereço da sala online quando Online/Híbrido;
 *  - Configurações avançadas (fuso, cor, janela de inscrição, trabalhos) recolhidas
 *    em `<details>` quando interativo e abertas sem JS.
 */
export function EventCreateFields({
  defaultStartLocal,
  defaultEndLocal,
  statusOptions,
}: {
  defaultStartLocal: string;
  defaultEndLocal: string;
  statusOptions: readonly OptionItem[];
}) {
  const interactive = useIsInteractive();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [modality, setModality] = useState<EventModalityValue>('IN_PERSON');

  const salaOnline = onlineRoomFieldVisibility({ modality });

  const advancedFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Vagas (vazio = ilimitado)" name="capacity" type="number" min={0} />
      <Field label="Fuso horário" name="timezone" required defaultValue="America/Bahia" />
      <Field label="Inscrições abrem em" name="registrationOpensAt" type="datetime-local" />
      <Field label="Inscrições fecham em" name="registrationClosesAt" type="datetime-local" />
      <Field
        label="Cor principal"
        name="primaryColor"
        placeholder="Código de cor hexadecimal"
        hint="Cor opcional de destaque na página pública do evento."
      />
      <div className="space-y-3 sm:col-span-2">
        <CheckboxField
          label="Este evento recebe trabalhos"
          name="usesCall"
          hint="Ligue para receber propostas: a janela, a rubrica e as trilhas ficam em “Chamadas de trabalhos”."
        />
        <CheckboxField
          label="Exigir vínculo com a instituição para se inscrever"
          name="registrationRequiresMembership"
          hint="Desmarcado, qualquer pessoa com conta pode se inscrever (evento aberto)."
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          1. Identidade do evento
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Título"
            name="title"
            required
            value={title}
            onChange={(event) => {
              const next = event.target.value;
              setTitle(next);
              if (!slugTouched) {
                setSlug(slugifyTitle(next));
              }
            }}
            placeholder="Congresso de Tecnologia 2027"
          />

          <Field
            label="Identificador (URL)"
            name="slug"
            required
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugTouched(true);
            }}
            placeholder="congresso-2027"
            hint="Preenchido automaticamente pelo título. Você pode personalizar o endereço."
          />

          <Field label="Resumo" name="summary" placeholder="Uma linha sobre o evento" />

          <SelectField
            label="Categoria temática"
            name="category"
            options={[{ value: '', label: 'Sem categoria específica' }, ...EVENT_CATEGORY_OPTIONS]}
            defaultValue=""
          />

          <SelectField
            label="Modalidade"
            name="modality"
            options={EVENT_MODALITY_OPTIONS}
            value={modality}
            onChange={(event) => setModality(event.target.value as EventModalityValue)}
          />

          <SelectField label="Situação" name="status" options={[...statusOptions]} defaultValue="DRAFT" />
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          2. Datas e local
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Início"
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={defaultStartLocal}
          />
          <Field
            label="Término"
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={defaultEndLocal}
          />
          <Field label="Local" name="venueName" placeholder="Centro de Convenções" />
          <Field label="Cidade" name="city" placeholder="Salvador" />
          <Field label="UF" name="state" placeholder="BA" />

          {salaOnline.show ? (
            <Field
              label="Endereço da sala online"
              name="onlineUrl"
              type="url"
              placeholder="https://sala.exemplo.com/entrar"
              notice={salaOnline.notice}
              hint={salaOnline.hint}
            />
          ) : null}
        </div>
      </div>

      {interactive ? (
        <details
          className="rounded-lg border border-border bg-surface-low/50 p-4"
          data-testid="event-create-advanced"
        >
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Configurações adicionais (vagas, janela de inscrição, fuso, cor e trabalhos)
          </summary>
          <div className="mt-4">{advancedFields}</div>
        </details>
      ) : (
        <div className="space-y-3 border-t border-border pt-4">{advancedFields}</div>
      )}
    </div>
  );
}
