/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — As projeções da página pública da instituição
 *                                                            (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE SEPARADO DO SERVIÇO DE GRAVAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A leitura pública e a leitura da administração produzem a MESMA projeção do
 *  rascunho (`AdminTenantPageView`). Se o serviço de gravação montasse a sua
 *  própria, o editor mostraria uma versão "quase certa" do que foi salvo — o mesmo
 *  defeito que a pré-visualização do evento evita ao usar um único `loadEventDetail`
 *  (FASE 23). Aqui a projeção mora em um lugar só, e os dois lados a importam.
 *
 *  Este módulo é o ÚNICO que junta banco + domínio na leitura: ele lê a linha pelo
 *  repositório, aplica a régua do domínio (tema, blocos, grupos de data) e devolve o
 *  que a tela desenha. Não há JSX aqui — a fatia 2 (a página) e a fatia 3 (o editor)
 *  são consumidores.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { PUBLICLY_VISIBLE_EVENT_STATUSES, type EventStatus } from '@/domain/events/event-rules';
import { remainingSeats } from '@/domain/events/registration-rules';
import { resolveTheme } from '@/domain/events/landing-page';
import { groupTenantEvents, type TenantEventGroups } from '@/domain/tenancy/tenant-event-groups';
import {
  resolveTenantPagePublication,
  selectRenderableTenantBlocks,
  type TenantPageBlock,
  type TenantPagePublication,
  type TenantPageSnapshot,
  type ResolvedTenantTheme,
} from '@/domain/tenancy/tenant-public-page';
import {
  findTenantPublicPage,
  toDraftSnapshot,
  type TenantPublicPageRow,
} from '@/lib/tenancy/tenant-public-page-repository';

/** A identidade da casa — o que o cabeçalho desenha. */
export interface TenantPublicIdentity {
  tenantId: string;
  slug: string;
  name: string;
  timezone: string;
  logoUrl: string | null;
  primaryColor: string | null;
  /** Apresentação do diretório (`Tenants.description`) — a descrição de fallback. */
  description: string | null;
}

/** O cartão de evento, como a vitrine o desenha. */
export interface PublicTenantEventCard {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  /** Período já escrito no fuso da instituição (o agrupador preenche). */
  periodLabel: string;
  startsAt: Date;
  endsAt: Date;
  isHappeningNow: boolean;
  modality: string;
  city: string | null;
  state: string | null;
  venueName: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  /** `null` = ilimitado. Mesma régua da página do evento. */
  remainingSeats: number | null;
}

export type TenantPublicEventGroups = TenantEventGroups<PublicTenantEventCard>;

/** A página como o VISITANTE a vê — só o que foi publicado. */
export interface PublicTenantPageView {
  pageId: string;
  identity: TenantPublicIdentity;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  theme: ResolvedTenantTheme;
  /** `false` = o tema gravado tinha valor inválido e a página caiu no padrão. */
  themeIsValid: boolean;
  blocks: TenantPageBlock[];
  events: TenantPublicEventGroups;
  publishedAt: Date | null;
}

/** A página como o ORGANIZADOR a vê — rascunho, publicado e o que mudou. */
export interface AdminTenantPageView {
  pageId: string;
  draft: TenantPageSnapshot;
  /** `null` = nunca publicada (ou despublicada). */
  published: TenantPageSnapshot | null;
  publication: TenantPagePublication;
  updatedAt: Date;
}

/**
 * A leitura PÚBLICA.
 *
 * Devolve `null` — e a fatia 2 responde 404 — em três casos, todos com a MESMA
 * resposta para o visitante: a instituição não tem página, nunca publicou, ou
 * publicou e depois tirou do ar. Distinguir os três revelaria o estado de um
 * rascunho alheio, que é o mesmo cuidado de `getPublicEvent`.
 */
export async function getPublicTenantPage(
  identity: TenantPublicIdentity,
  options: { limit?: unknown; now?: Date } = {},
): Promise<PublicTenantPageView | null> {
  const now = options.now ?? new Date();

  const result = await withTenant(identity.tenantId, async (tx) => {
    const row = await findTenantPublicPage(identity.tenantId, tx);
    /**
     * `{}` (o vazio de quem nunca publicou) NÃO é um snapshot: quem responde isso é
     * `readTenantPageSnapshot`, no repositório, e o resultado é `null`. A checagem
     * fica em uma linha só para os três casos de "nada para mostrar" terem a mesma
     * saída.
     */
    const published = row?.publishedSnapshot ?? null;

    if (!row || published === null) {
      return { row, published, events: [] as (PublicTenantEventCard & { status: EventStatus })[] };
    }

    const rows = await tx.event.findMany({
      where: {
        status: { in: [...PUBLICLY_VISIBLE_EVENT_STATUSES] },
        deletedAt: null,
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        summary: true,
        status: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        city: true,
        state: true,
        venueName: true,
        coverImageUrl: true,
        primaryColor: true,
        capacity: true,
        confirmedCount: true,
      },
    });

    return { row, published, events: rows.map(toEventCardInput) };
  });

  if (!result.row || result.published === null) return null;

  const { theme, isValid } = resolveTheme(result.published.theme);

  return {
    pageId: result.row.id,
    identity,
    title: result.published.title,
    /** Sem descrição publicada, vale a apresentação do diretório — melhor que vazio. */
    description: result.published.description ?? identity.description,
    coverImageUrl: result.published.coverImageUrl,
    /** Sem logotipo publicado, vale o da instituição (o mesmo dos outros cascos). */
    logoUrl: result.published.logoUrl ?? identity.logoUrl,
    theme,
    themeIsValid: isValid,
    /**
     * O filtro e a ordem dos blocos são do DOMÍNIO (`selectRenderableTenantBlocks`,
     * que usa a função do evento com os tipos desta página): invisível sai, tipo
     * desconhecido sai, e a ordem é a MESMA que o editor numerou. Um
     * `filter`/`sort` aqui seria a segunda régua de ordem que a FASE 17 prendeu.
     */
    blocks: selectRenderableTenantBlocks(result.published.blocks),
    events: groupTenantEvents(result.events, {
      now,
      timeZone: identity.timezone,
      limit: options.limit,
    }),
    publishedAt: result.row.publishedAt,
  };
}

/**
 * A leitura da ADMINISTRAÇÃO — o editor (fatia 3) consome isto.
 *
 * Diferente da pública, aqui o rascunho aparece mesmo sem nunca ter sido publicado:
 * é o estado que o organizador está editando. `publication` responde as duas
 * perguntas que a tela precisa separar ("está no ar?" e "o que eu editei já está no
 * ar?") pela regra do domínio — nunca por um `if` na tela.
 */
export async function getAdminTenantPage(tenantId: string): Promise<AdminTenantPageView | null> {
  const row = await findTenantPublicPage(tenantId);
  return row === null ? null : toAdminView(row);
}

/** A mesma projeção, para quem já tem a linha em mãos (o serviço de gravação). */
export function toAdminView(row: TenantPublicPageRow): AdminTenantPageView {
  const draft = toDraftSnapshot(row);

  return {
    pageId: row.id,
    draft,
    published: row.publishedSnapshot,
    publication: resolveTenantPagePublication({
      publishedSnapshot: row.publishedSnapshot,
      publishedAt: row.publishedAt,
      draft,
    }),
    updatedAt: row.updatedAt,
  };
}

/**
 * O evento bruto → a entrada do agrupador.
 *
 * `status` sai no objeto porque `groupTenantEvents` filtra por ele (a lista do
 * domínio), e o tipo é reafirmado porque o Prisma devolve `string` para o enum —
 * mesmo padrão de `listPublicEvents`.
 */
function toEventCardInput(row: {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  status: string;
  modality: string;
  startsAt: Date;
  endsAt: Date;
  city: string | null;
  state: string | null;
  venueName: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  capacity: number | null;
  confirmedCount: number;
}): PublicTenantEventCard & { status: EventStatus } {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    summary: row.summary,
    /**
     * O rótulo do período é escrito pelo AGRUPADOR, no domínio, com o fuso da
     * instituição: aqui vai um vazio que ele substitui. Escrever a data neste mapper
     * criaria uma segunda formatação de data — e a segunda é a que envelhece.
     */
    periodLabel: '',
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isHappeningNow: false,
    modality: row.modality,
    city: row.city,
    state: row.state,
    venueName: row.venueName,
    coverImageUrl: row.coverImageUrl,
    primaryColor: row.primaryColor,
    /**
     * `remainingSeats` é a régua do domínio — a MESMA que a página do evento e a
     * reserva de vaga usam: `null` é ilimitado, zero é esgotado. Recalcular aqui
     * (`capacity - confirmedCount`) criaria a terceira conta para o mesmo número, e
     * a terceira é a que erra a borda do ilimitado.
     */
    remainingSeats: remainingSeats(row.capacity, row.confirmedCount),
    status: row.status as EventStatus,
  };
}
