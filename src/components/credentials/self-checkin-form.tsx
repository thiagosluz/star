'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  ShieldCheck,
} from 'lucide-react';

import type { SelfCheckinActionState } from '@/app/actions/self-checkin-actions';
import { Alert, Badge, Button, Input, Label } from '@/components/ui';

type SubmitFn = (
  prev: SelfCheckinActionState | null,
  formData: FormData,
) => Promise<SelfCheckinActionState>;

function ActionButton({
  label,
  pendingLabel,
  mode,
  variant = 'primary',
  disabled = false,
  testId,
}: {
  label: string;
  pendingLabel: string;
  mode: 'IN' | 'OUT';
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  testId: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="mode"
      value={mode}
      variant={variant}
      disabled={pending || disabled}
      data-testid={testId}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : mode === 'OUT' ? (
        <LogOut className="size-4" aria-hidden />
      ) : (
        <CheckCircle2 className="size-4" aria-hidden />
      )}
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function SelfCheckinForm({
  tenantSlug,
  token,
  requireGeo,
  geoRadiusMeters,
  pinRequired,
  totpEnabled,
  hasOpenSession,
  openSessionCheckedInIso,
  closedMinutes,
  concurrentOpenActivityTitle,
  registered,
  allowUnregistered,
  hasArrivedAtEvent,
  requireEventArrivalBeforeActivity,
  isActivity,
  windowOk,
  windowReason,
  action,
}: {
  tenantSlug: string;
  token: string;
  requireGeo: boolean;
  geoRadiusMeters: number;
  pinRequired: boolean;
  totpEnabled: boolean;
  hasOpenSession: boolean;
  openSessionCheckedInIso: string | null;
  closedMinutes: number;
  concurrentOpenActivityTitle: string | null;
  registered: boolean;
  allowUnregistered: boolean;
  hasArrivedAtEvent: boolean;
  requireEventArrivalBeforeActivity: boolean;
  isActivity: boolean;
  windowOk: boolean;
  windowReason: string | null;
  action: SubmitFn;
}) {
  const [state, formAction] = useActionState<SelfCheckinActionState | null, FormData>(action, null);
  const [pinCode, setPinCode] = useState('');
  const [coords, setCoords] = useState<{
    latitude: string;
    longitude: string;
    accuracyMeters: string;
    status: 'idle' | 'loading' | 'ready' | 'denied' | 'unsupported';
    message: string | null;
  }>({
    latitude: '',
    longitude: '',
    accuracyMeters: '',
    status: requireGeo ? 'loading' : 'idle',
    message: requireGeo ? 'Obtendo localização (GPS) do dispositivo…' : null,
  });

  const requestGeo = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setCoords((prev) => ({
        ...prev,
        status: 'unsupported',
        message: 'Este dispositivo não oferece geolocalização pelo navegador.',
      }));
      return;
    }

    setCoords((prev) => ({
      ...prev,
      status: 'loading',
      message: 'Obtendo localização (GPS) do dispositivo…',
    }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
          accuracyMeters: String(Math.round(position.coords.accuracy)),
          status: 'ready',
          message: `Localização confirmada (precisão ~${Math.round(position.coords.accuracy)} m · limite ${geoRadiusMeters} m).`,
        });
      },
      (err) => {
        setCoords((prev) => ({
          ...prev,
          status: 'denied',
          message:
            err.code === 1
              ? 'Permissão de localização negada. Libere o GPS nas configurações do navegador e tente atualizar.'
              : 'Não foi possível obter sua localização agora. Tente em um local com melhor sinal.',
        }));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, [geoRadiusMeters]);

  useEffect(() => {
    if (requireGeo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- inicia leitura automática do GPS ao abrir pelo QR no celular
      requestGeo();
    }
  }, [requireGeo, requestGeo]);

  const outcomeAction = typeof state?.data?.action === 'string' ? state.data.action : null;
  const isNowInside =
    outcomeAction === 'CHECKED_IN' ||
    outcomeAction === 'ALREADY_INSIDE' ||
    (hasOpenSession && outcomeAction !== 'CHECKED_OUT');

  const needsPin = pinRequired || totpEnabled;
  const blockedByPrecheck =
    !windowOk ||
    (!registered && !allowUnregistered) ||
    (isActivity && requireEventArrivalBeforeActivity && !hasArrivedAtEvent) ||
    (!isNowInside && Boolean(concurrentOpenActivityTitle));

  return (
    <form action={formAction} className="space-y-4" data-testid="self-checkin-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="latitude" value={coords.latitude} />
      <input type="hidden" name="longitude" value={coords.longitude} />
      <input type="hidden" name="accuracyMeters" value={coords.accuracyMeters} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={registered ? 'success' : allowUnregistered ? 'warning' : 'danger'}>
          {registered
            ? 'Inscrição confirmada'
            : allowUnregistered
              ? 'Aberto sem inscrição prévia'
              : 'Sem inscrição confirmada'}
        </Badge>
        {closedMinutes > 0 ? (
          <Badge tone="info">{closedMinutes} min já computados</Badge>
        ) : null}
        {isNowInside && openSessionCheckedInIso ? (
          <Badge tone="success">
            Entrada aberta às{' '}
            <time dateTime={openSessionCheckedInIso} suppressHydrationWarning>
              {new Date(openSessionCheckedInIso).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </Badge>
        ) : null}
      </div>

      {!windowOk && windowReason ? (
        <Alert tone="warning" data-testid="self-checkin-window-alert">
          {windowReason}
        </Alert>
      ) : null}

      {isActivity && requireEventArrivalBeforeActivity && !hasArrivedAtEvent ? (
        <Alert tone="warning" data-testid="self-checkin-arrival-alert">
          Este evento exige credenciamento na portaria antes de registrar presença nas atividades.
        </Alert>
      ) : null}

      {!isNowInside && concurrentOpenActivityTitle ? (
        <Alert tone="warning" data-testid="self-checkin-ubiquity-alert">
          Você está com presença aberta em <strong>{concurrentOpenActivityTitle}</strong>. Registre
          a saída lá antes de entrar aqui.
        </Alert>
      ) : null}

      {requireGeo ? (
        <div
          className="space-y-2 rounded-lg border border-border bg-surface-low p-3 text-xs"
          data-testid="self-checkin-geo-box"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <MapPin className="size-3.5 text-primary" aria-hidden />
              Verificação por localização (GPS)
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={requestGeo}
              data-testid="self-checkin-refresh-geo"
            >
              <Compass className="size-3.5" aria-hidden />
              Atualizar GPS
            </Button>
          </div>
          <p className="text-muted-foreground" data-testid="self-checkin-geo-status">
            {coords.message}
          </p>
        </div>
      ) : null}

      {needsPin ? (
        <div className="space-y-1.5">
          <Label htmlFor="pinCode" className="flex items-center gap-1.5">
            {totpEnabled ? (
              <ShieldCheck className="size-4 text-primary" aria-hidden />
            ) : (
              <Lock className="size-4 text-primary" aria-hidden />
            )}
            {totpEnabled
              ? 'Código de verificação da sala (6 dígitos do telão ou PIN)'
              : 'Código de verificação da sala (PIN de 4 dígitos)'}
          </Label>
          <Input
            id="pinCode"
            name="pinCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={pinCode}
            onChange={(e) => setPinCode(e.target.value)}
            placeholder={totpEnabled ? 'Ex.: 482910' : 'Ex.: 4829'}
            data-testid="self-checkin-pin-input"
          />
        </div>
      ) : null}

      {state ? (
        <Alert
          tone={state.ok ? 'success' : 'danger'}
          data-testid="self-checkin-feedback"
        >
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 font-medium">
              {state.ok ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="size-4 shrink-0" aria-hidden />
              )}
              {state.message}
            </p>
            {typeof state.data?.distanceMeters === 'number' ? (
              <p className="text-xs opacity-85">
                Distância medida até o local: {state.data.distanceMeters} m
              </p>
            ) : null}
            {state.details?.length ? (
              <ul className="list-disc pl-4 text-xs">
                {state.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!isNowInside ? (
          <ActionButton
            mode="IN"
            label="Confirmar minha presença (Entrada)"
            pendingLabel="Confirmando…"
            disabled={blockedByPrecheck || (requireGeo && coords.status === 'loading')}
            testId="self-checkin-submit-in"
          />
        ) : (
          <ActionButton
            mode="OUT"
            variant="secondary"
            label="Registrar minha saída"
            pendingLabel="Registrando saída…"
            disabled={!windowOk || (requireGeo && coords.status === 'loading')}
            testId="self-checkin-submit-out"
          />
        )}
      </div>
    </form>
  );
}
