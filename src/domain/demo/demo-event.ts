/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O EVENTO DE EXEMPLO (FASE 77 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA FIXTURE É DADO PURO, E NÃO UM "MODO DEMONSTRAÇÃO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ideia original era um botão que criasse um evento de verdade no tenant. A
 *  medição recusou: 29 das 43 tabelas que o dataset toca não têm `deletedAt`, o
 *  produto não exclui evento, o guarda de atividade recusa apagar o que tem
 *  presença e a quota do tenant demo é 3 eventos. Criar sem poder desfazer é
 *  dívida, não demonstração.
 *
 *  O que cabe é o oposto: um EVENTO FICTÍCIO, imutável, que existe só na memória
 *  do render. Nenhuma linha de banco nasce daqui, a RLS nem entra e não existe
 *  ação de escrita para alguém clicar. Por isso este arquivo é `domain`: ele não
 *  importa Prisma, Next, React nem servidor — é o tipo e o valor, apenas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM EVENTO BASTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O objetivo é mostrar a FORMA das telas, não simular um catálogo. Um evento
 *  pequeno, com uma atividade de cada tipo, uma chamada, uma inscrição, uma
 *  presença, uma carta e uma demanda, exercita todas as seções que a tela
 *  desenha — e um segundo evento só repetiria a mesma forma. Quarenta eventos,
 *  além disso, esconderiam o evento real da instituição nas listas (o defeito
 *  que a alternativa "demo que grava" produziria por dias).
 *
 *  Nomes, números e datas são INVENTADOS. Não correspondem a pessoa, instituição
 *  ou evento real, e a tela repete isso em voz alta (o selo `demo-banner`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { EventModalityValue } from '@/domain/events/event-modality-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos — espelham a FORMA que as telas reais mostram, sem importar o ORM
// ───────────────────────────────────────────────────────────────────────────────
export type DemoActivityKind = 'PALESTRA' | 'OFICINA';

export const DEMO_ACTIVITY_KIND_LABELS: Readonly<Record<DemoActivityKind, string>> = {
  PALESTRA: 'Palestra',
  OFICINA: 'Oficina',
};

export interface DemoActivity {
  readonly id: string;
  readonly title: string;
  readonly kind: DemoActivityKind;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly room: string;
  readonly speaker: string;
  readonly capacity: number;
  readonly registered: number;
}

export type DemoEventStatus = 'REGISTRATION_OPEN';

export const DEMO_EVENT_STATUS_LABELS: Readonly<Record<DemoEventStatus, string>> = {
  REGISTRATION_OPEN: 'Inscrições abertas',
};

export type DemoCallStatus = 'OPEN';

export const DEMO_CALL_STATUS_LABELS: Readonly<Record<DemoCallStatus, string>> = {
  OPEN: 'Chamada aberta',
};

export interface DemoCall {
  readonly title: string;
  readonly kindLabel: string;
  readonly status: DemoCallStatus;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly description: string;
  readonly reviewLabel: string;
  readonly proposalsReceived: number;
}

export type DemoRegistrationStatus = 'CONFIRMED';

export const DEMO_REGISTRATION_STATUS_LABELS: Readonly<
  Record<DemoRegistrationStatus, string>
> = {
  CONFIRMED: 'Confirmada',
};

export interface DemoRegistration {
  readonly personName: string;
  readonly status: DemoRegistrationStatus;
  readonly originLabel: string;
  readonly registeredAt: string;
  readonly ticketLabel: string;
}

export interface DemoAttendance {
  readonly personName: string;
  readonly activityId: string;
  readonly activityTitle: string;
  readonly checkedInAt: string;
  readonly checkedOutAt: string;
  /**
   * Minutos APURADOS com o teto no fim da atividade (regra do produto): a
   * oficina termina às 17:00 e a saída é 17:01, então o número é 177, não 178.
   * É o mesmo detalhe que evita a fixture ensinar uma conta que o sistema não faz.
   */
  readonly minutes: number;
  readonly contextLabel: string;
}

export type DemoCardRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export interface DemoCard {
  readonly name: string;
  readonly rarity: DemoCardRarity;
  readonly description: string;
  readonly reason: string;
  readonly earnedAt: string;
}

export type DemoDemandPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export const DEMO_DEMAND_PRIORITY_LABELS: Readonly<Record<DemoDemandPriority, string>> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
};

export interface DemoDemand {
  readonly title: string;
  readonly column: string;
  readonly team: string;
  readonly assignee: string;
  readonly dueAt: string;
  readonly priority: DemoDemandPriority;
  readonly description: string;
  readonly comments: number;
}

export interface DemoEvent {
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly venueName: string;
  readonly city: string;
  readonly state: string;
  readonly modality: EventModalityValue;
  readonly categoryLabel: string;
  readonly status: DemoEventStatus;
  readonly capacity: number;
  readonly registrationCount: number;
  readonly attendanceCount: number;
  readonly activities: readonly DemoActivity[];
  readonly call: DemoCall;
  readonly registration: DemoRegistration;
  readonly attendance: DemoAttendance;
  readonly card: DemoCard;
  readonly demand: DemoDemand;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O exemplo — 12 de novembro de 2026, no fuso da instituição fictícia
// ───────────────────────────────────────────────────────────────────────────────
export const DEMO_EVENT = {
  title: 'Mostra de Tecnologia e Cidadania',
  summary: 'Um dia para mostrar o que a turma construiu e conversar sobre o que vem depois.',
  description:
    'A mostra reúne uma palestra de abertura e uma oficina prática. Os números abaixo são fixos: servem para mostrar como um evento aparece no sistema, não para descrever um evento que exista de verdade.',
  startsAt: '2026-11-12T11:00:00.000Z',
  endsAt: '2026-11-12T21:00:00.000Z',
  timezone: 'America/Bahia',
  venueName: 'Centro de Convenções do Instituto Horizonte',
  city: 'Salvador',
  state: 'BA',
  modality: 'IN_PERSON',
  categoryLabel: 'Tecnologia e inovação',
  status: 'REGISTRATION_OPEN',
  capacity: 120,
  registrationCount: 87,
  attendanceCount: 61,
  activities: [
    {
      id: 'demo-atividade-abertura',
      title: 'Tecnologia que resolve problema real',
      kind: 'PALESTRA',
      startsAt: '2026-11-12T12:00:00.000Z',
      endsAt: '2026-11-12T13:30:00.000Z',
      room: 'Auditório Norte',
      speaker: 'Marina Duarte',
      capacity: 120,
      registered: 86,
    },
    {
      id: 'demo-atividade-oficina',
      title: 'Protótipo em uma tarde',
      kind: 'OFICINA',
      startsAt: '2026-11-12T17:00:00.000Z',
      endsAt: '2026-11-12T20:00:00.000Z',
      room: 'Laboratório 2',
      speaker: 'Caio Ferreira',
      capacity: 24,
      registered: 24,
    },
  ],
  call: {
    title: 'Chamada de relatos de experiência',
    kindLabel: 'Relato de experiência',
    status: 'OPEN',
    opensAt: '2026-09-01T12:00:00.000Z',
    closesAt: '2026-10-30T23:59:00.000Z',
    description:
      'A chamada recebe relatos de quem já levou um projeto da ideia ao protótipo. Um parecer por proposta, com rubrica de três critérios.',
    reviewLabel: 'Parecer simples, com rubrica de três critérios',
    proposalsReceived: 1,
  },
  registration: {
    personName: 'Júlia Nascimento',
    status: 'CONFIRMED',
    originLabel: 'Inscrição pública',
    registeredAt: '2026-10-02T14:20:00.000Z',
    ticketLabel: 'Evento + oficina',
  },
  attendance: {
    personName: 'Júlia Nascimento',
    activityId: 'demo-atividade-oficina',
    activityTitle: 'Protótipo em uma tarde',
    checkedInAt: '2026-11-12T17:03:00.000Z',
    checkedOutAt: '2026-11-12T20:01:00.000Z',
    minutes: 177,
    contextLabel: 'Oficina',
  },
  card: {
    name: 'Mão na massa',
    rarity: 'RARE',
    description: 'Carta de quem colocou a mão no protótipo e apresentou o resultado.',
    reason: 'Participou da oficina e entregou o protótipo no prazo.',
    earnedAt: '2026-11-12T20:10:00.000Z',
  },
  demand: {
    title: 'Confirmar o coffee break com o fornecedor',
    column: 'Em andamento',
    team: 'Operação',
    assignee: 'Rafa Moreira',
    dueAt: '2026-11-10T21:00:00.000Z',
    priority: 'HIGH',
    description:
      'Fechar quantidade, restrições alimentares e horário de entrega. O contrato já está assinado.',
    comments: 2,
  },
} as const satisfies DemoEvent;

// ───────────────────────────────────────────────────────────────────────────────
//  Rótulos — funções puras, com o fuso FIXO da fixture
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O fuso vem da fixture, não do ambiente: a tela é a mesma em qualquer servidor,
 * e a data não muda porque a máquina de quem renderiza está em outro lugar. É a
 * mesma razão pela qual o produto guarda `timezone` no evento.
 */
const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEMO_EVENT.timezone,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEMO_EVENT.timezone,
  hour: '2-digit',
  minute: '2-digit',
});

export function demoDateLabel(iso: string): string {
  return DATE_FORMATTER.format(new Date(iso));
}

export function demoTimeLabel(iso: string): string {
  return TIME_FORMATTER.format(new Date(iso));
}

/** "09:00 – 10:30" para uma atividade no mesmo dia. */
export function demoTimeRangeLabel(startsAt: string, endsAt: string): string {
  return `${demoTimeLabel(startsAt)} – ${demoTimeLabel(endsAt)}`;
}

/**
 * O período do evento em uma frase. Quando início e fim caem no mesmo dia (o
 * caso da fixture), não repetimos a data: "12 de novembro de 2026, das 08:00 às
 * 18:00" é o que a pessoa lê em uma linha.
 */
export function demoPeriodLabel(startsAt: string, endsAt: string): string {
  const startDate = demoDateLabel(startsAt);
  const endDate = demoDateLabel(endsAt);

  if (startDate === endDate) {
    return `${startDate}, das ${demoTimeLabel(startsAt)} às ${demoTimeLabel(endsAt)}`;
  }

  return `${startDate}, ${demoTimeLabel(startsAt)} até ${endDate}, ${demoTimeLabel(endsAt)}`;
}

/** "2 h 57 min" — o mesmo formato que a tela de presença usa para minutos. */
export function demoDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;

  return `${hours} h ${String(rest).padStart(2, '0')} min`;
}
