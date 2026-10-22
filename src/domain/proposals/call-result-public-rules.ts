/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A PÁGINA PÚBLICA DO RESULTADO (FASE 73 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE, SE A PROJEÇÃO JÁ EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `call-result-rules.ts` (fatia 1) decide O QUE vai ao público e devolve `null`
 *  quando a seção não deve existir. O que faltava era a decisão da PÁGINA: com que
 *  título, com que data formatada e — principalmente — em que estados NÃO se desenha
 *  nada. Essa decisão é regra, não marcação: ela precisa ser provada sem banco e sem
 *  navegador, e precisa ser a MESMA nas duas superfícies que citam o resultado (a
 *  página da chamada e o bloco de chamadas da landing).
 *
 *  Daí a fronteira:
 *    • `call-result-rules` — o CONTEÚDO e a lista fechada (nota, parecer, revisor e
 *      e-mail nunca atravessam);
 *    • este módulo — a APRESENTAÇÃO DECIDIDA (título, frases, selo) e a tabela de
 *      visibilidade por estado;
 *    • `call-result-public-view.tsx` — o desenho, alimentado pela projeção.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "O QUE SE OCULTA FICA OCULTO" (a régua da FASE 60)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEM_RESULTADO e RASCUNHO não produzem seção, título, espaço nem `aria-label`:
 *  a página não esconde a seção com CSS, ela não a cria. E a tabela abaixo é o
 *  registro disso por ESTADO — um estado novo no domínio quebra o `tsc` aqui, em vez
 *  de virar uma seção que aparece por omissão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DATA É DO SERVIDOR, E É OBRIGATÓRIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O rótulo da data chega PRONTO (formatado no fuso do evento por quem lê o banco).
 *  Se ele faltar, a seção NÃO é montada: uma publicação sem data é o mesmo caso que
 *  o leitor tolerante já rebaixa a rascunho, e inventar "agora" seria a mentira que a
 *  fatia 1 recusou. Melhor não anunciar do que anunciar com data inventada.
 *
 *  O módulo é PURO: não importa Prisma, Next, relógio nem `Intl` — nada aqui formata
 *  data, e nada aqui consulta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  isPublicCallResultState,
  type CallResultState,
  type PublicCallResultView,
} from '@/domain/proposals/call-result-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  As frases — fonte única das duas superfícies
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O título da seção na página da chamada.
 *
 * "Resultado" e não "Resultado da chamada": a página inteira JÁ é a chamada, e o
 * título precisa dizer o que a seção é sem repetir o assunto da página.
 */
export const PUBLIC_CALL_RESULT_SECTION_TITLE = 'Resultado';

/** O prefixo da data da publicação vigente. */
export const PUBLIC_CALL_RESULT_PUBLISHED_PREFIX = 'Publicado em';

/** O título da lista publicada — o mesmo que a prévia do organizador desenha. */
export const PUBLIC_CALL_RESULT_LIST_TITLE = 'Lista publicada';

/** O título dos próximos passos. */
export const PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE = 'Próximos passos';

/**
 * O selo do bloco de chamadas da landing (fatia 4, §3).
 *
 * Ele NÃO repete o resultado: diz que existe um e leva à página da chamada, que é
 * onde o texto, a lista e os próximos passos vivem. Duplicar o documento na landing
 * criaria a segunda cópia da mesma verdade — e a landing lê a chamada na renderização
 * (ADR-168), então a única coisa que ela precisa saber é SE há resultado publicado.
 */
export const PUBLIC_CALL_RESULT_LANDING_BADGE = 'Resultado publicado';

/** O rótulo do link que o selo acompanha. */
export const PUBLIC_CALL_RESULT_LANDING_LINK = 'Ver o resultado';

// ───────────────────────────────────────────────────────────────────────────────
//  A tabela de visibilidade, por estado
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O que cada estado do resultado faz na PÁGINA.
 *
 * `Record` sobre o estado REAL (e não `if estado === 'PARCIAL' || 'FINAL'` espalhado
 * por aí): estado novo quebra o `tsc`, e a decisão fica em um lugar só. `SECAO` é o
 * único valor que desenha alguma coisa; `NADA` não desenha nem o título.
 */
export const PUBLIC_CALL_RESULT_VISIBILITY: Readonly<Record<CallResultState, 'SECAO' | 'NADA'>> = {
  SEM_RESULTADO: 'NADA',
  RASCUNHO: 'NADA',
  PARCIAL: 'SECAO',
  FINAL: 'SECAO',
};

/**
 * A tabela e a régua da projeção dizem a MESMA coisa?
 *
 * A página decide pela tabela; a projeção decide pelo `isPublicCallResultState`. Se
 * as duas divergirem, uma delas está mentindo — e o teste da fase chama esta função
 * para os quatro estados justamente para que a divergência não passe.
 */
export function visibilityAgreesWithProjection(estado: CallResultState): boolean {
  return (PUBLIC_CALL_RESULT_VISIBILITY[estado] === 'SECAO') === isPublicCallResultState(estado);
}

/**
 * A chamada ganha o selo "Resultado publicado" na landing?
 *
 * A MESMA tabela da seção, e não uma segunda condição: se um dia o estado mudar de
 * régua, a landing e a página mudam juntas. Rascunho NÃO ganha selo — o selo diria
 * ao visitante que há resultado quando a página da chamada não mostra nada.
 */
export function showsPublishedResultBadge(estado: CallResultState): boolean {
  return PUBLIC_CALL_RESULT_VISIBILITY[estado] === 'SECAO';
}

// ───────────────────────────────────────────────────────────────────────────────
//  A seção da página
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A seção pronta para desenhar — ou `null` para "não existe seção".
 *
 * `view` é o objeto que `projectPublicCallResult` devolveu, já com a lista fechada
 * conferida. Este módulo não remonta nada: ele decora a decisão da projeção com o
 * título e com a data, e o componente compartilhado desenha o resto.
 */
export interface PublicCallResultSection {
  readonly title: string;
  /** A projeção REAL — nunca uma remontagem a partir do `resultado`. */
  readonly view: PublicCallResultView;
  /** Data da publicação vigente, já no fuso do evento (ver o cabeçalho). */
  readonly publicadoEmLabel: string;
}

/**
 * Decide a seção: `null` é a resposta para "não há nada a mostrar".
 *
 * Três entradas produzem `null`, e todas para o lado de MENOS público:
 *   • `view === null` — SEM_RESULTADO ou RASCUNHO (o caso normal, e o do rascunho
 *     que despublica);
 *   • data ausente — publicação sem data de publicação não é anúncio;
 *   • data em branco — mesma coisa, com o valor que a formatação poderia devolver.
 */
export function buildPublicCallResultSection(input: {
  view: PublicCallResultView | null;
  publicadoEmLabel: string;
}): PublicCallResultSection | null {
  if (input.view === null) return null;

  const publicadoEmLabel = input.publicadoEmLabel.trim();

  if (publicadoEmLabel.length === 0) return null;

  return {
    title: PUBLIC_CALL_RESULT_SECTION_TITLE,
    view: input.view,
    publicadoEmLabel,
  };
}
