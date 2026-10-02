/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Equipe do evento na página pública (FASE 45)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A IDEIA EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A equipe que o organizador já cadastra (FASE 38) ganha vitrine: um cartão por
 *  pessoa, com a ETIQUETA da equipe como legenda da foto — e o contato só sai
 *  quando a própria pessoa autorizou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS DECISÕES QUE DEFINEM TUDO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. **NÃO HÁ SEGUNDO CADASTRO.** A equipe da página é a mesma `EventTeam` que
 *     organiza as demandas internas. Fazer o organizador digitar tudo de novo para a
 *     página pública criaria duas listas da mesma coisa — e a segunda mentiria na
 *     primeira mudança de equipe (a mesma régua do bloco `SPEAKERS` desde a FASE 25).
 *
 *  2. **O NOME É DO EVENTO; A FOTO E O CONTATO SÃO DA PESSOA.** Quem está na equipe
 *     aparece com nome e etiqueta — é informação do próprio evento, como o crachá.
 *     Foto, e-mail e redes sociais são dado pessoal: saem só se a matriz de
 *     visibilidade do perfil público (FASE 44) autorizar, e o cartão cai para as
 *     iniciais quando não autoriza. Consentimento que nasce ligado é o defeito que a
 *     FASE 22 corrigiu (ADR-139).
 *
 *  3. **A ORDEM É EXPLICÁVEL.** Ordem manual da equipe (`displayOrder`, FASE 51) →
 *     etiqueta alfabética (pt-BR) → líder primeiro → nome → id. A ordem é ESTÁVEL (o
 *     desempate final é o id): sem isso a grade troca de lugar a cada requisição, e
 *     quem abre a página duas vezes vê duas páginas. A régua é a de
 *     `team-order-rules.ts`, e não um `sort` escrito aqui: a tela de administração
 *     lista as equipes na MESMA ordem, e duas contas de ordem divergem no primeiro dia.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { PublicContacts } from '@/domain/profile/public-contacts';
import { PUBLIC_CONTACT_FIELD } from '@/domain/profile/public-contacts';
import type { ProfileAudience, PublicProfileField } from '@/domain/profile/public-profile-rules';
import { isPersonPubliclyVisible } from '@/domain/profile/public-profile-rules';
import { orderTeamsForDisplay } from '@/domain/events/team-order-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  A vitrine da equipe
// ───────────────────────────────────────────────────────────────────────────────
/** Uma equipe do evento, como ela entra no bloco. */
export interface PublicTeamSource {
  id: string;
  name: string;
  isActive: boolean;
  /**
   * A ordem manual da equipe (FASE 51 · dívida E63). `0` = ninguém ordenou: a equipe
   * continua valendo pela régua antiga (alfabética), que é o que dá conta do caso
   * comum — a fase não podia reordenar a página de quem não pediu nada.
   */
  displayOrder: number;
  members: readonly PublicTeamMemberSource[];
}

/** Um vínculo de equipe, com o que a pessoa autorizou. */
export interface PublicTeamMemberSource {
  userId: string;
  name: string;
  isLead: boolean;
  /** `null` = a pessoa não autorizou foto (o cartão usa as iniciais). */
  avatarUrl: string | null;
  /**
   * `null` = a pessoa não publica contato. Quando vem preenchido, já passou pela
   * régua da matriz (só `PUBLIC` chega aqui — o bloco é uma página pública).
   */
  contacts: { email: string | null; links: PublicContacts } | null;
  /**
   * O EFEITO da moderação da plataforma (FASE 56 · E62) — a MESMA coluna que o perfil
   * público e o diretório consultam, lida aqui pela fonte única
   * (`isPersonPubliclyVisible`, FASE 60 · E79). O campo é OBRIGATÓRIO de propósito: um
   * chamador que esqueça de selecioná-lo entrega `undefined`, a pessoa é tratada como
   * oculta e some da vitrine — falha visível, e não identidade publicada por engano.
   */
  publicProfileHiddenAt: Date | null;
}

/** O cartão de uma pessoa na vitrine. */
export interface PublicTeamCard {
  userId: string;
  name: string;
  /** Etiquetas das equipes em que a pessoa está, na ordem em que aparecem. */
  labels: string[];
  avatarUrl: string | null;
  isLead: boolean;
  email: string | null;
  links: PublicContacts;
}

export interface BuildPublicTeamInput {
  teams: readonly PublicTeamSource[];
  /**
   * A matriz de visibilidade da pessoa (FASE 44). É ela que decide foto e contato —
   * o bloco nunca decide por conta própria.
   */
  audiencesOf: (userId: string) => Record<PublicProfileField, ProfileAudience>;
  emailOf: (userId: string) => string | null;
  /** Filtro opcional: o organizador escolhe UMA equipe (como o bloco de cotas). */
  teamId?: string | null;
  /** Teto de cartões. Uma equipe de 400 pessoas não é vitrine, é lista. */
  limit?: number;
}

export const TEAM_CARD_LIMIT = 60;

/**
 * Monta a vitrine da equipe.
 *
 * ─── O QUE O BLOCO PODE E O QUE ELE NÃO PODE ──────────────────────────────────
 *
 *  • só equipe **ATIVA** e com **ao menos uma pessoa visível** entra;
 *  • pessoa OCULTA pela moderação da plataforma não vira cartão (FASE 60 · E79): o
 *    cartão É a pessoa (foto, nome e etiqueta da equipe), e não existe jeito de
 *    desenhá-lo sem citá-la. A régua é a MESMA do perfil público (FASE 44/56), lida
 *    da fonte única — e o mesmo vale para quem está em duas equipes, porque o filtro
 *    acontece ANTES do agrupamento;
 *  • pessoa em duas equipes aparece **UMA vez**, com as duas etiquetas — repetir o
 *    cartão faria a mesma foto aparecer duas vezes na mesma grade;
 *  • **foto** só com `avatar` em `PUBLIC` (é página pública: `ATTENDEES_ONLY` não
 *    vale aqui, e o cartão cai para as iniciais);
 *  • **contato** só com o campo `contacts` em `PUBLIC`, e o e-mail só junto dele — e
 *    nem é PEDIDO (`emailOf`) para quem está oculto: o dado não sai do repositório;
 *  • a ordem é: `displayOrder` da equipe (manual, quando existe) → nome da equipe
 *    (pt-BR, quando ninguém ordenou) → líder primeiro → nome (pt-BR) → id. O id no fim
 *    é o que torna a ordem **estável**.
 */
export function buildPublicTeam(input: BuildPublicTeamInput): PublicTeamCard[] {
  const limit = input.limit ?? TEAM_CARD_LIMIT;

  /**
   * ─── QUEM ESTÁ OCULTO SAI ANTES DE VIRAR CARTÃO (FASE 60 · E79) ──────────────
   *
   *  O filtro roda AQUI, uma vez, e não dentro do laço que monta cada cartão: assim
   *  ele vale para as duas etiquetas de quem está em duas equipes e para a ordenação
   *  (uma equipe inteira oculta não é "equipe com gente", e não deve segurar posição).
   *  A régua vem da fonte única (`isPersonPubliclyVisible`), a mesma do perfil público
   *  e do diretório — a decisão de moderação não é reinterpretada nesta tela.
   */
  const visibleTeams = input.teams
    .filter((team) => team.isActive)
    .filter((team) => (input.teamId ? team.id === input.teamId : true))
    .map((team) => ({ ...team, members: team.members.filter(isPersonPubliclyVisible) }))
    .filter((team) => team.members.length > 0);

  const teams = orderTeamsForDisplay(visibleTeams);

  const cards = new Map<string, PublicTeamCard & { firstTeamName: string; teamOrder: number }>();

  for (const [teamIndex, team] of teams.entries()) {
    for (const member of team.members) {
      const existing = cards.get(member.userId);

      if (existing) {
        if (!existing.labels.includes(team.name)) existing.labels.push(team.name);
        /** Líder em QUALQUER equipe do bloco continua sendo líder no cartão. */
        existing.isLead = existing.isLead || member.isLead;
        continue;
      }

      const audiences = input.audiencesOf(member.userId);
      const contactsVisible = audiences[PUBLIC_CONTACT_FIELD] === 'PUBLIC';

      cards.set(member.userId, {
        userId: member.userId,
        name: member.name,
        labels: [team.name],
        avatarUrl: audiences.avatar === 'PUBLIC' ? member.avatarUrl : null,
        isLead: member.isLead,
        email: contactsVisible ? input.emailOf(member.userId) : null,
        links: contactsVisible ? (member.contacts?.links ?? {}) : {},
        firstTeamName: team.name,
        teamOrder: teamIndex,
      });
    }
  }

  return [...cards.values()]
    .sort((a, b) => {
      if (a.teamOrder !== b.teamOrder) return a.teamOrder - b.teamOrder;
      if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR') || a.userId.localeCompare(b.userId);
    })
    .slice(0, limit)
    .map(({ firstTeamName: _firstTeamName, teamOrder: _teamOrder, ...card }) => card);
}

/** Iniciais para o cartão de quem não publica foto ("Ana Souza" → "AS"). */
export function teamInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();

  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}
