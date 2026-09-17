/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MÉTRICAS — registro em processo, exposto no formato do Prometheus (FASE 13)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM REGISTRO PRÓPRIO, E NÃO UMA BIBLIOTECA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O projeto não tinha NENHUMA métrica: o único sinal era `console.*` espalhado por
 *  ~66 pontos de serviço. Antes de adotar um SDK (OpenTelemetry, prom-client), esta
 *  fase precisava responder três perguntas que não exigem dependência nova:
 *
 *      1. a aplicação está de pé e há quanto tempo?
 *      2. quanto entra de requisição e quanto é bloqueado?
 *      3. a fila de certificados está crescendo ou falhando?
 *
 *  O formato de exposição é o do Prometheus — texto simples, contrato estável —, e
 *  qualquer coletor lê sem plugin. Se um dia entrar OpenTelemetry, este registro
 *  vira a fonte dos contadores e o SDK só passa a exportar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE REGISTRO NÃO É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não é série temporal: é o estado do INSTANTE por processo. Em várias instâncias,
 *  cada uma expõe o seu conjunto e o coletor soma — que é exatamente como o
 *  Prometheus funciona. Nada aqui é persistido, e nada aqui é dado pessoal:
 *  rótulo só aceita valores de baixa cardinalidade (rota, método, resultado).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type MetricLabels = Readonly<Record<string, string | number>>;

interface CounterEntry {
  name: string;
  labels: MetricLabels;
  value: number;
}

interface GaugeEntry {
  name: string;
  labels: MetricLabels;
  value: number;
}

const globalForMetrics = globalThis as unknown as {
  __eventflowMetrics?: {
    counters: Map<string, CounterEntry>;
    gauges: Map<string, GaugeEntry>;
    durations: Map<string, { labels: MetricLabels; buckets: number[]; counts: number[]; sum: number; count: number }>;
  };
};

const state = (globalForMetrics.__eventflowMetrics ??= {
  counters: new Map(),
  gauges: new Map(),
  durations: new Map(),
});

/**
 * Chave estável de uma série: nome + rótulos ordenados.
 *
 * Ordenar importa: `{a,b}` e `{b,a}` são a MESMA série, e sem ordenação o mesmo
 * contador apareceria duas vezes na exposição — o coletor somaria duas vezes.
 */
function seriesKey(name: string, labels: MetricLabels): string {
  const parts = Object.entries(labels)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();

  return parts.length > 0 ? `${name}{${parts.join(',')}}` : name;
}

/** Limite de cardinalidade: um rótulo livre viraria vazamento de memória. */
export const MAX_SERIES = 500;

function tooManySeries(): boolean {
  return state.counters.size + state.gauges.size > MAX_SERIES;
}

export function incCounter(name: string, labels: MetricLabels = {}, by = 1): void {
  const key = seriesKey(name, labels);
  const current = state.counters.get(key);

  if (current) {
    current.value += by;
    return;
  }

  if (tooManySeries()) return;

  state.counters.set(key, { name, labels, value: by });
}

export function setGauge(name: string, value: number, labels: MetricLabels = {}): void {
  state.gauges.set(seriesKey(name, labels), { name, labels, value });
}

/** Buckets em milissegundos, do mais comum (p95 de página) ao extremo. */
const DURATION_BUCKETS = [5, 25, 100, 250, 500, 1000, 2500, 5000, 10_000];

export function observeDuration(name: string, milliseconds: number, labels: MetricLabels = {}): void {
  const key = seriesKey(name, labels);
  const current = state.durations.get(key) ?? {
    labels,
    buckets: DURATION_BUCKETS,
    counts: DURATION_BUCKETS.map(() => 0),
    sum: 0,
    count: 0,
  };

  current.counts = current.counts.map((count: number, index: number) =>
    milliseconds <= current.buckets[index]! ? count + 1 : count,
  );
  current.sum += milliseconds;
  current.count += 1;

  state.durations.set(key, current);
}

function formatLabels(labels: MetricLabels, extra: MetricLabels = {}): string {
  const entries = Object.entries({ ...labels, ...extra });

  if (entries.length === 0) return '';

  return `{${entries.map(([key, value]) => `${key}="${String(value)}"`).join(',')}}`;
}

/** Exposição no formato do Prometheus (text/plain; version=0.0.4). */
export function renderMetrics(): string {
  const lines: string[] = [];

  lines.push('# HELP eventflow_uptime_seconds Tempo desde a subida do processo.');
  lines.push('# TYPE eventflow_uptime_seconds gauge');
  lines.push(`eventflow_uptime_seconds ${Math.floor(process.uptime())}`);

  const counters = [...state.counters.values()].sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map<string, CounterEntry[]>();

  for (const counter of counters) {
    byName.set(counter.name, [...(byName.get(counter.name) ?? []), counter]);
  }

  for (const [name, entries] of byName) {
    lines.push(`# TYPE ${name} counter`);
    for (const entry of entries) {
      lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
    }
  }

  const gauges = [...state.gauges.values()].sort((a, b) => a.name.localeCompare(b.name));
  const gaugesByName = new Map<string, GaugeEntry[]>();

  for (const gauge of gauges) {
    gaugesByName.set(gauge.name, [...(gaugesByName.get(gauge.name) ?? []), gauge]);
  }

  for (const [name, entries] of gaugesByName) {
    lines.push(`# TYPE ${name} gauge`);
    for (const entry of entries) {
      lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
    }
  }

  //  O cabeçalho `# TYPE` é por FAMÍLIA, não por série: repetir a declaração em
  //  cada conjunto de rótulos deixa o arquivo inválido para coletores estritos.
  const declaredFamilies = new Set<string>();

  for (const [key, duration] of state.durations) {
    const name = key.split('{')[0]!;

    if (!declaredFamilies.has(name)) {
      declaredFamilies.add(name);
      lines.push(`# TYPE ${name} histogram`);
    }

    duration.counts.forEach((count: number, index: number) => {
      lines.push(
        `${name}_bucket${formatLabels(duration.labels, { le: duration.buckets[index]! })} ${count}`,
      );
    });

    lines.push(`${name}_bucket${formatLabels(duration.labels, { le: '+Inf' })} ${duration.count}`);
    lines.push(`${name}_sum${formatLabels(duration.labels)} ${duration.sum}`);
    lines.push(`${name}_count${formatLabels(duration.labels)} ${duration.count}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Só para testes: começa cada caso com um registro limpo. */
export function resetMetrics(): void {
  state.counters.clear();
  state.gauges.clear();
  state.durations.clear();
}
