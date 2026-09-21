'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { BadgeCheck, Ban, Loader2, Printer, Users } from 'lucide-react';

import type { CredentialActionState } from '@/app/actions/credential-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ÁREA DE CRACHÁS (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA PRECISA RESOLVER, NA ORDEM DO BALCÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. "quem está inscrito?" — todos os inscritos no evento E nas atividades, com o
 *       que cada um pode frequentar;
 *    2. "quem ainda não tem crachá?" — é o que falta emitir (um clique emite todos);
 *    3. "quem já chegou?" — a situação de credenciamento, para o balcão conferir;
 *    4. "imprimir" — individual ou em massa (a folha A4 com QR, código e nome).
 *
 *  Emissão e impressão são atos DIFERENTES: emitir cria o código, imprimir registra
 *  que a etiqueta saiu. Quem reimprime uma folha perdida não deve gerar códigos novos
 *  — o crachá que está na mão de alguém continuaria valendo, e o novo o invalidaria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface RosterEntry {
  userId: string;
  name: string;
  email: string;
  /** Id do CRACHÁ — é ele que a revogação usa (o usuário é quem a tela lista). */
  credentialId: string | null;
  code: string | null;
  state: 'ACTIVE' | 'REVOKED' | null;
  legacy: boolean;
  printed: boolean;
  arrivedLabel: string | null;
  activities: string[];
  registrationStatus: string | null;
  attendedActivities: number;
  minutesAttended: number;
}

function EmitButton({ label, testId }: { label: string; testId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BadgeCheck className="size-4" aria-hidden />}
      {pending ? 'Emitindo…' : label}
    </button>
  );
}

export function BadgeRoster({
  entries,
  tenantSlug,
  eventId,
  missingCount,
  emitAction,
  revokeAction,
  pdfPath,
}: {
  entries: readonly RosterEntry[];
  tenantSlug: string;
  eventId: string;
  missingCount: number;
  emitAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
  revokeAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
  /** Endereço-base da folha de crachás (PDF); o evento e a seleção vão na query. */
  pdfPath: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emitState, emitFormAction] = useActionState<CredentialActionState | null, FormData>(emitAction, null);
  const [revokeState, revokeFormAction] = useActionState<CredentialActionState | null, FormData>(
    revokeAction,
    null,
  );
  const [revoking, setRevoking] = useState<string | null>(null);

  const toggle = (userId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  /**
   * A folha leva os crachás SELECIONADOS (ou todos os que têm código, quando nada
   * está marcado): imprimir 300 crachás porque ninguém desmarcou nada seria uma
   * resma de papel — e a tela diz quantos vão para a impressora antes do clique.
   */
  const selectedWithCode = entries.filter((entry) => selected.has(entry.userId) && entry.code !== null);
  const printableCount = selectedWithCode.length > 0 ? selectedWithCode.length : null;

  const withEvent = (extra: string) => `${pdfPath}?eventId=${eventId}${extra}`;

  const sheetHref =
    printableCount === null
      ? withEvent('')
      : withEvent(`&userIds=${selectedWithCode.map((entry) => entry.userId).join(',')}`);

  return (
    <div className="space-y-4" data-testid="badge-roster">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-low p-3">
        <form action={emitFormAction} data-testid="badge-emit-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          {[...selected].map((userId) => (
            <input key={userId} type="hidden" name="userIds" value={userId} />
          ))}
          <EmitButton
            label={
              selected.size > 0
                ? `Emitir crachá para ${selected.size} selecionado(s)`
                : `Emitir crachás que faltam (${missingCount})`
            }
            testId="badge-emit"
          />
        </form>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href={sheetHref}
            data-testid="badge-print"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-medium hover:bg-muted"
          >
            <Printer className="size-3.5" aria-hidden />
            {printableCount === null
              ? 'Imprimir a folha (todos com crachá)'
              : `Imprimir a folha (${printableCount} selecionado(s))`}
          </a>
          <span className="text-muted-foreground">
            Folha A4 com 8 crachás por página: QR Code, código e nome.
          </span>
        </div>
      </div>

      {emitState ? (
        <p
          role={emitState.ok ? 'status' : 'alert'}
          data-testid="badge-emit-feedback"
          className={`text-sm ${emitState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {emitState.message}
        </p>
      ) : null}

      {revokeState ? (
        <p
          role={revokeState.ok ? 'status' : 'alert'}
          data-testid="badge-revoke-feedback"
          className={`text-sm ${revokeState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {revokeState.message}
        </p>
      ) : null}

      <ul className="space-y-2" data-testid="badge-list">
        {entries.map((entry) => (
          <li
            key={entry.userId}
            data-testid={`badge-row-${entry.userId}`}
            data-has-credential={entry.code ? 'true' : 'false'}
            data-credential-state={entry.state ?? 'NONE'}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <label className="flex min-w-0 flex-1 items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={selected.has(entry.userId)}
                onChange={() => toggle(entry.userId)}
                aria-label={`Selecionar ${entry.name}`}
                data-testid={`badge-select-${entry.userId}`}
                className="mt-0.5 size-4"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block truncate font-medium">{entry.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{entry.email}</span>
                <span className="block text-xs text-muted-foreground">
                  {entry.activities.length > 0
                    ? entry.activities.join(' · ')
                    : 'Sem inscrição em atividade (crachá emitido à mão)'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {entry.arrivedLabel ? `Chegou às ${entry.arrivedLabel}` : 'Ainda não credenciado'}
                  {entry.attendedActivities > 0
                    ? ` · ${entry.attendedActivities} atividade(s) · ${entry.minutesAttended} min`
                    : ''}
                </span>
              </span>
            </label>

            <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
              {entry.code ? (
                <>
                  <span className="code-data" data-testid={`badge-code-${entry.userId}`}>
                    {entry.code}
                  </span>
                  <span
                    className={
                      entry.state === 'ACTIVE' ? 'text-success-strong' : 'text-destructive'
                    }
                    data-testid={`badge-state-${entry.userId}`}
                  >
                    {entry.state === 'ACTIVE' ? 'válido' : 'revogado'}
                    {entry.printed ? ' · impresso' : ''}
                    {entry.legacy ? ' · crachá anterior' : ''}
                  </span>

                  {entry.state === 'ACTIVE' ? (
                    revoking === entry.userId ? (
                      <form action={revokeFormAction} className="flex items-center gap-1">
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="credentialId" value={entry.credentialId ?? ''} />
                        <input
                          name="reason"
                          required
                          minLength={5}
                          maxLength={300}
                          placeholder="Motivo da revogação"
                          aria-label={`Motivo da revogação do crachá de ${entry.name}`}
                          className="w-48 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                        />
                        <button
                          type="submit"
                          data-testid={`badge-revoke-confirm-${entry.userId}`}
                          className="rounded-md border border-destructive/50 px-2 py-0.5 text-destructive"
                        >
                          Revogar
                        </button>
                        <button
                          type="button"
                          onClick={() => setRevoking(null)}
                          className="px-1 text-muted-foreground hover:underline"
                        >
                          cancelar
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevoking(entry.userId)}
                        data-testid={`badge-revoke-${entry.userId}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
                      >
                        <Ban className="size-3" aria-hidden />
                        Revogar
                      </button>
                    )
                  ) : null}

                  {entry.code ? (
                    <a
                      href={withEvent(`&userIds=${entry.userId}`)}
                      data-testid={`badge-print-one-${entry.userId}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
                    >
                      <Printer className="size-3" aria-hidden />
                      Imprimir
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground" data-testid={`badge-code-${entry.userId}`}>
                  sem crachá
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {entries.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden />
          Nenhum participante encontrado com este filtro. A lista reúne quem tem inscrição no evento ou em
          atividades, e quem já recebeu crachá.
        </p>
      ) : null}
    </div>
  );
}
