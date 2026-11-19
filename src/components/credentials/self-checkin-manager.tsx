'use client';

import { useActionState, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Compass,
  Copy,
  ExternalLink,
  Lock,
  MonitorPlay,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';

import type { SelfCheckinActionState } from '@/app/actions/self-checkin-actions';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type {
  SelfCheckinActivityRow,
  SelfCheckinConsoleData,
  SelfCheckinPointSummary,
} from '@/lib/events/self-checkin-service';
import { Alert, AppLink, Badge, Button, ConfirmDialog, Input, Label, SubmitButton as UiSubmitButton } from '@/components/ui';
import { tenantPath } from '@/domain/tenancy/resolution';
import { describeSelfCheckinPolicySummary } from '@/domain/events/checkin-console-rules';
import {
  MAX_CHECKOUT_COOLDOWN_MINUTES,
  MAX_GEO_ACCURACY_METERS,
  MAX_GEO_RADIUS_METERS,
  MIN_CHECKOUT_COOLDOWN_MINUTES,
  MIN_GEO_ACCURACY_METERS,
  MIN_GEO_RADIUS_METERS,
} from '@/domain/events/self-checkin-rules';

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

type ActionFn = (
  prev: SelfCheckinActionState | null,
  formData: FormData,
) => Promise<SelfCheckinActionState>;

function SubmitButton({
  label,
  pendingLabel,
  testId,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  testId?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return (
    <UiSubmitButton
      label={label}
      pendingLabel={pendingLabel}
      variant={variant}
      size="sm"
      showSpinner={false}
      data-testid={testId}
    />
  );
}

function PointRow({
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
    <div
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid={`self-checkin-row-${rowKey}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {point ? (
              <Badge tone={point.isActive ? 'success' : 'warning'}>
                {point.isActive ? 'Ativo' : 'Pausado'}
              </Badge>
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
              <SubmitButton
                label="Gerar QR Code"
                pendingLabel="Gerando…"
                testId={`self-checkin-generate-${rowKey}`}
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
                onClick={() => void handleCopyLink(point.token)}
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
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              data-testid={`self-checkin-toggle-${rowKey}`}
            >
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
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                data-testid={`self-checkin-pin-rotate-${rowKey}`}
              >
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
                  const form = document.getElementById(
                    `regen-form-${point.id}`,
                  ) as HTMLFormElement | null;
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
          {feedback.ok ? (
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <XCircle className="size-3.5 shrink-0" aria-hidden />
          )}
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

export function SelfCheckinManager({
  tenantSlug,
  data,
  eventTimeZone = 'America/Sao_Paulo',
  canManageSecurity,
  savePolicyAction,
  upsertPointAction,
  regeneratePointAction,
  deletePointAction,
}: {
  tenantSlug: string;
  data: SelfCheckinConsoleData;
  eventTimeZone?: string;
  canManageSecurity: boolean;
  savePolicyAction: ActionFn;
  upsertPointAction: ActionFn;
  regeneratePointAction: ActionFn;
  deletePointAction: ActionFn;
}) {
  const [policyState, policyFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    savePolicyAction,
    null,
  );

  const [enabled, setEnabled] = useState(data.policy.enabled);
  const [requireGeo, setRequireGeo] = useState(data.policy.requireGeo);
  const [latitude, setLatitude] = useState(
    data.latitude !== null ? String(data.latitude) : '',
  );
  const [longitude, setLongitude] = useState(
    data.longitude !== null ? String(data.longitude) : '',
  );
  const [geoRadiusMeters, setGeoRadiusMeters] = useState(String(data.policy.geoRadiusMeters));
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState(String(data.policy.maxAccuracyMeters));
  const [checkoutCooldownMinutes, setCheckoutCooldownMinutes] = useState(
    String(data.policy.checkoutCooldownMinutes),
  );
  const [blockConcurrentActivity, setBlockConcurrentActivity] = useState(
    data.policy.blockConcurrentActivity,
  );
  const [requireEventArrivalBeforeActivity, setRequireEventArrivalBeforeActivity] = useState(
    data.policy.requireEventArrivalBeforeActivity,
  );
  const [allowUnregistered, setAllowUnregistered] = useState(data.policy.allowUnregistered);
  const [geoCaptureStatus, setGeoCaptureStatus] = useState<string | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [onlyWithQr, setOnlyWithQr] = useState(false);

  const hasSavedCoordinates = data.latitude !== null && data.longitude !== null;
  const shouldDefaultOpenPolicy = !data.policy.enabled || !hasSavedCoordinates;
  const [policyOpen, setPolicyOpen] = useState(shouldDefaultOpenPolicy);
  const policySummary = describeSelfCheckinPolicySummary({
    enabled,
    hasEventCoordinates: Boolean(latitude.trim() && longitude.trim()),
    requireGeo,
    geoRadiusMeters: Number(geoRadiusMeters) || data.policy.geoRadiusMeters,
    blockConcurrentActivity,
    requireEventArrivalBeforeActivity,
  });

  const normalizedFilter = activitySearch.trim().toLowerCase();
  const filteredActivities = data.activities.filter((act) => {
    if (onlyWithQr && !act.point) return false;
    if (!normalizedFilter) return true;
    const haystack = `${act.title} ${act.roomName ?? ''}`.toLowerCase();
    return haystack.includes(normalizedFilter);
  });
  const showPortaria =
    (!onlyWithQr || Boolean(data.portariaPoint)) &&
    (!normalizedFilter || 'portaria entrada geral'.includes(normalizedFilter));

  function captureCurrentLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoCaptureStatus('Seu navegador não suporta geolocalização.');
      return;
    }

    setGeoCaptureStatus('Obtendo coordenadas do dispositivo…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setGeoCaptureStatus(
          `Coordenadas preenchidas (precisão ~${Math.round(position.coords.accuracy)} m). Salve a política para aplicar.`,
        );
      },
      (err) => {
        setGeoCaptureStatus(
          err.code === 1
            ? 'Permissão de localização negada. Autorize o GPS no navegador ou digite latitude/longitude.'
            : 'Não foi possível capturar a localização agora.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  return (
    <section
      className="space-y-6 rounded-xl border border-border bg-surface-low p-5"
      aria-labelledby="autocredenciamento"
      data-testid="self-checkin-manager"
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="autocredenciamento" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <QrCode className="size-5 text-primary" aria-hidden />
            Check-in autônomo e cartazes por QR Code
          </h2>
          <Badge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? 'Autocredenciamento ativo' : 'Desativado'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Gere QR Codes para imprimir e fixar na portaria ou projetar no telão das salas. O próprio
          participante lê o cartaz com o celular e passa pelas travas de localização (GPS), PIN de
          sala, código rotativo de 60 s e anti-ubiquidade.
        </p>
      </header>

      {canManageSecurity ? (
        <div className="space-y-3">
          <details
            open={policyOpen}
            onToggle={(e) => setPolicyOpen(e.currentTarget.open)}
            className="group rounded-lg border border-border bg-card"
            data-testid="self-checkin-policy-details"
          >
          <summary
            data-testid="self-checkin-policy-toggle"
            className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-foreground marker:hidden"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              Política antifraude e geolocalização
            </span>
            <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <span data-testid="self-checkin-policy-summary">{policySummary}</span>
              <ChevronDown
                className="size-4 shrink-0 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </span>
          </summary>

          <form
            action={policyFormAction}
            className="space-y-4 border-t border-border/60 p-4"
            data-testid="self-checkin-policy-form"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={data.eventId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                name="enabled"
                value="true"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                data-testid="self-checkin-policy-enabled"
                className="mt-0.5 size-4 rounded border-border"
              />
              <span>
                <strong className="font-medium">Permitir autoatendimento por QR Code</strong>
                <span className="block text-muted-foreground">
                  Chave geral dos QR Codes de portaria e atividades.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                name="requireGeo"
                value="true"
                checked={requireGeo}
                onChange={(e) => setRequireGeo(e.target.checked)}
                data-testid="self-checkin-policy-require-geo"
                className="mt-0.5 size-4 rounded border-border"
              />
              <span>
                <strong className="font-medium">Exigir geolocalização (GPS) no local</strong>
                <span className="block text-muted-foreground">
                  Recusa leituras fora do raio configurado ou com precisão degradada por IP.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                name="blockConcurrentActivity"
                value="true"
                checked={blockConcurrentActivity}
                onChange={(e) => setBlockConcurrentActivity(e.target.checked)}
                data-testid="self-checkin-policy-anti-ubiquity"
                className="mt-0.5 size-4 rounded border-border"
              />
              <span>
                <strong className="font-medium">Trava anti-ubiquidade entre salas</strong>
                <span className="block text-muted-foreground">
                  Impede abrir presença em duas atividades simultaneamente sem registrar saída.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                name="requireEventArrivalBeforeActivity"
                value="true"
                checked={requireEventArrivalBeforeActivity}
                onChange={(e) => setRequireEventArrivalBeforeActivity(e.target.checked)}
                data-testid="self-checkin-policy-require-arrival"
                className="mt-0.5 size-4 rounded border-border"
              />
              <span>
                <strong className="font-medium">Exigir chegada prévia na portaria</strong>
                <span className="block text-muted-foreground">
                  Só aceita autocheck-in em salas após registro na portaria.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-foreground sm:col-span-2">
              <input
                type="checkbox"
                name="allowUnregistered"
                value="true"
                checked={allowUnregistered}
                onChange={(e) => setAllowUnregistered(e.target.checked)}
                data-testid="self-checkin-policy-allow-unregistered"
                className="mt-0.5 size-4 rounded border-border"
              />
              <span>
                <strong className="font-medium">
                  Permitir autocheck-in sem inscrição prévia (modo aberto)
                </strong>
                <span className="block text-muted-foreground">
                  Desmarcado por padrão: exige inscrição confirmada na portaria ou atividade.
                </span>
              </span>
            </label>
          </div>

          <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="sc-latitude">Latitude do local</Label>
              <Input
                id="sc-latitude"
                name="latitude"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="-12.999900"
                data-testid="self-checkin-latitude"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sc-longitude">Longitude do local</Label>
              <Input
                id="sc-longitude"
                name="longitude"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-38.510800"
                data-testid="self-checkin-longitude"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sc-radius">Raio permitido (m)</Label>
              <Input
                id="sc-radius"
                name="geoRadiusMeters"
                type="number"
                min={MIN_GEO_RADIUS_METERS}
                max={MAX_GEO_RADIUS_METERS}
                value={geoRadiusMeters}
                onChange={(e) => setGeoRadiusMeters(e.target.value)}
                data-testid="self-checkin-radius"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sc-accuracy">Precisão máx. GPS (m)</Label>
              <Input
                id="sc-accuracy"
                name="maxAccuracyMeters"
                type="number"
                min={MIN_GEO_ACCURACY_METERS}
                max={MAX_GEO_ACCURACY_METERS}
                value={maxAccuracyMeters}
                onChange={(e) => setMaxAccuracyMeters(e.target.value)}
                data-testid="self-checkin-max-accuracy"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sc-cooldown">Cooldown saída (min)</Label>
              <Input
                id="sc-cooldown"
                name="checkoutCooldownMinutes"
                type="number"
                min={MIN_CHECKOUT_COOLDOWN_MINUTES}
                max={MAX_CHECKOUT_COOLDOWN_MINUTES}
                value={checkoutCooldownMinutes}
                onChange={(e) => setCheckoutCooldownMinutes(e.target.value)}
                data-testid="self-checkin-cooldown"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={captureCurrentLocation}
              data-testid="self-checkin-use-location"
            >
              <Compass className="size-3.5" aria-hidden />
              Usar minha localização atual
            </Button>

            <SubmitButton
              label="Salvar política antifraude"
              pendingLabel="Salvando…"
              testId="self-checkin-policy-save"
            />
          </div>

            {geoCaptureStatus ? (
              <p className="text-xs text-muted-foreground" data-testid="self-checkin-geo-capture-status">
                {geoCaptureStatus}
              </p>
            ) : null}
          </form>
        </details>

        {policyState ? (
          <Alert
            tone={policyState.ok ? 'success' : 'danger'}
            data-testid="self-checkin-policy-feedback"
          >
            {policyState.message}
          </Alert>
        ) : null}
      </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card px-3 py-2.5">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={activitySearch}
              onChange={(e) => setActivitySearch(e.target.value)}
              placeholder="Filtrar por sala ou nome da atividade…"
              aria-label="Filtrar pontos de QR"
              data-testid="self-checkin-activity-filter"
              className="pl-8 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyWithQr}
              onChange={(e) => setOnlyWithQr(e.target.checked)}
              data-testid="self-checkin-only-generated"
              className="size-3.5 rounded border-border"
            />
            Somente com QR gerado
          </label>
        </div>

        {showPortaria ? (
          <PointRow
            tenantSlug={tenantSlug}
            eventId={data.eventId}
            eventTimeZone={eventTimeZone}
            activity={null}
            point={data.portariaPoint}
            selfDeclaredCount={data.portariaSelfDeclaredCount}
            canManageSecurity={canManageSecurity}
            upsertAction={upsertPointAction}
            regenerateAction={regeneratePointAction}
            deleteAction={deletePointAction}
          />
        ) : null}

        {filteredActivities.map((activity) => (
          <PointRow
            key={activity.activityId}
            tenantSlug={tenantSlug}
            eventId={data.eventId}
            eventTimeZone={eventTimeZone}
            activity={activity}
            point={activity.point}
            selfDeclaredCount={activity.selfDeclaredCount}
            canManageSecurity={canManageSecurity}
            upsertAction={upsertPointAction}
            regenerateAction={regeneratePointAction}
            deleteAction={deletePointAction}
          />
        ))}

        {!showPortaria && filteredActivities.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
            Nenhum ponto corresponde ao filtro aplicado.
          </p>
        ) : null}
      </div>
    </section>
  );
}
