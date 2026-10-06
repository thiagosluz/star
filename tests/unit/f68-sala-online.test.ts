/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O ENDEREÇO DA SALA ONLINE (FASE 68 · fatias 2 e 3)
 *
 *  Duas perguntas, provadas sem banco e sem navegador:
 *
 *    • **que endereço é um endereço?** — só `http`/`https` pode virar link; o resto
 *      é recusado com o motivo (é o que impede `javascript:` de virar `href`);
 *    • **quem vê?** — inscrição `CONFIRMED` e inscrição retendo vaga (`PENDING`) veem;
 *      a **lista de espera NÃO vê**; a equipe vê; o anônimo não vê; e a inscrição de
 *      OUTRA instituição chega aqui como `null` (a leitura é por instituição), que é
 *      exatamente "não vê" — a prova de banco é a de integração.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { registrationIsLive, type RegistrationStatus } from '../../src/domain/events/registration-rules';
import {
  parseOnlineRoomUrl,
  registrationSeesOnlineRoom,
  seesActivityOnlineRoom,
  seesEventOnlineRoom,
  type OnlineRoomViewer,
} from '../../src/domain/events/online-room-rules';

/** O visitante SEM nada: nem sessão, nem inscrição, nem papel. */
const ANONIMO: OnlineRoomViewer = {
  isEventTeam: false,
  eventRegistration: null,
  activityRegistrations: new Map(),
};

function espectador(input: {
  isEventTeam?: boolean;
  evento?: RegistrationStatus | null;
  atividades?: Record<string, RegistrationStatus>;
}): OnlineRoomViewer {
  return {
    isEventTeam: input.isEventTeam ?? false,
    eventRegistration: input.evento ?? null,
    activityRegistrations: new Map(Object.entries(input.atividades ?? {})),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('o endereço da sala online como endereço', () => {
  it('aceita http e https', () => {
    expect(parseOnlineRoomUrl('https://sala.exemplo.com/entrar')).toEqual({
      ok: true,
      url: 'https://sala.exemplo.com/entrar',
    });
    expect(parseOnlineRoomUrl('http://10.0.0.2:8080/aula')).toEqual({
      ok: true,
      url: 'http://10.0.0.2:8080/aula',
    });
  });

  it('vazio é LIMPAR o campo, e não erro', () => {
    expect(parseOnlineRoomUrl('')).toEqual({ ok: true, url: null });
    expect(parseOnlineRoomUrl('   ')).toEqual({ ok: true, url: null });
    expect(parseOnlineRoomUrl(null)).toEqual({ ok: true, url: null });
    expect(parseOnlineRoomUrl(undefined)).toEqual({ ok: true, url: null });
  });

  it('recusa javascript: e data: — os dois que virariam link executável', () => {
    const script = parseOnlineRoomUrl('javascript:alert(1)');
    const dados = parseOnlineRoomUrl('data:text/html,<script>alert(1)</script>');

    expect(script.ok).toBe(false);
    expect(dados.ok).toBe(false);

    if (script.ok || dados.ok) return;

    /** A recusa EXPLICA: o organizador colou algo que não é um endereço de sala. */
    expect(script.message).toContain('http');
    expect(dados.message).toContain('http');
  });

  it('recusa o que não é endereço absoluto', () => {
    for (const entrada of ['sala.exemplo.com', '//sala.exemplo.com', '/entrar', 'ftp://sala.exemplo.com']) {
      expect(parseOnlineRoomUrl(entrada).ok, entrada).toBe(false);
    }
  });

  it('recusa acima do teto da coluna em vez de estourar no banco', () => {
    const gigante = `https://sala.exemplo.com/${'a'.repeat(1100)}`;

    expect(parseOnlineRoomUrl(gigante).ok).toBe(false);
  });

  it('apara os espaços das pontas (o colar do organizador traz espaço)', () => {
    expect(parseOnlineRoomUrl('  https://sala.exemplo.com/entrar  ')).toEqual({
      ok: true,
      url: 'https://sala.exemplo.com/entrar',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a inscrição que dá lugar na sala', () => {
  it('confirmada vê', () => {
    expect(registrationSeesOnlineRoom('CONFIRMED')).toBe(true);
  });

  it('retendo vaga (PENDING, FASE 34) vê — a vaga está reservada para ela', () => {
    expect(registrationSeesOnlineRoom('PENDING')).toBe(true);
  });

  it('quem já esteve na sala (ATTENDED) continua vendo', () => {
    expect(registrationSeesOnlineRoom('ATTENDED')).toBe(true);
  });

  it('LISTA DE ESPERA NÃO VÊ — e é a única situação viva que fica de fora', () => {
    /**
     * A régua vem de `registrationIsLive` (a fonte única do que é inscrição viva, e a
     * mesma definição do índice único parcial do banco): a espera É viva, e mesmo
     * assim não recebe o endereço — quem espera não tem lugar, e a fila pode nunca
     * andar.
     */
    expect(registrationIsLive('WAITLISTED')).toBe(true);
    expect(registrationSeesOnlineRoom('WAITLISTED')).toBe(false);
  });

  it('cancelada e ausente não veem', () => {
    expect(registrationSeesOnlineRoom('CANCELED')).toBe(false);
    expect(registrationSeesOnlineRoom('NO_SHOW')).toBe(false);
    expect(registrationSeesOnlineRoom(null)).toBe(false);
    expect(registrationSeesOnlineRoom(undefined)).toBe(false);
  });

  /**
   * CATRACA: a lista de situações que veem é EXATAMENTE esta. Sem ela, acrescentar uma
   * situação a `registrationIsLive` (ou relaxar a exclusão da espera) passaria
   * despercebido — e o endereço da sala iria para mais gente do que a decisão permite.
   */
  it('as situações que veem são exatamente PENDING, CONFIRMED e ATTENDED', () => {
    const todas: RegistrationStatus[] = [
      'PENDING',
      'CONFIRMED',
      'WAITLISTED',
      'CANCELED',
      'ATTENDED',
      'NO_SHOW',
    ];

    expect(todas.filter((status) => registrationSeesOnlineRoom(status))).toEqual([
      'PENDING',
      'CONFIRMED',
      'ATTENDED',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('quem vê o endereço do EVENTO', () => {
  it('a equipe vê, mesmo sem inscrição nenhuma', () => {
    expect(seesEventOnlineRoom(espectador({ isEventTeam: true }))).toBe(true);
  });

  it('a inscrição viva no evento vê — e a espera não', () => {
    expect(seesEventOnlineRoom(espectador({ evento: 'CONFIRMED' }))).toBe(true);
    expect(seesEventOnlineRoom(espectador({ evento: 'PENDING' }))).toBe(true);
    expect(seesEventOnlineRoom(espectador({ evento: 'WAITLISTED' }))).toBe(false);
  });

  it('o anônimo não vê', () => {
    expect(seesEventOnlineRoom(ANONIMO)).toBe(false);
  });

  it('a inscrição de OUTRA instituição não vê — ela nem chega aqui (chega como null)', () => {
    /**
     * A leitura é feita sob o contexto de UMA instituição (`withTenant`), então a
     * inscrição de outra nunca é devolvida: o que a régua recebe é `null`, que é
     * indistinguível de "não se inscreveu" — e é a resposta certa. A prova de banco
     * está em `tests/integration/f68-sala-online.test.ts`.
     */
    expect(seesEventOnlineRoom(espectador({ evento: null }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('quem vê o endereço da ATIVIDADE', () => {
  const FECHADA = { id: 'atividade-1', requiresRegistration: true };
  const ABERTA = { id: 'atividade-1', requiresRegistration: false };

  it('a inscrição NA atividade vê — inclusive retendo vaga', () => {
    expect(seesActivityOnlineRoom(espectador({ atividades: { 'atividade-1': 'CONFIRMED' } }), FECHADA)).toBe(true);
    expect(seesActivityOnlineRoom(espectador({ atividades: { 'atividade-1': 'PENDING' } }), FECHADA)).toBe(true);
  });

  it('a espera NA atividade não vê', () => {
    expect(seesActivityOnlineRoom(espectador({ atividades: { 'atividade-1': 'WAITLISTED' } }), FECHADA)).toBe(false);
  });

  it('atividade ABERTA é liberada pela inscrição no EVENTO (o público dela é o do evento)', () => {
    expect(seesActivityOnlineRoom(espectador({ evento: 'CONFIRMED' }), ABERTA)).toBe(true);
  });

  it('atividade com inscrição PRÓPRIA não é liberada pela inscrição no evento', () => {
    /**
     * Quem se inscreveu no evento mas não no minicurso NÃO tem lugar naquela sala — e o
     * endereço é o que se dá a quem tem. É a diferença entre "aberta a todos os
     * inscritos" (revisão da FASE 3) e uma atividade com vagas próprias.
     */
    expect(seesActivityOnlineRoom(espectador({ evento: 'CONFIRMED' }), FECHADA)).toBe(false);
  });

  it('a inscrição de OUTRA atividade não abre esta', () => {
    expect(
      seesActivityOnlineRoom(espectador({ atividades: { 'atividade-2': 'CONFIRMED' } }), FECHADA),
    ).toBe(false);
  });

  it('a equipe vê todas, inclusive as fechadas', () => {
    expect(seesActivityOnlineRoom(espectador({ isEventTeam: true }), FECHADA)).toBe(true);
    expect(seesActivityOnlineRoom(espectador({ isEventTeam: true }), ABERTA)).toBe(true);
  });

  it('o anônimo não vê nenhuma', () => {
    expect(seesActivityOnlineRoom(ANONIMO, FECHADA)).toBe(false);
    expect(seesActivityOnlineRoom(ANONIMO, ABERTA)).toBe(false);
  });
});
