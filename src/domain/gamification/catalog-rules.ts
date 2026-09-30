/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Escopo do catálogo de gamificação (FASE 51 · dívida E58)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ESCOPO É EXPLÍCITO, E NÃO UM `if` NA CONSULTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A exclusão de carta e de missão é LÓGICA desde a FASE 43: a linha continua no
 *  banco (`deletedAt`) e a leitura filtra `deletedAt: null`. O efeito colateral é
 *  que o item desaparece de TODAS as telas ao mesmo tempo, sem lugar nenhum onde
 *  vê-lo de novo — quem excluiu por engano dependia de `UPDATE deleted_at = NULL`
 *  no banco.
 *
 *  A correção não é "parar de filtrar": é a leitura dizer QUAL universo ela quer.
 *  `ATIVOS` (o padrão, e o que todo mundo já lia) × `ARQUIVADOS` (a lista que só
 *  existe para restaurar). Com o escopo como VALOR:
 *
 *    • o padrão continua `ATIVOS`, então nenhuma chamada antiga muda de sentido;
 *    • o escopo viaja pela URL (`?arquivados=1`) e a tela funciona sem JavaScript;
 *    • um serviço de leitura novo nasce obrigado a dizer de qual universo fala —
 *      em vez de herdar em silêncio o filtro que alguém escreveu antes.
 *
 *  A regra é PURA de propósito: o parse da query string é a única parte da jornada
 *  que dá para testar sem banco, e é justamente onde um `=== '1'` errado faria a
 *  tela abrir vazia sem ninguém entender por quê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const CATALOG_SCOPES = ['ATIVOS', 'ARQUIVADOS'] as const;

export type CatalogScope = (typeof CATALOG_SCOPES)[number];

/**
 * O parâmetro de endereço que abre o arquivo.
 *
 * `?arquivados=1` é o mesmo desenho das outras listas desta base (`?presente=1`,
 * `?certificado=1`): um endereço que a pessoa pode marcar, recarregar e mandar para
 * um colega — o que um botão que só troca estado no navegador não faz.
 */
export const CATALOG_ARCHIVE_PARAM = 'arquivados';

export function isCatalogScope(value: unknown): value is CatalogScope {
  return typeof value === 'string' && (CATALOG_SCOPES as readonly string[]).includes(value);
}

/**
 * Traduz o parâmetro da query no escopo.
 *
 * Qualquer coisa que não seja o marcador explícito vale `ATIVOS`: uma URL truncada
 * (`?arquivados=`) ou um valor inventado NÃO podem abrir uma lista de linhas
 * arquivadas, porque é dela que sai o botão de restaurar.
 */
export function catalogScopeFromQuery(raw: unknown): CatalogScope {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return value === '1' || value === 'true' ? 'ARQUIVADOS' : 'ATIVOS';
}

export const CATALOG_SCOPE_LABELS: Readonly<Record<CatalogScope, string>> = {
  ATIVOS: 'Catálogo ativo',
  ARQUIVADOS: 'Arquivados',
};

/** O rótulo do controle que LEVA ao outro escopo. */
export function catalogScopeToggleLabel(scope: CatalogScope): string {
  return scope === 'ARQUIVADOS' ? 'Voltar ao catálogo ativo' : 'Mostrar arquivados';
}
