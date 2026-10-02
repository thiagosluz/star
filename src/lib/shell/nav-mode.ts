/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ESTADO DA BARRA LATERAL — a REGRA, e nada além dela (FASE 59)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA REGRA MORA SOZINHA, SEM `next/headers`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O valor do cookie chega de fora — de uma requisição, de um teste, de um
 *  formulário — e o que ele SIGNIFICA é aritmética de duas palavras. Se a leitura
 *  do cookie e a interpretação do valor morassem no mesmo módulo, testar a regra
 *  exigiria levantar o Next inteiro; separadas, o portão unitário prova a regra
 *  sem infraestrutura (o mesmo raciocínio de `src/domain/**`, aplicado a uma
 *  decisão de interface, que é onde ela de fato vive).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PADRÃO É `full`, E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Valor ausente ou desconhecido não é erro: é a barra do jeito que ela sempre
 *  foi. Cookie apagado, valor inventado à mão ou versão futura do formato caem
 *  todos no MESMO lugar — a pessoa nunca fica com a navegação encolhida por um
 *  dado que ela não pediu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Como a barra lateral está desenhada nesta requisição. */
export type NavMode = 'full' | 'rail';

/** Barra completa: ícones E rótulos. É o estado de origem e o padrão de tudo. */
export const NAV_MODE_FULL: NavMode = 'full';

/** Barra recolhida: só ícones, com o rótulo preservado para leitor de tela. */
export const NAV_MODE_RAIL: NavMode = 'rail';

/** Nome do cookie que guarda a preferência — mesma família do `ef_tenant`. */
export const NAV_MODE_COOKIE = 'ef_nav';

/** Trinta dias: a preferência de layout acompanha o cookie de contexto. */
export const NAV_MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Traduz o valor CRU do cookie no estado da barra.
 *
 * `unknown` de propósito: o valor vem de um cookie, que é texto vindo do cliente
 * — qualquer coisa pode chegar aqui, e a função responde a todas as hipóteses
 * sem lançar e sem `any`.
 */
export function navModeFromValue(value: unknown): NavMode {
  return value === NAV_MODE_RAIL ? NAV_MODE_RAIL : NAV_MODE_FULL;
}

/** O outro estado. Usado pela ação que inverte a preferência. */
export function navModeToggle(mode: NavMode): NavMode {
  return mode === NAV_MODE_RAIL ? NAV_MODE_FULL : NAV_MODE_RAIL;
}
