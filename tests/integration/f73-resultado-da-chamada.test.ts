/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — O RESULTADO DA CHAMADA: O SERVIÇO E AS SERVER ACTIONS
 *                                                          (FASE 73 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • as QUATRO ações gravam o objeto inteiro e o estado certo, e cada uma deixa a
 *    SUA trilha (ação explícita, estado anterior, estado novo, contagem) na MESMA
 *    transação — sem o texto e sem dado pessoal;
 *  • o FINAL trava: `SALVAR_RASCUNHO`, `PUBLICAR_PARCIAL` e `PUBLICAR_FINAL` a partir
 *    de FINAL são recusados com o motivo do DOMÍNIO, e o banco fica INTACTO (o JSON
 *    comparado byte a byte e a trilha sem entrada nova);
 *  • `REABRIR` volta a PARCIAL e MANTÉM `publicadoEm` (reabrir não publica de novo);
 *  • id de submissão de OUTRA chamada é recusado e nada é gravado;
 *  • submissão com `deletedAt` não entra no seletor (nem na lista pública);
 *  • chamada de OUTRA instituição responde `NOT_FOUND` na leitura E na escrita;
 *  • sem a permissão da tela (`event:manage`), a action recusa e NADA muda — o
 *    caminho testado é a action de verdade, com o RBAC de verdade (`loadPrincipal`
 *    lê as concessões sob RLS); só a SESSÃO é substituída, porque não existe cookie
 *    fora de uma requisição do Next;
 *  • o texto longo é recusado pelo domínio com a mensagem dele (não com um "dados
 *    inválidos" do zod), e nada muda.
 *
 *  A ORDEM dos cenários é o teste: rascunho → parcial → final → recusas → reabrir.
 *  Ela depende do estado DURÁVEL no banco, e não de variável preenchida por outro
 *  teste.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import { applyCallResultAction, getCallResultPanel } from '../../src/lib/proposals/call-result-service';
import {
  CALL_RESULT_TEXT_MAX,
  readCallResult,
  type CallResult,
} from '../../src/domain/proposals/call-result-rules';
import type { SubmissionStatus } from '../../src/domain/review/submission-rules';

/**
 * A sessão é a ÚNICA coisa substituída (o cookie do Better Auth não existe fora de
 * uma requisição do Next). `vi.hoisted` porque o dublê é içado para antes das
 * declarações do arquivo.
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
  publishFinalCallResultAction,
  publishPartialCallResultAction,
  reopenCallResultAction,
  saveCallResultDraftAction,
} = await import('../../src/app/actions/call-actions');

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

const TEXTO = 'A lista dos trabalhos aprovados está abaixo.';
const TEXTO_PARCIAL = 'Resultado parcial: a lista ainda pode mudar até o fim do mês.';
const PROXIMOS_PASSOS = 'Envie a versão final até 10 de novembro.';

let tenantId: string;
let tenantSlug: string;
let otherTenantId: string;
let eventId: string;
let eventSlug: string;
let callId: string;
let callSlug: string;
let otherCallId: string;

let organizadora: string;
let participante: string;
let ana: string;

/** Protocolos que ordenam o seletor na ordem em que os testes o afirmam. */
let subAceita: string;
let subEmAvaliacao: string;
let subRejeitada: string;
let subExcluida: string;
let subOutraChamada: string;

async function criarPessoa(input: {
  nome: string;
  role?: 'ADMIN' | 'PARTICIPANT';
  oculta?: boolean;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.nome,
      email: `f73.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
      ...(input.oculta
        ? {
            publicProfileHiddenAt: new Date('2026-09-01T10:00:00.000Z'),
            publicProfileHiddenReason: 'Perfil ocultado pela moderação — teste da FASE 73.',
          }
        : {}),
    },
  });

  if (input.role) {
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
          role: input.role,
          scope: 'TENANT',
        },
      }),
    );
  }

  return id;
}

async function criarSubmissao(input: {
  callIdValue: string;
  protocolo: string;
  titulo: string;
  status: SubmissionStatus;
  submittedById: string;
  autores: readonly { userId?: string; guestName?: string }[];
  deletedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.submission.create({
      data: {
        id,
        tenantId,
        eventId,
        callId: input.callIdValue,
        protocol: input.protocolo,
        title: input.titulo,
        abstract:
          'Trabalho submetido à chamada do teste de integração da FASE 73. O texto existe para ' +
          'a submissão ser real e não um esqueleto.',
        status: input.status,
        submittedById: input.submittedById,
        submittedAt: new Date('2026-10-01T12:00:00.000Z'),
        deletedAt: input.deletedAt ?? null,
      },
    });

    for (const [index, autor] of input.autores.entries()) {
      await tx.submissionAuthor.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId: id,
          authorOrder: index + 1,
          isCorresponding: index === 0,
          userId: autor.userId ?? null,
          guestName: autor.guestName ?? null,
        },
      });
    }
  });

  return id;
}

/** O resultado CRU da coluna — para comparar o banco antes e depois de uma recusa. */
async function resultadoCru(): Promise<unknown> {
  const row = await withTenant(tenantId, (tx) =>
    tx.callForProposals.findUniqueOrThrow({ where: { id: callId }, select: { result: true } }),
  );

  return row.result;
}

async function resultadoGravado(): Promise<CallResult> {
  return readCallResult(await resultadoCru()).resultado;
}

interface TrilhaDoAto {
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Só as entradas do RESULTADO: a criação da chamada e a publicação dela também
 * escrevem trilha na mesma entidade, e elas não têm o campo `acao` do ato.
 */
async function trilhaDosAtos(): Promise<TrilhaDoAto[]> {
  const rows = await adminPrisma.auditLog.findMany({
    where: { tenantId, entityType: 'callForProposals', entityId: callId },
    orderBy: { createdAt: 'asc' },
    select: { action: true, changes: true },
  });

  return rows
    .map((row) => ({
      action: row.action,
      changes: row.changes as unknown as Record<string, { from: unknown; to: unknown }>,
    }))
    .filter((row) => typeof row.changes.acao?.to === 'string');
}

function formulario(input: {
  texto?: string;
  proximosPassos?: string;
  publicados?: readonly string[];
}): FormData {
  const data = new FormData();

  data.set('tenantSlug', tenantSlug);
  data.set('callId', callId);

  if (input.texto !== undefined) data.set('texto', input.texto);
  if (input.proximosPassos !== undefined) data.set('proximosPassos', input.proximosPassos);

  /**
   * CHECKBOX de mesmo nome — o padrão da casa para lista em formulário sem
   * JavaScript: uma caixa por submissão, lida com `formData.getAll`.
   */
  for (const id of input.publicados ?? []) data.append('publicados', id);

  return data;
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  eventSlug = `evento-f73-${RUN}`;
  tenantSlug = `f73-${RUN}`;

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: tenantSlug,
        name: `Instituição do Resultado ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f73-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  organizadora = await criarPessoa({ nome: 'Organizadora F73', role: 'ADMIN' });
  participante = await criarPessoa({ nome: 'Participante F73', role: 'PARTICIPANT' });
  /** A autora OCULTA: a lista de aprovados publica o nome completo dela (exceção declarada). */
  ana = await criarPessoa({ nome: 'Ana Souza', oculta: true });

  const now = new Date();
  const startsAt = new Date(now.getTime() + 30 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: 'Seminário do Resultado',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    }),
  );

  const chamada = await saveCall({
    tenantId,
    eventId,
    actorId: organizadora,
    kind: 'PAPER',
    slug: `artigos-f73-${RUN}`,
    title: 'Chamada de artigos do resultado',
    summary: 'Recebe os artigos cujo resultado será publicado.',
    opensAt: new Date(now.getTime() - 86_400_000),
    closesAt: new Date(now.getTime() + 30 * 86_400_000),
  });

  expect(chamada.ok, chamada.ok ? 'ok' : chamada.message).toBe(true);
  if (!chamada.ok) throw new Error('fixture: não foi possível criar a chamada');

  callId = chamada.callId;
  callSlug = `artigos-f73-${RUN}`;

  const outraChamada = await saveCall({
    tenantId,
    eventId,
    actorId: organizadora,
    kind: 'POSTER',
    slug: `posteres-f73-${RUN}`,
    title: 'Chamada de pôsteres do resultado',
  });

  expect(outraChamada.ok, outraChamada.ok ? 'ok' : outraChamada.message).toBe(true);
  if (!outraChamada.ok) throw new Error('fixture: não foi possível criar a outra chamada');

  otherCallId = outraChamada.callId;

  // Publicar a chamada é o ato normal; o resultado é que decide o que vai ao público.
  await setCallPublished({
    tenantId,
    eventId,
    callId,
    actorId: organizadora,
    isPublished: true,
  });

  subAceita = await criarSubmissao({
    callIdValue: callId,
    protocolo: `F73A${RUN}`,
    titulo: 'Saúde pública e território',
    status: 'ACCEPTED',
    submittedById: ana,
    autores: [{ userId: ana }, { guestName: 'Convidada Externa' }],
  });

  subEmAvaliacao = await criarSubmissao({
    callIdValue: callId,
    protocolo: `F73B${RUN}`,
    titulo: 'Educação e cidade',
    status: 'UNDER_REVIEW',
    submittedById: participante,
    autores: [{ userId: participante }],
  });

  subRejeitada = await criarSubmissao({
    callIdValue: callId,
    protocolo: `F73C${RUN}`,
    titulo: 'Território e memória',
    status: 'REJECTED',
    submittedById: participante,
    autores: [{ userId: participante }],
  });

  /** A EXCLUÍDA: existe no banco, mas não pode entrar no seletor nem na lista. */
  subExcluida = await criarSubmissao({
    callIdValue: callId,
    protocolo: `F73D${RUN}`,
    titulo: 'Trabalho retirado pelo autor',
    status: 'ACCEPTED',
    submittedById: ana,
    autores: [{ userId: ana }],
    deletedAt: new Date('2026-10-10T12:00:00.000Z'),
  });

  /** A de OUTRA chamada: existe, é do mesmo evento e do mesmo tenant — e não pode entrar. */
  subOutraChamada = await criarSubmissao({
    callIdValue: otherCallId,
    protocolo: `F73E${RUN}`,
    titulo: 'Pôster de outra chamada',
    status: 'ACCEPTED',
    submittedById: participante,
    autores: [{ userId: participante }],
  });

  sessao.userId = organizadora;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f73.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a leitura para a tela do organizador', () => {
  it('carrega a chamada com o tipo pelo DOMÍNIO e sem resultado publicado', async () => {
    const result = await getCallResultPanel({ tenantId, callId });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const painel = result.panel;

    expect(painel.callTitle).toBe('Chamada de artigos do resultado');
    expect(painel.callSlug).toBe(callSlug);
    expect(painel.kind).toBe('PAPER');
    /** O rótulo LONGO do domínio, e não o curto da etiqueta — a tela não traduz. */
    expect(painel.kindLabel).toBe('Trabalho científico (artigo)');
    expect(painel.eventId).toBe(eventId);
    expect(painel.eventSlug).toBe(eventSlug);
    expect(painel.eventTitle).toBe('Seminário do Resultado');
    expect(painel.source).toBe('DEFAULT');
    expect(painel.resultado.estado).toBe('SEM_RESULTADO');
    expect(painel.resultado.publicados).toEqual([]);
    expect(painel.resultado.atualizadoEm).toBeNull();
    expect(painel.publico).toBeNull();
    expect(painel.problems).toEqual([]);
    expect(painel.acoesDisponiveis).toEqual(['SALVAR_RASCUNHO', 'PUBLICAR_PARCIAL']);
  });

  it('o seletor tem TODAS as submissões vivas, com a decisão ao lado e as aceitas pré-marcadas', async () => {
    const result = await getCallResultPanel({ tenantId, callId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const painel = result.panel;

    expect(painel.seletor.map((opcao) => opcao.id)).toEqual([
      subAceita,
      subEmAvaliacao,
      subRejeitada,
    ]);
    expect(painel.seletor.map((opcao) => opcao.decisaoLabel)).toEqual([
      'Aceita',
      'Em avaliação',
      'Rejeitada',
    ]);
    expect(painel.seletor.map((opcao) => opcao.marcada)).toEqual([true, false, false]);
    expect(painel.seletor.map((opcao) => opcao.jaPublicada)).toEqual([false, false, false]);
  });

  it('submissão com deletedAt NÃO entra no seletor nem no material público', async () => {
    const result = await getCallResultPanel({ tenantId, callId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const painel = result.panel;

    expect(painel.seletor.some((opcao) => opcao.id === subExcluida)).toBe(false);
    expect(painel.submissoes.some((submissao) => submissao.id === subExcluida)).toBe(false);
    /** O título dela também não vaza por nenhum id de lista. */
    expect(JSON.stringify(painel.submissoes)).not.toContain('Trabalho retirado pelo autor');
  });

  it('a autoria chega com nome completo e com o SINAL da ocultação (que a página não lê)', async () => {
    const result = await getCallResultPanel({ tenantId, callId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const aceita = result.panel.submissoes.find((submissao) => submissao.id === subAceita);

    expect(aceita).toBeTruthy();
    /**
     * O sinal é EXIGIDO pelo domínio (o tipo da projeção tem `oculto`) e o serviço o
     * preenche de verdade — é o que torna a exceção declarada visível e testável.
     */
    expect(aceita?.autores).toEqual([
      { nome: 'Ana Souza', oculto: true },
      { nome: 'Convidada Externa', oculto: false },
    ]);
    expect(aceita?.protocol).toBe(`F73A${RUN}`);
    expect(aceita?.titulo).toBe('Saúde pública e território');
    expect(aceita?.tipo).toBe('Trabalho científico (artigo)');
  });

  it('chamada de OUTRA instituição responde NOT_FOUND, e não erro de infraestrutura', async () => {
    const result = await getCallResultPanel({ tenantId: otherTenantId, callId });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('Chamada não encontrada.');
  });

  it('JSON torto não derruba a leitura — cai no padrão, avisa na tela E no log', async () => {
    /** Uma linha gravada à mão (ou por uma versão anterior) não pode quebrar a página. */
    await withTenant(tenantId, (tx) =>
      tx.callForProposals.update({
        where: { id: callId },
        data: { result: { estado: 'PUBLICADO', texto: 42 } as unknown as object },
      }),
    );

    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const result = await getCallResultPanel({ tenantId, callId });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      /** Fail-closed: o estado que o domínio não conhece vira SEM_RESULTADO. */
      expect(result.panel.resultado.estado).toBe('SEM_RESULTADO');
      expect(result.panel.resultado.texto).toBe('');
      expect(result.panel.publico).toBeNull();
      expect(result.panel.problems.length).toBeGreaterThan(0);
      expect(result.panel.problems.join(' | ')).toContain('PUBLICADO');

      /**
       * O leitor tolerante NUNCA lança — mas tolerar não é ignorar: sem esta linha,
       * uma configuração torta viraria "a seção não aparece" sem ninguém saber por quê.
       */
      const chamadas = aviso.mock.calls.map((argumentos) => argumentos.join(' '));
      expect(chamadas.some((linha) => linha.includes('[proposals]') && linha.includes(callId))).toBe(true);
    } finally {
      aviso.mockRestore();

      /** Devolve o estado de fixture: os cenários seguintes gravam por cima dele. */
      await withTenant(tenantId, (tx) =>
        tx.callForProposals.update({ where: { id: callId }, data: { result: {} } }),
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('as quatro ações gravam o objeto, o estado e a trilha', () => {
  it('salvar rascunho: grava o objeto inteiro, sem data de publicação, com a trilha do ato', async () => {
    const result = await saveCallResultDraftAction(
      null,
      formulario({ texto: TEXTO, proximosPassos: PROXIMOS_PASSOS, publicados: [subAceita] }),
    );

    expect(result.ok, result.message).toBe(true);
    expect(result.message).toContain('Rascunho salvo');
    expect(result.data?.estado).toBe('RASCUNHO');

    const gravado = await resultadoGravado();

    expect(gravado.estado).toBe('RASCUNHO');
    expect(gravado.texto).toBe(TEXTO);
    expect(gravado.proximosPassos).toBe(PROXIMOS_PASSOS);
    expect(gravado.publicados).toEqual([subAceita]);
    expect(gravado.publicadoEm).toBeUndefined();
    expect(gravado.atualizadoEm).not.toBeNull();

    const atos = await trilhaDosAtos();
    expect(atos).toHaveLength(1);

    const [ato] = atos;
    expect(ato?.action).toBe('UPDATE');
    expect(ato?.changes.acao).toEqual({ from: null, to: 'SALVAR_RASCUNHO' });
    expect(ato?.changes.estado).toEqual({ from: 'SEM_RESULTADO', to: 'RASCUNHO' });
    expect(ato?.changes.publicados).toEqual({ from: 0, to: 1 });

    /** A trilha NÃO carrega o texto nem dado pessoal — só o ato e os números. */
    const trilha = JSON.stringify(ato);
    expect(trilha).not.toContain('lista dos trabalhos aprovados');
    expect(trilha).not.toContain('Ana');
    expect(trilha).not.toContain('Saúde pública');
  });

  it('o rascunho NÃO aparece no público (a seção não existe)', async () => {
    const result = await getCallResultPanel({ tenantId, callId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.panel.resultado.estado).toBe('RASCUNHO');
    expect(result.panel.publico).toBeNull();
    expect(result.panel.acoesDisponiveis).toEqual([
      'SALVAR_RASCUNHO',
      'PUBLICAR_PARCIAL',
      'PUBLICAR_FINAL',
    ]);
  });

  it('publicar parcial: grava o texto DESTE ato, carimba a publicação e a trilha diz de onde veio', async () => {
    const result = await publishPartialCallResultAction(
      null,
      formulario({ texto: TEXTO_PARCIAL, proximosPassos: PROXIMOS_PASSOS, publicados: [subAceita] }),
    );

    expect(result.ok, result.message).toBe(true);
    expect(result.data?.estado).toBe('PARCIAL');
    expect(typeof result.data?.publicadoEm).toBe('string');

    const gravado = await resultadoGravado();

    expect(gravado.estado).toBe('PARCIAL');
    /** O objeto é gravado POR INTEIRO — não só o estado: o texto deste ato substitui o anterior. */
    expect(gravado.texto).toBe(TEXTO_PARCIAL);
    expect(gravado.publicadoEm).toBe(result.data?.publicadoEm);
    expect(gravado.atualizadoEm).not.toBeNull();

    const atos = await trilhaDosAtos();
    expect(atos).toHaveLength(2);

    const ato = atos[1];
    expect(ato?.changes.acao).toEqual({ from: null, to: 'PUBLICAR_PARCIAL' });
    expect(ato?.changes.estado).toEqual({ from: 'RASCUNHO', to: 'PARCIAL' });
    expect(ato?.changes.publicados).toEqual({ from: 1, to: 1 });
  });

  it('publicar final: grava FINAL e a lista pública sai com os nomes COMPLETOS', async () => {
    const result = await publishFinalCallResultAction(
      null,
      formulario({ texto: TEXTO, proximosPassos: PROXIMOS_PASSOS, publicados: [subAceita] }),
    );

    expect(result.ok, result.message).toBe(true);
    expect(result.data?.estado).toBe('FINAL');

    const gravado = await resultadoGravado();
    expect(gravado.estado).toBe('FINAL');
    expect(gravado.publicadoEm).toBe(result.data?.publicadoEm);

    const atos = await trilhaDosAtos();
    expect(atos).toHaveLength(3);
    expect(atos[2]?.changes.acao).toEqual({ from: null, to: 'PUBLICAR_FINAL' });
    expect(atos[2]?.changes.estado).toEqual({ from: 'PARCIAL', to: 'FINAL' });

    const painel = await getCallResultPanel({ tenantId, callId });
    expect(painel.ok).toBe(true);
    if (!painel.ok) return;

    expect(painel.panel.publico).not.toBeNull();
    expect(painel.panel.publico?.estado).toBe('FINAL');
    expect(painel.panel.publico?.texto).toBe(TEXTO);
    expect(painel.panel.publico?.proximosPassos).toBe(PROXIMOS_PASSOS);
    expect(painel.panel.publico?.lista).toHaveLength(1);

    /** A EXCEÇÃO DECLARADA: Ana está oculta e o nome dela sai INTEIRO no documento. */
    expect(painel.panel.publico?.lista[0]?.autores).toEqual([
      'Ana Souza',
      'Convidada Externa',
    ]);
    expect(painel.panel.publico?.lista[0]?.tipo).toBe('Trabalho científico (artigo)');
    /**
     * E o SINAL não vai ao público: publicá-lo revelaria quem se ocultou, que é o
     * oposto do que a régua da E79 protege.
     */
    expect(JSON.stringify(painel.panel.publico)).not.toContain('oculto');
    expect(painel.panel.publico?.lista[0]).not.toHaveProperty('oculto');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o FINAL trava — e a recusa não toca no banco', () => {
  it('SALVAR_RASCUNHO, PUBLICAR_PARCIAL e PUBLICAR_FINAL a partir de FINAL são recusados com o motivo do domínio', async () => {
    const antes = JSON.stringify(await resultadoCru());
    const trilhaAntes = (await trilhaDosAtos()).length;

    const tentativas = [
      { acao: 'salvar rascunho', chamar: saveCallResultDraftAction },
      { acao: 'publicar parcial', chamar: publishPartialCallResultAction },
      { acao: 'publicar final', chamar: publishFinalCallResultAction },
    ] as const;

    for (const tentativa of tentativas) {
      const result = await tentativa.chamar(
        null,
        formulario({ texto: 'Texto novo', proximosPassos: '', publicados: [subEmAvaliacao] }),
      );

      expect(result.ok, tentativa.acao).toBe(false);
      expect(result.code).toBe('TRANSICAO_ILEGAL');
      /** A mensagem é a DO DOMÍNIO: diz por que e qual é o caminho (reabrir). */
      expect(result.message).toContain('travado');
      expect(result.message).toContain('Reabra');
      expect(result.details).toContain('FINAL');
    }

    /** O banco INTACTO: o JSON byte a byte e NENHUMA entrada nova na trilha. */
    expect(JSON.stringify(await resultadoCru())).toBe(antes);
    expect(await trilhaDosAtos()).toHaveLength(trilhaAntes);

    const gravado = await resultadoGravado();
    expect(gravado.estado).toBe('FINAL');
    expect(gravado.texto).toBe(TEXTO);
    expect(gravado.publicados).toEqual([subAceita]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('reabrir volta a parcial e mantém a data da publicação', () => {
  it('REABRIR grava PARCIAL, preserva publicadoEm e deixa a trilha do ato', async () => {
    const antes = await resultadoGravado();
    expect(antes.estado).toBe('FINAL');
    expect(antes.publicadoEm).toBeDefined();

    const result = await reopenCallResultAction(
      null,
      formulario({ texto: antes.texto, proximosPassos: antes.proximosPassos, publicados: [subAceita] }),
    );

    expect(result.ok, result.message).toBe(true);
    expect(result.data?.estado).toBe('PARCIAL');
    expect(result.data?.publicadoEm).toBe(antes.publicadoEm);
    expect(result.message).toContain('reaberto');

    const depois = await resultadoGravado();

    expect(depois.estado).toBe('PARCIAL');
    /** Reabrir NÃO publica de novo: a data vigente é a da publicação que está no ar. */
    expect(depois.publicadoEm).toBe(antes.publicadoEm);
    expect(depois.texto).toBe(antes.texto);

    const atos = await trilhaDosAtos();
    expect(atos).toHaveLength(4);

    const ato = atos[3];
    expect(ato?.changes.acao).toEqual({ from: null, to: 'REABRIR' });
    expect(ato?.changes.estado).toEqual({ from: 'FINAL', to: 'PARCIAL' });
    expect(ato?.changes.publicados).toEqual({ from: 1, to: 1 });
  });

  it('a trilha das QUATRO ações é exatamente a sequência dos estados percorridos', async () => {
    const atos = await trilhaDosAtos();

    expect(atos.map((ato) => ato.changes.acao?.to)).toEqual([
      'SALVAR_RASCUNHO',
      'PUBLICAR_PARCIAL',
      'PUBLICAR_FINAL',
      'REABRIR',
    ]);
    expect(atos.map((ato) => ato.changes.estado)).toEqual([
      { from: 'SEM_RESULTADO', to: 'RASCUNHO' },
      { from: 'RASCUNHO', to: 'PARCIAL' },
      { from: 'PARCIAL', to: 'FINAL' },
      { from: 'FINAL', to: 'PARCIAL' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o id de OUTRA chamada é recusado e nada é gravado', () => {
  it('publicar a submissão da outra chamada responde ID_FORA_DA_CHAMADA', async () => {
    const antes = JSON.stringify(await resultadoCru());
    const trilhaAntes = (await trilhaDosAtos()).length;

    const result = await publishPartialCallResultAction(
      null,
      formulario({ texto: TEXTO, proximosPassos: PROXIMOS_PASSOS, publicados: [subAceita, subOutraChamada] }),
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ID_FORA_DA_CHAMADA');
    expect(result.message).toContain('não é desta chamada');
    expect(result.details).toContain(subOutraChamada);

    expect(JSON.stringify(await resultadoCru())).toBe(antes);
    expect(await trilhaDosAtos()).toHaveLength(trilhaAntes);
  });

  it('o mesmo vale no RASCUNHO: a lista torta não é gravada nem escondida', async () => {
    const antes = JSON.stringify(await resultadoCru());

    const result = await saveCallResultDraftAction(
      null,
      formulario({ texto: TEXTO, proximosPassos: '', publicados: [subOutraChamada] }),
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ID_FORA_DA_CHAMADA');
    expect(JSON.stringify(await resultadoCru())).toBe(antes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o texto longo é recusado pelo DOMÍNIO', () => {
  it('acima do teto responde TEXTO_LONGO com o limite na mensagem, e nada muda', async () => {
    const antes = JSON.stringify(await resultadoCru());
    const trilhaAntes = (await trilhaDosAtos()).length;

    const result = await publishPartialCallResultAction(
      null,
      formulario({
        texto: 'x'.repeat(CALL_RESULT_TEXT_MAX + 1),
        proximosPassos: PROXIMOS_PASSOS,
        publicados: [subAceita],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('TEXTO_LONGO');
    /** A mensagem é a do domínio, com o número — não um "dados inválidos" genérico. */
    expect(result.message).toContain(String(CALL_RESULT_TEXT_MAX));
    expect(result.details).toContain(String(CALL_RESULT_TEXT_MAX + 1));

    expect(JSON.stringify(await resultadoCru())).toBe(antes);
    expect(await trilhaDosAtos()).toHaveLength(trilhaAntes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sem a permissão da tela de chamadas', () => {
  it('a action recusa com FORBIDDEN e NADA é gravado', async () => {
    const antes = JSON.stringify(await resultadoCru());
    const trilhaAntes = (await trilhaDosAtos()).length;

    sessao.userId = participante;

    try {
      const result = await publishPartialCallResultAction(
        null,
        formulario({ texto: 'Publicado por quem não pode', proximosPassos: '', publicados: [subAceita] }),
      );

      expect(result.ok).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
      expect(result.message).toContain('event:manage');

      /** A recusa que GRAVA é o defeito que este teste existe para prender. */
      expect(JSON.stringify(await resultadoCru())).toBe(antes);
      expect(await trilhaDosAtos()).toHaveLength(trilhaAntes);
    } finally {
      sessao.userId = organizadora;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o resultado de OUTRA instituição', () => {
  it('a escrita responde NOT_FOUND e não grava nada', async () => {
    const antes = JSON.stringify(await resultadoCru());

    const result = await applyCallResultAction({
      tenantId: otherTenantId,
      callId,
      acao: 'SALVAR_RASCUNHO',
      conteudo: { texto: 'Tentativa da instituição vizinha', proximosPassos: '', publicados: [] },
      actorId: participante,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_FOUND');
    expect(JSON.stringify(await resultadoCru())).toBe(antes);
  });
});
