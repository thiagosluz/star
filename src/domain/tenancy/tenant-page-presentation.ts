/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — A APRESENTAÇÃO da página pública da instituição
 *                                                            (FASE 64 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS REGRAS NÃO MORAM NO COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O renderizador (`src/components/tenancy/tenant-page.tsx`) é JSX: para provar uma
 *  decisão dele sem navegador seria preciso montar React. As três perguntas que a
 *  tela faz ao dado, no entanto, são PURAS e ficam aqui:
 *
 *    • **Como se chama cada grupo e o que ele diz quando está vazio?** — o texto é
 *      fixo, e a única forma de ele mentir é dizer "acontecendo agora" para o grupo
 *      errado.
 *    • **Quando aparece o "ver todos"?** — a decisão é do DADO (`total` × `limit`),
 *      nunca uma segunda contagem feita na tela.
 *    • **Qual é o total que o "ver todos" anuncia?** — vem do read model.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LIÇÃO DA F54, ESCRITA EM FUNÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `mostrarVerTodos` e `totalDoGrupo` leem o MESMO `total` que o serviço calculou.
 *  A tela não filtra, não conta e não compara listas para responder "quantos são":
 *  se ela recontasse os `items`, diria "ver todos os 6" embaixo de uma lista de 6 —
 *  com 12 no banco. Foi exatamente esse defeito (número afirmado sem ter sido
 *  contado) que a FASE 54 prendeu no selo de contagem, e ele reaparece em qualquer
 *  tela que lista uma FATIA e convida a ver o TODO.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { TenantEventGroup } from '@/domain/tenancy/tenant-event-groups';
import {
  TENANT_BLOCK_LABELS,
  type TenantPageBlockType,
} from '@/domain/tenancy/tenant-public-page';

/** O nome do grupo como o domínio dos grupos o escreve. */
export type TenantPageGroup = TenantEventGroup;

/** A chave do read model (`PublicTenantEventGroups`) para cada grupo. */
export type TenantPageGroupKey = 'upcoming' | 'ongoing' | 'past';

/**
 * Os três grupos, na ORDEM em que a vitrine da casa os apresenta — e com a chave
 * que cada um tem no read model.
 *
 * A chave mora AQUI (e não num `if` dentro do JSX) porque é a tradução entre dois
 * vocabulários: o domínio classifica em `UPCOMING`/`ONGOING`/`PAST`, o read model
 * publica `upcoming`/`ongoing`/`past`. Um `switch` no componente faria a mesma
 * tradução em um lugar que o teste puro não alcança.
 */
export const TENANT_PAGE_GROUP_ORDER: readonly {
  group: TenantEventGroup;
  key: TenantPageGroupKey;
}[] = [
  { group: 'UPCOMING', key: 'upcoming' },
  { group: 'ONGOING', key: 'ongoing' },
  { group: 'PAST', key: 'past' },
];

export interface TenantPageGroupLabels {
  /** O título do grupo na página. */
  title: string;
  /** O texto do link que leva à listagem completa. */
  verTodos: string;
  /** A frase do grupo vazio — ela diz o que AUSENTE significa, e não "nada aqui". */
  vazio: string;
}

/**
 * O vocabulário da página.
 *
 * "Em breve · Acontecendo · Antigas" e não "futuros · em curso · passados": quem lê
 * a vitrine de uma instituição é o público dela, e não o operador do sistema. Os
 * três grupos são a decisão do humano registrada em
 * `tenant-event-groups.ts` — aqui só entram os nomes que a pessoa lê.
 */
export const TENANT_PAGE_GROUP_LABELS: Record<TenantEventGroup, TenantPageGroupLabels> = {
  UPCOMING: {
    title: 'Em breve',
    verTodos: 'Ver todos os próximos eventos',
    vazio: 'Nenhum evento com data marcada no momento.',
  },
  ONGOING: {
    title: 'Acontecendo agora',
    verTodos: 'Ver todos os eventos em cartaz',
    vazio: 'Nenhum evento acontecendo neste momento.',
  },
  PAST: {
    title: 'Edições anteriores',
    verTodos: 'Ver o histórico completo',
    vazio: 'Ainda não há eventos encerrados.',
  },
};

/** O rótulo de exibição de um bloco — o MESMO do editor, importado do domínio. */
export const TENANT_PAGE_BLOCK_LABELS: Record<TenantPageBlockType, string> = TENANT_BLOCK_LABELS;

/** O mínimo do grupo que a apresentação lê — o read model satisfaz por estrutura. */
export interface TenantPageGroupView {
  total: number;
  hasMore: boolean;
  limit: number;
}

/**
 * O grupo tem eventos?
 *
 * A pergunta é respondida pelo `total` (o que o serviço contou) e não pelo tamanho
 * de `items`: com limite aplicado, um grupo de 12 desenha 6 e continua tendo
 * eventos. "Está vazio" com lista recortada é a mesma confusão em outro lugar.
 */
export function grupoTemEventos(view: TenantPageGroupView): boolean {
  return view.total > 0;
}

/**
 * O "ver todos" aparece quando há mais do que o limite — e o serviço JÁ decidiu isso.
 *
 * `hasMore` é devolvido pronto por `groupTenantEvents` (que compara o grupo inteiro
 * com o limite). Recalcular aqui (`total > limit`) funcionaria hoje e criaria a
 * segunda régua amanhã: bastaria a definição de "tem mais" mudar no domínio (por
 * exemplo, passar a contar só o que é público) para a tela discordar do serviço.
 */
export function mostrarVerTodos(view: TenantPageGroupView): boolean {
  return view.hasMore;
}

/**
 * O número que o link anuncia — o `total` do grupo, vindo do serviço.
 *
 * `null` quando o link não aparece (ver `mostrarVerTodos`): um total sem link é um
 * número que ninguém pediu, e devolvê-lo abriria caminho para a tela desenhá-lo em
 * outro lugar.
 */
export function totalDoGrupo(view: TenantPageGroupView): number | null {
  return mostrarVerTodos(view) ? view.total : null;
}

/** A frase do grupo vazio — separada para o teste poder prendê-la por grupo. */
export function fraseDoGrupoVazio(group: TenantEventGroup): string {
  return TENANT_PAGE_GROUP_LABELS[group].vazio;
}
