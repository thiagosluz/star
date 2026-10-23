/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMA DE UM UUID — a regra pura, sem framework
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA REGRA MORA NO DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MESMA pergunta ("este texto tem forma de uuid?") era feita em três módulos,
 *  cada um com a própria cópia da regex: o filtro do acervo de mídia, a validação
 *  dos parâmetros de segmento e o formulário de segmento. Três cópias de uma regex
 *  de formato são três chances de divergir — e a divergência aqui não é cosmética:
 *  é a diferença entre uma consulta que o banco aceita e uma que o Postgres recusa
 *  com `invalid input syntax for type uuid` (armadilha 25).
 *
 *  O domínio é o lugar certo porque a pergunta é sobre FORMATO, não sobre HTTP: a
 *  mesma função serve à página (que responde 404), ao formulário (que recusa) e ao
 *  filtro (que ignora o valor malformado). O que cada chamador FAZ com a resposta é
 *  política dele — e continua sendo (ver `src/lib/validation/id.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * A forma canônica: 8-4-4-4-12 dígitos hexadecimais.
 *
 * É EXATAMENTE a regex que os três módulos já usavam (a `i` aceita maiúsculas, que o
 * Postgres também aceita). A âncora `^`/`$` é o que impede um id colado no meio de
 * outro texto de passar — sem ela, `prefixo-<uuid>` casaria como se fosse um uuid.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `value` tem forma de uuid?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA FUNÇÃO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *  • **Não faz `trim`.** Espaço em volta não é normalizado: `" <uuid> "` não é um
 *    endereço, e quem recebe texto digitado (formulário, filtro) decide se limpa
 *    antes — foi o que cada chamador já fazia, cada um com a própria política.
 *  • **Não valida existência.** O uuid bem formado e inexistente é um recurso
 *    ausente, não um formato inválido: essa resposta é da consulta (404), não daqui.
 *  • **Não conhece versão nem variante.** `00000000-0000-0000-0000-000000000000` passa,
 *    porque o Postgres o aceita como uuid; recusá-lo seria inventar uma regra que o
 *    banco não tem.
 */
export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
