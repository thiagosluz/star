'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2 } from 'lucide-react';

import {
  CAMERA_FALLBACK_NOTICE,
  cameraChoiceStillAvailable,
  cameraDeviceLabel,
  shouldOfferCameraChoice,
} from '@/domain/events/camera-device-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEITOR DE QR CODE PELA CÂMERA (FASE 31 · ESCOLHA DA LENTE NA FASE 51 · E42)
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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LENTE PODE SER ESCOLHIDA (FASE 51 · dívida E42)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `facingMode: 'environment'` é um PEDIDO, não uma garantia: o navegador escolhe
 *  sozinho qual câmera atende, e num notebook com webcam e câmera USB ele abre a
 *  que estiver ligada primeiro — muitas vezes a errada. O operador aponta o leitor
 *  para o crachá e a imagem que aparece é a parede atrás dele.
 *
 *  Quatro decisões que esta tela carrega:
 *
 *    1. **A escolha PERSISTE na sessão do balcão.** O operador troca de lente UMA
 *       vez e lê o evento inteiro; se a escolha morresse a cada leitura (o
 *       componente remonta quando a action responde), ele reescolheria a cada
 *       crachá e desistiria — voltando a apontar a câmera errada na mão.
 *       Mesma decisão, e mesma chave por evento, do sentido da leitura.
 *
 *    2. **Com UMA câmera, o seletor NÃO aparece.** Um `select` de uma opção só é
 *       ruído no caminho de quem está na fila: ocupa espaço, pede um toque e não
 *       muda nada. A lista é medida e o controle só existe quando há o que escolher.
 *
 *    3. **Dispositivo que sumiu não trava a leitura.** Notebook com webcam
 *       desplugada, celular com a lente traseira ocupada por outro app: o
 *       `getUserMedia` do `deviceId` escolhido falha, e a resposta NÃO é um erro na
 *       tela — é voltar ao padrão (`facingMode: environment`), limpar a escolha
 *       guardada e AVISAR em texto o que aconteceu. Um balcão parado no meio do
 *       evento é pior que uma câmera diferente da que o operador pediu.
 *
 *    4. **Os rótulos só existem depois da permissão.** Antes de o usuário autorizar,
 *       `enumerateDevices` devolve dispositivos SEM `label` (é a proteção contra
 *       fingerprint). Por isso a lista é relida depois do `getUserMedia` dar certo —
 *       e o rótulo de reserva é "Câmera N", em vez de uma string vazia.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICOU SEM TESTE DE UNIDADE, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `enumerateDevices`, `getUserMedia`, `BarcodeDetector`, `localStorage` e o
 *  comportamento do navegador quando um `deviceId` desaparece são APIs do NAVEGADOR,
 *  e não há `jsdom` nem `happy-dom` na suíte do projeto (o `environment` do Vitest é
 *  `node`). Um duplo de `navigator.mediaDevices` provaria que o componente chama as
 *  funções na ordem esperada — não que a câmera abre, que é o que importa aqui.
 *  A prova real é o E2E (`tests/e2e/f51-credential-badge.spec.ts`), que roda com o
 *  navegador de verdade e uma mídia falsa (`--use-fake-device-for-media-stream`).
 *  O que É testável sem navegador — a chave de armazenamento e o rótulo de reserva —
 *  está em `src/domain/events/camera-device-rules.ts`, com teste unitário.
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
  /**
   * A chave do `localStorage` desta sessão de balcão (um evento, um operador, um
   * navegador). Quem chama é o console do monitor, que é quem sabe o evento — o
   * leitor não adivinha de onde veio.
   */
  storageKey,
}: {
  onRead: (code: string) => void;
  paused?: boolean;
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
  const [decoder, setDecoder] = useState<Decoder>('none');
  /** As lentes conhecidas. Uma só = o seletor não aparece. */
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A LEITURA DA ESCOLHA GUARDADA É PREGUIÇOSA, E NÃO UM EFEITO (E42)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Um `useEffect` que chama `setState` no corpo dispara uma segunda renderização
     *  em cascata — e o ESLint do projeto reprova (`react-hooks/set-state-in-effect`).
     *  O inicializador preguiçoso resolve na PRIMEIRA renderização, e o valor já
     *  está pronto quando o botão "Ler pela câmera" aparece: o operador não chega a
     *  ver o `select` mudar de opção.
     *
     *  `localStorage` só existe no navegador — a guarda de `window` é o que permite
     *  o componente ser renderizado no servidor (o `selectedDeviceId` nasce vazio e o
     *  HTML do servidor coincide com o do cliente na primeira pintura).
     */
    if (typeof window === 'undefined') return '';

    try {
      return window.localStorage.getItem(storageKey) ?? '';
    } catch {
      // `localStorage` bloqueado (aba privada, política do navegador): sem escolha
      // guardada, que é o mesmo estado de quem nunca escolheu.
      return '';
    }
  });
  /**
   * Aviso de queda para o padrão. Separado de `error` de propósito: a leitura
   * CONTINUA funcionando, e mostrar isso como erro faria o operador parar o balcão
   * para "consertar" uma câmera que está lendo.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const rememberDeviceId = useCallback(
    (deviceId: string) => {
      if (typeof window === 'undefined') return;

      try {
        if (deviceId) window.localStorage.setItem(storageKey, deviceId);
        else window.localStorage.removeItem(storageKey);
      } catch {
        // Não poder guardar não impede ler: a escolha vale para esta montagem.
      }
    },
    [storageKey],
  );

  /**
   * A lista de LENTES, com o rótulo do sistema.
   *
   * `videoinput` filtra o que não é câmera (microfone, alto-falante). O rótulo só
   * existe depois da permissão; por isso o nome de reserva é posicional — melhor
   * "Câmera 2" que um `select` de opções em branco.
   */
  const refreshDevices = useCallback(async (): Promise<{ deviceId: string; label: string }[]> => {
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
      // Sem lista não há escolha — e a câmera padrão continua funcionando.
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
          /**
           * ─────────────────────────────────────────────────────────────────────
           *  A LENTE ESCOLHIDA SUMIU — E O BALCÃO NÃO PODE PARAR (E42)
           * ─────────────────────────────────────────────────────────────────────
           *  Só cai aqui quando havia uma escolha e ela falhou (webcam desplugada,
           *  lente ocupada por outro aplicativo, permissão revogada para aquele
           *  dispositivo). A resposta é voltar ao PADRÃO e dizer por quê — nunca
           *  deixar o monitor sem câmera no meio da fila.
           *
           *  `NotAllowedError` é outro caso (o usuário negou o acesso): aí não
           *  adianta tentar de novo, e a mensagem é a de permissão.
           */
          if (!wanted || (caught instanceof Error && caught.name === 'NotAllowedError')) throw caught;

          stream = await openStream('');
          usedFallback = true;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            // Autoplay bloqueado: o usuário já clicou, o navegador costuma liberar.
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

        /**
         * A lista é relida DEPOIS da permissão: é só então que os rótulos existem
         * (antes, o navegador esconde o nome do dispositivo). E é aqui que se
         * descobre se a escolha ainda existe — o `deviceId` que não voltou na lista
         * é o que sumiu.
         */
        const cameras = await refreshDevices();
        const available = cameras.map((device) => device.deviceId);

        if (usedFallback) {
          setSelectedDeviceId('');
          rememberDeviceId('');
          setNotice(CAMERA_FALLBACK_NOTICE);
        } else if (!cameraChoiceStillAvailable(wanted, available) && available.length > 0) {
          setSelectedDeviceId('');
          rememberDeviceId('');
          setNotice('A câmera escolhida não está mais disponível. Abrimos a câmera padrão — escolha outra na lista.');
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

  /**
   * Trocar de lente é FECHAR e ABRIR de novo: não existe "mudar a câmera" de um
   * stream vivo — o `deviceId` faz parte do pedido de `getUserMedia`.
   */
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

      {/**
       * ── O SELETOR DE LENTE (E42) ───────────────────────────────────────────────
       *  Só existe com MAIS DE UMA câmera: `select` de uma opção é um toque a mais
       *  no meio da fila que não muda nada. E ele fica fora do formulário de leitura
       *  de propósito (`type="button"` não é o caso; o `select` não tem submit), para
       *  o Enter do leitor USB continuar enviando o CÓDIGO e não trocando de câmera.
       */}
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
