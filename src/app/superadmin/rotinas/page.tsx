import { AlertTriangle, Clock, ListChecks, Timer } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { lastRunPerJob, listRecentJobRuns } from '@/lib/platform/job-runs';
import { RunJobButton } from '@/components/platform/job-run-button';
import { Alert, Badge, Card, EmptyState, PageHeader, SectionHeading, StatCard } from '@/components/ui';
import {
  JOB_CATALOG,
  JOB_HEALTH_LABELS,
  JOB_RUN_STATUS_LABELS,
  JOB_TRIGGER_LABELS,
  jobHealthOf,
  type JobHealth,
} from '@/domain/platform/job-catalog';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ROTINAS AUTOMÁTICAS DA PLATAFORMA — `/superadmin/rotinas` (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ESTA TELA RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As varreduras existiam desde fases diferentes e só sabiam falar pelo `console.log`
 *  do worker. Para responder "a rotina das 3h rodou ontem?", "quantas vagas ela
 *  liberou?" e "por que falhou?" era preciso `docker logs` — ou seja, não havia
 *  resposta para quem opera.
 *
 *  Aqui cada rotina do catálogo aparece com a ÚLTIMA execução, a saúde, o que ela faz
 *  e quanto tempo faz, mais o histórico das últimas passadas. E o botão que pede uma
 *  execução agora, para quando a operação não quer esperar o relógio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA É DE PLATAFORMA, E NÃO DE INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma passada atende TODAS as instituições — não existe "rotina da instituição X".
 *  Por isso ela vive em `/superadmin`, com a guarda do layout (`requirePlatformPermission`,
 *  que responde 404), e não no painel de ninguém.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "NUNCA RODOU" É UM RESULTADO, NÃO UM ERRO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A leitura percorre o CATÁLOGO, não as execuções: uma rotina que nunca rodou precisa
 *  APARECER — é justamente o caso que exige ação (o worker subiu? o agendador foi
 *  registrado?). Listar as execuções esconderia exatamente o que a tela existe para
 *  mostrar.
 *
 *  O "agora" da comparação de atraso é lido UMA vez, aqui, e não dentro de cada
 *  cartão: duas leituras dariam idades diferentes para a mesma lista.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

/** Cor do chip de saúde — o TEXTO é que informa; a cor só reforça. */
const HEALTH_TONE: Record<JobHealth, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  OK: 'success',
  RUNNING: 'primary',
  LATE: 'warning',
  FAILING: 'danger',
  NEVER: 'neutral',
};

function formatMoment(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * "há 12 min" é mais útil que um carimbo de data para decidir se algo está atrasado.
 * `null` quando não há quando — a tela mostra "—" em vez de inventar zero.
 */
function formatAge(from: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);

  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.floor(hours / 24);

  return `há ${days} dia(s)`;
}

export default async function PlatformJobsPage() {
  await requirePlatformPermission();

  const [lastRuns, history] = await Promise.all([lastRunPerJob(), listRecentJobRuns({ limit: 40 })]);

  const now = new Date();
  const jobs = Object.values(JOB_CATALOG);
  const health = jobs.map((job) =>
    jobHealthOf({
      lastStatus: lastRuns[job.key]?.status ?? null,
      lastStartedAt: lastRuns[job.key]?.startedAt ?? null,
      pattern: job.pattern,
      now,
    }),
  );

  const failing = health.filter((state) => state === 'FAILING').length;
  const late = health.filter((state) => state === 'LATE').length;
  const never = health.filter((state) => state === 'NEVER').length;
  const running = health.filter((state) => state === 'RUNNING').length;

  return (
    <div className="space-y-8" data-testid="platform-jobs">
      <PageHeader
        title="Rotinas automáticas"
        description="O que a plataforma faz sozinha, quando cada rotina rodou pela última vez e o que aconteceu nas últimas passadas. Uma passada atende todas as instituições."
        breadcrumbs={[{ label: 'Plataforma' }, { label: 'Rotinas' }]}
        badge={<Badge tone="primary">SuperAdmin</Badge>}
        actions={
          <p className="text-xs text-muted-foreground" data-testid="jobs-generated-at">
            Consulta em {formatMoment(now)} UTC
          </p>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Rotinas"
          value={jobs.length}
          hint="Agendadas pelo worker"
          icon={<ListChecks className="size-4" aria-hidden />}
          tone="primary"
          data-testid="jobs-total"
          data-value={jobs.length}
        />
        <StatCard
          label="Rodando agora"
          value={running}
          hint={running > 0 ? 'Uma passada em andamento' : 'Nenhuma passada em andamento'}
          icon={<Timer className="size-4" aria-hidden />}
          data-testid="jobs-running"
          data-value={running}
        />
        <StatCard
          label="Atrasadas"
          value={late}
          hint="Sem passada recente para a cadência delas"
          icon={<Clock className="size-4" aria-hidden />}
          tone={late > 0 ? 'warning' : 'neutral'}
          data-testid="jobs-late"
          data-value={late}
        />
        <StatCard
          label="Falhando"
          value={failing}
          hint={failing > 0 ? 'A última passada falhou' : 'Nenhuma falha na última passada'}
          icon={<AlertTriangle className="size-4" aria-hidden />}
          tone={failing > 0 ? 'danger' : 'neutral'}
          data-testid="jobs-failing"
          data-value={failing}
        />
      </section>

      {never === jobs.length ? (
        /**
         * O estado do primeiro dia. A tela diz o que fazer em vez de mostrar cinco
         * cartões cinzentos sem explicação — "nunca rodou" em TODAS é sinal de que o
         * worker (quem grava o registro) ainda não subiu.
         */
        <Alert tone="info" title="Nenhuma rotina registrou execução ainda" data-testid="jobs-never-alert">
          O registro é escrito pelo worker. Se este aviso continuar depois de alguns minutos, confirme
          se o container do worker está no ar: sem ele as rotinas ficam agendadas na fila e não rodam.
        </Alert>
      ) : null}

      <section className="space-y-4" data-testid="jobs-catalog">
        <SectionHeading
          title="Catálogo de rotinas"
          description="A cadência vem do catálogo do domínio — a mesma fonte que o worker usa para agendar. A tela não tem lista própria."
        />

        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job, index) => {
            const state = health[index] ?? 'NEVER';
            const last = lastRuns[job.key] ?? null;

            return (
              <Card
                key={job.key}
                className="flex flex-col gap-4 p-5"
                data-testid={`job-card-${job.key}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-title text-foreground">{job.label}</h3>
                      <Badge
                        tone={HEALTH_TONE[state]}
                        size="sm"
                        withDot
                        data-testid={`job-health-${job.key}`}
                        data-health={state}
                      >
                        {JOB_HEALTH_LABELS[state]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="code-data">{job.pattern}</span> · {job.cadenceLabel}
                    </p>
                  </div>

                  <RunJobButton job={job.key} label={job.label} />
                </div>

                <p className="text-sm text-muted-foreground">{job.description}</p>

                <dl
                  className="mt-auto grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-3"
                  data-testid={`job-last-${job.key}`}
                >
                  <div>
                    <dt className="label-caps">Última passada</dt>
                    <dd className="mt-1 text-foreground">
                      {last ? formatMoment(last.startedAt) : '—'}
                      {last ? (
                        <span className="block text-muted-foreground">
                          {formatAge(last.startedAt, now)} · {JOB_TRIGGER_LABELS[last.trigger]}
                        </span>
                      ) : null}
                    </dd>
                  </div>

                  <div>
                    <dt className="label-caps">Resultado</dt>
                    <dd className="mt-1 text-foreground">
                      {last ? JOB_RUN_STATUS_LABELS[last.status] : '—'}
                      {last && last.status !== 'RUNNING' ? (
                        <span className="block text-muted-foreground code-data">
                          {last.items} {job.itemsLabel}
                        </span>
                      ) : null}
                    </dd>
                  </div>

                  <div className="sm:col-span-1">
                    <dt className="label-caps">Observação</dt>
                    <dd className="mt-1 text-foreground">
                      {last?.error ? (
                        <span className="text-destructive" data-testid={`job-error-${job.key}`}>
                          {last.error}
                        </span>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" data-testid="jobs-history">
        <SectionHeading
          title="Últimas execuções"
          description="As 40 passadas mais recentes, de todas as rotinas. O registro é a prova de que a rotina rodou — e a exclusão mútua que impede duas passadas ao mesmo tempo."
        />

        {history.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nenhuma execução registrada"
            description="Cada passada das rotinas abre um registro aqui: quando começou, quanto durou, quantos itens tratou e por que falhou, quando falhou."
            data-testid="jobs-history-empty"
          />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border" data-testid="jobs-history-list">
              {history.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3"
                  data-testid={`job-run-${run.id}`}
                  data-job={run.job}
                  data-status={run.status}
                  data-trigger={run.trigger}
                >
                  <span className="text-sm font-medium text-foreground">
                    {JOB_CATALOG[run.job]?.label ?? run.job}
                  </span>
                  <Badge
                    tone={
                      run.status === 'OK'
                        ? 'success'
                        : run.status === 'FAILED'
                          ? 'danger'
                          : run.status === 'RUNNING'
                            ? 'primary'
                            : 'neutral'
                    }
                    size="sm"
                  >
                    {JOB_RUN_STATUS_LABELS[run.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {JOB_TRIGGER_LABELS[run.trigger]}
                  </span>
                  {run.status === 'OK' || run.status === 'FAILED' ? (
                    <span className="code-data text-xs text-muted-foreground">
                      {run.items} {JOB_CATALOG[run.job]?.itemsLabel ?? 'itens'}
                    </span>
                  ) : null}
                  {run.error ? (
                    <span className="max-w-md truncate text-xs text-destructive">{run.error}</span>
                  ) : null}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {formatMoment(run.startedAt)}
                    {run.host ? ` · ${run.host}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
