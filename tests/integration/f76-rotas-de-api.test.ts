/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ID MALFORMADO NA API: 404 COM ENVELOPE, NUNCA 500 SEM CORPO
 *  (FASE 76 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cinco rotas respondiam **500 sem corpo** (0 byte, sem `content-type`): o id
 *  malformado descia até o Prisma, o Postgres recusava (`invalid input syntax for
 *  type uuid`, armadilha 25) e não havia `catch` no caminho de leitura. A de material
 *  de palestrante respondia **403 com `{code:"INTERNAL"}`** para visitante anônimo —
 *  "proibido" sobre um texto que nem id é. A prévia do sorteio respondia **200 com
 *  erro no corpo**, um erro disfarçado de sucesso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE CHAMA O HANDLER, E NÃO O SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O defeito não estava na consulta: estava na PORTA que não conferia o formato. Um
 *  teste de serviço provaria a regra, não a resposta. Aqui cada caso chama o `GET` de
 *  verdade, com o banco de verdade, e observa o que o cliente HTTP recebe — status,
 *  `content-type` e corpo. É a mesma escolha da fatia 1 para as páginas.
 *
 *  O que é substituído: a SESSÃO e a guarda de permissão (não existem fora de uma
 *  requisição do Next, e têm cobertura própria). O que NÃO é substituído: as leituras
 *  que as rotas fazem — são elas que recebiam o uuid torto e estouravam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';

const RUN = randomUUID().slice(0, 8);
const TENANT_SLUG = `f76-api-${RUN}`;

/** O que a sessão dublada devolve — o `tenantId` é o da fixture. */
const sessao = vi.hoisted(() => ({
  userId: '',
  tenantId: '',
  authenticated: true,
}));

vi.mock('../../src/lib/auth/session', () => ({
  getAuthenticatedUser: async () =>
    sessao.authenticated
      ? {
          id: sessao.userId,
          name: 'Gestora da F76',
          email: 'gestora.f76-api@exemplo.test',
          image: null,
          publicHandle: null,
          emailVerified: true,
        }
      : null,
  loadPrincipal: async (userId: string, tenantId: string) => ({
    userId,
    tenantId,
    membershipStatus: 'ACTIVE' as const,
    assignments: [{ role: 'OWNER' as const, scope: 'TENANT' as const }],
  }),
}));

/** A guarda das rotas de crachá — a autorização tem cobertura própria (F75). */
vi.mock('../../src/lib/auth/guard-action', () => ({
  guardAction: async () => ({
    ok: true,
    userId: sessao.userId,
    tenantId: sessao.tenantId,
    principal: {
      userId: sessao.userId,
      tenantId: sessao.tenantId,
      membershipStatus: 'ACTIVE' as const,
      assignments: [{ role: 'OWNER' as const, scope: 'TENANT' as const }],
    },
  }),
}));

import * as midiaRoute from '../../src/app/api/t/[tenantSlug]/midia/[assetId]/miniatura/route';
import * as exportacoesRoute from '../../src/app/api/t/[tenantSlug]/exportacoes/[exportId]/arquivo/route';
import * as folhaRoute from '../../src/app/api/t/[tenantSlug]/credenciamento/crachas/folha/route';
import * as impressaoRoute from '../../src/app/api/t/[tenantSlug]/credenciamento/crachas/impressao/route';
import * as agendaRoute from '../../src/app/api/t/[tenantSlug]/agenda/ics/route';
import * as palestrantesRoute from '../../src/app/api/t/[tenantSlug]/palestrantes/materiais/[materialId]/arquivo/route';
import * as qrRoute from '../../src/app/api/t/[tenantSlug]/patrocinadores/qr/[qrId]/route';
import * as raffleLiveRoute from '../../src/app/api/events/[eventId]/raffle-live/route';

let tenantId: string;
let userId: string;

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

/**
 * Lê a resposta como o cliente HTTP leria: status, tipo e CORPO.
 *
 * O `text()` antes do `JSON.parse` é intencional: o defeito medido era 0 byte, e
 * `response.json()` sobre corpo vazio lançaria com uma mensagem que não diz isso.
 */
async function expectarEnvelope(
  response: Response,
  esperado: { status: number; code: string },
): Promise<void> {
  expect(response.status).toBe(esperado.status);

  const contentType = response.headers.get('content-type') ?? '';
  expect(contentType).toMatch(/^application\/json/);
  expect(response.headers.get('cache-control')).toBe('no-store');

  const texto = await response.text();
  expect(texto.length).toBeGreaterThan(0);

  const body = JSON.parse(texto) as { ok: unknown; code: unknown; message: unknown };

  expect(body.ok).toBe(false);
  expect(body.code).toBe(esperado.code);
  expect(typeof body.message).toBe('string');
  expect((body.message as string).length).toBeGreaterThan(0);
}

beforeAll(async () => {
  tenantId = randomUUID();
  userId = randomUUID();

  sessao.tenantId = tenantId;
  sessao.userId = userId;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição da API da F76 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await adminPrisma.user.create({
    data: {
      id: userId,
      name: `Gestora da F76 ${RUN}`,
      email: `f76.api.user.${RUN}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: userId } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('miniatura do acervo — o id no caminho', () => {
  it('id malformado responde 404 com envelope (antes: 500 de corpo vazio)', async () => {
    const response = await midiaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/midia/nao-e-uuid/miniatura`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, assetId: 'nao-e-uuid' }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('uuid bem formado e inexistente responde o MESMO 404', async () => {
    const assetId = randomUUID();

    const response = await midiaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/midia/${assetId}/miniatura`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, assetId }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('download de exportação — o id no caminho', () => {
  it('id malformado responde 404 com envelope (antes: 500 de corpo vazio)', async () => {
    const response = await exportacoesRoute.GET(
      request(`/api/t/${TENANT_SLUG}/exportacoes/nao-e-uuid/arquivo`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, exportId: 'nao-e-uuid' }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('uuid bem formado e inexistente responde o MESMO 404', async () => {
    const exportId = randomUUID();

    const response = await exportacoesRoute.GET(
      request(`/api/t/${TENANT_SLUG}/exportacoes/${exportId}/arquivo`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, exportId }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('material de palestrante — o 403 "INTERNAL" virou 404', () => {
  it('id malformado responde 404 com envelope (antes: 403 INTERNAL ou 500)', async () => {
    const response = await palestrantesRoute.GET(
      request(`/api/t/${TENANT_SLUG}/palestrantes/materiais/nao-e-uuid/arquivo`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, materialId: 'nao-e-uuid' }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('uuid bem formado e inexistente responde o MESMO 404', async () => {
    const materialId = randomUUID();

    const response = await palestrantesRoute.GET(
      request(`/api/t/${TENANT_SLUG}/palestrantes/materiais/${materialId}/arquivo`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, materialId }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('folha de crachás — o `?eventId=` obrigatório é 400, não 404', () => {
  it('id malformado responde 400 com envelope (antes: 500 de corpo vazio)', async () => {
    const response = await folhaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/credenciamento/crachas/folha?eventId=nao-e-uuid`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 400, code: 'INVALID_INPUT' });
  });

  it('eventId ausente continua 400 (o contrato de antes)', async () => {
    const response = await folhaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/credenciamento/crachas/folha`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 400, code: 'INVALID_INPUT' });
  });

  it('uuid bem formado e inexistente responde 404 (o evento não existe)', async () => {
    const eventId = randomUUID();

    const response = await folhaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/credenciamento/crachas/folha?eventId=${eventId}`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('impressão de crachás — mesma escolha da folha', () => {
  it('id malformado responde 400 com envelope (antes: 500 de corpo vazio)', async () => {
    const response = await impressaoRoute.GET(
      request(
        `/api/t/${TENANT_SLUG}/credenciamento/crachas/impressao?eventId=nao-e-uuid&formato=etiquetas`,
      ),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 400, code: 'INVALID_INPUT' });
  });

  it('formato desconhecido também responde 400 com o envelope', async () => {
    const eventId = randomUUID();

    const response = await impressaoRoute.GET(
      request(
        `/api/t/${TENANT_SLUG}/credenciamento/crachas/impressao?eventId=${eventId}&formato=pdf`,
      ),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 400, code: 'INVALID_INPUT' });
  });

  it('uuid bem formado e inexistente responde 404 (o evento não existe)', async () => {
    const eventId = randomUUID();

    const response = await impressaoRoute.GET(
      request(
        `/api/t/${TENANT_SLUG}/credenciamento/crachas/impressao?eventId=${eventId}&formato=etiquetas`,
      ),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('agenda em .ics — o `?atividade=` é o endereço do arquivo', () => {
  it('atividade malformada responde 404 com envelope (antes: 500 INTERNAL)', async () => {
    const response = await agendaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/agenda/ics?atividade=nao-e-uuid`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'ATIVIDADE_NAO_ENCONTRADA' });
  });

  it('uuid bem formado e inexistente responde o MESMO 404', async () => {
    const response = await agendaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/agenda/ics?atividade=${randomUUID()}`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'ATIVIDADE_NAO_ENCONTRADA' });
  });

  it('o `?evento=` da grade também não chega ao Prisma malformado', async () => {
    /**
     * Este param não estava na lista medida, mas é o MESMO defeito na MESMA rota: o
     * `catch` do serviço transformava `evento=nao-e-uuid` em 500 `INTERNAL`. Fechado
     * junto, com a resposta que o serviço já dá para evento inexistente.
     */
    const response = await agendaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/agenda/ics?token=qualquer-token&evento=nao-e-uuid`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'EVENTO_NAO_ENCONTRADO' });
  });

  it('sem parâmetro nenhum continua 400 (não existe "agenda de todo mundo")', async () => {
    const response = await agendaRoute.GET(
      request(`/api/t/${TENANT_SLUG}/agenda/ics`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG }) },
    );

    await expectarEnvelope(response, { status: 400, code: 'INVALID_INPUT' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('prévia ao vivo do sorteio — o 200 com erro no corpo', () => {
  it('id malformado responde 404 com envelope (antes: 200 {ok:false})', async () => {
    const response = await raffleLiveRoute.GET(
      request(`/api/events/nao-e-uuid/raffle-live?tenantSlug=${TENANT_SLUG}&scope=EVENT`),
      { params: Promise.resolve({ eventId: 'nao-e-uuid' }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('uuid bem formado continua respondendo a prévia em JSON (200)', async () => {
    /**
     * O formato é o que mudou, não a leitura: a prévia conta elegíveis e não promete
     * que o evento exista. Um uuid bem formado (ainda que sem evento) continua 200 —
     * a correção é só para o texto que NÃO é id.
     */
    const eventId = randomUUID();

    const response = await raffleLiveRoute.GET(
      request(`/api/events/${eventId}/raffle-live?tenantSlug=${TENANT_SLUG}&scope=EVENT`),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean; eligibleCount: number };
    expect(body.ok).toBe(true);
    expect(body.eligibleCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('QR do patrocinador — a mudança de contrato declarada', () => {
  it('id malformado responde 404 com o envelope novo (antes: `{error}`)', async () => {
    const response = await qrRoute.GET(
      request(`/api/t/${TENANT_SLUG}/patrocinadores/qr/nao-e-uuid`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, qrId: 'nao-e-uuid' }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('uuid bem formado e inexistente responde o MESMO 404', async () => {
    const qrId = randomUUID();

    const response = await qrRoute.GET(
      request(`/api/t/${TENANT_SLUG}/patrocinadores/qr/${qrId}`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, qrId }) },
    );

    await expectarEnvelope(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('formato inválido responde 400 com o envelope novo (antes: `{error}`)', async () => {
    const qrId = randomUUID();

    const response = await qrRoute.GET(
      request(`/api/t/${TENANT_SLUG}/patrocinadores/qr/${qrId}?formato=pdf`),
      { params: Promise.resolve({ tenantSlug: TENANT_SLUG, qrId }) },
    );

    await expectarEnvelope(response, { status: 400, code: 'INVALID_INPUT' });
  });
});
