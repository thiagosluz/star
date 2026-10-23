import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS FRASES DAS PÁGINAS DE ERRO E DE NÃO ENCONTRADO (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É DOMÍNIO, E NÃO TEXTO DENTRO DE CADA ARQUIVO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O app tinha **zero `not-found.tsx` e zero `error.tsx`**: todo `notFound()` caía na
 *  página padrão do Next (uma frase em inglês, sem caminho de volta) e todo erro de
 *  rota subia para o `global-error`, que desenha sem o CSS do app. Criar oito arquivos
 *  com a frase escrita à mão em cada um resolveria o sintoma e criaria o próximo
 *  defeito: a mesma ideia de "não encontramos isso" com quatro redações diferentes,
 *  e nenhuma delas testável.
 *
 *  Aqui a frase é DADO, uma vez por ÁREA, e a tela só escolhe o campo. O teste lê
 *  esta tabela e prende as três regras que importam — e o teste de fonte reprova o
 *  componente que voltar a escrever a frase no JSX.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS REGRAS QUE A REDAÇÃO PRECISA RESPEITAR
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. **O 404 é UNIFORME.** "Não existe", "foi removido" e "não está disponível para
 *     você" aparecem JUNTOS, sempre: separá-los faria a página responder, pelo texto,
 *     a pergunta que o servidor recusou a responder (o mesmo motivo pelo qual a posse
 *     do upload responde `NOT_OWNER` nas duas etapas — FASE 74). Numa plataforma
 *     multi-tenant, "isto não existe" para um recurso privado é um oráculo.
 *  2. **O erro não culpa a pessoa e não vaza detalhe técnico.** Nada de `error.message`,
 *     `stack` ou `digest` na tela: o leitor é quem estava trabalhando, não quem vai
 *     depurar. A referência técnica continua existindo — no log do servidor e no
 *     `console.error` do boundary —, que é onde ela serve para alguma coisa.
 *  3. **Sempre há um caminho de volta**, e o primeiro é o da ÁREA: o painel para quem
 *     estava trabalhando, a vitrine para quem estava visitando a instituição, a
 *     página inicial para a plataforma. Área sem saída é a página que só informa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A SAÍDA DEPENDE DO SLUG — E O QUE ACONTECE SEM ELE
 * ─────────────────────────────────────────────────────────────────────────────
 *  `not-found.tsx` **não recebe `params`** (o Next o renderiza como
 *  `createElement(Component, null)` — conferido no código do framework), então o slug
 *  chega por fora: o header `x-ef-tenant-slug` que o Proxy injeta, ou o `useParams()`
 *  do `error.tsx` (que é client component). Quando ele não vier — o caso defensivo —,
 *  a saída NÃO vira link relativo quebrado: cai no seletor de instituição, que é o
 *  destino honesto de quem está sem contexto.
 */

/** As três superfícies que têm casca própria — e por isso precisam de página própria. */
export const ERROR_AREAS = ['app', 'public', 'platform'] as const;

/**
 * A área da tela.
 *
 * - `app` — a casca autenticada da instituição (`/t/<slug>/(app)`), com barra lateral;
 * - `public` — a área pública da instituição (`/t/<slug>/(public)`), com cabeçalho e
 *   rodapé públicos;
 * - `platform` — a raiz e as telas de plataforma (`/`, `/login`, `/superadmin`,
 *   `/(public)`), que não pertencem a instituição nenhuma.
 */
export type ErrorArea = (typeof ERROR_AREAS)[number];

/** Um caminho de volta: o rótulo diz para onde, o `href` é o destino real. */
export interface AreaExit {
  readonly label: string;
  readonly href: string;
}

/** O que uma página "não encontrada" diz. */
export interface NotFoundContent {
  /** Rótulo pequeno acima do título — é o que confirma que a resposta foi 404. */
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly exits: readonly AreaExit[];
}

/** O que uma página de erro diz. */
export interface ErrorContent {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  /** O rótulo do botão que REFAZ a operação (o `reset` de verdade do boundary). */
  readonly retryLabel: string;
  readonly exits: readonly AreaExit[];
}

/**
 * A descrição do 404 — a MESMA para as três áreas.
 *
 * A área muda o caminho de volta, não o que aconteceu: uma pessoa que abre um
 * endereço inexistente precisa ler a mesma explicação no painel e na vitrine. As
 * três hipóteses estão no texto de propósito (ver a regra 1 no cabeçalho).
 */
const NOT_FOUND_DESCRIPTION =
  'Este endereço não existe, foi removido ou não está disponível para você. ' +
  'Nenhum dado foi alterado.';

/**
 * A descrição do erro — a MESMA para as três áreas.
 *
 * "A falha foi do nosso lado" nomeia a responsabilidade sem nomear a pessoa; "já foi
 * registrada" é verdade (o boundary escreve no log) e evita a pergunta "alguém vai
 * saber disso?".
 */
const ERROR_DESCRIPTION =
  'A falha foi do nosso lado, não sua, e já foi registrada para a equipe responsável. ' +
  'Tentar de novo costuma resolver; se não resolver, os caminhos abaixo continuam funcionando.';

/** A vitrine da instituição — o endereço público que sempre existe para um slug. */
function tenantHome(slug: string): string {
  return tenantPath(slug, '/eventos');
}

/** O painel da instituição — o endereço de quem estava trabalhando. */
function tenantDashboard(slug: string): string {
  return tenantPath(slug, '/dashboard');
}

/**
 * Para onde volta quem estava na área AUTENTICADA.
 *
 * Sem slug, `/selecionar-instituicao` — e não `/t/undefined/dashboard`.
 */
function appExits(tenantSlug: string | null | undefined): readonly AreaExit[] {
  return [
    tenantSlug
      ? { label: 'Voltar ao painel', href: tenantDashboard(tenantSlug) }
      : { label: 'Escolher instituição', href: '/selecionar-instituicao' },
    { label: 'Ir para a página inicial', href: '/' },
  ];
}

/** Para onde volta quem estava na área PÚBLICA da instituição. */
function publicExits(tenantSlug: string | null | undefined): readonly AreaExit[] {
  return [
    tenantSlug
      ? { label: 'Ver os eventos da instituição', href: tenantHome(tenantSlug) }
      : { label: 'Ver todos os eventos', href: '/eventos' },
    { label: 'Ir para a página inicial', href: '/' },
  ];
}

/** Para onde volta quem estava na plataforma (raiz, login, governança). */
function platformExits(): readonly AreaExit[] {
  return [
    { label: 'Ir para a página inicial', href: '/' },
    { label: 'Ver todos os eventos', href: '/eventos' },
  ];
}

function exitsFor(
  area: ErrorArea,
  tenantSlug: string | null | undefined,
): readonly AreaExit[] {
  switch (area) {
    case 'app':
      return appExits(tenantSlug);
    case 'public':
      return publicExits(tenantSlug);
    case 'platform':
      return platformExits();
  }
}

/**
 * O slug que veio da URL, quando ele existe.
 *
 * O `useParams()` devolve `string | string[]` (um segmento repetido vira lista), e a
 * tela de erro precisa de uma string ou de nada. A normalização mora aqui — e não em
 * cada `error.tsx` — porque é a MESMA pergunta nas duas áreas autenticadas, e porque
 * um `String(params.tenantSlug)` ingênuo transformaria a lista inteira num slug
 * inexistente (`/t/a,b/dashboard`).
 */
export function tenantSlugFromParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();

  return trimmed ? trimmed : null;
}

/**
 * O conteúdo da página de NÃO ENCONTRADO, por área.
 *
 * `tenantSlug` é opcional porque a tela pode ser alcançada sem contexto (um
 * `notFound()` num layout, um endereço digitado à mão) — e a saída é honesta nos
 * dois casos.
 */
export function notFoundContent(input: {
  area: ErrorArea;
  tenantSlug?: string | null;
}): NotFoundContent {
  return {
    eyebrow: 'Erro 404',
    title: 'Página não encontrada',
    description: NOT_FOUND_DESCRIPTION,
    exits: exitsFor(input.area, input.tenantSlug),
  };
}

/**
 * O conteúdo da página de ERRO, por área.
 *
 * Não existe campo para mensagem técnica: o que não pode ser exibido não pode ser
 * passado por engano. O `error` do boundary chega ao componente apenas para o log.
 */
export function errorContent(input: {
  area: ErrorArea;
  tenantSlug?: string | null;
}): ErrorContent {
  return {
    eyebrow: 'Erro inesperado',
    title: 'Não foi possível abrir esta página',
    description: ERROR_DESCRIPTION,
    retryLabel: 'Tentar de novo',
    exits: exitsFor(input.area, input.tenantSlug),
  };
}
