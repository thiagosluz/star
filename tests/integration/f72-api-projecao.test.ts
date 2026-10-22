/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — A PROJEÇÃO ÚNICA CONTRA O BANCO (FASE 72 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CENÁRIO É O DE DEMONSTRAÇÃO, DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `ufba-demo / congresso-2026` é o evento que o seed monta com palestrantes,
 *  patrocinadores, chamadas publicadas e uma vaga RETIDA — o dado que a
 *  demonstração usa. Medir a projeção nele é medir o caso real, não uma fixture
 *  que só existe no teste.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ATIVIDADE COM `onlineUrl` PREENCHIDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O seed atual NÃO grava `onlineUrl` (a coluna nasceu na F68 e o escritor é a
 *  tela); por isso este arquivo PREENCHE o endereço do evento e de uma atividade
 *  antes de projetar e o RESTAURA no fim. Sem isso, "não vazou" seria
 *  indistinguível de "não havia o que vazar" — a negativa só vale depois da
 *  positiva.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PROVAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a projeção PÚBLICA crua carrega o endereço (o caso existe);
 *  • a visão anônima e as cinco projeções da API NÃO o carregam — nem a chave,
 *    nem o valor em nenhum campo;
 *  • nenhuma das cinco projeções tem campo da lista fechada (participante,
 *    inscrição, presença, e-mail, CPF, espera, contador de operação, rascunho);
 *  • as chamadas publicadas perdem `proposals`/`decided`, embora o `CallView` da
 *    página os tenha;
 *  • o envelope monta `{ data, meta }` com a ordem canônica sobre o dado real.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  API_FIELD_ORDER,
  API_RESOURCES,
  assertApiProjectionSemCampoProibido,
  buildApiEnvelope,
  findForbiddenApiField,
} from '../../src/domain/api/public-api-contract';
import { adminPrisma } from '../../src/lib/db/admin-client';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import { getPublicEventView } from '../../src/lib/events/public-event-view';
import { loadEventApiProjections } from '../../src/lib/api/event-api-service';
import { listPublicCalls } from '../../src/lib/proposals/call-service';

const TENANT_SLUG = 'ufba-demo';
const EVENT_SLUG = 'congresso-2026';
const ATIVIDADE_SLUG = 'abertura';

const RUN = randomUUID().slice(0, 8);
const EVENTO_ONLINE_URL = `https://sala.exemplo.test/evento-${RUN}`;
const ATIVIDADE_ONLINE_URL = `https://sala.exemplo.test/atividade-${RUN}`;

let tenantId: string;
let tenant: { tenantId: string; slug: string; name: string };
let eventId: string;
let atividadeId: string;
let eventoOnlineOriginal: string | null;
let atividadeOnlineOriginal: string | null;
let rascunhoId: string | null = null;

const NOW = new Date();

beforeAll(async () => {
  const demo = await adminPrisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true },
  });

  expect(
    demo,
    `o seed de demonstração precisa existir: não achei a instituição "${TENANT_SLUG}" (rode npm run db:seed)`,
  ).not.toBeNull();
  if (!demo) throw new Error('instituição de demonstração ausente');

  tenantId = demo.id;
  tenant = { tenantId: demo.id, slug: demo.slug, name: demo.name };

  const evento = await adminPrisma.event.findFirst({
    where: { tenantId, slug: EVENT_SLUG },
    select: { id: true, onlineUrl: true },
  });

  expect(
    evento,
    `o evento de demonstração "${EVENT_SLUG}" precisa existir (rode npm run db:seed)`,
  ).not.toBeNull();
  if (!evento) throw new Error('evento de demonstração ausente');

  eventId = evento.id;
  eventoOnlineOriginal = evento.onlineUrl;

  const atividade = await adminPrisma.activity.findFirst({
    where: { eventId, slug: ATIVIDADE_SLUG },
    select: { id: true, onlineUrl: true },
  });

  expect(atividade, `a atividade "${ATIVIDADE_SLUG}" precisa existir`).not.toBeNull();
  if (!atividade) throw new Error('atividade de demonstração ausente');

  atividadeId = atividade.id;
  atividadeOnlineOriginal = atividade.onlineUrl;

  /** O CASO QUE O TESTE PRECISA: a origem tem os dois endereços preenchidos. */
  await adminPrisma.event.update({
    where: { id: eventId },
    data: { onlineUrl: EVENTO_ONLINE_URL },
  });
  await adminPrisma.activity.update({
    where: { id: atividadeId },
    data: { onlineUrl: ATIVIDADE_ONLINE_URL },
  });
});

afterAll(async () => {
  if (eventId) {
    await adminPrisma.event.update({
      where: { id: eventId },
      data: { onlineUrl: eventoOnlineOriginal },
    });
  }

  if (atividadeId) {
    await adminPrisma.activity.update({
      where: { id: atividadeId },
      data: { onlineUrl: atividadeOnlineOriginal },
    });
  }

  if (rascunhoId) {
    await adminPrisma.event.delete({ where: { id: rascunhoId } });
  }
});

describe('a projeção pública crua tem o endereço; a da API não', () => {
  it('o evento de demonstração tem o que a API precisa esconder', async () => {
    const publico = await getPublicEvent(tenantId, EVENT_SLUG);

    expect(publico, 'a projeção pública do congresso precisa existir').not.toBeNull();
    if (!publico) return;

    expect(publico.onlineUrl).toBe(EVENTO_ONLINE_URL);

    const atividade = publico.activities.find((row) => row.slug === ATIVIDADE_SLUG);
    expect(atividade?.onlineUrl).toBe(ATIVIDADE_ONLINE_URL);

    /** O cenário de demonstração tem os quatro recursos que o plano pede. */
    expect(publico.activities.length).toBeGreaterThanOrEqual(4);
    expect(publico.speakers.length).toBeGreaterThanOrEqual(1);
    expect(publico.sponsors.length).toBeGreaterThanOrEqual(1);
    expect(publico.usesCall).toBe(true);
  });

  it('a visão ANÔNIMA já zera o endereço do evento e o da atividade', async () => {
    const visao = await getPublicEventView({
      tenantId,
      eventSlug: EVENT_SLUG,
      userId: null,
      now: NOW,
    });

    expect(visao).not.toBeNull();
    if (!visao) return;

    expect(visao.event.onlineUrl).toBeNull();
    expect(visao.byActivity.size).toBe(0);

    const atividade = visao.event.activities.find((row) => row.slug === ATIVIDADE_SLUG);
    expect(atividade?.onlineUrl).toBeNull();
  });

  it('as CINCO projeções não têm o endereço — nem a chave, nem o valor', async () => {
    const resultado = await loadEventApiProjections({
      tenant,
      eventSlug: EVENT_SLUG,
      generatedAt: NOW,
    });

    expect(resultado.ok, resultado.ok ? 'ok' : resultado.message).toBe(true);
    if (!resultado.ok) return;

    const { projections } = resultado;

    expect('onlineUrl' in projections.evento).toBe(false);

    const atividade = projections.atividades.find((row) => row.slug === ATIVIDADE_SLUG);
    expect(atividade).toBeDefined();
    if (!atividade) return;

    expect('onlineUrl' in atividade).toBe(false);

    const serializado = JSON.stringify(projections);
    expect(serializado).not.toContain(EVENTO_ONLINE_URL);
    expect(serializado).not.toContain(ATIVIDADE_ONLINE_URL);

    /**
     * E a lista fechada inteira, recursivamente, nos cinco recursos. É o teste que
     * falha se um `...spread` futuro trouxer `onlineUrl`, `confirmedCount`, CPF,
     * resposta de formulário ou rascunho.
     */
    for (const resource of API_RESOURCES) {
      expect(
        findForbiddenApiField(projections[resource]),
        `o recurso ${resource} não pode conter campo proibido`,
      ).toBeNull();
      assertApiProjectionSemCampoProibido(resource, projections[resource]);
    }
  });

  it('não sai e-mail de participante nem da equipe do evento de demonstração', async () => {
    const resultado = await loadEventApiProjections({
      tenant,
      eventSlug: EVENT_SLUG,
      generatedAt: NOW,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const serializado = JSON.stringify(resultado.projections);

    /** `carla@` tem vaga retida no congresso; `bruno@` é palestrante e equipe. */
    expect(serializado).not.toContain('@example.test');
    expect(serializado).not.toMatch(/"email"\s*:/);
    expect(serializado).not.toMatch(/"cpf"\s*:/i);
    expect(serializado).not.toMatch(/"registration(Id|Status|Answers)?"\s*:/);
    expect(serializado).not.toMatch(/"waitlist/i);
  });
});

describe('os recursos copiam a página e perdem os contadores internos', () => {
  it('a chamada publicada perde `proposals`/`decided`, que o CallView da página tem', async () => {
    const publico = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publico).not.toBeNull();
    if (!publico) return;

    const chamadasDaPagina = await listPublicCalls({
      tenantId,
      eventId: publico.id,
      now: NOW,
    });

    expect(chamadasDaPagina.ok).toBe(true);
    if (!chamadasDaPagina.ok) return;

    expect(chamadasDaPagina.calls.length).toBeGreaterThanOrEqual(2);

    /** A positiva: o read model da página TEM os contadores. */
    const chamadaDaPagina = chamadasDaPagina.calls[0]!;
    expect(typeof chamadaDaPagina.proposals).toBe('number');
    expect(typeof chamadaDaPagina.decided).toBe('number');

    const resultado = await loadEventApiProjections({
      tenant,
      eventSlug: EVENT_SLUG,
      generatedAt: NOW,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const chamadaDaApi = resultado.projections.chamadas.find(
      (row) => row.id === chamadaDaPagina.id,
    );

    expect(chamadaDaApi).toBeDefined();
    if (!chamadaDaApi) return;

    expect(chamadaDaApi.title).toBe(chamadaDaPagina.title);
    expect(chamadaDaApi.state).toBe(chamadaDaPagina.state);
    expect('proposals' in chamadaDaApi).toBe(false);
    expect('decided' in chamadaDaApi).toBe(false);
  });

  it('a API lê o MESMO evento que a página: títulos, slugs e ordem batem', async () => {
    const visao = await getPublicEventView({
      tenantId,
      eventSlug: EVENT_SLUG,
      userId: null,
      now: NOW,
    });
    expect(visao).not.toBeNull();
    if (!visao) return;

    const resultado = await loadEventApiProjections({
      tenant,
      eventSlug: EVENT_SLUG,
      generatedAt: NOW,
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.projections.evento.title).toBe(visao.event.title);
    expect(resultado.projections.evento.slug).toBe(visao.event.slug);
    expect(resultado.projections.evento.remainingSeats).toBe(visao.event.remainingSeats);

    expect(resultado.projections.atividades.map((row) => row.slug)).toEqual(
      visao.event.activities.map((row) => row.slug),
    );
    expect(resultado.projections.palestrantes.map((row) => row.id)).toEqual(
      visao.event.speakers.map((row) => row.id),
    );
    expect(resultado.projections.patrocinadores.map((row) => row.id)).toEqual(
      visao.event.sponsors.map((row) => row.id),
    );
  });

  it('o envelope real monta { data, meta } na ordem canônica de cada recurso', async () => {
    const resultado = await loadEventApiProjections({
      tenant,
      eventSlug: EVENT_SLUG,
      generatedAt: NOW,
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    for (const resource of API_RESOURCES) {
      const envelope = buildApiEnvelope({
        resource,
        data: resultado.projections[resource],
        generatedAt: resultado.generatedAt,
      });

      const amostra = Array.isArray(envelope.data) ? envelope.data[0] : envelope.data;

      expect(
        Object.keys(amostra as object),
        `ordem canônica do recurso ${resource}`,
      ).toEqual([...API_FIELD_ORDER[resource]]);

      expect(envelope.meta.generatedAt).toBe(NOW.toISOString());

      if (Array.isArray(envelope.data)) {
        expect(envelope.meta.count).toBe(envelope.data.length);
      }
    }
  });
});

describe('a porta do publicado', () => {
  it('evento inexistente e evento em RASCUNHO respondem o MESMO NOT_FOUND', async () => {
    const inexistente = await loadEventApiProjections({
      tenant,
      eventSlug: `nao-existe-${RUN}`,
      generatedAt: NOW,
    });

    expect(inexistente.ok).toBe(false);
    if (inexistente.ok) return;
    expect(inexistente.code).toBe('NOT_FOUND');

    const rascunho = await adminPrisma.event.create({
      data: {
        id: randomUUID(),
        tenantId,
        slug: `rascunho-api-${RUN}`,
        title: 'Evento em rascunho (não pode existir para a API)',
        status: 'DRAFT',
        startsAt: new Date(NOW.getTime() + 10 * 86_400_000),
        endsAt: new Date(NOW.getTime() + 11 * 86_400_000),
        timezone: 'America/Bahia',
      },
      select: { id: true },
    });

    rascunhoId = rascunho.id;

    const emRascunho = await loadEventApiProjections({
      tenant,
      eventSlug: `rascunho-api-${RUN}`,
      generatedAt: NOW,
    });

    expect(emRascunho.ok).toBe(false);
    if (emRascunho.ok) return;
    expect(emRascunho.code).toBe('NOT_FOUND');
    expect(emRascunho.message).toBe(inexistente.message);
  });
});
