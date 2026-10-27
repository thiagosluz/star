/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A GUARDA DO EXEMPLO É VÍNCULO, NÃO PERMISSÃO (FASE 77 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela `/t/<slug>/exemplo` precisa abrir para QUALQUER pessoa com vínculo
 *  ativo — inclusive quem acabou de criar a instituição e ainda não configurou
 *  nada, e o participante sem papel de organização. Exigir `event:update`
 *  fecharia a porta justamente para quem mais precisa do exemplo.
 *
 *  As recusas são as MESMAS da casca (`(app)/layout.tsx`), na mesma ordem:
 *    • sem sessão          → `/login?redirectTo=...`
 *    • sem vínculo ativo   → `/selecionar-instituicao`
 *    • vínculo em OUTRA instituição → `/selecionar-instituicao`
 *
 *  A guarda é exercitada com o contexto dublado (sessão e cookie não existem
 *  fora do Next) e com um principal SEM NENHUM PAPEL: se ela dependesse de
 *  permissão, o caso "com vínculo" falharia.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../../src/domain/rbac/authorization';
import type { RequestContext, TenantMembership } from '../../src/lib/auth/session';

const estado = vi.hoisted(() => ({ contexto: null as unknown }));

vi.mock('../../src/lib/auth/session', () => ({
  getRequestContext: async () => estado.contexto,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { requirePageMembership } = await import('../../src/lib/auth/guard-page');

const TENANT_SLUG = 'instituto-exemplo';

const MEMBRO: TenantMembership = {
  tenantId: 'tenant-1',
  tenantSlug: TENANT_SLUG,
  tenantName: 'Instituto Exemplo',
  tenantLogoUrl: null,
  status: 'ACTIVE',
  kind: 'MEMBER',
  joinedAt: new Date('2026-01-01T00:00:00-03:00'),
  createdAt: new Date('2026-01-01T00:00:00-03:00'),
  /**
   * SEM PAPEL. O vínculo é a única coisa que a guarda pode exigir; é este detalhe
   * que prende "não exigir permissão de organizador".
   */
  roles: [],
  isPrivileged: false,
};

const PRINCIPAL_SEM_PAPEIS: Principal = {
  userId: 'pessoa-1',
  tenantId: 'tenant-1',
  membershipStatus: 'ACTIVE',
  assignments: [],
};

function contexto(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    user: {
      id: 'pessoa-1',
      name: 'Pessoa do exemplo',
      email: 'pessoa@exemplo.test',
      image: null,
      publicHandle: null,
      emailVerified: true,
    },
    memberships: [],
    activeTenant: null,
    principal: PRINCIPAL_SEM_PAPEIS,
    sessionId: 'sessao-1',
    ...overrides,
  };
}

describe('requirePageMembership — a porta do exemplo', () => {
  it('sem sessão, manda para o login e volta para a tela pedida', async () => {
    estado.contexto = null;

    const destino = `/login?redirectTo=${encodeURIComponent('/t/instituto-exemplo/dashboard')}`;

    await expect(requirePageMembership({ tenantSlug: TENANT_SLUG })).rejects.toThrow(
      `NEXT_REDIRECT:${destino}`,
    );
  });

  it('sem vínculo ativo com a instituição, cai no seletor — o destino da casca', async () => {
    estado.contexto = contexto();

    await expect(requirePageMembership({ tenantSlug: TENANT_SLUG })).rejects.toThrow(
      'NEXT_REDIRECT:/selecionar-instituicao',
    );
  });

  it('vínculo apenas CONVIDADO não abre: o contexto ativo exige ACTIVE', async () => {
    estado.contexto = contexto({
      memberships: [{ ...MEMBRO, status: 'INVITED' }],
      activeTenant: null,
    });

    await expect(requirePageMembership({ tenantSlug: TENANT_SLUG })).rejects.toThrow(
      'NEXT_REDIRECT:/selecionar-instituicao',
    );
  });

  it('vínculo com OUTRA instituição não abre a instituição da URL', async () => {
    estado.contexto = contexto({
      memberships: [{ ...MEMBRO, tenantSlug: 'outra-instituicao', tenantName: 'Outra' }],
      activeTenant: { ...MEMBRO, tenantSlug: 'outra-instituicao', tenantName: 'Outra' },
    });

    await expect(requirePageMembership({ tenantSlug: TENANT_SLUG })).rejects.toThrow(
      'NEXT_REDIRECT:/selecionar-instituicao',
    );
  });

  it('com vínculo ATIVO e NENHUM papel, devolve o contexto e abre a tela', async () => {
    estado.contexto = contexto({
      memberships: [MEMBRO],
      activeTenant: MEMBRO,
    });

    await expect(requirePageMembership({ tenantSlug: TENANT_SLUG })).resolves.toEqual({
      tenantId: 'tenant-1',
      tenantName: 'Instituto Exemplo',
      userId: 'pessoa-1',
    });
  });

  it('o caminho de volta do login pode ser o da própria tela', async () => {
    estado.contexto = null;

    const destino = `/login?redirectTo=${encodeURIComponent('/t/instituto-exemplo/exemplo')}`;

    await expect(
      requirePageMembership({ tenantSlug: TENANT_SLUG, fallbackPath: '/exemplo' }),
    ).rejects.toThrow(`NEXT_REDIRECT:${destino}`);
  });
});
