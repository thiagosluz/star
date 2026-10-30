/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 76 · O ID MALFORMADO RESPONDE 404 (OU 400), NUNCA 500
 *  A TABELA DE COMPORTAMENTO — 35 CASOS, UMA `for` DE `test()`
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Com `nao-e-uuid` no lugar de um id, 42 URLs respondiam 25 × 500, 5 × 200 com
 *  painel de erro e 3 × 400 — só 13 das 42 davam a resposta certa. A causa é
 *  sempre a mesma: o texto descia até o Prisma, o Postgres recusava
 *  (`invalid input syntax for type uuid`, armadilha 25) e o `notFound()` da página
 *  ficava DEPOIS da consulta que estourava.
 *
 *  A correção tem duas metades (fatias 1 e 2): a página chama `requireUuidParam`
 *  antes de tudo; a rota chama `isUuid` + `tenantApiError` antes de consultar.
 *  Este spec mede o RESULTADO, não a chamada: para cada endereço da tabela, o
 *  cliente HTTP recebe **404** — e **400** onde o id é ENTRADA OBRIGATÓRIA de uma
 *  operação: as duas rotas de crachá (`?eventId=`), o lote de certificados
 *  (`?evento=`, achado pela catraca e fechado na fatia 3) e a prévia do sorteio no
 *  escopo de atividade (`?activityId=`, também achado e fechado). O formato não
 *  muda a natureza do pedido: entrada obrigatória → 400 `INVALID_INPUT`; endereço
 *  do recurso → 404.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TABELA É A LISTA POSITIVA DA FASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  24 casos de PÁGINA (23 páginas; `demandas/[demandId]` tem DOIS ids, e cada um
 *  ganha o seu caso para que o segundo não fique sem prova) + 11 casos de API (9
 *  rotas; a agenda tem `?atividade=`/`?evento=` e a prévia do sorteio tem o
 *  `eventId` do caminho e o `?activityId=`). O catálogo de fonte
 *  (`tests/unit/f76-catalogo-de-ids.test.ts`) prende a lista; este arquivo prende
 *  a resposta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS SESSÕES SÃO AS DA CASA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O layout da instituição autoriza ANTES da página — um anônimo é redirecionado
 *  ao login. Por isso os casos de painel entram com `admin` (ADMIN no tenant), as
 *  duas rotas de crachá com `staff` (é o papel que opera `attendance:manage`), a
 *  página de plataforma com `superadmin`, e as rotas públicas (agenda, material
 *  de palestrante) sem sessão. A fixture vem de `tests/e2e/helpers.ts`; nada de
 *  SQL à mão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SPEC NÃO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele não prova que o id VÁLIDO continua carregando a tela — isso é
 *  `tests/integration/f76-paginas-com-id.test.ts` e `f76-rotas-de-api.test.ts`,
 *  que exercitam uuid existente e uuid inexistente. Aqui o recorte é o FORMATO.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f76-id';

/** O texto que não é uuid — o caso real de quem cola um endereço truncado. */
const ID_MALFORMADO = 'nao-e-uuid';

/**
 * Um uuid VÁLIDO e inexistente para o OUTRO param de `demandas/[demandId]`.
 *
 * Ele precisa ter forma de uuid: se fosse um segundo `nao-e-uuid`, o primeiro
 * param mascararia o segundo e o caso do `demandId` não mediria nada.
 */
const UUID_VALIDO = randomUUID();

type Sessao = 'admin' | 'staff' | 'superadmin' | 'anonimo';
type Tipo = 'pagina' | 'api';
type AreaDeErro = 'app' | 'platform';

interface Caso {
  /** O que o caso mede — vira o título do teste. */
  nome: string;
  tipo: Tipo;
  /** O caminho é montado com o slug da fixture (o superadmin não usa). */
  caminho: (slug: string) => string;
  sessao: Sessao;
  status: 400 | 404;
  /** Só para API: o `code` do envelope. */
  codigo?: string;
  /** Só para página: qual `area-not-found` tem de aparecer. */
  area?: AreaDeErro;
}

const CASOS: readonly Caso[] = [
  // ── As 23 páginas da fatia 1 (24 casos: duas provas para demandas) ───────────
  {
    nome: 'raiz do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'API do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/api`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'chamadas do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/chamadas`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    /**
     * A tela de emissão em lote do evento (FASE 85) nasceu DEPOIS da tabela, e o
     * caso entra aqui porque a régua não é retroativa: página nova com `[eventId]`
     * chama `requireUuidParam` antes de consultar, e o malformado responde 404 —
     * não o 500 do `P2023` (armadilha 25).
     */
    nome: 'certificados do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/certificados`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'confirmações de vaga',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/confirmacoes`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'dados do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/dados`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'demandas — eventId malformado',
    tipo: 'pagina',
    caminho: (slug) =>
      `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/demandas/${UUID_VALIDO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'demandas — demandId malformado',
    tipo: 'pagina',
    caminho: (slug) =>
      `/t/${slug}/administracao/eventos/${UUID_VALIDO}/demandas/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'quadro de demandas',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/demandas`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'equipes do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/equipes`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'formulário de inscrição do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/formulario`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'editor da página',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/pagina`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'acervo de mídia da página',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/pagina/midia`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'prévia da página',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/pagina/previa`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'palestrantes do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/palestrantes`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'patrocinadores do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/patrocinadores`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'programação do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/programacao`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'reconhecimento do comitê',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/reconhecimento`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'salas do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/salas`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'sorteios do evento',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/administracao/eventos/${ID_MALFORMADO}/sorteios`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'painel do comitê (submissão)',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/comite/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'ficha do participante',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/participantes/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'página de avaliação (revisor)',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/revisoes/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'detalhe da submissão (autor)',
    tipo: 'pagina',
    caminho: (slug) => `/t/${slug}/submissoes/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    area: 'app',
  },
  {
    nome: 'detalhe da instituição (plataforma)',
    tipo: 'pagina',
    caminho: () => `/superadmin/tenants/${ID_MALFORMADO}`,
    sessao: 'superadmin',
    status: 404,
    area: 'platform',
  },

  // ── As 9 rotas de API — as 8 da fatia 2 + o ZIP, fechado na fatia 3 ──────────
  //    (11 casos: a agenda tem dois params, a prévia do sorteio tem dois)
  {
    nome: 'API — prévia ao vivo do sorteio',
    tipo: 'api',
    caminho: (slug) =>
      `/api/events/${ID_MALFORMADO}/raffle-live?tenantSlug=${slug}&scope=EVENT`,
    sessao: 'admin',
    status: 404,
    codigo: 'NOT_FOUND',
  },
  {
    /**
     * O param que a catraca achou: no escopo de atividade, `activityId` é entrada
     * obrigatória. O evento é REAL (fixture) para que o pedido chegue ao portão
     * com tudo o que ele exige — o 400 é do FORMATO, não de "evento inexistente".
     */
    nome: 'API — prévia ao vivo do sorteio (activityId obrigatório, 400)',
    tipo: 'api',
    caminho: (slug) =>
      `/api/events/${eventId}/raffle-live?tenantSlug=${slug}&scope=ACTIVITY&activityId=${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 400,
    codigo: 'INVALID_INPUT',
  },
  {
    nome: 'API — agenda em .ics por atividade',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/agenda/ics?atividade=${ID_MALFORMADO}`,
    sessao: 'anonimo',
    status: 404,
    codigo: 'ATIVIDADE_NAO_ENCONTRADA',
  },
  {
    nome: 'API — agenda em .ics por evento',
    tipo: 'api',
    caminho: (slug) =>
      `/api/t/${slug}/agenda/ics?token=qualquer-token&evento=${ID_MALFORMADO}`,
    sessao: 'anonimo',
    status: 404,
    codigo: 'EVENTO_NAO_ENCONTRADO',
  },
  {
    nome: 'API — folha de crachás (400: pedido, não recurso)',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/credenciamento/crachas/folha?eventId=${ID_MALFORMADO}`,
    sessao: 'staff',
    status: 400,
    codigo: 'INVALID_INPUT',
  },
  {
    nome: 'API — impressão de crachás (400: pedido, não recurso)',
    tipo: 'api',
    caminho: (slug) =>
      `/api/t/${slug}/credenciamento/crachas/impressao?eventId=${ID_MALFORMADO}&formato=etiquetas`,
    sessao: 'staff',
    status: 400,
    codigo: 'INVALID_INPUT',
  },
  {
    /**
     * O outro param que a catraca achou. O evento é a ENTRADA OBRIGATÓRIA da
     * operação; malformado, é 400 `INVALID_INPUT` — antes, o texto descia ao
     * Prisma, o serviço engolia o `P2023` e a rota respondia 400 `INTERNAL`.
     */
    nome: 'API — lote de certificados (400: evento é entrada obrigatória)',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/certificados/zip?evento=${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 400,
    codigo: 'INVALID_INPUT',
  },
  {
    nome: 'API — download de exportação',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/exportacoes/${ID_MALFORMADO}/arquivo`,
    sessao: 'admin',
    status: 404,
    codigo: 'NOT_FOUND',
  },
  {
    nome: 'API — miniatura do acervo',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/midia/${ID_MALFORMADO}/miniatura`,
    sessao: 'admin',
    status: 404,
    codigo: 'NOT_FOUND',
  },
  {
    nome: 'API — material de palestrante',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/palestrantes/materiais/${ID_MALFORMADO}/arquivo`,
    sessao: 'anonimo',
    status: 404,
    codigo: 'NOT_FOUND',
  },
  {
    nome: 'API — QR do patrocinador',
    tipo: 'api',
    caminho: (slug) => `/api/t/${slug}/patrocinadores/qr/${ID_MALFORMADO}`,
    sessao: 'admin',
    status: 404,
    codigo: 'NOT_FOUND',
  },
];

let tenantSlug: string;
let eventId: string;
let adminEmail: string;
let staffEmail: string;
let superadminEmail: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ email: string }> {
  const email = `f76.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  return { email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3000' },
  });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

async function idDe(email: string): Promise<string> {
  const pessoa = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return pessoa.id;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do id malformado ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;

    /**
     * O evento REAL da fixture: a prévia do sorteio no escopo de atividade exige
     * um evento que exista (e `event:manage`), e o lote de certificados é uma
     * operação por evento. O id malformado que os casos usam é o do PARAM, não o
     * do evento.
     */
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `f76-id-${RUN_ID}`,
      title: `Evento do id malformado ${RUN_ID}`,
    });

    eventId = event.id;

    const admin = await signUpVia(api, 'Administradora do id malformado');
    const adminId = await idDe(admin.email);
    await linkUser({ userId: adminId, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: adminId, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });
    adminEmail = admin.email;

    /**
     * `STAFF` é o papel que opera o credenciamento (`attendance:manage`) — é a
     * sessão real das duas rotas de crachá. Usar `admin` ali provaria a guarda
     * errada.
     */
    const staff = await signUpVia(api, 'Equipe de credenciamento do id malformado');
    const staffId = await idDe(staff.email);
    await linkUser({ userId: staffId, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: staffId, tenantId: tenant.id, role: 'STAFF', scope: 'TENANT' });
    staffEmail = staff.email;

    /** A página de plataforma exige papel de PLATAFORMA, não vínculo com a instituição. */
    const superadmin = await signUpVia(api, 'SuperAdmin do id malformado');
    const superadminId = await idDe(superadmin.email);
    await grantPlatformRole({ userId: superadminId });
    superadminEmail = superadmin.email;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 76 · a tabela de comportamento do id malformado', () => {
  test('a tabela tem 36 casos — 25 de página e 11 de API', () => {
    /**
     * A contagem é o contrato do spec: 24 páginas (+1 param de `demandas`) e 9
     * rotas (+1 param da agenda, +1 `activityId` da prévia). A FASE 85 acrescentou
     * a página de certificados do evento; os dois últimos casos de API vieram dos
     * buracos que a catraca de fonte achou e a fatia 3 fechou. Se alguém
     * acrescentar um caso, este número obriga a atualizar o comentário e a saber o
     * que se está medindo.
     */
    expect(CASOS).toHaveLength(36);
    expect(CASOS.filter((caso) => caso.tipo === 'pagina')).toHaveLength(25);
    expect(CASOS.filter((caso) => caso.tipo === 'api')).toHaveLength(11);
  });

  for (const caso of CASOS) {
    test(`${caso.tipo} · ${caso.nome} → ${caso.status}`, async ({ page }) => {
      if (caso.sessao === 'admin') await signInAs(page, adminEmail);
      if (caso.sessao === 'staff') await signInAs(page, staffEmail);
      if (caso.sessao === 'superadmin') await signInAs(page, superadminEmail);

      const caminho = caso.caminho(tenantSlug);

      if (caso.tipo === 'pagina') {
        const resposta = await page.goto(caminho);

        /**
         * ─── O STATUS É A PROVA ────────────────────────────────────────────────
         * 500 é o defeito; 307 é o layout redirecionando (a sessão da tabela não
         * serviu); 200 é o painel de erro disfarçado. A tabela só passa com o
         * status que a fase decidiu.
         */
        expect(resposta?.status(), `${caminho} respondeu ${resposta?.status()}`).toBe(caso.status);

        const area = caso.area ?? 'app';
        const tela = page.getByTestId(`area-not-found-${area}`);

        await expect(tela).toBeVisible();
        await expect(tela).toContainText('Página não encontrada');

        /** A tela do framework em inglês é a assinatura do 404 que a F75 substituiu. */
        await expect(page.locator('body')).not.toContainText('This page could not be found');
        return;
      }

      const resposta = await page.request.get(caminho);

      expect(resposta.status(), `${caminho} respondeu ${resposta.status()}`).toBe(caso.status);
      expect(resposta.headers()['content-type'] ?? '').toMatch(/^application\/json/);
      expect(resposta.headers()['cache-control']).toBe('no-store');

      const corpo = (await resposta.json()) as {
        ok: unknown;
        code: unknown;
        message: unknown;
      };

      /**
       * O envelope é metade da correção: antes, cinco rotas respondiam 500 SEM
       * CORPO. Status certo com corpo vazio ainda seria o pior contrato.
       */
      expect(corpo.ok).toBe(false);
      expect(corpo.code).toBe(caso.codigo);
      expect(typeof corpo.message).toBe('string');
      expect((corpo.message as string).length).toBeGreaterThan(0);
    });
  }
});
