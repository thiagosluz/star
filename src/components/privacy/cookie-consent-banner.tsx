import Link from 'next/link';
import { Cookie, ShieldCheck } from 'lucide-react';

import { saveCookieConsentAction } from '@/app/actions/privacy-actions';
import { buttonClasses } from '@/components/ui/button';
import { FormStatusButton } from '@/components/ui/form-status-button';
import { shouldShowCookieBanner } from '@/domain/privacy/privacy-consent-rules';
import { readVisitorCookieConsent } from '@/lib/privacy/cookie-consent-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BANNER DE COOKIES — informativo, não-modal e funcional sem JS (FASE 110)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `<aside>` E `<form action>`, NUNCA MODAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um diálogo modal bloqueia a navegação de quem acabou de chegar — especialmente
 *  de quem usa leitor de tela ou teclado. O banner fica em `<aside>` discreto,
 *  com contraste AA, e usa o mesmo contrato `(formData: FormData) => Promise<void>`
 *  de `ThemeChoice` e `NavCollapseToggle`: funciona antes de o JavaScript carregar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function CookieConsentBanner() {
  const consent = await readVisitorCookieConsent();

  if (!shouldShowCookieBanner(consent)) {
    return null;
  }

  return (
    <aside
      aria-label="Preferências de cookies e privacidade"
      data-testid="cookie-consent-banner"
      className="sticky bottom-4 z-40 mx-auto my-4 w-[calc(100%-2rem)] max-w-4xl rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <Cookie className="size-4 text-primary" aria-hidden />
            Escolha como os cookies funcionam aqui
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Essenciais</strong> (sessão autenticada,
            contexto da instituição e 2FA) ficam sempre ativos para o sistema funcionar com
            segurança.{' '}
            <strong className="font-medium text-foreground">Preferências</strong> (tema visual{' '}
            <code>ef_tema</code> e barra lateral <code>ef_nav</code>) são opcionais — você decide
            de verdade.{' '}
            <Link
              href="/privacidade#cookies"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:text-primary"
              data-testid="cookie-banner-privacy-link"
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              Inventário em /privacidade
            </Link>
          </p>
        </div>

        <form
          action={saveCookieConsentAction}
          className="flex shrink-0 flex-wrap items-center gap-2"
        >
          <input type="hidden" name="source" value="banner" />
          <FormStatusButton
            name="choice"
            value="ESSENTIAL_ONLY"
            showSpinner
            pendingContent="Salvando…"
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
            data-testid="cookie-consent-essential"
          >
            Apenas essenciais
          </FormStatusButton>
          <FormStatusButton
            name="choice"
            value="ALL"
            showSpinner
            pendingContent="Salvando…"
            className={buttonClasses({ variant: 'primary', size: 'sm' })}
            data-testid="cookie-consent-all"
          >
            Aceitar preferências
          </FormStatusButton>
        </form>
      </div>
    </aside>
  );
}
