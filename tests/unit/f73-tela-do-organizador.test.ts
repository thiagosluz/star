/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A TELA DO ORGANIZADOR DO RESULTADO (FASE 73 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (sem banco e sem navegador)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • as QUATRO frases de estado, uma por estado REAL, e que o FINAL diz "travado"
 *    e manda REABRIR — a frase que o organizador lê antes de decidir o clique;
 *  • a consequência de cada gesto, inclusive a do REABRIR (final deixa de ser final
 *    e o ato fica na trilha);
 *  • o aviso de publicação, que precisa existir ANTES do clique;
 *  • os tetos visíveis, com separador de milhar DETERMINÍSTICO (nada de
 *    `toLocaleString`, que divergiria entre servidor e navegador na hidratação);
 *  • a frase da data, inclusive quando não há data (sem inventar "agora");
 *  • as CATRACAS DE FONTE: a tela importa o mapa de status do DOMÍNIO (não cria a
 *    quarta cópia), não rederiva legalidade (`availableCallResultActions`) e não
 *    repete a guarda de permissão que mora na página e nas actions.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CALL_RESULT_ACTION_LABELS,
  CALL_RESULT_ACTIONS,
  CALL_RESULT_NEXT_STEPS_MAX,
  CALL_RESULT_STATE_LABELS,
  CALL_RESULT_STATES,
  CALL_RESULT_TEXT_MAX,
} from '../../src/domain/proposals/call-result-rules';
import {
  CALL_RESULT_ACTION_SCREEN,
  CALL_RESULT_NEXT_STEPS_HINT,
  CALL_RESULT_PREVIEW_EMPTY,
  CALL_RESULT_PREVIEW_TITLE,
  CALL_RESULT_PUBLISH_NOTICE,
  CALL_RESULT_SELECTOR_HELP,
  CALL_RESULT_STATE_SCREEN,
  CALL_RESULT_TEXT_HINT,
  callResultLimitLabel,
  callResultProblemsTitle,
  callResultPublicationPhrase,
} from '../../src/domain/proposals/call-result-organizer-rules';

const CAMINHO_DO_CARTAO = 'src/components/proposals/call-result-card.tsx';
const CAMINHO_DA_PAGINA =
  'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx';

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fonte(caminho: string): string {
  return semComentarios(readFileSync(join(process.cwd(), caminho), 'utf8'));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Os estados
// ───────────────────────────────────────────────────────────────────────────────
describe('as frases dos quatro estados', () => {
  it('há exatamente uma frase por estado REAL, com o rótulo do domínio', () => {
    expect(Object.keys(CALL_RESULT_STATE_SCREEN).sort()).toEqual([...CALL_RESULT_STATES].sort());

    for (const estado of CALL_RESULT_STATES) {
      const copy = CALL_RESULT_STATE_SCREEN[estado];

      expect(copy.label, estado).toBe(CALL_RESULT_STATE_LABELS[estado]);
      expect(copy.phrase.length, estado).toBeGreaterThan(40);
      expect(copy.publicNote.length, estado).toBeGreaterThan(15);
    }
  });

  it('só o FINAL está travado — e a frase diz isso e manda reabrir', () => {
    expect(CALL_RESULT_STATE_SCREEN.FINAL.locked).toBe(true);

    for (const estado of ['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL'] as const) {
      expect(CALL_RESULT_STATE_SCREEN[estado].locked, estado).toBe(false);
    }

    const final = CALL_RESULT_STATE_SCREEN.FINAL;

    expect(final.phrase).toContain('travado');
    expect(final.phrase.toLowerCase()).toContain('reabra');
  });

  it('o PARCIAL se diz EDITÁVEL, e o RASCUNHO se diz invisível ao público', () => {
    expect(CALL_RESULT_STATE_SCREEN.PARCIAL.phrase).toContain('editável');
    expect(CALL_RESULT_STATE_SCREEN.PARCIAL.publicNote).toContain('público vê');

    expect(CALL_RESULT_STATE_SCREEN.RASCUNHO.phrase).toContain('rascunho');
    expect(CALL_RESULT_STATE_SCREEN.RASCUNHO.publicNote.toLowerCase()).toContain('nada');

    expect(CALL_RESULT_STATE_SCREEN.SEM_RESULTADO.phrase).toContain('ainda não teve resultado');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os gestos
// ───────────────────────────────────────────────────────────────────────────────
describe('a consequência de cada gesto', () => {
  it('há exatamente um texto por ação REAL, com o rótulo do domínio', () => {
    expect(Object.keys(CALL_RESULT_ACTION_SCREEN).sort()).toEqual([...CALL_RESULT_ACTIONS].sort());

    for (const acao of CALL_RESULT_ACTIONS) {
      const copy = CALL_RESULT_ACTION_SCREEN[acao];

      expect(copy.label, acao).toBe(CALL_RESULT_ACTION_LABELS[acao]);
      expect(copy.description.length, acao).toBeGreaterThan(40);
    }
  });

  it('só os dois gestos de PUBLICAÇÃO são marcados como tal', () => {
    expect(CALL_RESULT_ACTION_SCREEN.SALVAR_RASCUNHO.publish).toBe(false);
    expect(CALL_RESULT_ACTION_SCREEN.PUBLICAR_PARCIAL.publish).toBe(true);
    expect(CALL_RESULT_ACTION_SCREEN.PUBLICAR_FINAL.publish).toBe(true);
    expect(CALL_RESULT_ACTION_SCREEN.REABRIR.publish).toBe(false);
  });

  it('o REABRIR explica que o final DEIXA de ser final e que o ato fica na trilha', () => {
    const reabrir = CALL_RESULT_ACTION_SCREEN.REABRIR;

    expect(reabrir.description).toContain('deixa de ser final');
    expect(reabrir.description).toContain('parcial editável');
    expect(reabrir.description).toContain('continua no ar');
    expect(reabrir.description).toContain('trilha');
  });

  it('o PUBLICAR_FINAL avisa que TRAVA antes do clique', () => {
    expect(CALL_RESULT_ACTION_SCREEN.PUBLICAR_FINAL.description).toContain('TRAVA');
    expect(CALL_RESULT_ACTION_SCREEN.PUBLICAR_FINAL.description.toLowerCase()).toContain('reabrir');
  });

  it('o SALVAR_RASCUNHO diz que o público NÃO muda', () => {
    expect(CALL_RESULT_ACTION_SCREEN.SALVAR_RASCUNHO.description).toContain('sem publicar');
    expect(CALL_RESULT_ACTION_SCREEN.SALVAR_RASCUNHO.description).toContain('continua vendo');
  });

  it('o aviso de publicação existe e diz que o efeito é IMEDIATO', () => {
    expect(CALL_RESULT_PUBLISH_NOTICE).toContain('imediatamente');
    expect(CALL_RESULT_PUBLISH_NOTICE).toContain('página pública');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os tetos visíveis, a prévia e os problemas
// ───────────────────────────────────────────────────────────────────────────────
describe('os textos de apoio da tela', () => {
  it('o separador de milhar é determinístico (nada de toLocaleString)', () => {
    expect(callResultLimitLabel(4000)).toBe('4.000');
    expect(callResultLimitLabel(1000)).toBe('1.000');
    expect(callResultLimitLabel(0)).toBe('0');
    expect(callResultLimitLabel(1234567)).toBe('1.234.567');
  });

  it('cada campo mostra o PRÓPRIO teto, e o teto é o do domínio', () => {
    expect(CALL_RESULT_TEXT_HINT).toContain(callResultLimitLabel(CALL_RESULT_TEXT_MAX));
    expect(CALL_RESULT_NEXT_STEPS_HINT).toContain(
      callResultLimitLabel(CALL_RESULT_NEXT_STEPS_MAX),
    );

    /** Os dois limites são diferentes de propósito: um é comunicado, o outro instrução. */
    expect(CALL_RESULT_TEXT_MAX).toBeGreaterThan(CALL_RESULT_NEXT_STEPS_MAX);
  });

  it('a prévia se identifica como prévia e explica de onde o conteúdo vem', () => {
    expect(CALL_RESULT_PREVIEW_TITLE.toLowerCase()).toContain('prévia');
    expect(CALL_RESULT_PREVIEW_TITLE).toContain('público');

    expect(CALL_RESULT_PREVIEW_EMPTY.toLowerCase()).toContain('projeção');
    expect(CALL_RESULT_PREVIEW_EMPTY).toContain('quando houver resultado publicado');
  });

  it('a ajuda do seletor explica a pré-marcação e que desmarcar vale', () => {
    expect(CALL_RESULT_SELECTOR_HELP).toContain('aceitas');
    expect(CALL_RESULT_SELECTOR_HELP).toContain('desmarcar');
  });

  it('o título dos problemas concorda em número', () => {
    expect(callResultProblemsTitle(1)).toBe('Há 1 problema na configuração deste resultado:');
    expect(callResultProblemsTitle(2)).toBe('Há 2 problemas na configuração deste resultado:');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A frase da data
// ───────────────────────────────────────────────────────────────────────────────
describe('a data da publicação', () => {
  it('com data formatada, a frase diz quando foi publicado', () => {
    const frase = callResultPublicationPhrase({
      estado: 'FINAL',
      publicadoEmLabel: '22/10/2026 09:30',
    });

    expect(frase).toBe('Publicado em 22/10/2026 09:30.');
  });

  it('rascunho e sem-resultado dizem que NADA está no público', () => {
    for (const estado of ['SEM_RESULTADO', 'RASCUNHO'] as const) {
      const frase = callResultPublicationPhrase({ estado, publicadoEmLabel: null });

      expect(frase, estado).toContain('Ainda não publicado');
      expect(frase, estado).toContain('nada aparece no público');
    }
  });

  it('publicado sem data NÃO inventa uma data — e diz que não há registro', () => {
    /**
     * Hoje o leitor tolerante rebaixa PARCIAL/FINAL sem data a RASCUNHO; este ramo é a
     * defesa do dia em que ele mudar. "Agora" seria a mentira que a fatia 1 recusou.
     */
    for (const estado of ['PARCIAL', 'FINAL'] as const) {
      const frase = callResultPublicationPhrase({ estado, publicadoEmLabel: null });

      expect(frase, estado).toBe('Sem data de publicação registrada.');
      expect(frase, estado).not.toContain('Agora');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Catracas de fonte da tela
// ───────────────────────────────────────────────────────────────────────────────
describe('catraca do cartão do resultado', () => {
  it('importa o mapa de status do DOMÍNIO e não define a quarta cópia', () => {
    const codigo = fonte(CAMINHO_DO_CARTAO);

    expect(codigo).toContain('SUBMISSION_STATUS_LABELS');
    expect(codigo).toContain("from '@/domain/proposals/call-result-rules'");

    /** Uma tabela local de rótulos seria a quarta cópia (as três telas já têm a sua). */
    expect(codigo).not.toMatch(/SUBMISSION_STATUS_LABELS\s*[:=]/);
    expect(codigo).not.toContain('Em avaliação');
    expect(codigo).not.toContain('Revisão solicitada');
  });

  it('NÃO rederiva legalidade: desenha a lista que o serviço mandou', () => {
    const codigo = fonte(CAMINHO_DO_CARTAO);

    expect(codigo).toContain('acoesDisponiveis');
    expect(codigo).toContain('acoesDisponiveis.filter');

    /** A tabela do domínio é a fonte única das transições — a tela não a recalcula. */
    expect(codigo).not.toContain('availableCallResultActions');
    expect(codigo).not.toContain('isLegalResultTransition');
    expect(codigo).not.toContain('legalResultStatesFor');
    expect(codigo).not.toContain('resultStateAfter');

    /**
     * E não há `estado === 'FINAL'` escondendo botão: o travamento chega pela lista
     * (`REABRIR` é o único gesto legal) e pela frase do domínio (`locked`).
     */
    expect(codigo).not.toMatch(/estado\s*===\s*'FINAL'/);
  });

  it('usa o CheckboxField com o nome que a action lê e a pré-marcação do domínio', () => {
    const codigo = fonte(CAMINHO_DO_CARTAO);

    expect(codigo).toContain('name="publicados"');
    expect(codigo).toContain('defaultChecked={opcao.marcada}');
    expect(codigo).toContain('jaPublicada');
  });

  it('no FINAL a lista fica travada, e o valor viaja em campo oculto', () => {
    const codigo = fonte(CAMINHO_DO_CARTAO);

    /**
     * Caixa `disabled` não é enviada pelo HTML. Sem o campo oculto, REABRIR gravaria
     * uma lista VAZIA — o reabrir despublicaria os trabalhos sem ninguém pedir.
     */
    expect(codigo).toContain('disabled={screen.locked}');
    expect(codigo).toContain('type="hidden" name="publicados"');
  });

  it('não repete a guarda de permissão (ela mora na página e nas actions)', () => {
    const codigo = fonte(CAMINHO_DO_CARTAO);

    expect(codigo).not.toContain('requirePagePermission');
    expect(codigo).not.toContain('guardAction');
    expect(codigo).not.toContain('PERMISSIONS');
  });

  it('não usa `any`', () => {
    expect(fonte(CAMINHO_DO_CARTAO)).not.toMatch(/:\s*any\b/);
    expect(fonte(CAMINHO_DO_CARTAO)).not.toMatch(/as any\b/);
  });
});

describe('catraca da página de chamadas', () => {
  it('é a MESMA página, com a guarda e o cartão do resultado', () => {
    const codigo = fonte(CAMINHO_DA_PAGINA);

    expect(codigo).toContain('requirePagePermission');
    expect(codigo).toContain('PERMISSIONS.EVENT_MANAGE');

    expect(codigo).toContain('getCallResultPanel');
    expect(codigo).toContain('CallResultCard');
    expect(codigo).toContain('resultPanel.panel.acoesDisponiveis');
    expect(codigo).toContain('formatZonedDateTime');
  });
});

describe('catraca de pureza do domínio de telas', () => {
  const caminho = 'src/domain/proposals/call-result-organizer-rules.ts';

  it('não importa Prisma, Next nem infraestrutura', () => {
    const codigo = fonte(caminho);

    expect(codigo).not.toContain('@prisma');
    expect(codigo).not.toContain('next/');
    expect(codigo).not.toContain('withTenant');
    expect(codigo).not.toContain('adminPrisma');
  });

  it('não lê relógio nem formata data (o rótulo da data chega pronto do servidor)', () => {
    const codigo = fonte(caminho);

    expect(codigo).not.toContain('Date.now(');
    expect(codigo).not.toMatch(/new Date\(\s*\)/);
    expect(codigo).not.toContain('Intl.DateTimeFormat');
    expect(codigo).not.toContain('toLocaleString');
  });

  it('não usa `any`', () => {
    expect(fonte(caminho)).not.toMatch(/:\s*any\b/);
    expect(fonte(caminho)).not.toMatch(/as any\b/);
  });
});
