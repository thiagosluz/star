/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — crachá, janela de credenciamento e sessão de presença (FASE 31)
 *
 *  O que só o domínio puro pode provar:
 *    • o código do crachá é CANÔNICO (um formato só), digitável e sem caracteres
 *      ambíguos — e o que o QR carrega é o código, não dado pessoal;
 *    • a janela de credenciamento da atividade é respeitada, e o fim da atividade
 *      NÃO fecha a leitura sozinho (o balcão registra a lista depois da oficina);
 *    • os minutos de uma sessão têm teto no fim da ATIVIDADE — quem esquece de sair
 *      não ganha tempo que não existiu (é a conta que pesa no sorteio e no certificado);
 *    • o fechamento automático devolve sempre o MESMO número, não importa quando roda.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  BADGE_CODE_ALPHABET,
  BADGE_CODE_PREFIX,
  BADGE_CODE_RANDOM_LENGTH,
  MAX_BADGE_BATCH,
  badgeQrPayload,
  canUseCredential,
  credentialStateOf,
  describeAttendanceContext,
  formatBadgeCode,
  generateBadgeCode,
  isBadgeCode,
  normalizeBadgeCode,
} from '../../src/domain/events/credential-rules';
import {
  MAX_SESSION_MINUTES,
  canRecordAttendance,
  sessionCloseOf,
  sessionMinutes,
} from '../../src/domain/events/attendance-rules';

const at = (iso: string) => new Date(iso);

describe('o código do crachá', () => {
  it('nasce com prefixo, dois grupos e só caracteres do alfabeto', () => {
    const code = generateBadgeCode(() => 0);

    expect(code).toBe(`CR-AAAA-AAAA`);
    expect(code.startsWith(`${BADGE_CODE_PREFIX}-`)).toBe(true);
    expect(isBadgeCode(code)).toBe(true);
  });

  it('o alfabeto não tem caracteres que se confundem na digitação', () => {
    // `I`/`1`, `L`, `O`/`0` e `U` saem do alfabeto de propósito: o crachá é digitado
    // à mão quando o leitor falha.
    for (const char of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(BADGE_CODE_ALPHABET).not.toContain(char);
    }

    expect(BADGE_CODE_ALPHABET).toHaveLength(30);
  });

  it('usa a fonte de aleatoriedade injetada, dentro do intervalo', () => {
    const draws: number[] = [];
    const code = generateBadgeCode((max) => {
      draws.push(max);
      return max - 1;
    });

    expect(draws).toHaveLength(BADGE_CODE_RANDOM_LENGTH);
    expect(draws.every((max) => max === BADGE_CODE_ALPHABET.length)).toBe(true);
    // O último caractere do alfabeto, escolhido em todas as posições.
    expect(code).toBe(`CR-${BADGE_CODE_ALPHABET.at(-1)!.repeat(8).replace(/(.{4})(.{4})/, '$1-$2')}`);
  });

  it('normaliza o que o balcão manda: caixa, separadores, prefixo e espaços', () => {
    const canonical = 'CR-ABCD-EFGH';

    expect(normalizeBadgeCode('CR-ABCD-EFGH')).toBe(canonical);
    expect(normalizeBadgeCode('cr-abcd-efgh')).toBe(canonical);
    expect(normalizeBadgeCode('CRABCDEFGH')).toBe(canonical);
    expect(normalizeBadgeCode('  cr abcd efgh ')).toBe(canonical);
    expect(normalizeBadgeCode('ABCDEFGH')).toBe(canonical);
  });

  it('recusa o que não pode ser um crachá (em vez de procurar um código impossível)', () => {
    expect(normalizeBadgeCode('CR-ABC-EFGH')).toBeNull(); // curto
    expect(normalizeBadgeCode('CR-ABCD-EFGHI')).toBeNull(); // longo
    expect(normalizeBadgeCode('CR-ABCD-EFG0')).toBeNull(); // `0` não existe no alfabeto
    expect(normalizeBadgeCode('CR-ABCD-EFGI')).toBeNull(); // `I` também não
    expect(normalizeBadgeCode('')).toBeNull();
    expect(normalizeBadgeCode(null)).toBeNull();
  });

  it('formata os grupos a partir dos caracteres sorteados', () => {
    expect(formatBadgeCode('ABCDEFGH')).toBe('CR-ABCD-EFGH');
  });

  it('o QR carrega o CÓDIGO — nunca nome, e-mail ou identificador de pessoa', () => {
    const payload = badgeQrPayload('cr-abcd-efgh');

    expect(payload).toBe('CR-ABCD-EFGH');
    expect(payload).not.toMatch(/@/);
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // nem uuid
  });

  it('o lote de emissão tem teto (a folha é física)', () => {
    expect(MAX_BADGE_BATCH).toBeGreaterThan(0);
    expect(MAX_BADGE_BATCH).toBeLessThanOrEqual(500);
  });
});

describe('o estado do crachá', () => {
  it('revogado vence o status gravado', () => {
    expect(credentialStateOf({ status: 'ACTIVE', revokedAt: at('2026-09-21T12:00:00Z') })).toBe('REVOKED');
    expect(credentialStateOf({ status: 'REVOKED', revokedAt: null })).toBe('REVOKED');
    expect(credentialStateOf({ status: 'ACTIVE', revokedAt: null })).toBe('ACTIVE');
  });

  it('crachá revogado não pode ser usado, e a recusa diz o que fazer', () => {
    const revoked = canUseCredential({ status: 'ACTIVE', revokedAt: at('2026-09-21T12:00:00Z') });

    expect(revoked.ok).toBe(false);
    expect(revoked.reason).toMatch(/emita um novo/i);
    expect(canUseCredential({ status: 'ACTIVE', revokedAt: null })).toEqual({ ok: true, reason: null });
  });
});

describe('o contexto da leitura', () => {
  it('descreve a portaria e a atividade', () => {
    expect(describeAttendanceContext({ kind: 'EVENT', activityId: null })).toBe('Portaria do evento');
    expect(
      describeAttendanceContext({ kind: 'ACTIVITY', activityId: 'a1', activityTitle: 'Oficina de Rust' }),
    ).toBe('Atividade: Oficina de Rust');
    expect(describeAttendanceContext({ kind: 'ACTIVITY', activityId: 'a1' })).toBe('Atividade');
  });
});

const openActivity = {
  checkInEnabled: true,
  checkInOpensAt: null,
  checkInClosesAt: null,
};

describe('a janela de credenciamento da atividade', () => {
  it('aceita quando não há janela declarada — mesmo depois de a atividade terminar', () => {
    /**
     * O balcão registra a lista da oficina DEPOIS dela, com a sala vazia. Encerrar a
     * leitura no fim da atividade transformaria o trabalho normal em recusa.
     */
    expect(canRecordAttendance({ activity: openActivity, now: at('2026-09-22T23:00:00Z') })).toEqual({
      ok: true,
    });
  });

  it('recusa atividade com o credenciamento desligado', () => {
    const decision = canRecordAttendance({
      activity: { ...openActivity, checkInEnabled: false },
      now: at('2026-09-21T12:00:00Z'),
    });

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.code).toBe('CHECKIN_DISABLED');
  });

  it('recusa antes da abertura e depois do fechamento declarados', () => {
    const activity = {
      ...openActivity,
      checkInOpensAt: at('2026-09-21T13:00:00Z'),
      checkInClosesAt: at('2026-09-21T18:00:00Z'),
    };

    const antes = canRecordAttendance({ activity, now: at('2026-09-21T12:30:00Z') });
    const depois = canRecordAttendance({ activity, now: at('2026-09-21T18:30:00Z') });
    const dentro = canRecordAttendance({ activity, now: at('2026-09-21T15:00:00Z') });

    expect(antes.ok ? null : antes.code).toBe('WINDOW_NOT_OPEN');
    expect(depois.ok ? null : depois.code).toBe('WINDOW_CLOSED');
    expect(dentro).toEqual({ ok: true });
  });

  it('recusa atividade cancelada', () => {
    const decision = canRecordAttendance({
      activity: { ...openActivity, status: 'CANCELED' },
      now: at('2026-09-21T12:00:00Z'),
    });

    expect(decision.ok ? null : decision.code).toBe('ACTIVITY_CANCELED');
  });
});

describe('os minutos de uma sessão', () => {
  it('conta o tempo entre entrada e saída', () => {
    expect(
      sessionMinutes({
        checkedInAt: at('2026-09-21T13:00:00Z'),
        closedAt: at('2026-09-21T14:30:00Z'),
      }),
    ).toBe(90);
  });

  it('NÃO passa do fim da atividade (o esquecimento não vira tempo)', () => {
    const minutes = sessionMinutes({
      checkedInAt: at('2026-09-21T13:00:00Z'),
      closedAt: at('2026-09-21T17:00:00Z'),
      activityEndsAt: at('2026-09-21T14:00:00Z'),
    });

    // Oficina de 60 min: quem entrou às 13h e nunca saiu vale 60, não 240.
    expect(minutes).toBe(60);
  });

  it('nunca devolve negativo (entrada posterior ao fechamento)', () => {
    expect(
      sessionMinutes({
        checkedInAt: at('2026-09-21T14:10:00Z'),
        closedAt: at('2026-09-21T14:00:00Z'),
        activityEndsAt: at('2026-09-21T14:00:00Z'),
      }),
    ).toBe(0);
  });

  it('respeita o teto absoluto quando não há fim de atividade', () => {
    expect(
      sessionMinutes({
        checkedInAt: at('2026-09-21T00:00:00Z'),
        closedAt: at('2026-09-25T00:00:00Z'),
      }),
    ).toBe(MAX_SESSION_MINUTES);
  });
});

describe('o fechamento automático das presenças abertas', () => {
  it('não fecha nada enquanto a atividade não terminou', () => {
    expect(
      sessionCloseOf({
        checkedInAt: at('2026-09-21T13:00:00Z'),
        activityEndsAt: at('2026-09-21T14:00:00Z'),
        now: at('2026-09-21T13:30:00Z'),
      }),
    ).toBeNull();
  });

  it('fecha no FIM DA ATIVIDADE — e o número não depende de quando a varredura roda', () => {
    const cedo = sessionCloseOf({
      checkedInAt: at('2026-09-21T13:00:00Z'),
      activityEndsAt: at('2026-09-21T14:00:00Z'),
      now: at('2026-09-21T14:05:00Z'),
    });

    const tarde = sessionCloseOf({
      checkedInAt: at('2026-09-21T13:00:00Z'),
      activityEndsAt: at('2026-09-21T14:00:00Z'),
      now: at('2026-09-23T09:00:00Z'),
    });

    expect(cedo).toEqual(tarde);
    expect(cedo).toEqual({
      closedAt: at('2026-09-21T14:00:00Z'),
      minutes: 60,
      autoClosed: true,
    });
  });

  it('a portaria (sem atividade) não tem fechamento automático', () => {
    expect(
      sessionCloseOf({
        checkedInAt: at('2026-09-21T13:00:00Z'),
        activityEndsAt: null,
        now: at('2026-09-23T09:00:00Z'),
      }),
    ).toBeNull();
  });
});
