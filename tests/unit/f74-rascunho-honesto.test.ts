/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O RASCUNHO HONESTO (FASE 74 · fatias 3 e 6)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, SEM BANCO E SEM TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a classificação de TODA situação do enum: recebida, trabalho em andamento ou
 *    não enviada — o `Record<SubmissionStatus, …>` reprova no `tsc` se o enum ganhar
 *    uma situação que ninguém classificou (é a catraca de esquecimento);
 *  • rascunho com arquivo é EM_ANDAMENTO e rascunho vazio é NAO_RECEBIDA — as duas
 *    leituras que a tela precisa distinguir para não mentir;
 *  • retirada, cancelada e recusada SÃO recebidas: foram enviadas, e a fatia 6
 *    devolveu as três à fila do organizador;
 *  • `isReceivedProposal` e `proposalReceipt` concordam em todas as situações (uma
 *    régua, não duas);
 *  • a lista de exclusão do banco é EXATAMENTE o complemento de "recebida" — se
 *    alguém acrescentar uma situação a uma e esquecer a outra, este teste reprova;
 *  • a linha da lista mostra o RÓTULO do domínio, não o status cru do banco (a
 *    catraca de fonte da tela);
 *  • a frase do selo: zero é resposta, um é singular, dois é plural.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NOT_SENT_SUBMISSION_STATUSES,
  inProgressDraftsLabel,
  isReceivedProposal,
  proposalReceipt,
  receivedProposalsLabel,
  type ProposalReceipt,
} from '../../src/domain/proposals/proposal-receipt-rules';
import type { SubmissionStatus } from '../../src/domain/review/submission-rules';

/**
 * A classificação esperada por situação, para 0 e 1 arquivo.
 *
 * O tipo `Record<SubmissionStatus, …>` é a catraca: uma situação nova no domínio
 * quebra o `tsc` aqui até alguém decidir o que ela é. É de propósito que a decisão
 * não possa ser tomada por omissão.
 */
const ESPERADO: Record<SubmissionStatus, readonly [ProposalReceipt, ProposalReceipt]> = {
  DRAFT: ['NAO_RECEBIDA', 'EM_ANDAMENTO'],
  SUBMITTED: ['RECEBIDA', 'RECEBIDA'],
  UNDER_REVIEW: ['RECEBIDA', 'RECEBIDA'],
  REVISION_REQUESTED: ['RECEBIDA', 'RECEBIDA'],
  ACCEPTED: ['RECEBIDA', 'RECEBIDA'],
  REJECTED: ['RECEBIDA', 'RECEBIDA'],
  WITHDRAWN: ['RECEBIDA', 'RECEBIDA'],
  CANCELED: ['RECEBIDA', 'RECEBIDA'],
};

const TODAS = Object.keys(ESPERADO) as SubmissionStatus[];

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('o que conta como proposta recebida', () => {
  it('classifica cada situação do enum — e o arquivo só muda a resposta do rascunho', () => {
    for (const status of TODAS) {
      expect(proposalReceipt({ status, fileCount: 0 }), `${status} sem arquivo`).toBe(
        ESPERADO[status][0],
      );
      expect(proposalReceipt({ status, fileCount: 1 }), `${status} com arquivo`).toBe(
        ESPERADO[status][1],
      );
    }
  });

  it('rascunho vazio NÃO é recebida nem trabalho em andamento', () => {
    expect(proposalReceipt({ status: 'DRAFT', fileCount: 0 })).toBe('NAO_RECEBIDA');
  });

  it('rascunho COM arquivo é trabalho em andamento — e continua NÃO sendo recebida', () => {
    expect(proposalReceipt({ status: 'DRAFT', fileCount: 1 })).toBe('EM_ANDAMENTO');
    expect(isReceivedProposal('DRAFT')).toBe(false);
  });

  it('a proposta enviada é recebida com ou sem arquivo', () => {
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED'] as const) {
      expect(proposalReceipt({ status, fileCount: 0 })).toBe('RECEBIDA');
      expect(proposalReceipt({ status, fileCount: 3 })).toBe('RECEBIDA');
    }
  });

  it('retirada, cancelada e recusada são RECEBIDAS — o desfecho veio depois do envio', () => {
    for (const status of ['WITHDRAWN', 'CANCELED', 'REJECTED'] as const) {
      expect(proposalReceipt({ status, fileCount: 1 }), status).toBe('RECEBIDA');
      expect(isReceivedProposal(status), status).toBe(true);
    }
  });

  it('`isReceivedProposal` e `proposalReceipt` concordam em TODAS as situações', () => {
    for (const status of TODAS) {
      for (const fileCount of [0, 1]) {
        expect(proposalReceipt({ status, fileCount }) === 'RECEBIDA').toBe(
          isReceivedProposal(status),
        );
      }
    }
  });

  it('a lista de exclusão do banco é exatamente o complemento de "recebida"', () => {
    const naoRecebidas = TODAS.filter((status) => !isReceivedProposal(status));

    /** Comparação por CONJUNTO: a ordem da lista é documental, não contrato. */
    expect([...NOT_SENT_SUBMISSION_STATUSES].sort()).toEqual([...naoRecebidas].sort());

    /**
     * A régua renomeada (fatia 6) diz o que quer dizer: o que NÃO foi enviado é o
     * rascunho, e só ele. Se alguém reacrescentar uma situação encerrada aqui, o
     * organizador volta a perder a linha — e o teste reprova.
     */
    expect([...NOT_SENT_SUBMISSION_STATUSES]).toEqual(['DRAFT']);
  });
});

describe('a linha da lista mostra o rótulo, não o código do banco (fatia 6)', () => {
  it('a página de chamadas usa `proposal.statusLabel` — e não `proposal.status`', () => {
    const pagina = semComentarios(
      readFileSync(
        join(
          process.cwd(),
          'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx',
        ),
        'utf8',
      ),
    );

    expect(pagina).toContain('proposal.statusLabel');
    expect(pagina).not.toMatch(/\bproposal\.status\b/);
  });
});

describe('a frase do selo (a régua da F54)', () => {
  it('zero é RESPOSTA, e não ausência de dado', () => {
    expect(receivedProposalsLabel(0)).toBe('nenhuma proposta recebida');
    expect(inProgressDraftsLabel(0)).toBe('nenhum rascunho em andamento');
  });

  it('um é singular e dois é plural — em português', () => {
    expect(receivedProposalsLabel(1)).toBe('1 proposta recebida');
    expect(receivedProposalsLabel(2)).toBe('2 propostas recebidas');
    expect(inProgressDraftsLabel(1)).toBe('1 rascunho em andamento');
    expect(inProgressDraftsLabel(3)).toBe('3 rascunhos em andamento');
  });

  it('recebidas e em andamento são frases DIFERENTES — não dá para confundir os dois fatos', () => {
    expect(receivedProposalsLabel(1)).not.toBe(inProgressDraftsLabel(1));
  });
});
