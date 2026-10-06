/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — OS RÓTULOS DE MODALIDADE (FASE 69 · os quatro pontos da F68)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA: A MESMA PALAVRA ESCRITA EM SEIS LUGARES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Presencial · Online · Híbrido" estava digitado à mão em seis pontos:
 *
 *    1. `administracao/eventos/page.tsx`             (o `<select>` do evento novo)
 *    2. `administracao/eventos/[id]/dados/page.tsx`  (o `<select>` dos dados)
 *    3. `administracao/eventos/[id]/programacao/page.tsx` (o `<select>` da atividade)
 *    4. `components/events/event-landing.tsx`        (a etiqueta da página do evento)
 *    5. `components/tenancy/tenant-page.tsx`         (a etiqueta da vitrine da casa)
 *    6. `components/tenancy/public-event-list.tsx`   (a etiqueta da listagem)
 *
 *  As três telas de formulário repetiam a LISTA (valor + rótulo, na mesma ordem) e os
 *  três componentes repetiam o TERNÁRIO ANINHADO (`=== 'ONLINE' ? … : === 'HYBRID' ? …`).
 *  Nada disso era um defeito visível hoje — as seis cópias concordavam. O que existia
 *  era o dia seguinte: um quarto valor no enum (ou uma quarta modalidade pedida pelo
 *  produto) entra em um lugar e não nos outros, e a tela passa a mostrar "Presencial"
 *  para um evento que não é presencial. É o mesmo formato de defeito que a FASE 68
 *  fechou ao tirar a segunda coluna da janela da chamada: **duas fontes da mesma
 *  verdade divergem no primeiro dia em que uma delas muda**.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FONTE É UMA FUNÇÃO, E NÃO UM `Record` EXPORTADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `Record` sozinho resolve o `<select>` e NÃO resolve as etiquetas: ali o valor que
 *  chega é `Event.modality`, uma `string` vinda do banco (`PublicEventSummary.modality`
 *  é `string`, de propósito — o domínio não importa o ORM), e indexar um `Record`
 *  tipado com uma `string` qualquer exigiria um `as` — que é o `any` disfarçado desta
 *  casa. `eventModalityLabel` faz a pergunta certa ("que palavra eu escrevo para este
 *  valor?") e responde com o MESMO fallback de antes, medido: valor desconhecido,
 *  vazio ou nulo cai em **Presencial**.
 *
 *  Esse fallback NÃO é escolha nova: era exatamente o que o ternário aninhado fazia
 *  (`=== 'ONLINE' ? 'Online' : === 'HYBRID' ? 'Híbrido' : 'Presencial'`), e é por isso
 *  que a fase pôde trocar seis cópias por uma função **sem mudar uma palavra na tela**
 *  — o teste prende isso com o ternário antigo como oráculo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * As modalidades do evento (e da atividade).
 *
 * Espelha o enum `EventModality` do schema, como todo o domínio desta casa: o domínio
 * não importa o ORM. É a MESMA união que `event-form-defaults.ts` declarava — ela
 * passou a ser declarada aqui e lá é RE-EXPORTADA, para não haver duas.
 */
export type EventModalityValue = 'IN_PERSON' | 'ONLINE' | 'HYBRID';

/** O rótulo de cada modalidade — a única redação no produto. */
export const EVENT_MODALITY_LABELS: Record<EventModalityValue, string> = {
  IN_PERSON: 'Presencial',
  ONLINE: 'Online',
  HYBRID: 'Híbrido',
};

/**
 * As opções do `<select>`, na ordem em que os três formulários as mostram.
 *
 * A ORDEM faz parte do que a tela entrega (o select não é ordenado por ninguém depois)
 * e por isso ela é declarada aqui, e não deixada a cargo de quem percorre o `Record`.
 */
export const EVENT_MODALITY_OPTIONS: readonly { value: EventModalityValue; label: string }[] = [
  { value: 'IN_PERSON', label: EVENT_MODALITY_LABELS.IN_PERSON },
  { value: 'ONLINE', label: EVENT_MODALITY_LABELS.ONLINE },
  { value: 'HYBRID', label: EVENT_MODALITY_LABELS.HYBRID },
];

/**
 * A palavra que se escreve para um valor de modalidade — venha ele de onde vier.
 *
 * `string` (e não a união) porque é assim que a projeção pública entrega o campo: o
 * banco devolve `string`, e um valor que este código não conhece tem de cair em algo
 * legível em vez de `undefined` na tela. O fallback é o **Presencial**, o mesmo do
 * desenho anterior — e a decisão está registrada no cabeçalho deste arquivo.
 */
export function eventModalityLabel(modality: string | null | undefined): string {
  if (modality === 'ONLINE') return EVENT_MODALITY_LABELS.ONLINE;
  if (modality === 'HYBRID') return EVENT_MODALITY_LABELS.HYBRID;

  return EVENT_MODALITY_LABELS.IN_PERSON;
}
