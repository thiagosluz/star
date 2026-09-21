/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — palco e auditoria do sorteio (FASE 29)
 *
 *  O que só o domínio puro pode provar:
 *    • a lista publicada é um documento CANÔNICO (ordem de campos fixa, ordem das
 *      linhas significativa) e o hash muda quando ela muda;
 *    • o código público é estável, opaco e distinto por sorteio;
 *    • a reprodução devolve o mesmo resultado com a mesma semente, e o gerador do
 *      NAVEGADOR (WebCrypto) produz a MESMA sequência do servidor (node:crypto) —
 *      sem isso, a auditoria acusaria divergência num sorteio correto;
 *    • o payload v3 assina a lista, e as versões 1 e 2 continuam verificáveis.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalPool,
  compareDraw,
  findDuplicateCodes,
  poolEntryCode,
  poolHash,
  reproduceDraw,
  type RafflePoolEntry,
} from '../../src/domain/raffles/pool-rules';
import {
  reproduceFromPool,
  selectWinners,
} from '../../src/domain/raffles/draw-selection';
import { prepareWebRandomInt } from '../../src/domain/raffles/web-seeded-random';
import {
  RESULT_PAYLOAD_VERSION,
  buildResultPayload,
  createSeededRandomInt,
  hashResult,
  seedCommitment,
  verifyResult,
  type RaffleResultPayload,
} from '../../src/domain/raffles/raffle-rules';

const RAFFLE_ID = '11111111-1111-1111-1111-111111111111';

function pool(entries: [code: string, minutes: number][]): RafflePoolEntry[] {
  return entries.map(([code, minutes], index) => ({ index: index + 1, code, minutes }));
}

const SAMPLE = pool([
  ['P-AAAA00000001', 60],
  ['P-AAAA00000002', 30],
  ['P-AAAA00000003', 0],
  ['P-AAAA00000004', 45],
]);

describe('código público do participante na lista', () => {
  it('é estável, prefixado e derivado do par (sorteio, participante)', () => {
    const code = poolEntryCode(RAFFLE_ID, 'user-1');

    expect(code).toBe(poolEntryCode(RAFFLE_ID, 'user-1'));
    expect(code.startsWith('P-')).toBe(true);
    expect(code).toMatch(/^P-[0-9A-F]{12}$/);
  });

  it('não revela o identificador interno', () => {
    const code = poolEntryCode(RAFFLE_ID, 'user-1');

    expect(code.toLowerCase()).not.toContain('user');
    expect(code).not.toContain('user-1');
  });

  it('é distinto entre participantes e entre sorteios', () => {
    const a = poolEntryCode(RAFFLE_ID, 'user-1');
    const b = poolEntryCode(RAFFLE_ID, 'user-2');
    const outroSorteio = poolEntryCode('22222222-2222-2222-2222-222222222222', 'user-1');

    expect(a).not.toBe(b);
    expect(a).not.toBe(outroSorteio);
  });
});

describe('documento canônico e hash da lista', () => {
  it('serializa sempre na mesma ordem de campos', () => {
    expect(canonicalPool(SAMPLE)).toBe(
      '[{"index":1,"code":"P-AAAA00000001","minutes":60},{"index":2,"code":"P-AAAA00000002","minutes":30},{"index":3,"code":"P-AAAA00000003","minutes":0},{"index":4,"code":"P-AAAA00000004","minutes":45}]',
    );
  });

  it('a ORDEM das linhas faz parte do contrato: trocar duas muda o hash', () => {
    const trocado = pool([
      ['P-AAAA00000002', 30],
      ['P-AAAA00000001', 60],
      ['P-AAAA00000003', 0],
      ['P-AAAA00000004', 45],
    ]);

    expect(poolHash(trocado)).not.toBe(poolHash(SAMPLE));
  });

  it('os MINUTOS fazem parte do contrato: mudar um minuto muda o hash', () => {
    const adulterado = pool([
      ['P-AAAA00000001', 61],
      ['P-AAAA00000002', 30],
      ['P-AAAA00000003', 0],
      ['P-AAAA00000004', 45],
    ]);

    expect(poolHash(adulterado)).not.toBe(poolHash(SAMPLE));
  });

  it('é determinístico e devolve 64 caracteres hexadecimais', () => {
    expect(poolHash(SAMPLE)).toBe(poolHash(SAMPLE));
    expect(poolHash(SAMPLE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lista vazia tem hash próprio (não é o hash de "sem lista")', () => {
    expect(poolHash([])).toMatch(/^[0-9a-f]{64}$/);
    expect(poolHash([])).not.toBe(poolHash(SAMPLE));
  });

  it('acusa códigos repetidos', () => {
    const repetido = pool([
      ['P-REPETIDO0001', 10],
      ['P-REPETIDO0001', 20],
    ]);

    expect(findDuplicateCodes(repetido)).toEqual(['P-REPETIDO0001']);
    expect(findDuplicateCodes(SAMPLE)).toEqual([]);
  });
});

describe('reprodução do sorteio a partir da lista', () => {
  it('a mesma semente devolve sempre a mesma ordem', () => {
    const primeira = reproduceDraw({
      pool: SAMPLE,
      count: 2,
      weightByMinutes: false,
      seed: 'semente-publicada',
    });
    const segunda = reproduceDraw({
      pool: SAMPLE,
      count: 2,
      weightByMinutes: false,
      seed: 'semente-publicada',
    });

    expect(primeira.map((entry) => entry.code)).toEqual(segunda.map((entry) => entry.code));
  });

  it('sementes diferentes produzem ordens diferentes (não é sorteio viciado)', () => {
    const a = reproduceDraw({ pool: SAMPLE, count: 2, weightByMinutes: false, seed: 'um' });
    const b = reproduceDraw({ pool: SAMPLE, count: 2, weightByMinutes: false, seed: 'dois' });

    expect(a.map((entry) => entry.code)).not.toEqual(b.map((entry) => entry.code));
  });

  it('não repete participante e respeita o total de vagas', () => {
    const drawn = reproduceDraw({
      pool: SAMPLE,
      count: 3,
      weightByMinutes: true,
      seed: 'semente',
    });

    expect(drawn).toHaveLength(3);
    expect(new Set(drawn.map((entry) => entry.code)).size).toBe(3);
  });

  it('pedir mais vagas do que a lista entrega o que existe', () => {
    const drawn = reproduceDraw({
      pool: SAMPLE,
      count: 99,
      weightByMinutes: false,
      seed: 'semente',
    });

    expect(drawn).toHaveLength(SAMPLE.length);
  });

  it('a reprodução usa a MESMA seleção do domínio (nenhuma cópia da regra)', () => {
    const expected = selectWinners(
      SAMPLE.map((entry) => ({
        userId: entry.code,
        userName: entry.code,
        minutes: entry.minutes,
        attendanceIds: [],
        referenceAttendanceId: null,
      })),
      2,
      createSeededRandomInt('semente-publicada'),
    ).map((participant) => participant.userId);

    const reproduced = reproduceFromPool({
      pool: SAMPLE,
      count: 2,
      weightByMinutes: false,
      randomInt: createSeededRandomInt('semente-publicada'),
    }).map((entry) => entry.code);

    expect(reproduced).toEqual(expected);
  });
});

describe('gerador do navegador == gerador do servidor', () => {
  it('produz a MESMA sequência para a mesma semente e o mesmo teto', async () => {
    const seed = 'semente-de-auditoria';
    const server = createSeededRandomInt(seed);
    const browser = await prepareWebRandomInt(seed, 64);

    const fromServer = Array.from({ length: 40 }, () => server(1_000));
    const fromBrowser = Array.from({ length: 40 }, () => browser(1_000));

    expect(fromBrowser).toEqual(fromServer);
  });

  it('reproduz o sorteio inteiro no navegador com o mesmo resultado do servidor', async () => {
    const browser = await prepareWebRandomInt('semente-publicada', 128);

    const noServidor = reproduceDraw({
      pool: SAMPLE,
      count: 3,
      weightByMinutes: true,
      seed: 'semente-publicada',
    }).map((entry) => entry.code);

    const noNavegador = reproduceFromPool({
      pool: SAMPLE,
      count: 3,
      weightByMinutes: true,
      randomInt: browser,
    }).map((entry) => entry.code);

    expect(noNavegador).toEqual(noServidor);
  });

  it('recusa quando o orçamento de blocos acaba, em vez de repetir valores', async () => {
    const browser = await prepareWebRandomInt('semente-curta', 2);

    browser(10);
    browser(10);

    expect(() => browser(10)).toThrow(/Blocos insuficientes/);
  });
});

describe('comparação posição a posição', () => {
  it('confirma quando todas as posições batem', () => {
    const comparison = compareDraw({
      stored: [
        { position: 1, code: 'P-A' },
        { position: 2, code: 'P-B' },
      ],
      reproduced: [
        { position: 1, code: 'P-A' },
        { position: 2, code: 'P-B' },
      ],
    });

    expect(comparison.confirmed).toBe(true);
    expect(comparison.matched).toBe(2);
    expect(comparison.diverged).toBe(0);
  });

  it('aponta QUAL posição divergiu, e não só que houve divergência', () => {
    const comparison = compareDraw({
      stored: [
        { position: 1, code: 'P-A' },
        { position: 2, code: 'P-B' },
        { position: 3, code: 'P-C' },
      ],
      reproduced: [
        { position: 1, code: 'P-A' },
        { position: 2, code: 'P-X' },
        { position: 3, code: 'P-Y' },
      ],
    });

    expect(comparison.confirmed).toBe(false);
    expect(comparison.matched).toBe(1);
    expect(comparison.diverged).toBe(2);
    expect(comparison.positions[1]).toMatchObject({
      position: 2,
      reason: 'DIFFERENT_CODE',
      expectedCode: 'P-B',
      reproducedCode: 'P-X',
    });
  });

  it('trata posição faltando dos dois lados', () => {
    const comparison = compareDraw({
      stored: [{ position: 1, code: 'P-A' }],
      reproduced: [
        { position: 1, code: 'P-A' },
        { position: 2, code: 'P-B' },
      ],
    });

    expect(comparison.positions[1]?.reason).toBe('MISSING_STORED');

    const inverso = compareDraw({
      stored: [
        { position: 1, code: 'P-A' },
        { position: 2, code: 'P-B' },
      ],
      reproduced: [{ position: 1, code: 'P-A' }],
    });

    expect(inverso.positions[1]?.reason).toBe('MISSING_REPRODUCED');
  });

  it('lista vazia não é "confirmado" (não há nada conferido)', () => {
    expect(compareDraw({ stored: [], reproduced: [] }).confirmed).toBe(false);
  });
});

describe('payload do resultado — a versão corrente assina a lista e a rodada', () => {
  const base: RaffleResultPayload = {
    validationVersion: RESULT_PAYLOAD_VERSION,
    raffleId: RAFFLE_ID,
    tenantId: '33333333-3333-3333-3333-333333333333',
    eventId: '44444444-4444-4444-4444-444444444444',
    roundNumber: 1,
    scope: 'EVENT',
    activityId: null,
    referenceDate: null,
    minAttendanceMinutes: 0,
    winnersCount: 1,
    allowPriorEventWinners: false,
    alternatesCount: 1,
    weightByMinutes: true,
    poolHash: poolHash(SAMPLE),
    poolCount: SAMPLE.length,
    eligibleCount: SAMPLE.length,
    drawnAt: '2026-09-19T18:00:00.000Z',
    winners: [
      { position: 1, userId: 'user-1', minutes: 60, kind: 'WINNER' },
      { position: 2, userId: 'user-2', minutes: 30, kind: 'ALTERNATE' },
    ],
  };

  it('a versão corrente é a 4 (com o número da rodada)', () => {
    expect(RESULT_PAYLOAD_VERSION).toBe(4);
  });

  it('assina a LISTA: mudar o hash da lista muda o hash do resultado', () => {
    const original = hashResult(buildResultPayload(base));

    const adulterado = hashResult(
      buildResultPayload({ ...base, poolHash: poolHash([...SAMPLE].reverse()) }),
    );

    expect(adulterado).not.toBe(original);
  });

  it('reconstrói o payload na versão CERTA e confere o hash gravado', () => {
    const payload = buildResultPayload(base);

    expect(verifyResult(base, hashResult(payload))).toBe(true);
    expect(verifyResult(base, 'a'.repeat(64))).toBe(false);
  });

  it('mantém as versões 1 a 3 verificáveis, cada uma com o seu documento', () => {
    const v1 = buildResultPayload({ ...base, validationVersion: 1, roundNumber: undefined });
    const v2 = buildResultPayload({ ...base, validationVersion: 2, roundNumber: undefined });
    const v3 = buildResultPayload({ ...base, validationVersion: 3, roundNumber: undefined });
    const v4 = buildResultPayload(base);

    expect(v1).not.toBe(v2);
    expect(v2).not.toBe(v3);
    expect(v3).not.toBe(v4);
    expect(JSON.parse(v1).validationVersion).toBe(1);
    expect(JSON.parse(v2).validationVersion).toBe(2);
    expect(JSON.parse(v3)).toMatchObject({
      validationVersion: 3,
      poolHash: base.poolHash,
      poolCount: SAMPLE.length,
    });
    /**
     * A v4 acrescenta o MOMENTO: sem ele, dois documentos de rodadas diferentes seriam
     * indistinguíveis, e trocar um pelo outro (o resultado da rodada 2 no lugar da 1)
     * conferiria perfeitamente.
     */
    expect(JSON.parse(v4)).toMatchObject({ validationVersion: 4, roundNumber: 1 });
    expect(v3).not.toContain('roundNumber');
  });

  it('a ordem dos campos é contrato: poolHash vem antes dos vencedores', () => {
    const payload = buildResultPayload(base);

    expect(payload.indexOf('"poolHash"')).toBeLessThan(payload.indexOf('"winners"'));
  });

  it('o compromisso da semente é o sha256 dela (o que o telão publica)', () => {
    expect(seedCommitment('semente')).toBe(seedCommitment('semente'));
    expect(seedCommitment('semente')).toMatch(/^[0-9a-f]{64}$/);
  });
});
