/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — A PÁGINA DA SUBMISSÃO CONFERE O AUTOR (FASE 74 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página `/t/<slug>/submissoes/<submissionId>` lia a submissão só por
 *  INSTITUIÇÃO (`getSubmission`), sem comparar com quem estava abrindo. Qualquer
 *  membro do tenant que soubesse o UUID — um link copiado, um e-mail reencaminhado —
 *  lia título, resumo completo, autores com e-mail, arquivos, nota e decisão de um
 *  trabalho alheio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXECUTA A PÁGINA, E NÃO SÓ O SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A correção é a página responder 404 — e "404" não é um valor de retorno de
 *  serviço: é o `notFound()` do Next interrompendo a renderização. Um teste que só
 *  chamasse o serviço de posse provaria a REGRA e não a PORTA; o defeito era
 *  exatamente a porta que não usava a regra.
 *
 *  Aqui a página é chamada de verdade (o componente de servidor é uma função), com
 *  o banco de verdade. O que é substituído:
 *
 *    • a SESSÃO (`getRequestContext` lê cookie do Better Auth, que não existe fora
 *      de uma requisição do Next) — é o "quem está abrindo" do caso;
 *    • `notFound()`/`redirect()`, que viram sentinelas: é assim que se observa que
 *      a página interrompeu;
 *    • os componentes de cliente da tela (uploader, formulários) — eles são o
 *      território das FASES 4/17, com cobertura própria em E2E, e não participam da
 *      decisão de posse.
 *
 *  O QUE NÃO É SUBSTITUÍDO: `getSubmission`, a autoria, a rubrica, a régua de
 *  prontidão e a leitura de posse — as leituras que a página faz de fato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { createSubmission } from '../../src/lib/review/submission-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f74-pagina-${RUN}`;
const TITULO = `Trabalho sigiloso da autora ${RUN}`;
const RESUMO =
  'Este resumo é o metadado que a página não pode entregar a quem não é o autor: ele descreve o trabalho inteiro, e é justamente por isso que a leitura alheia era danosa. O texto segue com detalhe suficiente para passar da validação de conteúdo do domínio.';

/** O que a sessão do caso enxerga — trocado entre os testes. */
const sessao = vi.hoisted(() => ({ userId: null as string | null }));

/**
 * A INSTITUIÇÃO ATIVA do contexto: a página exige que o slug da URL seja o da
 * sessão (senão manda escolher instituição), e é o id dela que vai para a leitura.
 */
const contexto = vi.hoisted(() => ({ tenantId: '', tenantSlug: '' }));

vi.mock('../../src/lib/auth/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/auth/session')>();

  return {
    ...real,
    getRequestContext: async () =>
      sessao.userId === null
        ? null
        : {
            user: {
              id: sessao.userId,
              name: 'Pessoa do teste',
              email: `${sessao.userId}@exemplo.test`,
              image: null,
              publicHandle: null,
              emailVerified: true,
            },
            memberships: [],
            activeTenant: {
              tenantId: contexto.tenantId,
              tenantSlug: contexto.tenantSlug,
              tenantName: `Instituição ${RUN}`,
              status: 'ACTIVE',
              kind: 'MEMBER',
              roles: [],
            },
            principal: null,
            sessionId: 'sessao-do-teste',
          },
  };
});

/** `notFound()`/`redirect()` param a renderização — é o que o teste observa. */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

/** `revalidatePath` só existe dentro de uma requisição do Next — e não é o assunto. */
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

/** `next/link` vira uma âncora comum: o teste mede a página, não o roteador. */
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement('a', { href: props.href }, props.children as never),
}));

/**
 * Os componentes de cliente da tela são trocados por `null`: a decisão de posse
 * acontece ANTES de qualquer um deles, e o que este teste procura no HTML é o
 * metadado (título, protocolo, resumo) — que a própria página desenha.
 */
vi.mock('../../src/components/review/submission-uploader', () => ({
  SubmissionUploader: () => null,
}));
vi.mock('../../src/components/review/submit-submission-button', () => ({
  SubmitSubmissionButton: () => null,
}));
vi.mock('../../src/components/review/author-editor', () => ({ AuthorEditor: () => null }));
vi.mock('../../src/components/review/delete-draft-button', () => ({ DeleteDraftButton: () => null }));
vi.mock('../../src/components/review/withdraw-submission-button', () => ({
  WithdrawSubmissionButton: () => null,
}));
vi.mock('../../src/components/review/submission-draft-form', () => ({
  /**
   * O formulário do rascunho é quem DESENHA o resumo no modo editável. O dublê
   * desenha o texto que a página entregou a ele (`initial.abstract`): é essa a
   * prova de que o metadado chegou ao autor — e não a um mock vazio.
   */
  SubmissionDraftForm: (props: { initial?: { abstract?: string } }) =>
    createElement(
      'p',
      { 'data-testid': 'draft-form-resumo' },
      props.initial?.abstract ?? '',
    ),
}));

const { default: SubmissionDetailPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/submissoes/[submissionId]/page'
);

let tenantId: string;
let eventId: string;
let trackId: string;

/** A autora do trabalho — dona da submissão. */
let autoraId: string;
/** Membro ATIVO da MESMA instituição, sem relação com o trabalho. */
let outroMembroId: string;

let submissionId: string;
let protocolo: string;

async function criarPessoa(nome: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: nome,
      email: `f74.pagina.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: id,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  await withTenant(tenantId, (tx) =>
    tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: id,
        role: 'PARTICIPANT',
        scope: 'TENANT',
      },
    }),
  );

  return id;
}

/** Chama a página como o Next faria — e devolve o HTML que ela produziria. */
async function renderizarPagina(alvo: string): Promise<string> {
  const elemento = await SubmissionDetailPage({
    params: Promise.resolve({ tenantSlug: TENANT_SLUG, submissionId: alvo }),
    searchParams: Promise.resolve({}),
  });

  return renderToStaticMarkup(elemento);
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();
  contexto.tenantId = tenantId;
  contexto.tenantSlug = TENANT_SLUG;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição da Página da Submissão ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  autoraId = await criarPessoa(`Autora da página ${RUN}`);
  outroMembroId = await criarPessoa(`Outro membro da página ${RUN}`);

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f74-pagina-${RUN}`,
        title: 'Seminário da Página da Submissão',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-f74-pagina-${RUN}`,
        name: 'Trilha da página',
        requiresBlindReview: true,
        requiredReviews: 2,
      },
    });
  });

  const criada = await createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: autoraId,
    title: TITULO,
    abstract: RESUMO,
    keywords: ['sigilo', 'posse', 'submissão'],
  });

  if (!criada.ok) throw new Error(`Falha ao criar a submissão: ${criada.message}`);

  submissionId = criada.id;
  protocolo = criada.protocol;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a página da submissão', () => {
  it('o AUTOR lê: título, protocolo e resumo chegam ao HTML', async () => {
    sessao.userId = autoraId;

    const html = await renderizarPagina(submissionId);

    expect(html).toContain(TITULO);
    expect(html).toContain(protocolo);
    expect(html).toContain('Este resumo é o metadado que a página não pode entregar');
  });

  it('outro membro do MESMO tenant com o UUID recebe 404 — e nenhum metadado', async () => {
    sessao.userId = outroMembroId;

    /**
     * O `notFound()` interrompe a renderização: não existe HTML desta página para
     * este leitor. É a diferença entre "esconder um bloco" e "não haver página" — e
     * é por isso que a asserção é sobre a REJEIÇÃO, não sobre um texto ausente.
     */
    await expect(renderizarPagina(submissionId)).rejects.toThrow('NEXT_NOT_FOUND');

    /**
     * A MESMA resposta de "não existe": a página não é oráculo de existência. Um
     * UUID inexistente e o UUID real de outra pessoa caem no mesmo lugar — e o
     * rejeitado não carrega nada da submissão.
     */
    await expect(renderizarPagina(randomUUID())).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, a página manda entrar (o 404 não substitui o login)', async () => {
    sessao.userId = null;

    await expect(renderizarPagina(submissionId)).rejects.toThrow(/NEXT_REDIRECT:\/login/);
  });

  it('a página recusa ANTES de ler o detalhe: a posse não depende do que a tela carrega', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTA CATRACA É DE ORDEM, E NÃO DE VALOR
     * ─────────────────────────────────────────────────────────────────────────────
     *  A leitura negativa de posse (`loadSubmissionPageAccess`) precisa acontecer
     *  antes de `getSubmission`. Se a ordem se invertesse, a recusa continuaria
     *  acontecendo — mas os metadados já teriam sido carregados, e qualquer coisa
     *  acrescentada no caminho até o `notFound()` (um log, um aviso, uma seção)
     *  passaria a vazar sobre uma submissão alheia. O import e a posição prendem a
     *  ordem; o comportamento está nos dois casos acima.
     */
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const fonte = readFileSync(
      join(process.cwd(), 'src/app/t/[tenantSlug]/(app)/submissoes/[submissionId]/page.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    const posse = fonte.indexOf('loadSubmissionPageAccess(');
    const detalhe = fonte.indexOf('getSubmission(');

    expect(posse).toBeGreaterThan(-1);
    expect(detalhe).toBeGreaterThan(-1);
    expect(posse).toBeLessThan(detalhe);
  });
});

