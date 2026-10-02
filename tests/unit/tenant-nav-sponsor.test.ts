import { describe, expect, it } from 'vitest';

import { buildTenantNav } from '../../src/components/shell/tenant-nav';
import type { Principal, RoleAssignment } from '../../src/domain/rbac/authorization';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — o item da área do patrocinador (FASE 59, defeito)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O item do menu perguntava `sponsor:read` — e essa permissão está no pacote MÍNIMO de
 *  quem participa (é ela que deixa a PÁGINA abrir para mostrar o convite). Resultado:
 *  "Área do patrocinador" aparecia para revisor, dono e qualquer participante, e a
 *  página respondia "você não está vinculado a nenhum patrocinador desta instituição"
 *  no clique seguinte.
 *
 *  A área é aberta por **VÍNCULO** (FASE 42, ADR-...): o vínculo nasce do convite aceito
 *  ou da vinculação direta pela equipe. Permissão responde "pode entrar?"; vínculo
 *  responde "tem algo lá dentro?". O menu faz a segunda pergunta.
 *
 *  O `tenant-nav.test.ts` da FASE 25 não cobria este item — é por isso que o defeito
 *  sobreviveu a três fases. Aqui ele fica preso nos dois sentidos.
 */
const TENANT_SLUG = 'ufba-demo';

function principal(assignments: RoleAssignment[] = []): Principal {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    membershipStatus: 'ACTIVE',
    assignments,
  };
}

function labels(nav: ReturnType<typeof buildTenantNav>): string[] {
  return nav.flatMap((group) => group.items.map((item) => item.label));
}

describe('área do patrocinador no menu', () => {
  it('NÃO aparece para quem só tem a permissão — o caso que estava quebrado', () => {
    /**
     * `PARTICIPANT` recebe `sponsor:read` no pacote mínimo. Sem vínculo e sem convite,
     * o item não pode existir: era exatamente aqui que o menu mentia.
     */
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'PARTICIPANT', scope: 'TENANT' }]),
    });

    expect(labels(nav)).not.toContain('Área do patrocinador');
    expect(labels(nav)).not.toContain('Convite de patrocinador');
  });

  it('NÃO aparece para o DONO da instituição sem vínculo', () => {
    /** Quem organiza também não é patrocinador por ser dono (relato da tela). */
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'OWNER', scope: 'TENANT' }]),
    });

    expect(labels(nav)).not.toContain('Área do patrocinador');
  });

  it('NÃO aparece para o REVISOR sem vínculo', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'REVIEWER', scope: 'TENANT' }]),
    });

    expect(labels(nav)).not.toContain('Área do patrocinador');
  });

  it('APARECE como "Área do patrocinador" para quem está vinculado', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'SPONSOR', scope: 'TENANT' }]),
      hasSponsorAccess: true,
    });

    expect(labels(nav)).toContain('Área do patrocinador');
  });

  it('APARECE como "Convite de patrocinador" para quem foi convidado e ainda não aceitou', () => {
    /**
     * A segunda porta: o papel `SPONSOR` só nasce com o aceite, então sem este sinal o
     * convite ficaria invisível justamente para quem precisa aceitá-lo.
     */
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'PARTICIPANT', scope: 'TENANT' }]),
      hasPendingSponsorInvite: true,
    });

    expect(labels(nav)).toContain('Convite de patrocinador');
    expect(labels(nav)).not.toContain('Área do patrocinador');
  });

  it('o vínculo vence o convite: quem já está vinculado vê a ÁREA, não o convite', () => {
    const nav = buildTenantNav({
      tenantSlug: TENANT_SLUG,
      principal: principal([{ role: 'SPONSOR', scope: 'TENANT' }]),
      hasSponsorAccess: true,
      hasPendingSponsorInvite: true,
    });

    expect(labels(nav)).toContain('Área do patrocinador');
    expect(labels(nav)).not.toContain('Convite de patrocinador');
  });
});
