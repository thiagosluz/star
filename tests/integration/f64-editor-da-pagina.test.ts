/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — O EDITOR DA PÁGINA DA INSTITUIÇÃO PELA SERVER ACTION
 *                                                            (FASE 64 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CAMINHO TESTADO É A SERVER ACTION, E NÃO O SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O serviço de gravação já tem prova (a fatia 1). O que NENHUM outro teste
 *  alcança é a PORTA: toda autorização do sistema é verificada na Server Action, e
 *  o defeito que este arquivo existe para prender é o da recusa que GRAVA — o
 *  cenário em que a action responde "permissão negada" e o rascunho mudou mesmo
 *  assim, porque a guarda rodou depois da escrita (ou não rodou).
 *
 *  Por isso cada caso de recusa afirma DUAS coisas: a resposta E o banco. A segunda
 *  é a que importa — uma mensagem de erro com o dado alterado é pior do que um erro
 *  sem mensagem, porque ninguém desconfia dele.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SESSÃO É SUBSTITUÍDA; O RBAC NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getAuthenticatedUser` lê o cookie de sessão do Better Auth, que não existe fora
 *  de uma requisição do Next — então ele é trocado por um dublê que devolve a pessoa
 *  do caso. Todo o resto do caminho é REAL: `user_tenant_profiles`,
 *  `role_assignments`, `loadPrincipal` (que lê as concessões sob RLS) e `can`. A
 *  fronteira é a mesma que o navegador usa (a sessão), e não uma prop inventada
 *  para o teste poder entrar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getAdminTenantPage } from '../../src/lib/tenancy/tenant-public-page-view';
import { saveTenantPublicPageDraft } from '../../src/lib/tenancy/tenant-public-page-write-service';

/**
 * A sessão do caso — `vi.hoisted` porque o dublê é içado para antes das declarações
 * do arquivo: sem ele, a fábrica fecharia sobre uma variável ainda não inicializada.
 */
const sessao = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('../../src/lib/auth/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/auth/session')>();

  return {
    ...real,
    getAuthenticatedUser: async () =>
      sessao.userId === null
        ? null
        : {
            id: sessao.userId,
            name: 'Pessoa do teste',
            email: `${sessao.userId}@exemplo.test`,
            image: null,
            publicHandle: null,
            emailVerified: true,
          },
  };
});

/** `revalidatePath` só existe dentro de uma requisição do Next — e não é o assunto. */
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const {
  addTenantPageBlockAction,
  publishTenantPageAction,
  saveTenantPageSettingsAction,
  unpublishTenantPageAction,
} = await import('../../src/app/actions/tenant-page-actions');

const RUN = randomUUID().slice(0, 8);

/** A instituição de quem PODE, e a de quem NÃO pode (papel PARTICIPANT). */
let tenantId: string;
let tenantSlug: string;
let outroTenantId: string;
let outroTenantSlug: string;

let administradora: string;
let participante: string;

const TITULO_INICIAL = `Instituto F64 ${RUN}`;
const TITULO_EDITADO = `Instituto de Artes ${RUN}`;

async function criarTenant(slug: string, nome: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.tenant.create({
    data: { id, slug, name: nome, status: 'ACTIVE', plan: 'PROFESSIONAL', timezone: 'America/Bahia' },
  });

  return id;
}

async function criarPessoa(input: {
  tenantId: string;
  role: 'ADMIN' | 'PARTICIPANT';
  nome: string;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name: input.nome, email: `f64ed.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: id,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  await withTenant(input.tenantId, (tx) =>
    tx.roleAssignment.create({
      data: { id: randomUUID(), tenantId: input.tenantId, userId: id, role: input.role, scope: 'TENANT' },
    }),
  );

  return id;
}

/** O rascunho como o banco o guarda — a leitura da administração, sem tela. */
async function rascunho(tenant: string) {
  const page = await getAdminTenantPage(tenant);

  return page?.draft ?? null;
}

function formulario(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);

  return data;
}

beforeAll(async () => {
  tenantSlug = `f64-editor-${RUN}`;
  outroTenantSlug = `f64-editor-sem-permissao-${RUN}`;

  tenantId = await criarTenant(tenantSlug, `Instituição do Editor ${RUN}`);
  outroTenantId = await criarTenant(outroTenantSlug, `Instituição Sem Permissão ${RUN}`);

  administradora = await criarPessoa({ tenantId, role: 'ADMIN', nome: 'Administradora F64' });
  participante = await criarPessoa({
    tenantId: outroTenantId,
    role: 'PARTICIPANT',
    nome: 'Participante F64',
  });

  /** A página nasce pelo serviço REAL (fatia 1), como o editor a cria ao salvar. */
  const inicial = await saveTenantPublicPageDraft({
    tenantId,
    actorId: administradora,
    title: TITULO_INICIAL,
    description: 'A casa do editor.',
    blocks: [{ type: 'ABOUT', content: { title: 'Nossa história', body: 'Fundada em 1957.' } }],
  });

  if (!inicial.ok) throw new Error(`falha ao criar a fixture: ${inicial.message}`);
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, outroTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { id: { in: [administradora, participante] } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · quem tem `page:manage` grava e publica pela Server Action', () => {
  it('salva o rascunho, e o rascunho é o que o banco guarda', async () => {
    sessao.userId = administradora;

    const resposta = await saveTenantPageSettingsAction(
      null,
      formulario({
        tenantSlug,
        title: TITULO_EDITADO,
        description: 'A casa das artes.',
        primaryColor: '#0f6f8c',
        theme: JSON.stringify({ radius: 8, fontFamily: 'system', spacing: 'normal', animation: 'none' }),
      }),
    );

    expect(resposta.ok, resposta.message).toBe(true);

    const draft = await rascunho(tenantId);

    expect(draft?.title).toBe(TITULO_EDITADO);
    expect(draft?.description).toBe('A casa das artes.');
    /** A cor escolhida entrou no rascunho — a identidade é o que se grava. */
    expect(draft?.theme).toMatchObject({ primaryColor: '#0f6f8c' });
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O MODO NÃO É GRAVÁVEL PELO FORMULÁRIO — E ESTE CASO TENTA GRAVÁ-LO
     * ─────────────────────────────────────────────────────────────────────────────
     *  `colorMode: 'dark'` e um `backgroundColor` são enviados de propósito. O
     *  primeiro é descartado (o esquema do domínio o normaliza para o padrão); o
     *  segundo não tem leitor nenhum no caminho da action. Se alguém "abrir" esses
     *  campos para o formulário, a paleta da instituição passa a poder matar o
     *  claro/escuro do visitante — e este `expect` é o que reprova isso.
     */
    expect(draft?.theme).not.toHaveProperty('backgroundColor');
    expect(draft?.theme).not.toHaveProperty('textColor');
    expect((draft?.theme as Record<string, unknown> | undefined)?.colorMode).not.toBe('dark');
  });

  it('um `colorMode` forjado no formulário não vence a regra do visitante', async () => {
    sessao.userId = administradora;

    const resposta = await saveTenantPageSettingsAction(
      null,
      formulario({
        tenantSlug,
        title: TITULO_EDITADO,
        colorMode: 'dark',
        backgroundColor: '#000000',
        textColor: '#ffffff',
        theme: JSON.stringify({ radius: 8, colorMode: 'dark', backgroundColor: '#000000' }),
      }),
    );

    expect(resposta.ok, resposta.message).toBe(true);

    const draft = await rascunho(tenantId);

    expect(draft?.theme).not.toHaveProperty('backgroundColor');
    expect(draft?.theme).not.toHaveProperty('textColor');
    expect((draft?.theme as Record<string, unknown> | undefined)?.colorMode).not.toBe('dark');
  });

  it('publica o que está GRAVADO — e o publicado passa a ser o rascunho', async () => {
    sessao.userId = administradora;

    const resposta = await publishTenantPageAction(null, formulario({ tenantSlug, salvarAntes: '0' }));

    expect(resposta.ok, resposta.message).toBe(true);

    const page = await getAdminTenantPage(tenantId);

    expect(page?.publication.state).toBe('PUBLISHED');
    expect(page?.published?.title).toBe(TITULO_EDITADO);
    expect(page?.publication.publishedAt).toBeInstanceOf(Date);
  });

  it('despublicar tira do ar sem apagar o rascunho', async () => {
    sessao.userId = administradora;

    const fora = await unpublishTenantPageAction(null, formulario({ tenantSlug }));

    expect(fora.ok, fora.message).toBe(true);

    const page = await getAdminTenantPage(tenantId);

    expect(page?.publication.state).toBe('NEVER_PUBLISHED');
    expect(page?.published).toBeNull();
    /** O trabalho continua lá — é a promessa da tela de "tirar do ar". */
    expect(page?.draft.title).toBe(TITULO_EDITADO);
    expect(page?.draft.blocks).toHaveLength(1);
  });

  it('a ação de bloco grava pela MESMA porta, com a permissão conferida', async () => {
    sessao.userId = administradora;

    const antes = await rascunho(tenantId);
    const resposta = await addTenantPageBlockAction(null, formulario({ tenantSlug, type: 'CONTACT' }));

    expect(resposta.ok, resposta.message).toBe(true);

    const depois = await rascunho(tenantId);

    expect(depois?.blocks).toHaveLength((antes?.blocks.length ?? 0) + 1);
    expect(depois?.blocks.some((block) => block.type === 'CONTACT')).toBe(true);
  });

  it('a trilha registra a publicação com o autor e o tipo da entidade', async () => {
    sessao.userId = administradora;

    const resposta = await publishTenantPageAction(null, formulario({ tenantSlug, salvarAntes: '0' }));
    expect(resposta.ok, resposta.message).toBe(true);

    const trilha = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId, entityType: 'tenantPublicPage', userId: administradora },
        orderBy: { createdAt: 'desc' },
        select: { action: true, entityType: true, userId: true },
        take: 5,
      }),
    );

    expect(trilha.length).toBeGreaterThan(0);
    expect(trilha[0]?.action).toBe('UPDATE');
    expect(trilha[0]?.userId).toBe(administradora);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · quem NÃO tem a permissão recebe a recusa — e a recusa não grava', () => {
  it('salvar é recusado, e o rascunho do banco não muda', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A INSTITUIÇÃO É DE QUEM CHAMA; O PAPEL É QUE NÃO BASTA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O participante TEM vínculo ativo com a instituição dele (senão a recusa seria
     *  por vínculo, e não por permissão). O que ele não tem é `page:manage` — e é
     *  isso que a Server Action precisa recusar, antes de qualquer escrita.
     */
    sessao.userId = participante;

    const antes = await rascunho(outroTenantId);
    expect(antes).toBeNull();

    const resposta = await saveTenantPageSettingsAction(
      null,
      formulario({ tenantSlug: outroTenantSlug, title: 'Página que não deve existir' }),
    );

    expect(resposta.ok).toBe(false);
    expect(resposta.code).toBe('FORBIDDEN');

    /** A prova que importa: NADA foi criado. */
    const depois = await rascunho(outroTenantId);
    expect(depois).toBeNull();
  });

  it('publicar é recusado, e o que está no ar continua igual', async () => {
    sessao.userId = participante;

    const resposta = await publishTenantPageAction(null, formulario({ tenantSlug: outroTenantSlug }));

    expect(resposta.ok).toBe(false);
    expect(resposta.code).toBe('FORBIDDEN');

    const page = await getAdminTenantPage(outroTenantId);
    expect(page).toBeNull();
  });

  it('acrescentar bloco é recusado, e a contagem de blocos não muda', async () => {
    const antes = await rascunho(tenantId);
    const blocosAntes = antes?.blocks.length ?? 0;

    sessao.userId = participante;

    const resposta = await addTenantPageBlockAction(
      null,
      formulario({ tenantSlug, type: 'FAQ' }),
    );

    expect(resposta.ok).toBe(false);
    expect(resposta.code).toBe('FORBIDDEN');

    const depois = await rascunho(tenantId);
    expect(depois?.blocks.length ?? 0).toBe(blocosAntes);
  });

  it('sem sessão nenhuma, a recusa é de autenticação — e também não grava', async () => {
    sessao.userId = null;

    const resposta = await saveTenantPageSettingsAction(
      null,
      formulario({ tenantSlug, title: 'Página anônima' }),
    );

    expect(resposta.ok).toBe(false);
    expect(resposta.code).toBe('NOT_AUTHENTICATED');

    const draft = await rascunho(tenantId);
    expect(draft?.title).toBe(TITULO_EDITADO);
  });
});
