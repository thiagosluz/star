/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Gerador de `.ics` (RFC 5545) e URL do Google (FASE 65)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um `.ics` malformado NÃO dá erro: o arquivo abre, o aplicativo não reclama e o
 *  compromisso não aparece — ou aparece com o título cortado ao meio. Cada teste
 *  abaixo prende UMA das armadilhas que quebram em silêncio, e a dobra de linha em
 *  UTF-8 é a que mais dói: o limite é de OCTETOS, e a linha com acento estoura
 *  antes do que a contagem de caracteres sugere.
 *
 *  O decodificador usado aqui é `fatal: true` de propósito: ele TRANSFORMA
 *  sequência UTF-8 inválida em exceção, que é exatamente o que o cliente de
 *  calendário faz por baixo (só que em silêncio).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  buildActivityIcs,
  buildScheduleIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  toUtcStamp,
  type CalendarItem,
} from '../../src/lib/calendar/ics';

const utf8 = new TextEncoder();
/** Decodificador ESTRITO: sequência inválida lança em vez de virar "�". */
const estrito = new TextDecoder('utf-8', { fatal: true });

/** Instante fixo do `DTSTAMP`: teste com relógio de parede é teste que mente amanhã. */
const AGORA = new Date('2026-10-04T01:00:00.000Z');

const atividade = (patch: Partial<CalendarItem> = {}): CalendarItem => ({
  activityId: '0198f0aa-1111-7000-8000-000000000001',
  title: 'Palestra de abertura',
  /** 18:00 em Salvador (UTC-3) — o horário que o participante lê no celular. */
  startsAt: new Date('2026-12-01T21:00:00.000Z'),
  endsAt: new Date('2026-12-01T22:30:00.000Z'),
  timezone: 'America/Bahia',
  location: 'Auditório A',
  ...patch,
});

/** As linhas FÍSICAS do arquivo (sem o vazio final que o CRLF derradeiro produz). */
function linhasFisicas(ics: string): string[] {
  const partes = ics.split('\r\n');
  if (partes[partes.length - 1] === '') partes.pop();
  return partes;
}

/** As linhas LÓGICAS: junta cada continuação (que começa com um espaço) à anterior. */
function linhasLogicas(ics: string): string[] {
  const logicas: string[] = [];

  for (const linha of linhasFisicas(ics)) {
    if (linha.startsWith(' ') && logicas.length > 0) {
      logicas[logicas.length - 1] += linha.slice(1);
    } else {
      logicas.push(linha);
    }
  }

  return logicas;
}

/** A linha lógica de uma propriedade (com ou sem parâmetros). */
function propriedade(ics: string, nome: string): string {
  const linha = linhasLogicas(ics).find(
    (candidata) => candidata.startsWith(`${nome}:`) || candidata.startsWith(`${nome};`),
  );

  if (!linha) throw new Error(`Propriedade ${nome} ausente do arquivo`);

  return linha;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Armadilha 1 — CRLF
// ═══════════════════════════════════════════════════════════════════════════════
describe('.ics — quebra de linha (RFC 5545 §3.1)', () => {
  it('TODA linha termina em CRLF, e nenhum LF solto sobra no arquivo', () => {
    const ics = buildScheduleIcs([atividade(), atividade({ activityId: 'b', title: 'Oficina' })], {
      now: AGORA,
      calendarName: 'Minha agenda',
    });

    expect(ics.endsWith('\r\n')).toBe(true);
    // Sem os CRLF, não pode sobrar nenhum \n nem \r: seria quebra "só LF".
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ics.replace(/\r\n/g, '')).not.toContain('\r');
    // E o arquivo INTEIRO é UTF-8 válido: nenhuma dobra partiu um caractere.
    expect(() => estrito.decode(utf8.encode(ics))).not.toThrow();
  });

  it('o arquivo abre e fecha o VCALENDAR, com versão e PRODID', () => {
    const ics = buildActivityIcs(atividade(), { now: AGORA });
    const logicas = linhasLogicas(ics);

    expect(logicas[0]).toBe('BEGIN:VCALENDAR');
    expect(logicas[logicas.length - 1]).toBe('END:VCALENDAR');
    expect(propriedade(ics, 'VERSION')).toBe('VERSION:2.0');
    expect(propriedade(ics, 'PRODID')).toBe('PRODID:-//EventFlow//Agenda do participante//PT-BR');
    expect(propriedade(ics, 'CALSCALE')).toBe('CALSCALE:GREGORIAN');
    expect(propriedade(ics, 'METHOD')).toBe('METHOD:PUBLISH');
    expect(logicas).toContain('BEGIN:VEVENT');
    expect(logicas).toContain('END:VEVENT');
    expect(propriedade(ics, 'X-WR-CALNAME')).toBe('X-WR-CALNAME:Palestra de abertura');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Armadilha 2 — a dobra em 75 OCTETOS, sem partir caractere UTF-8
// ═══════════════════════════════════════════════════════════════════════════════
describe('.ics — dobra de linha em 75 octetos', () => {
  it('nenhuma linha física passa de 75 BYTES (não de 75 caracteres)', () => {
    // 100 caracteres acentuados: 90 bytes a mais do que a contagem de caracteres.
    const title = `Introdução à Computação Çientífica — ${'ã'.repeat(60)}`;
    const ics = buildActivityIcs(atividade({ title }), { now: AGORA });

    for (const linha of linhasFisicas(ics)) {
      expect(utf8.encode(linha).length).toBeLessThanOrEqual(75);
    }
  });

  it('a dobra NÃO parte caractere UTF-8: cada linha decodifica em modo estrito', () => {
    /**
     * ─── O CASO QUE QUEBRA DE VERDADE ─────────────────────────────────────────
     * O prefixo `SUMMARY:` ocupa 8 bytes; com 66 'a' o 'ç' começa exatamente no 75º
     * byte. Um corte ingênuo por BYTES (`subarray(0, 75)`) parte o 'ç' ao meio e
     * produz sequência inválida — é o que a primeira asserção PROVA. A segunda
     * prova que a nossa dobra não faz isso.
     */
    const title = `${'a'.repeat(66)}ção de encerramento`;
    const bruto = utf8.encode(`SUMMARY:${title}`);

    const corteIngenuo = new TextDecoder('utf-8').decode(bruto.subarray(0, 75));
    expect(corteIngenuo).toContain('\uFFFD');

    const ics = buildActivityIcs(atividade({ title }), { now: AGORA });

    for (const linha of linhasFisicas(ics)) {
      expect(() => estrito.decode(utf8.encode(linha))).not.toThrow();
    }

    expect(ics).not.toContain('\uFFFD');
    expect(propriedade(ics, 'SUMMARY')).toBe(`SUMMARY:${escapeIcsText(title)}`);
  });

  it('a linha dobrada pode ser REMONTADA sem perder um byte do texto', () => {
    const title = `Mesa-redonda: acessibilidade, inclusão e ${'ç'.repeat(50)}`;
    const ics = buildActivityIcs(atividade({ title, description: 'Texto longo '.repeat(20) }), {
      now: AGORA,
    });

    expect(propriedade(ics, 'SUMMARY')).toBe(`SUMMARY:${escapeIcsText(title)}`);
    expect(propriedade(ics, 'DESCRIPTION')).toContain('Texto longo Texto longo');
  });

  it('a continuação começa com UM espaço, e emoji (par substituto) não é partido', () => {
    const title = `Festa de encerramento 🎉 ${'x'.repeat(80)}`;
    const dobrada = foldIcsLine(`SUMMARY:${escapeIcsText(title)}`);

    expect(dobrada).toContain('\r\n ');

    const ics = buildActivityIcs(atividade({ title }), { now: AGORA });
    expect(propriedade(ics, 'SUMMARY')).toBe(`SUMMARY:${escapeIcsText(title)}`);
    expect(propriedade(ics, 'SUMMARY')).toContain('🎉');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Armadilha 3 — escape de texto
// ═══════════════════════════════════════════════════════════════════════════════
describe('.ics — escape de \\, ,, ; e quebra de linha', () => {
  it('SUMMARY e LOCATION saem escapados', () => {
    const ics = buildActivityIcs(
      atividade({
        title: 'Mesa, redonda; sobre \\ tudo',
        location: 'Sala 1; Bloco B, 2º andar',
      }),
      { now: AGORA },
    );

    expect(propriedade(ics, 'SUMMARY')).toBe('SUMMARY:Mesa\\, redonda\\; sobre \\\\ tudo');
    expect(propriedade(ics, 'LOCATION')).toBe('LOCATION:Sala 1\\; Bloco B\\, 2º andar');
  });

  it('quebra de linha vira \\n literal dentro da propriedade', () => {
    const ics = buildActivityIcs(
      atividade({ title: 'Abertura', description: 'Primeira linha\nSegunda linha' }),
      { now: AGORA },
    );

    const descricao = propriedade(ics, 'DESCRIPTION');
    expect(descricao).toContain('Primeira linha\\nSegunda linha');
    // A quebra REAL não pode sobrar dentro da linha lógica.
    expect(descricao).not.toContain('\n');
  });

  it('a descrição também escapa vírgula e ponto e vírgula (o rótulo local os tem)', () => {
    const ics = buildActivityIcs(atividade({ description: 'Traga o crachá; e o café, se puder' }), {
      now: AGORA,
    });

    const descricao = propriedade(ics, 'DESCRIPTION');
    expect(descricao).toContain('Traga o crachá\\; e o café\\, se puder');
    expect(descricao).toContain('Horário local: 01/12/2026\\, 18:00');
  });

  it('a barra invertida é escapada PRIMEIRO (senão o escape se escaparia)', () => {
    expect(escapeIcsText('C:\\eventos')).toBe('C:\\\\eventos');
    expect(escapeIcsText('linha1\r\nlinha2')).toBe('linha1\\nlinha2');
    expect(escapeIcsText('a,b;c')).toBe('a\\,b\\;c');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Armadilhas 4, 5 e 6 — UID estável, DTSTAMP e horário em UTC
// ═══════════════════════════════════════════════════════════════════════════════
describe('.ics — identificação e horário', () => {
  it('o UID é ESTÁVEL: mudar título, horário e DTSTAMP não cria evento novo', () => {
    const primeiro = buildActivityIcs(atividade(), { now: AGORA });
    const depois = buildActivityIcs(
      atividade({
        title: 'Palestra de abertura (título corrigido)',
        startsAt: new Date('2026-12-01T23:00:00.000Z'),
        endsAt: new Date('2026-12-02T00:30:00.000Z'),
      }),
      { now: new Date('2027-02-15T10:00:00.000Z') },
    );

    expect(propriedade(primeiro, 'UID')).toBe(
      'UID:0198f0aa-1111-7000-8000-000000000001@eventflow',
    );
    expect(propriedade(depois, 'UID')).toBe(propriedade(primeiro, 'UID'));
    // O DTSTAMP, sim, muda: ele é o instante em que o arquivo foi gerado.
    expect(propriedade(depois, 'DTSTAMP')).not.toBe(propriedade(primeiro, 'DTSTAMP'));
  });

  it('o domínio do UID é configurável (trocar o sufixo gera eventos novos)', () => {
    const ics = buildActivityIcs(atividade(), { now: AGORA, uidDomain: 'eventos.exemplo.br' });

    expect(propriedade(ics, 'UID')).toBe(
      'UID:0198f0aa-1111-7000-8000-000000000001@eventos.exemplo.br',
    );
  });

  it('DTSTAMP está sempre presente e sai no instante injetado', () => {
    const ics = buildActivityIcs(atividade(), { now: AGORA });

    expect(propriedade(ics, 'DTSTAMP')).toBe('DTSTAMP:20261004T010000Z');
  });

  it('DTSTART/DTEND saem em UTC, e a hora LOCAL aparece na descrição', () => {
    const ics = buildActivityIcs(atividade(), { now: AGORA });

    // 18:00 em America/Bahia (UTC-3) = 21:00Z.
    expect(propriedade(ics, 'DTSTART')).toBe('DTSTART:20261201T210000Z');
    expect(propriedade(ics, 'DTEND')).toBe('DTEND:20261201T223000Z');
    // Não é hora de parede com TZID: o arquivo não tem fuso local nenhum.
    expect(ics).not.toContain('TZID');
    expect(ics).toContain('20261201T210000Z');

    const descricao = propriedade(ics, 'DESCRIPTION');
    expect(descricao).toContain('18:00');
    expect(descricao).toContain('19:30');
    expect(descricao).toContain('America/Bahia');
  });

  it('fuso inválido cai em UTC no rótulo, sem derrubar o arquivo', () => {
    const ics = buildActivityIcs(atividade({ timezone: 'America/Bahiaa' }), { now: AGORA });

    expect(propriedade(ics, 'DTSTART')).toBe('DTSTART:20261201T210000Z');
    expect(propriedade(ics, 'DESCRIPTION')).toContain('(UTC)');
  });

  it('toUtcStamp recusa data inválida em vez de gravar "NaN"', () => {
    expect(toUtcStamp(new Date('2026-12-01T21:00:00.000Z'))).toBe('20261201T210000Z');
    expect(() => toUtcStamp(new Date('nada'))).toThrow(/Data inválida/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A grade inteira
// ═══════════════════════════════════════════════════════════════════════════════
describe('.ics — arquivo da grade inteira', () => {
  it('um VEVENT por atividade, todos fechados', () => {
    const ics = buildScheduleIcs(
      [
        atividade(),
        atividade({ activityId: 'b', title: 'Oficina de acessibilidade' }),
        atividade({ activityId: 'c', title: 'Encerramento' }),
      ],
      { now: AGORA },
    );

    const logicas = linhasLogicas(ics);
    expect(logicas.filter((linha) => linha === 'BEGIN:VEVENT')).toHaveLength(3);
    expect(logicas.filter((linha) => linha === 'END:VEVENT')).toHaveLength(3);
    expect(logicas.filter((linha) => linha === 'BEGIN:VCALENDAR')).toHaveLength(1);
    expect(propriedade(ics, 'X-WR-CALNAME')).toBe('X-WR-CALNAME:Minha agenda');
  });

  it('item sem horário válido é PULADO — um dado corrompido não custa o arquivo', () => {
    const ics = buildScheduleIcs(
      [
        atividade(),
        atividade({ activityId: 'quebrada', title: 'Sem data', startsAt: new Date('nada') }),
      ],
      { now: AGORA },
    );

    const logicas = linhasLogicas(ics);
    expect(logicas.filter((linha) => linha === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics).not.toContain('Sem data');
  });

  it('a grade vazia ainda é um arquivo válido (cabeçalho e rodapé)', () => {
    const ics = buildScheduleIcs([], { now: AGORA });

    expect(propriedade(ics, 'VERSION')).toBe('VERSION:2.0');
    expect(linhasLogicas(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EventFlow//Agenda do participante//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Minha agenda',
      'END:VCALENDAR',
    ]);
  });

  it('arquivo de UMA atividade sem horário válido FALHA alto (não gera arquivo inútil)', () => {
    expect(() => buildActivityIcs(atividade({ startsAt: new Date('nada') }), { now: AGORA })).toThrow(
      /Data inválida/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Google Calendar
// ═══════════════════════════════════════════════════════════════════════════════
describe('URL do Google Calendar', () => {
  it('monta o formulário com as datas em UTC no formato do Google', () => {
    const url = googleCalendarUrl(atividade({ title: 'Mesa & Café, parte 2' }));
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));

    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    expect(params.get('action')).toBe('TEMPLATE');
    expect(params.get('text')).toBe('Mesa & Café, parte 2');
    expect(params.get('dates')).toBe('20261201T210000Z/20261201T223000Z');
    expect(params.get('details')).toContain('18:00');
  });

  it('o `&` do título não parte a URL em dois parâmetros', () => {
    const url = googleCalendarUrl(atividade({ title: 'Mesa & Café', location: null }));
    const consulta = url.slice(url.indexOf('?') + 1);

    // O `&` do título está CODIFICADO — não virou separador de parâmetro.
    expect(url).toContain('%26');

    // Sobram exatamente as quatro propriedades (action, text, dates, details):
    // nenhuma a mais, que é o que um `&` cru produziria.
    expect(consulta.split('&')).toHaveLength(4);
    expect(new URLSearchParams(consulta).get('text')).toBe('Mesa & Café');
  });

  it('local é parâmetro próprio; sem local, ele nem aparece', () => {
    const comLocal = googleCalendarUrl(atividade({ location: 'Sala 1; Bloco B' }));
    const semLocal = googleCalendarUrl(atividade({ location: null }));

    const params = new URLSearchParams(comLocal.slice(comLocal.indexOf('?') + 1));
    expect(params.get('location')).toBe('Sala 1; Bloco B');

    const semParams = new URLSearchParams(semLocal.slice(semLocal.indexOf('?') + 1));
    expect(semParams.has('location')).toBe(false);
  });
});
