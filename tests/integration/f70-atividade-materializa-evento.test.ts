/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — a inscrição na ATIVIDADE materializa a do EVENTO (FASE 70)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO MEDIDO (3 de 3 inscrições em atividade sem linha do evento)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem só entrava numa oficina ficava sem inscrição no evento — e o sistema não
 *  tinha como saber: o certificado de participação do evento saía sem CPF (o CPF só é
 *  lido da linha do evento), o painel contava linhas de dois níveis diferentes e a
 *  vaga do evento era reservada pela linha da atividade.
 *
 *  O que estes casos prendem, contra o PostgreSQL real:
 *    • a linha do evento NASCE com a inscrição na atividade, com UMA reserva;
 *    • é IDEMPOTENTE por `(eventId, userId)` — nem sob concorrência;
 *    • evento lotado NÃO recusa a atividade: enfileira no evento e confirma a oficina;
 *    • a promoção da fila do evento promove e a atividade segue;
 *    • `registrationRequiresMembership` recusa NO SERVIDOR (o serviço, não a tela);
 *    • o certificado de participação do evento não sai por presença em ATIVIDADE.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveActivity, saveEvent } from '../../src/lib/admin/catalog-service';
import {
  cancelRegistration,
  registerForActivity,
  registerForEvent,
  updateEventRegistrationData,
} from '../../src/lib/events/registration-service';
import { checkIn } from '../../src/lib/events/attendance-service';
import { requestCertificate } from '../../src/lib/certificates/certificate-service';
import { eventHasWaitlist } from '../../src/domain/events/registration-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let organizerId: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f70.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

/** Evento criado pelo SERVIÇO real — é o caminho da tela, inclusive nas settings. */
async function createEvent(input: {
  slug: string;
  capacity?: number | null;
  requiresMembership?: boolean;
}): Promise<string> {
  const result = await saveEvent({
    tenantId,
    actorId: organizerId,
    slug: input.slug,
    title: `Evento ${input.slug}`,
    status: 'REGISTRATION_OPEN',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(30),
    endsAt: daysFromNow(33),
    timezone: TIME_ZONE,
    capacity: input.capacity ?? null,
    registrationOpensAt: daysFromNow(-1),
    registrationClosesAt: daysFromNow(20),
    registrationRequiresMembership: input.requiresMembership ?? false,
  });

  if (!result.ok) throw new Error(`Falha ao criar o evento: ${result.message}`);
  return result.eventId;
}

/** Atividade COM inscrição própria — é a porta que a fase conserta. */
async function createActivity(input: {
  eventId: string;
  slug: string;
  capacity?: number | null;
}): Promise<string> {
  const result = await saveActivity({
    tenantId,
    actorId: organizerId,
    eventId: input.eventId,
    slug: input.slug,
    title: `Oficina ${input.slug}`,
    type: 'WORKSHOP',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(31),
    endsAt: new Date(daysFromNow(31).getTime() + 3_600_000),
    workloadMinutes: 60,
    capacity: input.capacity ?? null,
    waitlistEnabled: false,
    requiresRegistration: true,
    confirmationPolicy: 'AUTO',
    confirmationWindowDays: null,
  });

  if (!result.ok) throw new Error(`Falha ao criar a atividade: ${result.message}`);
  return result.activityId;
}

/** Contadores do evento e de cada atividade, para a conta fechar dos dois lados. */
async function counters(eventId: string, activityIds: readonly string[]) {
  return withTenant(tenantId, async (tx) => {
    const event = await tx.event.findFirstOrThrow({
      where: { id: eventId },
      select: { confirmedCount: true },
    });

    const activities = await tx.activity.findMany({
      where: { id: { in: [...activityIds] } },
      select: { id: true, confirmedCount: true },
    });

    return {
      event: event.confirmedCount,
      activities: Object.fromEntries(activities.map((row) => [row.id, row.confirmedCount])),
    };
  });
}

async function eventLineOf(userId: string, eventId: string) {
  return withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { eventId, userId, activityId: null, deletedAt: null },
      select: { id: true, status: true, origin: true, waitlistPosition: true, formResponses: true },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f70-${RUN}`,
      name: `Instituição da Fase 70 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
      /**
       * ── SEM QUOTA DE EVENTOS, DE PROPÓSITO ──────────────────────────────────────
       *  Cada caso desta suíte monta o PRÓPRIO evento: a lotação do evento e a
       *  restrição à comunidade são o cenário, e um evento compartilhado faria um caso
       *  consumir a vaga do seguinte (o mesmo cuidado que a suíte da revisão da FASE 3
       *  tomou). A quota do plano não é o assunto aqui, e o teto de 3 eventos do plano
       *  tornaria a suíte dependente da ORDEM dos casos.
       */
      maxEvents: 50,
    },
  });

  organizerId = await createUser('organizadora');
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f70.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a inscrição na atividade materializa a inscrição no evento', () => {
  it('cria a linha do evento com UMA reserva, e não duas', async () => {
    const eventId = await createEvent({ slug: `evento-a-${RUN}` });
    const activityId = await createActivity({ eventId, slug: `oficina-a-${RUN}`, capacity: 5 });
    const pessoa = await createUser('a');

    const result = await registerForActivity({
      tenantId,
      eventSlug: `evento-a-${RUN}`,
      activitySlug: `oficina-a-${RUN}`,
      userId: pessoa,
      consentData: true,
      consentImage: true,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    /** A resposta continua falando da ATIVIDADE — quem pediu foi ela. */
    expect(result.status).toBe('CONFIRMED');
    expect(result.registrationId).not.toBe('');

    const linhaDoEvento = await eventLineOf(pessoa, eventId);
    expect(linhaDoEvento).not.toBeNull();
    expect(linhaDoEvento?.status).toBe('CONFIRMED');
    /** `EVENT_AUTO`: nasceu da inscrição na atividade, e não de um pedido ao evento. */
    expect(linhaDoEvento?.origin).toBe('EVENT_AUTO');

    /** Os consentimentos são HERDADOS do formulário da atividade (mesmos dois). */
    const consentimentos = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { id: linhaDoEvento!.id },
        select: { consentData: true, consentImage: true },
      }),
    );
    expect(consentimentos.consentData).toBe(true);
    expect(consentimentos.consentImage).toBe(true);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CONTA FECHA DOS DOIS LADOS — E NÃO COBRA DUAS VAGAS
     * ─────────────────────────────────────────────────────────────────────────────
     *  A vaga do evento saiu da linha da atividade e passou para a do evento. Se as
     *  duas reservassem, este número seria 2 e o evento "encolheria" duas vezes por
     *  pessoa. A atividade reserva a vaga DELA, que é outra lotação.
     */
    const after = await counters(eventId, [activityId]);
    expect(after.event).toBe(1);
    expect(after.activities[activityId]).toBe(1);

    /** E a lista pessoal mostra as duas linhas, com os marcadores que a tela usa. */
    const total = await withTenant(tenantId, (tx) =>
      tx.registration.count({ where: { eventId, userId: pessoa, deletedAt: null } }),
    );
    expect(total).toBe(2);
  });

  it('é idempotente: inscrever na segunda atividade não cria uma segunda linha do evento', async () => {
    const eventId = await createEvent({ slug: `evento-b-${RUN}` });
    const primeira = await createActivity({ eventId, slug: `oficina-b1-${RUN}`, capacity: 5 });
    const segunda = await createActivity({ eventId, slug: `oficina-b2-${RUN}`, capacity: 5 });
    const pessoa = await createUser('b');

    const um = await registerForActivity({
      tenantId,
      eventSlug: `evento-b-${RUN}`,
      activitySlug: `oficina-b1-${RUN}`,
      userId: pessoa,
    });
    const dois = await registerForActivity({
      tenantId,
      eventSlug: `evento-b-${RUN}`,
      activitySlug: `oficina-b2-${RUN}`,
      userId: pessoa,
    });

    expect(um.ok && dois.ok).toBe(true);

    const linhasDoEvento = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { eventId, userId: pessoa, activityId: null, deletedAt: null },
        select: { id: true },
      }),
    );

    expect(linhasDoEvento).toHaveLength(1);

    /** A reserva também não se repete: uma pessoa, um lugar. */
    const after = await counters(eventId, [primeira, segunda]);
    expect(after.event).toBe(1);
    expect(after.activities[primeira]).toBe(1);
    expect(after.activities[segunda]).toBe(1);

    /** Repetir a MESMA inscrição não muda nada (a linha é viva e o índice recusa). */
    const tres = await registerForActivity({
      tenantId,
      eventSlug: `evento-b-${RUN}`,
      activitySlug: `oficina-b1-${RUN}`,
      userId: pessoa,
    });
    expect(tres.ok).toBe(false);
    if (!tres.ok) expect(tres.code).toBe('DUPLICATE');

    const depois = await counters(eventId, [primeira, segunda]);
    expect(depois.event).toBe(1);
  });

  it('quem JÁ tem a linha do evento não ganha outra nem reserva de novo', async () => {
    const eventId = await createEvent({ slug: `evento-c-${RUN}` });
    const activityId = await createActivity({ eventId, slug: `oficina-c-${RUN}`, capacity: 5 });
    const pessoa = await createUser('c');

    /** Primeiro a inscrição no EVENTO (a outra porta), com CPF no formulário. */
    const noEvento = await registerForEvent({
      tenantId,
      eventSlug: `evento-c-${RUN}`,
      userId: pessoa,
      consentData: true,
      formResponses: { cpf: '529.982.247-25' },
    });

    expect(noEvento.ok, noEvento.ok ? 'ok' : noEvento.message).toBe(true);

    const depoisDoEvento = await counters(eventId, [activityId]);
    expect(depoisDoEvento.event).toBe(1);

    /** Depois a ATIVIDADE: a linha do evento já existe e continua sendo a dela. */
    const naAtividade = await registerForActivity({
      tenantId,
      eventSlug: `evento-c-${RUN}`,
      activitySlug: `oficina-c-${RUN}`,
      userId: pessoa,
    });

    expect(naAtividade.ok, naAtividade.ok ? 'ok' : naAtividade.message).toBe(true);

    const linhas = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { eventId, userId: pessoa, activityId: null, deletedAt: null },
        select: { origin: true, formResponses: true },
      }),
    );

    expect(linhas).toHaveLength(1);
    /** A linha do EVENTO não é reescrita: continua a do pedido, com o CPF digitado. */
    expect(linhas[0]?.origin).toBe('INDIVIDUAL');
    expect(linhas[0]?.formResponses).toMatchObject({ cpf: '529.982.247-25' });

    const depois = await counters(eventId, [activityId]);
    expect(depois.event).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evento lotado não recusa a atividade — enfileira', () => {
  it('põe a pessoa na FILA do evento e confirma a oficina', async () => {
    const eventId = await createEvent({ slug: `evento-d-${RUN}`, capacity: 1 });
    const activityId = await createActivity({ eventId, slug: `oficina-d-${RUN}`, capacity: 5 });

    const ocupanteDoEvento = await createUser('d-ocupante');
    const pessoa = await createUser('d-fila');

    /** A única vaga do evento vai para quem se inscreveu nele. */
    const primeiro = await registerForEvent({
      tenantId,
      eventSlug: `evento-d-${RUN}`,
      userId: ocupanteDoEvento,
      consentData: true,
    });
    expect(primeiro.ok && !primeiro.waitlisted).toBe(true);

    const result = await registerForActivity({
      tenantId,
      eventSlug: `evento-d-${RUN}`,
      activitySlug: `oficina-d-${RUN}`,
      userId: pessoa,
      consentData: true,
    });

    /** A OFICINA segue: tinha vaga própria, e é isso que a pessoa pediu. */
    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('CONFIRMED');

    /** E ela existe no evento como FILA, com posição — a demanda não se perde. */
    const linhaDoEvento = await eventLineOf(pessoa, eventId);
    expect(linhaDoEvento).not.toBeNull();
    expect(linhaDoEvento?.status).toBe('WAITLISTED');
    expect(linhaDoEvento?.waitlistPosition).toBe(1);

    /** O contador do evento conta quem OCUPA lugar: o da fila não ocupa. */
    const after = await counters(eventId, [activityId]);
    expect(after.event).toBe(1);
    expect(after.activities[activityId]).toBe(1);
  });

  it('a promoção da fila do evento promove, e a atividade dela segue confirmada', async () => {
    const eventId = await createEvent({ slug: `evento-e-${RUN}`, capacity: 1 });
    const activityId = await createActivity({ eventId, slug: `oficina-e-${RUN}`, capacity: 5 });

    const ocupante = await createUser('e-ocupante');
    const naFila = await createUser('e-fila');

    const primeiro = await registerForEvent({
      tenantId,
      eventSlug: `evento-e-${RUN}`,
      userId: ocupante,
      consentData: true,
    });
    expect(primeiro.ok && !primeiro.waitlisted).toBe(true);
    if (!primeiro.ok) return;

    const daAtividade = await registerForActivity({
      tenantId,
      eventSlug: `evento-e-${RUN}`,
      activitySlug: `oficina-e-${RUN}`,
      userId: naFila,
      consentData: true,
    });
    expect(daAtividade.ok).toBe(true);

    const antes = await eventLineOf(naFila, eventId);
    expect(antes?.status).toBe('WAITLISTED');

    /** A vaga do evento é devolvida: quem esperava é chamado. */
    const cancelamento = await cancelRegistration({
      tenantId,
      registrationId: primeiro.registrationId,
      userId: ocupante,
    });
    expect(cancelamento.ok).toBe(true);
    if (!cancelamento.ok) return;

    expect(cancelamento.promoted.map((row) => row.registrationId)).toContain(antes!.id);

    const promovido = await eventLineOf(naFila, eventId);
    /** A promoção nasce `PENDING`: a vaga está RETIDA com quem foi chamado (E1). */
    expect(promovido?.status).toBe('PENDING');
    expect(promovido?.waitlistPosition).toBeNull();

    /** E a ATIVIDADE dela não foi tocada: a vaga da oficina é dela desde o começo. */
    const atividade = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { eventId, userId: naFila, activityId },
        select: { status: true },
      }),
    );
    expect(atividade.status).toBe('CONFIRMED');

    const after = await counters(eventId, [activityId]);
    expect(after.event).toBe(1);
    expect(after.activities[activityId]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evento restrito à comunidade', () => {
  it('recusa a inscrição NO SERVIDOR, com a mesma mensagem da tela', async () => {
    const eventId = await createEvent({ slug: `evento-f-${RUN}`, requiresMembership: true });
    const activityId = await createActivity({ eventId, slug: `oficina-f-${RUN}`, capacity: 5 });
    const deFora = await createUser('f-fora');

    /** A chamada é ao SERVIÇO, não à tela: é a brecha que a fase fecha. */
    const pelaAtividade = await registerForActivity({
      tenantId,
      eventSlug: `evento-f-${RUN}`,
      activitySlug: `oficina-f-${RUN}`,
      userId: deFora,
      consentData: true,
    });

    expect(pelaAtividade.ok).toBe(false);
    if (!pelaAtividade.ok) {
      expect(pelaAtividade.code).toBe('MEMBERSHIP_REQUIRED');
      expect(pelaAtividade.message).toMatch(/restrito à comunidade/i);
      expect(pelaAtividade.message).toContain(`Instituição da Fase 70 ${RUN}`);
    }

    const peloEvento = await registerForEvent({
      tenantId,
      eventSlug: `evento-f-${RUN}`,
      userId: deFora,
      consentData: true,
    });

    expect(peloEvento.ok).toBe(false);
    if (!peloEvento.ok) expect(peloEvento.code).toBe('MEMBERSHIP_REQUIRED');

    /** A recusa é ANTES de qualquer escrita: nenhuma linha, nenhuma vaga. */
    const linhas = await withTenant(tenantId, (tx) =>
      tx.registration.count({ where: { eventId, userId: deFora } }),
    );
    expect(linhas).toBe(0);

    const depois = await counters(eventId, [activityId]);
    expect(depois.event).toBe(0);
    expect(depois.activities[activityId]).toBe(0);

    /**
     * E quem TEM vínculo ativo entra pelas duas portas — a restrição recusa o de fora,
     * não tranca o evento.
     */
    await adminPrisma.userTenantProfile.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: deFora,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });

    const agoraVai = await registerForActivity({
      tenantId,
      eventSlug: `evento-f-${RUN}`,
      activitySlug: `oficina-f-${RUN}`,
      userId: deFora,
      consentData: true,
    });

    expect(agoraVai.ok, agoraVai.ok ? 'ok' : agoraVai.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o certificado do evento não sai por presença em atividade', () => {
  it('presença na OFICINA não é credenciamento no evento; com a linha do evento, sai', async () => {
    const eventId = await createEvent({ slug: `evento-g-${RUN}` });
    const activityId = await createActivity({ eventId, slug: `oficina-g-${RUN}`, capacity: 5 });
    const pessoa = await createUser('g');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A FIXTURE É A DO DEFEITO MEDIDO: LINHA DE ATIVIDADE E NENHUMA DO EVENTO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Ela é escrita DIRETO no banco de propósito: depois do conserto, o caminho do
     *  serviço não produz mais este estado, e o que precisa ser provado é que o
     *  CERTIFICADO não o aceita mais como participação no evento. Sem a fixture crua,
     *  este caso não teria como medir o antes.
     */
    const linhaDaAtividadeId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.registration.create({
        data: {
          id: linhaDaAtividadeId,
          tenantId,
          eventId,
          activityId,
          userId: pessoa,
          origin: 'INDIVIDUAL',
          status: 'CONFIRMED',
          consentData: true,
          consentAt: new Date(),
        },
      }),
    );

    /** A pessoa chega e é credenciada NA OFICINA (é o que a lista de presença faz). */
    const presenca = await checkIn({
      tenantId,
      registrationId: linhaDaAtividadeId,
      staffUserId: organizerId,
    });
    expect(presenca.ok, presenca.ok ? 'ok' : presenca.message).toBe(true);

    /**
     * O certificado de PARTICIPAÇÃO do EVENTO é RECUSADO: sem linha do evento não há
     * credenciamento no evento, e presença em atividade não é a mesma coisa (ADR-149).
     * Antes do conserto, esta chamada era aceita — e o documento saía sem CPF.
     */
    const soAtividade = await requestCertificate({
      tenantId,
      eventId,
      userId: pessoa,
      kind: 'PARTICIPATION',
    });

    expect(soAtividade.ok).toBe(false);
    if (!soAtividade.ok) {
      expect(soAtividade.code).toBe('NOT_ELIGIBLE');
      expect(soAtividade.message).toMatch(/credenciamento no evento/i);
    }

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  SEM A LINHA DO EVENTO NÃO HÁ O QUE COMPLETAR (FASE 70)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ação "Completar meus dados" casa a inscrição pelo `userId` da SESSÃO e exige
     *  que ela EXISTA. Sem a linha, a resposta é `NOT_REGISTERED` — e não uma linha
     *  criada de lado, que seria uma segunda porta para reservar vaga.
     */
    const semLinha = await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug: `evento-g-${RUN}`,
      consentImage: false,
      consentData: true,
      accessibilityNotes: null,
      formResponses: { cpf: '529.982.247-25' },
    });

    expect(semLinha.ok).toBe(false);
    if (!semLinha.ok) expect(semLinha.code).toBe('NOT_REGISTERED');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O CONSERTO: INSCREVER-SE NUMA ATIVIDADE MATERIALIZA A LINHA DO EVENTO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Uma SEGUNDA oficina de propósito: a primeira já tem linha viva, e repetir
     *  aquela inscrição é `DUPLICATE` (nada a ver com a linha do evento). O que se
     *  prende aqui é que a inscrição numa atividade devolve a linha do evento à pessoa
     *  que não tinha nenhuma.
     */
    const segundaOficinaId = await createActivity({
      eventId,
      slug: `oficina-g2-${RUN}`,
      capacity: 5,
    });

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-g-${RUN}`,
      activitySlug: `oficina-g2-${RUN}`,
      userId: pessoa,
      consentData: true,
    });

    expect(inscricao.ok, inscricao.ok ? 'ok' : inscricao.message).toBe(true);

    const linhaDoEvento = await eventLineOf(pessoa, eventId);
    expect(linhaDoEvento).not.toBeNull();
    expect(linhaDoEvento?.origin).toBe('EVENT_AUTO');

    /** Com a linha, completar os dados funciona — é a porta que faltava. */
    const completou = await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug: `evento-g-${RUN}`,
      consentImage: false,
      consentData: true,
      accessibilityNotes: null,
      formResponses: { cpf: '529.982.247-25' },
    });

    expect(completou.ok, completou.ok ? 'ok' : completou.message).toBe(true);

    const comCpf = await eventLineOf(pessoa, eventId);
    expect(comCpf?.formResponses).toMatchObject({ cpf: '529.982.247-25' });

    /** E o credenciamento NO EVENTO passa a ser registrável — a participação existe. */
    const credenciamento = await checkIn({
      tenantId,
      registrationId: comCpf!.id,
      staffUserId: organizerId,
    });
    expect(credenciamento.ok, credenciamento.ok ? 'ok' : credenciamento.message).toBe(true);

    const agoraSai = await requestCertificate({
      tenantId,
      eventId,
      userId: pessoa,
      kind: 'PARTICIPATION',
    });

    expect(agoraSai.ok, agoraSai.ok ? 'ok' : agoraSai.message).toBe(true);

    /** E a oficina da fixture continua confirmada: a segunda não desfez nada. */
    const primeira = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { id: linhaDaAtividadeId },
        select: { status: true },
      }),
    );
    expect(primeira.status).toBe('ATTENDED');

    const contadores = await counters(eventId, [activityId, segundaOficinaId]);
    /**
     * O contador da SEGUNDA oficina acompanha a inscrição feita pelo serviço. O da
     * PRIMEIRA não é medido aqui de propósito: ela foi escrita crua na fixture (sem
     * passar pelo serviço), então o contador dela nunca foi incrementado — medir isso
     * seria medir a fixture, e não a fase.
     */
    expect(contadores.activities[segundaOficinaId]).toBe(1);
    /** UMA reserva no evento, apesar das duas oficinas. */
    expect(contadores.event).toBe(1);
  });

  it('o caminho do SERVIÇO cria a linha do evento, e o CPF entra por "completar meus dados"', async () => {
    const eventId = await createEvent({ slug: `evento-h-${RUN}` });
    const activityId = await createActivity({ eventId, slug: `oficina-h-${RUN}`, capacity: 5 });
    const pessoa = await createUser('h');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-h-${RUN}`,
      activitySlug: `oficina-h-${RUN}`,
      userId: pessoa,
      consentData: true,
    });

    expect(inscricao.ok, inscricao.ok ? 'ok' : inscricao.message).toBe(true);

    /** A linha do evento nasceu da ATIVIDADE e vem sem CPF — o formulário não o tem. */
    const nasceu = await eventLineOf(pessoa, eventId);
    expect(nasceu).not.toBeNull();
    expect(nasceu?.origin).toBe('EVENT_AUTO');
    expect(nasceu?.formResponses).toEqual({});

    /**
     * E a segunda porta da inscrição no evento RESPONDE `DUPLICATE` — que é o motivo
     * de existir a porta de completar: recusar "inscrever de novo" é o certo, e a
     * pessoa precisa de outro caminho para o CPF.
     */
    const deNovo = await registerForEvent({
      tenantId,
      eventSlug: `evento-h-${RUN}`,
      userId: pessoa,
      consentData: true,
      formResponses: { cpf: '529.982.247-25' },
    });

    expect(deNovo.ok).toBe(false);
    if (!deNovo.ok) expect(deNovo.code).toBe('DUPLICATE');

    const completou = await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug: `evento-h-${RUN}`,
      consentImage: false,
      consentData: true,
      accessibilityNotes: 'Preciso de rampa de acesso',
      formResponses: { cpf: '529.982.247-25' },
    });

    expect(completou.ok, completou.ok ? 'ok' : completou.message).toBe(true);
    if (completou.ok) expect(completou.registrationId).toBe(nasceu!.id);

    const depois = await eventLineOf(pessoa, eventId);
    expect(depois?.formResponses).toMatchObject({ cpf: '529.982.247-25' });

    const anotacoes = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { id: nasceu!.id },
        select: { accessibilityNotes: true },
      }),
    );
    expect(anotacoes.accessibilityNotes).toBe('Preciso de rampa de acesso');

    /** Completar NÃO é se inscrever: nenhuma linha nova, nenhuma vaga nova. */
    const linhas = await withTenant(tenantId, (tx) =>
      tx.registration.count({ where: { eventId, userId: pessoa, deletedAt: null } }),
    );
    expect(linhas).toBe(2);

    const contadores = await counters(eventId, [activityId]);
    expect(contadores.event).toBe(1);

    /** E quem NÃO tem inscrição no evento não completa nada (posse conferida). */
    const estranho = await createUser('h-estranho');
    const semInscricao = await updateEventRegistrationData({
      tenantId,
      userId: estranho,
      eventSlug: `evento-h-${RUN}`,
      consentImage: false,
      consentData: true,
      accessibilityNotes: null,
      formResponses: { cpf: '529.982.247-25' },
    });

    expect(semInscricao.ok).toBe(false);
    if (!semInscricao.ok) expect(semInscricao.code).toBe('NOT_REGISTERED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O NÚMERO DA CAPACIDADE DO EVENTO (FASE 70 — o risco medido antes de codar)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `0` NÃO É `NULL`, E A DIFERENÇA DECIDE O CAMINHO DA ATIVIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A semântica é declarada no domínio (`registration-rules.ts`): `null` é ILIMITADA,
 *  `0` é ESGOTADA. O risco que a fase levantou foi o de a tela criar eventos com `0`
 *  por omissão — e aí o caminho da atividade seria recusado por "lotação do evento"
 *  desde o primeiro dia.
 *
 *  Os dois casos abaixo são a medição: o que a TELA grava quando o campo fica em
 *  branco, e o que acontece com a ATIVIDADE quando o evento está mesmo esgotado.
 */
describe('o número da capacidade do evento', () => {
  it('sem lotação declarada o evento nasce com NULL — o campo em branco não vira 0', async () => {
    /**
     * O CAMINHO É O DA TELA, e não um `create` cru: o formulário manda a string vazia,
     * a action a converte em `null` (`nullable(...) ? toInt(...) : null`, em
     * `admin-actions.ts`) e `saveEvent` grava `input.capacity ?? null`. O helper desta
     * suíte usa a MESMA regra, e é ela que este caso prende: `null` = ilimitada.
     */
    const eventId = await createEvent({ slug: `evento-capacidade-nula-${RUN}` });

    const event = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({ where: { id: eventId }, select: { capacity: true } }),
    );

    expect(event.capacity).toBeNull();
    /** E "ilimitada" é o que o domínio diz: o evento sem lotação não tem fila. */
    expect(eventHasWaitlist(event.capacity)).toBe(false);
  });

  it('capacity 0 é ESGOTADO — e mesmo assim NÃO recusa a atividade: ela entra na fila do evento', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O PIOR CASO, E ELE NÃO QUEBRA O INVARIANTE DA FASE
     * ─────────────────────────────────────────────────────────────────────────────
     *  Um evento com `0` está permanentemente esgotado (o predicado
     *  `SEAT_AVAILABLE_PREDICATE` exige `confirmedCount < capacity`). O invariante
     *  desta fase é "evento lotado NUNCA recusa a atividade" — e ele vale aqui também:
     *  a oficina é confirmada e a pessoa espera na FILA do evento.
     */
    const eventId = await createEvent({ slug: `evento-capacidade-zero-${RUN}`, capacity: 0 });
    const activityId = await createActivity({
      eventId,
      slug: `oficina-capacidade-zero-${RUN}`,
      capacity: 5,
    });
    const pessoa = await createUser('capacidade-zero');

    const result = await registerForActivity({
      tenantId,
      eventSlug: `evento-capacidade-zero-${RUN}`,
      activitySlug: `oficina-capacidade-zero-${RUN}`,
      userId: pessoa,
      consentData: true,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('CONFIRMED');

    const linhaDoEvento = await eventLineOf(pessoa, eventId);
    expect(linhaDoEvento?.status).toBe('WAITLISTED');

    const after = await counters(eventId, [activityId]);
    expect(after.event).toBe(0);
    expect(after.activities[activityId]).toBe(1);
  });
});
