/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — rodadas de apuração (FASE 30)
 *
 *  O que só o domínio puro pode provar:
 *    • as guardas de ORDEM (uma rodada preparada por vez; rodada apurada não se
 *      apura de novo) — é o que impede dois compromissos no ar ao mesmo tempo;
 *    • a numeração das rodadas e o que a tela chama de "a seguir" e "a anterior";
 *    • o prêmio é ANÚNCIO: normalizado, truncado e FORA do documento assinado —
 *      corrigir o texto do prêmio não pode invalidar um resultado publicado;
 *    • o payload versão 4 declara a RODADA, e as versões 1 a 3 continuam
 *      verificáveis cada uma no seu formato;
 *    • quem ganhou uma rodada não volta na seguinte, com o motivo certo na tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_PRIZE_DESCRIPTION,
  MAX_PRIZE_TITLE,
  canDrawRound,
  canPrepareRound,
  describeRound,
  lastDrawnRound,
  nextRoundNumber,
  normalizePrizeDescription,
  normalizePrizeTitle,
  pendingRound,
  prizeLabel,
  roundStateOf,
  type RoundRef,
} from '../../src/domain/raffles/round-rules';
import {
  RESULT_PAYLOAD_VERSION,
  buildResultPayload,
  evaluateEligibility,
  hashResult,
  verifyResult,
  type RaffleResultPayload,
} from '../../src/domain/raffles/raffle-rules';

const drawn = (roundNumber: number): RoundRef => ({ roundNumber, drawnAt: new Date('2026-09-21T18:00:00Z') });
const prepared = (roundNumber: number): RoundRef => ({ roundNumber, drawnAt: null });

describe('estado e numeração das rodadas', () => {
  it('uma rodada com data de apuração está APURADA; sem data, PREPARADA', () => {
    expect(roundStateOf(drawn(1))).toBe('DRAWN');
    expect(roundStateOf(prepared(2))).toBe('PREPARED');
  });

  it('a próxima rodada é a maior existente + 1 (e a 1 quando não há nenhuma)', () => {
    expect(nextRoundNumber([])).toBe(1);
    expect(nextRoundNumber([drawn(1)])).toBe(2);
    expect(nextRoundNumber([drawn(1), drawn(2), prepared(3)])).toBe(4);
  });

  it('a rodada pendente é a preparada — e a última apurada é a de MAIOR número', () => {
    const rounds = [drawn(1), prepared(2), drawn(3)];

    expect(pendingRound(rounds)?.roundNumber).toBe(2);
    expect(lastDrawnRound(rounds)?.roundNumber).toBe(3);
    expect(pendingRound([drawn(1), drawn(2)])).toBeNull();
    expect(lastDrawnRound([prepared(1)])).toBeNull();
  });

  it('a última apurada é a de maior número, e não a última do array', () => {
    // A ordem do array não é contrato: quem decide é o número da rodada.
    expect(lastDrawnRound([drawn(3), drawn(1), drawn(2)])?.roundNumber).toBe(3);
  });
});

describe('guardas de preparação e apuração', () => {
  it('recusa preparar rodada em sorteio cancelado', () => {
    const decision = canPrepareRound({ raffleStatus: 'CANCELED', rounds: [drawn(1)] });

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.code).toBe('RAFFLE_CANCELED');
  });

  it('recusa preparar uma segunda rodada enquanto a primeira não foi apurada', () => {
    const decision = canPrepareRound({ raffleStatus: 'DRAWN', rounds: [drawn(1), prepared(2)] });

    expect(decision.ok).toBe(false);
    // A mensagem diz QUAL rodada apurar: "já existe uma preparada" não ajuda no palco.
    expect(decision.ok ? '' : decision.message).toContain('rodada 2');
  });

  it('libera a próxima rodada depois de apurada a anterior', () => {
    const decision = canPrepareRound({ raffleStatus: 'DRAWN', rounds: [drawn(1), drawn(2)] });

    expect(decision).toEqual({ ok: true, roundNumber: 3 });
  });

  it('recusa apurar sem rodada preparada, com o próximo passo na mensagem', () => {
    const decision = canDrawRound({ raffleStatus: 'DRAWN', round: null });

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.code).toBe('NO_ROUND');
  });

  it('recusa apurar uma rodada já apurada (o resultado publicado não muda)', () => {
    const decision = canDrawRound({ raffleStatus: 'DRAWN', round: drawn(1) });

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.code).toBe('ROUND_DRAWN');
  });

  it('recusa apurar em sorteio cancelado', () => {
    const decision = canDrawRound({ raffleStatus: 'CANCELED', round: prepared(2) });

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.code).toBe('RAFFLE_CANCELED');
  });

  it('libera a apuração da rodada preparada', () => {
    expect(canDrawRound({ raffleStatus: 'DRAFT', round: prepared(1) })).toEqual({ ok: true });
  });
});

describe('o prêmio é anúncio, não entrada do sorteio', () => {
  it('descreve a rodada com o prêmio quando ele existe', () => {
    expect(describeRound({ roundNumber: 2, prizeTitle: 'Fone bluetooth' })).toBe(
      'Rodada 2 — Fone bluetooth',
    );
    expect(describeRound({ roundNumber: 2, prizeTitle: '   ' })).toBe('Rodada 2');
  });

  it('sem prêmio informado, o rótulo é "Prêmio surpresa" (e nunca vazio)', () => {
    expect(prizeLabel(null)).toBe('Prêmio surpresa');
    expect(prizeLabel('  ')).toBe('Prêmio surpresa');
    expect(prizeLabel('Caneca')).toBe('Caneca');
  });

  it('normaliza o título: espaço em branco vira nulo e o teto é aplicado', () => {
    expect(normalizePrizeTitle('  ')).toBeNull();
    expect(normalizePrizeTitle(undefined)).toBeNull();
    expect(normalizePrizeTitle('  Caneca  ')).toBe('Caneca');
    expect(normalizePrizeTitle('x'.repeat(MAX_PRIZE_TITLE + 50))).toHaveLength(MAX_PRIZE_TITLE);
  });

  it('normaliza a descrição com o próprio teto', () => {
    expect(normalizePrizeDescription(null)).toBeNull();
    expect(normalizePrizeDescription('  Uma unidade  ')).toBe('Uma unidade');
    expect(normalizePrizeDescription('y'.repeat(MAX_PRIZE_DESCRIPTION + 10))).toHaveLength(
      MAX_PRIZE_DESCRIPTION,
    );
  });
});

const BASE_PAYLOAD: RaffleResultPayload = {
  validationVersion: 4,
  raffleId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  roundNumber: 1,
  scope: 'EVENT',
  activityId: null,
  referenceDate: null,
  minAttendanceMinutes: 0,
  winnersCount: 1,
  allowPriorEventWinners: false,
  alternatesCount: 0,
  weightByMinutes: false,
  poolHash: 'a'.repeat(64),
  poolCount: 3,
  eligibleCount: 3,
  drawnAt: '2026-09-21T18:00:00.000Z',
  winners: [{ position: 1, userId: 'user-1', minutes: 60, kind: 'WINNER' }],
};

describe('payload versão 4: o documento diz QUAL momento ele descreve', () => {
  it('a versão assinada é a 4, e o número da rodada entra no canônico', () => {
    expect(RESULT_PAYLOAD_VERSION).toBe(4);
    expect(buildResultPayload({ ...BASE_PAYLOAD, roundNumber: 2 })).toContain('"roundNumber":2');
  });

  it('a MESMA apuração em rodadas diferentes tem hashes diferentes', () => {
    const first = hashResult(buildResultPayload({ ...BASE_PAYLOAD, roundNumber: 1 }));
    const second = hashResult(buildResultPayload({ ...BASE_PAYLOAD, roundNumber: 2 }));

    // Sem isso, o resultado da rodada 2 no lugar da 1 conferiria perfeitamente — e a
    // auditoria diria "íntegro" sobre o momento errado.
    expect(first).not.toBe(second);
  });

  it('o PRÊMIO não entra no documento assinado (ADR-145)', () => {
    const payload = buildResultPayload(BASE_PAYLOAD);

    expect(payload).not.toContain('prize');
    expect(payload).not.toContain('sponsor');
  });

  it('a versão 4 se verifica pelo hash gravado, e falha se um vencedor mudar', () => {
    const payload = buildResultPayload(BASE_PAYLOAD);
    const stored = hashResult(payload);

    expect(verifyResult(BASE_PAYLOAD, stored)).toBe(true);
    expect(
      verifyResult(
        { ...BASE_PAYLOAD, winners: [{ position: 1, userId: 'user-2', minutes: 60, kind: 'WINNER' }] },
        stored,
      ),
    ).toBe(false);
  });

  it('as versões 1 a 3 continuam verificáveis, cada uma no seu formato', () => {
    for (const version of [1, 2, 3] as const) {
      const legacy: RaffleResultPayload = {
        ...BASE_PAYLOAD,
        validationVersion: version,
        roundNumber: undefined,
        alternatesCount: version === 1 ? undefined : 0,
        weightByMinutes: version === 1 ? undefined : false,
        poolHash: version === 3 ? 'a'.repeat(64) : undefined,
        poolCount: version === 3 ? 3 : undefined,
        winners: [{ position: 1, userId: 'user-1', minutes: 60 }],
      };

      expect(verifyResult(legacy, hashResult(buildResultPayload(legacy)))).toBe(true);
    }
  });

  it('a versão 3 (sem o número da rodada) NÃO confere com o payload v4', () => {
    const legacy: RaffleResultPayload = { ...BASE_PAYLOAD, validationVersion: 3 };

    expect(verifyResult(legacy, hashResult(buildResultPayload(BASE_PAYLOAD)))).toBe(false);
  });
});

describe('quem ganhou uma rodada não concorre na seguinte', () => {
  const config = {
    scope: 'EVENT' as const,
    referenceDate: null,
    activityId: null,
    minAttendanceMinutes: 0,
    winnersCount: 1,
    alternatesCount: 0,
    weightByMinutes: false,
    allowPriorEventWinners: true,
  };

  const attendances = [
    {
      attendanceId: 'a1',
      userId: 'user-1',
      userName: 'Ana Souza',
      activityId: null,
      status: 'PRESENT',
      checkedInAt: new Date('2026-09-21T12:00:00Z'),
      minutesAttended: 90,
    },
    {
      attendanceId: 'a2',
      userId: 'user-2',
      userName: 'Bruno Lima',
      activityId: null,
      status: 'PRESENT',
      checkedInAt: new Date('2026-09-21T12:00:00Z'),
      minutesAttended: 5,
    },
  ];

  it('o ganhador da rodada 1 sai da rodada 2, com o motivo certo', () => {
    const result = evaluateEligibility({
      config,
      timeZone: 'America/Bahia',
      attendances,
      sameRaffleWinnerIds: ['user-1'],
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['user-2']);
    expect(result.rejected).toEqual([
      { userId: 'user-1', userName: 'Ana Souza', reason: 'Já ganhou uma rodada anterior deste sorteio.' },
    ]);
  });

  it('o motivo da exclusão do sorteio vence a explicação de minutos', () => {
    /**
     * Quem ganhou a rodada 1 tem 90 min; quem sobrou tem 5 min. Com piso de 30 min, o
     * excluído por já ter ganhado não pode aparecer como "abaixo do piso" — seria uma
     * explicação errada sobre um fato correto (a ordem das checagens é contrato).
     */
    const result = evaluateEligibility({
      config: { ...config, minAttendanceMinutes: 30 },
      timeZone: 'America/Bahia',
      attendances,
      sameRaffleWinnerIds: ['user-1'],
    });

    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      'Já ganhou uma rodada anterior deste sorteio.',
      'Cumpriu 5 min, abaixo do piso de 30 min.',
    ]);
  });

  it('sem ganhadores anteriores, todos os elegíveis concorrem', () => {
    const result = evaluateEligibility({
      config,
      timeZone: 'America/Bahia',
      attendances,
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['user-1', 'user-2']);
    expect(result.rejected).toEqual([]);
  });
});
