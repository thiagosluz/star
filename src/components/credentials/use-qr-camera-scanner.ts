'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CAMERA_FALLBACK_NOTICE,
  cameraChoiceStillAvailable,
  cameraDeviceLabel,
} from '@/domain/events/camera-device-rules';

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

export type QrDecoderKind = 'native' | 'jsqr' | 'none';
export type QrCameraDevice = { deviceId: string; label: string };

/** Intervalo entre leituras (400 ms é ágil para a fila e leve para o celular). */
const SCAN_INTERVAL_MS = 400;
export const QR_READ_COOLDOWN_MS = 2_500;

/**
 * Decididor puro da janela anti-rajada: ignora leitura repetida do mesmo código dentro
 * do cooldown (2,5 s) para impedir entrada e saída acidentais no mesmo segundo.
 */
export function shouldAcceptQrRead(
  previous: { code: string; at: number } | null,
  raw: string,
  now: number,
  cooldownMs: number = QR_READ_COOLDOWN_MS,
): boolean {
  if (!raw) return false;
  if (!previous) return true;
  if (previous.code !== raw) return true;
  return now - previous.at > cooldownMs;
}

/** Hook que encapsula acesso a câmera, troca de lente, fallback e decodificação QR. */
export function useQrCameraScanner({
  onRead,
  paused,
  storageKey,
}: {
  onRead: (code: string) => void;
  paused: boolean;
  storageKey: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lastReadRef = useRef<{ code: string; at: number } | null>(null);

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decoder, setDecoder] = useState<QrDecoderKind>('none');
  const [devices, setDevices] = useState<QrCameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });
  const [notice, setNotice] = useState<string | null>(null);

  const rememberDeviceId = useCallback(
    (deviceId: string) => {
      if (typeof window === 'undefined') return;
      try {
        if (deviceId) window.localStorage.setItem(storageKey, deviceId);
        else window.localStorage.removeItem(storageKey);
      } catch {
        // Sem persistência em aba privada: a seleção segue ativa para esta montagem.
      }
    },
    [storageKey],
  );

  const refreshDevices = useCallback(async (): Promise<QrCameraDevice[]> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cameras = all
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: cameraDeviceLabel(device.label, index),
        }));

      setDevices(cameras);
      return cameras;
    } catch {
      setDevices([]);
      return [];
    }
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const scheduleNextScan = useCallback((read: () => Promise<void>) => {
    timerRef.current = setTimeout(() => {
      void read();
    }, SCAN_INTERVAL_MS);
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      setError(null);
      setStarting(true);

      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          setError('Este navegador não dá acesso à câmera. Use o leitor USB ou digite o código.');
          return;
        }

        const wanted = deviceId ?? selectedDeviceId;
        const openStream = async (id: string): Promise<MediaStream> =>
          navigator.mediaDevices.getUserMedia({
            video: id ? { deviceId: { exact: id } } : { facingMode: 'environment' },
            audio: false,
          });

        let stream: MediaStream;
        let usedFallback = false;

        try {
          stream = await openStream(wanted);
        } catch (caught) {
          if (!wanted || (caught instanceof Error && caught.name === 'NotAllowedError')) throw caught;
          stream = await openStream('');
          usedFallback = true;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            // Autoplay bloqueado: o clique prévio costuma liberar na interação seguinte.
          });
        }

        const native = (
          globalThis as unknown as {
            BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
          }
        ).BarcodeDetector;

        if (native) {
          detectorRef.current = new native({ formats: ['qr_code'] });
          setDecoder('native');
        } else {
          detectorRef.current = null;
          setDecoder('jsqr');
        }

        const cameras = await refreshDevices();
        const available = cameras.map((device) => device.deviceId);

        if (usedFallback) {
          setSelectedDeviceId('');
          rememberDeviceId('');
          setNotice(CAMERA_FALLBACK_NOTICE);
        } else if (!cameraChoiceStillAvailable(wanted, available) && available.length > 0) {
          setSelectedDeviceId('');
          rememberDeviceId('');
          setNotice(
            'A câmera escolhida não está mais disponível. Abrimos a câmera padrão — escolha outra na lista.',
          );
        } else {
          setNotice(null);
        }

        setActive(true);
      } catch (caught) {
        setError(
          caught instanceof Error && caught.name === 'NotAllowedError'
            ? 'Permissão de câmera negada. Libere o acesso ou use o leitor USB.'
            : 'Não foi possível abrir a câmera. Use o leitor USB ou digite o código.',
        );
      } finally {
        setStarting(false);
      }
    },
    [refreshDevices, rememberDeviceId, selectedDeviceId],
  );

  useEffect(() => {
    if (!active || paused) return;

    let cancelled = false;

    const read = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (cancelled || !video || !canvas || video.readyState < 2) {
        scheduleNextScan(read);
        return;
      }

      try {
        let raw: string | null = null;

        if (detectorRef.current) {
          const found = await detectorRef.current.detect(video);
          raw = found[0]?.rawValue ?? null;
        } else {
          const context = canvas.getContext('2d', { willReadFrequently: true });

          if (context) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const { default: jsQR } = await import('jsqr');
            const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
            raw = found?.data ?? null;
          }
        }

        if (raw) {
          const now = Date.now();
          if (shouldAcceptQrRead(lastReadRef.current, raw, now)) {
            lastReadRef.current = { code: raw, at: now };
            onRead(raw);
          }
        }
      } catch {
        // Quadro ilegível não interrompe a captura contínua.
      }

      if (!cancelled) scheduleNextScan(read);
    };

    void read();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [active, paused, onRead, scheduleNextScan]);

  useEffect(() => stop, [stop]);

  const changeDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    rememberDeviceId(deviceId);
    setNotice(null);

    if (!active) return;

    stop();
    void start(deviceId);
  };

  const selectedLabel = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId)?.label ?? null,
    [devices, selectedDeviceId],
  );

  return {
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
  };
}
