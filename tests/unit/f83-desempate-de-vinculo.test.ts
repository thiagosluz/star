/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — FASE 83 · fatia 1
 *  O desempate do vínculo ativo e a pergunta quando há escolha
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO MEDIDO QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `participante@eventflow.test` tinha DOIS vínculos `ACTIVE`: a UFBA (seed) e uma
 *  instituição-resíduo criada por INSCRIÇÃO PÚBLICA numa fixture sem cleanup. O
 *  vínculo ativo era o "primeiro ATIVO" na ordem de `loadMemberships`, que ordena
 *  por `tenant.name` — "Instituição sem espaço…" < "Universidade…", então a pessoa
 *  entrava na instituição-resíduo. E a regra de destino olhava só SE existia
 *  vínculo ativo: com dois, a pessoa nunca era perguntada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDA, EM DUAS CAMADAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. `pickActiveMembership` deixa de pegar o primeiro e passa a escolher o MELHOR
 *     com ordem intencional: `kind` (MEMBER antes de PARTICIPANT) → antiguidade
 *     (`joinedAt`, com `createdAt` de reserva) → `tenantId`. Esta camada é testada
 *     aqui SEM banco, SEM cookie e SEM Next.
 *  2. `resolveEntryDestination` deixa de receber um booleano e passa a receber
 *     QUANTOS vínculos ativos existem (`activeLinkCount`) + a escolha explícita já
 *     feita (`chosenTenantSlug`, derivada do cookie revalidado). Com 2+ vínculos
 *     sem cookie, o destino é o seletor — a pergunta, não um palpite.
 *
 *  A nota de honestidade do caso medido: no banco real os DOIS vínculos do
 *  `participante@` estão com `kind = PARTICIPANT` (é um participante na UFBA e um
 *  resíduo de inscrição). O primeiro degrau (`MEMBER` × `PARTICIPANT`) é a regra
 *  certa para equipe × público, mas quem resolve o caso medido HOJE é o segundo:
 *  a UFBA é o vínculo mais antigo. Os dois degraus têm caso próprio abaixo, para
 *  que a prova não dependa de qual dado a fixture deixou no banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveEntryDestination,
  type EntryDestinationInput,
} from '../../src/domain/platform/entry-destination-rules';
import {
  SELECT_INSTITUTION_PATH,
  tenantDashboardPath,
} from '../../src/domain/platform/vitrine-account-rules';
import { PLATFORM_HOME_PATH } from '../../src/domain/platform/platform-nav-rules';
import {
  activeMemberships,
  pickActiveMembership,
  pickChosenMembership,
} from '../../src/lib/auth/active-membership';
import {
  resolveEntryDestinationForUser,
  type EntryDestinationDeps,
} from '../../src/lib/auth/entry-destination';
import type { PlatformPrincipal } from '../../src/domain/rbac/authorization';
import type { TenantMembership } from '../../src/lib/auth/session';

const UFBA = 'ufba-demo';
const RESIDUO = 'f21-apertada-035169fa';
const USER = 'pessoa-1';

// ───────────────────────────────────────────────────────────────────────────────
//  Construtores
// ───────────────────────────────────────────────────────────────────────────────
interface VinculoInput {
  slug: string;
  tenantId?: string;
  /** Só para provar que o NOME não participa da decisão. */
  name?: string;
  status?: TenantMembership['status'];
  kind?: TenantMembership['kind'];
  joinedAt?: Date | null;
  createdAt?: Date;
}

const ANTIGO = new Date('2026-10-06T23:07:19.560Z');
const RECENTE = new Date('2026-10-24T20:46:51.716Z');

function vinculo(input: VinculoInput): TenantMembership {
  return {
    tenantId: input.tenantId ?? `tenant-${input.slug}`,
    tenantSlug: input.slug,
    tenantName: input.name ?? input.slug,
    tenantLogoUrl: null,
    status: input.status ?? 'ACTIVE',
    kind: input.kind ?? 'PARTICIPANT',
    joinedAt: input.joinedAt === undefined ? RECENTE : input.joinedAt,
    createdAt: input.createdAt ?? RECENTE,
    roles: [],
    isPrivileged: false,
  };
}

/** A UFBA como o seed a deixa: o vínculo mais antigo do `participante@`. */
function ufba(kind: TenantMembership['kind'] = 'PARTICIPANT'): TenantMembership {
  return vinculo({
    slug: UFBA,
    name: 'Universidade Federal da Bahia',
    kind,
    joinedAt: ANTIGO,
    createdAt: ANTIGO,
  });
}

/** O resíduo da fixture: nome que vence no alfabeto, mas relação mais nova. */
function residuo(kind: TenantMembership['kind'] = 'PARTICIPANT'): TenantMembership {
  return vinculo({
    slug: RESIDUO,
    name: 'Instituição sem espaço 035169fa',
    kind,
    joinedAt: RECENTE,
    createdAt: RECENTE,
  });
}

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

const SEM_PLATAFORMA: PlatformPrincipal = {
  userId: USER,
  tenantId: null,
  membershipStatus: 'ACTIVE',
  assignments: [],
};

function dublês(overrides: Partial<EntryDestinationDeps> = {}): EntryDestinationDeps {
  return {
    loadMemberships: async () => [],
    loadPlatformPrincipal: async () => SEM_PLATAFORMA,
    readDesiredTenantSlug: async () => null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('o desempate do vínculo ativo — kind → antiguidade → tenantId', () => {
  it('MEMBER vence PARTICIPANT: quem é da equipe entra na instituição dela', () => {
    /**
     * O resíduo vem PRIMEIRO no array e primeiro no alfabeto — as duas coisas que
     * a regra antiga usava. Se o `MEMBER` perder, a pessoa volta a cair na casa
     * que só a inscreveu num evento.
     */
    const escolhido = pickActiveMembership(
      [residuo('PARTICIPANT'), ufba('MEMBER')],
      null,
    );

    expect(escolhido?.tenantSlug).toBe(UFBA);
  });

  it('dois PARTICIPANT: vence o vínculo mais ANTIGO, não o nome que vem antes', () => {
    const antigo = vinculo({
      slug: 'zzz-instituicao-antiga',
      name: 'Zzz Instituição Antiga',
      joinedAt: ANTIGO,
      createdAt: ANTIGO,
    });
    const recente = vinculo({
      slug: 'aaa-instituicao-recente',
      name: 'Aaa Instituição Recente',
      joinedAt: RECENTE,
      createdAt: RECENTE,
    });

    expect(pickActiveMembership([recente, antigo], null)?.tenantSlug).toBe(
      'zzz-instituicao-antiga',
    );
  });

  it('`joinedAt` nulo cai para o `createdAt` do perfil, e a escolha continua determinística', () => {
    /**
     * `joinedAt` existe em `user_tenant_profiles`, mas é NULO em convite nunca
     * aceito e em linha legada. A reserva é o `createdAt` — imutável — e é o que
     * impede o desempate de virar "undefined < Date" e escolher por acidente.
     */
    const legado = vinculo({
      slug: 'legado',
      joinedAt: null,
      createdAt: ANTIGO,
    });
    const convidadoAceito = vinculo({
      slug: 'novo',
      joinedAt: RECENTE,
      createdAt: RECENTE,
    });

    expect(pickActiveMembership([convidadoAceito, legado], null)?.tenantSlug).toBe('legado');
  });

  it('mesmo tipo e mesmo instante: `tenantId` asc decide, mesmo com NOMES IGUAIS e array invertido', () => {
    /**
     * `Tenant.name` NÃO é único (schema.prisma). A ordem antiga, por nome, dava
     * resultado arbitrário entre dois homônimos — e a pessoa podia entrar numa
     * instituição diferente a cada requisição. `tenantId` é único e estável.
     */
    const nomeIgual = 'Instituto Homônimo';
    const b = vinculo({
      slug: 'b',
      tenantId: '00000000-0000-7000-8000-00000000000b',
      name: nomeIgual,
      joinedAt: ANTIGO,
      createdAt: ANTIGO,
    });
    const a = vinculo({
      slug: 'a',
      tenantId: '00000000-0000-7000-8000-00000000000a',
      name: nomeIgual,
      joinedAt: ANTIGO,
      createdAt: ANTIGO,
    });

    expect(pickActiveMembership([b, a], null)?.tenantSlug).toBe('a');
    expect(pickActiveMembership([a, b], null)?.tenantSlug).toBe('a');
  });

  it('o cookie VÁLIDO vence o desempate — a escolha da pessoa não é recalculada', () => {
    const escolhido = pickActiveMembership([ufba('MEMBER'), residuo()], RESIDUO);

    // Mesmo sendo o vínculo mais novo e de público, foi a resposta que ela deu.
    expect(escolhido?.tenantSlug).toBe(RESIDUO);
  });

  it('sem vínculo ATIVO, `null` — convite pendente não é contexto operacional', () => {
    const convites = [
      vinculo({ slug: 'a', status: 'INVITED' }),
      vinculo({ slug: 'b', status: 'SUSPENDED' }),
    ];

    expect(pickActiveMembership(convites, null)).toBeNull();
    expect(pickChosenMembership(convites, 'a')).toBeNull();
    expect(activeMemberships(convites)).toEqual([]);
  });

  it('`activeMemberships` conta só ACTIVE — a contagem da regra não redefine "operacional"', () => {
    const lista = [ufba('MEMBER'), vinculo({ slug: 'convite', status: 'INVITED' }), residuo()];

    expect(activeMemberships(lista).map((m) => m.tenantSlug)).toEqual([UFBA, RESIDUO]);
  });

  it('escolher o vínculo NÃO reordena o array recebido — a ordem é a do seletor', () => {
    /**
     * O desempate roda em memória, sobre uma cópia. Reordenar o array de
     * `loadMemberships` no lugar mudaria a lista alfabética do seletor e do menu
     * de conta como efeito colateral de escolher o contexto.
     */
    const membros = [residuo(), ufba('MEMBER')];

    pickActiveMembership(membros, null);

    expect(membros.map((m) => m.tenantSlug)).toEqual([RESIDUO, UFBA]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a regra de destino — quantos vínculos, e a escolha já feita', () => {
  it('1 vínculo ativo: o painel dele (não há o que perguntar)', () => {
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 1, activeTenantSlug: UFBA }),
    );

    expect(destino).toBe(tenantDashboardPath(UFBA));
  });

  it('2 vínculos SEM cookie: o seletor — a regra antiga mandava ao painel do "primeiro"', () => {
    /**
     * ESTE é o caso que a nova contagem invalida: antes, `hasActiveLink = true` e
     * um slug bastavam para mandar ao painel. Com dois vínculos e nenhuma escolha
     * explícita, o sistema não tem resposta — quem tem é a pessoa.
     */
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 2, activeTenantSlug: UFBA }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
    expect(destino).not.toBe(tenantDashboardPath(UFBA));
  });

  it('2 vínculos COM cookie válido: o painel do ESCOLHIDO, mesmo havendo outro melhor', () => {
    const destino = resolveEntryDestination(
      entrada({
        activeLinkCount: 2,
        activeTenantSlug: UFBA,
        chosenTenantSlug: RESIDUO,
      }),
    );

    expect(destino).toBe(tenantDashboardPath(RESIDUO));
  });

  it('2 vínculos com cookie que NÃO revalida (chosen nulo): o seletor', () => {
    // O adaptador só preenche `chosenTenantSlug` depois de revalidar o cookie
    // contra um vínculo ACTIVE; cookie órfão ou de convite chega aqui como null.
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 2, activeTenantSlug: UFBA, chosenTenantSlug: null }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('3 vínculos também perguntam — a regra não tem número mágico para "dois"', () => {
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 3, activeTenantSlug: UFBA }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('1 vínculo sem slug + convite: o seletor, sem montar `/t/null/dashboard`', () => {
    const destino = resolveEntryDestination(
      entrada({ activeLinkCount: 1, activeTenantSlug: null, hasPendingInvite: true }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('a contagem não atropela o `redirectTo` nem o operador de plataforma', () => {
    const comDestino = resolveEntryDestination(
      entrada({
        redirectTo: '/t/ufba-demo/minhas-inscricoes',
        activeLinkCount: 2,
        activeTenantSlug: UFBA,
      }),
    );
    const operador = resolveEntryDestination(
      entrada({ isPlatformOperator: true, activeLinkCount: 2, activeTenantSlug: UFBA }),
    );

    expect(comDestino).toBe('/t/ufba-demo/minhas-inscricoes');
    // A governança é a casa do operador, e é o mesmo caminho da F82.
    expect(operador).toBe(PLATFORM_HOME_PATH);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o adaptador — o cookie é a resposta que a pessoa já deu', () => {
  it('o caso medido: UFBA + resíduo, sem cookie → o SELETOR, nunca o painel do resíduo', async () => {
    /**
     * Reproduz o banco de hoje: os DOIS vínculos são `PARTICIPANT` (é um
     * participante na UFBA e um resíduo de inscrição). Antes, o nome do resíduo
     * ("Instituição…" < "Universidade…") fazia a pessoa ENTRAR nele. Agora, com
     * dois vínculos e nenhuma escolha, ela é PERGUNTADA — e o que a regra não
     * pode voltar a fazer é mandá-la ao painel do resíduo.
     */
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadMemberships: async () => [residuo(), ufba()] }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
    expect(destino).not.toBe(tenantDashboardPath(RESIDUO));
  });

  it('o caso medido, depois da escolha: cookie da UFBA → painel da UFBA, sem perguntar de novo', async () => {
    // É o `switchTenantAction` gravando o cookie: a resposta que a pessoa deu
    // passa a vencer a contagem na entrada seguinte.
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [residuo(), ufba()],
        readDesiredTenantSlug: async () => UFBA,
      }),
    );

    expect(destino).toBe(tenantDashboardPath(UFBA));
  });

  it('o primeiro degrau no adaptador: MEMBER + PARTICIPANT → seletor, com o MEMBER como contexto', async () => {
    const membros = [residuo('PARTICIPANT'), ufba('MEMBER')];

    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadMemberships: async () => membros }),
    );

    // Dois vínculos ativos: a pergunta é feita...
    expect(destino).toBe(SELECT_INSTITUTION_PATH);
    // ...e o contexto que o seletor mostra como atual é a equipe, não o resíduo.
    expect(pickActiveMembership(membros, null)?.tenantSlug).toBe(UFBA);
  });

  it('2 vínculos, nenhuma escolha → seletor (a pessoa é perguntada)', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({ loadMemberships: async () => [ufba(), residuo()] }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('2 vínculos, cookie VÁLIDO → painel do escolhido, sem perguntar de novo', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [ufba('MEMBER'), residuo()],
        readDesiredTenantSlug: async () => RESIDUO,
      }),
    );

    expect(destino).toBe(tenantDashboardPath(RESIDUO));
  });

  it('2 vínculos, cookie apontando para CONVITE (não revalida) → seletor', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [
          ufba(),
          residuo(),
          vinculo({ slug: 'so-convite', status: 'INVITED' }),
        ],
        readDesiredTenantSlug: async () => 'so-convite',
      }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('2 vínculos, cookie apontando para slug INEXISTENTE → seletor', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [ufba(), residuo()],
        readDesiredTenantSlug: async () => 'instituicao-que-nao-existe',
      }),
    );

    expect(destino).toBe(SELECT_INSTITUTION_PATH);
  });

  it('com UM vínculo, o cookie órfão não desvia — o painel é o único ativo', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [ufba('MEMBER')],
        readDesiredTenantSlug: async () => 'outra-instituicao',
      }),
    );

    expect(destino).toBe(tenantDashboardPath(UFBA));
  });

  it('com UM vínculo e convite em outra casa, o painel continua sendo o do vínculo', async () => {
    const destino = await resolveEntryDestinationForUser(
      USER,
      {},
      dublês({
        loadMemberships: async () => [
          ufba('MEMBER'),
          vinculo({ slug: 'convite', status: 'INVITED' }),
        ],
      }),
    );

    expect(destino).toBe(tenantDashboardPath(UFBA));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Catraca de fonte — a decisão NÃO pode voltar a depender do nome
// ═══════════════════════════════════════════════════════════════════════════════
function ler(caminho: string): string {
  return readFileSync(join(process.cwd(), caminho), 'utf8');
}

describe('catraca do desempate — nome não é critério', () => {
  it('a escolha do vínculo ativo NÃO lê `tenantName`', () => {
    /**
     * A ordem antiga era a da consulta por `tenant.name`; o defeito era
     * justamente o nome decidir a casa da pessoa. Se `tenantName` aparecer neste
     * módulo, a regra voltou a olhar para o alfabeto.
     */
    expect(ler('src/lib/auth/active-membership.ts')).not.toContain('tenantName');
  });

  it('`loadMemberships` continua ordenando por nome — a ordem é a do SELETOR', () => {
    // A justificativa de ordenar em memória (e não trocar o `orderBy`) é que a
    // lista do seletor e do menu de conta é alfabética. Se esta linha sumir, a
    // ordenação pode ter migrado para o banco e mudado as duas telas.
    const sessao = ler('src/lib/auth/session.ts');

    expect(sessao).toContain("orderBy: { tenant: { name: 'asc' } }");
  });
});
