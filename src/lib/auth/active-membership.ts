/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — qual vínculo é o "contexto atual" (FASE 82 · fatia 2 / FASE 83)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA FUNÇÃO SAIU DE DENTRO DE DOIS ARQUIVOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A escolha do vínculo ativo existia DUAS vezes: em `getRequestContext()`
 *  (`session.ts`) e no adaptador de entrada (`entry-destination.ts`), com as
 *  mesmas seis linhas copiadas. A cópia é o defeito: as duas decidem em que
 *  instituição a pessoa está operando, e no dia em que uma delas mudasse o
 *  critério — aceitar convite, desempatar por outro campo — o login mandaria a
 *  pessoa para `/t/<A>/dashboard` e a casca renderizaria a instituição B logo
 *  depois, com o menu de uma e o painel da outra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CRITÉRIO (o mesmo dos dois lados, agora de uma fonte só)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. o cookie assinado (`ef_tenant`) manda, MAS só se apontar para um vínculo
 *     ATIVO — convite pendente não concede contexto operacional (fail-closed);
 *  2. sem cookie válido, o MELHOR vínculo ATIVO é o padrão (não o primeiro que o
 *     banco devolveu). "Melhor" tem ordem declarada e estável — ver abaixo;
 *  3. sem vínculo ativo, `null` — quem chama decide o que fazer.
 *
 *  A função é pura e recebe o slug desejado já com a assinatura verificada
 *  (`parseActiveTenant`), para que a leitura de cookie continue sendo de quem lê
 *  cookie — esta camada não conhece Next.
 *
 *  ═══════════════════════════════════════════════════════════════════════════════
 *  O DESEMPATE É INTENCIONAL — E NÃO USA O NOME (FASE 83)
 *  ═══════════════════════════════════════════════════════════════════════════════
 *  Até a FASE 82 o padrão era "o primeiro ATIVO na ordem devolvida por
 *  `loadMemberships`", que ordena por `tenant.name`. Isso produzia um defeito
 *  silencioso e real: quem tinha dois vínculos ATIVOS — o da instituição em que
 *  trabalha e um criado por INSCRIÇÃO PÚBLICA num evento de outra instituição —
 *  caía na instituição cujo nome vinha primeiro no alfabeto. O `participante@`
 *  é o caso medido: "Instituição sem espaço…" < "Universidade…", então a pessoa
 *  entrava na instituição-resíduo.
 *
 *  A ordem abaixo é a regra, nesta sequência:
 *
 *    1º `kind = MEMBER` antes de `PARTICIPANT`
 *       Quem faz parte da EQUIPE de uma instituição entra nela. Um vínculo
 *       criado por inscrição pública é público de evento: a pessoa se inscreveu
 *       para assistir a uma atividade, não para morar ali. É o único degrau que
 *       distingue os dois TIPOS de relação — e resolve o caso sem olhar nome.
 *
 *    2º `joinedAt` ascendente (o vínculo mais ANTIGO)
 *       Empatado o tipo, vale a relação mais antiga: é a que a pessoa construiu
 *       primeiro, e a que permanece estável entre entradas. `joinedAt` existe em
 *       `user_tenant_profiles` (é o campo usado), mas é NULO em convite nunca
 *       aceito e em linha legada; nesse caso a reserva é o `createdAt` do
 *       perfil — imutável, e por isso a escolha continua determinística.
 *
 *       Nota: `joinedAt` passou a ser escrito SÓ no `create` na FASE 83 — nem o
 *       `db:seed:dev` nem o `upsert` da inscrição pública o regravam. Era essa a
 *       fragilidade que o relatório da fatia 1 apontava, e é o que torna o degrau
 *       confiável entre execuções (o teste `f83-joined-at` roda o seed REAL e
 *       confere a data preservada).
 *
 *    3º `tenantId` ascendente
 *       Empate final sem significado de produto: serve para o resultado ser
 *       DETERMINÍSTICO quando dois vínculos têm o mesmo tipo e o mesmo instante.
 *       O nome NÃO entra aqui — `Tenant.name` não é único (`schema.prisma`), e
 *       dois nomes iguais davam ordem arbitrária. `tenantId` é único e estável,
 *       então a mesma pessoa com os mesmos vínculos chega sempre ao mesmo lugar.
 *
 *  A ordenação vive AQUI, em memória, e não no `orderBy` de `loadMemberships`:
 *  a ordem daquela consulta é a do SELETOR (alfabética, o que a pessoa espera na
 *  hora de escolher). Levar o desempate para o banco mudaria a lista de todas as
 *  instituições para resolver o contexto de UMA — e faria o vínculo ativo
 *  depender da ordenação de uma tela.
 */
import type { TenantMembership } from '@/lib/auth/session';

type MembershipKindName = TenantMembership['kind'];

/**
 * A hierarquia dos tipos de vínculo — menor vence.
 *
 * O `Record` tipado (e não um número solto em cada `if`) é o que faz o
 * `typecheck` reprovar se um `MembershipKind` novo aparecer no schema sem uma
 * decisão explícita de precedência.
 */
const KIND_RANK: Readonly<Record<MembershipKindName, number>> = {
  MEMBER: 0,
  PARTICIPANT: 1,
};

/**
 * Os vínculos operacionais, na ordem em que vieram do banco.
 *
 * Existe para que o CRITÉRIO (`status === 'ACTIVE'`) continue tendo uma casa só:
 * o adaptador de entrada precisa CONTAR os ativos para a regra de destino, e a
 * contagem não pode ser uma segunda definição de "vínculo operacional".
 */
export function activeMemberships(
  memberships: readonly TenantMembership[],
): TenantMembership[] {
  return memberships.filter((membership) => membership.status === 'ACTIVE');
}

/** A data que ordena a antiguidade do vínculo — `joinedAt`, com `createdAt` de reserva. */
function membershipAge(membership: TenantMembership): number {
  return (membership.joinedAt ?? membership.createdAt).getTime();
}

/**
 * Compara dois vínculos ATIVOS pelo desempate intencional (tipo → antiguidade → id).
 *
 * `tenantId` é comparado por código de unidade (não `localeCompare`) de propósito:
 * a colação depende de locale/ICU, e a regra precisa dar o MESMO resultado no
 * servidor, no teste e no worker.
 */
function compareActiveMemberships(a: TenantMembership, b: TenantMembership): number {
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind !== 0) return byKind;

  const byAge = membershipAge(a) - membershipAge(b);
  if (byAge !== 0) return byAge;

  if (a.tenantId < b.tenantId) return -1;
  if (a.tenantId > b.tenantId) return 1;

  return 0;
}

/**
 * O vínculo que o cookie pediu — e SÓ ele.
 *
 * É a "resposta que a pessoa já deu": quando o `switchTenantAction` grava o
 * cookie, a próxima entrada não deve perguntar de novo. Devolver `null` aqui
 * significa "não houve escolha explícita (ou ela não revalida como ATIVA)", e é
 * essa distinção que a regra de destino usa para decidir entre abrir o painel e
 * mostrar o seletor.
 */
export function pickChosenMembership(
  memberships: readonly TenantMembership[],
  desiredSlug: string | null,
): TenantMembership | null {
  if (!desiredSlug) return null;

  return (
    memberships.find(
      (membership) =>
        membership.tenantSlug === desiredSlug && membership.status === 'ACTIVE',
    ) ?? null
  );
}

/**
 * O vínculo ativo, ou `null` quando a pessoa não tem nenhum vínculo operacional.
 *
 * `desiredSlug` é o que o cookie pediu; `null` significa "não há cookie válido".
 * O cookie vence o desempate porque ele é a única escolha EXPLÍCITA da pessoa;
 * sem ele, vale a melhor relação pela ordem documentada no cabeçalho.
 */
export function pickActiveMembership(
  memberships: readonly TenantMembership[],
  desiredSlug: string | null,
): TenantMembership | null {
  const chosen = pickChosenMembership(memberships, desiredSlug);
  if (chosen) return chosen;

  /**
   * `sort` sobre uma CÓPIA: esta função é chamada a cada requisição com o array
   * de `loadMemberships`, e reordená-lo no lugar mudaria a ordem do seletor como
   * efeito colateral de escolher o contexto.
   */
  const [best] = [...activeMemberships(memberships)].sort(compareActiveMemberships);

  return best ?? null;
}
