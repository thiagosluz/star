/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — os ENDPOINTS da API por evento (FASE 72 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CONTRA O BANCO E PELO HANDLER DA ROTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os testes importam os MÓDULOS DE ROTA (`src/app/api/v1/.../route.ts`) e chamam
 *  `GET`/`HEAD`/`OPTIONS`/`POST` como o Next chamaria, com `Request` de verdade.
 *  O banco é o de demonstração (`ufba-demo / congresso-2026`), e o cenário que a
 *  API precisa esconder é criado de propósito (endereço de sala online preenchido).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PROVAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Por rota: envelope `{ data, meta }` na ordem canônica, `meta.generatedAt`,
 *  401 sem chave / chave errada, ETag 200→304 SEM CORPO, CORS, OPTIONS e 405.
 *  Além disso: 404 para rascunho e para seção desligada (o MESMO corpo), 429 acima
 *  do teto (com `Retry-After`), revogação valendo na requisição seguinte, a
 *  trilha registrando cada recusa, e a LISTA FECHADA no nível HTTP (uma atividade
 *  com `onlineUrl` não põe a chave nem o valor no corpo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A EXCEÇÃO DELIBERADA: "EVENTO INEXISTENTE" RESPONDE 401, NÃO 404
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A decisão 2 do humano é "a API é por evento e TODA leitura exige a chave
 *  daquele evento" + "sem chave válida é 401 SEMPRE, sem revelar se o evento
 *  existe". Um evento inexistente não tem chave: qualquer requisição a ele é,
 *  por definição, uma requisição sem chave válida. Responder 404 ali faria o
 *  caminho distinguir "existe" (401 com chave errada) de "não existe" (404) — o
 *  oposto do pedido. Então o 404 uniforme fica para o que a autenticação deixa
 *  passar: rascunho e seção desligada respondem o MESMO corpo. O teste abaixo
 *  prende a igualdade dos dois 401 e a diferença deles para o 404.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  API_FIELD_ORDER,
  type ApiResource,
} from '../../src/domain/api/public-api-contract';
import { adminPrisma } from '../../src/lib/db/admin-client';
import { getTenantContext, type TenantContext } from '../../src/lib/events/event-repository';
import {
  createEventApiRouteHandlers,
  type EventApiRouteHandler,
} from '../../src/lib/api/event-api-route-handlers';
import { EVENT_API_RATE_LIMIT } from '../../src/lib/api/event-api-http';
import {
  createEventApiKey,
  revealEventApiKey,
  revokeEventApiKey,
  updateEventApiSections,
} from '../../src/lib/api/event-api-key-service';
import { hashEventApiKey } from '../../src/lib/api/event-api-key-vault';

import * as eventoRoute from '../../src/app/api/v1/t/[tenantSlug]/eventos/[eventSlug]/route';
import * as atividadesRoute from '../../src/app/api/v1/t/[tenantSlug]/eventos/[eventSlug]/atividades/route';
import * as palestrantesRoute from '../../src/app/api/v1/t/[tenantSlug]/eventos/[eventSlug]/palestrantes/route';
import * as patrocinadoresRoute from '../../src/app/api/v1/t/[tenantSlug]/eventos/[eventSlug]/patrocinadores/route';
import * as chamadasRoute from '../../src/app/api/v1/t/[tenantSlug]/eventos/[eventSlug]/chamadas/route';

const TENANT_SLUG = 'ufba-demo';
const EVENT_SLUG = 'congresso-2026';
const ATIVIDADE_SLUG = 'abertura';

const RUN = randomUUID().slice(0, 8);
const PUBLICADO_SLUG = `api-publicado-${RUN}`;
const RASCUNHO_SLUG = `api-rascunho-${RUN}`;
const IP_BASE = 100 + (Date.now() % 100);
const EVENTO_ONLINE_URL = `https://sala.exemplo.test/api-evento-${RUN}`;
const ATIVIDADE_ONLINE_URL = `https://sala.exemplo.test/api-atividade-${RUN}`;

const INICIADO_EM = new Date(Date.now() - 5 * 60_000);

let tenant: TenantContext;
let eventId: string;
let atividadeId: string;
let settingsOriginal: unknown;
let eventoOnlineOriginal: string | null;
let atividadeOnlineOriginal: string | null;
let publicadoId: string | null = null;
let rascunhoId: string | null = null;

let chave: string;
/** Guardado entre os testes: o 404 de rascunho e o de seção desligada têm de ser IGUAIS. */
let corpoRascunho404: string | null = null;
/** A chave do evento publicado descartável, usada no teste de revogação. */
let chaveDoPublicado = '';

interface RouteModule {
  GET: EventApiRouteHandler;
  HEAD: EventApiRouteHandler;
  OPTIONS: EventApiRouteHandler;
  POST: EventApiRouteHandler;
  PUT: EventApiRouteHandler;
  PATCH: EventApiRouteHandler;
  DELETE: EventApiRouteHandler;
}

const ROTAS: { resource: ApiResource; module: RouteModule; path: string }[] = [
  { resource: 'evento', module: eventoRoute, path: '' },
  { resource: 'atividades', module: atividadesRoute, path: '/atividades' },
  { resource: 'palestrantes', module: palestrantesRoute, path: '/palestrantes' },
  { resource: 'patrocinadores', module: patrocinadoresRoute, path: '/patrocinadores' },
  { resource: 'chamadas', module: chamadasRoute, path: '/chamadas' },
];

/** As três seções que o organizador pode desligar (evento e atividades não entram). */
const ROTAS_COM_INTERRUPTOR: {
  resource: 'palestrantes' | 'patrocinadores' | 'chamadas';
  module: RouteModule;
  path: string;
}[] = [
  { resource: 'palestrantes', module: palestrantesRoute, path: '/palestrantes' },
  { resource: 'patrocinadores', module: patrocinadoresRoute, path: '/patrocinadores' },
  { resource: 'chamadas', module: chamadasRoute, path: '/chamadas' },
];

/** IPs distintos por chamada para o teto do Redis não acumular entre os testes. */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;

  return `198.51.${IP_BASE}.${ipCounter % 250}`;
}

function contextFor(eventSlug: string = EVENT_SLUG) {
  return { params: Promise.resolve({ tenantSlug: TENANT_SLUG, eventSlug }) };
}

function requestFor(input: {
  eventSlug?: string;
  path?: string;
  key?: string | null;
  method?: string;
  ip?: string;
  headers?: Record<string, string>;
}): Request {
  const headers = new Headers(input.headers);

  if (input.key) headers.set('authorization', `Bearer ${input.key}`);
  headers.set('x-forwarded-for', input.ip ?? nextIp());

  return new Request(
    `http://localhost/api/v1/t/${TENANT_SLUG}/eventos/${input.eventSlug ?? EVENT_SLUG}${input.path ?? ''}`,
    { method: input.method ?? 'GET', headers },
  );
}

function get(
  handler: EventApiRouteHandler,
  options: {
    eventSlug?: string;
    path?: string;
    key?: string | null;
    ip?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  return handler(
    requestFor({ ...options, method: 'GET' }),
    contextFor(options.eventSlug),
  );
}

function withoutApi(settings: unknown): Record<string, unknown> {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return {};

  const copy = { ...(settings as Record<string, unknown>) };
  delete copy.api;

  return copy;
}

beforeAll(async () => {
  const resolved = await getTenantContext(TENANT_SLUG);

  expect(
    resolved,
    `o seed de demonstração precisa existir: não achei a instituição "${TENANT_SLUG}"`,
  ).not.toBeNull();
  if (!resolved) throw new Error('instituição de demonstração ausente');

  tenant = resolved;

  const evento = await adminPrisma.event.findFirst({
    where: { tenantId: tenant.tenantId, slug: EVENT_SLUG },
    select: { id: true, settings: true, onlineUrl: true },
  });

  expect(
    evento,
    `o evento de demonstração "${EVENT_SLUG}" precisa existir (rode npm run db:seed)`,
  ).not.toBeNull();
  if (!evento) throw new Error('evento de demonstração ausente');

  eventId = evento.id;
  settingsOriginal = evento.settings;
  eventoOnlineOriginal = evento.onlineUrl;

  const atividade = await adminPrisma.activity.findFirst({
    where: { eventId, slug: ATIVIDADE_SLUG },
    select: { id: true, onlineUrl: true },
  });

  expect(atividade, `a atividade "${ATIVIDADE_SLUG}" precisa existir`).not.toBeNull();
  if (!atividade) throw new Error('atividade de demonstração ausente');

  atividadeId = atividade.id;
  atividadeOnlineOriginal = atividade.onlineUrl;

  /** O cenário que a API precisa esconder: origem com os endereços preenchidos. */
  await adminPrisma.event.update({
    where: { id: eventId },
    data: { onlineUrl: EVENTO_ONLINE_URL },
  });
  await adminPrisma.activity.update({
    where: { id: atividadeId },
    data: { onlineUrl: ATIVIDADE_ONLINE_URL },
  });

  /** Começa de uma configuração limpa, mesmo que uma execução anterior tenha falhado. */
  await adminPrisma.event.update({
    where: { id: eventId },
    data: { settings: withoutApi(settingsOriginal) as unknown as object },
  });

  const created = await createEventApiKey({ tenantId: tenant.tenantId, eventId });
  expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
  if (!created.ok) throw new Error(created.message);

  chave = created.chave;

  /** As três seções são habilitadas EXPLICITAMENTE — o padrão é desligado. */
  const enabled = await updateEventApiSections({
    tenantId: tenant.tenantId,
    eventId,
    secoes: { palestrantes: true, patrocinadores: true, chamadas: true },
  });
  expect(enabled.ok, enabled.ok ? 'ok' : enabled.message).toBe(true);
});

afterAll(async () => {
  if (eventId) {
    await adminPrisma.event.update({
      where: { id: eventId },
      data: {
        settings: settingsOriginal as unknown as object,
        onlineUrl: eventoOnlineOriginal,
      },
    });
  }

  if (atividadeId) {
    await adminPrisma.activity.update({
      where: { id: atividadeId },
      data: { onlineUrl: atividadeOnlineOriginal },
    });
  }

  if (publicadoId) await adminPrisma.event.delete({ where: { id: publicadoId } });
  if (rascunhoId) await adminPrisma.event.delete({ where: { id: rascunhoId } });
});

// ─────────────────────────────────────────────────────────────────────────────
//  A chave: criar, reexibir, não rotacionar em silêncio
// ─────────────────────────────────────────────────────────────────────────────
describe('a chave do evento', () => {
  it('criar de novo com uma chave ativa é RECUSADO (rotacionar é revogar + criar)', async () => {
    const again = await createEventApiKey({ tenantId: tenant.tenantId, eventId });

    expect(again.ok).toBe(false);
    if (again.ok) return;

    expect(again.code).toBe('ALREADY_EXISTS');
  });

  it('o organizador REEXIBE a mesma chave (o banco sozinho não a abriria)', async () => {
    const revealed = await revealEventApiKey({ tenantId: tenant.tenantId, eventId });

    expect(revealed.ok, revealed.ok ? 'ok' : revealed.message).toBe(true);
    if (!revealed.ok) return;

    expect(revealed.chave).toBe(chave);
    expect(revealed.config.chaveHash).toBe(hashEventApiKey(chave));
    expect(revealed.config.secoes).toEqual({
      palestrantes: true,
      patrocinadores: true,
      chamadas: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  As cinco rotas: 200, ordem canônica, ETag/304, 401, CORS, OPTIONS, 405
// ─────────────────────────────────────────────────────────────────────────────
describe('as cinco rotas de leitura', () => {
  for (const rota of ROTAS) {
    it(`GET /${rota.resource}: envelope, ordem canônica, generatedAt e ETag`, async () => {
      const response = await get(rota.module.GET, { path: rota.path, key: chave });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      expect(response.headers.get('vary')).toContain('Authorization');

      const etag = response.headers.get('etag');
      expect(etag).not.toBeNull();

      const body = (await response.json()) as {
        data: unknown;
        meta: { generatedAt: string; etag?: string; count?: number };
      };

      const amostra = Array.isArray(body.data) ? body.data[0] : body.data;
      expect(amostra, `o recurso ${rota.resource} não pode vir vazio no cenário de demonstração`).toBeDefined();

      expect(Object.keys(amostra as object)).toEqual([...API_FIELD_ORDER[rota.resource]]);
      expect(body.meta.generatedAt).toBe(new Date(body.meta.generatedAt).toISOString());
      expect(body.meta.etag).toBe(etag);

      if (Array.isArray(body.data)) {
        expect(body.meta.count).toBe(body.data.length);
      }
    });

    it(`GET /${rota.resource}: a 2ª chamada com If-None-Match responde 304 SEM corpo`, async () => {
      const first = await get(rota.module.GET, { path: rota.path, key: chave });
      expect(first.status).toBe(200);

      const etag = first.headers.get('etag');
      expect(etag).not.toBeNull();
      if (!etag) return;

      const second = await get(rota.module.HEAD, {
        path: rota.path,
        key: chave,
        headers: { 'If-None-Match': etag },
      });

      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
      expect(second.headers.get('access-control-allow-origin')).toBe('*');
      expect(await second.text()).toBe('');
    });

    it(`GET /${rota.resource}: sem chave é 401 (e com chave errada também)`, async () => {
      const semChave = await get(rota.module.GET, { path: rota.path });

      expect(semChave.status).toBe(401);
      expect(semChave.headers.get('access-control-allow-origin')).toBe('*');
      const corpoSemChave = (await semChave.json()) as { code: string };

      expect(corpoSemChave.code).toBe('MISSING_API_KEY');

      const errada = await get(rota.module.GET, {
        path: rota.path,
        key: `chave-errada-${RUN}`,
      });

      expect(errada.status).toBe(401);
      const corpoErrado = (await errada.json()) as { code: string };

      expect(corpoErrado.code).toBe('INVALID_API_KEY');
    });

    it(`OPTIONS /${rota.resource}: preflight aberto; POST /${rota.resource}: 405 com Allow`, async () => {
      const preflight = await rota.module.OPTIONS(
        requestFor({ path: rota.path, method: 'OPTIONS' }),
        contextFor(),
      );

      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
      expect(preflight.headers.get('access-control-allow-methods')).toContain('OPTIONS');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');

      const post = await rota.module.POST(
        requestFor({ path: rota.path, method: 'POST', key: chave }),
        contextFor(),
      );

      expect(post.status).toBe(405);
      expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    });
  }

  it('HEAD devolve os cabeçalhos do GET e nenhum corpo', async () => {
    const response = await eventoRoute.HEAD(
      requestFor({ method: 'HEAD', key: chave }),
      contextFor(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).not.toBeNull();
    expect(await response.text()).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  As portas: 401 uniforme, 404 uniforme, seção desligada, revogação
// ─────────────────────────────────────────────────────────────────────────────
describe('as portas de recusa', () => {
  it('evento inexistente e chave errada respondem o MESMO 401 (nunca 404)', async () => {
    const inexistente = await get(eventoRoute.GET, {
      eventSlug: `nao-existe-${RUN}`,
      key: `qualquer-${RUN}`,
    });

    expect(inexistente.status).toBe(401);

    const existenteComChaveErrada = await get(eventoRoute.GET, {
      key: `outra-errada-${RUN}`,
    });

    expect(existenteComChaveErrada.status).toBe(401);
    expect(await inexistente.text()).toBe(await existenteComChaveErrada.text());
  });

  it('rascunho com chave VÁLIDA responde 404 — o mesmo corpo de uma seção desligada', async () => {
    const rascunho = await adminPrisma.event.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.tenantId,
        slug: RASCUNHO_SLUG,
        title: 'Rascunho (a API não pode revelar)',
        status: 'DRAFT',
        startsAt: new Date(Date.now() + 10 * 86_400_000),
        endsAt: new Date(Date.now() + 11 * 86_400_000),
        timezone: 'America/Bahia',
      },
      select: { id: true },
    });

    rascunhoId = rascunho.id;

    const chaveDoRascunho = await createEventApiKey({
      tenantId: tenant.tenantId,
      eventId: rascunho.id,
    });

    expect(chaveDoRascunho.ok, chaveDoRascunho.ok ? 'ok' : chaveDoRascunho.message).toBe(true);
    if (!chaveDoRascunho.ok) return;

    /** Todas as seções ligadas: o 404 tem de vir de "não publicado", não do interruptor. */
    const secoes = await updateEventApiSections({
      tenantId: tenant.tenantId,
      eventId: rascunho.id,
      secoes: { palestrantes: true, patrocinadores: true, chamadas: true },
    });
    expect(secoes.ok, secoes.ok ? 'ok' : secoes.message).toBe(true);

    for (const rota of ROTAS) {
      const response = await get(rota.module.GET, {
        path: rota.path,
        eventSlug: RASCUNHO_SLUG,
        key: chaveDoRascunho.chave,
      });

      expect(response.status, `/${rota.resource} de rascunho`).toBe(404);

      const corpo = await response.text();

      if (corpoRascunho404 === null) corpoRascunho404 = corpo;
      else expect(corpo, `o 404 de /${rota.resource} difere do primeiro`).toBe(corpoRascunho404);
    }

    expect(corpoRascunho404).not.toBeNull();
    if (!corpoRascunho404) return;

    expect(JSON.parse(corpoRascunho404)).toEqual({
      code: 'NOT_FOUND',
      message: 'Recurso não encontrado.',
    });
  });

  it('o INTERRUPTOR: seção desligada é 404 como se não existisse; evento e atividades seguem', async () => {
    const publicado = await adminPrisma.event.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.tenantId,
        slug: PUBLICADO_SLUG,
        title: 'Evento publicado da API (fixture)',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        startsAt: new Date(Date.now() + 5 * 86_400_000),
        endsAt: new Date(Date.now() + 6 * 86_400_000),
        timezone: 'America/Bahia',
        capacity: 10,
      },
      select: { id: true },
    });

    publicadoId = publicado.id;

    const criada = await createEventApiKey({
      tenantId: tenant.tenantId,
      eventId: publicado.id,
    });

    expect(criada.ok, criada.ok ? 'ok' : criada.message).toBe(true);
    if (!criada.ok) return;

    chaveDoPublicado = criada.chave;

    /** O padrão é DESLIGADO: nenhuma seção exposta só porque a chave nasceu. */
    let corpo404: string | null = null;

    for (const rota of ROTAS_COM_INTERRUPTOR) {
      const semSecao = await get(rota.module.GET, {
        path: rota.path,
        eventSlug: PUBLICADO_SLUG,
        key: criada.chave,
      });

      expect(semSecao.status, `/${rota.resource} desligada`).toBe(404);

      const corpo = await semSecao.text();

      /** Todo 404 de seção desligada é o MESMO corpo. */
      if (corpo404 === null) corpo404 = corpo;
      else expect(corpo, `o 404 de /${rota.resource} difere do primeiro`).toBe(corpo404);
    }

    /** Evento e atividades NÃO são interruptáveis: seguem disponíveis. */
    const evento = await get(eventoRoute.GET, {
      eventSlug: PUBLICADO_SLUG,
      key: criada.chave,
    });
    expect(evento.status).toBe(200);

    const atividades = await get(atividadesRoute.GET, {
      path: '/atividades',
      eventSlug: PUBLICADO_SLUG,
      key: criada.chave,
    });
    expect(atividades.status).toBe(200);
    expect(((await atividades.json()) as { data: unknown[] }).data).toEqual([]);

    /** Ligar os interruptores expõe as seções — vazias, mas existentes. */
    const ligada = await updateEventApiSections({
      tenantId: tenant.tenantId,
      eventId: publicado.id,
      secoes: { palestrantes: true, patrocinadores: true, chamadas: true },
    });
    expect(ligada.ok, ligada.ok ? 'ok' : ligada.message).toBe(true);

    for (const rota of ROTAS_COM_INTERRUPTOR) {
      const comSecao = await get(rota.module.GET, {
        path: rota.path,
        eventSlug: PUBLICADO_SLUG,
        key: criada.chave,
      });

      expect(comSecao.status, `/${rota.resource} ligada`).toBe(200);
      expect(((await comSecao.json()) as { data: unknown[] }).data).toEqual([]);
    }

    /** O 404 de seção desligada é o MESMO corpo do 404 de rascunho. */
    expect(corpo404).not.toBeNull();
    expect(corpoRascunho404).not.toBeNull();
    expect(corpo404).toBe(corpoRascunho404);
  });

  it('REVOGADA: a chave para de valer na requisição seguinte; criar outra é permitido', async () => {
    expect(publicadoId).not.toBeNull();
    expect(chaveDoPublicado).not.toBe('');

    const antes = await get(eventoRoute.GET, {
      eventSlug: PUBLICADO_SLUG,
      key: chaveDoPublicado,
    });
    expect(antes.status).toBe(200);

    const revogada = await revokeEventApiKey({
      tenantId: tenant.tenantId,
      eventId: publicadoId ?? '',
      reason: 'teste de integração',
    });
    expect(revogada.ok, revogada.ok ? 'ok' : revogada.message).toBe(true);

    /** A revogação vale em TODAS as rotas — uma chave, um evento, cinco recursos. */
    for (const rota of ROTAS) {
      const depois = await get(rota.module.GET, {
        path: rota.path,
        eventSlug: PUBLICADO_SLUG,
        key: chaveDoPublicado,
      });

      expect(depois.status, `/${rota.resource} com chave revogada`).toBe(401);
      expect(((await depois.json()) as { code: string }).code).toBe('INVALID_API_KEY');
    }

    const reexibir = await revealEventApiKey({
      tenantId: tenant.tenantId,
      eventId: publicadoId ?? '',
    });
    expect(reexibir.ok).toBe(false);
    if (!reexibir.ok) expect(reexibir.code).toBe('REVOKED');

    /** Revogar e criar são dois atos; a chave nova vale e a velha não. */
    const outra = await createEventApiKey({
      tenantId: tenant.tenantId,
      eventId: publicadoId ?? '',
    });
    expect(outra.ok, outra.ok ? 'ok' : outra.message).toBe(true);
    if (!outra.ok) return;

    expect(outra.chave).not.toBe(chaveDoPublicado);

    const comOutra = await get(eventoRoute.GET, {
      eventSlug: PUBLICADO_SLUG,
      key: outra.chave,
    });
    expect(comOutra.status).toBe(200);

    const comAntiga = await get(eventoRoute.GET, {
      eventSlug: PUBLICADO_SLUG,
      key: chaveDoPublicado,
    });
    expect(comAntiga.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  O teto de taxa
// ─────────────────────────────────────────────────────────────────────────────
describe('o limite de taxa por IP', () => {
  it('o teto declarado é 120 requisições por minuto', () => {
    expect(EVENT_API_RATE_LIMIT).toEqual({ window: 60, max: 120 });
  });

  it('acima do teto é 429 com Retry-After (a 3ª chamada, com teto 2)', async () => {
    let usados = 0;

    const handlers = createEventApiRouteHandlers('evento', {
      rateLimit: {
        async consume() {
          usados += 1;

          return usados <= 2
            ? { allowed: true, retryAfter: null }
            : { allowed: false, retryAfter: 9 };
        },
      },
    });

    const primeira = await get(handlers.GET, { key: chave });
    const segunda = await get(handlers.GET, { key: chave });
    const terceira = await get(handlers.GET, { key: chave });

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(terceira.status).toBe(429);
    expect(terceira.headers.get('retry-after')).toBe('9');
    expect(terceira.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await terceira.json()) as { code: string }).code).toBe('RATE_LIMITED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  A lista fechada no nível HTTP
// ─────────────────────────────────────────────────────────────────────────────
describe('a lista fechada no corpo HTTP', () => {
  it('/atividades com onlineUrl preenchido NÃO contém a chave nem o valor', async () => {
    const response = await get(atividadesRoute.GET, {
      path: '/atividades',
      key: chave,
    });

    expect(response.status).toBe(200);

    const corpo = await response.text();

    expect(corpo).not.toContain(ATIVIDADE_ONLINE_URL);
    expect(corpo).not.toContain(EVENTO_ONLINE_URL);
    expect(corpo).not.toMatch(/"onlineUrl"\s*:/);
    expect(corpo).not.toMatch(/"email"\s*:/);
    expect(corpo).not.toMatch(/"cpf"\s*:/i);
    expect(corpo).not.toMatch(/"registration(Id|Status|Answers)?"\s*:/);
    expect(corpo).not.toMatch(/"waitlist/i);
    expect(corpo).not.toMatch(/"confirmedCount"\s*:/);
  });

  it('o corpo do evento também não carrega o endereço da sala', async () => {
    const response = await get(eventoRoute.GET, { key: chave });

    expect(response.status).toBe(200);

    const corpo = await response.text();
    expect(corpo).not.toContain(EVENTO_ONLINE_URL);
    expect(corpo).not.toMatch(/"onlineUrl"\s*:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  A trilha
// ─────────────────────────────────────────────────────────────────────────────
describe('a trilha registra os atos e as recusas', () => {
  it('criação, revogação e cada recusa ficam em audit_logs — sem a chave', async () => {
    const rows = await adminPrisma.auditLog.findMany({
      where: {
        tenantId: tenant.tenantId,
        entityType: 'event_api_key',
        createdAt: { gte: INICIADO_EM },
      },
      select: { action: true, entityId: true, changes: true },
    });

    const acoes = new Set(rows.map((row) => row.action));
    expect(acoes.has('CREATE')).toBe(true);
    expect(acoes.has('DELETE')).toBe(true);
    expect(acoes.has('READ')).toBe(true);

    const motivos = rows
      .map((row) => (row.changes as Record<string, { to?: unknown }>).motivo?.to)
      .filter((motivo): motivo is string => typeof motivo === 'string');

    expect(motivos).toContain('AUSENTE');
    expect(motivos).toContain('DIVERGENTE');
    expect(motivos).toContain('EVENTO_INEXISTENTE');
    expect(motivos).toContain('REVOGADA');

    /** A chave em claro NUNCA está na trilha; o índice SHA-256 está. */
    const serializado = JSON.stringify(rows);
    expect(serializado).not.toContain(chave);
    expect(serializado).not.toContain('chaveSelada');

    const hashes = rows
      .map((row) => (row.changes as Record<string, { to?: unknown }>).chaveHash?.to)
      .filter((hash): hash is string => typeof hash === 'string');

    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
