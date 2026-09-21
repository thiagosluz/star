'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, Loader2, ScanLine, TriangleAlert, UserCheck, XCircle } from 'lucide-react';

import type { CredentialActionState } from '@/app/actions/credential-actions';
import { QrCameraReader } from '@/components/credentials/qr-camera-reader';
import { describeAttendanceContext } from '@/domain/events/credential-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MODO MONITOR — o balcão do credenciamento (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE O MONITOR FAZ, NESTA ORDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. escolhe ONDE a leitura vale — a portaria do evento ou uma atividade;
 *    2. lê o crachá (câmera, leitor USB ou digitação);
 *    3. vê o NOME e o que aconteceu, em letras grandes, e segue para o próximo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CONTEXTO VEM PRIMEIRO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O crachá é um só, por pessoa: é o CONTEXTO que decide onde o fato é gravado —
 *  "chegou ao evento" ou "esteve nesta atividade, por N minutos". Escolher o contexto
 *  depois da leitura seria pedir ao monitor que guardasse na cabeça o que ele acabou
 *  de ler; escolher antes é o que ele já sabe (está na porta, ou está na sala).
 *
 *  A ATIVIDADE DE AGORA já vem sugerida: quem abre a tela no meio da programação
 *  quase sempre está credenciando a atividade que está acontecendo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A TELA NÃO PEDE CONFIRMAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Com fila, um "confirma?" por pessoa dobra o tempo de cada leitura. O que protege
 *  contra o erro é o CONTRÁRIO: o resultado aparece grande, com o nome e a ação, e o
 *  monitor vê na hora que leu o crachá errado — e desfaz lendo de novo (o botão único
 *  entra/sai) ou fechando a sessão no painel.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface MonitorActivity {
  id: string;
  title: string;
  startsAtIso: string;
  endsAtIso: string;
  roomName: string | null;
  /** A atividade está acontecendo agora (sugestão de contexto). */
  isNow: boolean;
  /** O credenciamento dela está desligado — o monitor precisa saber antes de ler. */
  checkInEnabled: boolean;
}

type Feedback = {
  ok: boolean;
  message: string;
  details: readonly string[];
  data: Record<string, unknown> | undefined;
};

/**
 * Pausa a câmera enquanto a action está em curso.
 *
 * O `pending` do formulário é o único lugar confiável para saber que a gravação está
 * acontecendo — e a câmera precisa parar nesse instante, senão o mesmo crachá é lido
 * dez vezes enquanto a resposta não chega.
 */
function ScanGate({ onRead }: { onRead: (code: string) => void }) {
  const { pending } = useFormStatus();

  return <QrCameraReader onRead={onRead} paused={pending} />;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="presence-submit"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanLine className="size-4" aria-hidden />}
      {pending ? 'Registrando…' : label}
    </button>
  );
}

export function MonitorConsole({
  tenantSlug,
  eventId,
  eventTitle,
  activities,
  action,
  closeAction,
}: {
  tenantSlug: string;
  eventId: string;
  eventTitle: string;
  activities: readonly MonitorActivity[];
  action: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
  closeAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
}) {
  const nowActivity = activities.find((activity) => activity.isNow) ?? null;

  const [contextKind, setContextKind] = useState<'EVENT' | 'ACTIVITY'>(
    nowActivity ? 'ACTIVITY' : 'EVENT',
  );
  const [activityId, setActivityId] = useState(nowActivity?.id ?? activities[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'TOGGLE' | 'IN' | 'OUT'>('TOGGLE');

  const [state, formAction] = useActionState<CredentialActionState | null, FormData>(action, null);
  const [closeState, closeFormAction] = useActionState<CredentialActionState | null, FormData>(
    closeAction,
    null,
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  /**
   * O painel de resultado é DERIVADO do estado da action — sem cópia em estado local.
   *
   * A primeira versão copiava o resultado para um `useState` dentro de um efeito, e o
   * React Compiler recusou (com razão): `setState` no corpo do efeito provoca render em
   * cascata. Derivar é mais simples e não perde nada: cada resposta da action é um
   * objeto novo, então o painel atualiza mesmo quando o código lido é o mesmo.
   */
  const feedback: Feedback | null = state
    ? {
        ok: state.ok,
        message: state.message ?? '',
        details: state.details ?? [],
        data: state.data,
      }
    : null;

  /**
   * O foco volta para o campo quando a leitura termina: no balcão, o leitor USB digita
   * no que estiver focado, e um clique perdido na tela faria a próxima leitura se
   * perder. É só efeito de DOM — nada de estado.
   */
  useEffect(() => {
    if (state) inputRef.current?.focus();
  }, [state]);

  const submitCode = (value: string) => {
    /**
     * O campo é limpo AQUI, e não num efeito depois da resposta: o valor já foi para
     * a action, e um efeito limpando o campo é a corrida clássica com o reset
     * assíncrono do React 19 (armadilha 56).
     */
    setCode(value);
    setMode('TOGGLE');

    /**
     * A submissão automática é do FORMULÁRIO (e não um `fetch`): a action é a mesma do
     * botão, com a mesma autorização e o mesmo estado — um segundo caminho de gravação
     * seria uma segunda regra (armadilha 55).
     */
    requestAnimationFrame(() => {
      formRef.current?.requestSubmit();
    });
  };

  const contextLabel = describeAttendanceContext({
    kind: contextKind,
    activityId: contextKind === 'ACTIVITY' ? activityId : null,
    activityTitle: activities.find((activity) => activity.id === activityId)?.title ?? null,
  });

  const outcomeAction = typeof feedback?.data?.action === 'string' ? feedback.data.action : null;
  const outcomeName = typeof feedback?.data?.userName === 'string' ? feedback.data.userName : null;
  const outcomeMinutes = typeof feedback?.data?.minutes === 'number' ? feedback.data.minutes : null;

  return (
    <section className="space-y-4" data-testid="monitor-console">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ScanLine className="size-5 text-primary" aria-hidden />
          Modo monitor
        </h2>
        <p className="text-xs text-muted-foreground">
          Escolha onde a leitura vale, leia o crachá e siga para o próximo. A câmera, o leitor USB e a
          digitação registram o mesmo fato — e o contexto decide se ele é a chegada ao evento ou a
          frequência na atividade.
        </p>
      </header>

      {/* ── Contexto ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 rounded-lg border border-border bg-surface-low p-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          Onde esta leitura vale
          <select
            value={contextKind}
            onChange={(event) => setContextKind(event.target.value as 'EVENT' | 'ACTIVITY')}
            aria-label="Contexto da leitura"
            data-testid="monitor-context-kind"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          >
            <option value="EVENT">Portaria do evento — registra a chegada</option>
            <option value="ACTIVITY">Atividade — registra a frequência</option>
          </select>
        </label>

        {contextKind === 'ACTIVITY' ? (
          <label className="space-y-1 text-xs font-medium">
            Atividade
            <select
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
              aria-label="Atividade da leitura"
              data-testid="monitor-activity"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            >
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.title}
                  {activity.roomName ? ` · ${activity.roomName}` : ''}
                  {activity.isNow ? ' (acontecendo agora)' : ''}
                  {activity.checkInEnabled ? '' : ' · credenciamento desligado'}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="monitor-context-label">
          Lendo em: <strong className="font-medium text-foreground">{contextLabel}</strong>
        </p>
      </div>

      {/* ── Leitura ──────────────────────────────────────────────────────────── */}
      <form ref={formRef} action={formAction} className="space-y-3" data-testid="monitor-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="contextKind" value={contextKind} />
        {contextKind === 'ACTIVITY' ? <input type="hidden" name="activityId" value={activityId} /> : null}
        <input type="hidden" name="mode" value={mode} />

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium">
            Código do crachá
            <input
              ref={inputRef}
              name="code"
              required
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="CR-XXXX-XXXX"
              aria-label="Código do crachá"
              data-testid="monitor-code"
              className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 code-data text-base"
            />
          </label>

          <SubmitButton label="Registrar" />
        </div>

        <ScanGate onRead={submitCode} />

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Leitura que fecha a sessão:</span>
          <button
            type="button"
            onClick={() => {
              setMode('OUT');
              requestAnimationFrame(() => formRef.current?.requestSubmit());
            }}
            data-testid="monitor-checkout"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          >
            Registrar saída
          </button>
          <span className="text-muted-foreground">
            (o botão principal decide sozinho: entra quem está fora, sai quem está dentro)
          </span>
        </div>
      </form>

      {/* ── Resultado ────────────────────────────────────────────────────────── */}
      {feedback ? (
        <div
          role={feedback.ok ? 'status' : 'alert'}
          data-testid="monitor-feedback"
          data-action={outcomeAction ?? (feedback.ok ? 'OK' : 'ERRO')}
          className={`space-y-1 rounded-xl border p-4 ${
            feedback.ok ? 'border-success/40 bg-success-soft' : 'border-destructive/40 bg-destructive-soft'
          }`}
        >
          <p className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {feedback.ok ? (
              outcomeAction === 'CHECKED_OUT' ? (
                <CheckCircle2 className="size-6 text-success-strong" aria-hidden />
              ) : (
                <UserCheck className="size-6 text-success-strong" aria-hidden />
              )
            ) : (
              <XCircle className="size-6 text-destructive" aria-hidden />
            )}
            {outcomeName ?? feedback.message}
          </p>

          <p className="text-sm">{feedback.ok && outcomeName ? feedback.message : feedback.ok ? '' : feedback.message}</p>

          {outcomeMinutes !== null ? (
            <p className="text-sm text-muted-foreground">
              {outcomeMinutes} minuto(s) nesta sessão · total fechado no contexto:{' '}
              {String(feedback.data?.closedMinutes ?? 0)} min
            </p>
          ) : null}

          {feedback.details.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-warning-strong" data-testid="monitor-warnings">
              {feedback.details.map((detail) => (
                <li key={detail} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {detail}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-muted-foreground">{eventTitle}</p>
        </div>
      ) : null}

      {/* ── Fechamento das presenças abertas ─────────────────────────────────── */}
      <form action={closeFormAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        {contextKind === 'ACTIVITY' ? <input type="hidden" name="activityId" value={activityId} /> : null}
        <button
          type="submit"
          data-testid="monitor-close-sessions"
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Fechar as presenças abertas deste contexto
        </button>
        <span className="text-xs text-muted-foreground">
          Quem esqueceu de sair recebe a saída no fim da atividade — o número é o mesmo sempre.
        </span>
      </form>

      {closeState ? (
        <p
          role={closeState.ok ? 'status' : 'alert'}
          data-testid="monitor-close-feedback"
          className={`text-xs ${closeState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {closeState.message}
        </p>
      ) : null}
    </section>
  );
}
