/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — A APRESENTAÇÃO do editor da página da instituição
 *                                                            (FASE 64 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS REGRAS NÃO MORAM NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As três perguntas que o editor faz ao dado são PURAS:
 *
 *    • **A página está no ar, e o que eu acabei de salvar já está?** — são DUAS
 *      perguntas, e a FASE 64 mediu o custo de respondê-las com um booleano só: o
 *      editor diria "publicada" enquanto o visitante veria a versão da semana
 *      passada. A resposta é do domínio (`resolveTenantPagePublication`, fatia 1) e
 *      vira FRASE aqui, para a tela não inventar texto;
 *    • **o que cada bloco tem dentro?** — o resumo de uma linha. A régua é a do
 *      EVENTO (`summarizeBlockContent`), importada: dois resumos para a mesma ideia
 *      divergiriam no primeiro tipo novo, e o lado que ninguém olhou é o que
 *      mentiria;
 *    • **qual dos tipos oferecidos ainda não aparece na página?** — a resposta é o
 *      conjunto do domínio (`TENANT_BLOCK_WITHOUT_RENDERER`). Oferecer um bloco que
 *      não desenha nada é um formulário que mente, e este arquivo é quem deixa a
 *      tela dizer a verdade sem recalcular o conjunto por conta própria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { summarizeBlockContent } from '@/domain/events/landing-page';
import {
  TENANT_BLOCK_WITHOUT_RENDERER,
  type TenantPageBlock,
  type TenantPageBlockType,
  type TenantPagePublication,
  type TenantPagePublicationState,
} from '@/domain/tenancy/tenant-public-page';

// ───────────────────────────────────────────────────────────────────────────────
//  O estado de publicação em uma frase
// ───────────────────────────────────────────────────────────────────────────────
export interface TenantPageStatus {
  state: TenantPagePublicationState;
  /** Manchete curta, para a linha de status do cabeçalho. */
  label: string;
  /** O que isso significa para quem edita — a segunda pergunta. */
  detail: string;
  /** A frase que a PRÉVIA mostra (o aviso do componente da página). */
  publicationLabel: string;
}

/**
 * Traduz o estado de publicação em texto, no fuso da INSTITUIÇÃO.
 *
 * O fuso entra porque a data que o organizador vai conferir é a da casa dele: um
 * "publicada em 01/12 10:00" em UTC seria outra hora na Bahia, e a única forma de
 * ele perceber isso seria desconfiar do relógio.
 *
 * `CHANGES_PENDING` NÃO é "não publicada": é a página no ar com alterações que
 * ainda não subiram. Dizer "rascunho" ali faria o organizador achar que o site
 * saiu do ar — o oposto do que aconteceu.
 */
export function tenantPageStatus(input: {
  publication: TenantPagePublication;
  timeZone: string;
}): TenantPageStatus {
  const { state, publishedAt } = input.publication;
  const publicado = publishedAt ? formatZonedDateTime(publishedAt, input.timeZone) : null;

  switch (state) {
    case 'NEVER_PUBLISHED':
      return {
        state,
        label: 'Rascunho — a página ainda não está no ar',
        detail:
          'Enquanto você não publicar, o endereço da instituição continua mostrando a lista de eventos dela. O rascunho não aparece para ninguém.',
        publicationLabel: 'ainda não publicada: os visitantes veem a lista de eventos',
      };

    case 'CHANGES_PENDING':
      return {
        state,
        label: 'No ar, com alterações não publicadas',
        detail: publicado
          ? `Os visitantes estão vendo a versão publicada em ${publicado}. O que você salvou depois disso ainda não subiu — use “Publicar” para levar as mudanças ao ar.`
          : 'Os visitantes estão vendo a versão publicada. O que você salvou depois disso ainda não subiu.',
        publicationLabel: publicado
          ? `publicada em ${publicado}, com alterações ainda no rascunho`
          : 'publicada, com alterações ainda no rascunho',
      };

    case 'PUBLISHED':
      return {
        state,
        label: publicado ? `Publicada em ${publicado}` : 'Publicada',
        detail:
          'O que está no ar é exatamente o rascunho abaixo. Qualquer alteração que você salvar passa a aparecer aqui como “não publicada”.',
        publicationLabel: publicado ? `publicada em ${publicado}` : 'publicada',
      };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A lista de blocos
// ───────────────────────────────────────────────────────────────────────────────
export interface TenantBlockRow {
  block: TenantPageBlock;
  /** A posição na lista, começando em 1 — é o número que a tela desenha. */
  position: number;
  /** Uma linha dizendo o que o bloco tem (ou que está vazio). */
  summary: string;
  /** `true` = o tipo existe no editor e a página ainda não o desenha. */
  semRenderizador: boolean;
  /** `true` = o bloco está configurado e a página não mostra nada dele. */
  vazio: boolean;
}

/**
 * A lista de blocos como a tela do editor a desenha.
 *
 * A ordem de entrada é a que o domínio já numerou (o serviço entrega os blocos na
 * ordem do editor) — reordenar aqui criaria a segunda régua de ordem que a FASE 17
 * prendeu com teste.
 */
export function tenantBlockRows(blocks: readonly TenantPageBlock[]): TenantBlockRow[] {
  return blocks.map((block, index) => {
    const summary = tenantBlockSummary(block.type, block.content);

    return {
      block,
      position: index + 1,
      summary,
      semRenderizador: TENANT_BLOCK_WITHOUT_RENDERER.has(block.type),
      /**
       * "Vazio" é o que o domínio respondeu, e não uma segunda leitura do conteúdo:
       * o resumo do tipo compartilhado termina em "não aparece na página" quando o
       * bloco não desenha nada, e o dos tipos exclusivos desta página usa as mesmas
       * palavras. Procurá-las aqui é ler a MESMA resposta, não refazer a conta.
       */
      vazio: /vazio|nenhum|nenhuma/i.test(summary),
    };
  });
}

/**
 * O resumo de uma linha para cada tipo DESTA página.
 *
 * Os tipos que existem nos dois editores (texto, perguntas, HTML, equipe,
 * patrocinadores) passam pela régua do EVENTO — é o ponto do módulo. Só os três
 * tipos que a página da instituição inventou (`ABOUT`, `PAST_EVENTS`, `CONTACT`)
 * ganham texto aqui, porque lá o evento não tem o que responder.
 */
export function tenantBlockSummary(type: TenantPageBlockType, content: unknown): string {
  const source =
    typeof content === 'object' && content !== null && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};

  switch (type) {
    case 'ABOUT': {
      const body = typeof source.body === 'string' ? source.body.trim() : '';
      const founded = typeof source.foundedLabel === 'string' ? source.foundedLabel.trim() : '';

      if (body.length === 0 && founded.length === 0) {
        return 'vazio — não aparece na página';
      }

      return [
        founded ? `fundação: ${founded}` : null,
        body.length > 0 ? `${body.length} caractere(s) de apresentação` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }

    case 'PAST_EVENTS': {
      /**
       * O resumo NÃO diz quantos eventos o bloco mostra: essa conta é do read model,
       * na renderização (ADR-168). O que ele guarda é o LIMITE — e é isso que a tela
       * pode afirmar sem mentir no dia seguinte.
       */
      const limit = typeof source.limit === 'number' && Number.isFinite(source.limit) ? source.limit : null;

      return limit
        ? `mostra até ${limit} evento(s) já encerrado(s), lidos do sistema na hora de desenhar`
        : 'mostra os eventos já encerrados, lidos do sistema na hora de desenhar';
    }

    case 'CONTACT': {
      const partes = ['address', 'email', 'phone', 'mapUrl']
        .map((key) => (typeof source[key] === 'string' ? (source[key] as string).trim() : ''))
        .filter((value) => value.length > 0);

      return partes.length > 0 ? `${partes.length} forma(s) de contato` : 'vazio — não aparece na página';
    }

    default:
      /**
       * `HERO`, `TEAM` e `SPONSORS` caem aqui quando o evento não tem resposta: o
       * evento responde pelos tipos compartilhados, e o que sobra é o bloco sem
       * renderizador — cujo texto honesto é dizer que ele não aparece.
       */
      if (TENANT_BLOCK_WITHOUT_RENDERER.has(type)) {
        return 'este tipo ainda não é desenhado na página da instituição';
      }

      return summarizeBlockContent(type, content);
  }
}

/** O aviso que a tela dá ao oferecer um tipo — vazio quando não há o que avisar. */
export function tenantBlockTypeNotice(type: TenantPageBlockType): string | null {
  return TENANT_BLOCK_WITHOUT_RENDERER.has(type)
    ? 'Este tipo é aceito e salvo, mas a página ainda NÃO desenha nada dele.'
    : null;
}
