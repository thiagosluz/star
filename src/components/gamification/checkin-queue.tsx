'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, LogIn, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { AttendanceActionState } from '@/app/actions/attendance-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de credenciamento — operação de balcão
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O BOTÃO É ÚNICO E O ESTADO É DERIVADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem já entrou vê "Registrar saída"; quem não entrou vê "Credenciar". Dois
 *  botões para a mesma linha seriam um convite a clicar no errado — no balcão,
 *  com fila, ninguém lê duas opções.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface QueueEntry {
  registrationId: string;
  userName: string;
  userEmail: string;
  activityTitle: string | null;
  isInside: boolean;
  checkedInAtLabel: string | null;
}

function ActionButton({ mode }: { mode: 'in' | 'out' }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={mode === 'in' ? 'checkin-button' : 'checkout-button'}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
        mode === 'in'
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border hover:bg-muted'
      }`}
    >
      {mode === 'in' ? (
        <LogIn className="size-3.5" aria-hidden />
      ) : (
        <LogOut className="size-3.5" aria-hidden />
      )}
      {pending ? 'Registrando…' : mode === 'in' ? 'Credenciar' : 'Registrar saída'}
    </button>
  );
}

function QueueRow({
  entry,
  tenantSlug,
  checkInAction,
  checkOutAction,
}: {
  entry: QueueEntry;
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
}) {
  const [inState, inAction] = useActionState<AttendanceActionState | null, FormData>(checkInAction, null);
  const [outState, outAction] = useActionState<AttendanceActionState | null, FormData>(checkOutAction, null);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  QUAL RESULTADO EXIBIR: O DA TRANSIÇÃO QUE ACABOU DE ACONTECER
   * ─────────────────────────────────────────────────────────────────────────────
   *  `inState ?? outState` parecia razoável e estava ERRADO: depois do primeiro
   *  check-in, o resultado da ENTRADA ficava gravado para sempre e o operador nunca
   *  via o resultado da SAÍDA — nem a mensagem de "presença insuficiente para
   *  pontuar", que é justamente a informação que ele precisa dar ao participante.
   *
   *  A escolha é derivada do ESTADO da linha (vindo do servidor após a
   *  revalidação): quem está dentro acabou de entrar; quem está fora acabou de
   *  sair. O `useActionState` não tem setter, então derivar é também a forma mais
   *  simples de manter os dois resultados em sincronia com a realidade.
   */
  const state = entry.isInside ? inState : outState;

  useEffect(() => {
    if (!state?.ok) return;
    const cards = Array.isArray(state.data?.cards) ? state.data.cards.length : 0;
    const xp = Number(state.data?.xpAwarded ?? 0);
    if (cards > 0 || xp >= 150) celebrate({ intensity: 'medium' });
  }, [state]);

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
      data-testid={`queue-${entry.registrationId}`}
      data-inside={entry.isInside ? 'true' : 'false'}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{entry.userName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.userEmail}
          {entry.activityTitle ? ` · ${entry.activityTitle}` : ' · evento'}
        </p>
        {entry.checkedInAtLabel ? (
          <p className="flex items-center gap-1 text-xs text-success-strong">
            <ShieldCheck className="size-3" aria-hidden />
            Entrada registrada às {entry.checkedInAtLabel}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <form action={entry.isInside ? outAction : inAction}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="registrationId" value={entry.registrationId} />
          <ActionButton mode={entry.isInside ? 'out' : 'in'} />
        </form>
      </div>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`w-full text-xs ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
          data-testid={`checkin-feedback-${entry.registrationId}`}
        >
          {state.ok ? (
            <span className="flex items-center gap-1.5">
              <Clock className="size-3" aria-hidden />
              {state.message}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-3" aria-hidden />
              {state.message}
            </span>
          )}
        </p>
      ) : null}
    </li>
  );
}

export function CheckinQueue({
  entries,
  tenantSlug,
  checkInAction,
  checkOutAction,
}: {
  entries: readonly QueueEntry[];
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
}) {
  if (entries.length === 0) {
    return (
      <p
        className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
        data-testid="queue-empty"
      >
        Nenhuma inscrição confirmada encontrada. Ajuste a busca ou verifique se o evento tem
        inscrições confirmadas.
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="checkin-queue">
      {entries.map((entry) => (
        <QueueRow
          key={entry.registrationId}
          entry={entry}
          tenantSlug={tenantSlug}
          checkInAction={checkInAction}
          checkOutAction={checkOutAction}
        />
      ))}
    </ul>
  );
}
