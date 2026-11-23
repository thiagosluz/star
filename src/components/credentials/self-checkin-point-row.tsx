'use client';

import { useActionState, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  MonitorPlay,
  Printer,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';

import type { SelfCheckinActionState } from '@/app/actions/self-checkin-actions';
import { AppLink, Badge, Button, ConfirmDialog, SubmitButton as UiSubmitButton } from '@/components/ui';
import { tenantPath } from '@/domain/tenancy/resolution';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { SelfCheckinActivityRow, SelfCheckinPointSummary } from '@/lib/events/self-checkin-service';

type ActionFn = (
  prev: SelfCheckinActionState | null,
  formData: FormData,
) => Promise<SelfCheckinActionState>;

function formatActivityStart(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }
}

/** Linha operacional de um ponto QR de autocheck-in (Portaria ou Atividade). */
export function SelfCheckinPointRow({
  tenantSlug,
  eventId,
  eventTimeZone,
  activity,
  point,
  selfDeclaredCount,
  canManageSecurity,
  upsertAction,
  regenerateAction,
  deleteAction,
}: {
  tenantSlug: string;
  eventId: string;
  eventTimeZone: string;
  activity: SelfCheckinActivityRow | null;
  point: SelfCheckinPointSummary | null;
  selfDeclaredCount: number;
  canManageSecurity: boolean;
  upsertAction: ActionFn;
  regenerateAction: ActionFn;
  deleteAction: ActionFn;
}) {
  const [lastActionKind, setLastActionKind] = useState<'upsert' | 'regen' | 'delete'>('upsert');
  const [state, upsertFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    async (prev, formData) => {
      setLastActionKind('upsert');
      return upsertAction(prev, formData);
    },
    null,
  );
  const [regenState, regenFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    async (prev, formData) => {
      setLastActionKind('regen');
      return regenerateAction(prev, formData);
    },
    null,
  );
  const [deleteState, deleteFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    async (prev, formData) => {
      setLastActionKind('delete');
      return deleteAction(prev, formData);
    },
    null,
  );
  const [regenOpen, setRegenOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { isCopied, copy } = useCopyToClipboard(2_000);
  const copied = isCopied();
  const deleteFormRef = useRef<HTMLFormElement | null>(null);

  const rowKey = activity ? activity.activityId : 'portaria';
  const title = activity ? activity.title : 'Portaria e entrada geral';
  const formattedStart = activity ? formatActivityStart(activity.startsAt, eventTimeZone) : null;

  const feedback =
    lastActionKind === 'delete'
      ? (deleteState ?? regenState ?? state)
      : lastActionKind === 'regen'
        ? (regenState ?? state ?? deleteState)
        : (state ?? regenState ?? deleteState);

  function handleCopyLink(token: string) {
    const path = tenantPath(tenantSlug, `/presenca/${token}`);
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
    void copy(url);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid={`self-checkin-row-${rowKey}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {point ? (
              <Badge tone={point.isActive ? 'success' : 'warning'}>{point.isActive ? 'Ativo' : 'Pausado'}</Badge>
            ) : (
              <Badge tone="neutral">QR não gerado</Badge>
            )}
            {point ? (
              <span className="code-data rounded border border-border bg-surface-low px-2 py-0.5 text-xs text-muted-foreground">
                {point.token}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            {activity
              ? `${activity.roomName ? `${activity.roomName} · ` : ''}${formattedStart ?? ''}`
              : 'Registra a chegada do participante ao local'}{' '}
            · {selfDeclaredCount} registro(s) via autocheck-in
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!point ? (
            <form action={upsertFormAction}>
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              {activity ? <input type="hidden" name="activityId" value={activity.activityId} /> : null}
              <input type="hidden" name="isActive" value="true" />
              <UiSubmitButton
                label="Gerar QR Code"
                pendingLabel="Gerando…"
                variant="primary"
                size="sm"
                showSpinner={false}
                data-testid={`self-checkin-generate-${rowKey}`}
              />
            </form>
          ) : (
            <>
              <a
                href={`/api/t/${tenantSlug}/credenciamento/cartaz?pointId=${point.id}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`self-checkin-print-${rowKey}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                <Printer className="size-3.5" aria-hidden />
                Cartaz PDF
              </a>

              {point.pinRequired ? (
                <a
                  href={`/api/t/${tenantSlug}/credenciamento/cartaz?pointId=${point.id}&incluirPin=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`self-checkin-print-pin-${rowKey}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
                >
                  <Printer className="size-3.5" aria-hidden />
                  Cartaz com PIN
                </a>
              ) : null}

              <AppLink
                href={tenantPath(tenantSlug, `/credenciamento/telao/${point.id}`)}
                data-testid={`self-checkin-telao-${rowKey}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                <MonitorPlay className="size-3.5" aria-hidden />
                Modo telão
              </AppLink>

              <button
                type="button"
                onClick={() => handleCopyLink(point.token)}
                data-testid={`self-checkin-copy-${rowKey}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                {copied ? <Check className="size-3.5 text-success-strong" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {copied ? 'Copiado!' : 'Copiar link'}
              </button>

              <AppLink
                href={tenantPath(tenantSlug, `/presenca/${point.token}`)}
                data-testid={`self-checkin-public-link-${rowKey}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Abrir página
              </AppLink>
            </>
          )}
        </div>
      </div>

      {point ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
          <form action={upsertFormAction} className="inline-flex items-center">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            {activity ? <input type="hidden" name="activityId" value={activity.activityId} /> : null}
            <input type="hidden" name="isActive" value={point.isActive ? 'false' : 'true'} />
            <Button type="submit" variant="secondary" size="sm" data-testid={`self-checkin-toggle-${rowKey}`}>
              {point.isActive ? 'Pausar ponto' : 'Reativar ponto'}
            </Button>
          </form>

          <form action={upsertFormAction} className="inline-flex items-center">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            {activity ? <input type="hidden" name="activityId" value={activity.activityId} /> : null}
            <input type="hidden" name="pinRequired" value={point.pinRequired ? 'false' : 'true'} />
            <Button
              type="submit"
              variant={point.pinRequired ? 'primary' : 'secondary'}
              size="sm"
              data-testid={`self-checkin-pin-toggle-${rowKey}`}
            >
              <Lock className="size-3.5" aria-hidden />
              {point.pinRequired ? `PIN ativo: ${point.pinCode ?? '—'}` : 'Exigir PIN da sala'}
            </Button>
          </form>

          {point.pinRequired ? (
            <form action={upsertFormAction} className="inline-flex items-center">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              {activity ? <input type="hidden" name="activityId" value={activity.activityId} /> : null}
              <input type="hidden" name="rotatePin" value="true" />
              <Button type="submit" variant="ghost" size="sm" data-testid={`self-checkin-pin-rotate-${rowKey}`}>
                <RefreshCw className="size-3.5" aria-hidden />
                Trocar PIN
              </Button>
            </form>
          ) : null}

          <form action={upsertFormAction} className="inline-flex items-center">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            {activity ? <input type="hidden" name="activityId" value={activity.activityId} /> : null}
            <input type="hidden" name="totpEnabled" value={point.totpEnabled ? 'false' : 'true'} />
            <Button
              type="submit"
              variant={point.totpEnabled ? 'primary' : 'secondary'}
              size="sm"
              data-testid={`self-checkin-totp-toggle-${rowKey}`}
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              {point.totpEnabled ? 'Telão dinâmico (60s): ativo' : 'Ativar código dinâmico (60s)'}
            </Button>
          </form>

          {canManageSecurity ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={`self-checkin-regen-open-${rowKey}`}
                onClick={() => setRegenOpen(true)}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Regenerar QR
              </Button>

              <ConfirmDialog
                open={regenOpen}
                onCancel={() => setRegenOpen(false)}
                title="Regenerar QR Code deste ponto?"
                description="O código atual será revogado imediatamente e qualquer cartaz já impresso deixará de registrar presença."
                confirmLabel="Sim, regenerar QR"
                tone="danger"
                testId={`self-checkin-regen-${rowKey}`}
                onConfirm={() => {
                  const form = document.getElementById(`regen-form-${point.id}`) as HTMLFormElement | null;
                  form?.requestSubmit();
                  setRegenOpen(false);
                }}
              />
              <form id={`regen-form-${point.id}`} action={regenFormAction} className="hidden">
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="pointId" value={point.id} />
              </form>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid={`self-checkin-delete-open-${rowKey}`}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Excluir QR
              </Button>

              <ConfirmDialog
                open={deleteOpen}
                onCancel={() => setDeleteOpen(false)}
                title="Excluir QR Code deste ponto?"
                description="O código atual será revogado imediatamente, os cartazes já impressos deixarão de funcionar e o ponto voltará ao estado inicial de QR não gerado."
                confirmLabel="Sim, excluir QR Code"
                tone="danger"
                testId={`self-checkin-delete-${rowKey}`}
                onConfirm={() => {
                  deleteFormRef.current?.requestSubmit();
                  setDeleteOpen(false);
                }}
              />
              <form ref={deleteFormRef} action={deleteFormAction} className="inline-flex items-center">
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="pointId" value={point.id} />
                <noscript>
                  <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                    <Trash2 className="size-3.5" aria-hidden />
                    Excluir QR
                  </Button>
                </noscript>
              </form>
            </>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <p
          role={feedback.ok ? 'status' : 'alert'}
          className={`flex items-center gap-1.5 text-xs font-medium ${
            feedback.ok ? 'text-success-strong' : 'text-destructive'
          }`}
          data-testid={`self-checkin-row-feedback-${rowKey}`}
        >
          {feedback.ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <XCircle className="size-3.5 shrink-0" aria-hidden />}
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
