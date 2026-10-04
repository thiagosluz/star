/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Favoritos e "minha grade" (FASE 65 · fatia 1) — banco real
 *
 *  O QUE ESTES TESTES PRENDEM (e por que cada um é um invariante, não um detalhe):
 *
 *    • FAVORITAR NÃO CONSOME VAGA. Com a atividade LOTADA (uma vaga, uma pessoa na
 *      fila), o favorito funciona e os contadores NÃO se movem: nem
 *      `confirmedCount`, nem `waitlistCount`, nem uma linha em `registrations`.
 *      É a regra mais importante da fatia — quem garante lugar é a inscrição.
 *    • Favoritar e desfavoritar são IDEMPOTENTES (dois toques não duplicam; dois
 *      "desfazer" não são erro).
 *    • A RLS é a fronteira: favorito de uma instituição é invisível na outra, e nem
 *      com o id da atividade na mão dá para marcar do lado de fora.
 *    • A GRADE é a UNIÃO com marcas, e o choque sai calculado — a mesma regra pura
 *      provada no teste de unidade, agora com dado que veio do banco.
 *
 *  A atividade em RASCUNHO aparece aqui de propósito: a programação pública a
 *  esconde, e a grade precisa se defender sozinha (inclusive de um favorito
 *  gravado por um caminho antigo).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  favoriteActivity,
  getMyAgenda,
  listMyFavoriteActivityIds,
  unfavoriteActivity,
} from '../../src/lib/events/agenda-service';
import { cancelRegistration, registerForActivity } from '../../src/lib/events/registration-service';
import { remainingSeats } from '../../src/domain/events/registration-rules';
import {
  agendaIcsToken,
  exportActivityIcs,
  exportAgendaIcs,
  resolveAgendaIcsUser,
} from '../../src/lib/events/agenda-export';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let vizinhoTenantId: string;

let participanteId: string;
let ocupanteId: string;
let esperaId: string;
let tardeId: string;
let vizinhoUsuarioId: string;

let eventoId: string;
let eventoVizinhoId: string;

let lotadaId: string;
let abertaId: string;
let sobrepostaId: string;
let rascunhoId: string;
let vizinhaId: string;

const EVENTO_SLUG = `f65-evento-${RUN}`;
const EVENTO_VIZINHO_SLUG = `f65-vizinho-${RUN}`;

/** 10:00 em Salvador (UTC-3). */
const DEZ_HORAS = new Date('2027-03-15T13:00:00.000Z');
/** 18:00 em Salvador. */
const DEZOITO_HORAS = new Date('2027-03-15T21:00:00.000Z');

async function criarPessoa(nome: string, tenant: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name: nome, email: `f65.${nome.toLowerCase().replace(/\W/g, '')}.${RUN}@exemplo.test` },
  });
  await adminPrisma.userTenantProfile.create({
    data: { tenantId: tenant, userId: id, status: 'ACTIVE', kind: 'PARTICIPANT' },
  });

  return id;
}

/** Lê os contadores da atividade direto do banco, sob o contexto do tenant. */
async function contadores(activityId: string): Promise<{
  confirmedCount: number;
  waitlistCount: number;
  capacity: number | null;
  inscricoes: number;
}> {
  return withTenant(tenantId, async (tx) => {
    const activity = await tx.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: { confirmedCount: true, waitlistCount: true, capacity: true },
    });

    const inscricoes = await tx.registration.count({ where: { activityId } });

    return {
      confirmedCount: activity.confirmedCount,
      waitlistCount: activity.waitlistCount,
      capacity: activity.capacity,
      inscricoes,
    };
  });
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f65-${RUN}`,
      name: `Instituição F65 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const vizinho = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f65-vizinho-${RUN}`,
      name: `Instituição Vizinha F65 ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  vizinhoTenantId = vizinho.id;

  participanteId = await criarPessoa('Participante', tenantId);
  ocupanteId = await criarPessoa('Ocupante', tenantId);
  esperaId = await criarPessoa('Espera', tenantId);
  tardeId = await criarPessoa('Tarde', tenantId);
  vizinhoUsuarioId = await criarPessoa('Vizinho', vizinhoTenantId);

  eventoId = randomUUID();
  eventoVizinhoId = randomUUID();
  lotadaId = randomUUID();
  abertaId = randomUUID();
  sobrepostaId = randomUUID();
  rascunhoId = randomUUID();
  vizinhaId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventoId,
        tenantId,
        slug: EVENTO_SLUG,
        title: `Congresso F65 ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2027-03-15T12:00:00.000Z'),
        endsAt: new Date('2027-03-17T21:00:00.000Z'),
        /**
         * `capacity: null` = evento SEM limite de vagas. NÃO é decorativo: o
         * `DEFAULT 0` da coluna significa ESGOTADO, e um evento criado sem esta
         * linha recusa qualquer inscrição com "A lotação total do evento foi
         * atingida" — o mesmo `null` ≠ `0` da lotação da atividade.
         */
        capacity: null,
        confirmedCount: 0,
      },
    });

    /**
     * A atividade LOTADA: UMA vaga e fila ligada. É o cenário em que "favoritar
     * consome vaga" apareceria na hora, se existisse.
     */
    await tx.activity.create({
      data: {
        id: lotadaId,
        tenantId,
        eventId: eventoId,
        slug: 'lotada',
        title: 'Oficina lotada',
        status: 'SCHEDULED',
        startsAt: DEZ_HORAS,
        endsAt: new Date('2027-03-15T14:00:00.000Z'),
        capacity: 1,
        waitlistEnabled: true,
      },
    });

    await tx.activity.create({
      data: {
        id: abertaId,
        tenantId,
        eventId: eventoId,
        slug: 'aberta',
        title: 'Palestra da noite',
        status: 'SCHEDULED',
        startsAt: DEZOITO_HORAS,
        endsAt: new Date('2027-03-15T22:00:00.000Z'),
        capacity: 10,
      },
    });

    /** Sobreposta à palestra da noite: 18:30 local. */
    await tx.activity.create({
      data: {
        id: sobrepostaId,
        tenantId,
        eventId: eventoId,
        slug: 'sobreposta',
        title: 'Mesa-redonda simultânea',
        status: 'SCHEDULED',
        startsAt: new Date('2027-03-15T21:30:00.000Z'),
        endsAt: new Date('2027-03-15T22:30:00.000Z'),
        capacity: 10,
      },
    });

    await tx.activity.create({
      data: {
        id: rascunhoId,
        tenantId,
        eventId: eventoId,
        slug: 'rascunho',
        title: 'Atividade ainda em rascunho',
        status: 'DRAFT',
        startsAt: new Date('2027-03-15T23:00:00.000Z'),
        endsAt: new Date('2027-03-15T23:30:00.000Z'),
      },
    });
  });

  await withTenant(vizinhoTenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventoVizinhoId,
        tenantId: vizinhoTenantId,
        slug: EVENTO_VIZINHO_SLUG,
        title: `Evento da vizinha ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2027-03-15T12:00:00.000Z'),
        endsAt: new Date('2027-03-17T21:00:00.000Z'),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: vizinhaId,
        tenantId: vizinhoTenantId,
        eventId: eventoVizinhoId,
        slug: 'vizinha',
        title: 'Atividade da vizinha',
        status: 'SCHEDULED',
        startsAt: DEZ_HORAS,
        endsAt: new Date('2027-03-15T14:00:00.000Z'),
        capacity: 10,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, vizinhoTenantId] } } });
  await adminPrisma.user.deleteMany({
    where: { id: { in: [participanteId, ocupanteId, esperaId, tardeId, vizinhoUsuarioId] } },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A REGRA MAIS IMPORTANTE DA FATIA
// ═══════════════════════════════════════════════════════════════════════════════
describe('favoritar NÃO consome vaga, quota nem lista de espera', () => {
  it('com a atividade LOTADA, o favorito funciona e a contagem de inscrições não se move', async () => {
    // A vaga é preenchida pelo MOTOR real de inscrição — não por `update` à mão.
    const ocupou = await registerForActivity({
      tenantId,
      eventSlug: EVENTO_SLUG,
      activitySlug: 'lotada',
      userId: ocupanteId,
    });
    expect(ocupou.ok).toBe(true);
    if (!ocupou.ok) return;
    expect(ocupou.status).toBe('CONFIRMED');

    // A segunda pessoa vai para a FILA (é o caminho normal de quem chega depois).
    const naFila = await registerForActivity({
      tenantId,
      eventSlug: EVENTO_SLUG,
      activitySlug: 'lotada',
      userId: esperaId,
    });
    expect(naFila.ok).toBe(true);
    if (!naFila.ok) return;
    expect(naFila.status).toBe('WAITLISTED');

    const antes = await contadores(lotadaId);
    expect(antes).toMatchObject({ confirmedCount: 1, waitlistCount: 1, capacity: 1, inscricoes: 2 });
    // NÃO HÁ VAGA: é esse o estado que torna o teste abaixo uma prova.
    expect(remainingSeats(antes.capacity, antes.confirmedCount)).toBe(0);

    const favorito = await favoriteActivity({
      tenantId,
      userId: participanteId,
      activityId: lotadaId,
    });
    expect(favorito).toEqual({ ok: true, created: true });

    const depois = await contadores(lotadaId);

    // 1. A contagem de inscrições NÃO mudou (nem a confirmada, nem a da fila)...
    expect(depois).toEqual(antes);
    expect(remainingSeats(depois.capacity, depois.confirmedCount)).toBe(0);

    // 2. ...e o favorito NÃO criou inscrição nenhuma para quem marcou.
    const inscricoesDaPessoa = await withTenant(tenantId, (tx) =>
      tx.registration.count({ where: { activityId: lotadaId, userId: participanteId } }),
    );
    expect(inscricoesDaPessoa).toBe(0);

    // 3. ...nem entrou na lista de espera (a fila continua com uma pessoa).
    const naFilaDaPessoa = await withTenant(tenantId, (tx) =>
      tx.registration.count({
        where: { activityId: lotadaId, userId: participanteId, status: 'WAITLISTED' },
      }),
    );
    expect(naFilaDaPessoa).toBe(0);

    // 4. O que EXISTE é a marca — uma linha em `activity_favorites`.
    const marcados = await withTenant(tenantId, (tx) =>
      tx.activityFavorite.count({ where: { activityId: lotadaId, userId: participanteId } }),
    );
    expect(marcados).toBe(1);
  });

  it('a atividade continua LOTADA para quem não se inscreveu (o favorito não abriu vaga)', async () => {
    // Uma pessoa NOVA, que ainda não tem inscrição nenhuma nesta atividade.
    const tentativa = await registerForActivity({
      tenantId,
      eventSlug: EVENTO_SLUG,
      activitySlug: 'lotada',
      userId: tardeId,
    });

    // Há fila ligada, então a resposta honesta é "fila" — e não uma vaga que o
    // favorito teria criado.
    expect(tentativa.ok).toBe(true);
    if (!tentativa.ok) return;
    expect(tentativa.status).toBe('WAITLISTED');
    expect(tentativa.remainingSeats).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Idempotência
// ═══════════════════════════════════════════════════════════════════════════════
describe('favoritar e desfavoritar são idempotentes', () => {
  it('marcar duas vezes não duplica; desmarcar duas vezes não é erro', async () => {
    const alvo = abertaId;

    expect(await favoriteActivity({ tenantId, userId: participanteId, activityId: alvo })).toEqual({
      ok: true,
      created: true,
    });
    expect(await favoriteActivity({ tenantId, userId: participanteId, activityId: alvo })).toEqual({
      ok: true,
      created: false,
    });

    const linhas = await withTenant(tenantId, (tx) =>
      tx.activityFavorite.count({ where: { activityId: alvo, userId: participanteId } }),
    );
    expect(linhas).toBe(1);

    expect(await unfavoriteActivity({ tenantId, userId: participanteId, activityId: alvo })).toEqual({
      ok: true,
      removed: true,
    });
    expect(await unfavoriteActivity({ tenantId, userId: participanteId, activityId: alvo })).toEqual({
      ok: true,
      removed: false,
    });

    // Volta a marcar: é o próximo passo do teste da grade (estado conhecido).
    await favoriteActivity({ tenantId, userId: participanteId, activityId: alvo });
  });

  it('atividade vazia é entrada inválida; inexistente não é marcável', async () => {
    expect(await favoriteActivity({ tenantId, userId: participanteId, activityId: '  ' })).toMatchObject(
      { ok: false, code: 'INVALID_INPUT' },
    );
    expect(await unfavoriteActivity({ tenantId, userId: participanteId, activityId: '' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(
      await favoriteActivity({ tenantId, userId: participanteId, activityId: randomUUID() }),
    ).toMatchObject({ ok: false, code: 'ACTIVITY_NOT_AVAILABLE' });
  });

  it('atividade em RASCUNHO não é marcável (a pessoa não pode ver o que não foi publicado)', async () => {
    expect(
      await favoriteActivity({ tenantId, userId: participanteId, activityId: rascunhoId }),
    ).toMatchObject({ ok: false, code: 'ACTIVITY_NOT_AVAILABLE' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Isolamento entre instituições
// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento por instituição (RLS + FORCE)', () => {
  it('o favorito de uma instituição é invisível na outra', async () => {
    // A vizinha tem o PRÓPRIO favorito, do próprio lado da fronteira.
    expect(
      await favoriteActivity({
        tenantId: vizinhoTenantId,
        userId: vizinhoUsuarioId,
        activityId: vizinhaId,
      }),
    ).toEqual({ ok: true, created: true });

    const doLadoVizinho = await listMyFavoriteActivityIds({
      tenantId: vizinhoTenantId,
      userId: vizinhoUsuarioId,
      eventId: eventoVizinhoId,
    });
    expect(doLadoVizinho).toEqual([vizinhaId]);

    // Procurar pelo NOSSO favorito do lado de lá devolve nada, e vice-versa.
    expect(
      await listMyFavoriteActivityIds({
        tenantId: vizinhoTenantId,
        userId: participanteId,
        eventId: eventoId,
      }),
    ).toEqual([]);

    const doNossoLado = await listMyFavoriteActivityIds({
      tenantId,
      userId: participanteId,
      eventId: eventoId,
    });
    expect(doNossoLado).toContain(abertaId);
    expect(doNossoLado).not.toContain(vizinhaId);

    // O evento da vizinha não existe para nós (e nem o nosso para ela).
    expect(
      await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoVizinhoId }),
    ).toBeNull();
    expect(
      await getMyAgenda({ tenantId: vizinhoTenantId, userId: vizinhoUsuarioId, eventId: eventoId }),
    ).toBeNull();
  });

  it('não dá para marcar — nem desmarcar — do lado de fora da instituição', async () => {
    expect(
      await favoriteActivity({ tenantId: vizinhoTenantId, userId: participanteId, activityId: abertaId }),
    ).toMatchObject({ ok: false, code: 'ACTIVITY_NOT_AVAILABLE' });

    // Desmarcar "funciona" como operação, mas afeta ZERO linhas: a RLS esconde a
    // linha do outro tenant, e o favorito continua de pé no dono.
    expect(
      await unfavoriteActivity({ tenantId: vizinhoTenantId, userId: participanteId, activityId: abertaId }),
    ).toEqual({ ok: true, removed: false });

    expect(
      await withTenant(tenantId, (tx) =>
        tx.activityFavorite.count({ where: { activityId: abertaId, userId: participanteId } }),
      ),
    ).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A grade
// ═══════════════════════════════════════════════════════════════════════════════
describe('"minha grade" lida do banco', () => {
  it('une favoritos e inscrições, com a marca de cada um e o choque já calculado', async () => {
    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: EVENTO_SLUG,
      activitySlug: 'sobreposta',
      userId: participanteId,
    });
    expect(inscricao.ok).toBe(true);

    const grade = await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoId });
    expect(grade).not.toBeNull();
    if (!grade) return;

    expect(grade.eventId).toBe(eventoId);
    expect(grade.timezone).toBe('America/Bahia');

    const porId = new Map(grade.entries.map((item) => [item.activityId, item]));

    expect(porId.get(abertaId)).toMatchObject({
      mark: 'FAVORITO',
      registered: false,
      favorited: true,
      registrationStatus: null,
    });
    expect(porId.get(sobrepostaId)).toMatchObject({
      mark: 'INSCRITO',
      registered: true,
      favorited: false,
      registrationStatus: 'CONFIRMED',
    });

    // Ordem por início: a oficina das 10:00, depois 18:00 e 18:30 (hora local).
    expect(grade.entries.map((item) => item.activityId)).toEqual([lotadaId, abertaId, sobrepostaId]);
    // Rótulo no FUSO DO EVENTO (21:00Z = 18:00 em Salvador).
    expect(porId.get(abertaId)?.startsAtLabel).toBe('15/03/2027, 18:00');

    // As duas se sobrepõem: o par sai pronto, e SÓ AVISA — nada foi bloqueado.
    expect(grade.clashes).toEqual([
      {
        firstActivityId: abertaId,
        secondActivityId: sobrepostaId,
        firstTitle: 'Palestra da noite',
        secondTitle: 'Mesa-redonda simultânea',
      },
    ]);
    expect(porId.get(abertaId)?.hasClash).toBe(true);
    expect(porId.get(sobrepostaId)?.hasClash).toBe(true);

    // A atividade em rascunho não entra, e a lotada (que a pessoa favoritou no
    // primeiro teste) aparece — sem lugar nenhum.
    expect(porId.has(rascunhoId)).toBe(false);
    expect(porId.get(lotadaId)).toMatchObject({ mark: 'FAVORITO', registered: false });
    expect(grade.counts).toMatchObject({ entries: 3, registered: 1, favorited: 2, both: 0, clashPairs: 1 });
  });

  it('marcar o que já estava inscrito vira "inscrito e favorito" — um item, não dois', async () => {
    expect(
      await favoriteActivity({ tenantId, userId: participanteId, activityId: sobrepostaId }),
    ).toEqual({ ok: true, created: true });

    const grade = await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoId });
    expect(grade).not.toBeNull();
    if (!grade) return;

    const sobreposta = grade.entries.find((item) => item.activityId === sobrepostaId);
    expect(sobreposta).toMatchObject({
      mark: 'INSCRITO_E_FAVORITO',
      registered: true,
      favorited: true,
    });
    expect(grade.counts).toMatchObject({ entries: 3, both: 1 });
    expect(grade.entries.filter((item) => item.activityId === sobrepostaId)).toHaveLength(1);
  });

  it('inscrição cancelada deixa de ser lugar — e a marca sobrevive pelo FAVORITO', async () => {
    const inscricao = await withTenant(tenantId, (tx) =>
      tx.registration.findFirst({
        where: { activityId: sobrepostaId, userId: participanteId, status: { not: 'CANCELED' } },
        select: { id: true },
      }),
    );
    expect(inscricao).not.toBeNull();

    const cancelou = await cancelRegistration({
      tenantId,
      registrationId: inscricao!.id,
      userId: participanteId,
      reason: 'Escolhi a palestra da noite',
    });
    expect(cancelou.ok).toBe(true);

    const grade = await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoId });
    expect(grade).not.toBeNull();
    if (!grade) return;

    const sobreposta = grade.entries.find((item) => item.activityId === sobrepostaId);
    // A marca continua (o favorito é independente da inscrição), mas o LUGAR sumiu.
    expect(sobreposta).toMatchObject({
      mark: 'FAVORITO',
      registered: false,
      registrationStatus: null,
    });
    expect(grade.counts).toMatchObject({ registered: 0, favorited: 3 });
  });

  it('favorito gravado por fora não revela atividade em RASCUNHO na grade', async () => {
    /**
     * Simula dado antigo/escrito por outro caminho: a linha existe, mas a
     * atividade não é pública. A grade tem de se defender SOZINHA — e se defende,
     * porque o filtro de visibilidade está na consulta do serviço E na regra pura.
     */
    const inseriu = await withTenant(tenantId, (tx) =>
      tx.activityFavorite.createMany({
        data: [{ tenantId, activityId: rascunhoId, userId: participanteId }],
        skipDuplicates: true,
      }),
    );
    expect(inseriu.count).toBe(1);

    const grade = await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoId });
    expect(grade).not.toBeNull();
    if (!grade) return;

    expect(grade.entries.some((item) => item.activityId === rascunhoId)).toBe(false);
    expect(
      await listMyFavoriteActivityIds({ tenantId, userId: participanteId, eventId: eventoId }),
    ).not.toContain(rascunhoId);

    // Desmarcar NÃO exige visibilidade — é assim que a limpeza é possível.
    expect(await unfavoriteActivity({ tenantId, userId: participanteId, activityId: rascunhoId })).toEqual({
      ok: true,
      removed: true,
    });
  });

  it('o favorito de OUTRA pessoa não entra na minha grade', async () => {
    const antes = await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoId });
    expect(antes).not.toBeNull();

    // A ocupante marca a palestra da noite. A minha grade não pode mudar por isso.
    expect(await favoriteActivity({ tenantId, userId: ocupanteId, activityId: abertaId })).toEqual({
      ok: true,
      created: true,
    });

    const depois = await getMyAgenda({ tenantId, userId: participanteId, eventId: eventoId });
    expect(depois?.entries).toEqual(antes?.entries);
    expect(depois?.counts).toEqual(antes?.counts);

    // E a lista DELA tem só o que ela marcou.
    expect(
      await listMyFavoriteActivityIds({ tenantId, userId: ocupanteId, eventId: eventoId }),
    ).toEqual([abertaId]);
  });

  it('evento ou atividade fora do contexto devolvem a resposta neutra, não um erro', async () => {
    expect(
      await getMyAgenda({ tenantId, userId: participanteId, eventId: randomUUID() }),
    ).toBeNull();
    expect(await getMyAgenda({ tenantId, userId: participanteId, eventId: '  ' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORTAÇÃO (FASE 65 · fatia 3) — a resolução do token e o arquivo, com banco real
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * A unidade já provou o token e o nome do arquivo; o E2E prova o conteúdo do `.ics`
 * pelo caminho do navegador. O que só o BANCO pode provar é o que está aqui:
 *
 *   1. o TOKEN resolve para a pessoa certa e NÃO resolve em outra instituição — a
 *      resolução passa por `withTenant`, e a RLS é a fronteira;
 *   2. o arquivo tem EXATAMENTE os itens da grade da tela (a mesma régua: rascunho
 *      fora, inscrição viva dentro) e o horário local no fuso do EVENTO.
 */
describe('exportação: o token e o arquivo da agenda', () => {
  /**
   * O valor de uma propriedade do `.ics`, com a DOBRA desfeita.
   *
   * O RFC 5545 quebra a linha a cada 75 octetos, e a continuação começa com um espaço —
   * então procurar "America/Bahia" no arquivo CRU falha quando a dobra cai no meio da
   * palavra (foi o que aconteceu: "...(Americ\r\n a/Bahia)"). O teste lê o valor
   * DESDOBRADO, que é o que o cliente do calendário entrega à pessoa.
   */
  function valorDe(ics: string, propriedade: string): string | null {
    const linhas = ics.replace(/\r\n[ \t]/g, '').split('\r\n');
    const linha = linhas.find((atual) => atual.startsWith(`${propriedade}:`));

    return linha ? linha.slice(propriedade.length + 1) : null;
  }

  function descricao(ics: string): string {
    return valorDe(ics, 'DESCRIPTION') ?? '';
  }

  it('o token resolve para a pessoa e não atravessa a fronteira da instituição', async () => {
    const token = agendaIcsToken({ tenantId, userId: participanteId });
    expect(token).toBeTruthy();

    expect(await resolveAgendaIcsUser({ tenantId, token: token! })).toBe(participanteId);

    /** O MESMO token na outra casa não resolve: a RLS não enxerga o vínculo de fora. */
    expect(await resolveAgendaIcsUser({ tenantId: vizinhoTenantId, token: token! })).toBeNull();

    /** Token de outra pessoa da casa resolve para ELA — e não para quem pediu. */
    const tokenDaOcupante = agendaIcsToken({ tenantId, userId: ocupanteId })!;
    expect(await resolveAgendaIcsUser({ tenantId, token: tokenDaOcupante })).toBe(ocupanteId);

    expect(await resolveAgendaIcsUser({ tenantId, token: 'nao-e-um-token' })).toBeNull();
    expect(await resolveAgendaIcsUser({ tenantId, token: '  ' })).toBeNull();
  });

  it('o arquivo leva a MESMA grade da tela, com o horário local do evento', async () => {
    /** A grade da pessoa: um favorito (a oficina lotada, 10:00 local). */
    expect(
      await favoriteActivity({ tenantId, userId: tardeId, activityId: lotadaId }),
    ).toMatchObject({ ok: true, created: true });

    const grade = await getMyAgenda({ tenantId, userId: tardeId, eventId: eventoId });
    expect(grade).not.toBeNull();
    if (!grade) return;

    const resultado = await exportAgendaIcs({
      tenantId,
      userId: tardeId,
      eventId: eventoId,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const ics = resultado.ics;

    /** Um VEVENT por item da grade — a contagem é a DA TELA, não uma segunda régua. */
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(grade.entries.length);
    expect(grade.entries.map((entry) => entry.activityId)).toEqual([lotadaId]);

    expect(ics).toContain(`UID:${lotadaId}@eventflow`);

    /** 10:00 em Salvador = 13:00 UTC (`DEZ_HORAS`), o instante que o arquivo grava. */
    const inicio = /DTSTART:(\d{8}T\d{6}Z)/.exec(ics);
    expect(inicio?.[1]).toBe('20270315T130000Z');

    /**
     * E o rótulo legível diz o horário LOCAL — o que a pessoa lê no celular. A vírgula
     * sai ESCAPADA (`\,`), como o RFC 5545 exige para o `,` dentro de um valor de texto
     * (sem escape, ele separaria dois valores da mesma propriedade).
     */
    expect(descricao(ics)).toContain('Horário local: 15/03/2027\\, 10:00');
    expect(descricao(ics)).toContain('America/Bahia');

    /** A atividade em RASCUNHO não entra, nem pelo arquivo. */
    expect(ics).not.toContain(rascunhoId);
    expect(ics).not.toContain('Atividade ainda em rascunho');
  });

  it('o arquivo de UMA atividade vale para quem não tem conta — e recusa rascunho', async () => {
    const publica = await exportActivityIcs({ tenantId, activityId: abertaId });

    expect(publica.ok).toBe(true);
    if (publica.ok) expect(publica.ics).toContain('Palestra da noite');

    const emRascunho = await exportActivityIcs({ tenantId, activityId: rascunhoId });
    expect(emRascunho).toMatchObject({ ok: false, code: 'ATIVIDADE_NAO_ENCONTRADA' });

    /** Da outra instituição também não: a RLS torna a linha invisível. */
    const deFora = await exportActivityIcs({ tenantId, activityId: vizinhaId });
    expect(deFora).toMatchObject({ ok: false, code: 'ATIVIDADE_NAO_ENCONTRADA' });

    /** E o evento de outra casa não vira grade de ninguém. */
    const gradeDeFora = await exportAgendaIcs({
      tenantId,
      userId: participanteId,
      eventId: eventoVizinhoId,
    });
    expect(gradeDeFora).toMatchObject({ ok: false });
  });
});
