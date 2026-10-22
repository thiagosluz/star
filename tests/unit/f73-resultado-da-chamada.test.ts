/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O RESULTADO DA CHAMADA (FASE 73 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (sem banco: é domínio puro)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a tabela legal × ILEGAL da matriz de transições, com o MOTIVO de cada recusa;
 *  • o que o público vê em cada estado — e que o RASCUNHO não aparece;
 *  • a lista com nomes COMPLETOS, inclusive de quem se oculta (a exceção declarada),
 *    e a MESMA pessoa continuando mascarada na régua geral da casa;
 *  • a lista fechada: `assertResultadoSemCampoProibido` reprova com nota, parecer,
 *    e-mail, e repetiria em campo aninhado;
 *  • o leitor tolerante com JSON torto, sempre fail-closed (nada vaza por JSON);
 *  • id de outra chamada e id repetido recusados;
 *  • o seletor com as aceitas pré-marcadas, e a escolha do organizador valendo
 *    depois do primeiro ato;
 *  • a catraca de PUREZA: o módulo não importa ORM/Next, não lê relógio e não usa a
 *    régua da E79 (a exceção é local, e o teste de fonte impede que ela se espalhe
 *    por copy-paste).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CALL_RESULT_ACTIONS,
  CALL_RESULT_ACTION_LABELS,
  CALL_RESULT_NEXT_STEPS_MAX,
  CALL_RESULT_PUBLISHED_MAX,
  CALL_RESULT_STATES,
  CALL_RESULT_STATE_LABELS,
  CALL_RESULT_TEXT_MAX,
  PUBLIC_CALL_RESULT_FIELD_ORDER,
  PUBLIC_CALL_RESULT_ITEM_FIELD_ORDER,
  PUBLIC_CALL_RESULT_STATES,
  RESULT_FORBIDDEN_FIELDS,
  ResultadoCampoProibidoError,
  SUBMISSION_STATUS_LABELS,
  assertResultadoSemCampoProibido,
  availableCallResultActions,
  buildCallResultSelector,
  decideCallResultTransition,
  emptyCallResult,
  findForbiddenResultField,
  isAcceptedSubmission,
  isCallResultState,
  isForbiddenResultField,
  isLegalResultTransition,
  isPublicCallResultState,
  legalResultStatesFor,
  projectPublicCallResult,
  readCallResult,
  resultStateAfter,
  stableSubmissionIdentifier,
  type CallResult,
  type CallResultAction,
  type CallResultAuthorSource,
  type CallResultContent,
  type CallResultState,
  type CallResultSubmissionSource,
  type CallResultTransition,
} from '../../src/domain/proposals/call-result-rules';
import {
  isPersonPubliclyVisible,
  maskPersonName,
} from '../../src/domain/profile/public-profile-rules';

const AGORA = new Date('2026-10-22T12:00:00.000Z');
const DEPOIS = new Date('2026-10-25T09:30:00.000Z');

const ANA = 'Ana Souza';
const BRUNO = 'Bruno Carvalho Lima';

/** O conteúdo de uma publicação completa, usado pela maioria dos casos. */
function conteudo(over: Partial<CallResultContent> = {}): CallResultContent {
  return {
    texto: 'A lista dos trabalhos aprovados está abaixo.',
    proximosPassos: 'Envie a versão final até 10 de novembro.',
    publicados: ['sub-1'],
    ...over,
  };
}

function resultado(over: Partial<CallResult> = {}): CallResult {
  return {
    estado: 'RASCUNHO',
    texto: 'A lista dos trabalhos aprovados está abaixo.',
    proximosPassos: 'Envie a versão final até 10 de novembro.',
    publicados: ['sub-1'],
    atualizadoEm: DEPOIS.toISOString(),
    ...over,
  };
}

function autor(nome: string, oculto = false): CallResultAuthorSource {
  return { nome, oculto };
}

function submissao(over: Partial<CallResultSubmissionSource> = {}): CallResultSubmissionSource {
  return {
    id: 'sub-1',
    protocol: 'ABC123',
    titulo: 'Saúde pública e território',
    tipo: 'Artigo',
    autores: [autor(ANA), autor(BRUNO)],
    ...over,
  };
}

function decidir(input: {
  atual?: CallResult;
  acao: CallResultAction;
  conteudo?: CallResultContent;
  submissoesDaChamada?: readonly string[];
  agora?: Date;
}): CallResultTransition {
  return decideCallResultTransition({
    atual: input.atual ?? resultado(),
    acao: input.acao,
    conteudo: input.conteudo ?? conteudo(),
    submissoesDaChamada: input.submissoesDaChamada ?? ['sub-1', 'sub-2', 'sub-3'],
    agora: input.agora ?? AGORA,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Os estados
// ───────────────────────────────────────────────────────────────────────────────
describe('os quatro estados do resultado', () => {
  it('são exatamente quatro, nesta ordem, e todos têm rótulo', () => {
    expect([...CALL_RESULT_STATES]).toEqual(['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL', 'FINAL']);

    for (const estado of CALL_RESULT_STATES) {
      expect(CALL_RESULT_STATE_LABELS[estado].length, estado).toBeGreaterThan(0);
    }
  });

  it('só PARCIAL e FINAL são públicos — é a régua do que a seção mostra', () => {
    expect([...PUBLIC_CALL_RESULT_STATES]).toEqual(['PARCIAL', 'FINAL']);

    expect(isPublicCallResultState('SEM_RESULTADO')).toBe(false);
    expect(isPublicCallResultState('RASCUNHO')).toBe(false);
    expect(isPublicCallResultState('PARCIAL')).toBe(true);
    expect(isPublicCallResultState('FINAL')).toBe(true);
  });

  it('estado que não existe não é estado (o leitor tolerante depende disto)', () => {
    expect(isCallResultState('PUBLICADO')).toBe(false);
    expect(isCallResultState('')).toBe(false);
    expect(isCallResultState(null)).toBe(false);
    expect(isCallResultState(7)).toBe(false);
    expect(isCallResultState('FINAL')).toBe(true);
  });

  it('o resultado vazio é SEM_RESULTADO, sem lista e sem data inventada', () => {
    const vazio = emptyCallResult();

    expect(vazio).toEqual({
      estado: 'SEM_RESULTADO',
      texto: '',
      proximosPassos: '',
      publicados: [],
      atualizadoEm: null,
    });

    /** Objeto NOVO a cada chamada: a tela não pode mutar o "vazio" compartilhado. */
    expect(emptyCallResult()).not.toBe(vazio);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A tabela legal × ilegal — os DOIS lados de cada regra
// ───────────────────────────────────────────────────────────────────────────────
const MATRIZ: readonly {
  acao: CallResultAction;
  de: readonly CallResultState[];
  para: CallResultState;
}[] = [
  { acao: 'SALVAR_RASCUNHO', de: ['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL'], para: 'RASCUNHO' },
  { acao: 'PUBLICAR_PARCIAL', de: ['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL'], para: 'PARCIAL' },
  { acao: 'PUBLICAR_FINAL', de: ['RASCUNHO', 'PARCIAL'], para: 'FINAL' },
  { acao: 'REABRIR', de: ['FINAL'], para: 'PARCIAL' },
];

describe('as transições legais', () => {
  for (const regra of MATRIZ) {
    for (const estado of CALL_RESULT_STATES) {
      const legal = regra.de.includes(estado);

      if (legal) {
        it(`${regra.acao}: de ${estado} para ${regra.para} é legal`, () => {
          expect(isLegalResultTransition(regra.acao, estado)).toBe(true);
          expect(resultStateAfter(regra.acao)).toBe(regra.para);

          const decisao = decidir({ atual: resultado({ estado }), acao: regra.acao });

          expect(decisao.ok).toBe(true);
          if (!decisao.ok) return;

          expect(decisao.resultado.estado).toBe(regra.para);
          expect(decisao.resultado.atualizadoEm).toBe(AGORA.toISOString());
        });
      } else {
        it(`${regra.acao}: de ${estado} NÃO é legal, e diz o motivo`, () => {
          expect(isLegalResultTransition(regra.acao, estado)).toBe(false);

          const decisao = decidir({ atual: resultado({ estado }), acao: regra.acao });

          expect(decisao.ok).toBe(false);
          if (decisao.ok) return;

          expect(decisao.code).toBe('TRANSICAO_ILEGAL');
          expect(decisao.message.length).toBeGreaterThan(20);
          expect(decisao.details).toEqual({ acao: regra.acao, estado });
        });
      }
    }
  }

  it('de FINAL só se sai por REABRIR — o final não muda em silêncio', () => {
    for (const acao of CALL_RESULT_ACTIONS) {
      if (acao === 'REABRIR') continue;

      const decisao = decidir({ atual: resultado({ estado: 'FINAL' }), acao });

      expect(decisao.ok, acao).toBe(false);
      if (decisao.ok) return;

      expect(decisao.code).toBe('TRANSICAO_ILEGAL');
      /** O motivo tem de MANDAR o organizador para o caminho certo, não só negar. */
      expect(decisao.message).toContain('Reabra');
      expect(decisao.message).toContain('travado');
    }
  });

  it('reabrir de quem não é final é recusado, dizendo em que estado está', () => {
    for (const estado of ['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL'] as const) {
      const decisao = decidir({ atual: resultado({ estado }), acao: 'REABRIR' });

      expect(decisao.ok).toBe(false);
      if (decisao.ok) return;

      expect(decisao.code).toBe('TRANSICAO_ILEGAL');
      expect(decisao.message).toContain(CALL_RESULT_STATE_LABELS[estado]);
    }
  });

  it('publicar final de SEM_RESULTADO é recusado — o final vem depois do resultado existir', () => {
    const decisao = decidir({
      atual: emptyCallResult(),
      acao: 'PUBLICAR_FINAL',
      /** Nem com conteúdo: o estado é que não permite. */
      conteudo: conteudo(),
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('TRANSICAO_ILEGAL');
    expect(decisao.message).toContain('rascunho');
    expect(decisao.message).toContain('parcial');
  });

  it('publicar parcial direto de SEM_RESULTADO é legal (primeira publicação em um ato)', () => {
    const decisao = decidir({ atual: emptyCallResult(), acao: 'PUBLICAR_PARCIAL' });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.resultado.estado).toBe('PARCIAL');
    expect(decisao.resultado.publicadoEm).toBe(AGORA.toISOString());
  });

  it('a lista de ações disponíveis é derivada da tabela (a tela não decide sozinha)', () => {
    expect(availableCallResultActions('SEM_RESULTADO')).toEqual(['SALVAR_RASCUNHO', 'PUBLICAR_PARCIAL']);
    expect(availableCallResultActions('RASCUNHO')).toEqual([
      'SALVAR_RASCUNHO',
      'PUBLICAR_PARCIAL',
      'PUBLICAR_FINAL',
    ]);
    expect(availableCallResultActions('PARCIAL')).toEqual([
      'SALVAR_RASCUNHO',
      'PUBLICAR_PARCIAL',
      'PUBLICAR_FINAL',
    ]);
    expect(availableCallResultActions('FINAL')).toEqual(['REABRIR']);

    for (const acao of CALL_RESULT_ACTIONS) {
      expect(legalResultStatesFor(acao).length, acao).toBeGreaterThan(0);
      expect(CALL_RESULT_ACTION_LABELS[acao].length, acao).toBeGreaterThan(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Conteúdo: limites, apara e publicação vazia
// ───────────────────────────────────────────────────────────────────────────────
describe('o conteúdo do ato', () => {
  it('texto acima do teto é RECUSADO (não truncado em silêncio)', () => {
    const decisao = decidir({
      acao: 'SALVAR_RASCUNHO',
      conteudo: conteudo({ texto: 'x'.repeat(CALL_RESULT_TEXT_MAX + 1) }),
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('TEXTO_LONGO');
    expect(decisao.details).toEqual({
      limite: String(CALL_RESULT_TEXT_MAX),
      medido: String(CALL_RESULT_TEXT_MAX + 1),
    });
  });

  it('próximos passos acima do teto é RECUSADO', () => {
    const decisao = decidir({
      acao: 'SALVAR_RASCUNHO',
      conteudo: conteudo({ proximosPassos: 'y'.repeat(CALL_RESULT_NEXT_STEPS_MAX + 1) }),
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('PROXIMOS_PASSOS_LONGO');
  });

  it('o texto é APARADO antes de medir e de gravar', () => {
    const decisao = decidir({
      acao: 'SALVAR_RASCUNHO',
      conteudo: conteudo({ texto: '   Um recado.   ', proximosPassos: '  ' }),
    });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.resultado.texto).toBe('Um recado.');
    expect(decisao.resultado.proximosPassos).toBe('');
  });

  it('exatamente no teto passa (o limite É aceito)', () => {
    const decisao = decidir({
      acao: 'SALVAR_RASCUNHO',
      conteudo: conteudo({ texto: 'x'.repeat(CALL_RESULT_TEXT_MAX) }),
    });

    expect(decisao.ok).toBe(true);
  });

  it('rascunho vazio é legítimo — é quem começou a escrever', () => {
    const decisao = decidir({
      atual: emptyCallResult(),
      acao: 'SALVAR_RASCUNHO',
      conteudo: { texto: '', proximosPassos: '', publicados: [] },
    });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.resultado.estado).toBe('RASCUNHO');
    expect(decisao.resultado.publicadoEm).toBeUndefined();
  });

  it('publicação VAZIA é recusada — a seção vazia pareceria defeito', () => {
    for (const acao of ['PUBLICAR_PARCIAL', 'PUBLICAR_FINAL'] as const) {
      const decisao = decidir({
        acao,
        conteudo: { texto: '', proximosPassos: '', publicados: [] },
      });

      expect(decisao.ok, acao).toBe(false);
      if (decisao.ok) return;

      expect(decisao.code).toBe('PUBLICACAO_VAZIA');
    }
  });

  it('só os próximos passos já bastam para publicar (é informação, não enfeite)', () => {
    const decisao = decidir({
      acao: 'PUBLICAR_PARCIAL',
      conteudo: { texto: '', proximosPassos: 'Resultado sai em novembro.', publicados: [] },
    });

    expect(decisao.ok).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  As datas de cada ato
// ───────────────────────────────────────────────────────────────────────────────
describe('as datas do resultado', () => {
  it('publicar carimba a data da publicação vigente', () => {
    for (const acao of ['PUBLICAR_PARCIAL', 'PUBLICAR_FINAL'] as const) {
      const decisao = decidir({ acao, agora: AGORA });

      expect(decisao.ok, acao).toBe(true);
      if (!decisao.ok) return;

      expect(decisao.resultado.publicadoEm).toBe(AGORA.toISOString());
      expect(decisao.resultado.atualizadoEm).toBe(AGORA.toISOString());
    }
  });

  it('salvar rascunho a partir do parcial TIRA a data: o rascunho não está no ar', () => {
    const decisao = decidir({
      atual: resultado({ estado: 'PARCIAL', publicadoEm: DEPOIS.toISOString() }),
      acao: 'SALVAR_RASCUNHO',
    });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.resultado.estado).toBe('RASCUNHO');
    expect(decisao.resultado.publicadoEm).toBeUndefined();
  });

  it('reabrir NÃO despublica: mantém a data da publicação vigente', () => {
    const decisao = decidir({
      atual: resultado({ estado: 'FINAL', publicadoEm: DEPOIS.toISOString() }),
      acao: 'REABRIR',
      agora: AGORA,
    });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.resultado.estado).toBe('PARCIAL');
    expect(decisao.resultado.publicadoEm).toBe(DEPOIS.toISOString());
    /** O ato de reabrir é uma atualização, mas não é uma publicação. */
    expect(decisao.resultado.atualizadoEm).toBe(AGORA.toISOString());
  });

  it('a transição não muta o resultado recebido nem o conteúdo', () => {
    const atual = resultado({ estado: 'PARCIAL', publicadoEm: DEPOIS.toISOString() });
    const entrada = conteudo({ publicados: ['sub-2', 'sub-1'] });
    const antesDoAtual = JSON.stringify(atual);
    const antesDoConteudo = JSON.stringify(entrada);

    const decisao = decidir({ atual, acao: 'PUBLICAR_FINAL', conteudo: entrada });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect(JSON.stringify(atual)).toBe(antesDoAtual);
    expect(JSON.stringify(entrada)).toBe(antesDoConteudo);
    expect(decisao.resultado).not.toBe(atual);
    expect(decisao.resultado.publicados).not.toBe(entrada.publicados);
    expect([...decisao.resultado.publicados]).toEqual(['sub-2', 'sub-1']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A lista: da chamada, sem repetição, na ordem escolhida
// ───────────────────────────────────────────────────────────────────────────────
describe('a validação da lista publicada', () => {
  it('id de OUTRA chamada é recusado com o id no motivo', () => {
    const decisao = decidir({
      acao: 'PUBLICAR_PARCIAL',
      conteudo: conteudo({ publicados: ['sub-1', 'sub-de-outra-chamada'] }),
      submissoesDaChamada: ['sub-1', 'sub-2'],
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('ID_FORA_DA_CHAMADA');
    expect(decisao.details).toEqual({ submissionId: 'sub-de-outra-chamada' });
    expect(decisao.message).toContain('não é desta chamada');
  });

  it('o mesmo vale para o RASCUNHO: a lista torta não é gravada nem escondida', () => {
    const decisao = decidir({
      acao: 'SALVAR_RASCUNHO',
      conteudo: conteudo({ publicados: ['sub-estranho'] }),
      submissoesDaChamada: ['sub-1'],
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('ID_FORA_DA_CHAMADA');
  });

  it('id repetido é recusado (não deduplicado em silêncio)', () => {
    const decisao = decidir({
      acao: 'PUBLICAR_PARCIAL',
      conteudo: conteudo({ publicados: ['sub-1', 'sub-2', 'sub-1'] }),
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('ID_REPETIDO');
    expect(decisao.details).toEqual({ submissionId: 'sub-1' });
  });

  it('item que não é id é recusado', () => {
    const decisao = decidir({
      acao: 'PUBLICAR_PARCIAL',
      conteudo: conteudo({ publicados: ['  '] }),
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('ID_FORA_DA_CHAMADA');
  });

  it('lista acima do teto é recusada', () => {
    const ids = Array.from({ length: CALL_RESULT_PUBLISHED_MAX + 1 }, (_, index) => `sub-${index}`);

    const decisao = decidir({
      acao: 'PUBLICAR_PARCIAL',
      conteudo: conteudo({ publicados: ids }),
      submissoesDaChamada: ids,
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('LISTA_LONGA');
  });

  it('a ordem escolhida é a ordem GRAVADA (a lista publicada é a do organizador)', () => {
    const decisao = decidir({
      acao: 'PUBLICAR_PARCIAL',
      conteudo: conteudo({ publicados: ['sub-3', 'sub-1'] }),
    });

    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    expect([...decisao.resultado.publicados]).toEqual(['sub-3', 'sub-1']);
  });

  it('ação desconhecida é recusada com o código próprio', () => {
    const decisao = decideCallResultTransition({
      atual: resultado(),
      /** Um POST forjado pode mandar qualquer texto no nome da ação. */
      acao: 'APAGAR_TUDO' as CallResultAction,
      conteudo: conteudo(),
      submissoesDaChamada: ['sub-1'],
      agora: AGORA,
    });

    expect(decisao.ok).toBe(false);
    if (decisao.ok) return;

    expect(decisao.code).toBe('ACAO_DESCONHECIDA');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O que o PÚBLICO vê
// ───────────────────────────────────────────────────────────────────────────────
describe('o que o público vê em cada estado', () => {
  it('SEM_RESULTADO não produz seção', () => {
    const projecao = projectPublicCallResult({
      resultado: emptyCallResult(),
      submissoes: [submissao()],
    });

    expect(projecao.view).toBeNull();
    expect(projecao.problems).toEqual([]);
  });

  it('RASCUNHO não produz seção — nem com texto e lista preenchidos', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'RASCUNHO' }),
      submissoes: [submissao()],
    });

    expect(projecao.view).toBeNull();
  });

  it('PARCIAL produz a seção com estado, data, texto, próximos passos e lista', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'PARCIAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [submissao()],
    });

    expect(projecao.view).not.toBeNull();
    if (!projecao.view) return;

    expect(Object.keys(projecao.view)).toEqual([...PUBLIC_CALL_RESULT_FIELD_ORDER]);
    expect(projecao.view.estado).toBe('PARCIAL');
    expect(projecao.view.publicadoEm).toBe(AGORA.toISOString());
    expect(projecao.view.texto).toBe('A lista dos trabalhos aprovados está abaixo.');
    expect(projecao.view.proximosPassos).toBe('Envie a versão final até 10 de novembro.');
    expect(projecao.view.lista).toHaveLength(1);
  });

  it('FINAL produz a seção com o estado final', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'FINAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [submissao()],
    });

    expect(projecao.view?.estado).toBe('FINAL');
  });

  it('publicado SEM data de publicação não gera seção (fail-closed, com motivo)', () => {
    const semData = resultado({ estado: 'PARCIAL' });

    const projecao = projectPublicCallResult({ resultado: semData, submissoes: [submissao()] });

    expect(projecao.view).toBeNull();
    expect(projecao.problems[0]).toContain('publicadoEm');
  });

  it('o item da lista tem exatamente as quatro chaves, nesta ordem', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'PARCIAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [submissao()],
    });

    const item = projecao.view?.lista[0];
    expect(item).toBeDefined();
    if (!item) return;

    expect(Object.keys(item)).toEqual([...PUBLIC_CALL_RESULT_ITEM_FIELD_ORDER]);
    expect(item.protocoloOuIdEstavel).toBe('ABC123');
    expect(item.titulo).toBe('Saúde pública e território');
    expect(item.tipo).toBe('Artigo');
  });

  it('sem protocolo, o identificador estável cai para o id', () => {
    expect(stableSubmissionIdentifier({ protocol: '  ', id: 'sub-9' })).toBe('sub-9');
    expect(stableSubmissionIdentifier({ protocol: 'ABC123', id: 'sub-9' })).toBe('ABC123');

    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'PARCIAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [submissao({ protocol: '' })],
    });

    expect(projecao.view?.lista[0]?.protocoloOuIdEstavel).toBe('sub-1');
  });

  it('a ordem da lista é a de `publicados`, não a da consulta', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({
        estado: 'PARCIAL',
        publicadoEm: AGORA.toISOString(),
        publicados: ['sub-2', 'sub-1'],
      }),
      submissoes: [submissao({ id: 'sub-1', titulo: 'Primeiro' }), submissao({ id: 'sub-2', titulo: 'Segundo' })],
    });

    expect(projecao.view?.lista.map((item) => item.titulo)).toEqual(['Segundo', 'Primeiro']);
  });

  it('submissão publicada que não veio na leitura sai da lista, e o motivo é reportado', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({
        estado: 'PARCIAL',
        publicadoEm: AGORA.toISOString(),
        publicados: ['sub-1', 'sumiu'],
      }),
      submissoes: [submissao()],
    });

    expect(projecao.view?.lista).toHaveLength(1);
    expect(projecao.problems[0]).toContain('sumiu');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A EXCEÇÃO DECLARADA DO NOME COMPLETO — e o teste que impede o alastramento
// ───────────────────────────────────────────────────────────────────────────────
describe('a exceção do nome completo (decisão 2 do humano na FASE 73)', () => {
  it('a lista publica o nome COMPLETO, inclusive de quem se oculta', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'FINAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [
        submissao({
          autores: [autor(ANA, true), autor(BRUNO, false), autor('Carla Nunes', true)],
        }),
      ],
    });

    expect(projecao.view?.lista[0]?.autores).toEqual([ANA, BRUNO, 'Carla Nunes']);
  });

  it('A MESMA pessoa oculta continua MASCARADA na régua geral da casa', () => {
    /** É este par que impede a exceção de virar a régua de todo mundo. */
    const oculta = { publicProfileHiddenAt: new Date('2026-09-01T10:00:00.000Z') };
    const visivel = { publicProfileHiddenAt: null };

    expect(isPersonPubliclyVisible(oculta)).toBe(false);
    expect(isPersonPubliclyVisible(visivel)).toBe(true);

    expect(maskPersonName(ANA)).toBe('Ana S.');
    expect(maskPersonName('Carla Nunes')).toBe('Carla N.');

    /**
     * E a lista da chamada, na MESMA execução, publica o nome inteiro da mesma
     * pessoa — a exceção é da superfície, não da pessoa.
     */
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'FINAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [submissao({ autores: [autor(ANA, true)] })],
    });

    expect(projecao.view?.lista[0]?.autores).toEqual([ANA]);
  });

  it('o SINAL da ocultação nunca vai ao público (revelaria quem se ocultou)', () => {
    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'FINAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [submissao({ autores: [autor(ANA, true)] })],
    });

    expect(JSON.stringify(projecao.view)).not.toContain('oculto');
    expect(projecao.view?.lista[0]).not.toHaveProperty('oculto');
  });

  it('CATRACA: a exceção mora em UM arquivo, que NÃO importa a régua da E79', () => {
    const fonte = semComentarios(
      readFileSync(join(process.cwd(), 'src/domain/proposals/call-result-rules.ts'), 'utf8'),
    );

    /** Se alguém "consertar" a lista importando a máscara, este teste cai. */
    expect(fonte).not.toContain('public-profile-rules');
    expect(fonte).not.toContain('maskPersonName');
    expect(fonte).not.toContain('isPersonPubliclyVisible');

    /** E se alguém passar a LER o sinal para mascarar, este cai também. */
    expect(fonte).not.toContain('autor.oculto');
    expect(fonte).not.toContain('autores.oculto');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A lista fechada: reprova, não filtra
// ───────────────────────────────────────────────────────────────────────────────
describe('assertResultadoSemCampoProibido reprova em vez de filtrar', () => {
  function visao(): Record<string, unknown> {
    return {
      estado: 'PARCIAL',
      publicadoEm: AGORA.toISOString(),
      texto: 'Aprovados:',
      proximosPassos: 'Envie a versão final.',
      lista: [
        {
          protocoloOuIdEstavel: 'ABC123',
          titulo: 'Saúde pública e território',
          tipo: 'Artigo',
          autores: [ANA, BRUNO],
        },
      ],
    };
  }

  it('a visão limpa passa', () => {
    expect(() => assertResultadoSemCampoProibido(visao())).not.toThrow();
    expect(findForbiddenResultField(visao())).toBeNull();
  });

  it('nota reprova, com o nome do campo e o caminho', () => {
    const suja = { ...visao(), nota: 9.5 };

    expect(() => assertResultadoSemCampoProibido(suja)).toThrow(ResultadoCampoProibidoError);
    expect(findForbiddenResultField(suja)).toEqual({ campo: 'nota', caminho: 'resultado.nota' });
  });

  it('parecer ANINHADO no item da lista reprova, e o caminho diz onde', () => {
    const suja = visao();
    const lista = suja.lista as Record<string, unknown>[];
    lista[0] = { ...lista[0], parecer: 'Trabalho fraco, recomendo recusar.' };

    expect(findForbiddenResultField(suja)).toEqual({
      campo: 'parecer',
      caminho: 'resultado.lista[0].parecer',
    });
    expect(() => assertResultadoSemCampoProibido(suja)).toThrow(/parecer/);
  });

  it('e-mail, CPF, revisor, proposta crua e fila também reprovam', () => {
    const proibidos: readonly string[] = [
      'email',
      'cpf',
      'revisor',
      'reviewer',
      'proposalData',
      'waitlistPosition',
      'registrationId',
      'formResponses',
      'finalScore',
      'decisionNotes',
      'oculto',
    ];

    for (const campo of proibidos) {
      const suja = { ...visao(), [campo]: 'x' };

      expect(findForbiddenResultField(suja), campo).toEqual({ campo, caminho: `resultado.${campo}` });
    }
  });

  it('grafias alternativas caem na mesma régua (a normalização é a da F72)', () => {
    for (const grafia of ['Nota', 'NOTA', 'nota_final', 'nota-final', 'emailMasked', 'reviewerName']) {
      expect(isForbiddenResultField(grafia), grafia).toBe(true);
    }

    for (const legitima of ['estado', 'texto', 'publicadoEm', 'titulo', 'tipo', 'autores', 'protocoloOuIdEstavel']) {
      expect(isForbiddenResultField(legitima), legitima).toBe(false);
    }
  });

  it('a lista fechada tem motivo em português para cada campo (a frase é o relatório)', () => {
    expect(RESULT_FORBIDDEN_FIELDS.length).toBeGreaterThan(30);

    for (const entrada of RESULT_FORBIDDEN_FIELDS) {
      expect(entrada.motivo.length, entrada.campo).toBeGreaterThan(10);
      expect(isForbiddenResultField(entrada.campo), entrada.campo).toBe(true);
    }
  });

  it('a projeção pública já aplica a catraca (o chamador não pode esquecer)', () => {
    /**
     * O serviço pode espalhar a LINHA do banco no material de origem — com nota,
     * parecer e e-mail dentro. A lista pública é montada campo a campo, então o que
     * não é título/tipo/autoria não chega ao view, e a catraca garante que o view
     * nunca GANHE o campo (a origem suja é o caso real do serviço da fatia 2).
     */
    const origemSuja = submissao();
    const comCamposInternos = {
      ...origemSuja,
      nota: 9.5,
      parecer: 'interno',
      email: 'ana@example.test',
    };

    const projecao = projectPublicCallResult({
      resultado: resultado({ estado: 'FINAL', publicadoEm: AGORA.toISOString() }),
      submissoes: [comCamposInternos],
    });

    expect(projecao.view?.lista[0]).toEqual({
      protocoloOuIdEstavel: 'ABC123',
      titulo: 'Saúde pública e território',
      tipo: 'Artigo',
      autores: [ANA, BRUNO],
    });
    expect(JSON.stringify(projecao.view)).not.toContain('9.5');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O leitor TOLERANTE
// ───────────────────────────────────────────────────────────────────────────────
describe('readCallResult — o leitor tolerante', () => {
  it('ausente e o DEFAULT da coluna (`{}`) são o caso normal, sem problema', () => {
    for (const bruto of [undefined, null, {}]) {
      const leitura = readCallResult(bruto);

      expect(leitura.source).toBe('DEFAULT');
      expect(leitura.problems).toEqual([]);
      expect(leitura.resultado).toEqual(emptyCallResult());
    }
  });

  it('JSON que não é objeto cai no padrão COM motivo', () => {
    for (const bruto of ['publicado', 42, ['FINAL']]) {
      const leitura = readCallResult(bruto);

      expect(leitura.source).toBe('DEFAULT');
      expect(leitura.resultado).toEqual(emptyCallResult());
      expect(leitura.problems).toHaveLength(1);
      expect(leitura.problems[0]).toContain('resultado');
    }
  });

  it('estado desconhecido cai em SEM_RESULTADO, com o motivo', () => {
    const leitura = readCallResult({ estado: 'PUBLICADO', texto: 'oi' });

    expect(leitura.source).toBe('DEFAULT');
    expect(leitura.resultado.estado).toBe('SEM_RESULTADO');
    expect(leitura.problems[0]).toContain('PUBLICADO');
  });

  it('objeto sem estado (mas com conteúdo) cai no padrão, com o motivo', () => {
    const leitura = readCallResult({ texto: 'oi', publicados: ['sub-1'] });

    expect(leitura.source).toBe('DEFAULT');
    expect(leitura.problems[0]).toContain('estado');
  });

  it('campo desconhecido é REPORTADO (e não copiado para o resultado)', () => {
    const leitura = readCallResult({ estado: 'RASCUNHO', nota: 9.5 });

    expect(leitura.resultado.estado).toBe('RASCUNHO');
    expect(leitura.resultado).not.toHaveProperty('nota');
    expect(leitura.problems).toHaveLength(1);
    expect(leitura.problems[0]).toContain('nota');
    expect(leitura.problems[0]).toContain('desconhecido');
  });

  it('RASCUNHO com `publicadoEm` perde a data (rascunho não tem data de publicação)', () => {
    const leitura = readCallResult({
      estado: 'RASCUNHO',
      texto: 'oi',
      publicadoEm: DEPOIS.toISOString(),
    });

    expect(leitura.resultado.estado).toBe('RASCUNHO');
    expect(leitura.resultado.publicadoEm).toBeUndefined();
    expect(leitura.problems[0]).toContain('publicadoEm');
  });

  it('PARCIAL sem `publicadoEm` é rebaixado a RASCUNHO: nada vai ao público sem data', () => {
    const leitura = readCallResult({
      estado: 'PARCIAL',
      texto: 'Aprovados abaixo.',
      publicados: ['sub-1'],
    });

    expect(leitura.resultado.estado).toBe('RASCUNHO');
    expect(leitura.problems[0]).toContain('publicadoEm');

    /** E o rebaixamento é medido do lado do público, que é o que importa. */
    const projecao = projectPublicCallResult({
      resultado: leitura.resultado,
      submissoes: [submissao()],
    });
    expect(projecao.view).toBeNull();
  });

  it('SEM_RESULTADO com conteúdo descarta o conteúdo', () => {
    const leitura = readCallResult({
      estado: 'SEM_RESULTADO',
      texto: 'resto de um resultado antigo',
      publicados: ['sub-1'],
      atualizadoEm: DEPOIS.toISOString(),
    });

    expect(leitura.resultado).toEqual(emptyCallResult());
    expect(leitura.problems[0]).toContain('SEM_RESULTADO');
  });

  it('tipos tortos campo a campo são descartados com motivo, sem lançar', () => {
    const leitura = readCallResult({
      estado: 'PARCIAL',
      texto: 42,
      proximosPassos: { a: 1 },
      publicados: 'sub-1',
      atualizadoEm: 'ontem',
      publicadoEm: 'nunca',
    });

    expect(leitura.resultado.estado).toBe('RASCUNHO');
    expect(leitura.resultado.texto).toBe('');
    expect(leitura.resultado.proximosPassos).toBe('');
    expect(leitura.resultado.publicados).toEqual([]);
    expect(leitura.resultado.atualizadoEm).toBeNull();

    const motivos = leitura.problems.join(' | ');
    expect(motivos).toContain('resultado.texto');
    expect(motivos).toContain('resultado.proximosPassos');
    expect(motivos).toContain('resultado.publicados');
    expect(motivos).toContain('resultado.atualizadoEm');
    expect(motivos).toContain('resultado.publicadoEm');
  });

  it('lista com item inválido e id repetido: reporta e mantém a primeira ocorrência', () => {
    const leitura = readCallResult({
      estado: 'PARCIAL',
      publicadoEm: AGORA.toISOString(),
      publicados: ['sub-1', 7, 'sub-1', '  ', 'sub-2'],
    });

    expect([...leitura.resultado.publicados]).toEqual(['sub-1', 'sub-2']);
    expect(leitura.problems.join(' | ')).toContain('repetido');
    expect(leitura.problems.join(' | ')).toContain('não é id de submissão');
  });

  it('a data é normalizada para UTC (duas grafias do mesmo instante gravam igual)', () => {
    const leitura = readCallResult({
      estado: 'FINAL',
      publicadoEm: '2026-10-22T09:00:00-03:00',
      atualizadoEm: '2026-10-22T12:00:00.000Z',
    });

    expect(leitura.resultado.publicadoEm).toBe('2026-10-22T12:00:00.000Z');
    expect(leitura.resultado.atualizadoEm).toBe('2026-10-22T12:00:00.000Z');
  });

  it('um resultado válido é lido inteiro (ida e volta do que a transição gravou)', () => {
    const decisao = decidir({
      atual: resultado({ estado: 'RASCUNHO' }),
      acao: 'PUBLICAR_FINAL',
      conteudo: conteudo({ publicados: ['sub-1', 'sub-2'] }),
      agora: AGORA,
    });
    expect(decisao.ok).toBe(true);
    if (!decisao.ok) return;

    const leitura = readCallResult(JSON.parse(JSON.stringify(decisao.resultado)));

    expect(leitura.source).toBe('RESULT');
    expect(leitura.problems).toEqual([]);
    expect(leitura.resultado).toEqual(decisao.resultado);
  });

  it('nunca lança — nem com lixo profundo', () => {
    const lixos: readonly unknown[] = [
      { estado: 'PARCIAL', publicados: [null, undefined, 0] },
      { estado: 'FINAL', publicadoEm: true },
      { estado: ['FINAL'] },
      Object.create(null) as unknown,
    ];

    for (const lixo of lixos) {
      expect(() => readCallResult(lixo)).not.toThrow();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O seletor da lista — a decisão vira marca
// ───────────────────────────────────────────────────────────────────────────────
describe('buildCallResultSelector — o que o organizador vê no seletor', () => {
  const SUBMISSOES = [
    {
      id: 'sub-1',
      titulo: 'Saúde pública e território',
      tipo: 'Artigo',
      status: 'ACCEPTED' as const,
      autores: [ANA, BRUNO],
    },
    {
      id: 'sub-2',
      titulo: 'Educação e cidade',
      tipo: 'Resumo',
      status: 'REJECTED' as const,
      autores: ['Carla Nunes'],
    },
    {
      id: 'sub-3',
      titulo: 'Território e memória',
      tipo: 'Artigo',
      status: 'UNDER_REVIEW' as const,
      autores: ['Diego Alves'],
    },
  ];

  it('mostra TODAS as submissões, com o status da decisão ao lado', () => {
    const opcoes = buildCallResultSelector({
      resultado: emptyCallResult(),
      submissoes: SUBMISSOES,
    });

    expect(opcoes).toHaveLength(3);
    expect(opcoes.map((opcao) => opcao.id)).toEqual(['sub-1', 'sub-2', 'sub-3']);
    expect(opcoes.map((opcao) => opcao.decisao)).toEqual(['ACCEPTED', 'REJECTED', 'UNDER_REVIEW']);
    expect(opcoes.map((opcao) => opcao.decisaoLabel)).toEqual(['Aceita', 'Rejeitada', 'Em avaliação']);
    expect(opcoes[0]?.autores).toEqual([ANA, BRUNO]);
  });

  it('o primeiro ato pré-marca as ACEITAS (e só elas)', () => {
    const opcoes = buildCallResultSelector({
      resultado: emptyCallResult(),
      submissoes: SUBMISSOES,
    });

    expect(opcoes.map((opcao) => opcao.marcada)).toEqual([true, false, false]);
    expect(opcoes.map((opcao) => opcao.jaPublicada)).toEqual([false, false, false]);
  });

  it('depois do primeiro ato vale a ESCOLHA do organizador (desmarcar não volta)', () => {
    const opcoes = buildCallResultSelector({
      /** Rascunho salvo: a aceita foi desmarcada de propósito, a em avaliação marcada. */
      resultado: resultado({ estado: 'RASCUNHO', publicados: ['sub-3'] }),
      submissoes: SUBMISSOES,
    });

    expect(opcoes.map((opcao) => opcao.marcada)).toEqual([false, false, true]);
    expect(opcoes.map((opcao) => opcao.jaPublicada)).toEqual([false, false, true]);
  });

  it('rascunho com a lista VAZIA é uma escolha: nada é re-marcado', () => {
    const opcoes = buildCallResultSelector({
      resultado: resultado({ estado: 'RASCUNHO', publicados: [] }),
      submissoes: SUBMISSOES,
    });

    expect(opcoes.every((opcao) => !opcao.marcada)).toBe(true);
  });

  it('publicar algo em avaliação é possível — a marca é do organizador, não da decisão', () => {
    const opcoes = buildCallResultSelector({
      resultado: emptyCallResult(),
      submissoes: SUBMISSOES,
    });

    /** O domínio não impede a marca; a transição aceita o id (é da chamada). */
    const decisao = decidir({
      atual: emptyCallResult(),
      acao: 'PUBLICAR_PARCIAL',
      conteudo: conteudo({ publicados: ['sub-3'] }),
    });

    expect(opcoes[2]?.decisao).toBe('UNDER_REVIEW');
    expect(decisao.ok).toBe(true);
  });

  it('todas as decisões do enum real têm rótulo (a catraca do tipo)', () => {
    expect(Object.keys(SUBMISSION_STATUS_LABELS).sort()).toEqual([
      'ACCEPTED',
      'CANCELED',
      'DRAFT',
      'REJECTED',
      'REVISION_REQUESTED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'WITHDRAWN',
    ]);

    for (const [status, rotulo] of Object.entries(SUBMISSION_STATUS_LABELS)) {
      expect(rotulo.length, status).toBeGreaterThan(0);
    }

    expect(isAcceptedSubmission('ACCEPTED')).toBe(true);
    expect(isAcceptedSubmission('UNDER_REVIEW')).toBe(false);
    expect(isAcceptedSubmission('REJECTED')).toBe(false);
  });

  it('o seletor não aplica máscara: é a tela do organizador', () => {
    const opcoes = buildCallResultSelector({
      resultado: emptyCallResult(),
      submissoes: SUBMISSOES,
    });

    expect(opcoes[0]?.autores).toEqual([ANA, BRUNO]);
    expect(opcoes[0]?.autores).not.toContain('Ana S.');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  CATRACA — o módulo é PURO (sem ORM, sem Next, sem relógio)
// ───────────────────────────────────────────────────────────────────────────────
describe('catraca de pureza do domínio', () => {
  const CAMINHO = 'src/domain/proposals/call-result-rules.ts';

  function fonte(): string {
    return semComentarios(readFileSync(join(process.cwd(), CAMINHO), 'utf8'));
  }

  it('não importa Prisma, Next nem infraestrutura', () => {
    const codigo = fonte();

    expect(codigo).not.toContain('@prisma');
    expect(codigo).not.toContain("from 'prisma");
    expect(codigo).not.toContain('next/');
    expect(codigo).not.toContain('withTenant');
    expect(codigo).not.toContain('adminPrisma');
  });

  it('não lê relógio: o instante entra por parâmetro', () => {
    const codigo = fonte();

    expect(codigo).not.toContain('Date.now(');
    expect(codigo).not.toMatch(/new Date\(\s*\)/);
  });

  it('não usa `any`', () => {
    expect(fonte()).not.toMatch(/:\s*any\b/);
    expect(fonte()).not.toMatch(/as any\b/);
  });
});

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
