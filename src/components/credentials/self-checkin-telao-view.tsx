'use client';

import { useEffect, useState } from 'react';
import { Clock, Lock, MapPin, Printer, RefreshCw, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui';

interface TotpWindowState {
  code: string;
  remainingSeconds: number;
  periodSeconds: number;
}

export function SelfCheckinTelaoView({
  tenantSlug,
  pointId,
  qrDataUrl,
  publicUrl,
  initialToken,
  initialIsActive,
  initialPinRequired,
  initialPinCode,
  initialTotpEnabled,
  initialTotpWindow,
  requireGeo,
  geoRadiusMeters,
}: {
  tenantSlug: string;
  pointId: string;
  qrDataUrl: string;
  publicUrl: string;
  initialToken: string;
  initialIsActive: boolean;
  initialPinRequired: boolean;
  initialPinCode: string | null;
  initialTotpEnabled: boolean;
  initialTotpWindow: TotpWindowState | null;
  requireGeo: boolean;
  geoRadiusMeters: number;
}) {
  const [token, setToken] = useState(initialToken);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [pinRequired, setPinRequired] = useState(initialPinRequired);
  const [pinCode, setPinCode] = useState(initialPinCode);
  const [totpEnabled, setTotpEnabled] = useState(initialTotpEnabled);
  const [totpWindow, setTotpWindow] = useState<TotpWindowState | null>(initialTotpWindow);

  useEffect(() => {
    if (!initialTotpEnabled) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/t/${tenantSlug}/credenciamento/telao/${pointId}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          token?: string;
          isActive?: boolean;
          pinRequired?: boolean;
          pinCode?: string | null;
          totpEnabled?: boolean;
          totpWindow?: TotpWindowState | null;
        };
        if (json.ok) {
          if (json.token) setToken(json.token);
          if (typeof json.isActive === 'boolean') setIsActive(json.isActive);
          if (typeof json.pinRequired === 'boolean') setPinRequired(json.pinRequired);
          if (json.pinCode !== undefined) setPinCode(json.pinCode);
          if (typeof json.totpEnabled === 'boolean') setTotpEnabled(json.totpEnabled);
          if (json.totpWindow !== undefined) setTotpWindow(json.totpWindow);
        }
      } catch {
        // Mantém o código atual até a próxima tentativa silenciosa.
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [initialTotpEnabled, pointId, tenantSlug]);

  return (
    <section
      className="grid gap-6 rounded-xl border border-border bg-card p-6 md:grid-cols-[auto_1fr] md:items-center"
      data-testid="self-checkin-telao"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-lowest p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt={`QR Code de presença ${token}`}
          width={300}
          height={300}
          className="size-64 sm:size-72"
          data-testid="telao-qr-image"
        />
        <span className="code-data text-base font-bold tracking-wider text-primary">{token}</span>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isActive ? 'success' : 'warning'}>
            {isActive ? 'Recebendo leituras' : 'Ponto pausado'}
          </Badge>
          {requireGeo ? (
            <Badge tone="info">
              <MapPin className="mr-1 inline size-3" aria-hidden />
              GPS ativo ({geoRadiusMeters} m)
            </Badge>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">
          Peça aos participantes para lerem o QR Code com a câmera do celular ou acessarem{' '}
          <span className="code-data break-all text-foreground">{publicUrl}</span>.
        </p>

        {totpEnabled && totpWindow ? (
          <div
            className="space-y-2 rounded-lg border border-primary/40 bg-primary-soft p-4"
            data-testid="telao-totp-box"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <ShieldCheck className="size-4" aria-hidden />
              Código dinâmico da sala (troca a cada {totpWindow.periodSeconds} s)
            </p>
            <p className="code-data text-4xl font-bold tracking-widest text-foreground" data-testid="telao-totp-code">
              {totpWindow.code}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              Renova automaticamente em ~{totpWindow.remainingSeconds} s
            </p>
          </div>
        ) : null}

        {pinRequired && pinCode ? (
          <div
            className="space-y-1 rounded-lg border border-border bg-surface-low p-4"
            data-testid="telao-pin-box"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Lock className="size-3.5" aria-hidden />
              PIN fixo da sala
            </p>
            <p className="code-data text-3xl font-bold tracking-widest text-foreground" data-testid="telao-pin-code">
              {pinCode}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <a
            href={`/api/t/${tenantSlug}/credenciamento/cartaz?pointId=${pointId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
          >
            <Printer className="size-3.5" aria-hidden />
            Imprimir cartaz A4 (PDF)
          </a>
          <a
            href={`/api/t/${tenantSlug}/credenciamento/cartaz?pointId=${pointId}&formato=svg`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Baixar vetor (SVG)
          </a>
        </div>
      </div>
    </section>
  );
}
