'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, ScanLine } from 'lucide-react';

import type { AdminActionState } from '@/app/actions/admin-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Credenciamento por crachá (leitor de QR Code)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LEITOR USB "DIGITA", E É ISSO QUE O CAMPO ESPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão, o equipamento real é um leitor que se comporta como teclado: lê o
 *  QR Code e digita o conteúdo no campo focado, terminando com Enter. Um campo de
 *  texto com `autoFocus` atende esse fluxo — e também o tablet sem câmera, e o
 *  crachá digitado à mão quando o leitor falha.
 *
 *  Um botão só: quem está no balcão com fila não lê duas opções.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function ScanButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="badge-checkin"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanLine className="size-4" aria-hidden />}
      {pending ? 'Registrando…' : 'Credenciar pelo crachá'}
    </button>
  );
}

export function BadgeCheckinForm({
  tenantSlug,
  action,
}: {
  tenantSlug: string;
  action: (prev: AdminActionState | null, formData: FormData) => Promise<AdminActionState>;
}) {
  const [state, formAction] = useActionState<AdminActionState | null, FormData>(action, null);

  /**
   * Conquista no balcão merece reação: o participante está ali, vendo a tela.
   * Carta nova ou XP alto disparam o confete (respeitando `prefers-reduced-motion`
   * dentro de `celebrate`).
   */
  useEffect(() => {
    if (!state?.ok) return;

    const cards = Array.isArray(state.data?.cards) ? state.data.cards.length : 0;
    const xp = Number(state.data?.xpAwarded ?? 0);

    if (cards > 0 || xp >= 150) celebrate({ intensity: 'medium' });
  }, [state]);

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-5"
      aria-labelledby="crachá"
      data-testid="badge-panel"
    >
      <header className="space-y-1">
        <h2 id="crachá" className="flex items-center gap-2 text-base font-semibold">
          <ScanLine className="size-4" aria-hidden />
          Credenciamento por crachá
        </h2>
        <p className="text-xs text-muted-foreground">
          Aponte o leitor para o QR Code do crachá (ou digite o código) e confirme. A presença é registrada na hora,
          com XP, cartas e progresso de missão.
        </p>
      </header>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <label className="space-y-1 text-xs font-medium">
          Código do crachá
          <input
            name="badgeToken"
            required
            autoFocus
            autoComplete="off"
            placeholder="BADGE-XXXXXXXX"
            aria-label="Código do crachá"
            data-testid="badge-token"
            className="block min-w-72 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </label>

        <ScanButton />
      </form>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid="badge-feedback"
          className={`text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
