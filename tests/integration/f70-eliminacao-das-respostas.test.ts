/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — A ELIMINAÇÃO DAS RESPOSTAS (FASE 70 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES CASOS PRENDEM, CONTRA O PostgreSQL REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • apagar as respostas NÃO cancela a inscrição, NÃO devolve a vaga e NÃO mexe no
 *      status — o que sai é o conteúdo pessoal, não o fato de a pessoa estar inscrita;
 *    • o que é OBRIGAÇÃO do evento fica: o CPF (base do certificado) e os
 *      consentimentos (a prova de que o tratamento foi autorizado);
 *    • a nota de acessibilidade sai de TODAS as linhas da pessoa no evento — a do
 *      evento e a cópia que a inscrição automática deixou na atividade aberta;
 *    • é IDEMPOTENTE: apagar duas vezes não muda o dado nem inventa um fato na trilha;
 *    • o ATO entra na trilha com as CHAVES, e nunca com os valores;
 *    • OUTRA PESSOA não apaga o meu: o `userId` vem da sessão, e o `where` é quem
 *      garante — não existe campo de alvo por onde nomear a inscrição de alguém.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveActivity, saveEvent } from '../../src/lib/admin/catalog-service';
import { applyRegistrationFormOperationOnEvent } from '../../src/lib/admin/registration-form-service';
import { registerForEvent } from '../../src/lib/events/registration-service';
import { eraseMyFormResponses } from '../../src/lib/events/registration-response-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let organizerId: string;
let eventId: string;
let eventSlug: string;
let activityId: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f70erase.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

/** A linha da pessoa no EVENTO, com o que a eliminação precisa mostrar. */
async function eventLineOf(userId: string) {
  return withTenant(tenantId, (tx) =>
    tx.registration.findFirstOrThrow({
      where: { eventId, userId, activityId: null, deletedAt: null },
      select: {
        id: true,
        status: true,
        formResponses: true,
        accessibilityNotes: true,
        consentData: true,
        consentImage: true,
      },
    }),
  );
}

/** A linha criada automaticamente na ATIVIDADE ABERTA (a cópia da nota). */
async function activityLineOf(userId: string) {
  return withTenant(tenantId, (tx) =>
    tx.registration.findFirstOrThrow({
      where: { eventId, userId, activityId },
      select: { id: true, status: true, accessibilityNotes: true, formResponses: true },
    }),
  );
}

async function eventCounters() {
  return withTenant(tenantId, (tx) =>
    tx.event.findFirstOrThrow({ where: { id: eventId }, select: { confirmedCount: true } }),
  );
}

/** As entradas da trilha desta inscrição, da mais recente para a mais antiga. */
async function auditFor(registrationId: string) {
  return withTenant(tenantId, (tx) =>
    tx.auditLog.findMany({
      where: { entityType: 'registration', entityId: registrationId },
      orderBy: { createdAt: 'desc' },
      select: { action: true, changes: true },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f70-erase-${RUN}`,
      name: `Instituição da Eliminação ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
      maxEvents: 50,
    },
  });

  organizerId = await createUser('organizadora');

  const event = await saveEvent({
    tenantId,
    actorId: organizerId,
    slug: `evento-erase-${RUN}`,
    title: `Evento da Eliminação ${RUN}`,
    status: 'REGISTRATION_OPEN',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(30),
    endsAt: daysFromNow(33),
    timezone: TIME_ZONE,
    capacity: null,
    registrationOpensAt: daysFromNow(-1),
    registrationClosesAt: daysFromNow(20),
    registrationRequiresMembership: false,
  });

  if (!event.ok) throw new Error(`Falha ao criar o evento: ${event.message}`);

  eventId = event.eventId;
  eventSlug = `evento-erase-${RUN}`;

  /**
   * O formulário entra pelo SERVIÇO REAL do organizador (`SAVE`), e não por um
   * `update` cru: é o caminho que a tela usa, e é ele que grava a lista validada em
   * `Event.settings`.
   */
  const saved = await applyRegistrationFormOperationOnEvent({
    tenantId,
    actorId: organizerId,
    eventId,
    operation: {
      kind: 'SAVE',
      originalKey: null,
      field: {
        key: 'restricao',
        label: 'Restrição alimentar',
        type: 'SHORT_TEXT',
        required: false,
      },
    },
  });

  if (!saved.ok) throw new Error(`Falha ao declarar o campo: ${saved.message}`);

  /**
   * A atividade é ABERTA de propósito: a inscrição no evento inscreve a pessoa nela
   * automaticamente, e é aí que a nota de acessibilidade ganha uma CÓPIA numa segunda
   * linha — a que prova que a eliminação varre todas as linhas da pessoa no evento.
   */
  const activity = await saveActivity({
    tenantId,
    actorId: organizerId,
    eventId,
    slug: `palestra-erase-${RUN}`,
    title: `Palestra da Eliminação ${RUN}`,
    type: 'LECTURE',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(31),
    endsAt: new Date(daysFromNow(31).getTime() + 3_600_000),
    workloadMinutes: 60,
    capacity: null,
    waitlistEnabled: false,
    requiresRegistration: false,
    confirmationPolicy: 'AUTO',
    confirmationWindowDays: null,
  });

  if (!activity.ok) throw new Error(`Falha ao criar a atividade: ${activity.message}`);

  activityId = activity.activityId;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f70erase.${RUN}` } } });
});

describe('a eliminação das respostas do formulário', () => {
  it('apaga o que a pessoa respondeu, preserva o CPF e NÃO cancela a inscrição', async () => {
    const pessoa = await createUser('a');

    const inscricao = await registerForEvent({
      tenantId,
      eventSlug,
      userId: pessoa,
      consentData: true,
      consentImage: true,
      accessibilityNotes: 'Preciso de rampa de acesso',
      formResponses: { restricao: 'Sem glúten', cpf: '52998224725' },
    });

    expect(inscricao.ok, inscricao.ok ? 'ok' : inscricao.message).toBe(true);

    const antes = await eventLineOf(pessoa);
    expect(antes.formResponses).toEqual({ restricao: 'Sem glúten', cpf: '52998224725' });
    expect((await eventCounters()).confirmedCount).toBe(1);

    /** A cópia na atividade aberta — o que a varredura precisa alcançar também. */
    const copia = await activityLineOf(pessoa);
    expect(copia.accessibilityNotes).toBe('Preciso de rampa de acesso');

    const erased = await eraseMyFormResponses({ tenantId, userId: pessoa, eventSlug });

    expect(erased.ok, erased.ok ? 'ok' : erased.message).toBe(true);
    if (!erased.ok) return;

    expect(erased.erased).toBe(true);
    expect([...erased.removedKeys].sort()).toEqual(['restricao']);
    expect(erased.clearedAccessibilityNotes).toBe(2);

    const depois = await eventLineOf(pessoa);

    /** O CPF FICA: é a base do certificado. */
    expect(depois.formResponses).toEqual({ cpf: '52998224725' });
    /** A nota de acessibilidade sai — é dado pessoal da mesma família. */
    expect(depois.accessibilityNotes).toBeNull();
    /** Os CONSENTIMENTOS ficam: são colunas, e são a prova da autorização. */
    expect(depois.consentData).toBe(true);
    expect(depois.consentImage).toBe(true);
    /** A inscrição continua viva, e a vaga continua ocupada. */
    expect(depois.status).toBe('CONFIRMED');
    expect((await eventCounters()).confirmedCount).toBe(1);

    /** E a cópia na atividade aberta perdeu a nota junto — nada ficou para trás. */
    const copiaDepois = await activityLineOf(pessoa);
    expect(copiaDepois.accessibilityNotes).toBeNull();
    expect(copiaDepois.status).toBe('CONFIRMED');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A TRILHA GUARDA O ATO E AS CHAVES — NUNCA OS VALORES
     * ─────────────────────────────────────────────────────────────────────────────
     *  Copiar "Sem glúten" para `audit_logs` seria transferir o dado pessoal para uma
     *  tabela que a instituição lê por outro caminho: o oposto do pedido da pessoa.
     */
    const trilha = await auditFor(depois.id);
    const eliminacao = trilha.find((entry) => entry.action === 'DELETE');

    expect(eliminacao).toBeDefined();
    expect(JSON.stringify(eliminacao?.changes)).toContain('restricao');
    expect(JSON.stringify(eliminacao?.changes)).not.toContain('Sem glúten');
  });

  it('é idempotente: apagar de novo não muda o dado nem inventa um fato na trilha', async () => {
    const pessoa = await createUser('b');

    await registerForEvent({
      tenantId,
      eventSlug,
      userId: pessoa,
      consentData: true,
      formResponses: { restricao: 'Vegano', cpf: '52998224725' },
    });

    const primeira = await eraseMyFormResponses({ tenantId, userId: pessoa, eventSlug });
    expect(primeira.ok && primeira.erased).toBe(true);

    const depoisDaPrimeira = await eventLineOf(pessoa);
    const trilhaDepoisDaPrimeira = await auditFor(depoisDaPrimeira.id);

    const segunda = await eraseMyFormResponses({ tenantId, userId: pessoa, eventSlug });

    expect(segunda.ok, segunda.ok ? 'ok' : segunda.message).toBe(true);
    if (!segunda.ok) return;

    /** Nada a apagar: nem campo removido, nem nota limpa. */
    expect(segunda.erased).toBe(false);
    expect(segunda.removedKeys).toEqual([]);
    expect(segunda.clearedAccessibilityNotes).toBe(0);

    /** O DADO é o mesmo — byte por byte do que interessa. */
    const depoisDaSegunda = await eventLineOf(pessoa);
    expect(depoisDaSegunda.formResponses).toEqual(depoisDaPrimeira.formResponses);
    expect(depoisDaSegunda.accessibilityNotes).toBe(depoisDaPrimeira.accessibilityNotes);
    expect(depoisDaSegunda.status).toBe(depoisDaPrimeira.status);

    /**
     * E a trilha ganha a entrada do SEGUNDO pedido, com "nada a apagar" — o PEDIDO é
     * fato auditável ("a pessoa pediu e o sistema atendeu?"), e sem ele não se
     * distinguiria "não pediu" de "pediu e já estava apagado".
     */
    const trilhaDepoisDaSegunda = await auditFor(depoisDaSegunda.id);
    expect(trilhaDepoisDaSegunda.length).toBe(trilhaDepoisDaPrimeira.length + 1);
    expect(JSON.stringify(trilhaDepoisDaSegunda[0]?.changes)).toContain('nada a apagar');
  });

  it('OUTRA PESSOA não apaga o meu — o alvo não é dado de entrada', async () => {
    const dono = await createUser('dono');
    const outra = await createUser('outra');

    await registerForEvent({
      tenantId,
      eventSlug,
      userId: dono,
      consentData: true,
      formResponses: { restricao: 'Sem lactose' },
    });

    await registerForEvent({
      tenantId,
      eventSlug,
      userId: outra,
      consentData: true,
      formResponses: { restricao: 'Sem açúcar' },
    });

    const doDono = await eventLineOf(dono);

    /** A outra pessoa está inscrita no MESMO evento e apaga o que é DELA. */
    const daOutra = await eraseMyFormResponses({ tenantId, userId: outra, eventSlug });
    expect(daOutra.ok && daOutra.erased).toBe(true);

    /** A minha inscrição continua intacta: a chamada não teve como apontar para ela. */
    const doDonoDepois = await eventLineOf(dono);
    expect(doDonoDepois.formResponses).toEqual({ restricao: 'Sem lactose' });
    expect(doDonoDepois.id).toBe(doDono.id);

    /** E o alvo da chamada foi a linha de quem chamou. */
    expect(daOutra.ok && daOutra.registrationId).toBe(
      (await eventLineOf(outra)).id,
    );
  });

  it('quem NÃO tem inscrição no evento não apaga nada (fail-closed)', async () => {
    const estranho = await createUser('estranho');

    const resultado = await eraseMyFormResponses({
      tenantId,
      userId: estranho,
      eventSlug,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.code).toBe('NOT_REGISTERED');
      expect(resultado.message).toMatch(/inscrição ativa/i);
    }

    /** E as inscrições das outras pessoas continuam como estavam. */
    const linhas = await withTenant(tenantId, (tx) =>
      tx.registration.count({ where: { eventId, userId: estranho } }),
    );
    expect(linhas).toBe(0);
  });

  it('evento inexistente é recusado, e não cria nada', async () => {
    const pessoa = await createUser('e');

    const resultado = await eraseMyFormResponses({
      tenantId,
      userId: pessoa,
      eventSlug: `nao-existe-${RUN}`,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('EVENT_NOT_FOUND');
  });
});
