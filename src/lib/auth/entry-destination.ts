/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — o destino de entrada, com os fatos apurados (FASE 82 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ADAPTADOR EXISTE SEPARADO DA REGRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `resolveEntryDestination` decide; ela não pode consultar nada. Este arquivo é
 *  quem junta os TRÊS fatos que a decisão precisa:
 *
 *    1. os vínculos do usuário (ACTIVE × convite pendente), com o MESMO critério
 *       do `getRequestContext()`: o cookie assinado revalidado contra os vínculos
 *       ATIVOS, e o MELHOR ATIVO como padrão quando não há cookie válido — a
 *       ordem do desempate (tipo → antiguidade → id) vive em `active-membership.ts`
 *       e é a mesma dos dois lados (FASE 83);
 *    2. o principal de PLATAFORMA (`loadPlatformPrincipal`), perguntando a mesma
 *       permissão que a guarda do painel pergunta — `PLATFORM_MANAGE` no escopo
 *       `PLATFORM`, como em `src/lib/platform/guard.ts`;
 *    3. o `redirectTo` que o formulário carregou (validado pela regra, nunca
 *       aqui).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FLAG DE PLATAFORMA NÃO MORA NO `getRequestContext()`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tentação é colocar "é SuperAdmin?" no contexto e deixar a casca decidir.
 *  Seria uma consulta ADMINISTRATIVA por render de TODA página autenticada — o
 *  preço de um painel que quase ninguém abre. O contexto responde "onde estou e o
 *  que posso AQUI"; o operador de plataforma é um fato da ENTRADA, e é só nela
 *  que ele precisa ser conhecido. Por isso este adaptador é chamado apenas pelo
 *  fluxo de entrada (login/cadastro/segundo fator, na fatia 2) — nenhum layout o
 *  importa, e `getRequestContext` segue sem saber que a plataforma existe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LOGIN NUNCA PODE FALHAR POR CAUSA DO DESTINO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa acabou de provar quem é. Se a leitura de plataforma falhar (banco,
 *  permissão da role, timeout), transformar isso em erro na tela de login seria
 *  trocar um destino ligeiramente menos preciso por um login impossível. A falha
 *  vira "não é operador" e o fluxo continua: no pior caso o SuperAdmin cai no
 *  painel da instituição ou na descoberta, e chega à governança pela URL.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { cookies } from 'next/headers';

import { can, type PlatformPrincipal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { resolveEntryDestination } from '@/domain/platform/entry-destination-rules';
import {
  activeMemberships,
  pickActiveMembership,
  pickChosenMembership,
} from '@/lib/auth/active-membership';
import {
  ACTIVE_TENANT_COOKIE,
  loadMemberships,
  loadPlatformPrincipal,
  parseActiveTenant,
  type TenantMembership,
} from '@/lib/auth/session';

/** O que o formulário de entrada carregou. */
export interface EntryDestinationOptions {
  /** Destino pretendido (`?redirectTo=`), ainda não validado — quem valida é a regra. */
  redirectTo?: string | null;
}

/**
 * As leituras de que o adaptador depende.
 *
 * Existe para o teste exercitar a COSTURA (a escolha do vínculo ativo, a falha de
 * plataforma, o `redirectTo`) com dublês, sem banco e sem cookie — e para deixar
 * explícito, no tipo, que este módulo só lê três coisas.
 */
export interface EntryDestinationDeps {
  loadMemberships(userId: string): Promise<readonly TenantMembership[]>;
  loadPlatformPrincipal(userId: string): Promise<PlatformPrincipal>;
  /** Slug desejado pelo cookie de contexto, já com a assinatura verificada. */
  readDesiredTenantSlug(): Promise<string | null>;
}

const PRODUCTION_DEPS: EntryDestinationDeps = {
  loadMemberships,
  loadPlatformPrincipal,
  readDesiredTenantSlug: async () => {
    const cookieStore = await cookies();

    return parseActiveTenant(cookieStore.get(ACTIVE_TENANT_COOKIE)?.value);
  },
};

/**
 * Escolhe a instituição ativa com o MESMO critério de `getRequestContext()`.
 *
 * A escolha em si vive em `pickActiveMembership` (FASE 82 · fatia 2), consumida
 * dos DOIS lados: o adaptador não pode chamar `getRequestContext()` (ela
 * devolveria o principal DO TENANT e pagaria uma consulta que a entrada não
 * precisa), e uma segunda cópia do critério faria o login cair numa instituição
 * diferente da que a casca mostraria logo depois.
 */
export async function resolveEntryDestinationForUser(
  userId: string,
  options: EntryDestinationOptions = {},
  deps: EntryDestinationDeps = PRODUCTION_DEPS,
): Promise<string> {
  const memberships = await deps.loadMemberships(userId);
  const desiredSlug = await deps.readDesiredTenantSlug();

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  "ATIVO" E "ESCOLHIDO" SÃO PERGUNTAS DIFERENTES (FASE 83)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `activeTenant` é o melhor vínculo (cookie válido, senão tipo → antiguidade →
   *  id) e serve para o destino de quem tem UM vínculo. `chosen` é o cookie
   *  REVALIDADO, e só existe quando a pessoa já escolheu — é o que a regra usa
   *  para não perguntar de novo quem tem 2+ vínculos. Os dois saem do mesmo
   *  módulo (`active-membership.ts`), então o critério de "ACTIVE" não vaza para
   *  cá e as duas perguntas nunca divergem.
   */
  const activeTenant = pickActiveMembership(memberships, desiredSlug);
  const chosenTenant = pickChosenMembership(memberships, desiredSlug);

  let isPlatformOperator = false;

  try {
    const principal = await deps.loadPlatformPrincipal(userId);

    isPlatformOperator = can(principal, PERMISSIONS.PLATFORM_MANAGE, { scope: 'PLATFORM' });
  } catch {
    /**
     * Falha de leitura NÃO é veredito (a mesma régua da inspeção de arquivos):
     * "não consegui saber" vira "não é operador" e o login segue. O contrário —
     * deixar a exceção subir — faria a pessoa não entrar por causa de uma
     * consulta que só melhora o destino.
     */
    isPlatformOperator = false;
  }

  return resolveEntryDestination({
    isPlatformOperator,
    chosenTenantSlug: chosenTenant?.tenantSlug ?? null,
    activeTenantSlug: activeTenant?.tenantSlug ?? null,
    activeLinkCount: activeMemberships(memberships).length,
    hasPendingInvite: memberships.some((membership) => membership.status === 'INVITED'),
    redirectTo: options.redirectTo,
  });
}
