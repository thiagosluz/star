'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Ban, FileText, FileX2, Layers, Loader2, Users, UserCheck } from 'lucide-react';

import type { CertificateActionState } from '@/app/actions/certificate-actions';
import {
  DEFAULT_BATCH_KINDS,
  type EventPreviewSummary,
  type GenerationTimeEstimate,
} from '@/domain/certificates/certificate-preview-rules';
import { StatCard } from '@/components/ui';

/**
 * Painel da equipe: a SIMULAÇÃO da emissão em lote e o disparo.
 *
 * Emissão em lote existe porque o caso de uso real é "acabou o evento, emita para
 * todos" — pedir 300 certificados um a um pela tela do participante não é um fluxo
 * de trabalho, é um castigo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A SIMULAÇÃO VEM DO SERVIDOR, E O CLIQUE RECALCULA (FASE 85)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Os contadores chegam prontos da página (Server Component), calculados pelo
 *  MESMO serviço que emite. O N do botão é uma FOTO do render: se a pessoa marcar
 *  outros tipos e disparar, a Server Action recalcula com os tipos do formulário e
 *  a resposta diz o que realmente aconteceu. Não há promessa de que o N da tela
 *  seja o número final — e é por isso que a frase abaixo dele diz que a emissão
 *  recalcula.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA NÃO AFIRMA (leia antes de acrescentar um número)
 * ─────────────────────────────────────────────────────────────────────────────
 *  • NÃO mostra "capacidade da fila": ela não existe (sem `limiter`/`maxLen`), e
 *    ocupação percentual seria invenção. Só os contadores reais do BullMQ.
 *  • NÃO mostra "concurrency: N": o processo web não observa `WORKER_CONCURRENCY`.
 *  • NÃO divide o tempo estimado pela concorrência: o número é a SOMA do trabalho
 *    de geração, e a frase diz isso — não é o relógio.
 *  • NÃO chama a fração de "presença média": elegíveis ÷ escopo é outra pergunta,
 *    com outro denominador.
 */

/** Contadores do BullMQ como a página os leu — `null` quando o Redis não respondeu. */
export interface CertificateQueueSnapshot {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  workers: number;
}

const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

function formatWorkTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));

  if (seconds < 60) return `${seconds} s`;

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  if (minutes < 60) return restSeconds === 0 ? `${minutes} min` : `${minutes} min ${restSeconds} s`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
}

function BatchButton({ count }: { count: number | null }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="issue-batch"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Layers className="size-4" aria-hidden />
      )}
      {pending
        ? 'Emitindo lote…'
        : count === null
          ? 'Disparar emissão em lote'
          : `Disparar emissão em lote (${count})`}
    </button>
  );
}

export function IssueBatchPanel({
  tenantSlug,
  event,
  kinds,
  action,
  simulation,
  simulationProblem,
  estimate,
  queue,
}: {
  tenantSlug: string;
  /** O evento da ROTA: o lote é sempre dele, e não de uma escolha no formulário. */
  event: { id: string; title: string };
  kinds: readonly { value: string; label: string }[];
  action: (
    prev: CertificateActionState | null,
    formData: FormData,
  ) => Promise<CertificateActionState>;
  /** A simulação lida no servidor; `null` quando o serviço não respondeu. */
  simulation: EventPreviewSummary | null;
  simulationProblem: string | null;
  /** `null` = amostra insuficiente (ou fila indisponível): a tela diz "sem medição". */
  estimate: GenerationTimeEstimate | null;
  queue: CertificateQueueSnapshot | null;
}) {
  const [state, formAction] = useActionState<CertificateActionState | null, FormData>(action, null);

  const kindLabel = (kind: string): string =>
    kinds.find((option) => option.value === kind)?.label ?? kind;

  const simulatedKindsLabel = DEFAULT_BATCH_KINDS.map(kindLabel).join(' + ');
  const certificatesToIssue = simulation?.certificatesToIssue ?? null;
  const discarded = simulation?.discarded ?? [];

  const estimateText = (() => {
    if (!simulation) return 'Sem simulação, não há estimativa — o disparo continua disponível e recalcula ao emitir.';
    if (simulation.certificatesToIssue === 0) return 'Nada a gerar nesta simulação: nenhum par pessoa × tipo elegível.';

    if (!estimate) {
      return 'Ainda sem medição de tempo: a estimativa aparece quando houver ao menos 5 PDFs concluídos na fila.';
    }

    return `Trabalho estimado: ~${formatWorkTime(estimate.totalMs)} — média de ${estimate.sampleSize} PDFs recentes. É a soma do tempo de geração, não o relógio: o worker processa em paralelo.`;
  })();

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-labelledby="emissao-lote"
      data-testid="issue-panel"
    >
      <header className="space-y-1">
        <h2 id="emissao-lote" className="text-base font-semibold">
          Emissão em lote (equipe)
        </h2>
        <p className="text-xs text-muted-foreground">
          A simulação percorre as pessoas com fato registrado no evento e mostra o que a emissão
          faria: quantas recebem documento, quantas ficam de fora e por quê. O disparo abaixo é o
          que grava — e ele recalcula com os tipos marcados no formulário.
        </p>
      </header>

      {/**
       * ── OS QUATRO CONTADORES ───────────────────────────────────────────────────
       *
       *  "Pessoas no escopo" é a população que a EMISSÃO percorre (presença,
       *  palestra, parecer ou autoria aceita) — não é o número de inscrições.
       *  "Elegíveis" conta PESSOAS com ao menos um tipo aprovado; "Certificados a
       *  emitir" conta PARES (pessoa × tipo). São números diferentes de propósito,
       *  e os rótulos dizem isso.
       */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="issue-counters">
        <StatCard
          label="Pessoas no escopo"
          value={simulation ? String(simulation.scope) : '—'}
          hint="com presença, palestra, parecer ou autoria aceita no evento"
          icon={<Users className="size-4" aria-hidden />}
          data-testid="issue-scope"
          data-value={simulation ? String(simulation.scope) : '—'}
        />
        <StatCard
          label="Elegíveis"
          value={simulation ? String(simulation.eligiblePeople) : '—'}
          hint={
            simulation
              ? simulation.eligibleRatio === null
                ? 'sem pessoas no escopo para calcular a fração'
                : `${PERCENT.format(simulation.eligibleRatio)} do escopo (pessoas com ao menos um tipo aprovado)`
              : 'sem simulação'
          }
          icon={<UserCheck className="size-4" aria-hidden />}
          data-testid="issue-eligible"
          data-value={simulation ? String(simulation.eligiblePeople) : '—'}
        />
        <StatCard
          label="Descartadas"
          value={simulation ? String(discarded.length) : '—'}
          hint="tentativas pessoa × tipo, cada uma com o motivo do domínio"
          tone={discarded.length > 0 ? 'warning' : 'neutral'}
          icon={<FileX2 className="size-4" aria-hidden />}
          data-testid="issue-discarded-count"
          data-value={simulation ? String(discarded.length) : '—'}
        />
        {/**
         * ── "A EMITIR" É O PAR ELEGÍVEL, NÃO "O QUE FALTA" ─────────────────────
         *
         *  O N não subtrai certificados já emitidos: o lote é idempotente e um par
         *  existente é devolvido como existente, não regerado. Subtrair exigiria
         *  uma sétima consulta e faria a simulação medir outra pergunta ("o que
         *  falta") em vez de "quem tem direito". A resposta do disparo é que
         *  informa quantos foram gerados agora.
         */}
        <StatCard
          label="Certificados a emitir"
          value={simulation ? String(simulation.certificatesToIssue) : '—'}
          hint="pares elegíveis — o N do disparo"
          icon={<FileText className="size-4" aria-hidden />}
          data-testid="issue-certificates"
          data-value={simulation ? String(simulation.certificatesToIssue) : '—'}
        />
      </div>

      <p className="text-xs text-muted-foreground" data-testid="issue-simulation">
        Simulação para: <strong className="text-foreground">{simulatedKindsLabel}</strong>. O disparo
        recalcula com os tipos marcados abaixo — o N do botão é a foto deste render.
        {simulationProblem ? (
          <span className="block pt-1 text-warning-strong" data-testid="issue-simulation-problem">
            {simulationProblem}
          </span>
        ) : null}
      </p>

      <p className="flex items-start gap-2 text-sm" data-testid="issue-estimate">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{estimateText}</span>
      </p>

      {/**
       * ── A FILA, SEM "CAPACIDADE" ──────────────────────────────────────────────
       *
       *  São os contadores que `certificateQueueStats()` devolve, e só eles.
       *  `completed`/`failed` são a janela retida (o BullMQ guarda os 200/500
       *  últimos), e a frase diz "janela retida" em vez de sugerir total
       *  histórico. Zero workers é dito com todas as letras: os documentos ficam
       *  aguardando, e a equipe precisa saber disso antes de fechar o evento.
       */}
      <p
        className="flex items-start gap-2 rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground"
        data-testid="issue-queue"
        data-queue-workers={queue ? String(queue.workers) : ''}
      >
        <Layers className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {queue === null
            ? 'Fila indisponível (o Redis não respondeu): o disparo gera os documentos na hora, no processo web.'
            : `Fila da plataforma (janela retida): ${queue.waiting} aguardando · ${queue.active} em processamento · ${queue.completed} concluídos · ${queue.failed} falhas · ${queue.workers} worker(s) registrado(s).${
                queue.workers === 0
                  ? ' Nenhum worker registrado: os documentos ficam aguardando até um subir.'
                  : ''
              }`}
        </span>
      </p>

      {/**
       * ── A LISTA DE DESCARTADOS ────────────────────────────────────────────────
       *
       *  `<details>`/`<summary>` nativo: funciona sem JavaScript, é focável e o
       *  leitor de tela anuncia o estado aberto/fechado. A lista é `<ul>/<li>` —
       *  nada de `<div>` clicável.
       */}
      <details
        className="rounded-lg border border-border bg-background/40 p-3"
        data-testid="issue-discarded"
      >
        <summary className="cursor-pointer text-sm font-medium" data-testid="issue-discarded-summary">
          Ver lista de descartados ({discarded.length})
        </summary>

        <p className="mt-2 text-xs text-muted-foreground">
          Cada linha é uma tentativa (pessoa × tipo) recusada. O motivo é o texto que a regra de
          elegibilidade produziu — o mesmo que a emissão aplicaria.
        </p>

        {discarded.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="issue-discarded-empty">
            Nenhuma tentativa descartada nesta simulação.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm" data-testid="issue-discarded-list">
            {discarded.map((item) => (
              <li key={`${item.userId}-${item.kind}`} className="py-2">
                <p className="font-medium">
                  {item.name} <span className="text-muted-foreground">· {kindLabel(item.kind)}</span>
                </p>
                <p className="text-xs text-muted-foreground">{item.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </details>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={event.id} />

        {/**
         * O evento é TEXTO, não campo: o escopo é o da URL, e um `<select>` de um
         * item só convidaria a pessoa a trocar o que a rota já decidiu. O testid
         * existe para o E2E provar que a tela é a do evento clicado.
         */}
        <p className="text-xs text-muted-foreground" data-testid="issue-panel-event">
          Evento: <span className="font-medium text-foreground">{event.title}</span>
        </p>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Tipos</legend>
          <div className="flex flex-wrap gap-3">
            {kinds.map((kind) => (
              <label key={kind.value} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  name="kinds"
                  value={kind.value}
                  defaultChecked={DEFAULT_BATCH_KINDS.some((simulated) => simulated === kind.value)}
                  className="size-3.5"
                />
                {kind.label}
              </label>
            ))}
          </div>
        </fieldset>

        <BatchButton count={certificatesToIssue} />
      </form>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid="issue-feedback"
          className={`text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

export function RevokeCertificateForm({
  tenantSlug,
  certificateId,
  action,
}: {
  tenantSlug: string;
  certificateId: string;
  action: (
    prev: CertificateActionState | null,
    formData: FormData,
  ) => Promise<CertificateActionState>;
}) {
  const [state, formAction] = useActionState<CertificateActionState | null, FormData>(action, null);

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Revogar</summary>

      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="certificateId" value={certificateId} />

        <input
          name="reason"
          required
          minLength={8}
          placeholder="Motivo da revogação"
          aria-label="Motivo da revogação"
          className="block w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        />

        <button
          type="submit"
          data-testid="revoke-certificate"
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10"
        >
          <Ban className="size-3" aria-hidden />
          Confirmar revogação
        </button>

        {state ? (
          <p className={state.ok ? 'text-success-strong' : 'text-destructive'}>{state.message}</p>
        ) : null}
      </form>
    </details>
  );
}
