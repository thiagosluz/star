/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — O RANKING DE REVISORES NÃO CITA QUEM A OCULTAÇÃO ESCONDE
 *  (FASE 69 · dívida E82)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM, E POR QUE CADA UM IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • SEM ocultação o nome sai INTEIRO, e COM ocultação ele sai abreviado pela
 *      fonte única do produto — a régua é da PESSOA, e não um blecaute da lista;
 *    • a pessoa ocultada CONTINUA no ranking, na MESMA posição e com a MESMA
 *      contagem, e continua ELEGÍVEL à premiação (a carta é concedida pelo `id`):
 *      esconder o nome não é apagar a pessoa do ranking;
 *    • a fonte única é fail-closed: sem a coluna da ocultação (`undefined`) a
 *      resposta é "abreviado", e não "publica o nome";
 *    • o `id` do revisor é o que o ranking ordena e o que a premiação usa — a
 *      máscara troca só o texto, nunca quem ocupa cada posição.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O `withTenant` É DUBLADO AQUI, E O QUE ISSO NÃO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O defeito da E82 é de LEITURA: o serviço lia `reviewer.name` sem passar pela
 *  régua da ocultação. Este arquivo chama o SERVIÇO de verdade (`getReviewerRanking`)
 *  com o `select` alimentado por linhas de `Review`, para que a decisão seja provada
 *  sem banco e sem espera — é a mesma decisão que a tela
 *  `/administracao/eventos/<id>/reconhecimento` consome.
 *
 *  O que ele NÃO prova, e por isso existe o arquivo de integração irmão: que a
 *  COLUNA sai do banco (a decisão real da moderação atravessando
 *  `decideReport`) — isso está em
 *  `tests/integration/f69-e82-ranking-de-revisores.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getReviewerRanking } from '../../src/lib/gamification/achievement-service';

/** A data da decisão de moderação: o conteúdo é irrelevante, o FATO é o que conta. */
const OCULTADA_EM = new Date('2026-05-04T12:00:00Z');

const TENANT_ID = 'tenant-do-ranking-de-revisores';
const EVENT_ID = 'evento-do-ranking-de-revisores';

/**
 * Uma linha de `Review` como o `select` do serviço a devolve.
 *
 * `reviewer` é nulável DE PROPÓSITO no tipo do teste: a FK é obrigatória no banco, e
 * o `null` existe aqui só para exercitar a defesa de runtime do serviço.
 */
interface ReviewRow {
  reviewerId: string;
  reviewer: { name: string; publicProfileHiddenAt: Date | null } | null;
}

let mockReviews: ReviewRow[] = [];

/**
 * O dublê devolve as MESMAS duas leituras que o serviço faz (`review` e
 * `cardTemplate`); nenhuma carta de gatilho entra, então o piso é o padrão
 * (`MIN_REVIEWS_FOR_TOP`).
 */
vi.mock('../../src/lib/db/tenant-client', () => ({
  withTenant: async (
    _tenantId: string,
    run: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> =>
    run({
      review: { findMany: async () => mockReviews },
      cardTemplate: { findMany: async () => [] },
    }),
}));

/** Três pareceres da Ana (o piso do reconhecimento) e um do Bruno. */
function cenario(person: ReviewRow['reviewer']): ReviewRow[] {
  return [
    { reviewerId: 'ana', reviewer: person },
    { reviewerId: 'ana', reviewer: person },
    { reviewerId: 'ana', reviewer: person },
    { reviewerId: 'bruno', reviewer: { name: 'Bruno Lima', publicProfileHiddenAt: null } },
  ];
}

beforeEach(() => {
  mockReviews = [];
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 69 · E82 — o ranking de revisores e a ocultação', () => {
  it('SEM ocultação, o nome sai INTEIRO (a régua é da pessoa, não da lista)', async () => {
    mockReviews = cenario({ name: 'Ana Souza', publicProfileHiddenAt: null });

    const ranking = await getReviewerRanking({ tenantId: TENANT_ID, eventId: EVENT_ID });

    expect(ranking.ok, ranking.ok ? 'ok' : ranking.message).toBe(true);
    if (!ranking.ok) return;

    expect(ranking.ranked).toEqual([
      { reviewerId: 'ana', reviewerName: 'Ana Souza', completedReviews: 3 },
      { reviewerId: 'bruno', reviewerName: 'Bruno Lima', completedReviews: 1 },
    ]);
    expect(ranking.awarded.map((row) => row.reviewerName)).toEqual(['Ana Souza']);
  });

  it('COM a pessoa oculta, o nome NÃO sai inteiro — e a posição e a contagem continuam', async () => {
    mockReviews = cenario({ name: 'Ana Souza', publicProfileHiddenAt: OCULTADA_EM });

    const ranking = await getReviewerRanking({ tenantId: TENANT_ID, eventId: EVENT_ID });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    /** A lista NÃO encolhe e o primeiro colocado continua sendo ela. */
    expect(ranking.ranked).toHaveLength(2);
    expect(ranking.ranked[0]).toEqual({
      reviewerId: 'ana',
      reviewerName: 'Ana S.',
      completedReviews: 3,
    });
    expect(ranking.ranked[1]).toEqual({
      reviewerId: 'bruno',
      reviewerName: 'Bruno Lima',
      completedReviews: 1,
    });
    expect(ranking.topCount).toBe(3);

    /**
     * A checagem é sobre o JSON inteiro: o nome do cadastro não pode sobreviver em
     * nenhum campo da resposta — nem por um detalhe que a tela não mostra.
     */
    const serialized = JSON.stringify(ranking);

    expect(serialized).not.toContain('Ana Souza');
    expect(serialized).toContain('Ana S.');
  });

  it('quem está oculto continua ELEGÍVEL: a premiação escolhe pelo `id`, não pelo nome', async () => {
    mockReviews = cenario({ name: 'Ana Souza', publicProfileHiddenAt: OCULTADA_EM });

    const ranking = await getReviewerRanking({ tenantId: TENANT_ID, eventId: EVENT_ID });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    /**
     * O Bruno fica fora pelo piso (um parecer): a máscara não muda QUEM é premiado —
     * o painel de premiação é o outro lugar em que a E82 citava a pessoa, e ele lê
     * esta mesma lista.
     */
    expect(ranking.awarded.map((row) => row.reviewerId)).toEqual(['ana']);
    expect(ranking.awarded[0]!.reviewerName).toBe('Ana S.');
    expect(ranking.awarded[0]!.completedReviews).toBe(3);
  });

  it('sem a coluna da ocultação (`undefined`), a pessoa é ABREVIADA (fail-closed)', async () => {
    /**
     * O caso do `select` que esquece a coluna: o tipo já reprova no `tsc`, e este é o
     * cinto para o que escapar do tipo. A resposta errada aqui publicaria o nome de
     * quem a moderação tirou do ar.
     */
    mockReviews = cenario({
      name: 'Ana Souza',
    } as unknown as ReviewRow['reviewer']);

    const ranking = await getReviewerRanking({ tenantId: TENANT_ID, eventId: EVENT_ID });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    expect(ranking.ranked[0]!.reviewerName).toBe('Ana S.');
    expect(JSON.stringify(ranking)).not.toContain('Ana Souza');
  });

  it('sem pessoa na linha (defesa de runtime), vale o rótulo neutro que a tela já usava', async () => {
    mockReviews = [{ reviewerId: 'fantasma', reviewer: null }];

    const ranking = await getReviewerRanking({ tenantId: TENANT_ID, eventId: EVENT_ID });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    /** Sem pessoa não há identidade a mascarar — e o rótulo não é nome de ninguém. */
    expect(ranking.ranked).toEqual([
      { reviewerId: 'fantasma', reviewerName: 'Revisor', completedReviews: 1 },
    ]);
  });
});
