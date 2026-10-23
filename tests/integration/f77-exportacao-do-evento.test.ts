/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — a exportação do evento (FASE 77 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TESTE CENTRAL DA FATIA: O NÚMERO TEM DE SER DO RECORTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma pessoa com inscrição em DOIS eventos. O CSV do evento A tem de mostrar os
 *  números do A — e não a soma dos dois. Antes do conserto, `?evento=` filtrava só
 *  QUEM aparece e as CTEs somavam a instituição inteira: a linha da Ana no arquivo
 *  "do Congresso" dizia 3 visitas e 210 minutos (o total dela na instituição), e o
 *  organizador lia aquilo como sendo do congresso.
 *
 *  O teste prende os dois lados de propósito: os números GLOBAIS (3 visitas, 210
 *  minutos, 2 certificados, 5 cartas, 120 XP) e os DO EVENTO (2, 90, 1, 2, 50). A
 *  diferença entre eles é o defeito que a fatia fechou — se o recorte voltar a ser
 *  só do filtro, a linha do CSV volta a ser a coluna da esquerda.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o recorte das colunas (inscrições, presenças, visitas, minutos,
 *    comparecimento, certificados, cartas e XP por evento);
 *  • o formato LONGO das presenças: a mesma pessoa em duas atividades gera DUAS
 *    linhas, e a sessão (entrada/saída) é a unidade;
 *  • o evento em `DRAFT` exporta (o filtro do diretório é do diretório, não do
 *    dado);
 *  • o teto de 5.000 linhas e o `truncated` do pedido;
 *  • o arquivo continua sem ser guardado: a marca d'água e o prazo da F49 valem
 *    também para o tipo novo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listParticipants, PARTICIPANT_CSV_HEADER, PARTICIPANT_EVENT_CSV_HEADER } from '../../src/lib/participants/participant-service';
import { buildDataExportFile, createDataExport, getDataExport } from '../../src/lib/exports/export-service';
import { ATTENDANCE_CSV_HEADER } from '../../src/domain/exports/attendance-export-rules';
import { CSV_MAX_ROWS } from '../../src/domain/participants/participant-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let tenantSlug: string;

let eventA: string;
let eventB: string;
let eventDraft: string;
let eventBig: string;

let activityA1: string;
let activityA2: string;
let activityB1: string;

let ana: string;
let bruno: string;
let carla: string;

const TITULO_A = 'Congresso de Exportação';
const TITULO_B = 'Simpósio de Outubro';
const TITULO_DRAFT = 'Evento em Rascunho';

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f77.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

async function createEvent(input: {
  title: string;
  slug: string;
  startsAt: Date;
  status: 'PUBLISHED' | 'DRAFT';
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id,
        tenantId,
        slug: `${input.slug}-${RUN}`,
        title: input.title,
        status: input.status,
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + 3 * 86_400_000),
      },
    }),
  );

  return id;
}

async function createActivity(input: {
  eventId: string;
  title: string;
  slug: string;
  startsAt: Date;
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.activity.create({
      data: {
        id,
        tenantId,
        eventId: input.eventId,
        slug: `${input.slug}-${RUN}`,
        title: input.title,
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + 3_600_000),
      },
    }),
  );

  return id;
}

async function register(input: {
  userId: string;
  eventId: string;
  activityId?: string | null;
  status?: 'CONFIRMED' | 'ATTENDED';
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: input.status ?? 'CONFIRMED',
      },
    }),
  );
}

async function attend(input: {
  userId: string;
  eventId: string;
  activityId?: string | null;
  checkedInAt: Date;
  checkedOutAt?: Date | null;
  minutes: number | null;
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: 'PRESENT',
        source: 'QR_CODE_CHECKIN',
        checkedInAt: input.checkedInAt,
        checkedOutAt: input.checkedOutAt ?? null,
        minutesAttended: input.minutes,
      },
    }),
  );
}

/** Uma célula por coluna — o cabeçalho é o contrato, e o teste o lê do arquivo. */
function parseCsv(csv: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  const data = lines.filter((line) => line.length > 0 && !line.startsWith('#'));
  const header = (data[0] ?? '').split(';');

  const rows = data.slice(1).map((line) => {
    const cells = line.split(';');
    const row: Record<string, string> = {};

    header.forEach((column, index) => {
      row[column] = cells[index] ?? '';
    });

    return row;
  });

  return { header, rows };
}

async function exportFile(input: {
  kind: 'PARTICIPANTS_CSV' | 'ATTENDANCES_CSV';
  filters: Record<string, string | boolean | undefined>;
}) {
  const created = await createDataExport({
    tenantId,
    actorId: ana,
    kind: input.kind,
    filters: input.filters,
  });

  if (!created.ok) throw new Error(`pedido recusado: ${created.message}`);

  const file = await buildDataExportFile({
    tenantId,
    exportId: created.exportId,
    tenantSlug,
    actorId: ana,
  });

  if (!file.ok) throw new Error(`download recusado: ${file.message}`);

  return { created, file };
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantSlug = `f77-${RUN}`;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: tenantSlug,
      name: `Instituição F77 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  eventA = await createEvent({
    title: TITULO_A,
    slug: 'congresso',
    startsAt: new Date('2026-09-01T12:00:00Z'),
    status: 'PUBLISHED',
  });

  eventB = await createEvent({
    title: TITULO_B,
    slug: 'simposio',
    startsAt: new Date('2026-10-01T12:00:00Z'),
    status: 'PUBLISHED',
  });

  /** O evento recém-criado: é ele que o `<select>` do diretório esconde. */
  eventDraft = await createEvent({
    title: TITULO_DRAFT,
    slug: 'rascunho',
    startsAt: new Date('2026-11-01T12:00:00Z'),
    status: 'DRAFT',
  });

  eventBig = await createEvent({
    title: 'Evento Grande',
    slug: 'grande',
    startsAt: new Date('2026-12-01T12:00:00Z'),
    status: 'PUBLISHED',
  });

  activityA1 = await createActivity({
    eventId: eventA,
    title: 'Minicurso de Banco de Dados',
    slug: 'minicurso-bd',
    startsAt: new Date('2026-09-01T13:00:00Z'),
  });

  activityA2 = await createActivity({
    eventId: eventA,
    title: 'Mesa de abertura',
    slug: 'mesa',
    startsAt: new Date('2026-09-01T15:00:00Z'),
  });

  activityB1 = await createActivity({
    eventId: eventB,
    title: 'Oficina de Redes',
    slug: 'oficina-redes',
    startsAt: new Date('2026-10-01T18:00:00Z'),
  });

  ana = await createUser('Ana Recorte');
  bruno = await createUser('Bruno Recorte');
  carla = await createUser('Carla Portaria');

  // ── Ana: dois eventos, duas atividades no A, presença nos dois ──────────────
  await register({ userId: ana, eventId: eventA, status: 'ATTENDED' });
  await register({ userId: ana, eventId: eventA, activityId: activityA1 });
  await register({ userId: ana, eventId: eventB });

  await attend({
    userId: ana,
    eventId: eventA,
    activityId: activityA1,
    checkedInAt: new Date('2026-09-01T13:00:00Z'), // 10:00 em Salvador
    checkedOutAt: new Date('2026-09-01T14:00:00Z'),
    minutes: 60,
  });
  await attend({
    userId: ana,
    eventId: eventA,
    activityId: activityA2,
    checkedInAt: new Date('2026-09-01T15:00:00Z'),
    checkedOutAt: new Date('2026-09-01T15:30:00Z'),
    minutes: 30,
  });
  await attend({
    userId: ana,
    eventId: eventB,
    activityId: activityB1,
    checkedInAt: new Date('2026-10-01T18:00:00Z'),
    checkedOutAt: new Date('2026-10-01T20:00:00Z'),
    minutes: 120,
  });

  await withTenant(tenantId, async (tx) => {
    for (const [eventId, code, minutes] of [
      [eventA, 'A', 90],
      [eventB, 'B', 120],
    ] as const) {
      await tx.certificate.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: ana,
          kind: 'ATTENDANCE',
          status: 'ISSUED',
          validationCode: `F77${RUN}${code}`,
          title: 'Certificado de participação',
          recipientName: 'Ana Recorte',
          bodyText: 'Certificamos a participação.',
          workloadMinutes: minutes,
          issuedAt: new Date('2026-12-20T12:00:00Z'),
        },
      });
    }

    const templateA = randomUUID();
    const templateB = randomUUID();

    await tx.cardTemplate.createMany({
      data: [
        {
          id: templateA,
          tenantId,
          eventId: eventA,
          slug: `carta-a-${RUN}`,
          name: 'Carta do Congresso',
          description: 'Presença no congresso',
          rarity: 'COMMON',
          trigger: 'CHECKIN',
          isActive: true,
        },
        {
          id: templateB,
          tenantId,
          eventId: eventB,
          slug: `carta-b-${RUN}`,
          name: 'Carta do Simpósio',
          description: 'Presença no simpósio',
          rarity: 'RARE',
          trigger: 'CHECKIN',
          isActive: true,
        },
      ],
    });

    await tx.userCard.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          userId: ana,
          cardTemplateId: templateA,
          eventId: eventA,
          source: 'CHECKIN',
          quantity: 2,
        },
        {
          id: randomUUID(),
          tenantId,
          userId: ana,
          cardTemplateId: templateB,
          eventId: eventB,
          source: 'CHECKIN',
          quantity: 3,
        },
      ],
    });

    /** O XP do recorte vem do LIVRO-RAZÃO; o perfil guarda o acumulado (120). */
    await tx.userXpProfile.create({
      data: { id: randomUUID(), tenantId, userId: ana, totalXp: 120, level: 2 },
    });

    await tx.xpTransaction.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          userId: ana,
          eventId: eventA,
          amount: 50,
          source: 'CHECKIN',
          idempotencyKey: `f77-${RUN}-xp-a`,
        },
        {
          id: randomUUID(),
          tenantId,
          userId: ana,
          eventId: eventB,
          amount: 70,
          source: 'CHECKIN',
          idempotencyKey: `f77-${RUN}-xp-b`,
        },
      ],
    });
  });

  // ── Bruno: inscrito e presente no A (uma sessão) ────────────────────────────
  await register({ userId: bruno, eventId: eventA, status: 'ATTENDED' });
  await attend({
    userId: bruno,
    eventId: eventA,
    activityId: activityA1,
    checkedInAt: new Date('2026-09-01T13:10:00Z'),
    checkedOutAt: new Date('2026-09-01T13:55:00Z'),
    minutes: 45,
  });

  /**
   * ─── Carla: chegou ao evento, sem atividade e sem check-out ──────────────────
   *
   * É a leitura de PORTARIA (ADR-149/151): o fato existe sem inscrição e sem
   * atividade, e o arquivo de presenças tem de mostrá-lo como "(sem atividade)" e
   * "(em aberto)" — sumir com ele faria o evento parecer com menos presenças.
   */
  await attend({
    userId: carla,
    eventId: eventA,
    activityId: null,
    checkedInAt: new Date('2026-09-01T16:00:00Z'),
    checkedOutAt: null,
    minutes: null,
  });

  // ── O evento em RASCUNHO também tem gente (e é ele que o diretório esconde) ──
  await register({ userId: bruno, eventId: eventDraft, status: 'ATTENDED' });
  await attend({
    userId: bruno,
    eventId: eventDraft,
    activityId: null,
    checkedInAt: new Date('2026-11-01T13:00:00Z'),
    checkedOutAt: new Date('2026-11-01T14:00:00Z'),
    minutes: 60,
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f77.${RUN}` } } });
  await adminPrisma.$disconnect();
});

beforeEach(async () => {
  await withTenant(tenantId, (tx) => tx.dataExport.deleteMany({ where: { tenantId } }));
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o recorte — uma pessoa em dois eventos', () => {
  it('o diretório do evento mostra os números DO EVENTO (e não a soma)', async () => {
    const global = await listParticipants({ tenantId, query: 'Ana', pageSize: 10 });
    const doEvento = await listParticipants({ tenantId, eventId: eventA, query: 'Ana', pageSize: 10 });

    expect(global.ok && doEvento.ok).toBe(true);
    if (!global.ok || !doEvento.ok) return;

    const anaGlobal = global.entries.find((entry) => entry.userId === ana);
    const anaNoEvento = doEvento.entries.find((entry) => entry.userId === ana);

    expect(anaGlobal).toBeDefined();
    expect(anaNoEvento).toBeDefined();

    /** A vida inteira: duas inscrições no A (evento + atividade), uma no B… */
    expect(anaGlobal?.confirmed).toBe(3);
    expect(anaGlobal?.visits).toBe(3);
    expect(anaGlobal?.minutes).toBe(210);
    expect(anaGlobal?.certificates).toBe(2);
    expect(anaGlobal?.cards).toBe(5);
    expect(anaGlobal?.xp).toBe(120);

    /** …e só o Congresso: 2 inscrições, 2 sessões, 90 minutos, 1 certificado… */
    expect(anaNoEvento?.confirmed).toBe(2);
    expect(anaNoEvento?.attended).toBe(1);
    expect(anaNoEvento?.visits).toBe(2);
    expect(anaNoEvento?.minutes).toBe(90);
    expect(anaNoEvento?.certificates).toBe(1);
    expect(anaNoEvento?.cards).toBe(2);
    expect(anaNoEvento?.xp).toBe(50);
    expect(anaNoEvento?.rate.percent).toBe(50);

    /** E o recorte não pode ser o total com outro nome. */
    expect(anaNoEvento?.visits).not.toBe(anaGlobal?.visits);
    expect(anaNoEvento?.minutes).not.toBe(anaGlobal?.minutes);

    /**
     * O que é da PESSOA não foi recortado: ela continua com 2 eventos e 2 eventos
     * com presença, e o rótulo não regride para "Primeira participação".
     */
    expect(anaNoEvento?.events).toBe(2);
    expect(anaNoEvento?.attendedEvents).toBe(2);
    expect(anaNoEvento?.engagement).toContain('REGULAR');
  });

  it('o CSV do evento A traz a linha com os números do A, coluna por coluna', async () => {
    const { created, file } = await exportFile({ kind: 'PARTICIPANTS_CSV', filters: { eventId: eventA } });
    const { header, rows } = parseCsv(file.csv);

    /** O PEDIDO guarda o recorte: é dele que a tela do evento lista as recentes. */
    const pedido = await getDataExport({ tenantId, exportId: created.exportId });

    expect(pedido?.eventId).toBe(eventA);

    /** A forma do arquivo é a do EVENTO — sem as colunas que não têm recorte. */
    expect(header).toEqual([...PARTICIPANT_EVENT_CSV_HEADER, 'Exportado por']);
    expect(header).not.toContain('Eventos');
    expect(header).not.toContain('Eventos com presença');
    expect(header).not.toContain('Rótulos');

    const linhaDaAna = rows.find((row) => row['Nome'] === 'Ana Recorte');

    expect(linhaDaAna).toBeDefined();
    expect(linhaDaAna?.['E-mail']).toMatch(/@exemplo\.test$/);
    expect(linhaDaAna?.['Inscrições confirmadas']).toBe('2');
    expect(linhaDaAna?.['Presenças']).toBe('1');
    expect(linhaDaAna?.['Visitas']).toBe('2');
    expect(linhaDaAna?.['Minutos']).toBe('90');
    expect(linhaDaAna?.['Comparecimento (%)']).toBe('50');
    expect(linhaDaAna?.['Certificados']).toBe('1');
    expect(linhaDaAna?.['Cartas']).toBe('2');
    expect(linhaDaAna?.['XP']).toBe('50');

    /** A marca d'água da F49 continua na ÚLTIMA coluna, em cada linha. */
    expect(linhaDaAna?.['Exportado por']).toContain('Ana Recorte');

    /** O arquivo NÃO é o total da instituição com o nome do evento. */
    expect(linhaDaAna?.['Visitas']).not.toBe('3');
    expect(linhaDaAna?.['Minutos']).not.toBe('210');
    expect(linhaDaAna?.['Certificados']).not.toBe('2');
    expect(linhaDaAna?.['Cartas']).not.toBe('5');
    expect(linhaDaAna?.['XP']).not.toBe('120');

    /** E o recorte está escrito na procedência. */
    expect(file.csv).toContain(`# Filtros: Evento: ${TITULO_A}`);
    expect(file.csv).toContain('# Válido até:');
  });

  it('o CSV da instituição continua com as 15 colunas (a forma antiga não muda)', async () => {
    const { file } = await exportFile({ kind: 'PARTICIPANTS_CSV', filters: {} });
    const { header, rows } = parseCsv(file.csv);

    expect(PARTICIPANT_CSV_HEADER).toHaveLength(15);
    expect(header).toEqual([...PARTICIPANT_CSV_HEADER, 'Exportado por']);

    const linhaDaAna = rows.find((row) => row['Nome'] === 'Ana Recorte');

    expect(linhaDaAna?.['Eventos']).toBe('2');
    expect(linhaDaAna?.['Visitas']).toBe('3');
    expect(linhaDaAna?.['Minutos']).toBe('210');
    expect(linhaDaAna?.['XP']).toBe('120');
    expect(linhaDaAna?.['Rótulos']?.length ?? 0).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('presenças por atividade — formato longo', () => {
  it('a mesma pessoa em duas atividades gera DUAS linhas; a sessão é a unidade', async () => {
    const { file } = await exportFile({ kind: 'ATTENDANCES_CSV', filters: { eventId: eventA } });
    const { header, rows } = parseCsv(file.csv);

    expect(header).toEqual([...ATTENDANCE_CSV_HEADER, 'Exportado por']);

    const linhasDaAna = rows.filter((row) => row['Pessoa'] === 'Ana Recorte');

    expect(linhasDaAna).toHaveLength(2);
    expect(linhasDaAna.map((row) => row['Atividade'])).toEqual([
      'Mesa de abertura',
      'Minicurso de Banco de Dados',
    ]);
    expect(linhasDaAna.map((row) => row['Minutos'])).toEqual(['30', '60']);

    /** Entrada e saída são a SESSÃO, no fuso do evento (UTC-3 em setembro). */
    expect(linhasDaAna[1]?.['Entrada']).toBe('01/09/2026 10:00');
    expect(linhasDaAna[1]?.['Saída']).toBe('01/09/2026 11:00');
    expect(linhasDaAna[0]?.['Entrada']).toBe('01/09/2026 12:00');
    expect(linhasDaAna[0]?.['Saída']).toBe('01/09/2026 12:30');

    /** Cada linha leva a marca d'água (o arquivo é o mesmo da F49). */
    for (const row of rows) {
      expect(row['Exportado por']).toContain('Ana Recorte');
      expect(row['Exportado por']).toContain('válido até');
    }

    expect(file.csv).toContain(`# Filtros: Evento: ${TITULO_A}`);
    expect(file.csv).toContain('# Presenças por atividade');
  });

  it('a chegada ao evento (sem atividade) aparece e DIZ o que é', async () => {
    const { file } = await exportFile({ kind: 'ATTENDANCES_CSV', filters: { eventId: eventA } });
    const { rows } = parseCsv(file.csv);

    const linhaDaCarla = rows.find((row) => row['Pessoa'] === 'Carla Portaria');

    expect(linhaDaCarla).toBeDefined();
    expect(linhaDaCarla?.['Atividade']).toBe('(sem atividade)');
    expect(linhaDaCarla?.['Saída']).toBe('(em aberto)');
    /** Minutos não apurados não viram zero: a célula fica vazia. */
    expect(linhaDaCarla?.['Minutos']).toBe('');
  });

  it('o escopo por atividade entrega só as sessões dela', async () => {
    const { file } = await exportFile({
      kind: 'ATTENDANCES_CSV',
      filters: { eventId: eventA, activityId: activityA1 },
    });
    const { rows } = parseCsv(file.csv);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row['Atividade'] === 'Minicurso de Banco de Dados')).toBe(true);
    expect(rows.map((row) => row['Pessoa']).sort()).toEqual(['Ana Recorte', 'Bruno Recorte']);
    expect(file.csv).toContain(`# Filtros: Evento: ${TITULO_A} · Atividade: Minicurso de Banco de Dados`);
  });

  it('recusa sem evento e recusa atividade de outro evento', async () => {
    const semEvento = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'ATTENDANCES_CSV',
      filters: {},
    });

    expect(semEvento.ok).toBe(false);
    if (!semEvento.ok) expect(semEvento.code).toBe('INVALID_INPUT');

    const atividadeErrada = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'ATTENDANCES_CSV',
      filters: { eventId: eventA, activityId: activityB1 },
    });

    expect(atividadeErrada.ok).toBe(false);
    if (!atividadeErrada.ok) expect(atividadeErrada.code).toBe('INVALID_INPUT');

    const eventoInexistente = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'ATTENDANCES_CSV',
      filters: { eventId: randomUUID() },
    });

    expect(eventoInexistente.ok).toBe(false);
    if (!eventoInexistente.ok) expect(eventoInexistente.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o evento em RASCUNHO exporta', () => {
  it('o `DRAFT` não impede nem o diretório recortado nem as presenças', async () => {
    const evento = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({ where: { id: eventDraft }, select: { status: true } }),
    );

    expect(evento.status).toBe('DRAFT');

    const participantes = await exportFile({
      kind: 'PARTICIPANTS_CSV',
      filters: { eventId: eventDraft },
    });

    const { rows: pessoas } = parseCsv(participantes.file.csv);

    expect(pessoas.some((row) => row['Nome'] === 'Bruno Recorte')).toBe(true);
    expect(participantes.file.csv).toContain(`# Filtros: Evento: ${TITULO_DRAFT}`);

    const presencas = await exportFile({ kind: 'ATTENDANCES_CSV', filters: { eventId: eventDraft } });
    const { rows: sessoes } = parseCsv(presencas.file.csv);

    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]?.['Pessoa']).toBe('Bruno Recorte');
    expect(sessoes[0]?.['Minutos']).toBe('60');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o teto e o `truncated`', () => {
  it('passa do teto: o pedido diz 5.000 linhas truncadas e o arquivo tem 5.000', async () => {
    const activityBig = await createActivity({
      eventId: eventBig,
      title: 'Atividade Longa',
      slug: 'longa',
      startsAt: new Date('2026-12-01T13:00:00Z'),
    });

    const pessoas = await Promise.all(
      Array.from({ length: 20 }, (_, index) => createUser(`Pessoa ${index} do Grande`)),
    );

    /**
     * 5.001 sessões = uma a mais que o teto. Cada linha é uma sessão real (a mesma
     * pessoa em horários diferentes), e é isso que o teto corta — não a pessoa.
     */
    await withTenant(tenantId, (tx) =>
      tx.attendance.createMany({
        data: Array.from({ length: CSV_MAX_ROWS + 1 }, (_, index) => ({
          id: randomUUID(),
          tenantId,
          eventId: eventBig,
          activityId: activityBig,
          userId: pessoas[index % pessoas.length] as string,
          status: 'PRESENT' as const,
          source: 'IMPORTS' as const,
          checkedInAt: new Date(Date.parse('2026-12-01T13:00:00Z') + index * 60_000),
          checkedOutAt: new Date(Date.parse('2026-12-01T13:30:00Z') + index * 60_000),
          minutesAttended: 30,
        })),
      }),
    );

    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'ATTENDANCES_CSV',
      filters: { eventId: eventBig },
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    /** O PEDIDO já nasce sabendo que o arquivo não é o conjunto inteiro. */
    expect(created.rowCount).toBe(CSV_MAX_ROWS);
    expect(created.truncated).toBe(true);

    const file = await buildDataExportFile({
      tenantId,
      exportId: created.exportId,
      tenantSlug,
      actorId: ana,
    });

    expect(file.ok, file.ok ? 'ok' : file.message).toBe(true);
    if (!file.ok) return;

    expect(file.truncated).toBe(true);
    expect(file.rowCount).toBe(CSV_MAX_ROWS);

    const { rows } = parseCsv(file.csv);

    expect(rows).toHaveLength(CSV_MAX_ROWS);
  });

  it('abaixo do teto, `truncated` é falso e as linhas são as que existem', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'ATTENDANCES_CSV',
      filters: { eventId: eventA },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.rowCount).toBe(4);
    expect(created.truncated).toBe(false);
  });
});
