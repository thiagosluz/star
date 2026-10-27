/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE UNITÁRIO — o login honra o `redirectTo` SEM `tenantSlug` (FASE 82 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `redirectTo` do login estava MORTO. Ele só era lido dentro do branch
 *  `if (tenantSlug)`, e nenhuma tela passa essa prop ao `AuthForm` — então quem
 *  clicava em "entrar e continuar" numa atividade era devolvido ao seletor de
 *  instituições. O sintoma não era erro: era a pessoa perder o lugar onde estava.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO SE PROVA SEM NAVEGADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A Server Action é exercitada com a biblioteca de autenticação dublada (o
 *  `signInEmail` responde um usuário), o `redirect()` do Next transformado em
 *  exceção (é assim que ele sinaliza) e a REGRA dublada num espião. Com isso:
 *
 *    • um destino válido tem de vencer SEM que a regra seja consultada — a prova
 *      de que a decisão não depende mais de `tenantSlug` nem de banco;
 *    • sem destino, a resposta da REGRA tem de ser obedecida (não o seletor fixo);
 *    • os destinos inválidos (open redirect, laço de login) não podem desviar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DESTINO_DA_REGRA = '/t/ufba-demo/dashboard';

const estado = vi.hoisted(() => ({
  regra: vi.fn(async (..._args: unknown[]) => '/t/ufba-demo/dashboard'),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

/**
 * A biblioteca é dublada: o teste é sobre a DECISÃO de destino, não sobre o hash
 * de senha. O formato é o que ela devolve de verdade — `{ token, user }`.
 */
vi.mock('../../src/lib/auth/auth', () => ({
  auth: {
    api: {
      signInEmail: async () => ({ token: 'token-de-teste', user: { id: 'pessoa-1' } }),
    },
  },
}));

/** `session.ts` fora do teste: o cookie assinado não existe fora do Next. */
vi.mock('../../src/lib/auth/session', () => ({
  ACTIVE_TENANT_COOKIE: 'ef_tenant',
  serializeActiveTenant: (slug: string) => `${slug}.assinatura-de-teste`,
}));

vi.mock('../../src/lib/auth/entry-destination', () => ({
  resolveEntryDestinationForUser: (...args: unknown[]) => estado.regra(...args),
}));

vi.mock('../../src/lib/auth/identity-audit', () => ({ recordIdentityEvent: async () => {} }));

vi.mock('../../src/lib/db/admin-client', () => ({ adminPrisma: {} }));

const { signInAction } = await import('../../src/app/actions/auth-actions');

function formulario(campos: Record<string, string>): FormData {
  const data = new FormData();
  for (const [campo, valor] of Object.entries(campos)) data.set(campo, valor);

  return data;
}

function credenciais(extra: Record<string, string> = {}): FormData {
  return formulario({
    email: 'ana@example.test',
    password: 'senha-forte-e-2e-2026',
    ...extra,
  });
}

beforeEach(() => {
  estado.regra.mockClear();
  estado.regra.mockResolvedValue(DESTINO_DA_REGRA);
});

describe('login honra o `redirectTo` sem `tenantSlug`', () => {
  it('destino válido vence — e a regra NEM é consultada (não depende de vínculo)', async () => {
    const atividade = '/t/ufba-demo/eventos/semana/atividades/oficina-de-testes';

    // Sem `tenantSlug` no formulário: é exatamente o caso que estava morto.
    await expect(signInAction(null, credenciais({ redirectTo: atividade }))).rejects.toThrow(
      `NEXT_REDIRECT:${atividade}`,
    );

    expect(estado.regra).not.toHaveBeenCalled();
  });

  it('preserva query e hash: a volta é para a tela com o filtro aberto', async () => {
    const comFiltro = '/t/ufba-demo/administracao/participantes?busca=ana&pagina=2';

    await expect(signInAction(null, credenciais({ redirectTo: comFiltro }))).rejects.toThrow(
      `NEXT_REDIRECT:${comFiltro}`,
    );
  });

  it('sem destino, quem decide é a REGRA — não o seletor incondicional de ontem', async () => {
    await expect(signInAction(null, credenciais())).rejects.toThrow(
      `NEXT_REDIRECT:${DESTINO_DA_REGRA}`,
    );

    expect(estado.regra).toHaveBeenCalledTimes(1);
    expect(estado.regra).toHaveBeenCalledWith('pessoa-1', { redirectTo: null });
  });

  it('a resposta da regra é obedecida tal e qual (governança, painel ou descoberta)', async () => {
    estado.regra.mockResolvedValue('/superadmin/metricas');

    await expect(signInAction(null, credenciais())).rejects.toThrow(
      'NEXT_REDIRECT:/superadmin/metricas',
    );
  });

  /**
   * Os inválidos que o branch antigo ACEITAVA: `//evil.test` passava?
   * Não — mas `/login` e `/\evil.test` passavam, e os dois são dano real:
   * o primeiro é laço, o segundo é open redirect no navegador.
   */
  const INVALIDOS: readonly [string, string][] = [
    ['relativo a protocolo (open redirect)', '//evil.test/painel'],
    ['barra invertida (vira `//` no navegador)', '/\\evil.test/painel'],
    ['absoluto com esquema', 'https://evil.test/painel'],
    ['a própria tela de login (laço)', '/login'],
    ['o cadastro', '/signup'],
    ['login com parâmetro', '/login?redirectTo=/t/ufba-demo/dashboard'],
  ];

  for (const [motivo, destino] of INVALIDOS) {
    it(`destino inválido não desvia: ${motivo}`, async () => {
      await expect(signInAction(null, credenciais({ redirectTo: destino }))).rejects.toThrow(
        `NEXT_REDIRECT:${DESTINO_DA_REGRA}`,
      );

      expect(estado.regra).toHaveBeenCalledTimes(1);
    });
  }
});
