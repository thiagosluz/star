/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — o destino de quem acaba de entrar (FASE 82 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E SEM O QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O destino pós-entrada deixa de ser um `redirect` incondicional e passa a ser
 *  uma DECISÃO com degraus de precedência (eram cinco na F82; a F83 acrescentou
 *  a contagem de vínculos e a escolha explícita, e os nomes dos casos seguem a
 *  ordem nova). Uma decisão com ordem errada produz o defeito
 *  silencioso clássico: a página abre, ninguém vê erro, e a pessoa cai no lugar
 *  errado — o SuperAdmin no seletor de instituições, o convidado na descoberta de
 *  eventos, o visitante que veio de uma atividade na tela de seleção.
 *
 *  A matriz inteira roda SEM banco, SEM cookie e SEM Next:
 *
 *    • a REGRA é exercitada diretamente, com os fatos já apurados — é o contrato
 *      que os redirects da fatia 2 vão consumir;
 *    • o ADAPTADOR é exercitado com DUBLÊS (a terceira dependência de
 *      `resolveEntryDestinationForUser`), porque o que ele tem de próprio não é a
 *      decisão: é a ESCOLHA do vínculo ativo e a tolerância a falha da leitura de
 *      plataforma. Testar só a regra deixaria "o login não pode quebrar por causa
 *      do destino" sem prova.
 *
 *  O último bloco é catraca de FONTE: a pureza do domínio e o fato de o flag de
 *  plataforma não ter entrado no render normal (contexto/layout).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENTRY_DISCOVERY_PATH,
  isSafeEntryRedirect,
  resolveEntryDestination,
  type EntryDestinationInput,
} from '../../src/domain/platform/entry-destination-rules';
import {
  SELECT_INSTITUTION_PATH,
  tenantDashboardPath,
} from '../../src/domain/platform/vitrine-account-rules';
import { PLATFORM_HOME_PATH } from '../../src/domain/platform/platform-nav-rules';
import { PLATFORM_CRUMB } from '../../src/components/shell/tenant-nav';
import {
  resolveEntryDestinationForUser,
  type EntryDestinationDeps,
} from '../../src/lib/auth/entry-destination';
import type { PlatformPrincipal, RoleAssignment } from '../../src/domain/rbac/authorization';
import type { TenantMembership } from '../../src/lib/auth/session';

const USER = 'pessoa-1';
const SLUG = 'ufba-demo';
const OUTRO_SLUG = 'fiocruz-demo';

// ───────────────────────────────────────────────────────────────────────────────
//  Construtores dos fatos
// ───────────────────────────────────────────────────────────────────────────────
function vinculo(
  tenantSlug: string,
  status: TenantMembership['status'] = 'ACTIVE',
): TenantMembership {
  return {
    tenantId: `tenant-${tenantSlug}`,
    tenantSlug,
    tenantName: tenantSlug,
    tenantLogoUrl: null,
    status,
    /**
     * A FASE 83 acrescentou `kind` e as datas ao tipo: o desempate do vínculo
     * ativo precisa deles. Estes casos continuam com UM vínculo ativo, então o
     * valor não muda o destino — quem exercita o desempate é o arquivo da F83.
     */
    kind: 'PARTICIPANT',
    joinedAt: new Date('2026-01-01T00:00:00-03:00'),
    createdAt: new Date('2026-01-01T00:00:00-03:00'),
    roles: [],
    isPrivileged: false,
  };
}

const CONCEDER_PLATAFORMA: RoleAssignment = {
  role: 'SUPERADMIN',
  scope: 'PLATFORM',
  eventId: null,
  activityId: null,
  expiresAt: null,
  revokedAt: null,
};

function principalDePlataforma(assignments: readonly RoleAssignment[] = [CONCEDER_PLATAFORMA]): PlatformPrincipal {
  return {
    userId: USER,
    tenantId: null,
    membershipStatus: 'ACTIVE',
    assignments,
  };
}

/** Um cenário completo; cada caso sobrescreve só o que importa. */
function entrada(overrides: Partial<EntryDestinationInput> = {}): EntryDestinationInput {
  return {
    isPlatformOperator: false,
    chosenTenantSlug: null,
    activeTenantSlug: null,
    activeLinkCount: 0,
    hasPendingInvite: false,
    redirectTo: null,
    ...overrides,
  };
}

/** Dublês do adaptador — nenhuma linha toca o banco. */
function dublês(overrides: Partial<EntryDestinationDeps> = {}): EntryDestinationDeps {
  return {
    loadMemberships: async () => [],
    loadPlatformPrincipal: async () => principalDePlataforma([]),
    readDesiredTenantSlug: async () => null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('a regra pura — a ordem dos degraus', () => {
  it('degrau 2: sem vínculo e sem convite, o operador de plataforma vai para a governança', () => {
    const destino = resolveEntryDestination(entrada({ isPlatformOperator: true }));

    // A constante do `PLATFORM_CRUMB` — a mesma que a trilha de `/superadmin` usa.
    expect(destino).toBe(PLATFORM_CRUMB.href);
  });

  it('degrau 2 vence o vínculo: operador com instituição ativa NÃO cai no painel dela', () => {
    const destino = resolveEntryDestination(
      entrada({
        isPlatformOperator: true,
        activeLinkCount: 1,
        activeTenantSlug: SLUG,
      }),
    );

    expect(destino).toBe(PLATFORM_CRUMB.href);
  });

  it('degrau 2 vence o convite pendente', () => {
    const destino = resolveEntryDestination(
      entrada({ isPlatformOperator: true, hasPendingInvite: true }),
    );

    expect(destino).toBe(PLATFORM_CRUMB.href);
  });

  it('degrau 4: UM vínculo ativo com slug leva ao painel da instituição', () => {
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 1, activeTenantSlug: SLUG }),
    );

    // Não é a string colada à mão: é a MESMA função que o CTA da vitrine usa.
    expect(destino).toBe(tenantDashboardPath(SLUG));
    expect(destino).toBe('/t/ufba-demo/dashboard');
  });

  it('degrau 4: vínculo sem slug NÃO monta `/t/null/dashboard` — cai para a descoberta', () => {
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 1, activeTenantSlug: null }),
    );

    expect(destino).toBe(ENTRY_DISCOVERY_PATH);
    expect(destino).not.toContain('null');
  });

  it('degrau 6: convite pendente sem vínculo preserva a tela do convite', () => {
    const destino = resolveEntryDestination(entrada({ hasPendingInvite: true }));

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('degrau 6: convite pendente com vínculo sem slug ainda mostra o seletor', () => {
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 1, activeTenantSlug: null, hasPendingInvite: true }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('degrau 7: sem operador, sem vínculo e sem convite, a descoberta pública', () => {
    expect(resolveEntryDestination(entrada())).toBe(ENTRY_DISCOVERY_PATH);
    expect(ENTRY_DISCOVERY_PATH).toBe('/eventos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('`redirectTo` é OVERRIDE — vence TODOS os degraus', () => {
  const ATIVIDADE = '/t/ufba-demo/eventos/semana/atividades/oficina-de-testes';

  it('vence superadmin + vínculo ativo + convite pendente, ao mesmo tempo', () => {
    const destino = resolveEntryDestination(
      entrada({
        redirectTo: ATIVIDADE,
        isPlatformOperator: true,
        activeLinkCount: 1,
        activeTenantSlug: SLUG,
        hasPendingInvite: true,
      }),
    );

    expect(destino).toBe(ATIVIDADE);
  });

  it('vence até o superadmin SEM vínculo — a pessoa escolheu onde estava', () => {
    const destino = resolveEntryDestination(
      entrada({ redirectTo: ATIVIDADE, isPlatformOperator: true }),
    );

    expect(destino).toBe(ATIVIDADE);
  });

  it('preserva query e hash: a volta é para a tela com o filtro aberto', () => {
    const comQuery = '/t/ufba-demo/administracao/participantes?busca=ana&pagina=2';
    const comHash = '/t/ufba-demo/eventos/semana#programacao';

    expect(resolveEntryDestination(entrada({ redirectTo: comQuery }))).toBe(comQuery);
    expect(resolveEntryDestination(entrada({ redirectTo: comHash }))).toBe(comHash);
  });

  it('aceita `/eventos` como destino explícito (não confunde com o fallback)', () => {
    const destino = resolveEntryDestination(
      entrada({ redirectTo: '/eventos', activeLinkCount: 1, activeTenantSlug: SLUG }),
    );

    expect(destino).toBe('/eventos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('`redirectTo` inválido não desvia — a regra segue o degrau seguinte', () => {
  /**
   * O contexto é "vínculo ativo": qualquer valor abaixo teria de cair em
   * `/t/ufba-demo/dashboard`. Se algum passar, o teste acusa o open redirect ou o
   * laço de entrada com o destino errado aparecendo no lugar.
   */
  const INVALIDOS: readonly [string, string][] = [
    ['absoluto com esquema', 'https://evil.test/painel'],
    ['relativo a protocolo', '//evil.test/painel'],
    ['barra invertida (normalizada para `//`)', '/\\evil.test/painel'],
    ['esquema javascript', 'javascript:alert(1)'],
    ['vazio', ''],
    ['apenas espaços', '   '],
    ['espaço no meio', '/t/ufba-demo/dashboard '],
    ['quebra de linha', '/t/ufba-demo/dashboard\n'],
    ['sem barra inicial', 't/ufba-demo/dashboard'],
    ['endereço absoluto dentro da query', '/entrar?voltar=https://evil.test'],
    ['a própria tela de login', '/login'],
    ['a própria tela de cadastro', '/signup'],
    ['login com parâmetro (continua sendo login)', '/login?redirectTo=/t/ufba-demo/dashboard'],
    ['subpágina do login (desafio do segundo fator)', '/login/dois-fatores'],
  ];

  for (const [motivo, redirectTo] of INVALIDOS) {
    it(`recusa ${motivo} e cai no painel do vínculo`, () => {
      const destino = resolveEntryDestination(
        entrada({ redirectTo, activeLinkCount: 1, activeTenantSlug: SLUG }),
      );

      expect(destino).toBe(tenantDashboardPath(SLUG));
    });
  }

  it('com operador de plataforma, o inválido cai na governança (e não no login)', () => {
    const destino = resolveEntryDestination(
      entrada({ redirectTo: '/login', isPlatformOperator: true }),
    );

    expect(destino).toBe(PLATFORM_CRUMB.href);
  });

  it('`null` e `undefined` são ausência de destino, não destino inválido com erro', () => {
    expect(resolveEntryDestination(entrada({ redirectTo: null }))).toBe(ENTRY_DISCOVERY_PATH);
    expect(resolveEntryDestination(entrada({ redirectTo: undefined }))).toBe(ENTRY_DISCOVERY_PATH);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o validador de destino, sozinho', () => {
  it('aceita os caminhos internos que o produto usa', () => {
    for (const caminho of [
      '/',
      '/eventos',
      '/eventos?categoria=academico',
      '/t/ufba-demo/dashboard',
      '/t/ufba-demo/eventos/semana/atividades/oficina',
      '/selecionar-instituicao',
    ]) {
      expect(isSafeEntryRedirect(caminho), caminho).toBe(true);
    }
  });

  it('`/loginz` é outra tela: o bloqueio NÃO é prefixo cego de string', () => {
    // `/loginz` não é a tela de login: o bloqueio é de `/login` e de suas
    // subpáginas, não de qualquer string que comece com "login". O caminho é
    // aceito como destino interno, mesmo não existindo página nele.
    expect(isSafeEntryRedirect('/loginz')).toBe(true);
  });

  it('recusa o que não é string', () => {
    expect(isSafeEntryRedirect(null)).toBe(false);
    expect(isSafeEntryRedirect(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o adaptador — vínculos e plataforma com dublês (sem banco)', () => {
  it('operador de plataforma sem vínculo: governança', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadPlatformPrincipal: async () => principalDePlataforma() }),
    );

    expect(destino).toBe(PLATFORM_CRUMB.href);
  });

  it('principal sem a permissão de plataforma NÃO é operador (fail-closed)', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadPlatformPrincipal: async () => principalDePlataforma([]) }),
    );

    expect(destino).toBe(ENTRY_DISCOVERY_PATH);
  });

  it('concessão de plataforma VENCIDA não é operador', async () => {
    const vencida: RoleAssignment = {
      ...CONCEDER_PLATAFORMA,
      expiresAt: new Date('2020-01-01T00:00:00-03:00'),
    };

    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadPlatformPrincipal: async () => principalDePlataforma([vencida]) }),
    );

    expect(destino).toBe(ENTRY_DISCOVERY_PATH);
  });

  it('vínculo ativo vai ao painel; o convite em OUTRA instituição não muda o destino', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [vinculo(SLUG, 'ACTIVE'), vinculo(OUTRO_SLUG, 'INVITED')],
      }),
    );

    expect(destino).toBe(tenantDashboardPath(SLUG));
  });

  it('o cookie de contexto escolhe o vínculo entre vários ativos (FASE 83: é a escolha explícita)', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [vinculo(SLUG, 'ACTIVE'), vinculo(OUTRO_SLUG, 'ACTIVE')],
        readDesiredTenantSlug: async () => OUTRO_SLUG,
      }),
    );

    expect(destino).toBe(tenantDashboardPath(OUTRO_SLUG));
  });

  it('cookie apontando para convite (não ATIVO) é ignorado — cai no único vínculo ativo', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [vinculo(SLUG, 'ACTIVE'), vinculo(OUTRO_SLUG, 'INVITED')],
        readDesiredTenantSlug: async () => OUTRO_SLUG,
      }),
    );

    expect(destino).toBe(tenantDashboardPath(SLUG));
  });

  it('só convite pendente: o seletor, onde o convite aparece', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadMemberships: async () => [vinculo(SLUG, 'INVITED')] }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('sem vínculo e sem convite: a descoberta', async () => {
    const destino = await resolveEntryDestinationForUser(USER, {}, dublês());

    expect(destino).toBe(ENTRY_DISCOVERY_PATH);
  });

  it('a leitura de plataforma que FALHA não derruba o login — vira "não é operador"', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [vinculo(SLUG, 'ACTIVE')],
        loadPlatformPrincipal: async () => {
          throw new Error('banco fora');
        },
      }),
    );

    // Sem o `try/catch` do adaptador, esta promessa rejeitaria e o login morreria.
    await expect(
      resolveEntryDestinationForUser(
        USER,
        {},
        dublês({
          loadPlatformPrincipal: async () => {
            throw new Error('banco fora');
          },
        }),
      ),
    ).resolves.toBe(ENTRY_DISCOVERY_PATH);

    expect(destino).toBe(tenantDashboardPath(SLUG));
  });

  it('a falha de plataforma não atropela o `redirectTo`', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      { redirectTo: '/t/ufba-demo/eventos/semana' },
      dublês({
        loadPlatformPrincipal: async () => {
          throw new Error('sem permissão de leitura');
        },
      }),
    );

    expect(destino).toBe('/t/ufba-demo/eventos/semana');
  });

  it('o `redirectTo` vence o operador de plataforma também no adaptador', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      { redirectTo: '/t/ufba-demo/minhas-inscricoes' },
      dublês({ loadPlatformPrincipal: async () => principalDePlataforma() }),
    );

    expect(destino).toBe('/t/ufba-demo/minhas-inscricoes');
  });

  it('`redirectTo` ausente nas opções é o mesmo que `undefined`', async () => {
    const semOpcoes = await resolveEntryDestinationForUser(USER, {}, dublês());
    const comNull = await resolveEntryDestinationForUser(USER, { redirectTo: null }, dublês());

    expect(semOpcoes).toBe(ENTRY_DISCOVERY_PATH);
    expect(comNull).toBe(ENTRY_DISCOVERY_PATH);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Catracas de fonte — o que o teste de comportamento não enxerga
// ═══════════════════════════════════════════════════════════════════════════════
function ler(caminho: string): string {
  return readFileSync(join(process.cwd(), caminho), 'utf8');
}

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('catraca do domínio puro', () => {
  const FONTE = semComentarios(ler('src/domain/platform/entry-destination-rules.ts'));

  it('não importa Prisma, Next, sessão nem nada de `src/lib`', () => {
    for (const proibido of ['prisma', "from 'next", 'from "next', '@/lib', 'src/lib', 'server-only']) {
      expect(FONTE).not.toContain(proibido);
    }
  });

  it('o destino da plataforma NÃO é um literal repetido — vem do DOMÍNIO', () => {
    // A fatia 1 lia `PLATFORM_CRUMB` de `src/components/shell/tenant-nav` e
    // invertia o grafo: o domínio dependia da interface. A fatia 2 pagou a dívida
    // movendo o CAMINHO para `platform-nav-rules` — e a catraca agora prende isso.
    expect(FONTE).not.toContain('/superadmin');
    expect(FONTE).toContain('PLATFORM_HOME_PATH');
    expect(FONTE).not.toContain('@/components');
  });

  it('o componente importa o caminho do domínio em vez de repetir o literal', () => {
    const nav = semComentarios(ler('src/components/shell/tenant-nav.tsx'));

    expect(nav).toContain("from '@/domain/platform/platform-nav-rules'");
    expect(nav).not.toContain("'/superadmin/metricas'");
  });

  it('a trilha e a regra concordam no destino da governança', () => {
    expect(PLATFORM_CRUMB.href).toBe(PLATFORM_HOME_PATH);
    expect(PLATFORM_HOME_PATH).toBe('/superadmin/metricas');
  });
});

describe('catraca do vínculo ativo — uma cópia só (FASE 82 · fatia 2)', () => {
  /**
   * O critério, sem o nome da variável na frente.
   *
   * A primeira versão desta catraca procurava `membership.status === 'ACTIVE'` —
   * e a mutação provou que ela **não mordia**: uma cópia com outro nome de
   * variável (`m.status === 'ACTIVE'`) passava com 52/52 verdes. O que se prende
   * aqui é o CRITÉRIO, não o nome de quem o escreve; e a chamada
   * (`pickActiveMembership(`) é exigida para que o `import` sozinho — que
   * continuava na árvore — não bastasse.
   */
  const CRITERIO = "status === 'ACTIVE'";
  const CHAMADA = 'pickActiveMembership(';

  it('os DOIS lados CHAMAM `pickActiveMembership`, e nenhum repete o critério', () => {
    for (const arquivo of [
      'src/lib/auth/session.ts',
      'src/lib/auth/entry-destination.ts',
    ]) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, arquivo).toContain(CHAMADA);
      // A cópia do `find(...)` era o defeito: se voltar em qualquer um dos dois,
      // as duas decisões podem divergir e a casca abre outra instituição.
      expect(fonte, arquivo).not.toContain(CRITERIO);
    }
  });

  it('o helper é a única casa do critério', () => {
    const fonte = semComentarios(ler('src/lib/auth/active-membership.ts'));

    expect(fonte).toContain(CRITERIO);
  });
});

describe('catraca do render normal — o flag de plataforma não vazou para a casca', () => {
  it('`getRequestContext()` não carrega o principal de plataforma', () => {
    const sessao = semComentarios(ler('src/lib/auth/session.ts'));
    const inicio = sessao.indexOf('export async function getRequestContext');

    expect(inicio).toBeGreaterThan(-1);
    expect(sessao.slice(inicio)).not.toContain('loadPlatformPrincipal');
  });

  it('nem o layout da instituição, nem o da plataforma importam o adaptador', () => {
    for (const layout of [
      'src/app/t/[tenantSlug]/(app)/layout.tsx',
      'src/app/superadmin/layout.tsx',
    ]) {
      const fonte = semComentarios(ler(layout));

      expect(fonte, layout).not.toContain('entry-destination');
      expect(fonte, layout).not.toContain('loadPlatformPrincipal');
    }
  });

  it('`session.ts` não conhece o adaptador — a entrada não entra no caminho do render', () => {
    expect(semComentarios(ler('src/lib/auth/session.ts'))).not.toContain('entry-destination');
  });
});
