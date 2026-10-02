/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — A OCULTAÇÃO DO PERFIL VALE PARA QUEM CITA A PESSOA
 *  (FASE 60 · dívida E79)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM, E POR QUE CADA UM IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a pergunta "esta pessoa está visível?" tem UMA resposta, e ela é
 *      fail-closed: sem a coluna (`undefined`), a resposta é "não visível";
 *    • a vitrine da equipe deixa de citar quem a moderação ocultou — inclusive
 *      quando a pessoa está em DUAS equipes (o filtro é antes do agrupamento);
 *    • uma equipe inteira oculta não vira "equipe com gente": ela não segura
 *      posição nem produz bloco vazio na página pública;
 *    • o e-mail de quem está oculto nem é PEDIDO ao repositório: o dado não sai
 *      da camada de baixo para ser descartado depois (mesma régua do e-mail de
 *      quem não autorizou contato).
 *
 *  O que só o banco prova (a coluna, a leitura real e o efeito da decisão) está
 *  em `tests/integration/f60-ocultacao-do-perfil.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

import { buildPublicTeam, type PublicTeamSource } from '../../src/domain/events/team-rules';
import {
  DEFAULT_PROFILE_AUDIENCES,
  isPersonPubliclyVisible,
  type ProfileAudience,
  type PublicProfileField,
} from '../../src/domain/profile/public-profile-rules';

/** Matriz com TODOS os campos no mesmo nível — o jeito curto de montar cenário. */
function matrix(value: ProfileAudience): Record<PublicProfileField, ProfileAudience> {
  return Object.fromEntries(
    Object.keys(DEFAULT_PROFILE_AUDIENCES).map((field) => [field, value]),
  ) as Record<PublicProfileField, ProfileAudience>;
}

/** A data da decisão de moderação: o conteúdo é irrelevante, o FATO é o que conta. */
const OCULTADA_EM = new Date('2026-05-04T12:00:00Z');

function vitrine(input: {
  teams: {
    id: string;
    name: string;
    isActive?: boolean;
    members: {
      userId: string;
      name: string;
      isLead?: boolean;
      avatarUrl?: string | null;
      publicProfileHiddenAt?: Date | null;
    }[];
  }[];
}) {
  const teams: PublicTeamSource[] = input.teams.map((team) => ({
    id: team.id,
    name: team.name,
    isActive: team.isActive ?? true,
    displayOrder: 0,
    members: team.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      isLead: member.isLead ?? false,
      avatarUrl: member.avatarUrl ?? null,
      contacts: { email: null, links: {} },
      publicProfileHiddenAt: member.publicProfileHiddenAt ?? null,
    })),
  }));

  return teams;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('a fonte única da visibilidade da pessoa', () => {
  it('sem decisão de moderação (`null`), a pessoa está visível', () => {
    expect(isPersonPubliclyVisible({ publicProfileHiddenAt: null })).toBe(true);
  });

  it('qualquer data registrada significa ocultada — e a data não é a régua', () => {
    expect(isPersonPubliclyVisible({ publicProfileHiddenAt: OCULTADA_EM })).toBe(false);
    expect(isPersonPubliclyVisible({ publicProfileHiddenAt: new Date('2020-01-01T00:00:00Z') })).toBe(
      false,
    );
  });

  it('coluna AUSENTE cai para "não visível": falha fechada, e não vazamento', () => {
    /**
     * O caso é o `select` que esquece a coluna. Tratar `undefined` como visível
     * publicaria a identidade de quem a moderação tirou do ar — o defeito que a
     * dívida E79 descreve. A resposta segura é sumir da vitrine (invariante nº 4).
     */
    expect(isPersonPubliclyVisible({} as { publicProfileHiddenAt: Date | null })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a vitrine da equipe respeita a ocultação', () => {
  const audiences = () => matrix('PUBLIC');

  it('quem foi ocultado NÃO vira cartão — nem o nome, nem a etiqueta, nem a foto', () => {
    const teams = vitrine({
      teams: [
        {
          id: 't-presidencia',
          name: 'Presidência',
          members: [
            { userId: 'u-ana', name: 'Ana Souza', isLead: true },
            {
              userId: 'u-bruno',
              name: 'Bruno Lima',
              avatarUrl: 'https://x/bruno.png',
              publicProfileHiddenAt: OCULTADA_EM,
            },
          ],
        },
      ],
    });

    const cards = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => null });

    expect(cards.map((card) => card.name)).toEqual(['Ana Souza']);
    expect(JSON.stringify(cards)).not.toContain('Bruno');
  });

  it('quem está oculto e em DUAS equipes não aparece por nenhuma delas', () => {
    /**
     * O filtro acontece ANTES do agrupamento. Se ele estivesse dentro do laço que
     * monta o cartão, a segunda equipe ainda poderia produzir a etiqueta — e a
     * pessoa voltaria à vitrine citada pelo nome.
     */
    const teams = vitrine({
      teams: [
        {
          id: 't-a',
          name: 'Apoio',
          members: [
            { userId: 'u-ana', name: 'Ana Souza', publicProfileHiddenAt: OCULTADA_EM },
            { userId: 'u-carla', name: 'Carla Nunes' },
          ],
        },
        {
          id: 't-b',
          name: 'Programação',
          members: [{ userId: 'u-ana', name: 'Ana Souza', publicProfileHiddenAt: OCULTADA_EM }],
        },
      ],
    });

    const cards = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => null });

    expect(cards.map((card) => card.userId)).toEqual(['u-carla']);
    expect(cards.flatMap((card) => card.labels)).not.toContain('Programação');
  });

  it('equipe só com gente oculta não é "equipe com gente" — não segura posição', () => {
    const teams = vitrine({
      teams: [
        {
          id: 't-oculta',
          name: 'Apoio',
          members: [{ userId: 'u-bruno', name: 'Bruno Lima', publicProfileHiddenAt: OCULTADA_EM }],
        },
        { id: 't-visivel', name: 'Presidência', members: [{ userId: 'u-ana', name: 'Ana Souza' }] },
      ],
    });

    const cards = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => null });

    expect(cards.map((card) => card.name)).toEqual(['Ana Souza']);
    expect(cards.flatMap((card) => card.labels)).not.toContain('Apoio');
  });

  it('o e-mail de quem está oculto nem é PEDIDO ao repositório', () => {
    const emailOf = vi.fn(() => 'bruno@exemplo.test');

    const teams = vitrine({
      teams: [
        {
          id: 't-presidencia',
          name: 'Presidência',
          members: [
            { userId: 'u-ana', name: 'Ana Souza' },
            { userId: 'u-bruno', name: 'Bruno Lima', publicProfileHiddenAt: OCULTADA_EM },
          ],
        },
      ],
    });

    buildPublicTeam({ teams, audiencesOf: audiences, emailOf });

    expect(emailOf).toHaveBeenCalledWith('u-ana');
    expect(emailOf).not.toHaveBeenCalledWith('u-bruno');
  });

  it('a pessoa visível continua na vitrine com foto e líder — a régua não mudou', () => {
    const teams = vitrine({
      teams: [
        {
          id: 't-presidencia',
          name: 'Presidência',
          members: [
            {
              userId: 'u-ana',
              name: 'Ana Souza',
              isLead: true,
              avatarUrl: 'https://x/ana.png',
              publicProfileHiddenAt: null,
            },
          ],
        },
      ],
    });

    const cards = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => 'ana@exemplo.test' });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.avatarUrl).toBe('https://x/ana.png');
    expect(cards[0]?.isLead).toBe(true);
    expect(cards[0]?.email).toBe('ana@exemplo.test');
  });
});
