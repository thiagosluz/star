'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Award, Loader2 } from 'lucide-react';

import type { CertificateActionState } from '@/app/actions/certificate-actions';

/**
 * Formulário de solicitação do PRÓPRIO certificado.
 *
 * O tipo é escolhido pela pessoa (e não imposto): quem participou de um minicurso
 * quer o certificado do minicurso, quem apresentou trabalho quer o de autoria. A
 * elegibilidade é verificada no servidor, e a recusa EXPLICA o motivo — "não
 * elegível" sem motivo obrigaria a abrir um chamado para descobrir que faltaram
 * 12 minutos de presença.
 */
export interface CertificateKindOption {
  value: string;
  label: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="request-certificate"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Award className="size-4" aria-hidden />
      )}
      {pending ? 'Emitindo…' : 'Emitir certificado'}
    </button>
  );
}

export function RequestCertificateForm({
  tenantSlug,
  events,
  kinds,
  action,
}: {
  tenantSlug: string;
  events: readonly { id: string; title: string }[];
  kinds: readonly CertificateKindOption[];
  action: (
    prev: CertificateActionState | null,
    formData: FormData,
  ) => Promise<CertificateActionState>;
}) {
  const [state, formAction] = useActionState<CertificateActionState | null, FormData>(action, null);

  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Nenhum evento publicado nesta instituição ainda.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3" data-testid="certificate-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <label className="space-y-1 text-xs font-medium">
          Evento
          <select
            name="eventId"
            required
            className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="Evento"
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium">
          Tipo
          <select
            name="kind"
            required
            className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="Tipo de certificado"
          >
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>

        <SubmitButton />
      </form>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid="certificate-feedback"
          className={`text-sm ${state.ok ? 'text-green-700' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
