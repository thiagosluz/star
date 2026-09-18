/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Editor da página pública do evento (FASE 17, itens E3 e E4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FALTAVA NÃO ERA O MODELO, ERA O CAMINHO DE ESCRITA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `EventPage` e `PageBlock` existem desde a FASE 3 e a landing page os renderiza
 *  desde então. Até aqui, nenhum código da aplicação jamais criou um registro
 *  nesses dois modelos: os blocos vinham do seed e de SQL. O organizador não tinha
 *  como montar a própria página — e é isso que este serviço entrega.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA NASCE DESPUBLICADA, E ISSO É A REGRA CENTRAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Montar a página é um processo: cria-se a página, adicionam-se blocos, alguns
 *  ficam pela metade. Se a criação já publicasse, o primeiro bloco salvo apareceria
 *  para o público com o texto de exemplo, e a vitrine da instituição estaria no ar
 *  meio pronta. Publicar é um ato EXPLÍCITO (`isPublished`) e a página pública lê
 *  só páginas publicadas desde a FASE 3 (`where: { isPublished: true }`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { diffFields, recordAudit } from '@/lib/admin/audit';
import {
  BLOCK_ORDER_STEP,
  DEFAULT_BLOCK_CONTENT,
  MAX_PAGE_BLOCKS,
  RECOMMENDED_BLOCK_ORDER,
  assignDisplayOrder,
  moveBlockId,
  orderBlockIds,
  planPublication,
  resolvePublicationState,
  resolveTheme,
  summarizeBlockContent,
  validateBlockContent,
  type PageBlockType,
  type PublicationState,
} from '@/domain/events/landing-page';
import { PAGE_VERSION_REASONS } from '@/domain/events/page-version-rules';
import { appendVersion } from '@/lib/admin/page-version-service';

export type LandingErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'LIMIT_REACHED'
  | 'SLUG_TAKEN'
  | 'INTERNAL';

export type LandingResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: LandingErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura para o editor
// ───────────────────────────────────────────────────────────────────────────────
export interface EditablePageBlock {
  id: string;
  type: PageBlockType;
  content: Record<string, unknown>;
  isVisible: boolean;
  displayOrder: number;
  /** Uma linha explicando o que o bloco tem, para a lista do editor. */
  summary: string;
}

export interface EditableEventPage {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
  /** Data/hora agendada para entrar no ar (FASE 23, item E13). */
  publishAt: Date | null;
  /** Data/hora agendada para sair do ar (FASE 24, item E16). */
  unpublishAt: Date | null;
  /** Estado derivado de `isPublished` + datas + agora. */
  publicationState: PublicationState;
  metaTitle: string | null;
  metaDescription: string | null;
  blocks: EditablePageBlock[];
}

export interface EditableLanding {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  /**
   * Capa e logotipo atuais do evento (FASE 17, item E4).
   *
   * Vêm daqui — e não de uma segunda consulta na página — porque o editor de imagem
   * precisa mostrar o que já está publicado ao lado do botão de envio.
   */
  coverImageUrl: string | null;
  logoUrl: string | null;
  /** Página que o editor manipula (a primeira, `isHome`). `null` = ainda não existe. */
  page: EditableEventPage | null;
  /**
   * Fuso do EVENTO (FASE 24, item E17).
   *
   * É o fuso em que o organizador digita as datas de agendamento — o mesmo que a
   * página pública anuncia no rodapé. Antes, a data era interpretada no fuso do
   * servidor (UTC em produção), e a página entrava no ar três horas antes sem
   * nenhum aviso.
   */
  eventTimezone: string;
  /** Tema do EVENTO, já resolvido — é ele que a página pública usa. */
  theme: Record<string, unknown>;
  themeIsValid: boolean;
  /** Total de blocos configurados, para o aviso de teto no editor. */
  maxBlocks: number;
}

/**
 * Lê o que o editor precisa, em UMA transação.
 *
 * O editor usa a página mesmo DESPUBLICADA — é o ponto: quem monta precisa ver o
 * que está montando. A leitura pública continua exigindo `isPublished`.
 */
export async function getLandingForEdit(
  tenantId: string,
  eventId: string,
): Promise<EditableLanding | null> {
  return withTenant(tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, tenantId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        theme: true,
        timezone: true,
        coverImageUrl: true,
        logoUrl: true,
        pages: {
          where: { deletedAt: null },
          orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
          take: 1,
          select: {
            id: true,
            slug: true,
            title: true,
            isPublished: true,
            publishAt: true,
            unpublishAt: true,
            metaTitle: true,
            metaDescription: true,
            blocks: {
              select: {
                id: true,
                type: true,
                content: true,
                displayOrder: true,
                isVisible: true,
              },
            },
          },
        },
      },
    });

    if (!event) return null;

    const { theme, isValid } = resolveTheme(event.theme);
    const page = event.pages[0] ?? null;

    const blocks: EditablePageBlock[] = page
      ? orderBlockIds(page.blocks)
          .map((id) => page.blocks.find((block) => block.id === id)!)
          .map((block) => {
            const type = block.type as PageBlockType;
            const content = asRecord(block.content);
            return {
              id: block.id,
              type,
              content,
              isVisible: block.isVisible,
              displayOrder: block.displayOrder,
              summary: summarizeBlockContent(type, content),
            };
          })
      : [];

    return {
      eventId: event.id,
      eventTitle: event.title,
      eventSlug: event.slug,
      eventTimezone: event.timezone,
      coverImageUrl: event.coverImageUrl,
      logoUrl: event.logoUrl,
      theme: theme as unknown as Record<string, unknown>,
      themeIsValid: isValid,
      maxBlocks: MAX_PAGE_BLOCKS,
      page: page
        ? {
            id: page.id,
            slug: page.slug,
            title: page.title,
            isPublished: page.isPublished,
            publishAt: page.publishAt,
            unpublishAt: page.unpublishAt,
            publicationState: resolvePublicationState(
              { isPublished: page.isPublished, publishAt: page.publishAt, unpublishAt: page.unpublishAt },
              new Date(),
            ),
            metaTitle: page.metaTitle,
            metaDescription: page.metaDescription,
            blocks,
          }
        : null,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação da página inicial
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Cria a página inicial do evento, se ainda não existir.
 *
 * Idempotente de propósito: o botão "montar minha página" pode ser clicado duas
 * vezes (duplo clique, retorno do navegador), e criar duas páginas `isHome` daria
 * ao evento duas páginas iniciais — a leitura pública pega a primeira e a segunda
 * ficaria invisível, um fantasma impossível de explicar.
 */
export async function ensureHomePage(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  title?: string;
}): Promise<LandingResult<{ pageId: string; created: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, title: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const existing = await tx.eventPage.findFirst({
        where: { eventId: event.id, deletedAt: null },
        orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
        select: { id: true },
      });

      if (existing) {
        return { ok: true as const, pageId: existing.id, created: false };
      }

      const pageId = randomUUID();

      await tx.eventPage.create({
        data: {
          id: pageId,
          tenantId: input.tenantId,
          eventId: event.id,
          slug: 'inicial',
          title: input.title?.trim() || event.title,
          isHome: true,
          /**
           * Nasce DESPUBLICADA (ver o cabeçalho deste arquivo): montar é um
           * processo, e publicar é um ato explícito.
           */
          isPublished: false,
          displayOrder: 0,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'eventPage',
          entityId: pageId,
          changes: { title: { from: null, to: input.title ?? event.title }, isPublished: { from: null, to: false } },
        },
        tx,
      );

      /**
       * A primeira versão nasce com a página (FASE 23): sem ela, o histórico
       * começaria na PRIMEIRA ALTERAÇÃO, e o estado inicial — o que foi publicado
       * primeiro — não teria como ser recuperado.
       */
      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId,
        actorId: input.actorId,
        reason: PAGE_VERSION_REASONS.CREATED,
      });

      return { ok: true as const, pageId, created: true };
    });
  } catch (error) {
    return toFailure('ensureHomePage', error, 'Não foi possível criar a página do evento.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Configurações da página e tema do evento
// ───────────────────────────────────────────────────────────────────────────────
export interface PageSettingsInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  isPublished: boolean;
  /**
   * Data/hora para entrar no ar sozinha (FASE 23, item E13).
   *
   * Combinada com `isPublished` por `planPublication`: os dois juntos decidem o
   * estado, e a combinação incoerente é recusada em vez de resolvida no chute.
   */
  publishAt?: Date | null;
  /**
   * Data/hora para SAIR do ar sozinha (FASE 24, item E16).
   *
   * Sem ela, uma campanha com prazo exigia alguém despublicando no dia — e uma
   * promoção vencida publicada é pior do que uma promoção atrasada.
   */
  unpublishAt?: Date | null;
  /**
   * Tema do EVENTO (tokens visuais). Vazio preserva o que já existe.
   *
   * O editor grava no evento, e não em `EventPage.theme`: a página pública resolve
   * UM tema por evento, e manter dois níveis de tema para a mesma cor criaria duas
   * fontes de verdade — o defeito clássico de "mudei a cor e não mudou nada".
   */
  theme?: unknown;
}

/**
 * Salva identidade da página (título, SEO, publicação) e o tema do evento.
 *
 * O tema passa por `resolveTheme` — o MESMO validador da renderização. É o que
 * garante que nenhum caminho de escrita grave um tema que a página pública vá
 * recusar depois e substituir em silêncio pelo padrão.
 *
 * A publicação passa por `planPublication`, que decide entre rascunho, agendada,
 * publicada e janela encerrada — LIMPA as datas ao despublicar (sem isso a página
 * voltaria ao ar sozinha) e valida a janela (término depois do início).
 */
export async function savePageSettings(
  input: PageSettingsInput,
): Promise<LandingResult<{ pageId: string; publication: PublicationState; message: string }>> {
  try {
    const themeCheck = input.theme === undefined ? null : resolveTheme(input.theme);

    if (themeCheck && !themeCheck.isValid) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT' as const,
        message: 'O tema tem valores fora do permitido. Use hexadecimal (#rrggbb) ou oklch() nas cores.',
      };
    }

    /**
     * O fuso vem do EVENTO (item E17): é nele que o organizador digita a data e é
     * ele que a página pública anuncia. A leitura é uma consulta a mais, feita
     * apenas quando há data para validar ou mensagem para escrever.
     */
    const event = await withTenant(input.tenantId, (tx) =>
      tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { timezone: true },
      }),
    );

    if (!event) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
    }

    const plan = planPublication({
      publishNow: input.isPublished,
      publishAt: input.publishAt ?? null,
      unpublishAt: input.unpublishAt ?? null,
      now: new Date(),
      timeZone: event.timezone,
    });

    if (!plan.ok) {
      return { ok: false as const, code: 'INVALID_INPUT' as const, message: plan.message };
    }

    return await withTenant(input.tenantId, async (tx) => {
      const page = await tx.eventPage.findFirst({
        where: { eventId: input.eventId, tenantId: input.tenantId, deletedAt: null },
        orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
        select: {
          id: true,
          title: true,
          metaTitle: true,
          metaDescription: true,
          isPublished: true,
          publishAt: true,
          unpublishAt: true,
        },
      });

      if (!page) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'A página do evento ainda não foi criada.',
        };
      }

      const data = {
        title: input.title.trim(),
        metaTitle: input.metaTitle?.trim() || null,
        metaDescription: input.metaDescription?.trim() || null,
        isPublished: plan.isPublished,
        publishAt: plan.publishAt,
        unpublishAt: plan.unpublishAt,
      };

      await tx.eventPage.update({ where: { id: page.id }, data });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'eventPage',
          entityId: page.id,
          /**
           * Publicar e despublicar são registrados com o nome do campo, e não como
           * "página alterada": é a informação que responde "quem tirou a página do
           * ar", que é a pergunta que alguém faz. O agendamento entra junto, porque
           * "quem marcou esta data" é a mesma pergunta — e a data de término é o
           * que explica uma página que "sumiu sozinha".
           */
          changes: diffFields(page, data, [
            'title',
            'metaTitle',
            'metaDescription',
            'isPublished',
            'publishAt',
            'unpublishAt',
          ]),
        },
        tx,
      );

      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId: page.id,
        actorId: input.actorId,
        reason: reasonForPublication(page.isPublished, plan.state),
      });

      if (themeCheck) {
        const before = await tx.event.findFirst({
          where: { id: input.eventId },
          select: { theme: true },
        });

        await tx.event.update({
          where: { id: input.eventId },
          data: { theme: themeCheck.theme as unknown as object },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'event',
            entityId: input.eventId,
            changes: {
              theme: {
                from: summarizeTheme(before?.theme),
                to: summarizeTheme(themeCheck.theme),
              },
            },
          },
          tx,
        );
      }

      return {
        ok: true as const,
        pageId: page.id,
        publication: plan.state,
        message: plan.message,
      };
    });
  } catch (error) {
    return toFailure('savePageSettings', error, 'Não foi possível salvar a página.');
  }
}

/**
 * Rótulo da versão a partir da transição de publicação.
 *
 * A ordem dos testes importa: publicar uma página que estava agendada é
 * "publicada" (o organizador antecipou), e despublicar depois de publicada é
 * "despublicada" (é a informação que alguém procura no histórico).
 */
function reasonForPublication(
  wasPublished: boolean,
  next: PublicationState,
): (typeof PAGE_VERSION_REASONS)[keyof typeof PAGE_VERSION_REASONS] {
  if (next === 'PUBLISHED') return PAGE_VERSION_REASONS.PUBLISHED;
  if (next === 'SCHEDULED') return PAGE_VERSION_REASONS.SCHEDULED;
  return wasPublished ? PAGE_VERSION_REASONS.UNPUBLISHED : PAGE_VERSION_REASONS.CONTENT;
}

/** Resumo do tema para a trilha — não o objeto inteiro (ver `recordAudit`). */
function summarizeTheme(theme: unknown): string {
  const source = asRecord(theme);
  const keys = Object.keys(source).filter((key) => key !== 'colorMode');
  return keys.length > 0 ? `tema com ${keys.length} propriedade(s)` : 'tema padrão';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Blocos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Adiciona um bloco ao fim da página.
 *
 * O conteúdo inicial vem do domínio (`DEFAULT_BLOCK_CONTENT`) e é
 * DELIBERADAMENTE vazio: um bloco com texto de exemplo publicado por descuido é
 * pior do que um bloco em branco que a lista marca como "vazio — não aparece na
 * página".
 */
export async function addPageBlock(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  type: PageBlockType;
}): Promise<LandingResult<{ blockId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const page = await tx.eventPage.findFirst({
        where: { eventId: input.eventId, tenantId: input.tenantId, deletedAt: null },
        orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
        select: { id: true, blocks: { select: { displayOrder: true } } },
      });

      if (!page) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'A página do evento ainda não foi criada.',
        };
      }

      if (page.blocks.length >= MAX_PAGE_BLOCKS) {
        return {
          ok: false as const,
          code: 'LIMIT_REACHED' as const,
          message: `Uma página aceita no máximo ${MAX_PAGE_BLOCKS} blocos. Remova algum antes de adicionar outro.`,
        };
      }

      const nextOrder =
        page.blocks.length === 0
          ? 0
          : Math.max(...page.blocks.map((block) => block.displayOrder)) + BLOCK_ORDER_STEP;

      const blockId = randomUUID();

      await tx.pageBlock.create({
        data: {
          id: blockId,
          tenantId: input.tenantId,
          pageId: page.id,
          type: input.type,
          content: DEFAULT_BLOCK_CONTENT[input.type] as unknown as object,
          displayOrder: nextOrder,
          isVisible: true,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'pageBlock',
          entityId: blockId,
          changes: { type: { from: null, to: input.type }, displayOrder: { from: null, to: nextOrder } },
        },
        tx,
      );

      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId: page.id,
        actorId: input.actorId,
        reason: PAGE_VERSION_REASONS.BLOCK_ADDED,
      });

      return { ok: true as const, blockId };
    });
  } catch (error) {
    return toFailure('addPageBlock', error, 'Não foi possível adicionar o bloco.');
  }
}

/**
 * Salva o conteúdo (e a visibilidade) de um bloco.
 *
 * A validação por tipo acontece no domínio antes de qualquer escrita: um conteúdo
 * recusado não deve chegar ao banco e ser publicado.
 */
export async function updatePageBlock(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  blockId: string;
  content: unknown;
  isVisible?: boolean;
}): Promise<LandingResult<{ blockId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const block = await tx.pageBlock.findFirst({
        where: { id: input.blockId, tenantId: input.tenantId },
        select: { id: true, type: true, content: true, isVisible: true, pageId: true, page: { select: { eventId: true } } },
      });

      if (!block || block.page.eventId !== input.eventId) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Bloco não encontrado.' };
      }

      const type = block.type as PageBlockType;
      const validation = validateBlockContent(type, input.content);

      if (!validation.ok) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: 'O conteúdo do bloco não foi aceito.',
          details: validation.errors,
        };
      }

      const isVisible = input.isVisible ?? block.isVisible;
      const previous = asRecord(block.content);

      await tx.pageBlock.update({
        where: { id: block.id },
        data: { content: validation.content as unknown as object, isVisible },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'pageBlock',
          entityId: block.id,
          changes: {
            // O conteúdo vai resumido: um texto de 8000 caracteres na trilha é ruído.
            content: { from: summarizeBlockContent(type, previous), to: summarizeBlockContent(type, validation.content) },
            ...(isVisible !== block.isVisible
              ? { isVisible: { from: block.isVisible, to: isVisible } }
              : {}),
          },
        },
        tx,
      );

      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId: block.pageId,
        actorId: input.actorId,
        reason: PAGE_VERSION_REASONS.CONTENT,
      });

      return { ok: true as const, blockId: block.id };
    });
  } catch (error) {
    return toFailure('updatePageBlock', error, 'Não foi possível salvar o bloco.');
  }
}

/**
 * Move um bloco uma posição.
 *
 * A ordem inteira é reescrita (ver `moveBlockId`): subir um bloco sobre outro que
 * tem a MESMA `displayOrder` não mudaria nada, e o organizador clicaria de novo
 * achando que a tela travou.
 */
export async function movePageBlock(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  blockId: string;
  direction: 'up' | 'down';
}): Promise<LandingResult<{ order: readonly string[] }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const page = await tx.eventPage.findFirst({
        where: { eventId: input.eventId, tenantId: input.tenantId, deletedAt: null },
        orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
        select: { id: true, blocks: { select: { id: true, displayOrder: true } } },
      });

      if (!page) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Página não encontrada.' };
      }

      const before = orderBlockIds(page.blocks);
      const after = moveBlockId(before, input.blockId, input.direction);

      if (after.join(',') === before.join(',')) {
        // Já está na ponta: não é erro do usuário, e escrever a mesma ordem
        // produziria uma entrada de auditoria para um fato que não aconteceu.
        return { ok: true as const, order: after };
      }

      for (const entry of assignDisplayOrder(after)) {
        await tx.pageBlock.update({
          where: { id: entry.id },
          data: { displayOrder: entry.displayOrder },
        });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'pageBlock',
          entityId: input.blockId,
          changes: {
            position: {
              from: before.indexOf(input.blockId),
              to: after.indexOf(input.blockId),
            },
          },
        },
        tx,
      );

      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId: page.id,
        actorId: input.actorId,
        reason: PAGE_VERSION_REASONS.REORDERED,
      });

      return { ok: true as const, order: after };
    });
  } catch (error) {
    return toFailure('movePageBlock', error, 'Não foi possível mover o bloco.');
  }
}

export async function deletePageBlock(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  blockId: string;
}): Promise<LandingResult<{ blockId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const block = await tx.pageBlock.findFirst({
        where: { id: input.blockId, tenantId: input.tenantId },
        select: { id: true, type: true, page: { select: { eventId: true } } },
      });

      if (!block || block.page.eventId !== input.eventId) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Bloco não encontrado.' };
      }

      /**
       * Remoção FÍSICA, e não lógica: `PageBlock` não tem `deletedAt`, e um bloco
       * removido não tem valor histórico — o que interessa (o que foi publicado,
       * quando) está na trilha de auditoria, que é imutável. Desde a FASE 23 o
       * CONTEÚDO do bloco também está na versão da página, então remover deixou de
       * ser irreversível.
       */
      await tx.pageBlock.delete({ where: { id: block.id } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'pageBlock',
          entityId: block.id,
          changes: { type: { from: block.type, to: null } },
        },
        tx,
      );

      const page = await tx.eventPage.findFirst({
        where: { eventId: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (page) {
        await appendVersion(tx, {
          tenantId: input.tenantId,
          pageId: page.id,
          actorId: input.actorId,
          reason: PAGE_VERSION_REASONS.BLOCK_REMOVED,
        });
      }

      return { ok: true as const, blockId: block.id };
    });
  } catch (error) {
    return toFailure('deletePageBlock', error, 'Não foi possível remover o bloco.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Composição sugerida
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Cria a composição recomendada, para o organizador ter de onde partir.
 *
 * Só roda com a página VAZIA: a intenção é o ponto de partida, não uma forma de
 * empilhar blocos sobre uma página já montada (o que faria a página mudar de forma
 * sem ninguém pedir).
 */
export async function seedRecommendedBlocks(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
}): Promise<LandingResult<{ created: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const page = await tx.eventPage.findFirst({
        where: { eventId: input.eventId, tenantId: input.tenantId, deletedAt: null },
        orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
        select: { id: true, blocks: { select: { id: true } } },
      });

      if (!page) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'A página do evento ainda não foi criada.',
        };
      }

      if (page.blocks.length > 0) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: 'A composição sugerida só se aplica a uma página vazia.',
        };
      }

      const types = RECOMMENDED_BLOCK_ORDER.slice(0, MAX_PAGE_BLOCKS);

      await tx.pageBlock.createMany({
        data: types.map((type, index) => ({
          id: randomUUID(),
          tenantId: input.tenantId,
          pageId: page.id,
          type,
          content: DEFAULT_BLOCK_CONTENT[type] as unknown as object,
          displayOrder: index * BLOCK_ORDER_STEP,
          isVisible: true,
        })),
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'eventPage',
          entityId: page.id,
          changes: { blocks: { from: 0, to: types.length } },
        },
        tx,
      );

      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId: page.id,
        actorId: input.actorId,
        reason: PAGE_VERSION_REASONS.COMPOSITION,
      });

      return { ok: true as const, created: types.length };
    });
  } catch (error) {
    return toFailure('seedRecommendedBlocks', error, 'Não foi possível aplicar a composição sugerida.');
  }
}
// ───────────────────────────────────────────────────────────────────────────────
//  Falhas
// ───────────────────────────────────────────────────────────────────────────────
function toFailure<T>(
  operation: string,
  error: unknown,
  fallbackMessage: string,
): LandingResult<T> {
  if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
    return {
      ok: false as const,
      code: 'SLUG_TAKEN' as const,
      message: 'Já existe uma página com este identificador neste evento.',
    };
  }

  console.error(`[landing] falha em ${operation}: ${errorMessage(error)}`);
  return { ok: false as const, code: 'INTERNAL' as const, message: fallbackMessage };
}

