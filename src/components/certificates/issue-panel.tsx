'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Ban, Layers, Loader2 } from 'lucide-react';

import type { CertificateActionState } from '@/app/actions/certificate-actions';

/**
 * Painel da equipe: emissão em lote e revogação.
 *
 * Emissão em lote existe porque o caso de uso real é "acabou o evento, emita para
 * todos" — pedir 300 certificados um a um pela tela do participante não é um fluxo
 * de trabalho, é um castigo.
 */

function BatchButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="issue-batch"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Layers className="size-4" aria-hidden />
      )}
      {pending ? 'Emitindo lote…' : 'Emitir em lote'}
    </button>
  );
}

export function IssueBatchPanel({
  tenantSlug,
  events,
  kinds,
  action,
}: {
  tenantSlug: string;
  events: readonly { id: string; title: string }[];
  kinds: readonly { value: string; label: string }[];
  action: (
    prev: CertificateActionState | null,
    formData: FormData,
  ) => Promise<CertificateActionState>;
}) {
  const [state, formAction] = useActionState<CertificateActionState | null, FormData>(action, null);

  if (events.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-5"
      aria-labelledby="emissao-lote"
      data-testid="issue-panel"
    >
      <header className="space-y-1">
        <h2 id="emissao-lote" className="text-base font-semibold">
          Emissão em lote (equipe)
        </h2>
        <p className="text-xs text-muted-foreground">
          Percorre os participantes com fatos registrados no evento e emite os tipos escolhidos.
          Quem não tem fato suficiente é ignorado — e o resultado informa quantos foram.
        </p>
      </header>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <label className="block space-y-1 text-xs font-medium">
          Evento
          <select
            name="eventId"
            required
            className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
            aria-label="Evento do lote"
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Tipos</legend>
          <div className="flex flex-wrap gap-3">
            {kinds.map((kind) => (
              <label key={kind.value} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  name="kinds"
                  value={kind.value}
                  defaultChecked={kind.value === 'ATTENDANCE' || kind.value === 'MINI_COURSE'}
                  className="size-3.5"
                />
                {kind.label}
              </label>
            ))}
          </div>
        </fieldset>

        <BatchButton />
      </form>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid="issue-feedback"
          className={`text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

export function RevokeCertificateForm({
  tenantSlug,
  certificateId,
  action,
}: {
  tenantSlug: string;
  certificateId: string;
  action: (
    prev: CertificateActionState | null,
    formData: FormData,
  ) => Promise<CertificateActionState>;
}) {
  const [state, formAction] = useActionState<CertificateActionState | null, FormData>(action, null);

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Revogar</summary>

      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="certificateId" value={certificateId} />

        <input
          name="reason"
          required
          minLength={8}
          placeholder="Motivo da revogação"
          aria-label="Motivo da revogação"
          className="block w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        />

        <button
          type="submit"
          data-testid="revoke-certificate"
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10"
        >
          <Ban className="size-3" aria-hidden />
          Confirmar revogação
        </button>

        {state ? (
          <p className={state.ok ? 'text-success-strong' : 'text-destructive'}>{state.message}</p>
        ) : null}
      </form>
    </details>
  );
}
