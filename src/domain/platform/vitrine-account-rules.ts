/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A conta da pessoa na vitrine da plataforma (a raiz `/`)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA REGRA SAIU DA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz decidia o destino da pessoa autenticada com dois `redirect()` no corpo do
 *  Server Component: com instituição ativa ia para
 *  `/t/<slug>/dashboard`; autenticada sem vínculo ia para
 *  `/selecionar-instituicao`. Enquanto era redirect, a decisão podia morar na
 *  página — ela acontecia UMA vez, e o navegador nunca via a raiz.
 *
 *  Agora a vitrine renderiza para todo mundo e o mesmo destino virou o `href` de um
 *  botão. O destino não pode ser reinventado no JSX: se ele divergisse do que o
 *  redirect fazia, a pessoa logada cairia num lugar diferente do que caía antes. Por
 *  isso a decisão é uma FUNÇÃO PURA — a página só a consome, e o teste a prende sem
 *  navegador nem banco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELA DECIDE, E O QUE NÃO DECIDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Decide apenas QUAL dos dois desenhos do cabeçalho aparece (um botão × dois
 *  botões) e para onde o botão da conta leva. NÃO decide autorização: quem diz se há
 *  sessão e qual é a instituição ativa é `getRequestContext()` — a mesma leitura que
 *  o redirect usava, com o cookie assinado revalidado contra os vínculos reais. Esta
 *  função recebe esse fato já apurado; ela não lê sessão nem adivinha contexto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * O rótulo da área autenticada — FONTE ÚNICA.
 *
 * Existia como literal solto no cabeçalho público da instituição
 * (`PublicHeader`, em `src/components/shell/account-block.tsx`). O cabeçalho da
 * vitrine passou a precisar do MESMO texto, e duas strings iguais em dois arquivos
 * divergem no primeiro ajuste de linguagem. Quem importa daqui não escreve uma
 * segunda.
 */
export const MINHA_AREA_LABEL = 'Minha área';

/** Destino de quem tem sessão mas ainda não tem vínculo ativo com instituição alguma. */
export const SELECT_INSTITUTION_PATH = '/selecionar-instituicao';

/** Os dois caminhos do visitante sem sessão — os mesmos de antes desta mudança. */
export const VITRINE_LOGIN_PATH = '/login';
export const VITRINE_SIGNUP_PATH = '/signup';

/**
 * O caminho do painel dentro de uma instituição.
 *
 * É `tenantPath`, e não uma concatenação de string: a mesma função que o redirect
 * usava monta o prefixo `/t/<slug>` — o endereço canônico por path, que é o que
 * funciona em desenvolvimento (sem DNS wildcard) e nos testes.
 */
export function tenantDashboardPath(tenantSlug: string): string {
  return tenantPath(tenantSlug, '/dashboard');
}

/** O desenho do cabeçalho: um botão de conta, ou os dois botões de entrada. */
export type VitrineAccountAction =
  | { readonly kind: 'account'; readonly label: string; readonly href: string }
  | { readonly kind: 'guest'; readonly loginHref: string; readonly signupHref: string };

/**
 * Decide o que o cabeçalho da vitrine mostra para esta requisição.
 *
 * A ordem das perguntas é a mesma do redirect que esta função substitui:
 * "há sessão?" e, havendo, "há instituição ativa?" — nunca o contrário. Autenticada
 * SEM vínculo continua sendo conta (o botão leva ao seletor de instituição, que é o
 * lugar de resolver o vínculo), e não visitante: mandá-la para "Entrar" seria pedir
 * um login que ela já tem.
 */
export function resolveVitrineAccountAction(input: {
  isAuthenticated: boolean;
  /** Slug da instituição ativa já validada contra os vínculos; `null` se não houver. */
  activeTenantSlug: string | null;
}): VitrineAccountAction {
  if (!input.isAuthenticated) {
    return {
      kind: 'guest',
      loginHref: VITRINE_LOGIN_PATH,
      signupHref: VITRINE_SIGNUP_PATH,
    };
  }

  return {
    kind: 'account',
    label: MINHA_AREA_LABEL,
    href: input.activeTenantSlug
      ? tenantDashboardPath(input.activeTenantSlug)
      : SELECT_INSTITUTION_PATH,
  };
}
