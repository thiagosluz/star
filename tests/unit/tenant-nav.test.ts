/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — menu da instituição (FASE 25, revisão)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O menu e as páginas usavam predicados DIFERENTES para a mesma permissão, e o
 *  defeito era do tipo que nenhum teste de tela pega: o grupo "Minha participação"
 *  inteiro era descartado para todo mundo, porque `can()` recusa permissão `:own`
 *  sem dono (fail-closed) — e o menu não passava dono nenhum. O palestrante entrava
 *  no painel e não tinha como chegar ao próprio portal: a única porta era digitar a
 *  URL.
 *
 *  Estes testes fixam o contrato nos dois sentidos: item PESSOAL aparece para quem
 *  PODE tê-lo (papel concedido em qualquer escopo), item INSTITUCIONAL continua
 *  exigindo escopo de instituição, e o convite pendente abre o item do portal para
 *  quem ainda não tem papel nenhum.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { buildTenantNav } from '../../src/components/shell/tenant-nav';
import type { Principal, RoleAssignment } from '../../src/domain/rbac/authorization';

const TENANT_SLUG = 'ufba-demo';
const USER = 'user-1';
const EVENT = 'event-1';
const ACTIVITY = 'activity-1';

function principal(assignments: RoleAssignment[]): Principal {
  return { userId: USER, tenantId: 'tenant-1', membershipStatus: 'ACTIVE', assignments };
}

/** Todos os rótulos visíveis, achatados — é o que a pessoa vê na barra lateral. */
function labels(nav: ReturnType<typeof buildTenantNav>): string[] {
  return nav.flatMap((group) => group.items.map((item) => item.label));
}

function groups(nav: ReturnType<typeof buildTenantNav>): string[] {
  return nav.map((group) => group.title);
}

describe('menu da instituição — itens pessoais e institucionais', () => {
  it('a permissão `:own` concedida por ATIVIDADE abre os itens pessoais', () => {
    /**
     * O caso que estava quebrado: o papel do palestrante nasce no escopo ACTIVITY (é o
     * padrão que a plataforma recomenda) e o menu exigia escopo de instituição — com
     * `can()`, que ainda por cima recusaria a permissão `:own` sem `ownerId`.
     */
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'SPEAKER', scope: 'ACTIVITY', eventId: EVENT, activityId: ACTIVITY }]),
    });

    expect(groups(nav)).toContain('Minha participação');
    expect(labels(nav)).toContain('Portal do palestrante');
    expect(labels(nav)).toContain('Minhas inscrições');
    expect(labels(nav)).toContain('Certificados');
  });

  it('o PARTICIPANTE vê o que é dele e NÃO vê a administração', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'PARTICIPANT', scope: 'TENANT' }]),
    });

    expect(labels(nav)).toEqual(
      expect.arrayContaining(['Painel', 'Eventos', 'Minhas inscrições', 'Minhas submissões', 'Certificados']),
    );
    // A seção de administração continua exigindo permissão de equipe: `tenant:read`
    // (que o participante tem) não pode entregar a lista de membros nem a edição.
    expect(labels(nav)).not.toContain('Administração');
    expect(labels(nav)).not.toContain('Equipe');
    expect(labels(nav)).not.toContain('Credenciamento');
  });

  it('convidado SEM papel nenhum vê o convite de palestrante (e só isso de pessoal)', () => {
    /**
     * Quem foi convidado ainda não tem o papel `SPEAKER` — ele nasce com o aceite. Sem
     * esta porta, o convite era invisível exatamente para quem precisava aceitá-lo.
     */
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([]),
      hasPendingSpeakerInvite: true,
    });

    expect(labels(nav)).toContain('Convite de palestrante');
    expect(labels(nav)).not.toContain('Portal do palestrante');
    expect(labels(nav)).not.toContain('Minhas inscrições');
  });

  it('sem convite pendente e sem papel, o grupo pessoal não aparece', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([]),
      hasPendingSpeakerInvite: false,
    });

    expect(labels(nav)).toEqual(['Painel']);
  });

  it('o rótulo do portal segue a porta: quem já é palestrante não vê "convite"', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'SPEAKER', scope: 'TENANT' }]),
      hasPendingSpeakerInvite: true,
    });

    expect(labels(nav)).toContain('Portal do palestrante');
    expect(labels(nav)).not.toContain('Convite de palestrante');
  });

  it('a equipe vê a operação; os itens de instituição exigem escopo de instituição', () => {
    const tenantWide = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'ADMIN', scope: 'TENANT' }]),
    });

    expect(labels(tenantWide)).toEqual(
      expect.arrayContaining(['Administração', 'Equipe', 'Credenciamento']),
    );

    /**
     * O mesmo papel no escopo do EVENTO não cobre a instituição inteira: a equipe do dia
     * acessa a operação do evento, não a administração — e é `can()` com alvo de tenant
     * que garante isso (aqui o menu, na página a guarda).
     */
    const eventScoped = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'STAFF', scope: 'EVENT', eventId: EVENT }]),
    });

    expect(labels(eventScoped)).not.toContain('Administração');
    expect(labels(eventScoped)).not.toContain('Equipe');
    expect(labels(eventScoped)).toContain('Credenciamento');
  });

  it('os atalhos apontam para o caminho da instituição', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'SPEAKER', scope: 'TENANT' }]),
    });

    const portal = nav.flatMap((group) => group.items).find((item) => item.label === 'Portal do palestrante');
    expect(portal?.href).toBe(`/t/${TENANT_SLUG}/palestrante`);
  });
});
