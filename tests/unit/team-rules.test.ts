/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — EQUIPE DO EVENTO NA PÁGINA PÚBLICA (FASE 45)
 *
 *  O que estes testes prendem, e por que cada um importa:
 *
 *    • a vitrine é montada a partir das equipes do EVENTO, e pessoa em duas equipes
 *      aparece UMA vez com as duas etiquetas — repetir o cartão repetiria a foto;
 *    • **privacidade não se decide no cartão**: foto só com o campo `avatar` público
 *      e contato só com `contacts` público (que nasce fechado), e quem não autoriza
 *      cai nas iniciais;
 *    • a ordem é explicável e ESTÁVEL (líder primeiro, depois nome, depois id) — sem
 *      o id no fim, a grade trocaria de lugar a cada requisição;
 *    • os contatos aceitam só http(s) de host conhecido, e `javascript:` nunca vira
 *      link na página pública.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  buildPublicTeam,
  teamInitials,
  TEAM_CARD_LIMIT,
  type PublicTeamSource,
} from '../../src/domain/events/team-rules';
import {
  hasPublicContacts,
  readPublicContacts,
  sanitizePublicContacts,
  PUBLIC_CONTACT_FIELD,
} from '../../src/domain/profile/public-contacts';
import {
  DEFAULT_PROFILE_AUDIENCES,
  type ProfileAudience,
  type PublicProfileField,
} from '../../src/domain/profile/public-profile-rules';

/** Matriz com TODOS os campos no mesmo nível — o jeito curto de montar cenário. */
function matrix(value: ProfileAudience): Record<PublicProfileField, ProfileAudience> {
  return Object.fromEntries(
    Object.keys(DEFAULT_PROFILE_AUDIENCES).map((field) => [field, value]),
  ) as Record<PublicProfileField, ProfileAudience>;
}

function team(input: {
  id: string;
  name: string;
  isActive?: boolean;
  members: { userId: string; name: string; isLead?: boolean; avatarUrl?: string | null }[];
}): PublicTeamSource {
  return {
    id: input.id,
    name: input.name,
    isActive: input.isActive ?? true,
    members: input.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      isLead: member.isLead ?? false,
      avatarUrl: member.avatarUrl ?? null,
      contacts: { email: null, links: {} },
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('a vitrine da equipe', () => {
  const teams: PublicTeamSource[] = [
    team({
      id: 't-presidencia',
      name: 'Presidência',
      members: [{ userId: 'u-ana', name: 'Ana Souza', isLead: true, avatarUrl: 'https://x/ana.png' }],
    }),
    team({
      id: 't-programacao',
      name: 'Programação',
      members: [
        { userId: 'u-bruno', name: 'Bruno Lima', avatarUrl: 'https://x/bruno.png' },
        { userId: 'u-ana', name: 'Ana Souza' },
      ],
    }),
    team({
      id: 't-desativada',
      name: 'Equipe antiga',
      isActive: false,
      members: [{ userId: 'u-zeca', name: 'Zeca Antigo' }],
    }),
  ];

  const audiences = () => matrix('PUBLIC');

  it('equipe INATIVA não entra na vitrine, nem quem só está nela', () => {
    const cards = buildPublicTeam({
      teams,
      audiencesOf: audiences,
      emailOf: () => null,
    });

    expect(cards.map((card) => card.name)).not.toContain('Zeca Antigo');
    expect(cards.map((card) => card.name).sort()).toEqual(['Ana Souza', 'Bruno Lima']);
  });

  it('pessoa em DUAS equipes aparece uma vez, com as duas etiquetas', () => {
    const cards = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => null });
    const ana = cards.find((card) => card.userId === 'u-ana');

    expect(cards.filter((card) => card.userId === 'u-ana')).toHaveLength(1);
    expect(ana?.labels).toEqual(['Presidência', 'Programação']);
  });

  it('a ordem é: equipe (alfabética) → líder primeiro → nome → id', () => {
    const cards = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => null });

    /** Presidência (líder Ana) antes de Programação; dentro dela, o líder vem antes. */
    expect(cards.map((card) => card.name)).toEqual(['Ana Souza', 'Bruno Lima']);

    /** A ordem é ESTÁVEL: montar de novo devolve exatamente a mesma sequência. */
    const again = buildPublicTeam({ teams, audiencesOf: audiences, emailOf: () => null });
    expect(again.map((card) => card.userId)).toEqual(cards.map((card) => card.userId));
  });

  it('o líder de QUALQUER equipe do bloco fica à frente no cartão', () => {
    const cards = buildPublicTeam({
      teams: [
        team({
          id: 't-a',
          name: 'Apoio',
          members: [
            { userId: 'u-1', name: 'Ana' },
            { userId: 'u-2', name: 'Zeca', isLead: true },
          ],
        }),
      ],
      audiencesOf: audiences,
      emailOf: () => null,
    });

    expect(cards[0]?.name).toBe('Zeca');
  });

  it('o filtro por equipe mostra só aquela equipe', () => {
    const cards = buildPublicTeam({
      teams,
      audiencesOf: audiences,
      emailOf: () => null,
      teamId: 't-programacao',
    });

    expect(cards.map((card) => card.name).sort()).toEqual(['Ana Souza', 'Bruno Lima']);
    expect(cards.every((card) => card.labels.includes('Programação'))).toBe(true);
  });

  it('o teto de cartões existe: equipe de 400 pessoas não é vitrine, é lista', () => {
    const grande = team({
      id: 't-grande',
      name: 'Voluntariado',
      members: Array.from({ length: TEAM_CARD_LIMIT + 20 }, (_, index) => ({
        userId: `u-${String(index).padStart(3, '0')}`,
        name: `Pessoa ${String(index).padStart(3, '0')}`,
      })),
    });

    const cards = buildPublicTeam({ teams: [grande], audiencesOf: audiences, emailOf: () => null });
    expect(cards).toHaveLength(TEAM_CARD_LIMIT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('privacidade: o cartão NÃO decide, ele obedece à matriz', () => {
  const fonte: PublicTeamSource[] = [
    team({
      id: 't-1',
      name: 'Presidência',
      members: [
        {
          userId: 'u-ana',
          name: 'Ana Souza',
          isLead: true,
          avatarUrl: 'https://x/ana.png',
        },
      ],
    }),
  ];

  it('foto só sai com o campo `avatar` em PUBLIC — e sem ele vêm as iniciais', () => {
    const comFoto = buildPublicTeam({
      teams: fonte,
      audiencesOf: () => matrix('PUBLIC'),
      emailOf: () => null,
    });
    expect(comFoto[0]?.avatarUrl).toBe('https://x/ana.png');

    const semFoto = buildPublicTeam({
      teams: fonte,
      audiencesOf: () => ({ ...matrix('PUBLIC'), avatar: 'PRIVATE' }),
      emailOf: () => null,
    });
    expect(semFoto[0]?.avatarUrl).toBeNull();
    expect(teamInitials(semFoto[0]!.name)).toBe('AS');

    /**
     * `ATTENDEES_ONLY` não vale aqui: a página do evento é pública e não conhece o
     * visitante. Quem escolheu "só quem participa" não aparece para o anônimo — e o
     * cartão não pode fingir que sabe quem está olhando.
     */
    const soDaCasa = buildPublicTeam({
      teams: fonte,
      audiencesOf: () => ({ ...matrix('PUBLIC'), avatar: 'ATTENDEES_ONLY' }),
      emailOf: () => null,
    });
    expect(soDaCasa[0]?.avatarUrl).toBeNull();
  });

  it('contato sai SÓ com o campo próprio autorizado, e nunca por acidente', () => {
    const withContacts = fonte.map((entry) => ({
      ...entry,
      members: entry.members.map((member) => ({
        ...member,
        contacts: {
          email: 'ana@exemplo.test',
          links: { linkedin: 'https://www.linkedin.com/in/ana' },
        },
      })),
    }));

    const fechado = buildPublicTeam({
      teams: withContacts,
      audiencesOf: () => DEFAULT_PROFILE_AUDIENCES,
      emailOf: () => 'ana@exemplo.test',
    });

    /** O padrão do campo `contacts` é PRIVATE (ADR-139): nada sai. */
    expect(DEFAULT_PROFILE_AUDIENCES.contacts).toBe('PRIVATE');
    expect(fechado[0]?.email).toBeNull();
    expect(fechado[0]?.links).toEqual({});

    const aberto = buildPublicTeam({
      teams: withContacts,
      audiencesOf: () => ({ ...matrix('PUBLIC'), contacts: 'PUBLIC' }),
      emailOf: () => 'ana@exemplo.test',
    });

    expect(aberto[0]?.email).toBe('ana@exemplo.test');
    expect(aberto[0]?.links.linkedin).toBe('https://www.linkedin.com/in/ana');
  });

  it('o campo de contato é o ÚNICO que publica e-mail e redes', () => {
    /** Amarra a decisão: se alguém renomear o campo, este teste cai. */
    expect(PUBLIC_CONTACT_FIELD).toBe('contacts');
    expect(Object.keys(DEFAULT_PROFILE_AUDIENCES)).toContain(PUBLIC_CONTACT_FIELD);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('contatos públicos', () => {
  it('aceita http(s) de host conhecido e normaliza o que a pessoa digita', () => {
    const result = sanitizePublicContacts({
      linkedin: 'www.linkedin.com/in/ana',
      instagram: '@ana.souza',
      youtube: '@anacanal',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contacts.linkedin).toBe('https://www.linkedin.com/in/ana');
    expect(result.contacts.instagram).toBe('https://instagram.com/ana.souza');
    expect(result.contacts.youtube).toBe('https://youtube.com/@anacanal');
  });

  it('recusa esquema perigoso e host que não é da rede', () => {
    const javascript = sanitizePublicContacts({ linkedin: 'javascript:alert(1)' });
    expect(javascript.ok).toBe(false);

    const phishing = sanitizePublicContacts({ linkedin: 'https://phishing.example/in/ana' });
    expect(phishing.ok).toBe(false);
    if (!phishing.ok) expect(phishing.errors[0]).toContain('linkedin.com');

    /** A recusa diz TODOS os motivos de uma vez, e não um por salvamento. */
    const dois = sanitizePublicContacts({ linkedin: 'https://x.test', github: 'https://y.test' });
    expect(dois.ok).toBe(false);
    if (!dois.ok) expect(dois.errors).toHaveLength(2);
  });

  it('campo vazio é AUSENTE, não string vazia (isso viraria `<a href="">`)', () => {
    const result = sanitizePublicContacts({ linkedin: '   ', instagram: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contacts).toEqual({});
  });

  it('rede que não é do perfil é ignorada: site e Lattes têm coluna própria', () => {
    /** `website`/`lattes` são `publicSiteUrl`/`lattesId` desde a FASE 44. */
    const result = sanitizePublicContacts({ website: 'https://exemplo.test' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contacts).toEqual({});
  });

  it('a leitura é tolerante: valor ruim some sozinho, sem apagar os outros', () => {
    const lido = readPublicContacts({
      linkedin: 'https://www.linkedin.com/in/ana',
      github: 'nao-e-url',
    });

    expect(lido.linkedin).toBe('https://www.linkedin.com/in/ana');
    expect(lido.github).toBeUndefined();
    expect(readPublicContacts(null)).toEqual({});
    expect(readPublicContacts([1, 2])).toEqual({});
  });

  it('`hasPublicContacts` responde se há ícone para desenhar', () => {
    expect(hasPublicContacts({})).toBe(false);
    expect(hasPublicContacts(null)).toBe(false);
    expect(hasPublicContacts({ github: 'https://github.com/ana' })).toBe(true);
  });

  it('iniciais do cartão lidam com um nome só, nome composto e nome vazio', () => {
    expect(teamInitials('Ana Souza')).toBe('AS');
    expect(teamInitials('Ana')).toBe('AN');
    expect(teamInitials('Ana Maria de Souza')).toBe('AS');
    expect(teamInitials('   ')).toBe('?');
  });
});
