'use client';

import { useActionState, useState } from 'react';
import { ChevronDown, Compass, ShieldCheck } from 'lucide-react';

import type { SelfCheckinActionState } from '@/app/actions/self-checkin-actions';
import { Alert, Button, Input, Label, SubmitButton as UiSubmitButton } from '@/components/ui';
import { describeSelfCheckinPolicySummary } from '@/domain/events/checkin-console-rules';
import {
  MAX_CHECKOUT_COOLDOWN_MINUTES,
  MAX_GEO_ACCURACY_METERS,
  MAX_GEO_RADIUS_METERS,
  MIN_CHECKOUT_COOLDOWN_MINUTES,
  MIN_GEO_ACCURACY_METERS,
  MIN_GEO_RADIUS_METERS,
} from '@/domain/events/self-checkin-rules';
import type { SelfCheckinConsoleData } from '@/lib/events/self-checkin-service';

type ActionFn = (
  prev: SelfCheckinActionState | null,
  formData: FormData,
) => Promise<SelfCheckinActionState>;

/** Política antifraude, captura de coordenadas GPS e controles de acesso autônomo por QR. */
export function SelfCheckinPolicyForm({
  tenantSlug,
  data,
  enabled,
  onEnabledChange,
  savePolicyAction,
}: {
  tenantSlug: string;
  data: SelfCheckinConsoleData;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  savePolicyAction: ActionFn;
}) {
  const [policyState, policyFormAction] = useActionState<SelfCheckinActionState | null, FormData>(
    savePolicyAction,
    null,
  );

  const [requireGeo, setRequireGeo] = useState(data.policy.requireGeo);
  const [latitude, setLatitude] = useState(data.latitude !== null ? String(data.latitude) : '');
  const [longitude, setLongitude] = useState(data.longitude !== null ? String(data.longitude) : '');
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
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
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
                onChange={(e) => onEnabledChange(e.target.checked)}
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
                <strong className="font-medium">Permitir autocheck-in sem inscrição prévia (modo aberto)</strong>
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

            <UiSubmitButton
              label="Salvar política antifraude"
              pendingLabel="Salvando…"
              variant="primary"
              size="sm"
              showSpinner={false}
              data-testid="self-checkin-policy-save"
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
        <Alert tone={policyState.ok ? 'success' : 'danger'} data-testid="self-checkin-policy-feedback">
          {policyState.message}
        </Alert>
      ) : null}
    </div>
  );
}
