/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — A PÁGINA PÚBLICA DO RESULTADO (FASE 73 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a leitura pública (`getPublicCallResult`) devolve o documento que o público vê
 *    quando o organizador publicou — estado, data, texto, próximos passos e a lista
 *    na ORDEM escolhida;
 *  • o rascunho devolve `null` (a seção não existe);
 *  • **o que NUNCA sai**: com uma submissão que TEM nota, parecer e revisor gravados
 *    no banco, a leitura não os traz — medido no OBJETO e no HTML que o componente
 *    compartilhado desenha;
 *  • id publicado que depois é EXCLUÍDO sai da lista, o motivo vai para o log e o
 *    resto da lista continua coerente (na ordem gravada);
 *  • chamada DESPUBLICADA não tem resultado público, e a resolução da página continua
 *    respondendo "não existe" (`CallState = DRAFT`, o ramo do 404 de hoje);
 *  • instituição VIZINHA recebe `null`, e não erro de infraestrutura;
 *  • JSON torto não derruba a página: vira SEM_RESULTADO, com o motivo no log.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PUBLICAÇÃO É PELO SERVIÇO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O resultado é gravado por `applyCallResultAction` — o mesmo caminho da tela do
 *  organizador (fatia 2), com a decisão do domínio e a trilha. Escrever o JSON de
 *  `result` à mão mediria uma configuração que o produto não produz.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveCall, setCallPublished, getCallBySlug } from '../../src/lib/proposals/call-service';
import { applyCallResultAction } from '../../src/lib/proposals/call-result-service';
import { getPublicCallResult } from '../../src/lib/proposals/call-result-public-service';
import { CallResultPublicView } from '../../src/components/proposals/call-result-public-view';
import type { PublicCallResultView } from '../../src/domain/proposals/call-result-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

const TEXTO = 'A lista dos trabalhos aprovados está abaixo.';
const PROXIMOS_PASSOS = 'Envie a versão final até 10 de novembro.';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  OS MARCADORES DO QUE NUNCA SAI
 * ─────────────────────────────────────────────────────────────────────────────
 *  Cada um é escrito no banco, em um campo que a leitura pública NÃO consulta. Se
 *  qualquer um aparecer no objeto ou no HTML, a superfície está vazando avaliação.
 */
const NOTA = 9.75;
const PARECER = `PARECER-INTERNO-${RUN} — texto que só o comitê lê.`;
const NOME_DA_REVISORA = `Revisora Secreta ${RUN}`;
const EMAIL_DA_REVISORA = `revisora.${RUN}@exemplo.test`;
const RESUMO_DO_AUTOR = `RESUMO-DO-AUTOR-${RUN} — o resultado publica título e autoria, não o texto.`;
const OBSERVACAO_DA_DECISAO = `OBSERVACAO-INTERNA-${RUN} — anotação da decisão do comitê.`;

const MARCADORES_PROIBIDOS = [
  PARECER,
  NOME_DA_REVISORA,
  EMAIL_DA_REVISORA,
  RESUMO_DO_AUTOR,
  OBSERVACAO_DA_DECISAO,
  String(NOTA),
];

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let callId: string;
let callSlug: string;

let organizadora: string;
let ana: string;
let bruno: string;
let revisora: string;

let subAceita: string;
let subOutra: string;

async function criarPessoa(input: {
  nome: string;
  emailPrefixo: string;
  oculta?: boolean;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.nome,
      email: `${input.emailPrefixo}.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
      ...(input.oculta
        ? {
            publicProfileHiddenAt: new Date('2026-09-01T10:00:00.000Z'),
            publicProfileHiddenReason: 'Perfil ocultado pela moderação — teste da FASE 73.',
          }
        : {}),
    },
  });

  return id;
}

async function criarSubmissao(input: {
  protocolo: string;
  titulo: string;
  status: 'ACCEPTED' | 'UNDER_REVIEW';
  submittedById: string;
  autores: readonly { userId?: string; guestName?: string }[];
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.submission.create({
      data: {
        id,
        tenantId,
        eventId,
        callId,
        protocol: input.protocolo,
        title: input.titulo,
        abstract: RESUMO_DO_AUTOR,
        keywords: ['resultado', 'chamada'],
        status: input.status,
        submittedById: input.submittedById,
        submittedAt: new Date('2026-10-01T12:00:00.000Z'),
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

/**
 * Grava a avaliação INTEIRA na submissão: nota final, anotação da decisão, parecer e
 * revisor. É a fixture que prova o "nunca sai" — cada campo com o seu marcador.
 */
async function gravarAvaliacao(submissionId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        finalScore: NOTA,
        decisionNotes: OBSERVACAO_DA_DECISAO,
        decisionById: revisora,
        decisionAt: new Date('2026-10-15T12:00:00.000Z'),
      },
    });

    await tx.review.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId,
        reviewerId: revisora,
        status: 'SUBMITTED',
        weightedScore: NOTA,
        confidentialComments: PARECER,
        feedbackToAuthor: PARECER,
        submittedAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    });
  });
}

function publicar(acao: 'PUBLICAR_PARCIAL' | 'PUBLICAR_FINAL') {
  return applyCallResultAction({
    tenantId,
    callId,
    acao,
    conteudo: {
      texto: TEXTO,
      proximosPassos: PROXIMOS_PASSOS,
      publicados: [subAceita, subOutra],
    },
    actorId: organizadora,
  });
}

/** O HTML do componente COMPARTILHADO — o mesmo que a página e a prévia desenham. */
function desenhar(view: PublicCallResultView): string {
  return renderToStaticMarkup(
    createElement(CallResultPublicView, { view, publicadoEmLabel: '20/10/2026 09:00' }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f73-publico-${RUN}`,
        name: `Instituição do Resultado Público ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f73-publico-vizinha-${RUN}`,
        name: `Instituição Vizinha do Resultado ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  organizadora = await criarPessoa({
    nome: 'Organizadora do Resultado',
    emailPrefixo: 'f73publico.organizadora',
  });
  ana = await criarPessoa({ nome: 'Ana Souza', emailPrefixo: 'f73publico.ana', oculta: true });
  bruno = await criarPessoa({ nome: 'Bruno Lima', emailPrefixo: 'f73publico.bruno' });
  revisora = await criarPessoa({ nome: NOME_DA_REVISORA, emailPrefixo: EMAIL_DA_REVISORA });

  const now = new Date();

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f73-publico-${RUN}`,
        title: 'Seminário do Resultado Público',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: new Date(now.getTime() + 30 * 86_400_000),
        endsAt: new Date(now.getTime() + 33 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
        usesCall: true,
      },
    }),
  );

  callSlug = `artigos-f73-publico-${RUN}`;

  const chamada = await saveCall({
    tenantId,
    eventId,
    actorId: organizadora,
    kind: 'PAPER',
    slug: callSlug,
    title: 'Chamada de artigos do resultado público',
    summary: 'Recebe os artigos cujo resultado será publicado.',
    opensAt: new Date(now.getTime() - 86_400_000),
    closesAt: new Date(now.getTime() + 30 * 86_400_000),
  });

  expect(chamada.ok, chamada.ok ? 'ok' : chamada.message).toBe(true);
  if (!chamada.ok) throw new Error('fixture: não foi possível criar a chamada');

  callId = chamada.callId;

  const publicada = await setCallPublished({
    tenantId,
    eventId,
    callId,
    actorId: organizadora,
    isPublished: true,
  });

  expect(publicada.ok, publicada.ok ? 'ok' : publicada.message).toBe(true);

  subAceita = await criarSubmissao({
    protocolo: `F73PA${RUN}`,
    titulo: 'Saúde pública e território',
    status: 'ACCEPTED',
    submittedById: ana,
    autores: [{ userId: ana }, { guestName: 'Convidada Externa' }],
  });

  subOutra = await criarSubmissao({
    protocolo: `F73PB${RUN}`,
    titulo: 'Educação e cidade',
    status: 'UNDER_REVIEW',
    submittedById: bruno,
    autores: [{ userId: bruno }],
  });

  /** A avaliação existe NO BANCO para as duas: o público não pode receber nenhuma. */
  await gravarAvaliacao(subAceita);
  await gravarAvaliacao(subOutra);

  const parcial = await publicar('PUBLICAR_PARCIAL');
  expect(parcial.ok, parcial.ok ? 'ok' : parcial.message).toBe(true);
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `.${RUN}.` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o resultado publicado na leitura pública', () => {
  it('devolve o documento que o público vê, na ordem escolhida', async () => {
    const view = await getPublicCallResult({ tenantId, callId });

    expect(view).not.toBeNull();
    if (view === null) return;

    expect(view.estado).toBe('PARCIAL');
    expect(view.publicadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(view.texto).toBe(TEXTO);
    expect(view.proximosPassos).toBe(PROXIMOS_PASSOS);

    /** A ordem é a de `publicados` — a escolha do organizador, não a do banco. */
    expect(view.lista.map((item) => item.titulo)).toEqual([
      'Saúde pública e território',
      'Educação e cidade',
    ]);
    expect(view.lista.map((item) => item.protocoloOuIdEstavel)).toEqual([
      `F73PA${RUN}`,
      `F73PB${RUN}`,
    ]);

    /** O item tem EXATAMENTE as quatro chaves da projeção — nem uma a mais. */
    expect(Object.keys(view.lista[0] ?? {})).toEqual([
      'protocoloOuIdEstavel',
      'titulo',
      'tipo',
      'autores',
    ]);
    expect(view.lista[0]?.tipo).toBe('Trabalho científico (artigo)');

    /**
     * A EXCEÇÃO DECLARADA (decisão 2 do humano): a lista publica o nome COMPLETO,
     * inclusive de quem se oculta no perfil público.
     */
    expect(view.lista[0]?.autores).toEqual(['Ana Souza', 'Convidada Externa']);
    expect(view.lista[1]?.autores).toEqual(['Bruno Lima']);
  });

  it('só as submissões PUBLICADAS entram: o resto da chamada não é consultado', async () => {
    const view = await getPublicCallResult({ tenantId, callId });
    expect(view).not.toBeNull();
    if (view === null) return;

    /** Duas publicadas de duas existentes — a lista tem o tamanho da ESCOLHA. */
    expect(view.lista).toHaveLength(2);

    /**
     * E a leitura não devolve nada de fora de `publicados`: o título de uma terceira
     * submissão (viva, da mesma chamada, não publicada) não aparece.
     */
    const naoPublicada = await criarSubmissao({
      protocolo: `F73PC${RUN}`,
      titulo: 'Trabalho que ninguém publicou',
      status: 'UNDER_REVIEW',
      submittedById: bruno,
      autores: [{ userId: bruno }],
    });

    try {
      const depois = await getPublicCallResult({ tenantId, callId });
      expect(JSON.stringify(depois)).not.toContain('Trabalho que ninguém publicou');
      expect(JSON.stringify(depois)).not.toContain(naoPublicada);
    } finally {
      await withTenant(tenantId, (tx) =>
        tx.submission.update({
          where: { id: naoPublicada },
          data: { deletedAt: new Date() },
        }),
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o que NUNCA sai', () => {
  it('o OBJETO não carrega nota, parecer, revisor, e-mail, resumo nem situação interna', async () => {
    const view = await getPublicCallResult({ tenantId, callId });
    expect(view).not.toBeNull();

    const serializado = JSON.stringify(view);

    for (const marcador of MARCADORES_PROIBIDOS) {
      expect(serializado, `o marcador "${marcador}" vazou`).not.toContain(marcador);
    }

    /**
     * Os NOMES dos campos também não existem: um objeto sem valor, mas com a chave
     * `finalScore`, mostraria ao cliente que a avaliação está a um passo de vazar.
     */
    for (const campo of [
      'nota',
      'parecer',
      'revisor',
      'reviewer',
      'finalScore',
      'weightedScore',
      'decisionNotes',
      'proposalData',
      'abstract',
      'status',
      'email',
    ]) {
      expect(view?.lista[0], campo).not.toHaveProperty(campo);
      expect(serializado, campo).not.toContain(campo);
    }

    /** E o SINAL da ocultação não vai ao público (revelaria quem se ocultou). */
    expect(serializado).not.toContain('oculto');
    expect(serializado).not.toContain('publicProfileHiddenAt');
  });

  it('o HTML desenhado pelo componente compartilhado também não os carrega', async () => {
    const view = await getPublicCallResult({ tenantId, callId });
    expect(view).not.toBeNull();
    if (view === null) return;

    const html = desenhar(view);

    for (const marcador of MARCADORES_PROIBIDOS) {
      expect(html, `o marcador "${marcador}" vazou no HTML`).not.toContain(marcador);
    }

    /** O que o público DEVE ver está lá — o teste não está medindo uma página vazia. */
    expect(html).toContain(TEXTO);
    expect(html).toContain(PROXIMOS_PASSOS);
    expect(html).toContain('Saúde pública e território');
    expect(html).toContain('Ana Souza');
    expect(html).toContain('Lista publicada (2)');
    expect(html).toContain('Publicado em 20/10/2026 09:00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o rascunho não vaza', () => {
  it('salvar rascunho despublica: a leitura pública devolve null', async () => {
    const rascunho = await applyCallResultAction({
      tenantId,
      callId,
      acao: 'SALVAR_RASCUNHO',
      conteudo: {
        texto: 'Rascunho em preparação — não pode aparecer no público.',
        proximosPassos: '',
        publicados: [subAceita],
      },
      actorId: organizadora,
    });

    expect(rascunho.ok, rascunho.ok ? 'ok' : rascunho.message).toBe(true);

    expect(await getPublicCallResult({ tenantId, callId })).toBeNull();
  });

  it('a mesma leitura volta a devolver o documento quando o parcial é republicado', async () => {
    const parcial = await publicar('PUBLICAR_PARCIAL');
    expect(parcial.ok, parcial.ok ? 'ok' : parcial.message).toBe(true);

    const view = await getPublicCallResult({ tenantId, callId });
    expect(view?.estado).toBe('PARCIAL');
    expect(view?.texto).toBe(TEXTO);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o id publicado que é excluído depois', () => {
  it('sai da lista, o motivo vai para o log e o resto continua coerente', async () => {
    await withTenant(tenantId, (tx) =>
      tx.submission.update({
        where: { id: subOutra },
        data: { deletedAt: new Date('2026-10-18T12:00:00.000Z') },
      }),
    );

    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const view = await getPublicCallResult({ tenantId, callId });

      expect(view).not.toBeNull();
      if (view === null) return;

      /** O item excluído NÃO vira item vazio nem é substituído: ele sai. */
      expect(view.lista).toHaveLength(1);
      expect(view.lista[0]?.titulo).toBe('Saúde pública e território');
      expect(JSON.stringify(view)).not.toContain('Educação e cidade');
      expect(JSON.stringify(view)).not.toContain(subOutra);

      /** E o motivo é reportado: tolerar não é ignorar. */
      const linhas = aviso.mock.calls.map((argumentos) => argumentos.join(' '));
      expect(
        linhas.some((linha) => linha.includes('[proposals]') && linha.includes(subOutra)),
      ).toBe(true);
    } finally {
      aviso.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o resultado de OUTRA instituição', () => {
  it('é null — a chamada não existe para quem não é dono dela', async () => {
    expect(await getPublicCallResult({ tenantId: otherTenantId, callId })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o JSON torto não derruba a página', () => {
  it('vira SEM_RESULTADO (null), com o motivo no log', async () => {
    const antes = await withTenant(tenantId, (tx) =>
      tx.callForProposals.findUniqueOrThrow({ where: { id: callId }, select: { result: true } }),
    );

    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await withTenant(tenantId, (tx) =>
        tx.callForProposals.update({
          where: { id: callId },
          data: { result: { estado: 'PUBLICADO', texto: 42 } as unknown as object },
        }),
      );

      expect(await getPublicCallResult({ tenantId, callId })).toBeNull();

      const linhas = aviso.mock.calls.map((argumentos) => argumentos.join(' '));
      expect(
        linhas.some((linha) => linha.includes('[proposals]') && linha.includes(callId)),
      ).toBe(true);
    } finally {
      aviso.mockRestore();

      await withTenant(tenantId, (tx) =>
        tx.callForProposals.update({ where: { id: callId }, data: { result: antes.result } }),
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a chamada despublicada', () => {
  it('não tem resultado público, e a resolução da página responde "não existe"', async () => {
    const despublicada = await setCallPublished({
      tenantId,
      eventId,
      callId,
      actorId: organizadora,
      isPublished: false,
    });

    expect(despublicada.ok, despublicada.ok ? 'ok' : despublicada.message).toBe(true);

    /** Nada de resultado — nem o de antes da despublicação. */
    expect(await getPublicCallResult({ tenantId, callId })).toBeNull();

    /**
     * E o caminho da PÁGINA continua respondendo "não existe": `getCallBySlug` devolve
     * `CallState = DRAFT`, que é o ramo do `notFound()` de hoje. Não inventamos um
     * segundo 404 — a página já tinha esse, e ele continua valendo.
     */
    const resolvida = await getCallBySlug({
      tenantId,
      eventId,
      slug: callSlug,
      now: new Date(),
    });

    expect(resolvida.ok).toBe(true);
    if (!resolvida.ok) return;

    expect(resolvida.call.state).toBe('DRAFT');
    expect(resolvida.call.isPublished).toBe(false);
  });
});
