/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Choque de horário e "minha grade" (FASE 65 · fatia 1)
 *
 *  Sem banco e sem navegador: a regra inteira é pura, e é aqui que as BORDAS
 *  ficam presas — encostar não é choque, conter é, item sem horário não choca,
 *  rascunho não entra na grade e inscrição cancelada não é lugar.
 *
 *  A regra é a mesma nos dois lados do produto: a grade que a pessoa vê hoje e o
 *  arquivo `.ics` que ela exporta amanhã. Se uma borda escorregar, escorrega nos
 *  dois — por isso ela é presa aqui, uma vez.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  containsInterval,
  findOverlapPairs,
  intervalsOverlap,
  intervalsTouch,
  isPointInTime,
} from '../../src/domain/agenda/overlap-rules';
import {
  AGENDA_MARK_LABELS,
  buildMyAgenda,
  agendaMarkOf,
  isOnAgenda,
  type AgendaActivityFact,
} from '../../src/domain/agenda/agenda-rules';

/** Instante UTC do dia de teste. */
const em = (hora: string, dia = '2026-12-01'): Date => new Date(`${dia}T${hora}:00.000Z`);

const intervalo = (de: string | null, ate: string | null) => ({
  startsAt: de === null ? null : em(de),
  endsAt: ate === null ? null : em(ate),
});

const atividade = (
  patch: Partial<AgendaActivityFact> & { id: string; title: string },
): AgendaActivityFact => ({
  slug: patch.id,
  status: 'SCHEDULED',
  startsAt: em('10:00'),
  endsAt: em('11:00'),
  type: 'LECTURE',
  roomName: null,
  workloadMinutes: 60,
  ...patch,
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Sobreposição
// ═══════════════════════════════════════════════════════════════════════════════
describe('sobreposição de horários (FASE 65)', () => {
  it('ENCOSTAR não é choque: quem termina quando o outro começa está em sequência', () => {
    const primeira = intervalo('10:00', '11:00');
    const segunda = intervalo('11:00', '12:00');

    expect(intervalsOverlap(primeira, segunda)).toBe(false);
    // ...mas o sistema SABE que estão emendadas: são informações diferentes.
    expect(intervalsTouch(primeira, segunda)).toBe(true);
  });

  it('CONTER é choque, nas duas direções, e a relação é simétrica', () => {
    const longo = intervalo('14:00', '18:00');
    const curto = intervalo('15:00', '16:00');

    expect(intervalsOverlap(longo, curto)).toBe(true);
    expect(intervalsOverlap(curto, longo)).toBe(true);

    expect(containsInterval(longo, curto)).toBe(true);
    expect(containsInterval(curto, longo)).toBe(false);
  });

  it('IDÊNTICOS são choque, e cada um contém o outro', () => {
    const a = intervalo('15:00', '16:00');
    const b = intervalo('15:00', '16:00');

    expect(intervalsOverlap(a, b)).toBe(true);
    expect(containsInterval(a, b)).toBe(true);
    expect(containsInterval(b, a)).toBe(true);
  });

  it('Sobreposição parcial (um minuto basta) é choque', () => {
    expect(intervalsOverlap(intervalo('15:00', '16:30'), intervalo('16:00', '17:00'))).toBe(true);
    expect(intervalsOverlap(intervalo('15:00', '16:00'), intervalo('16:01', '17:00'))).toBe(false);
  });

  it('SEM HORÁRIO não choca com nada — nem consigo mesmo', () => {
    const semHorario = intervalo(null, null);
    const soComeco = intervalo('10:00', null);
    const comHorario = intervalo('10:00', '11:00');

    for (const candidato of [semHorario, soComeco]) {
      expect(intervalsOverlap(candidato, comHorario)).toBe(false);
      expect(intervalsOverlap(comHorario, candidato)).toBe(false);
      expect(intervalsOverlap(candidato, candidato)).toBe(false);
      expect(intervalsTouch(candidato, comHorario)).toBe(false);
      expect(containsInterval(candidato, comHorario)).toBe(false);
      expect(containsInterval(comHorario, candidato)).toBe(false);
    }
  });

  it('INSTANTE (duração zero) segue a MESMA régua das bordas', () => {
    const ponto = intervalo('15:00', '15:00');

    expect(isPointInTime(ponto)).toBe(true);
    // Dentro do intervalo do outro: o ponto cai no meio do que ele ocupa.
    expect(intervalsOverlap(ponto, intervalo('14:00', '16:00'))).toBe(true);
    expect(intervalsOverlap(intervalo('14:00', '16:00'), ponto)).toBe(true);
    // Sobre a borda: encostar não é choque — e vale para o ponto também.
    expect(intervalsOverlap(ponto, intervalo('15:00', '16:00'))).toBe(false);
    expect(intervalsOverlap(intervalo('14:00', '15:00'), ponto)).toBe(false);
    expect(isPointInTime(intervalo('15:00', '16:00'))).toBe(false);
  });

  it('a lista de PARES enxerga quem está ESCONDIDO atrás do mais longo', () => {
    /**
     * ─── O CASO QUE A VARREDURA DE VIZINHOS PERDE ──────────────────────────────
     * Um minicurso de 14:00 às 18:00 seguido de três palestras dentro dele. A
     * varredura "compare com o anterior" só acharia UMA colisão; o participante
     * precisa ver as TRÊS, porque as três disputam o mesmo tempo.
     */
    const itens = [
      { id: 'minicurso', ...intervalo('14:00', '18:00') },
      { id: 'palestra-a', ...intervalo('15:00', '15:30') },
      { id: 'palestra-b', ...intervalo('16:00', '16:30') },
      { id: 'palestra-c', ...intervalo('17:00', '17:30') },
      { id: 'abertura', ...intervalo('09:00', '10:00') },
    ];

    const pares = findOverlapPairs(itens, (item) => item);

    expect(pares).toHaveLength(3);
    expect(pares.map((par) => [par.first.id, par.second.id])).toEqual([
      ['minicurso', 'palestra-a'],
      ['minicurso', 'palestra-b'],
      ['minicurso', 'palestra-c'],
    ]);
  });

  it('sem pares quando ninguém se sobrepõe (grade em sequência)', () => {
    const itens = [
      { id: 'a', ...intervalo('09:00', '10:00') },
      { id: 'b', ...intervalo('10:00', '11:00') },
      { id: 'c', ...intervalo('11:00', '12:00') },
    ];

    expect(findOverlapPairs(itens, (item) => item)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A grade
// ═══════════════════════════════════════════════════════════════════════════════
describe('"minha grade" — união, marcas e choques (FASE 65)', () => {
  const evento = {
    timezone: 'America/Bahia',
    activities: [
      atividade({ id: 'so-favorito', title: 'Só favorito', startsAt: em('13:00'), endsAt: em('14:00') }),
      atividade({ id: 'so-inscrito', title: 'Só inscrito', startsAt: em('15:00'), endsAt: em('16:00') }),
      atividade({ id: 'os-dois', title: 'Os dois', startsAt: em('17:00'), endsAt: em('18:00') }),
      atividade({ id: 'intocada', title: 'Intocada', startsAt: em('19:00'), endsAt: em('20:00') }),
    ],
    favoriteActivityIds: ['so-favorito', 'os-dois'],
    registrations: [
      { activityId: 'so-inscrito', status: 'CONFIRMED' as const },
      { activityId: 'os-dois', status: 'CONFIRMED' as const },
    ],
  };

  it('a união traz só o que a pessoa tocou, com a marca de cada um', () => {
    const grade = buildMyAgenda(evento);

    expect(grade.entries.map((item) => item.activityId)).toEqual(['so-favorito', 'so-inscrito', 'os-dois']);
    expect(grade.entries.map((item) => item.mark)).toEqual([
      'FAVORITO',
      'INSCRITO',
      'INSCRITO_E_FAVORITO',
    ]);
    expect(grade.entries.map((item) => item.markLabel)).toEqual([
      AGENDA_MARK_LABELS.FAVORITO,
      AGENDA_MARK_LABELS.INSCRITO,
      AGENDA_MARK_LABELS.INSCRITO_E_FAVORITO,
    ]);

    // A atividade que a pessoa não marcou nem inscreveu NÃO é agenda dela.
    expect(grade.entries.some((item) => item.activityId === 'intocada')).toBe(false);
    expect(grade.counts).toEqual({ entries: 3, registered: 2, favorited: 2, both: 1, clashPairs: 0 });
  });

  it('FAVORITO não tem lugar: a marca diz "favorito" e a inscrição continua ausente', () => {
    const grade = buildMyAgenda(evento);
    const favorito = grade.entries[0]!;

    expect(favorito.favorited).toBe(true);
    expect(favorito.registered).toBe(false);
    expect(favorito.registrationStatus).toBeNull();
  });

  it('inscrição CANCELADA (ou NO_SHOW) não é lugar — a MESMA régua do índice do banco', () => {
    const grade = buildMyAgenda({
      ...evento,
      favoriteActivityIds: [],
      registrations: [
        { activityId: 'so-inscrito', status: 'CANCELED' },
        { activityId: 'os-dois', status: 'NO_SHOW' },
      ],
    });

    expect(grade.entries).toEqual([]);
    expect(grade.counts.entries).toBe(0);
  });

  it('WAITLISTED é inscrição VIVA: entra na grade, com o estado à mão da tela', () => {
    const grade = buildMyAgenda({
      ...evento,
      favoriteActivityIds: [],
      registrations: [{ activityId: 'so-inscrito', status: 'WAITLISTED' }],
    });

    expect(grade.entries).toHaveLength(1);
    expect(grade.entries[0]!.mark).toBe('INSCRITO');
    expect(grade.entries[0]!.registrationStatus).toBe('WAITLISTED');
  });

  it('atividade em RASCUNHO não entra — nem favoritada, nem inscrita', () => {
    const grade = buildMyAgenda({
      ...evento,
      activities: [
        ...evento.activities,
        atividade({ id: 'rascunho', title: 'Rascunho', status: 'DRAFT' }),
      ],
      favoriteActivityIds: [...evento.favoriteActivityIds, 'rascunho'],
      registrations: [...evento.registrations, { activityId: 'rascunho', status: 'CONFIRMED' }],
    });

    expect(grade.entries.some((item) => item.activityId === 'rascunho')).toBe(false);
    expect(isOnAgenda('DRAFT')).toBe(false);
    expect(isOnAgenda('CANCELED')).toBe(true);
  });

  it('a ordem é pelo INÍCIO, e os rótulos saem no FUSO DO EVENTO', () => {
    const grade = buildMyAgenda({
      timezone: 'America/Bahia',
      activities: [
        // 21:00Z = 18:00 em Salvador (UTC-3).
        atividade({ id: 'tarde', title: 'Tarde', startsAt: em('21:00'), endsAt: em('22:00') }),
        atividade({ id: 'manha', title: 'Manhã', startsAt: em('12:00'), endsAt: em('13:00') }),
      ],
      favoriteActivityIds: ['tarde', 'manha'],
      registrations: [],
    });

    expect(grade.entries.map((item) => item.activityId)).toEqual(['manha', 'tarde']);
    expect(grade.entries[1]!.startsAtLabel).toBe('01/12/2026, 18:00');
    expect(grade.entries[0]!.startsAtLabel).toBe('01/12/2026, 09:00');
    expect(grade.entries[1]!.endsAtLabel).toBe('01/12/2026, 19:00');
  });

  it('empate de horário é desempatado pelo título (ordem estável)', () => {
    const grade = buildMyAgenda({
      timezone: 'UTC',
      activities: [
        atividade({ id: 'b', title: 'Beta', startsAt: em('10:00'), endsAt: em('11:00') }),
        atividade({ id: 'a', title: 'Alfa', startsAt: em('10:00'), endsAt: em('11:00') }),
      ],
      favoriteActivityIds: ['b', 'a'],
      registrations: [],
    });

    expect(grade.entries.map((item) => item.title)).toEqual(['Alfa', 'Beta']);
  });

  it('fuso inválido cai em UTC em vez de derrubar a leitura', () => {
    const grade = buildMyAgenda({
      timezone: 'America/Bahiaa',
      activities: [atividade({ id: 'a', title: 'A', startsAt: em('21:00'), endsAt: em('22:00') })],
      favoriteActivityIds: ['a'],
      registrations: [],
    });

    expect(grade.timezone).toBe('UTC');
    expect(grade.entries[0]!.startsAtLabel).toBe('01/12/2026, 21:00');
  });

  it('os CHOQUES saem em pares, com os dois títulos, e marcam os dois itens', () => {
    const grade = buildMyAgenda({
      timezone: 'UTC',
      activities: [
        atividade({ id: 'longo', title: 'Minicurso', startsAt: em('14:00'), endsAt: em('18:00') }),
        atividade({ id: 'dentro', title: 'Palestra', startsAt: em('15:00'), endsAt: em('16:00') }),
        atividade({ id: 'sequencia', title: 'Encerramento', startsAt: em('18:00'), endsAt: em('19:00') }),
      ],
      favoriteActivityIds: ['longo', 'dentro', 'sequencia'],
      registrations: [],
    });

    expect(grade.clashes).toEqual([
      {
        firstActivityId: 'longo',
        secondActivityId: 'dentro',
        firstTitle: 'Minicurso',
        secondTitle: 'Palestra',
      },
    ]);
    expect(grade.counts.clashPairs).toBe(1);

    const porId = new Map(grade.entries.map((item) => [item.activityId, item]));
    expect(porId.get('longo')!.hasClash).toBe(true);
    expect(porId.get('dentro')!.hasClash).toBe(true);
    // 18:00 é o FIM do minicurso e o INÍCIO do encerramento: emendado, não colidido.
    expect(porId.get('sequencia')!.hasClash).toBe(false);
  });

  it('atividade CANCELADA fica na grade mas NÃO gera choque', () => {
    const grade = buildMyAgenda({
      timezone: 'UTC',
      activities: [
        atividade({
          id: 'cancelada',
          title: 'Cancelada',
          status: 'CANCELED',
          startsAt: em('15:00'),
          endsAt: em('16:00'),
        }),
        atividade({ id: 'viva', title: 'Viva', startsAt: em('15:00'), endsAt: em('16:00') }),
      ],
      favoriteActivityIds: ['cancelada', 'viva'],
      registrations: [],
    });

    expect(grade.entries.some((item) => item.activityId === 'cancelada')).toBe(true);
    expect(grade.clashes).toEqual([]);
    expect(grade.entries.every((item) => item.hasClash === false)).toBe(true);
  });

  it('grade vazia não é erro: zero itens, zero choques', () => {
    const grade = buildMyAgenda({
      timezone: 'America/Bahia',
      activities: evento.activities,
      favoriteActivityIds: [],
      registrations: [],
    });

    expect(grade.entries).toEqual([]);
    expect(grade.clashes).toEqual([]);
    expect(grade.counts).toEqual({ entries: 0, registered: 0, favorited: 0, both: 0, clashPairs: 0 });
  });

  it('a marca das duas bandeiras é uma só (não há quarto estado)', () => {
    expect(agendaMarkOf(true, true)).toBe('INSCRITO_E_FAVORITO');
    expect(agendaMarkOf(true, false)).toBe('INSCRITO');
    expect(agendaMarkOf(false, true)).toBe('FAVORITO');
  });
});
