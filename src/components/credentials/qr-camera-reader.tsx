'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2 } from 'lucide-react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEITOR DE QR CODE PELA CÂMERA (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS IMPLEMENTAÇÕES, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. **`BarcodeDetector`** — a API nativa do navegador (Chrome/Edge/Android). É
 *     rápida, roda no hardware quando há suporte e não custa um byte de bundle;
 *  2. **`jsqr`** — decodificador em JavaScript, empacotado no projeto (MIT, ~30 kB,
 *     SEM rede). Existe porque a API nativa NÃO existe no Firefox nem no Safari, e o
 *     pedido era justamente ler pela câmera do celular — que, no evento, é o aparelho
 *     de quem está na porta.
 *
 *  A escolha é declarada na tela (`data-decoder`): quem opera precisa saber por qual
 *  caminho a leitura está passando quando um crachá não é lido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CÂMERA NÃO SUBSTITUI O CAMPO DE TEXTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O leitor USB continua sendo o equipamento mais rápido do balcão, e ele se comporta
 *  como TECLADO: lê e "digita" o código no campo focado. O campo de texto atende os
 *  três caminhos (câmera, leitor USB e digitação à mão) — a câmera é o quarto, para
 *  quem não tem leitor nenhum.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

type Decoder = 'native' | 'jsqr' | 'none';

/** Intervalo entre leituras: 400 ms é rápido para a fila e leve para o celular. */
const SCAN_INTERVAL_MS = 400;

export function QrCameraReader({
  onRead,
  /** Pausa a leitura enquanto o balcão processa o código lido. */
  paused = false,
}: {
  onRead: (code: string) => void;
  paused?: boolean;
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
  const [decoder, setDecoder] = useState<Decoder>('none');

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

  /**
   * O laço de leitura é agendado com `setTimeout` (e não `requestAnimationFrame`):
   * a câmera fica aberta durante o evento inteiro, e decodificar 60 vezes por segundo
   * esquentaria o celular do monitor sem nenhum ganho — ninguém passa um crachá em
   * 16 ms.
   */
  const scheduleNextScan = useCallback(
    (read: () => Promise<void>) => {
      timerRef.current = setTimeout(() => {
        void read();
      }, SCAN_INTERVAL_MS);
    },
    [],
  );

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador não dá acesso à câmera. Use o leitor USB ou digite o código.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          // Autoplay bloqueado: o usuário já clicou, o navegador costuma liberar.
        });
      }

      const native = (globalThis as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike })
        .BarcodeDetector;

      if (native) {
        detectorRef.current = new native({ formats: ['qr_code'] });
        setDecoder('native');
      } else {
        detectorRef.current = null;
        setDecoder('jsqr');
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
  }, []);

  /**
   * Lê um quadro e, quando encontra um código, entrega ao balcão.
   *
   * A MESMA leitura repetida é ignorada por 2,5 s: a câmera vê o mesmo crachá em
   * vários quadros seguidos, e sem essa janela o balcão registraria a entrada e a
   * saída da mesma pessoa em um segundo.
   */
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
          const previous = lastReadRef.current;

          if (!previous || previous.code !== raw || now - previous.at > 2_500) {
            lastReadRef.current = { code: raw, at: now };
            onRead(raw);
          }
        }
      } catch {
        // Quadro ilegível não é erro: a câmera tenta de novo no próximo intervalo.
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

  // Fechar a câmera ao sair da tela: no celular, a lente continua ligada em segundo
  // plano e a bateria acaba no meio do evento.
  useEffect(() => stop, [stop]);

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
            ? `Lendo com ${decoder === 'native' ? 'a API do navegador' : 'o decodificador local'}`
            : 'A câmera lê o QR do crachá e preenche o código sozinha.'}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert" data-testid="qr-camera-error">
          {error}
        </p>
      ) : null}

      {/* O vídeo só aparece quando a câmera está ligada; o canvas é só de trabalho. */}
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
