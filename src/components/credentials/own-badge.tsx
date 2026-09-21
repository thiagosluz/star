'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Printer, TriangleAlert } from 'lucide-react';

import type { CredentialActionState } from '@/app/actions/credential-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CRACHÁ NA TELA DO PARTICIPANTE (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QR É DESENHADO AQUI, NO NAVEGADOR, A PARTIR DO CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O servidor manda o CÓDIGO; o desenho é do cliente. Duas razões:
 *
 *    1. imprimir/tirar print da tela é o uso real, e o QR em `<canvas>` sai nítido em
 *       qualquer zoom — imagem rasterizada ficaria borrada no celular;
 *    2. o mesmo componente serve para a folha impressa (servidor) e para a tela, sem
 *       duas implementações de QR Code.
 *
 *  `qrcode` já é dependência do projeto (certificado e folha de crachás).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function GenerateButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="own-badge-generate"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? 'Gerando…' : 'Gerar meu crachá'}
    </button>
  );
}

export function OwnBadge({
  tenantSlug,
  eventId,
  eventTitle,
  startsAtLabel,
  code,
  qrSvg,
  state,
  registered,
  activities,
  attendedActivities,
  minutesAttended,
  generateAction,
}: {
  tenantSlug: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  startsAtLabel: string;
  code: string;
  /** SVG do QR Code, gerado no SERVIDOR a partir do código do crachá. */
  qrSvg: string;
  state: 'ACTIVE' | 'REVOKED';
  registered: boolean;
  activities: readonly string[];
  attendedActivities: number;
  minutesAttended: number;
  generateAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
}) {
  const [state_, formAction] = useActionState<CredentialActionState | null, FormData>(generateAction, null);

  return (
    <section className="space-y-4" data-testid="own-badge" data-credential-state={state}>
      <div className="space-y-3 rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{eventTitle}</p>

        {/**
         * O QR vem do servidor como SVG inline: determinístico, nítido em qualquer zoom
         * e sem dependência de biblioteca no cliente.
         */}
        <div
          className="mx-auto w-fit rounded-lg bg-white p-3"
          data-testid="own-badge-qr"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />

        <p className="code-data text-lg font-semibold" data-testid="own-badge-code">
          {code}
        </p>

        <p className="text-xs text-muted-foreground">
          {state === 'ACTIVE'
            ? 'Crachá válido — mostre esta tela no balcão.'
            : 'Este crachá foi revogado: fale com a organização.'}
        </p>

        <p className="text-xs text-muted-foreground">{startsAtLabel}</p>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-low p-3">
          <dt className="text-xs text-muted-foreground">Inscrições neste evento</dt>
          <dd className="font-medium">{activities.length > 0 ? activities.join(' · ') : '—'}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-3">
          <dt className="text-xs text-muted-foreground">Presença registrada</dt>
          <dd className="font-medium">
            {attendedActivities} atividade(s) · {minutesAttended} min
          </dd>
        </div>
      </dl>

      {!registered ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs text-warning-strong">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Você ainda não tem inscrição confirmada neste evento. O crachá existe, mas o balcão pode
          precisar conferir a sua inscrição na organização.
        </p>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        <GenerateButton />
        <span className="text-xs text-muted-foreground">
          O código é sempre o mesmo — gerar de novo não invalida o que você já mostrou.
        </span>
      </form>

      {state_ ? (
        <p
          role={state_.ok ? 'status' : 'alert'}
          className={`text-xs ${state_.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {state_.message}
        </p>
      ) : null}

      {/**
       * O botão é sempre renderizado (e não atrás de um `typeof window`): o componente
       * também é renderizado no servidor, e condicionar o HTML ao ambiente produziria
       * divergência de hidratação.
       */}
      <button
        type="button"
        onClick={() => window.print()}
        data-testid="own-badge-print"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
      >
        <Printer className="size-3.5" aria-hidden />
        Imprimir esta tela
      </button>
    </section>
  );
}
