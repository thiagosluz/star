/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A CHAMADA QUE HERDA A CEGUEIRA DA TRILHA
 *  (FASE 74 · fatia 5 · decisão 3 do humano)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A precedência CHAMADA → TRILHA → PADRÃO está no ADR-160 desde a FASE 33, mas o
 *  serviço a escrevia como `call?.requiresBlindReview ?? track?.requiresBlindReview
 *  ?? true`. Como a coluna da chamada era `boolean NOT NULL`, `call` nunca era nulo
 *  e o `??` JAMAIS chegava na trilha: a chamada sempre vencia — inclusive quando não
 *  tinha dito nada sobre cegueira. A chamada de minicursos do seed (trilha cega,
 *  chamada aberta) era avaliada como aberta, em silêncio.
 *
 *  A coluna passou a aceitar `NULL` ("não me pronuncio") e a ordem virou uma FUNÇÃO
 *  PURA (`resolveRequiresBlindReview`), lida por todos os caminhos. A matriz abaixo é
 *  o contrato: chamada true/false/null × trilha true/false/null × PAPER/MINICOURSE.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ANÚNCIO É TESTADO AQUI TAMBÉM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página da chamada anuncia o que o envio vai exigir. Se ela anunciasse a
 *  DECLARAÇÃO crua da chamada (`null` → "revisão aberta"), uma chamada que herda de
 *  trilha cega prometeria revisão aberta e o envio cobraria o PDF anonimizado. O
 *  teste compõe as duas peças — resolver → exigências — exatamente como a página
 *  faz, e a catraca de fonte prende o nome do campo que a página usa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROPOSAL_KINDS,
  defaultBlindFor,
  resolveRequiresBlindReview,
  type ProposalKind,
} from '../../src/domain/proposals/call-rules';
import {
  proposalAttachmentStepNotice,
  submissionArtifactRequirements,
} from '../../src/domain/review/submission-rules';

const SERVICO = 'src/lib/review/submission-service.ts';
const PAGINA_DA_CHAMADA =
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx';
const PAINEL_DA_CHAMADA =
  'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx';
const ACTION_DA_CHAMADA = 'src/app/actions/call-actions.ts';

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fonte(caminho: string): string {
  return semComentarios(readFileSync(join(process.cwd(), caminho), 'utf8'));
}

const BOOLEANOS = [true, false, null] as const;
const TIPOS: readonly ProposalKind[] = ['PAPER', 'MINICOURSE'];

function resolver(input: {
  call: boolean | null;
  track: boolean | null;
  kind: ProposalKind | null;
}) {
  return resolveRequiresBlindReview({
    callRequiresBlindReview: input.call,
    trackRequiresBlindReview: input.track,
    kind: input.kind,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveRequiresBlindReview() — CHAMADA → TRILHA → PADRÃO DO TIPO', () => {
  it('a matriz inteira: chamada × trilha × tipo', () => {
    /**
     * A expectativa é escrita como `call ?? track ?? defaultBlindFor(kind)` — a
     * definição da precedência, não uma tabela copiada à mão. Copiar 18 respostas
     * prenderia a tabela; a expressão prende a REGRA.
     */
    for (const kind of TIPOS) {
      for (const call of BOOLEANOS) {
        for (const track of BOOLEANOS) {
          const caso = `chamada=${String(call)} trilha=${String(track)} tipo=${kind}`;
          const resultado = resolver({ call, track, kind });

          expect(resultado.requiresBlindReview, caso).toBe(
            call ?? track ?? defaultBlindFor(kind),
          );

          const origemEsperada = call !== null ? 'CALL' : track !== null ? 'TRACK' : 'TYPE';

          expect(resultado.source, caso).toBe(origemEsperada);
        }
      }
    }
  });

  it('a chamada CALADA deixa a trilha cega valer — o caso do seed', () => {
    /**
     * A chamada de minicursos do seed: a trilha é cega e a chamada nunca disse nada.
     * Era este o caso avaliado como aberto em silêncio.
     */
    expect(resolver({ call: null, track: true, kind: 'MINICOURSE' })).toEqual({
      requiresBlindReview: true,
      source: 'TRACK',
    });

    /** E vale nos dois sentidos: trilha aberta + chamada calada = revisão aberta. */
    expect(resolver({ call: null, track: false, kind: 'PAPER' })).toEqual({
      requiresBlindReview: false,
      source: 'TRACK',
    });
  });

  it('a chamada que se pronuncia vence a trilha nos dois sentidos', () => {
    expect(resolver({ call: false, track: true, kind: 'PAPER' })).toEqual({
      requiresBlindReview: false,
      source: 'CALL',
    });

    expect(resolver({ call: true, track: false, kind: 'MINICOURSE' })).toEqual({
      requiresBlindReview: true,
      source: 'CALL',
    });
  });

  it('sem trilha, o padrão do TIPO decide: PAPER/POSTER cegos, o resto aberto', () => {
    /**
     * O caso "trilha nula" é o último degrau, e ele NÃO é `false`: se fosse, toda
     * chamada de artigo sem trilha abriria a autoria em silêncio — o mesmo defeito
     * desta fatia virado do avesso.
     */
    for (const kind of PROPOSAL_KINDS) {
      expect(resolver({ call: null, track: null, kind }), kind).toEqual({
        requiresBlindReview: defaultBlindFor(kind),
        source: 'TYPE',
      });
    }

    expect(resolver({ call: null, track: null, kind: 'PAPER' }).requiresBlindReview).toBe(true);
    expect(resolver({ call: null, track: null, kind: 'POSTER' }).requiresBlindReview).toBe(true);
    expect(resolver({ call: null, track: null, kind: 'MINICOURSE' }).requiresBlindReview).toBe(false);
  });

  it('sem chamada NEM trilha, a submissão legada continua cega (o `?? true` da FASE 4)', () => {
    expect(resolver({ call: null, track: null, kind: null })).toEqual({
      requiresBlindReview: true,
      source: 'TYPE',
    });
  });

  it('"não mandou" e "mandou nulo" são a mesma coisa: ausência é não se pronunciar', () => {
    expect(resolveRequiresBlindReview({ trackRequiresBlindReview: true, kind: 'PAPER' })).toEqual({
      requiresBlindReview: true,
      source: 'TRACK',
    });

    expect(
      resolveRequiresBlindReview({
        callRequiresBlindReview: null,
        trackRequiresBlindReview: false,
        kind: 'PAPER',
      }),
    ).toEqual({ requiresBlindReview: false, source: 'TRACK' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o ANÚNCIO acompanha a herança (a página compõe resolver → exigências)', () => {
  it('chamada calada + trilha cega anuncia o PDF anonimizado como OBRIGATÓRIO', () => {
    for (const kind of TIPOS) {
      const efetiva = resolver({ call: null, track: true, kind });

      const exigencias = submissionArtifactRequirements({
        requiresBlindReview: efetiva.requiresBlindReview,
        proposalKind: kind,
      });

      const chaves = exigencias.map((row) => row.key);

      expect(chaves, kind).toContain('BLIND_PDF');
      expect(chaves, kind).not.toContain('ANY_PDF');
      expect(exigencias[0]?.required, kind).toBe(true);
      expect(exigencias[0]?.label, kind).toContain('anonimizado');
    }
  });

  it('chamada calada + trilha aberta em PAPER anuncia "PDF do trabalho", não o cego', () => {
    const efetiva = resolver({ call: null, track: false, kind: 'PAPER' });

    const chaves = submissionArtifactRequirements({
      requiresBlindReview: efetiva.requiresBlindReview,
      proposalKind: 'PAPER',
    }).map((row) => row.key);

    expect(chaves).toEqual(['ANY_PDF']);
  });

  it('chamada que se pronuncia manda no anúncio, contra ou a favor da trilha', () => {
    const abertaSobreTrilhaCega = resolver({ call: false, track: true, kind: 'PAPER' });
    const cegaSobreTrilhaAberta = resolver({ call: true, track: false, kind: 'MINICOURSE' });

    expect(
      submissionArtifactRequirements({
        requiresBlindReview: abertaSobreTrilhaCega.requiresBlindReview,
        proposalKind: 'PAPER',
      }).map((row) => row.key),
    ).toEqual(['ANY_PDF']);

    expect(
      submissionArtifactRequirements({
        requiresBlindReview: cegaSobreTrilhaAberta.requiresBlindReview,
        proposalKind: 'MINICOURSE',
      }).map((row) => row.key),
    ).toContain('BLIND_PDF');
  });

  it('o aviso do passo do arquivo existe exatamente quando há exigência obrigatória', () => {
    /**
     * A página mostra o aviso "o rascunho fica salvo e você continua na sua área" só
     * quando há arquivo a anexar. Com a herança, uma chamada de minicurso (tipo que
     * não pede PDF) passa a ter esse passo quando HERDA de uma trilha cega.
     */
    const herdaCega = resolver({ call: null, track: true, kind: 'MINICOURSE' });
    const herdaAberta = resolver({ call: null, track: false, kind: 'MINICOURSE' });

    expect(
      proposalAttachmentStepNotice({
        requiresBlindReview: herdaCega.requiresBlindReview,
        proposalKind: 'MINICOURSE',
      }),
    ).toEqual(expect.any(String));

    expect(
      proposalAttachmentStepNotice({
        requiresBlindReview: herdaAberta.requiresBlindReview,
        proposalKind: 'MINICOURSE',
      }),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('catracas — a regra não volta a ser escrita à mão', () => {
  it('o serviço de submissão usa a função de domínio e não a expressão inline', () => {
    const servico = fonte(SERVICO);

    expect(servico).toContain('resolveRequiresBlindReview({');

    /**
     * A expressão antiga não pode voltar: com uma coluna nulável ela já não é sequer
     * equivalente (o `??` agora alcança a trilha), mas continuaria sendo uma SEGUNDA
     * cópia da precedência — e a segunda cópia é como as duas versões nasceram.
     */
    expect(servico).not.toMatch(
      /call\?\.requiresBlindReview\s*\?\?\s*submission\.track\?\.requiresBlindReview/,
    );
    expect(servico).not.toMatch(/track\?\.requiresBlindReview\s*\?\?\s*true/);
  });

  it('a página da chamada anuncia a cegueira EFETIVA, não a declaração crua', () => {
    const pagina = fonte(PAGINA_DA_CHAMADA);

    expect(pagina).toContain('call.effectiveRequiresBlindReview');

    /**
     * Ler a coluna crua na página é o que faria a chamada que herda anunciar
     * "revisão aberta": o valor é `null` nela.
     */
    expect(pagina).not.toContain('requiresBlindReview: call.requiresBlindReview');
  });

  it('o painel da chamada oferece os TRÊS estados — inclusive "Herdar da trilha"', () => {
    /**
     * A distinção "herdar" × "padrão do tipo" só existe se a TELA a oferecer: o
     * formulário é sem JavaScript, então o estado gravado (`null`) tem de voltar ao
     * select como uma opção própria — e não como "Não", que transformaria a herança
     * numa decisão aberta no primeiro salvamento.
     */
    const painel = fonte(PAINEL_DA_CHAMADA);

    expect(painel).toContain(`{ value: 'inherit', label: 'Herdar da trilha' }`);
    expect(painel).toContain(`{ value: '', label: 'Padrão do tipo`);
    expect(painel).toContain('blindOptionValue(call.requiresBlindReview)');
    expect(painel).toContain('é o que faz uma trilha cega valer');
  });

  it('a action traduz "herdar" para a coluna NULA, e "padrão" para o default do tipo', () => {
    const action = fonte(ACTION_DA_CHAMADA);

    expect(action).toContain(`data.blind === 'inherit' ? null`);
    expect(action).toContain(`data.blind === undefined ? undefined`);
  });
});
