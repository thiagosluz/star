/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — ORDEM MANUAL DAS EQUIPES (FASE 51 · dívida E63)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • **sem ordem, nada muda**: todas as equipes em `displayOrder = 0` continuam na
 *      ordem alfabética que a vitrine já tinha — a fase não pode reordenar a página
 *      de quem não pediu nada;
 *    • **com ordem manual, ela manda**, e quem não foi ordenado vem DEPOIS (a equipe
 *      nova entra no fim, não no meio da lista que o organizador montou);
 *    • **dentro da equipe o líder vem primeiro**, e o resto continua alfabético;
 *    • **empate é determinístico**: nome e, por fim, id — sem o id a grade trocaria
 *      de lugar entre duas requisições;
 *    • **a reescrita não produz empate** (10, 20, 30…), que é o que impede um
 *      movimento de virar um no-op silencioso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  compareTeamsForDisplay,
  orderTeamsForDisplay,
  planTeamOrder,
  TEAM_ORDER_STEP,
  type TeamOrderLike,
} from '../../src/domain/events/team-order-rules';
import { buildPublicTeam, type PublicTeamSource } from '../../src/domain/events/team-rules';
import { DEFAULT_PROFILE_AUDIENCES } from '../../src/domain/profile/public-profile-rules';
import type { ProfileAudience, PublicProfileField } from '../../src/domain/profile/public-profile-rules';

function team(id: string, name: string, displayOrder = 0): TeamOrderLike {
  return { id, name, displayOrder };
}

/** Matriz de visibilidade com TODOS os campos públicos. */
function publicMatrix(): Record<PublicProfileField, ProfileAudience> {
  return Object.fromEntries(
    Object.keys(DEFAULT_PROFILE_AUDIENCES).map((field) => [field, 'PUBLIC']),
  ) as Record<PublicProfileField, ProfileAudience>;
}

function vitrine(input: {
  id: string;
  name: string;
  displayOrder?: number;
  members: { userId: string; name: string; isLead?: boolean }[];
}): PublicTeamSource {
  return {
    id: input.id,
    name: input.name,
    isActive: true,
    displayOrder: input.displayOrder ?? 0,
    members: input.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      isLead: member.isLead ?? false,
      avatarUrl: null,
      contacts: { email: null, links: {} },
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('o comparador da ordem das equipes', () => {
  it('sem ordem definida, mantém a ordem alfabética que já existia (pt-BR)', () => {
    const times = [team('t3', 'Programação'), team('t1', 'Presidência'), team('t2', 'Logística')];

    expect(orderTeamsForDisplay(times).map((t) => t.name)).toEqual([
      'Logística',
      'Presidência',
      'Programação',
    ]);
  });

  it('ordem manual manda: quem tem número vem antes, do menor para o maior', () => {
    const times = [
      team('t1', 'Apoio', 30),
      team('t2', 'Presidência', 10),
      team('t3', 'Diretoria', 20),
    ];

    expect(orderTeamsForDisplay(times).map((t) => t.name)).toEqual([
      'Presidência',
      'Diretoria',
      'Apoio',
    ]);
  });

  it('zero é "sem opinião": a equipe nunca ordenada fica DEPOIS das ordenadas', () => {
    const times = [team('t1', 'Apoio'), team('t2', 'Presidência', 10)];

    /** O alfabeto diria "Apoio" primeiro; a ordem manual inverte isso, e é o pedido. */
    expect(orderTeamsForDisplay(times).map((t) => t.name)).toEqual(['Presidência', 'Apoio']);
  });

  it('empate de ordem é resolvido por nome e, no fim, por id — determinístico', () => {
    const times = [team('t-b', 'Zebra', 10), team('t-a', 'Zebra', 10), team('t-c', 'Abelha', 10)];

    const first = orderTeamsForDisplay(times).map((t) => t.id);
    const again = orderTeamsForDisplay([...times].reverse()).map((t) => t.id);

    expect(first).toEqual(['t-c', 't-a', 't-b']);
    expect(again).toEqual(first);
  });

  it('o comparador é uma relação total: nenhum par devolve "empate" com id diferente', () => {
    const a = team('t-a', 'Mesma coisa', 5);
    const b = team('t-b', 'Mesma coisa', 5);

    expect(compareTeamsForDisplay(a, b)).toBeLessThan(0);
    expect(compareTeamsForDisplay(b, a)).toBeGreaterThan(0);
    expect(compareTeamsForDisplay(a, a)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a reescrita da ordem (mesma régua da FASE 38)', () => {
  it('reescreve de 10 em 10, sem empate', () => {
    const plano = planTeamOrder(['t1', 't2', 't3']);

    expect(plano.map((row) => row.displayOrder)).toEqual([10, 20, 30]);
    expect(TEAM_ORDER_STEP).toBe(10);
  });

  it('a ordem gravada é a ordem dada — inclusive ao mover uma equipe de lugar', () => {
    const plano = planTeamOrder(['t3', 't1', 't2']);

    expect(plano).toEqual([
      { id: 't3', displayOrder: 10 },
      { id: 't1', displayOrder: 20 },
      { id: 't2', displayOrder: 30 },
    ]);
  });

  it('lista vazia não inventa posição', () => {
    expect(planTeamOrder([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a vitrine pública obedece a ordem da equipe', () => {
  it('sem displayOrder, a ordem é a de antes (alfabética → líder → nome → id)', () => {
    const cards = buildPublicTeam({
      teams: [
        vitrine({
          id: 't-programacao',
          name: 'Programação',
          members: [
            { userId: 'u-bruno', name: 'Bruno Lima' },
            { userId: 'u-carla', name: 'Carla Nunes' },
          ],
        }),
        vitrine({
          id: 't-presidencia',
          name: 'Presidência',
          members: [{ userId: 'u-ana', name: 'Ana Souza', isLead: true }],
        }),
      ],
      audiencesOf: () => publicMatrix(),
      emailOf: () => null,
    });

    expect(cards.map((card) => card.name)).toEqual(['Ana Souza', 'Bruno Lima', 'Carla Nunes']);
  });

  it('com ordem manual, a equipe ordenada vem primeiro — e o líder continua à frente dentro dela', () => {
    const cards = buildPublicTeam({
      teams: [
        vitrine({
          id: 't-programacao',
          name: 'Programação',
          members: [
            { userId: 'u-bruno', name: 'Bruno Lima' },
            { userId: 'u-carla', name: 'Carla Nunes', isLead: true },
          ],
        }),
        vitrine({
          id: 't-presidencia',
          name: 'Presidência',
          displayOrder: 10,
          members: [
            { userId: 'u-ana', name: 'Ana Souza' },
            { userId: 'u-zeca', name: 'Zeca Prado', isLead: true },
          ],
        }),
      ],
      audiencesOf: () => publicMatrix(),
      emailOf: () => null,
    });

    /** Presidência inteira antes de Programação, e dentro de cada uma o líder primeiro. */
    expect(cards.map((card) => `${card.labels[0]}:${card.name}`)).toEqual([
      'Presidência:Zeca Prado',
      'Presidência:Ana Souza',
      'Programação:Carla Nunes',
      'Programação:Bruno Lima',
    ]);
  });

  it('pessoa em duas equipes fica na posição da PRIMEIRA equipe em que aparece', () => {
    const cards = buildPublicTeam({
      teams: [
        vitrine({
          id: 't-presidencia',
          name: 'Presidência',
          displayOrder: 10,
          members: [{ userId: 'u-ana', name: 'Ana Souza' }],
        }),
        vitrine({
          id: 't-apoio',
          name: 'Apoio',
          members: [{ userId: 'u-ana', name: 'Ana Souza' }],
        }),
      ],
      audiencesOf: () => publicMatrix(),
      emailOf: () => null,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.labels).toEqual(['Presidência', 'Apoio']);
  });

  it('a ordem é estável entre montagens — o id fecha o desempate', () => {
    const teams = [
      vitrine({ id: 't-b', name: 'Equipe', members: [{ userId: 'u-1', name: 'Ana' }] }),
      vitrine({ id: 't-a', name: 'Equipe', members: [{ userId: 'u-2', name: 'Bruno' }] }),
    ];

    const first = buildPublicTeam({ teams, audiencesOf: () => publicMatrix(), emailOf: () => null });
    const again = buildPublicTeam({
      teams: [...teams].reverse(),
      audiencesOf: () => publicMatrix(),
      emailOf: () => null,
    });

    expect(first.map((card) => card.userId)).toEqual(again.map((card) => card.userId));
  });
});
