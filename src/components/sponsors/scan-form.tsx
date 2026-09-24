'use client';

import { useActionState } from 'react';

import { BadgeCheck, EyeOff, Gift, Loader2, Share2 } from 'lucide-react';

import type { SponsorPortalActionState } from '@/app/actions/sponsor-portal-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A ESCOLHA DA LEITURA (FASE 42) — o formulário mais importante da fase
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DOIS BOTÕES, O MESMO PRÊMIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Autorizar e registrar" e "Registrar sem compartilhar" mandam o MESMO crédito.
 *  A diferença é só o que o patrocinador recebe. Se o XP dependesse da
 *  autorização, o consentimento deixaria de ser livre (LGPD, art. 8º, §3º) — e o
 *  texto abaixo diz isso em uma frase, antes dos botões.
 *
 *  O resultado aparece no lugar (o crédito já aconteceu quando a resposta chega),
 *  e o formulário continua funcionando sem JavaScript: é um `<form>` normal com
 *  duas Server Actions.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SponsorScanForm({
  tenantSlug,
  code,
  xpAmount,
  cardName,
  consentText,
  alreadyScanned,
  action,
}: {
  tenantSlug: string;
  code: string;
  xpAmount: number;
  cardName: string | null;
  consentText: string;
  alreadyScanned: boolean;
  action: (
    prev: SponsorPortalActionState | null,
    formData: FormData,
  ) => Promise<SponsorPortalActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  if (state?.ok) {
    return (
      <div
        className="space-y-2 rounded-lg border border-success bg-success-soft p-4 text-sm text-success-strong"
        data-testid="scan-result"
      >
        <p className="flex items-start gap-2 font-medium">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.message}
        </p>
        {state.data?.shared === true ? (
          <p className="text-xs">
            Você pode revogar quando quiser em <strong>Meus compartilhamentos</strong>.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" data-testid="scan-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="code" value={code} />

      <div className="space-y-1 rounded-lg border border-border bg-surface-low p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          O que você recebe
        </p>
        <p className="flex items-center gap-2 text-sm">
          <Gift className="size-4 text-primary" aria-hidden />
          {xpAmount > 0 ? `${xpAmount} XP pela visita` : 'A visita registrada no seu histórico'}
          {cardName ? ` · carta "${cardName}"` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          O crédito é seu de qualquer forma, com ou sem compartilhamento.
        </p>
      </div>

      <div className="space-y-1 rounded-lg border border-border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Se você autorizar
        </p>
        <p className="text-sm" data-testid="consent-text">
          {consentText}
        </p>
        <p className="text-xs text-muted-foreground">
          Compartilhado: <strong>nome</strong> e <strong>e-mail</strong> da sua conta. Nada além disso.
        </p>
      </div>

      {alreadyScanned ? (
        <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          Você já registrou esta visita — o crédito não se repete, mas a sua escolha de compartilhar
          pode ser atualizada aqui.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="scan-error"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="consent"
          value="true"
          disabled={pending}
          data-testid="scan-consent"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Share2 className="size-4" aria-hidden />
          )}
          Autorizar e registrar
        </button>

        <button
          type="submit"
          name="consent"
          value="false"
          disabled={pending}
          data-testid="scan-no-consent"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          <EyeOff className="size-4" aria-hidden />
          Registrar sem compartilhar
        </button>
      </div>
    </form>
  );
}
