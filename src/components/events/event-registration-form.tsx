'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, UserPlus } from 'lucide-react';

import {
  registerForEventAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="ef-button w-full sm:w-auto" disabled={pending}>
      <UserPlus className="size-4" aria-hidden />
      {pending ? 'Processando…' : 'Confirmar inscrição no evento'}
    </button>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INSCRIÇÃO NO EVENTO (revisão da FASE 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA INSCRIÇÃO FAZ — E POR QUE A TELA DIZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ao confirmar, a pessoa entra no evento E nas atividades ABERTAS (palestras,
 *  mesas-redondas, pósieres), sem passar uma a uma. Os minicursos e oficinas
 *  continuam com inscrição própria — e é isso que a lista abaixo mostra antes do
 *  clique, para ninguém descobrir depois.
 *
 *  O consentimento de dados é obrigatório e validado no SERVIDOR (LGPD): desabilitar
 *  o botão aqui é conveniência, a regra vive na Server Action.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function EventRegistrationForm({
  tenantSlug,
  eventSlug,
  openActivities,
  individualActivities,
}: {
  tenantSlug: string;
  eventSlug: string;
  /** Atividades em que a inscrição no evento inclui a pessoa automaticamente. */
  openActivities: readonly string[];
  /** Atividades que continuam exigindo inscrição própria. */
  individualActivities: readonly string[];
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    registerForEventAction,
    null,
  );

  if (state?.ok) {
    return (
      <div className="ef-card space-y-2 p-5" data-testid="event-registration-success">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4 text-success-strong" aria-hidden />
          Inscrição no evento confirmada!
        </p>
        <p className="text-sm opacity-80" data-testid="event-registration-message">
          {state.message}
        </p>
        <p className="text-xs opacity-60">
          Acompanhe e cancele em “Minhas inscrições”.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="ef-card space-y-4 p-5" data-testid="event-registration-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventSlug" value={eventSlug} />

      {state && !state.ok && state.message ? (
        <p role="alert" className="ef-badge w-full text-destructive" data-testid="event-registration-error">
          {state.message}
        </p>
      ) : null}

      {openActivities.length > 0 ? (
        <div className="space-y-1 text-sm" data-testid="event-open-activities">
          <p className="font-medium">Sua inscrição já inclui:</p>
          <ul className="list-disc pl-5 opacity-80">
            {openActivities.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {individualActivities.length > 0 ? (
        <div className="space-y-1 text-sm opacity-80" data-testid="event-individual-activities">
          <p className="font-medium">Estas têm inscrição própria:</p>
          <ul className="list-disc pl-5">
            {individualActivities.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="accessibilityNotes" className="text-sm font-medium">
          Necessidades de acessibilidade ou restrições alimentares{' '}
          <span className="font-normal opacity-60">(opcional)</span>
        </label>
        <textarea
          id="accessibilityNotes"
          name="accessibilityNotes"
          rows={2}
          maxLength={600}
          className="w-full px-3 py-2 text-sm"
          style={{
            borderRadius: 'var(--ef-radius)',
            border: '1px solid color-mix(in oklab, var(--ef-text) 20%, transparent)',
            backgroundColor: 'transparent',
          }}
          placeholder="Ex.: intérprete de Libras, rampa de acesso, opção vegana"
        />
      </div>

      <fieldset className="space-y-2.5">
        <legend className="mb-1 text-sm font-medium">Consentimentos</legend>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consentData" className="mt-0.5" required />
          <span>
            Autorizo o tratamento dos meus dados pessoais para fins de organização deste
            evento. <span className="opacity-60">(obrigatório)</span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consentImage" className="mt-0.5" />
          <span>
            Autorizo o uso da minha imagem em registros e divulgação do evento.{' '}
            <span className="opacity-60">(opcional)</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs opacity-60">
          Sua vaga no evento é reservada no momento da confirmação.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
