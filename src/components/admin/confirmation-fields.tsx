'use client';

import { useState } from 'react';

import { Field, SelectField } from '@/components/admin/admin-form';
import { Select } from '@/components/ui';
import { useIsInteractive } from '@/hooks/use-is-interactive';
import {
  CONFIRMATION_POLICIES,
  CONFIRMATION_POLICY_LABELS,
  CONFIRMATION_REQUIREMENT_KINDS,
  CONFIRMATION_REQUIREMENT_KIND_LABELS,
  CONFIRMATION_WINDOW_DEFAULT_DAYS,
  CONFIRMATION_WINDOW_MAX_DAYS,
  CONFIRMATION_WINDOW_MIN_DAYS,
  type ConfirmationPolicy,
  type ConfirmationRequirement,
} from '@/domain/events/confirmation-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Confirmação de vaga com prazo (FASE 34 · progressivo na FASE 135 · ADR-528)
 *
 *  Com JavaScript ativo e política `AUTO` (padrão), oculta os 15 campos de prazo
 *  e exigências para não sobrecarregar quem cria uma atividade comum. Ao escolher
 *  `REQUIRED` (“Exige confirmação”), revela imediatamente prazo, local e as 3
 *  linhas de exigência. Sem JavaScript, renderiza tudo como fallback completo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ConfirmationFields({
  policy,
  windowDays,
  requirements,
  place,
  instructions,
}: {
  policy: ConfirmationPolicy;
  windowDays: number | null;
  requirements: readonly ConfirmationRequirement[];
  place: string | null;
  instructions: string | null;
}) {
  const interactive = useIsInteractive();
  const [selectedPolicy, setSelectedPolicy] = useState<ConfirmationPolicy>(policy);

  const rows = Math.max(3, requirements.length);
  const showDetails = !interactive || selectedPolicy === 'REQUIRED';

  const policyOptions = CONFIRMATION_POLICIES.map((value) => ({
    value,
    label: CONFIRMATION_POLICY_LABELS[value],
  }));

  const requirementKindOptions = [
    { value: '', label: 'Categoria…' },
    ...CONFIRMATION_REQUIREMENT_KINDS.map((value) => ({
      value,
      label: CONFIRMATION_REQUIREMENT_KIND_LABELS[value],
    })),
  ];

  return (
    <fieldset
      className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2"
      data-testid="activity-confirmation"
    >
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
        Confirmação de vaga (opcional)
      </legend>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm font-medium text-foreground">
          <span>Confirmação de vaga</span>
          <Select
            name="confirmationPolicy"
            value={selectedPolicy}
            onChange={(event) => setSelectedPolicy(event.target.value as ConfirmationPolicy)}
          >
            {policyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <span className="block text-xs font-normal text-muted-foreground">
            {selectedPolicy === 'AUTO'
              ? 'Vaga confirmada automaticamente no ato da inscrição. Troque para “Exige confirmação” se precisar conferir taxa, doação ou documento.'
              : 'A escolha vale para as inscrições NOVAS — quem já está confirmado não é desconvidado.'}
          </span>
        </label>

        {showDetails ? (
          <Field
            label="Prazo para confirmar (dias)"
            name="confirmationWindowDays"
            type="number"
            min={CONFIRMATION_WINDOW_MIN_DAYS}
            max={CONFIRMATION_WINDOW_MAX_DAYS}
            defaultValue={windowDays ?? CONFIRMATION_WINDOW_DEFAULT_DAYS}
            hint={`Contado da inscrição de cada pessoa, vencendo no fim do dia (${CONFIRMATION_WINDOW_MIN_DAYS} a ${CONFIRMATION_WINDOW_MAX_DAYS} dias).`}
          />
        ) : null}

        {showDetails ? (
          <>
            <Field
              label="Onde confirmar"
              name="confirmationPlace"
              defaultValue={place ?? ''}
              placeholder="Secretaria do bloco B, térreo — das 9h às 18h"
              hint="O lugar que a pessoa procura. Aparece no e-mail e no aviso da plataforma."
            />
            <Field
              label="Orientações (opcional)"
              name="confirmationInstructions"
              defaultValue={instructions ?? ''}
              placeholder="Leve o comprovante impresso."
              hint="Texto livre de apoio, além da lista de exigências."
            />
          </>
        ) : null}
      </div>

      {showDetails ? (
        <div className="space-y-2 pt-1" data-testid="activity-confirmation-details">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            O que é preciso para confirmar
          </p>

          {Array.from({ length: rows }, (_, index) => {
            const requirement = requirements[index];

            return (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <SelectField
                  label={`Categoria da exigência ${index + 1}`}
                  name="requirementKind"
                  options={requirementKindOptions}
                  defaultValue={requirement?.kind ?? ''}
                />
                <Field
                  label={`Descrição da exigência ${index + 1}`}
                  name="requirementLabel"
                  placeholder="1 kg de alimento não perecível"
                  defaultValue={requirement?.label}
                />
                <Field
                  label={`Observação da exigência ${index + 1}`}
                  name="requirementNote"
                  placeholder="Vale qualquer marca"
                  defaultValue={requirement?.note}
                />

                <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-3">
                  <input
                    type="checkbox"
                    name="requirementRequired"
                    value={String(index)}
                    defaultChecked={requirement ? requirement.required !== false : true}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <span>
                    A exigência {index + 1} é obrigatória (só ela segura a confirmação da vaga)
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      ) : null}
    </fieldset>
  );
}
