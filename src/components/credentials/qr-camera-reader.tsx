'use client';

import { Camera, CameraOff, Loader2 } from 'lucide-react';

import { useQrCameraScanner } from '@/components/credentials/use-qr-camera-scanner';
import { shouldOfferCameraChoice } from '@/domain/events/camera-device-rules';

/**
 * Leitor visual de QR Code pela câmera: delega todo o ciclo de mídia/decodificação
 * ao hook `useQrCameraScanner` e mantém a interface limpa fora do fluxo USB.
 */
export function QrCameraReader({
  onRead,
  paused = false,
  storageKey,
}: {
  onRead: (code: string) => void;
  paused?: boolean;
  storageKey: string;
}) {
  const {
    videoRef,
    canvasRef,
    active,
    starting,
    error,
    notice,
    decoder,
    devices,
    selectedDeviceId,
    selectedLabel,
    start,
    stop,
    changeDevice,
  } = useQrCameraScanner({ onRead, paused, storageKey });

  return (
    <div className="space-y-2" data-testid="qr-camera" data-decoder={decoder} data-active={active ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <button
            type="button"
            onClick={stop}
            data-testid="qr-camera-stop"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <CameraOff className="size-3.5" aria-hidden />
            Parar a câmera
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            data-testid="qr-camera-start"
            className="inline-flex items-center gap-2 rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            {starting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Camera className="size-3.5" aria-hidden />}
            {starting ? 'Abrindo a câmera…' : 'Ler pela câmera'}
          </button>
        )}

        <span className="text-xs text-muted-foreground">
          {active
            ? `Lendo com ${decoder === 'native' ? 'a API do navegador' : 'o decodificador local'}${
                selectedLabel ? ` · ${selectedLabel}` : ''
              }`
            : 'A câmera lê o QR do crachá e preenche o código sozinha.'}
        </span>
      </div>

      {shouldOfferCameraChoice(devices.length) ? (
        <label className="flex flex-wrap items-center gap-2 text-xs font-medium">
          Câmera
          <select
            value={selectedDeviceId}
            onChange={(event) => changeDevice(event.target.value)}
            aria-label="Câmera usada na leitura"
            data-testid="qr-camera-device"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs font-normal"
          >
            <option value="">Câmera padrão do navegador</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <span className="font-normal text-muted-foreground">
            A escolha vale para este balcão até você trocar.
          </span>
        </label>
      ) : null}

      {notice ? (
        <p className="text-xs text-warning-strong" role="status" data-testid="qr-camera-notice">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="alert" data-testid="qr-camera-error">
          {error}
        </p>
      ) : null}

      <div className={active ? 'block' : 'hidden'}>
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-40 w-full max-w-xs rounded-md border border-border bg-surface-lowest object-cover"
          data-testid="qr-camera-video"
        />
      </div>

      <canvas ref={canvasRef} className="hidden" aria-hidden />
    </div>
  );
}
