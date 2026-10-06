/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A MARGEM DE DESLOCAMENTO ENTRE SALAS (E86 · FASE 69 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Que o detector de choque deixou de olhar só o intervalo PURO: dois itens em salas
 *  diferentes, separados por MENOS que a margem, passam a avisar; separados por MAIS,
 *  continuam em silêncio; e com margem ZERO a régua é EXATAMENTE a da FASE 65.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PROVA DOS DOIS LADOS É O QUE IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um teste que só mostrasse "perto avisa" passaria igual se a margem fosse infinita —
 *  e uma margem infinita é um aviso em todo par, que é o mesmo que aviso nenhum. Por
 *  isso cada caso de aviso tem o seu par do lado oposto (a MESMA distância com margem
 *  menor, a distância EXATAMENTE igual à margem, a distância maior), e o teste da
 *  margem zero fecha o terceiro lado: o comportamento antigo não foi reescrito, foi
 *  PRESERVADO em volta de um parâmetro novo.
 *
 *  A borda exata — `gap === margem` — é a mais fácil de escorregar (`<` virando `<=`),
 *  e é por isso que ela tem caso próprio: a régua do deslocamento é "cabe o
 *  deslocamento?", e quem tem EXATAMENTE a margem cabe. Ela fica do lado de quem NÃO
 *  avisa.
 *
 *  Sem banco, sem navegador e sem relógio: a regra é pura (invariante do domínio).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  findClashPairs,
  intervalsClash,
  intervalsOverlap,
  ROOM_TRAVEL_MARGIN_MINUTES,
  type AgendaInterval,
} from '../../src/domain/agenda/overlap-rules';
import {
  buildMyAgenda,
  type AgendaActivityFact,
  type MyAgenda,
} from '../../src/domain/agenda/agenda-rules';

/** Instante UTC do dia de teste. */
const em = (hora: string, dia = '2026-12-01'): Date => new Date(`${dia}T${hora}:00.000Z`);

const intervalo = (de: string | null, ate: string | null): AgendaInterval => ({
  startsAt: de === null ? null : em(de),
  endsAt: ate === null ? null : em(ate),
});

/** A margem de teste: 10 minutos, para as horas redondas do arquivo darem números claros. */
const MARGEM = 10;

const atividade = (
  patch: Partial<AgendaActivityFact> & { id: string; title: string },
): AgendaActivityFact => ({
  slug: patch.id,
  status: 'SCHEDULED',
  startsAt: em('15:00'),
  endsAt: em('16:00'),
  type: 'LECTURE',
  roomName: null,
  workloadMinutes: 60,
  ...patch,
});

/** A grade com a margem escolhida e TODAS as atividades favoritadas. */
function gradeCom(
  activities: AgendaActivityFact[],
  roomTravelMarginMinutes?: number,
): MyAgenda {
  return buildMyAgenda({
    timezone: 'UTC',
    activities,
    favoriteActivityIds: activities.map((item) => item.id),
    registrations: [],
    ...(roomTravelMarginMinutes === undefined ? {} : { roomTravelMarginMinutes }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  A constante
// ═══════════════════════════════════════════════════════════════════════════════
describe('a régua declarada da margem (E86)', () => {
  it('a margem padrão é 15 minutos — o número que o texto do aviso anuncia', () => {
    expect(ROOM_TRAVEL_MARGIN_MINUTES).toBe(15);
  });

  it('a margem é um número positivo e FINITO: zero ou infinito seriam outra feature', () => {
    expect(Number.isFinite(ROOM_TRAVEL_MARGIN_MINUTES)).toBe(true);
    expect(ROOM_TRAVEL_MARGIN_MINUTES).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A régua pura: intervalsClash
// ═══════════════════════════════════════════════════════════════════════════════
describe('intervalsClash — sobreposição OU deslocamento impossível (E86)', () => {
  it('SOBREPOSIÇÃO é conflito com qualquer margem — inclusive zero', () => {
    const longo = intervalo('14:00', '18:00');
    const dentro = intervalo('15:00', '16:00');

    expect(intervalsClash(longo, dentro, 0)).toBe(true);
    expect(intervalsClash(dentro, longo, 0)).toBe(true);
    expect(intervalsClash(longo, dentro, ROOM_TRAVEL_MARGIN_MINUTES)).toBe(true);
  });

  it('MENOS que a margem avisa; MAIS que a margem não avisa — os DOIS lados', () => {
    const primeira = intervalo('15:00', '16:00');
    const depoisCinco = intervalo('16:05', '17:00');
    const depoisVinte = intervalo('16:20', '17:00');

    // 5 minutos de folga com margem de 10: não dá tempo de atravessar.
    expect(intervalsClash(primeira, depoisCinco, MARGEM)).toBe(true);
    expect(intervalsClash(depoisCinco, primeira, MARGEM)).toBe(true);

    // 20 minutos de folga com margem de 10: dá tempo — e o aviso fica calado.
    expect(intervalsClash(primeira, depoisVinte, MARGEM)).toBe(false);
    expect(intervalsClash(depoisVinte, primeira, MARGEM)).toBe(false);
  });

  it('a BORDA EXATA não avisa: quem tem exatamente a margem CABE no deslocamento', () => {
    const primeira = intervalo('15:00', '16:00');
    const dez = intervalo('16:10', '17:00');

    // `gap === margem` fica do lado de quem NÃO avisa (`<` estrito, não `<=`).
    expect(intervalsClash(primeira, dez, MARGEM)).toBe(false);
    // ...e um minuto a menos muda o veredito: é isso que dá sentido à borda.
    expect(intervalsClash(primeira, intervalo('16:09', '17:00'), MARGEM)).toBe(true);
  });

  it('ENCOSTADO avisa com margem positiva: é o caso que a dívida descreve', () => {
    const oficina = intervalo('14:00', '15:00');
    const palestra = intervalo('15:00', '16:00');

    expect(intervalsClash(oficina, palestra, ROOM_TRAVEL_MARGIN_MINUTES)).toBe(true);
    expect(intervalsClash(palestra, oficina, ROOM_TRAVEL_MARGIN_MINUTES)).toBe(true);
  });

  it('a relação é SIMÉTRICA: trocar os lados não muda o veredito', () => {
    const casos: [AgendaInterval, AgendaInterval][] = [
      [intervalo('14:00', '15:00'), intervalo('15:00', '16:00')],
      [intervalo('14:00', '15:00'), intervalo('15:05', '16:00')],
      [intervalo('14:00', '15:00'), intervalo('16:00', '17:00')],
      [intervalo('14:00', '18:00'), intervalo('15:00', '16:00')],
      [intervalo('14:00', '15:00'), intervalo('14:00', '15:00')],
      [intervalo('15:00', '15:00'), intervalo('15:00', '16:00')],
      [intervalo('15:30', '15:30'), intervalo('15:00', '16:00')],
    ];

    for (const [a, b] of casos) {
      expect(intervalsClash(a, b, ROOM_TRAVEL_MARGIN_MINUTES)).toBe(
        intervalsClash(b, a, ROOM_TRAVEL_MARGIN_MINUTES),
      );
    }
  });

  it('SEM HORÁRIO não conflita com nada — nem consigo mesmo, com qualquer margem', () => {
    const semHorario = intervalo(null, null);
    const soComeco = intervalo('10:00', null);
    const comHorario = intervalo('10:00', '11:00');

    for (const margem of [0, MARGEM, ROOM_TRAVEL_MARGIN_MINUTES]) {
      for (const candidato of [semHorario, soComeco]) {
        expect(intervalsClash(candidato, comHorario, margem)).toBe(false);
        expect(intervalsClash(comHorario, candidato, margem)).toBe(false);
        expect(intervalsClash(candidato, candidato, margem)).toBe(false);
      }
    }
  });

  it('INSTANTE (duração zero) segue a régua das bordas: dentro conflita, na borda não', () => {
    const ponto = intervalo('15:00', '15:00');

    expect(intervalsClash(ponto, intervalo('14:00', '16:00'), MARGEM)).toBe(true);
    // Na borda de SAÍDA, com margem zero: encostar não é conflito.
    expect(intervalsClash(ponto, intervalo('15:00', '16:00'), 0)).toBe(false);
    // E com margem positiva o instante encostado passa a avisar.
    expect(intervalsClash(ponto, intervalo('15:00', '16:00'), MARGEM)).toBe(true);
  });

  it('MARGEM ZERO é EXATAMENTE a régua antiga: responde o mesmo que intervalsOverlap', () => {
    const casos: [AgendaInterval, AgendaInterval][] = [
      [intervalo('15:00', '16:00'), intervalo('16:00', '17:00')], // emendado
      [intervalo('15:00', '16:00'), intervalo('16:01', '17:00')], // um minuto de folga
      [intervalo('14:00', '18:00'), intervalo('15:00', '16:00')], // contido
      [intervalo('15:00', '16:00'), intervalo('15:00', '16:00')], // idênticos
      [intervalo('15:00', '16:30'), intervalo('16:00', '17:00')], // sobreposto
      [intervalo('15:00', '15:00'), intervalo('15:00', '16:00')], // instante na borda
      [intervalo('15:30', '15:30'), intervalo('15:00', '16:00')], // instante dentro
      [intervalo(null, null), intervalo('15:00', '16:00')], // sem horário
      [intervalo('15:00', null), intervalo('15:00', '16:00')], // só começo
    ];

    for (const [a, b] of casos) {
      expect(intervalsClash(a, b, 0)).toBe(intervalsOverlap(a, b));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A lista de pares com margem: findClashPairs
// ═══════════════════════════════════════════════════════════════════════════════
describe('findClashPairs — os pares com o deslocamento considerado (E86)', () => {
  const itens = [
    { id: 'oficina', ...intervalo('13:00', '14:00') },
    { id: 'palestra', ...intervalo('14:00', '15:00') },
    { id: 'mesa', ...intervalo('16:00', '17:00') },
  ];

  it('acha o par encostado que a régua pura não via', () => {
    const pares = findClashPairs(itens, (item) => item, ROOM_TRAVEL_MARGIN_MINUTES);

    expect(pares.map((par) => [par.first.id, par.second.id])).toEqual([['oficina', 'palestra']]);
  });

  it('com margem ZERO, a lista é a mesma da régua pura — sequência não é choque', () => {
    expect(findClashPairs(itens, (item) => item, 0)).toEqual([]);
  });

  it('a lista mantém a ordem dos itens de entrada (par simétrico por construção)', () => {
    const invertidos = [...itens].reverse();
    const pares = findClashPairs(invertidos, (item) => item, ROOM_TRAVEL_MARGIN_MINUTES);

    expect(pares.map((par) => [par.first.id, par.second.id])).toEqual([['palestra', 'oficina']]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A grade: o default da regra e os dois lados no produto
// ═══════════════════════════════════════════════════════════════════════════════
describe('a grade do participante com a margem (E86)', () => {
  it('SEM passar margem, a grade usa a régua DECLARADA e avisa o par encostado', () => {
    const grade = gradeCom([
      atividade({ id: 'oficina', title: 'Oficina', startsAt: em('13:00'), endsAt: em('15:00') }),
      atividade({ id: 'palestra', title: 'Palestra', startsAt: em('15:00'), endsAt: em('16:00') }),
    ]);

    expect(grade.clashes).toEqual([
      {
        firstActivityId: 'oficina',
        secondActivityId: 'palestra',
        firstTitle: 'Oficina',
        secondTitle: 'Palestra',
      },
    ]);
    expect(grade.counts.clashPairs).toBe(1);
    expect(grade.entries.every((entry) => entry.hasClash)).toBe(true);
  });

  it('a MESMA grade com margem menor fica em silêncio — o outro lado da prova', () => {
    const atividades = [
      atividade({ id: 'oficina', title: 'Oficina', startsAt: em('13:00'), endsAt: em('15:00') }),
      atividade({ id: 'palestra', title: 'Palestra', startsAt: em('15:00'), endsAt: em('16:00') }),
    ];

    // O par está encostado (folga de ZERO): só a margem ZERO o deixa em silêncio.
    expect(gradeCom(atividades, 0).clashes).toEqual([]);
    // Com UM minuto de margem já avisa: a folga é zero, e zero é menor que um.
    expect(gradeCom(atividades, 1).counts.clashPairs).toBe(1);
  });

  it('com margem GRANDE, o item que estava longe também entra no aviso', () => {
    const atividades = [
      atividade({ id: 'oficina', title: 'Oficina', startsAt: em('13:00'), endsAt: em('14:00') }),
      atividade({ id: 'palestra', title: 'Palestra', startsAt: em('14:30'), endsAt: em('15:00') }),
    ];

    // 30 minutos de folga: com a régua declarada (15) ninguém avisa...
    expect(gradeCom(atividades).counts.clashPairs).toBe(0);
    // ...e com margem de 45 o MESMO par passa a avisar: a régua é que decide.
    expect(gradeCom(atividades, 45).counts.clashPairs).toBe(1);
  });

  it('a margem não cria choque com item CANCELADO nem com item sem horário', () => {
    const grade = buildMyAgenda({
      timezone: 'UTC',
      activities: [
        atividade({
          id: 'cancelada',
          title: 'Cancelada',
          startsAt: em('15:00'),
          endsAt: em('16:00'),
          status: 'CANCELED',
        }),
        atividade({ id: 'viva', title: 'Viva', startsAt: em('15:00'), endsAt: em('16:00') }),
      ],
      favoriteActivityIds: ['cancelada', 'viva'],
      registrations: [],
      roomTravelMarginMinutes: 45,
    });

    expect(grade.entries).toHaveLength(2);
    expect(grade.clashes).toEqual([]);
    expect(grade.counts.clashPairs).toBe(0);
  });
});
