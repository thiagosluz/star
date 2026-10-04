/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O aviso de choque NA ESCOLHA (FASE 65 · fatia 2)
 *
 *  Sem banco e sem navegador. O que se prende aqui é a regra DE TELA que a fatia 1 não
 *  tinha: "esta atividade que estou VENDO choca com alguma coisa que eu já tenho?".
 *
 *  A diferença em relação à grade é o SUJEITO — na grade os dois lados são meus; aqui
 *  um lado é um candidato que pode nem estar marcado, e é isso que permite avisar ANTES
 *  do clique. As bordas (encostar, conter, idênticos, cancelada) são as MESMAS da
 *  fatia 1, porque a fórmula é a mesma (`intervalsOverlap`); o que este arquivo prova é
 *  que a projeção da tela não inventa uma segunda resposta para elas — e que o aviso
 *  não bloqueia nada, porque nada aqui devolve "pode/não pode".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { buildMyAgenda, type AgendaActivityFact } from '../../src/domain/agenda/agenda-rules';
import {
  buildEventAgendaView,
  clashTargetLabel,
  clashesWithAgenda,
  markPhrase,
  EMPTY_AGENDA_VIEW,
  type AgendaCandidate,
  type AgendaViewerItem,
} from '../../src/lib/events/agenda-view';

/** Instante UTC do dia de teste. */
const em = (hora: string, dia = '2026-12-01'): Date => new Date(`${dia}T${hora}:00.000Z`);

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

/** Um candidato da programação (o que a pessoa está olhando). */
const candidato = (patch: Partial<AgendaCandidate> & { activityId: string }): AgendaCandidate => ({
  startsAt: em('15:00'),
  endsAt: em('16:00'),
  status: 'SCHEDULED',
  ...patch,
});

/** Um item da minha grade, montado pelo DOMÍNIO (nada de fixture à mão). */
function gradeCom(
  atividades: AgendaActivityFact[],
  favoriteActivityIds: string[],
  registrations: { activityId: string; status: 'CONFIRMED' | 'WAITLISTED' }[] = [],
): AgendaViewerItem[] {
  const grade = buildMyAgenda({
    timezone: 'America/Bahia',
    activities: atividades,
    favoriteActivityIds,
    registrations,
  });

  return buildEventAgendaView({ authenticated: true, agenda: grade }).items as AgendaViewerItem[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  A visão que a programação pública recebe
// ═══════════════════════════════════════════════════════════════════════════════
describe('a visão de agenda da programação (FASE 65 · fatia 2)', () => {
  const atividades = [
    atividade({ id: 'palestra', title: 'Palestra', startsAt: em('15:00'), endsAt: em('16:00') }),
    atividade({
      id: 'oficina',
      title: 'Oficina',
      startsAt: em('17:00'),
      endsAt: em('18:00'),
      roomName: 'Sala 3',
    }),
  ];

  it('SEM SESSÃO não há agenda: nenhum item, nem com a grade cheia na mão', () => {
    const grade = buildMyAgenda({
      timezone: 'America/Bahia',
      activities: atividades,
      favoriteActivityIds: ['palestra'],
      registrations: [],
    });

    const visitante = buildEventAgendaView({ authenticated: false, agenda: grade });

    expect(visitante).toEqual(EMPTY_AGENDA_VIEW);
    expect(visitante.items).toEqual([]);
    expect(visitante.authenticated).toBe(false);
  });

  it('a grade vira visão com marca, rótulo de horário e estado da inscrição', () => {
    const itens = gradeCom(
      atividades,
      ['palestra'],
      [{ activityId: 'oficina', status: 'WAITLISTED' }],
    );

    const palestra = itens.find((item) => item.activityId === 'palestra')!;
    const oficina = itens.find((item) => item.activityId === 'oficina')!;

    expect(palestra.favorited).toBe(true);
    expect(palestra.registered).toBe(false);
    expect(palestra.mark).toBe('FAVORITO');
    expect(palestra.markLabel).toBe('Favorito');

    /** O rótulo vem no FUSO DO EVENTO (21:00Z = 18:00 em Salvador). */
    expect(oficina.registered).toBe(true);
    expect(oficina.registrationStatus).toBe('WAITLISTED');
    expect(oficina.roomName).toBe('Sala 3');
    expect(oficina.startsAtLabel).toBe('01/12/2026, 14:00');
  });

  it('`markPhrase` usa os rótulos do DOMÍNIO — não há um quarto nome para a mesma coisa', () => {
    expect(markPhrase(true, false)).toBe('Inscrito');
    expect(markPhrase(false, true)).toBe('Favorito');
    expect(markPhrase(true, true)).toBe('Inscrito e favorito');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O aviso de choque na escolha
// ═══════════════════════════════════════════════════════════════════════════════
describe('choque entre o candidato e a minha grade (FASE 65 · fatia 2)', () => {
  const minhaGrade = gradeCom(
    [
      atividade({ id: 'longo', title: 'Minicurso longo', startsAt: em('14:00'), endsAt: em('18:00') }),
      atividade({ id: 'antes', title: 'Palestra da manhã', startsAt: em('09:00'), endsAt: em('10:00') }),
      atividade({
        id: 'cancelada',
        title: 'Sessão cancelada',
        startsAt: em('15:00'),
        endsAt: em('16:00'),
        status: 'CANCELED',
      }),
    ],
    ['longo', 'antes', 'cancelada'],
  );

  it('CONTER é choque: a atividade que cai dentro do minicurso avisa com o título dele', () => {
    const choques = clashesWithAgenda(candidato({ activityId: 'nova' }), minhaGrade);

    expect(choques.map((item) => item.activityId)).toEqual(['longo']);
  });

  it('ENCOSTAR não é choque: quem começa quando a outra termina não gera aviso', () => {
    const emendada = candidato({
      activityId: 'emendada',
      startsAt: em('10:00'),
      endsAt: em('11:00'),
    });

    expect(clashesWithAgenda(emendada, minhaGrade)).toEqual([]);
  });

  it('IDÊNTICOS são choque, e o aviso aponta os dois lados', () => {
    const gemea = candidato({ activityId: 'gemea', startsAt: em('09:00'), endsAt: em('10:00') });

    expect(clashesWithAgenda(gemea, minhaGrade).map((item) => item.activityId)).toEqual(['antes']);
  });

  it('a atividade CANCELADA da minha grade não gera aviso — ela não vai acontecer', () => {
    /** 15:00–16:00 cai dentro do minicurso E é o horário exato da cancelada. */
    const choques = clashesWithAgenda(candidato({ activityId: 'nova' }), minhaGrade);

    expect(choques.some((item) => item.activityId === 'cancelada')).toBe(false);
  });

  it('a atividade CANCELADA que estou vendo não avisa contra nada', () => {
    const cancelada = candidato({ activityId: 'nova', status: 'CANCELED' });

    expect(clashesWithAgenda(cancelada, minhaGrade)).toEqual([]);
  });

  it('ela mesma não conta: o item já marcado não "choca consigo próprio"', () => {
    const jaNaGrade = candidato({
      activityId: 'longo',
      startsAt: em('14:00'),
      endsAt: em('18:00'),
    });

    expect(clashesWithAgenda(jaNaGrade, minhaGrade)).toEqual([]);
  });

  it('grade vazia (nada marcado, nada inscrito) não avisa nada', () => {
    expect(clashesWithAgenda(candidato({ activityId: 'nova' }), [])).toEqual([]);
  });

  it('o alvo do aviso sai por extenso: título, horário e sala', () => {
    const comSala = gradeCom(
      [atividade({ id: 'oficina', title: 'Oficina', roomName: 'Sala 3' })],
      ['oficina'],
    );

    /** 10:00Z–11:00Z = 07:00–08:00 em Salvador (UTC-3). */
    expect(clashTargetLabel(comSala[0]!)).toBe('Oficina (01/12/2026, 07:00 – 01/12/2026, 08:00 · Sala 3)');

    const semSalaNemHoraUnica = gradeCom(
      [atividade({ id: 'mesa', title: 'Mesa-redonda', startsAt: em('15:00'), endsAt: em('15:00') })],
      ['mesa'],
    );

    expect(clashTargetLabel(semSalaNemHoraUnica[0]!)).not.toContain('·');
  });
});
