/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — O ENDEREÇO DA SALA ONLINE (FASE 68 · fatias 2 e 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (e por que cada um existe)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o **ESCRITOR** que a coluna `Event.onlineUrl` não tinha (fatia 0 mediu: um leitor
 *    e zero escritores) e o **campo novo** da atividade, gravados pelos SERVIÇOS reais
 *    (`saveEvent`, `saveActivity`) — e lidos de volta pelo painel (`getAdminEvent`);
 *  • a **recusa** de `javascript:` e `data:`, provada dos DOIS lados: o endereço bom
 *    entra e o ruim não (negativa só depois da positiva — a regra da casa);
 *  • a **visibilidade por estado de inscrição** contra o banco: confirmada vê, retendo
 *    vaga vê, **espera não vê**, equipe vê, anônimo não vê;
 *  • o **ISOLAMENTO entre instituições**: a mesma pessoa, inscrita na instituição A,
 *    não vê o endereço quando a leitura acontece sob a instituição B — a RLS devolve
 *    nada, e "nada" é "não vê";
 *  • o **interruptor da chamada** ligado pelo fato (FASE 68, ajuste autorizado):
 *    criar e publicar uma chamada ligam `Event.usesCall`; despublicar NÃO desliga.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getAdminEvent, saveActivity, saveEvent } from '../../src/lib/admin/catalog-service';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import {
  applyOnlineRoomVisibility,
  resolveOnlineRoomViewer,
} from '../../src/lib/events/online-room-service';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

/** Os endereços do cenário — distintos para que a prova diga QUAL deles vazou. */
const ENDERECO_EVENTO = `https://sala.exemplo.test/evento-${RUN}`;
const ENDERECO_MINICURSO = `https://sala.exemplo.test/minicurso-${RUN}`;
const ENDERECO_ABERTA = `https://sala.exemplo.test/aberta-${RUN}`;

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let otherEventId: string;
let otherEventSlug: string;
/** Atividade com inscrição PRÓPRIA. */
let minicursoId: string;
/** Atividade ABERTA (o público dela é o do evento) — com endereço próprio. */
let abertaId: string;
/** Atividade sem endereço nenhum (o evento tem: ela NÃO herda). */
let semSalaId: string;
let orgId: string;
let confirmadaId: string;
let retendoId: string;
let esperaId: string;

const agora = new Date();
const eventStartsAt = new Date(agora.getTime() + 10 * 86_400_000);
const eventEndsAt = new Date(eventStartsAt.getTime() + 3 * 86_400_000);
const activityStartsAt = new Date(eventStartsAt.getTime() + 3_600_000);
const activityEndsAt = new Date(activityStartsAt.getTime() + 3_600_000);

async function criarUsuario(nome: string, role?: 'ORGANIZER'): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name: nome, email: `f68sala.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  if (role) {
    await withTenant(tenantId, (tx) =>
      tx.roleAssignment.create({
        data: { id: randomUUID(), tenantId, userId: id, role, scope: 'TENANT' },
      }),
    );
  }

  return id;
}

/** Uma inscrição no banco — o estado é o DADO do cenário, não o caminho da tela. */
async function inscrever(input: {
  userId: string;
  status: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'ATTENDED' | 'CANCELED';
  activityId?: string | null;
  tenant?: string;
  event?: string;
}): Promise<void> {
  const tenant = input.tenant ?? tenantId;
  const event = input.event ?? eventId;

  await withTenant(tenant, (tx) =>
    tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId: tenant,
        eventId: event,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: input.status,
      },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f68-sala-${RUN}`,
        name: `Instituição da Sala Online ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f68-sala-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    ],
  });

  orgId = await criarUsuario('Organizadora F68', 'ORGANIZER');
  confirmadaId = await criarUsuario('Inscrita confirmada');
  retendoId = await criarUsuario('Inscrita retendo vaga');
  esperaId = await criarUsuario('Inscrita na espera');

  /** O evento nasce pelo SERVIÇO — é ele o escritor que a fatia 2 criou. */
  const evento = await saveEvent({
    tenantId,
    actorId: orgId,
    slug: `evento-sala-${RUN}`,
    title: `Congresso com sala online ${RUN}`,
    status: 'REGISTRATION_OPEN',
    modality: 'ONLINE',
    startsAt: eventStartsAt,
    endsAt: eventEndsAt,
    timezone: TIME_ZONE,
    onlineUrl: ENDERECO_EVENTO,
  });

  expect(evento.ok, evento.ok ? 'ok' : evento.message).toBe(true);
  if (!evento.ok) throw new Error('o evento do cenário não foi criado');
  eventId = evento.eventId;

  const minicurso = await saveActivity({
    tenantId,
    actorId: orgId,
    eventId,
    slug: `minicurso-${RUN}`,
    title: 'Minicurso com sala própria',
    type: 'MINI_COURSE',
    status: 'SCHEDULED',
    modality: 'ONLINE',
    startsAt: activityStartsAt,
    endsAt: activityEndsAt,
    workloadMinutes: 60,
    capacity: 30,
    waitlistEnabled: true,
    requiresRegistration: true,
    onlineUrl: ENDERECO_MINICURSO,
  });

  expect(minicurso.ok, minicurso.ok ? 'ok' : minicurso.message).toBe(true);
  if (!minicurso.ok) throw new Error('o minicurso do cenário não foi criado');
  minicursoId = minicurso.activityId;

  const aberta = await saveActivity({
    tenantId,
    actorId: orgId,
    eventId,
    slug: `aberta-${RUN}`,
    title: 'Palestra aberta com sala online',
    type: 'LECTURE',
    status: 'SCHEDULED',
    modality: 'ONLINE',
    startsAt: activityStartsAt,
    endsAt: activityEndsAt,
    workloadMinutes: 60,
    capacity: 100,
    waitlistEnabled: false,
    requiresRegistration: false,
    onlineUrl: ENDERECO_ABERTA,
  });

  expect(aberta.ok, aberta.ok ? 'ok' : aberta.message).toBe(true);
  if (!aberta.ok) throw new Error('a atividade aberta do cenário não foi criada');
  abertaId = aberta.activityId;

  const semSala = await saveActivity({
    tenantId,
    actorId: orgId,
    eventId,
    slug: `sem-sala-${RUN}`,
    title: 'Atividade sem sala online',
    type: 'LECTURE',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: activityStartsAt,
    endsAt: activityEndsAt,
    workloadMinutes: 60,
    capacity: 100,
    waitlistEnabled: false,
    requiresRegistration: false,
  });

  expect(semSala.ok, semSala.ok ? 'ok' : semSala.message).toBe(true);
  if (!semSala.ok) throw new Error('a atividade sem sala não foi criada');
  semSalaId = semSala.activityId;

  /** Os estados de inscrição do cenário. */
  await inscrever({ userId: confirmadaId, status: 'CONFIRMED' });
  await inscrever({ userId: confirmadaId, status: 'CONFIRMED', activityId: minicursoId });

  await inscrever({ userId: retendoId, status: 'PENDING' });
  await inscrever({ userId: retendoId, status: 'PENDING', activityId: minicursoId });

  await inscrever({ userId: esperaId, status: 'WAITLISTED' });
  await inscrever({ userId: esperaId, status: 'WAITLISTED', activityId: minicursoId });

  /** O evento da instituição VIZINHA, onde a MESMA pessoa também tem inscrição. */
  const vizinho = await saveEvent({
    tenantId: otherTenantId,
    actorId: orgId,
    slug: `evento-vizinho-${RUN}`,
    title: `Evento da instituição vizinha ${RUN}`,
    status: 'REGISTRATION_OPEN',
    modality: 'ONLINE',
    startsAt: eventStartsAt,
    endsAt: eventEndsAt,
    timezone: TIME_ZONE,
    onlineUrl: 'https://sala.exemplo.test/vizinha',
  });

  expect(vizinho.ok, vizinho.ok ? 'ok' : vizinho.message).toBe(true);
  if (!vizinho.ok) throw new Error('o evento vizinho não foi criado');
  otherEventId = vizinho.eventId;
  otherEventSlug = `evento-vizinho-${RUN}`;

  await inscrever({
    userId: confirmadaId,
    status: 'CONFIRMED',
    tenant: otherTenantId,
    event: otherEventId,
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f68sala.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o escritor do endereço (fatia 2)', () => {
  it('o evento grava o endereço e o painel o lê de volta', async () => {
    const detalhe = await getAdminEvent(tenantId, eventId);

    expect(detalhe?.onlineUrl).toBe(ENDERECO_EVENTO);
  });

  it('a atividade grava o PRÓPRIO endereço — e não herda o do evento', async () => {
    const detalhe = await getAdminEvent(tenantId, eventId);

    const minicurso = detalhe?.activities.find((row) => row.id === minicursoId);
    const semSala = detalhe?.activities.find((row) => row.id === semSalaId);

    expect(minicurso?.onlineUrl).toBe(ENDERECO_MINICURSO);
    /** O evento tem endereço; esta atividade NÃO tem — e continua sem. */
    expect(semSala?.onlineUrl).toBeNull();
  });

  it('a projeção PÚBLICA carrega os dois endereços (a visibilidade é do chamador)', async () => {
    const publico = await getPublicEvent(tenantId, `evento-sala-${RUN}`);

    expect(publico?.onlineUrl).toBe(ENDERECO_EVENTO);

    const minicurso = publico?.activities.find((row) => row.id === minicursoId);
    const aberta = publico?.activities.find((row) => row.id == abertaId);

    expect(minicurso?.onlineUrl).toBe(ENDERECO_MINICURSO);
    expect(aberta?.onlineUrl).toBe(ENDERECO_ABERTA);
  });

  it('recusa javascript: e data: — o endereço não pode virar link executável', async () => {
    const script = await saveEvent({
      tenantId,
      actorId: orgId,
      slug: `evento-script-${RUN}`,
      title: 'Evento com endereço executável',
      status: 'DRAFT',
      modality: 'ONLINE',
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      timezone: TIME_ZONE,
      onlineUrl: 'javascript:alert(1)',
    });

    expect(script.ok).toBe(false);
    if (script.ok) return;
    expect(script.code).toBe('INVALID_INPUT');

    const dados = await saveActivity({
      tenantId,
      actorId: orgId,
      eventId,
      slug: `atividade-dados-${RUN}`,
      title: 'Atividade com data:',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'ONLINE',
      startsAt: activityStartsAt,
      endsAt: activityEndsAt,
      workloadMinutes: 60,
      capacity: 10,
      waitlistEnabled: false,
      onlineUrl: 'data:text/html,<script>alert(1)</script>',
    });

    expect(dados.ok).toBe(false);
    if (dados.ok) return;
    expect(dados.code).toBe('INVALID_INPUT');

    /** E NADA foi gravado: a atividade recusada não existe no painel. */
    const detalhe = await getAdminEvent(tenantId, eventId);

    expect(detalhe?.activities.some((row) => row.slug === `atividade-dados-${RUN}`)).toBe(false);
  });

  it('limpar o campo é uma edição legítima', async () => {
    const limpo = await saveEvent({
      tenantId,
      actorId: orgId,
      eventId,
      slug: `evento-sala-${RUN}`,
      title: `Congresso com sala online ${RUN}`,
      status: 'REGISTRATION_OPEN',
      modality: 'ONLINE',
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      timezone: TIME_ZONE,
      onlineUrl: '',
    });

    expect(limpo.ok, limpo.ok ? 'ok' : limpo.message).toBe(true);

    const detalhe = await getAdminEvent(tenantId, eventId);
    expect(detalhe?.onlineUrl).toBeNull();

    /** Devolve o endereço: o resto do arquivo mede a VISIBILIDADE dele. */
    const devolvido = await saveEvent({
      tenantId,
      actorId: orgId,
      eventId,
      slug: `evento-sala-${RUN}`,
      title: `Congresso com sala online ${RUN}`,
      status: 'REGISTRATION_OPEN',
      modality: 'ONLINE',
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      timezone: TIME_ZONE,
      onlineUrl: ENDERECO_EVENTO,
    });

    expect(devolvido.ok, devolvido.ok ? 'ok' : devolvido.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a visibilidade decidida no servidor (fatia 3)', () => {
  /** A projeção pública do evento, como a página a lê antes de decidir. */
  async function projetar(userId: string | null, tenant = tenantId, event = eventId) {
    const publico = await getPublicEvent(
      tenant,
      event === eventId ? `evento-sala-${RUN}` : otherEventSlug,
    );

    expect(publico, 'a projeção pública do cenário precisa existir').not.toBeNull();
    if (!publico) throw new Error('projeção ausente');

    const viewer = await resolveOnlineRoomViewer({ tenantId: tenant, eventId: event, userId });

    return applyOnlineRoomVisibility(publico, viewer);
  }

  it('o anônimo não vê o endereço do evento NEM o da atividade', async () => {
    const { event, byActivity } = await projetar(null);

    expect(event.onlineUrl).toBeNull();
    expect(byActivity.size).toBe(0);

    /** E o cartão da atividade também não carrega o endereço. */
    const minicurso = event.activities.find((row) => row.id === minicursoId);
    expect(minicurso?.onlineUrl).toBeNull();
  });

  it('a inscrição CONFIRMADA vê o do evento e o da atividade dela', async () => {
    const { event, byActivity } = await projetar(confirmadaId);

    expect(event.onlineUrl).toBe(ENDERECO_EVENTO);
    expect(byActivity.get(minicursoId)).toBe(ENDERECO_MINICURSO);

    /** A atividade ABERTA também: o público dela é o do evento, e ela tem endereço. */
    expect(byActivity.get(abertaId)).toBe(ENDERECO_ABERTA);

    /** A atividade sem endereço continua sem — não há o que mostrar. */
    expect(byActivity.has(semSalaId)).toBe(false);
  });

  it('quem RETÉM vaga (PENDING) vê — a vaga está reservada para ela', async () => {
    const { event, byActivity } = await projetar(retendoId);

    expect(event.onlineUrl).toBe(ENDERECO_EVENTO);
    expect(byActivity.get(minicursoId)).toBe(ENDERECO_MINICURSO);
  });

  it('a LISTA DE ESPERA não vê — nem o do evento, nem o da atividade', async () => {
    const { event, byActivity } = await projetar(esperaId);

    expect(event.onlineUrl).toBeNull();
    expect(byActivity.size).toBe(0);
  });

  it('a EQUIPE do evento vê, mesmo sem inscrição nenhuma', async () => {
    const { event, byActivity } = await projetar(orgId);

    expect(event.onlineUrl).toBe(ENDERECO_EVENTO);
    expect(byActivity.get(minicursoId)).toBe(ENDERECO_MINICURSO);
  });

  it('OUTRA INSTITUIÇÃO não vê: a mesma pessoa, lida sob a instituição vizinha', async () => {
    /**
     * ── A NEGATIVA VEM DEPOIS DA POSITIVA (a regra da casa) ────────────────────────
     *
     *  Primeiro a prova de que a leitura sob a instituição VIZINHA funciona: quem tem
     *  inscrição lá vê o endereço de LÁ. Sem esta linha, "não vê" seria indistinguível
     *  de uma consulta quebrada.
     */
    const naVizinha = await projetar(confirmadaId, otherTenantId, otherEventId);
    expect(naVizinha.event.onlineUrl).toBe('https://sala.exemplo.test/vizinha');

    /**
     * E agora o isolamento: quem só tem inscrição na instituição A (a prova positiva
     * está no caso anterior, onde esta mesma pessoa vê os endereços de A) não vê NADA
     * sob a instituição B — a RLS não devolve a inscrição, e "não devolve" é "não vê".
     */
    const soEmA = await projetar(retendoId, otherTenantId, otherEventId);

    expect(soEmA.event.onlineUrl).toBeNull();
    expect(soEmA.byActivity.size).toBe(0);

    /** E a equipe de A NÃO é equipe de B: o papel é por instituição. */
    const equipeDeA = await projetar(orgId, otherTenantId, otherEventId);
    expect(equipeDeA.event.onlineUrl).toBeNull();
  });

  it('a inscrição na ATIVIDADE não abre a sala de OUTRA atividade fechada', async () => {
    /**
     * A pessoa está inscrita no minicurso e NÃO na atividade fechada que o cenário
     * ainda vai criar: nenhuma inscrição no evento, nenhuma na atividade → o endereço
     * dela não aparece. É a régua por atividade, e não um "está inscrito em algo".
     */
    const fechada = await saveActivity({
      tenantId,
      actorId: orgId,
      eventId,
      slug: `fechada-${RUN}`,
      title: 'Oficina fechada com sala online',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'ONLINE',
      startsAt: activityStartsAt,
      endsAt: activityEndsAt,
      workloadMinutes: 60,
      capacity: 20,
      waitlistEnabled: false,
      requiresRegistration: true,
      onlineUrl: 'https://sala.exemplo.test/fechada',
    });

    expect(fechada.ok, fechada.ok ? 'ok' : fechada.message).toBe(true);
    if (!fechada.ok) return;

    /** Só a inscrição no minicurso existe para esta pessoa. */
    const soNoMinicurso = await criarUsuario('Inscrita só no minicurso');
    await inscrever({ userId: soNoMinicurso, status: 'CONFIRMED', activityId: minicursoId });

    const { byActivity } = await projetar(soNoMinicurso);

    expect(byActivity.get(minicursoId)).toBe(ENDERECO_MINICURSO);
    expect(byActivity.has(fechada.activityId)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a chamada liga o interruptor do evento (FASE 68, ajuste autorizado)', () => {
  it('criar uma chamada liga `usesCall`; publicar também; despublicar NÃO desliga', async () => {
    const eventoDaChamada = await saveEvent({
      tenantId,
      actorId: orgId,
      slug: `evento-chamada-${RUN}`,
      title: `Evento da chamada ${RUN}`,
      status: 'DRAFT',
      modality: 'IN_PERSON',
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      timezone: TIME_ZONE,
    });

    expect(eventoDaChamada.ok, eventoDaChamada.ok ? 'ok' : eventoDaChamada.message).toBe(true);
    if (!eventoDaChamada.ok) return;

    /** Nasce DESLIGADO (o `DEFAULT false` da coluna, a leitura conservadora). */
    const antes = await withTenant(tenantId, (tx) =>
      tx.event.findUniqueOrThrow({ where: { id: eventoDaChamada.eventId }, select: { usesCall: true } }),
    );
    expect(antes.usesCall).toBe(false);

    const chamada = await saveCall({
      tenantId,
      eventId: eventoDaChamada.eventId,
      actorId: orgId,
      kind: 'PAPER',
      slug: `chamada-${RUN}`,
      title: 'Chamada de artigos',
      opensAt: new Date(agora.getTime() - 86_400_000),
      closesAt: new Date(agora.getTime() + 30 * 86_400_000),
    });

    expect(chamada.ok, chamada.ok ? 'ok' : chamada.message).toBe(true);
    if (!chamada.ok) return;

    const depoisDeCriar = await withTenant(tenantId, (tx) =>
      tx.event.findUniqueOrThrow({ where: { id: eventoDaChamada.eventId }, select: { usesCall: true } }),
    );
    expect(depoisDeCriar.usesCall).toBe(true);

    /**
     * Desligar à mão e PUBLICAR: o fato religa. É o caso real do organizador que
     * desmarcou a caixa e depois colocou a chamada no ar.
     */
    await withTenant(tenantId, (tx) =>
      tx.event.update({ where: { id: eventoDaChamada.eventId }, data: { usesCall: false } }),
    );

    await setCallPublished({
      tenantId,
      eventId: eventoDaChamada.eventId,
      callId: chamada.callId,
      actorId: orgId,
      isPublished: true,
    });

    const depoisDePublicar = await withTenant(tenantId, (tx) =>
      tx.event.findUniqueOrThrow({ where: { id: eventoDaChamada.eventId }, select: { usesCall: true } }),
    );
    expect(depoisDePublicar.usesCall).toBe(true);

    /** E DESPUBLICAR não apaga a declaração do organizador. */
    await setCallPublished({
      tenantId,
      eventId: eventoDaChamada.eventId,
      callId: chamada.callId,
      actorId: orgId,
      isPublished: false,
    });

    const depoisDeDespublicar = await withTenant(tenantId, (tx) =>
      tx.event.findUniqueOrThrow({ where: { id: eventoDaChamada.eventId }, select: { usesCall: true } }),
    );
    expect(depoisDeDespublicar.usesCall).toBe(true);
  });
});
