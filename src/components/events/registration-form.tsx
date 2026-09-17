'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, Clock, UserPlus } from 'lucide-react';

import {
  registerForActivityAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ef-button w-full sm:w-auto" disabled={pending}>
      <UserPlus className="size-4" aria-hidden />
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Formulário de inscrição em atividade.
 *
 * O consentimento de tratamento de dados (LGPD) é obrigatório e é validado no
 * SERVIDOR, não apenas aqui: desabilitar o botão no cliente é conveniência, a
 * regra vive na Server Action.
 */
export function RegistrationForm({
  tenantSlug,
  eventSlug,
  activitySlug,
  isWaitlist,
  alreadyRegistered,
}: {
  tenantSlug: string;
  eventSlug: string;
  activitySlug: string;
  isWaitlist: boolean;
  alreadyRegistered: 'CONFIRMED' | 'WAITLISTED' | null;
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    registerForActivityAction,
    null,
  );

  // ── Já inscrito ────────────────────────────────────────────────────────────
  if (alreadyRegistered) {
    return (
      <div className="ef-card space-y-2 p-5">
        <p className="flex items-center gap-2 font-medium" data-testid="registration-status">
          {alreadyRegistered === 'CONFIRMED' ? (
            <>
              <CheckCircle2 className="size-4 text-green-600" aria-hidden />
              Inscrição confirmada
            </>
          ) : (
            <>
              <Clock className="size-4 text-amber-600" aria-hidden />
              Você está na lista de espera
            </>
          )}
        </p>
        <p className="text-sm opacity-70">
          {alreadyRegistered === 'CONFIRMED'
            ? 'Você receberá as instruções de acesso e o certificado após a atividade.'
            : 'Avisaremos assim que uma vaga for liberada. A confirmação é automática e por ordem de chegada.'}
        </p>
      </div>
    );
  }

  // ── Resultado da ação ──────────────────────────────────────────────────────
  if (state?.ok) {
    return (
      <div className="ef-card space-y-2 p-5" data-testid="registration-success">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4 text-green-600" aria-hidden />
          {state.code === 'CONFIRMED' ? 'Inscrição confirmada!' : 'Você entrou na lista de espera'}
        </p>
        <p className="text-sm opacity-70">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="ef-card space-y-4 p-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="activitySlug" value={activitySlug} />

      {state && !state.ok && state.message ? (
        <p role="alert" className="ef-badge w-full text-destructive" data-testid="registration-error">
          {state.message}
        </p>
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
            Autorizo o tratamento dos meus dados pessoais para fins de organização
            deste evento. <span className="opacity-60">(obrigatório)</span>
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
          {isWaitlist
            ? 'A atividade está lotada. Você entrará na lista de espera.'
            : 'Sua vaga é reservada no momento da confirmação.'}
        </p>
        <SubmitButton
          label={isWaitlist ? 'Entrar na lista de espera' : 'Confirmar inscrição'}
          pendingLabel="Processando…"
        />
      </div>
    </form>
  );
}
