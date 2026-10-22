/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — AS DUAS VERDADES DA TELA DA PROPOSTA (FASE 74 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (sem banco e sem navegador)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a lista "O que esta chamada pede" é decidida pelo DOMÍNIO
 *    (`submissionArtifactRequirements`): PAPER/POSTER — ou qualquer chamada cega —
 *    exige o PDF anonimizado, e o identificado é RECOMENDAÇÃO;
 *  • a frase da tela e a recusa da régua saem do MESMO objeto: para cada exigência
 *    obrigatória, o texto que a tela mostra e o bloqueio que o serviço devolve vêm
 *    juntos de `submissionArtifactRequirements`;
 *  • as CATRACAS DE FONTE: a página da chamada não escreve a frase à mão, a página
 *    da submissão não escreve a lista de bloqueios à mão (era assim que a trilha
 *    ficava de fora) e a recusa com rascunho não desenha mais um link: a action
 *    REDIRECIONA para a página do rascunho (ajuste da fatia 2);
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CATRACA DE TEXTO, E NÃO SÓ DE FUNÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A divergência que originou a fatia era de TELA: a função de domínio sempre
 *  esteve certa, e a tela dizia outra coisa. Um teste de valor sobre a função não
 *  pegaria a lista escrita à mão de volta na página — a catraca de fonte pega (a
 *  mesma forma das catracas da FASE 60/73). Comentários são removidos antes da
 *  leitura: citar a frase numa explicação não é escrevê-la na tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateSubmissionReadiness,
  MIN_ABSTRACT_LENGTH,
  SUBMISSION_DRAFT_ARRIVAL_NOTICE,
  submissionArtifactRequirements,
  type SubmissionReadinessInput,
} from '../../src/domain/review/submission-rules';

const PAGINA_DA_CHAMADA =
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx';
const PAGINA_DA_SUBMISSAO = 'src/app/t/[tenantSlug]/(app)/submissoes/[submissionId]/page.tsx';
const FORMULARIO = 'src/components/proposals/proposal-form.tsx';
const ACTION = 'src/app/actions/call-actions.ts';
const SERVICO_DA_PROPOSTA = 'src/lib/proposals/proposal-service.ts';
const DOMINIO = 'src/domain/review/submission-rules.ts';

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fonte(caminho: string): string {
  return semComentarios(readFileSync(join(process.cwd(), caminho), 'utf8'));
}

const RESUMO = 'R'.repeat(MIN_ABSTRACT_LENGTH + 20);

/** O mínimo de uma submissão pronta, variando só o que o caso mede. */
function submissao(overrides: Partial<SubmissionReadinessInput>): SubmissionReadinessInput {
  return {
    title: 'Um título suficientemente longo para passar',
    abstract: RESUMO,
    keywords: ['uma', 'duas', 'três'],
    language: 'pt-BR',
    trackId: 'trilha-1',
    files: [],
    requiresBlindReview: true,
    authorCount: 1,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A frase que a página da chamada mostra
// ───────────────────────────────────────────────────────────────────────────────
describe('submissionArtifactRequirements() — o que a chamada pede', () => {
  it('chamada cega exige o PDF anonimizado e RECOMENDA o identificado', () => {
    for (const kind of ['PAPER', 'POSTER'] as const) {
      const exigencias = submissionArtifactRequirements({
        requiresBlindReview: true,
        proposalKind: kind,
      });

      expect(exigencias.map((row) => row.key), kind).toEqual(['BLIND_PDF', 'IDENTIFIED_PDF']);
      expect(exigencias[0]?.required, kind).toBe(true);
      expect(exigencias[0]?.label, kind).toContain('anonimizado');
      expect(exigencias[1]?.required, kind).toBe(false);
      expect(exigencias[1]?.label, kind).toContain('identificação dos autores');
      expect(exigencias[1]?.label, kind).toContain('publicação');
    }
  });

  it('a cegueira é da CHAMADA: um minicurso numa chamada cega também exige o anonimizado', () => {
    /**
     * A exigência nasce do `requiresBlindReview`, não do tipo (é a régua que decide
     * assim desde a FASE 33). A tela precisa dizer o MESMO — senão anuncia uma
     * chamada aberta que o servidor trata como cega.
     */
    const exigencias = submissionArtifactRequirements({
      requiresBlindReview: true,
      proposalKind: 'MINICOURSE',
    });

    expect(exigencias[0]?.key).toBe('BLIND_PDF');
    expect(exigencias[0]?.required).toBe(true);
  });

  it('chamada científica NÃO cega exige o PDF do trabalho (qualquer versão)', () => {
    const exigencias = submissionArtifactRequirements({
      requiresBlindReview: false,
      proposalKind: 'PAPER',
    });

    expect(exigencias.map((row) => row.key)).toEqual(['ANY_PDF']);
    expect(exigencias[0]?.required).toBe(true);
    expect(exigencias[0]?.label).toContain('PDF');
  });

  it('proposta de programação (não científica e não cega) não tem exigência de arquivo', () => {
    for (const kind of ['SPEAKER', 'MINICOURSE', 'WORKSHOP', 'ROUNDTABLE', 'OTHER'] as const) {
      expect(
        submissionArtifactRequirements({ requiresBlindReview: false, proposalKind: kind }),
        kind,
      ).toEqual([]);
    }
  });

  it('submissão sem chamada (fases anteriores) segue a régua científica', () => {
    expect(
      submissionArtifactRequirements({ requiresBlindReview: false, proposalKind: null }).map(
        (row) => row.key,
      ),
    ).toEqual(['ANY_PDF']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A coincidência entre o anúncio e a recusa
// ───────────────────────────────────────────────────────────────────────────────
describe('o anúncio da chamada e a recusa do serviço saem do mesmo lugar', () => {
  it('cada exigência obrigatória sem arquivo vira o bloqueio com a MESMA frase', () => {
    const cenarios = [
      { requiresBlindReview: true, proposalKind: 'PAPER' as const, trackId: 'trilha-1' },
      { requiresBlindReview: true, proposalKind: 'POSTER' as const, trackId: null },
      { requiresBlindReview: false, proposalKind: 'PAPER' as const, trackId: 'trilha-1' },
      { requiresBlindReview: false, proposalKind: null, trackId: 'trilha-1' },
    ];

    for (const cenario of cenarios) {
      const exigencias = submissionArtifactRequirements(cenario);
      const readiness = evaluateSubmissionReadiness(submissao(cenario));

      const obrigatorias = exigencias.filter((row) => row.required);

      /** A frase que a TELA mostra é o `label`; a recusa é o `refusal` do mesmo item. */
      expect(obrigatorias.length, JSON.stringify(cenario)).toBeGreaterThan(0);

      for (const exigencia of obrigatorias) {
        expect(typeof exigencia.refusal, exigencia.label).toBe('string');
        expect(readiness.blockers, exigencia.label).toEqual(
          expect.arrayContaining([exigencia.refusal]),
        );
      }

      /** E o que é recomendação nunca vira bloqueio. */
      for (const recomendacao of exigencias.filter((row) => !row.required)) {
        expect(readiness.warnings, recomendacao.label).toContain(recomendacao.notice);
        expect(readiness.blockers, recomendacao.label).not.toContain(recomendacao.notice);
      }
    }
  });

  it('com o arquivo anexado, a exigência correspondente some dos dois lados', () => {
    const exigencias = submissionArtifactRequirements({
      requiresBlindReview: true,
      proposalKind: 'PAPER',
    });

    const readiness = evaluateSubmissionReadiness(
      submissao({
        files: [{ kind: 'BLIND_PDF', checksum: 'a'.repeat(64) }],
      }),
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).not.toContain(exigencias[0]?.refusal);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Catracas de fonte — a frase e a lista não podem voltar a ser escritas à mão
// ───────────────────────────────────────────────────────────────────────────────
describe('as telas leem o domínio, não a própria opinião', () => {
  it('a página da chamada anuncia as exigências do domínio e não escreve a frase', () => {
    const pagina = fonte(PAGINA_DA_CHAMADA);

    expect(pagina).toContain('submissionArtifactRequirements');
    expect(pagina).toContain('requirement.label');

    /**
     * "anonimizado" não pode aparecer na PÁGINA: se alguém escrever a frase ali,
     * ela deixa de acompanhar a régua (a divergência que esta fatia conserta).
     */
    expect(pagina).not.toContain('anonimizado');
    expect(pagina).not.toContain('revisão cega: anexe');
  });

  it('a página da submissão usa a MESMA régua do serviço e não escreve bloqueios à mão', () => {
    const pagina = fonte(PAGINA_DA_SUBMISSAO);

    expect(pagina).toContain('evaluateSubmissionReadiness');
    expect(pagina).toContain('loadSubmissionPageAccess');

    /**
     * As três frases que a tela escrevia por conta própria (e a trilha que ela
     * esquecia) não podem voltar: a lista agora é `readiness.blockers`.
     */
    expect(pagina).not.toContain('Anexe a versão cega');
    expect(pagina).not.toContain('Informe ao menos um autor.');
    expect(pagina).not.toContain('Anexe o arquivo do trabalho em PDF.');
    expect(pagina).toContain('readiness.blockers');
  });

  it('a régua e o anúncio vivem no mesmo módulo de domínio', () => {
    const dominio = fonte(DOMINIO);

    expect(dominio).toContain('export function submissionArtifactRequirements');
    expect(dominio).toContain('export function evaluateSubmissionReadiness');

    /**
     * A régua precisa CONSUMIR a lista (não repetir as condições): sem esta linha,
     * acrescentar uma exigência ao anúncio não a faria ser cobrada no envio.
     */
    expect(dominio).toContain('submissionArtifactRequirements({');
  });

  it('a recusa com rascunho NÃO desenha um caminho: a action redireciona', () => {
    const formulario = fonte(FORMULARIO);

    /**
     * A fatia 2 mostrava "Continuar na área do autor" na caixa de erro. O ajuste
     * tirou o passo intermediário: a action redireciona para o rascunho antes de
     * existir estado de erro. Se o link voltar, existem DUAS verdades sobre o mesmo
     * gesto — e uma tela a mais para manter.
     */
    expect(formulario).not.toContain('Continuar na área do autor');
    expect(formulario).not.toContain('proposal-draft-link');
    expect(formulario).not.toContain('state.submissionId');

    /** A recusa SEM rascunho (o teto) continua com o caminho dela. */
    expect(formulario).toContain('proposal-draft-ceiling-link');
  });

  it('a action redireciona a recusa que TEM rascunho, e só ela', () => {
    const action = fonte(ACTION);

    expect(action).toContain(`result.code === 'NOT_READY'`);
    expect(action).toContain('result.submissionId');
    expect(action).toContain('redirect(');
    expect(action).toContain('?rascunho=1');
    expect(action).toContain(`/submissoes/\${result.submissionId}?rascunho=1`);

    /** `/minhas-submissoes` nunca existiu — o link do sucesso apontava para o vazio. */
    expect(action).not.toContain('/minhas-submissoes');
  });

  it('o aviso de chegada é uma frase só, e a página usa a do DOMÍNIO', () => {
    /**
     * A frase é contrato: o E2E a lê no HTML e este teste a prende ao símbolo. Se
     * alguém reescrever a versão da tela, a página continua importando o símbolo —
     * mas o texto deixa de ser um só, e é isso que a asserção de ausência pega.
     */
    expect(SUBMISSION_DRAFT_ARRIVAL_NOTICE).toBe(
      'Seu rascunho foi salvo. Anexe o arquivo e envie para avaliação.',
    );

    const pagina = fonte(PAGINA_DA_SUBMISSAO);

    expect(pagina).toContain('SUBMISSION_DRAFT_ARRIVAL_NOTICE');
    expect(pagina).toContain('data-testid="draft-arrival-notice"');
    expect(pagina).toContain(`rascunho === '1'`);
    expect(pagina).not.toContain('Seu rascunho foi salvo');
  });

  it('o serviço devolve o rascunho SÓ na recusa de prontidão e reaproveita o existente', () => {
    const servico = fonte(SERVICO_DA_PROPOSTA);

    expect(servico).toContain('findReusableDraft');
    expect(servico).toContain(`refusal.code === 'NOT_READY'`);
    expect(servico).toContain('...refusal, submissionId');
  });
});
