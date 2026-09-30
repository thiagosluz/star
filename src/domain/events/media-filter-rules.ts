/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Filtros do acervo de mídia (dívida E19, FASE 51)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS REGRAS SAEM DA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela do acervo recebe o filtro pela URL (`?busca=&tipo=&evento=&uso=`), e URL é
 *  texto livre: qualquer pessoa digita qualquer coisa. As decisões "isto é uma busca
 *  vazia?", "isto é um id de evento?" e "o que significa `em-uso`?" são REGRA, não
 *  apresentação — e por serem puras são testáveis sem banco, sem Next e sem
 *  navegador.
 *
 *  A alternativa (normalizar dentro do serviço) espalharia a mesma decisão por três
 *  lugares: o serviço que consulta, a tela que pré-seleciona o campo e o teste que
 *  descreve o comportamento. Aqui a decisão é UMA.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FILTRO INVÁLIDO NÃO É ERRO: VIRA "SEM FILTRO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um `evento=abc` digitado à mão não pode derrubar a tela com erro de banco (um id
 *  fora do formato UUID faria a consulta lançar). A escolha é descartar o filtro
 *  malformado e mostrar o acervo inteiro: é dado da própria instituição, então o
 *  caminho seguro é mostrar MAIS, nunca menos — e nunca 500.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Teto de imagens que a listagem traz de uma vez.
 *
 * Ele nasceu na FASE 24 (as 200 mais recentes) e continua sendo o teto depois dos
 * filtros: o que a dívida E19 corrige é o "rolar e comparar a olho", não o tamanho da
 * página. Filtrar no banco é o que faz o teto deixar de esconder o que interessa.
 */
export const MEDIA_LIBRARY_LIMIT = 200;

/** Teto do texto de busca. Nome de arquivo já é limitado a 300 no schema; a busca, a 120. */
export const MEDIA_SEARCH_MAX_LENGTH = 120;

/** Teto do valor de tipo aceito como filtro — o schema guarda `mimeType` em VarChar(120). */
export const MEDIA_MIME_MAX_LENGTH = 120;

/**
 * Sentinela do filtro "sem evento".
 *
 * O acervo da instituição aceita imagem sem evento (`media_assets.eventId` é
 * nulável), e "sem evento" é uma escolha legítima de quem procura o que foi enviado
 * fora de qualquer edição. Um valor vazio já significa "todos", então o sentinela
 * precisa de nome próprio — e ele vive aqui para a tela e o serviço não divergirem.
 */
export const MEDIA_NO_SOURCE_EVENT = 'sem-evento';

/** Valores aceitos no parâmetro `uso` da tela. */
export const MEDIA_USAGE_EM_USO = 'em-uso';
export const MEDIA_USAGE_LIVRE = 'livre';

export type MediaUsageFilter = typeof MEDIA_USAGE_EM_USO | typeof MEDIA_USAGE_LIVRE;

export const MEDIA_USAGE_VALUES: readonly MediaUsageFilter[] = [
  MEDIA_USAGE_EM_USO,
  MEDIA_USAGE_LIVRE,
];

/** Texto de busca limpo, ou `null` quando não há busca (string vazia é ausência). */
export function normalizeMediaSearch(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  return trimmed.slice(0, MEDIA_SEARCH_MAX_LENGTH);
}

/**
 * Tipo guardado (`image/webp`, `image/png`…) normalizado.
 *
 * Caixa baixa porque o tipo é gravado assim pelo serviço de upload: comparar
 * `image/WebP` com o que está no banco devolveria zero linhas e a pessoa concluiria
 * que o acervo não tem nenhuma imagem daquele tipo.
 */
export function normalizeMediaMimeType(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (!trimmed) return null;

  return trimmed.slice(0, MEDIA_MIME_MAX_LENGTH);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evento de origem do arquivo, ou `null` para "todos".
 *
 * Devolve o sentinela de "sem evento" quando é ele que veio; qualquer outro valor que
 * não seja UUID é descartado (ver o bloco do topo: filtro malformado vira "sem
 * filtro", e a consulta nunca recebe um id que a faria lançar).
 */
export function parseMediaSourceEvent(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (value === MEDIA_NO_SOURCE_EVENT) return MEDIA_NO_SOURCE_EVENT;

  return UUID_PATTERN.test(value) ? value : null;
}

/**
 * `uso=em-uso` → `true` (só em uso) · `uso=livre` → `false` (só sem uso) · resto →
 * `null` (todos).
 *
 * O `false` é um filtro de verdade, e não a ausência dele: "quero ver o que dá para
 * apagar" é a pergunta que a dívida E19 descreve, e ela merece um estado próprio em
 * vez de "todos menos em uso" calculado na tela.
 */
export function parseMediaUsageFilter(raw: string | null | undefined): boolean | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === MEDIA_USAGE_EM_USO) return true;
  if (value === MEDIA_USAGE_LIVRE) return false;

  return null;
}
