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
 *  fatia 1, porque a fórmula é a mesma (`intervalsClash`); o que este arquivo prova é
 *  que a projeção da tela não inventa uma segunda resposta para elas — e que o aviso
 *  não bloqueia nada, porque nada aqui devolve "pode/não pode".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MARGEM DE DESLOCAMENTO NÃO APAGOU NENHUMA DESTAS BORDAS (E86 · FASE 69)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os casos da FASE 65 continuam rodando com a margem ZERO, que é a régua daquela
 *  fase — e é justamente isso que prova que a margem preserva o comportamento antigo
 *  em vez de reescrevê-lo. O outro lado (margem do dia a dia) é provado no arquivo da
 *  margem (`f69-margem-de-deslocamento.test.ts`) e nos casos marcados aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { buildMyAgenda, type AgendaActivityFact } from '../../src/domain/agenda/agenda-rules';
import { ROOM_TRAVEL_MARGIN_MINUTES } from '../../src/domain/agenda/overlap-rules';
import {
  agendaClashTitle,
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
  roomTravelMarginMinutes = 0,
): AgendaViewerItem[] {
  const grade = buildMyAgenda({
    timezone: 'America/Bahia',
    activities: atividades,
    favoriteActivityIds,
    registrations,
    roomTravelMarginMinutes,
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

  /**
   * ─── ESTE CASO PASSOU A DIZER "MARGEM ZERO" (FASE 69 · E86) ───────────────────
   *
   *  Ele nasceu na FASE 65 afirmando "encostar não é choque, ponto". Com a margem,
   *  encostar PASSA a ser conflito — é exatamente o caso que a dívida descreve (sai
   *  de uma sala e entra na outra no mesmo minuto). O que continua verdade, e é o que
   *  este caso prende, é que o DEFAULT ZERO da régua preserva o comportamento antigo:
   *  a margem foi ACRESCENTADA, não trocada. O caso com a margem do dia a dia
   *  (encostado = aviso) está no describe da margem, logo abaixo.
   */
  it('ENCOSTAR com margem ZERO não é choque: a régua da FASE 65 segue intacta', () => {
    const emendada = candidato({
      activityId: 'emendada',
      startsAt: em('10:00'),
      endsAt: em('11:00'),
    });

    expect(clashesWithAgenda(emendada, minhaGrade, 0)).toEqual([]);
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

// ═══════════════════════════════════════════════════════════════════════════════
//  A MARGEM DE DESLOCAMENTO ENTRE SALAS (E86 · FASE 69 · fatia 1)
// ═══════════════════════════════════════════════════════════════════════════════
describe('a margem de deslocamento no aviso da escolha (E86)', () => {
  /** 15:00–16:00 numa sala; a margem é o que decide o resto. */
  const candidatoDas15 = candidato({ activityId: 'nova' });

  /** Uma atividade das 16:00 às 17:00 — emendada com o candidato. */
  const gradeEmendada = gradeCom(
    [atividade({ id: 'depois', title: 'Palestra seguinte', startsAt: em('16:00'), endsAt: em('17:00') })],
    ['depois'],
    [],
    ROOM_TRAVEL_MARGIN_MINUTES,
  );

  it('MENOS que a margem avisa: encostado é conflito, e o aviso diz por quê', () => {
    /**
     * O caso da dívida, palavra por palavra: a Oficina termina 16:00 na sala A e a
     * Palestra começa 16:00 na sala B. Nenhum horário se sobrepõe — e ninguém
     * atravessa o campus em zero minuto.
     */
    expect(clashesWithAgenda(candidatoDas15, gradeEmendada).map((item) => item.activityId)).toEqual([
      'depois',
    ]);
  });

  it('o que ESTÁ DENTRO da margem avisa, com a distância real (10 < 15)', () => {
    const gradeDez = gradeCom(
      [
        atividade({
          id: 'dez',
          title: 'Mesa-redonda',
          startsAt: em('16:10'),
          endsAt: em('17:00'),
        }),
      ],
      ['dez'],
      [],
      ROOM_TRAVEL_MARGIN_MINUTES,
    );

    expect(clashesWithAgenda(candidatoDas15, gradeDez).map((item) => item.activityId)).toEqual(['dez']);
  });

  it('MAIS que a margem não avisa: 16:15 dá tempo de atravessar (15 não é menor que 15)', () => {
    const gradeQuinze = gradeCom(
      [
        atividade({
          id: 'quinze',
          title: 'Painel',
          startsAt: em('16:15'),
          endsAt: em('17:00'),
        }),
      ],
      ['quinze'],
      [],
      ROOM_TRAVEL_MARGIN_MINUTES,
    );

    expect(clashesWithAgenda(candidatoDas15, gradeQuinze)).toEqual([]);
  });

  it('a margem é SIMÉTRICA: os dois lados do par apontam um para o outro', () => {
    const oficina = candidato({ activityId: 'oficina', startsAt: em('15:00'), endsAt: em('16:00') });
    const palestra = candidato({ activityId: 'palestra', startsAt: em('16:00'), endsAt: em('17:00') });

    /** A grade de cada lado contém o OUTRO item, montada pelo domínio. */
    const gradeDaPalestra = gradeCom(
      [atividade({ id: 'oficina', title: 'Oficina', startsAt: em('15:00'), endsAt: em('16:00') })],
      ['oficina'],
      [],
      ROOM_TRAVEL_MARGIN_MINUTES,
    );
    const gradeDaOficina = gradeCom(
      [atividade({ id: 'palestra', title: 'Palestra', startsAt: em('16:00'), endsAt: em('17:00') })],
      ['palestra'],
      [],
      ROOM_TRAVEL_MARGIN_MINUTES,
    );

    expect(clashesWithAgenda(palestra, gradeDaPalestra).map((item) => item.activityId)).toEqual([
      'oficina',
    ]);
    expect(clashesWithAgenda(oficina, gradeDaOficina).map((item) => item.activityId)).toEqual([
      'palestra',
    ]);
  });

  it('item SEM HORÁRIO não avisa — nem como alvo, nem como candidato', () => {
    const semHorario = gradeCom(
      [atividade({ id: 'sem-hora', title: 'A definir', startsAt: null, endsAt: null })],
      ['sem-hora'],
      [],
      ROOM_TRAVEL_MARGIN_MINUTES,
    );

    expect(semHorario).toHaveLength(1);
    expect(clashesWithAgenda(candidatoDas15, semHorario)).toEqual([]);

    const candidatoSemHora = candidato({
      activityId: 'outra',
      startsAt: null,
      endsAt: null,
    });

    expect(clashesWithAgenda(candidatoSemHora, gradeEmendada)).toEqual([]);
  });

  it('a atividade CANCELADA continua fora do aviso, com ou sem margem', () => {
    const gradeCancelada = gradeCom(
      [
        atividade({
          id: 'cancelada',
          title: 'Cancelada',
          startsAt: em('16:00'),
          endsAt: em('17:00'),
          status: 'CANCELED',
        }),
      ],
      ['cancelada'],
      [],
      ROOM_TRAVEL_MARGIN_MINUTES,
    );

    expect(gradeCancelada).toHaveLength(1);
    expect(clashesWithAgenda(candidatoDas15, gradeCancelada)).toEqual([]);
  });

  it('o TEXTO do aviso diz que há margem e quantos minutos — o número vem do domínio', () => {
    const titulo = agendaClashTitle();

    expect(titulo).toContain('deslocamento');
    expect(titulo).toContain(`${ROOM_TRAVEL_MARGIN_MINUTES} minutos`);
    // O número é da CONSTANTE, e não um "15" digitado na frase: se a régua mudar,
    // este caso continua valendo e a frase acompanha.
    expect(titulo).toContain(String(ROOM_TRAVEL_MARGIN_MINUTES));
  });
});
