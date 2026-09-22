import { describe, expect, it } from 'vitest';

import {
  ASSIDUOUS_MINUTES_FLOOR,
  COLLECTOR_CARD_FLOOR,
  CSV_MAX_ROWS,
  MAX_PARTICIPANT_PAGE_SIZE,
  MESSAGE_BODY_MAX,
  MESSAGE_BATCH_LIMIT,
  MESSAGE_SUBJECT_MAX,
  attendanceRate,
  averageMinutesPerVisit,
  buildCsv,
  certificateCoverage,
  csvCell,
  engagementOf,
  maskEmail,
  messageDedupeKey,
  messagePreview,
  resolveParticipantPage,
  resolveRange,
  validateMessage,
} from '../../src/domain/participants/participant-rules';

describe('taxa de comparecimento', () => {
  it('calcula sobre as inscrições CONFIRMADAS, não sobre a presença', () => {
    const rate = attendanceRate({ confirmed: 40, attended: 10 });

    expect(rate.percent).toBe(25);
    expect(rate.hasData).toBe(true);
    expect(rate.label).toBe('25% de comparecimento');
  });

  /**
   * O caso que justifica a função existir: sem inscrição confirmada NÃO é 0% — é
   * ausência de dado. Um "0%" aqui viraria acusação sem base no relatório.
   */
  it('sem inscrição confirmada devolve AUSÊNCIA DE DADO, e não zero', () => {
    const rate = attendanceRate({ confirmed: 0, attended: 0 });

    expect(rate.percent).toBeNull();
    expect(rate.hasData).toBe(false);
    expect(rate.label).toBe('Sem inscrições confirmadas');
  });

  it('presença maior que a inscrição (leitura fora da inscrição) NÃO passa de 100%', () => {
    const rate = attendanceRate({ confirmed: 2, attended: 5 });

    expect(rate.percent).toBe(100);
    expect(rate.label).toBe('100% de comparecimento');
  });

  it('normaliza entrada negativa e fracionária em vez de produzir percentual absurdo', () => {
    expect(attendanceRate({ confirmed: -3, attended: -1 }).percent).toBeNull();
    expect(attendanceRate({ confirmed: 3.7, attended: 1.2 }).percent).toBe(33);
  });
});

describe('rótulos de engajamento', () => {
  it('rotula pelos FATOS, na ordem estável', () => {
    const tags = engagementOf({ events: 4, visits: 9, minutes: 480, certificates: 2, cards: 5, xp: 900 });

    expect(tags).toEqual(['CERTIFIED', 'COLLECTOR', 'ASSIDUOUS', 'VETERAN']);
  });

  it('quem tem pouca história recebe "participa com frequência", e não lista vazia', () => {
    expect(engagementOf({ events: 2, visits: 2, minutes: 60, certificates: 0, cards: 0, xp: 50 })).toEqual([
      'REGULAR',
    ]);
  });

  it('quem ainda não tem história recebe o rótulo de primeira participação', () => {
    expect(engagementOf({ events: 0, visits: 0, minutes: 0, certificates: 0, cards: 0, xp: 0 })).toEqual([
      'NEWCOMER',
    ]);
    expect(engagementOf({ events: 1, visits: 1, minutes: 30, certificates: 0, cards: 0, xp: 10 })).toEqual([
      'NEWCOMER',
    ]);
  });

  it('os pisos são os declarados — mudar o número muda o rótulo', () => {
    const almost = engagementOf({
      events: 1,
      visits: 1,
      minutes: ASSIDUOUS_MINUTES_FLOOR - 1,
      certificates: 0,
      cards: COLLECTOR_CARD_FLOOR - 1,
      xp: 0,
    });
    const reached = engagementOf({
      events: 1,
      visits: 1,
      minutes: ASSIDUOUS_MINUTES_FLOOR,
      certificates: 0,
      cards: COLLECTOR_CARD_FLOOR,
      xp: 0,
    });

    expect(almost).toEqual(['NEWCOMER']);
    expect(reached).toEqual(['COLLECTOR', 'ASSIDUOUS']);
  });
});

describe('máscara de e-mail', () => {
  it('preserva a primeira letra e o domínio', () => {
    expect(maskEmail('maria.silva@ufba.br')).toBe('m******@ufba.br');
    expect(maskEmail('joao@exemplo.test')).toBe('j***@exemplo.test');
  });

  it('não devolve nada aproveitável quando o endereço não tem forma de endereço', () => {
    expect(maskEmail('sem-arroba')).toBe('—');
    expect(maskEmail('@exemplo.test')).toBe('—');
    expect(maskEmail('maria@')).toBe('—');
    expect(maskEmail('   ')).toBe('—');
  });

  it('nunca revela o endereço completo — nem no caso de uma letra só antes do @', () => {
    expect(maskEmail('a@exemplo.test')).not.toContain('a@exemplo');
    expect(maskEmail('a@exemplo.test')).toBe('a**@exemplo.test');
  });
});

describe('médias do participante', () => {
  it('minutos por visita é ausência de dado sem visita', () => {
    expect(averageMinutesPerVisit({ minutes: 0, visits: 0 })).toBeNull();
    expect(averageMinutesPerVisit({ minutes: 180, visits: 3 })).toBe(60);
    expect(averageMinutesPerVisit({ minutes: 100, visits: 3 })).toBe(33);
  });

  it('cobertura de certificado usa a PRESENÇA como denominador', () => {
    expect(certificateCoverage({ certificates: 0, attendedEvents: 0 })).toBeNull();
    expect(certificateCoverage({ certificates: 2, attendedEvents: 4 })).toBe(50);
  });
});

describe('validação do recado', () => {
  it('aceita e normaliza espaços em excesso', () => {
    const result = validateMessage({ subject: '  Aviso sobre o credenciamento  ', body: '  Chegue antes.  ' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe('Aviso sobre o credenciamento');
    expect(result.body).toBe('Chegue antes.');
  });

  it('recusa assunto e corpo fora do tamanho, com a mensagem do limite', () => {
    const short = validateMessage({ subject: 'ab', body: 'texto válido' });
    const longSubject = validateMessage({ subject: 'a'.repeat(MESSAGE_SUBJECT_MAX + 1), body: 'texto válido' });
    const longBody = validateMessage({ subject: 'Assunto', body: 'a'.repeat(MESSAGE_BODY_MAX + 1) });

    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.code).toBe('INVALID_SUBJECT');
    expect(longSubject.ok).toBe(false);
    if (!longSubject.ok) expect(longSubject.message).toContain(String(MESSAGE_SUBJECT_MAX));
    expect(longBody.ok).toBe(false);
    if (!longBody.ok) expect(longBody.code).toBe('INVALID_BODY');
  });

  it('recusa campo que não é texto em vez de gravar "undefined"', () => {
    expect(validateMessage({ subject: undefined, body: undefined }).ok).toBe(false);
    expect(validateMessage({ subject: 42, body: null }).ok).toBe(false);
  });
});

describe('chave de deduplicação da mensagem', () => {
  it('muda com a MENSAGEM, não com o par (pessoa, assunto)', () => {
    const first = messageDedupeKey({ tenantId: 't1', userId: 'u1', messageId: 'm1' });
    const second = messageDedupeKey({ tenantId: 't1', userId: 'u1', messageId: 'm2' });

    expect(first).not.toBe(second);
    expect(first).toBe('participant-message-t1-u1-m1');
  });

  it('não usa dois-pontos — o BullMQ recusa id com ":" (armadilha 49)', () => {
    expect(messageDedupeKey({ tenantId: 't1', userId: 'u1', messageId: 'm1' })).not.toContain(':');
  });
});

describe('trecho da mensagem', () => {
  it('achata quebras de linha e corta com reticências', () => {
    expect(messagePreview('linha um\n\nlinha dois')).toBe('linha um linha dois');
    expect(messagePreview('a'.repeat(200))).toHaveLength(140);
    expect(messagePreview('a'.repeat(200))).toMatch(/…$/);
  });
});

describe('CSV seguro', () => {
  it('neutraliza FÓRMULA — nome de pessoa é dado de fora do sistema', () => {
    expect(csvCell('=HYPERLINK("http://mal.example")')).toBe('"\'=HYPERLINK(""http://mal.example"")"');
    expect(csvCell('+55 71 99999-0000')).toContain("'");
    expect(csvCell('-1')).toContain("'");
    expect(csvCell('@canal')).toContain("'");
  });

  it('aspas e ponto e vírgula entram entre aspas dobradas', () => {
    expect(csvCell('Silva; Maria')).toBe('"Silva; Maria"');
    expect(csvCell('Maria "Mari" Silva')).toBe('"Maria ""Mari"" Silva"');
    expect(csvCell('duas\nlinhas')).toContain('"');
  });

  it('nulo vira célula vazia, e número vira número', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(42)).toBe('42');
  });

  it('monta o arquivo com BOM, cabeçalho e CRLF', () => {
    const csv = buildCsv(['Nome', 'Minutos'], [['Maria', 60], ['João; Jr', null]]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Nome;Minutos\r\n');
    expect(csv).toContain('Maria;60\r\n');
    expect(csv).toContain('"João; Jr";\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('declara os limites do módulo (o teto do arquivo e do lote são regra)', () => {
    expect(CSV_MAX_ROWS).toBe(5_000);
    expect(MESSAGE_BATCH_LIMIT).toBe(200);
  });
});

describe('paginação do diretório', () => {
  it('normaliza número fora da faixa e corta no teto da página', () => {
    expect(resolveParticipantPage({ page: 0, pageSize: 0, total: 100 })).toMatchObject({
      page: 1,
      pageSize: 1,
    });
    expect(resolveParticipantPage({ page: 2, pageSize: 10_000, total: 100 })).toMatchObject({
      pageSize: MAX_PARTICIPANT_PAGE_SIZE,
      totalPages: 1,
      page: 1,
    });
  });

  it('página além do fim cai na última, em vez de mostrar lista vazia', () => {
    const page = resolveParticipantPage({ page: 99, total: 60 });

    expect(page.totalPages).toBe(3);
    expect(page.page).toBe(3);
    expect(page.skip).toBe(50);
  });

  it('lista vazia ainda tem uma página (a tela mostra estado vazio, não erro)', () => {
    expect(resolveParticipantPage({ total: 0 })).toMatchObject({ page: 1, totalPages: 1, skip: 0 });
  });
});

describe('período no fuso da instituição', () => {
  const now = new Date('2026-09-21T15:00:00.000Z');

  it('os últimos 30 dias começam à meia-noite do fuso da instituição', () => {
    const range = resolveRange({ range: '30D', now, timeZone: 'America/Bahia' });

    expect(range.from?.toISOString()).toBe('2026-08-22T03:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-22T03:00:00.000Z');
    expect(range.label).toBe('Últimos 30 dias');
  });

  it('o fim é o INÍCIO do dia seguinte — o dia inteiro entra na consulta', () => {
    const range = resolveRange({ range: 'ALL', now, timeZone: 'America/Bahia' });

    expect(range.from).toBeNull();
    expect(range.to.toISOString()).toBe('2026-09-22T03:00:00.000Z');
  });

  it('o ano corrente começa em 1º de janeiro no fuso da instituição', () => {
    const range = resolveRange({ range: 'YEAR', now, timeZone: 'America/Bahia' });

    expect(range.from?.toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });

  it('período escolhido usa o TEXTO digitado no rótulo (armadilha 57)', () => {
    const range = resolveRange({
      range: 'CUSTOM',
      now,
      timeZone: 'America/Bahia',
      fromDay: '2026-09-01',
      toDay: '2026-09-10',
    });

    expect(range.from?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-11T03:00:00.000Z');
    expect(range.label).toBe('01/09/2026 a 10/09/2026');
  });

  it('fuso inválido cai para UTC em vez de estourar a tela', () => {
    const range = resolveRange({ range: '30D', now, timeZone: 'Marte/Olympus' });

    expect(range.timeZone).toBe('UTC');
    expect(range.from?.toISOString()).toBe('2026-08-22T00:00:00.000Z');
  });

  it('fuso a leste de Greenwich também é respeitado', () => {
    const range = resolveRange({ range: 'CUSTOM', now, timeZone: 'Europe/Lisbon', fromDay: '2026-09-01', toDay: '2026-09-01' });

    // Lisboa está em UTC+1 no horário de verão: meia-noite local é 23:00Z do dia anterior.
    expect(range.from?.toISOString()).toBe('2026-08-31T23:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-01T23:00:00.000Z');
  });
});
