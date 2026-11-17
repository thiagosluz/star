'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CheckCircle2,
  Compass,
  ExternalLink,
  Lock,
  MonitorPlay,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import type { SelfCheckinActionState } from '@/app/actions/self-checkin-actions';
import type {
  SelfCheckinActivityRow,
  SelfCheckinConsoleData,
  SelfCheckinPointSummary,
} from '@/lib/events/self-checkin-service';
import { Alert, AppLink, Badge, Button, ConfirmDialog, Input, Label } from '@/components/ui';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  MAX_CHECKOUT_COOLDOWN_MINUTES,
  MAX_GEO_ACCURACY_METERS,
  MAX_GEO_RADIUS_METERS,
  MIN_CHECKOUT_COOLDOWN_MINUTES,
  MIN_GEO_ACCURACY_METERS,
  MIN_GEO_RADIUS_METERS,
} from '@/domain/events/self-checkin-rules';

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
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending} data-testid={testId}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function PointRow({
  tenantSlug,
  eventId,
  activity,
  point,
  selfDeclaredCount,
  canManageSecurity,
  upsertAction,
  regenerateAction,
}: {
  tenantSlug: string;
  eventId: string;
  activity: SelfCheckinActivityRow | null;
  point: SelfCheckinPointSummary | null;
  selfDeclaredCount: number;
  canManageSecurity: boolean;
  upsertAction: ActionFn;
  regenerateAction: ActionFn;
}) {
  const [state, upsertFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    upsertAction,
    null,
  );
  const [regenState, regenFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    regenerateAction,
    null,
  );
  const [regenOpen, setRegenOpen] = useState(false);

  const rowKey = activity ? activity.activityId : 'portaria';
  const title = activity ? activity.title : 'Portaria e entrada geral';
  const subtitle = activity
    ? `${activity.roomName ? `${activity.roomName} · ` : ''}${new Date(activity.startsAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : 'Registra a chegada do participante ao local do evento';

  const feedback = regenState ?? state;

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
          <p className="text-xs text-muted-foreground">
            {subtitle} · {selfDeclaredCount} registro(s) via autocheck-in
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

              <AppLink
                href={tenantPath(tenantSlug, `/credenciamento/telao/${point.id}`)}
                data-testid={`self-checkin-telao-${rowKey}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                <MonitorPlay className="size-3.5" aria-hidden />
                Modo telão
              </AppLink>

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
  canManageSecurity,
  savePolicyAction,
  upsertPointAction,
  regeneratePointAction,
}: {
  tenantSlug: string;
  data: SelfCheckinConsoleData;
  canManageSecurity: boolean;
  savePolicyAction: ActionFn;
  upsertPointAction: ActionFn;
  regeneratePointAction: ActionFn;
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
        <form
          action={policyFormAction}
          className="space-y-4 rounded-lg border border-border bg-card p-4"
          data-testid="self-checkin-policy-form"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={data.eventId} />

          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            Política antifraude e geolocalização do evento
          </div>

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

          {policyState ? (
            <Alert
              tone={policyState.ok ? 'success' : 'danger'}
              data-testid="self-checkin-policy-feedback"
            >
              {policyState.message}
            </Alert>
          ) : null}
        </form>
      ) : null}

      <div className="space-y-3">
        <PointRow
          tenantSlug={tenantSlug}
          eventId={data.eventId}
          activity={null}
          point={data.portariaPoint}
          selfDeclaredCount={data.portariaSelfDeclaredCount}
          canManageSecurity={canManageSecurity}
          upsertAction={upsertPointAction}
          regenerateAction={regeneratePointAction}
        />

        {data.activities.map((activity) => (
          <PointRow
            key={activity.activityId}
            tenantSlug={tenantSlug}
            eventId={data.eventId}
            activity={activity}
            point={activity.point}
            selfDeclaredCount={activity.selfDeclaredCount}
            canManageSecurity={canManageSecurity}
            upsertAction={upsertPointAction}
            regenerateAction={regeneratePointAction}
          />
        ))}
      </div>
    </section>
  );
}
