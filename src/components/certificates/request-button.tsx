'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Award, Loader2 } from 'lucide-react';

import type { SpeakerActionState } from '@/app/actions/speaker-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOTÃO DE EMISSÃO DO CERTIFICADO DE PALESTRANTE (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM BOTÃO E NÃO O FORMULÁRIO DE ESCOLHA DE TIPO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Na tela "Meus certificados" a pessoa escolhe evento E tipo, porque pode ter
 *  direito a vários. Aqui não há escolha: o evento já está definido pela linha e o
 *  tipo é sempre `SPEAKER`. Um formulário de seleção com uma opção só seria um passo
 *  a mais para chegar ao mesmo lugar.
 *
 *  `eligible` desabilita o botão quando os fatos ainda não fecham — e a razão aparece
 *  ao lado, vinda do domínio. O servidor reconfere de qualquer forma: botão desabilitado
 *  é conveniência, não autorização.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="emit-speaker-certificate"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Award className="size-4" aria-hidden />
      )}
      {pending ? 'Emitindo…' : label}
    </button>
  );
}

export function CertificateRequestButton({
  tenantSlug,
  eventId,
  kind,
  label,
  eligible,
  action,
}: {
  tenantSlug: string;
  eventId: string;
  kind: string;
  label: string;
  eligible: boolean;
  action: (
    prev: SpeakerActionState | null,
    formData: FormData,
  ) => Promise<SpeakerActionState>;
}) {
  const [state, formAction] = useActionState<SpeakerActionState | null, FormData>(action, null);

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="kind" value={kind} />

        <SubmitButton label={label} />

        {!eligible ? (
          <span className="text-xs text-muted-foreground" data-testid="certificate-not-eligible">
            Emissão indisponível por enquanto.
          </span>
        ) : null}
      </form>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid="speaker-certificate-feedback"
          className={`text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
