'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — EDITOR da página pública da instituição (FASE 64 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERMISSÃO É `page:manage`, E ELA JÁ EXISTIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhuma permissão nova: `page:manage` nasceu na FASE 2, foi usada na FASE 17
 *  para a página do EVENTO e é exatamente este ofício — montar e publicar a vitrine
 *  pública. Hoje ela é de `OWNER`, `ADMIN` e `ORGANIZER`, que são os papéis que já
 *  editam a página do evento e do patrocinador.
 *
 *  Criar `tenant:page:manage` para o MESMO ato produziria duas permissões que
 *  dizem a mesma coisa, e a segunda seria esquecida no primeiro ajuste de papéis —
 *  a lição da FASE 64 (fatia 1) sobre a régua copiada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TODA AUTORIZAÇÃO É VERIFICADA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O menu esconde o item e a página redireciona quem não pode entrar — nenhum dos
 *  dois é autorização. Quem digitar a URL e chamar a action direto passa por este
 *  guard, que exige vínculo ATIVO e a permissão no escopo da INSTITUIÇÃO. A recusa
 *  acontece ANTES de qualquer escrita (e o teste de integração prova que ela não
 *  deixou rastro no banco).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  TENANT_BLOCK_LABELS,
  TENANT_DEFAULT_BLOCK_CONTENT,
  TENANT_MAX_PAGE_BLOCKS,
  isTenantBlockType,
  tenantThemeSchema,
  type TenantPageBlock,
  type TenantPageSnapshot,
} from '@/domain/tenancy/tenant-public-page';
/**
 * A ORDEM dos blocos vem do domínio do EVENTO, por referência.
 *
 * `assignDisplayOrder`, `moveBlockId` e `orderBlockIds` são as funções que a
 * RENDERIZAÇÃO do evento usa (via `selectRenderableBlocks`). Reescrevê-las aqui
 * criaria a segunda conta de ordem que a FASE 17 prendeu com teste: o editor
 * numeraria uma ordem e a página desenharia outra.
 */
import {
  assignDisplayOrder,
  moveBlockId,
  orderBlockIds,
} from '@/domain/events/landing-page';
import {
  getAdminTenantPage,
  type AdminTenantPageView,
} from '@/lib/tenancy/tenant-public-page-view';
import {
  publishTenantPublicPage,
  saveTenantPublicPageDraft,
  unpublishTenantPublicPage,
} from '@/lib/tenancy/tenant-public-page-write-service';
import {
  confirmTenantPageAssetUpload,
  isTenantPageImageTarget,
  requestTenantPageAssetUpload,
} from '@/lib/tenancy/tenant-page-asset-service';

export interface TenantPageActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Guarda
// ───────────────────────────────────────────────────────────────────────────────
async function guard(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: TenantPageActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' },
    };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.PAGE_MANAGE, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Permissão negada: só quem administra a instituição edita a página pública.',
      },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

/**
 * Revalida o editor E a página pública.
 *
 * `revalidatePath` da RAIZ da instituição não é zelo: é ela que o visitante abre, e
 * sem a revalidação o organizador publica, abre o site e vê a versão antiga — e
 * conclui que não salvou.
 */
function revalidateTenantPage(tenantSlug: string): void {
  revalidatePath(tenantPath(tenantSlug, '/administracao/pagina'));
  revalidatePath(tenantPath(tenantSlug, '/'));
}

const tenantSlugSchema = z.string().trim().min(1).max(63);

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * O aviso padrão de recusa por vínculo/permissão, quando a página informada não é
 * do chamador. Devolver um `FORBIDDEN` explícito (e não um `NOT_FOUND` genérico) é
 * deliberado: quem já administra a instituição precisa saber que o problema é o
 * seu acesso, não um bug.
 */
const FORBIDDEN: TenantPageActionState = {
  ok: false,
  code: 'FORBIDDEN',
  message: 'Permissão negada: só quem administra a instituição edita a página pública.',
};

// ───────────────────────────────────────────────────────────────────────────────
//  A página e o rascunho
// ───────────────────────────────────────────────────────────────────────────────
/** O rascunho que a página tem HOJE — `null` = a instituição nunca abriu o editor. */
async function currentPage(tenantId: string): Promise<AdminTenantPageView | null> {
  return getAdminTenantPage(tenantId);
}

/**
 * Os blocos atuais como o formulário os edita.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ORDEM É REESCRITA ANTES DE DEVOLVER
 * ─────────────────────────────────────────────────────────────────────────────
 *  Duas das operações (mover e excluir) mexem na lista INTEIRA, e a lista devolvida
 *  tem de ser a mesma que a tela acabou de desenhar — senão o "subir" seguinte
 *  partiria de uma ordem que ninguém vê. `orderBlockIds` é a função do domínio que a
 *  RENDERIZAÇÃO usa (via `selectRenderableTenantBlocks`), então editor e página
 *  concordam por construção.
 */
function orderedBlocks(blocks: readonly TenantPageBlock[]): TenantPageBlock[] {
  const order = orderBlockIds(blocks);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const positions = new Map(assignDisplayOrder(order).map((item) => [item.id, item.displayOrder]));

  return order
    .map((id) => byId.get(id))
    .filter((block): block is TenantPageBlock => Boolean(block))
    .map((block) => ({ ...block, displayOrder: positions.get(block.id) ?? block.displayOrder }));
}

/** O rascunho atual, com os blocos já na ordem canônica. */
async function draftOf(tenantId: string): Promise<TenantPageSnapshot | null> {
  const page = await currentPage(tenantId);
  return page ? { ...page.draft, blocks: orderedBlocks(page.draft.blocks) } : null;
}

/**
 * Grava o rascunho pelo serviço da fatia 1 — o ÚNICO caminho de escrita.
 *
 * A validação (com as mensagens do domínio), a trilha e a separação rascunho ×
 * publicado são do serviço; repetir qualquer uma delas aqui abriria a segunda régua.
 */
async function persistDraft(input: {
  tenantId: string;
  actorId: string;
  snapshot: TenantPageSnapshot;
}): Promise<TenantPageActionState> {
  const result = await saveTenantPublicPageDraft({
    tenantId: input.tenantId,
    actorId: input.actorId,
    title: input.snapshot.title,
    description: input.snapshot.description,
    coverImageUrl: input.snapshot.coverImageUrl,
    logoUrl: input.snapshot.logoUrl,
    theme: input.snapshot.theme,
    blocks: input.snapshot.blocks,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return { ok: true };
}

/**
 * O tema enviado pelo formulário de aparência.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O MODO NÃO É GRAVÁVEL AQUI, E ISSO É A REGRA DA FATIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  `colorMode`, `backgroundColor` e `textColor` são DESCARTADOS do que chega: no
 *  evento eles são a decisão do organizador, e nesta página quem decide o modo é o
 *  visitante (o cookie `ef_tema`, FASE 63). Aceitar esses campos por formulário
 *  seria abrir a porta para a paleta da instituição matar o claro/escuro de quem
 *  lê — exatamente o que a fase proíbe. O que se grava é a MARCA: três cores.
 *
 *  `heroImageUrl` também não entra: a imagem de fundo do destaque do evento não tem
 *  leitor nesta página (o `HERO` está em `TENANT_BLOCK_WITHOUT_RENDERER`).
 */
function readTenantTheme(formData: FormData): Record<string, unknown> {
  const colors: Record<string, string> = {};

  for (const key of ['primaryColor', 'secondaryColor', 'accentColor'] as const) {
    const value = nullable(formData.get(key));
    if (value) colors[key] = value;
  }

  const raw = text(formData.get('theme'));
  if (raw.length === 0) return { ...colors };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...colors };

    const source = parsed as Record<string, unknown>;
    const theme: Record<string, unknown> = { ...colors };

    /** Só o que o domínio aceita e a página CONSOME: raio, tipografia e densidade. */
    if (typeof source.radius === 'number' || typeof source.radius === 'string') {
      theme.radius = Number(source.radius);
    }
    if (typeof source.fontFamily === 'string') theme.fontFamily = source.fontFamily;
    if (typeof source.spacing === 'string') theme.spacing = source.spacing;
    if (typeof source.heroStyle === 'string') theme.heroStyle = source.heroStyle;
    if (typeof source.animation === 'string') theme.animation = source.animation;

    const check = tenantThemeSchema.safeParse(theme);

    return check.success ? (check.data as Record<string, unknown>) : { ...colors };
  } catch {
    return { ...colors };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aparência e identidade
// ───────────────────────────────────────────────────────────────────────────────
const settingsSchema = z.object({
  tenantSlug: tenantSlugSchema,
  title: z.string().trim().min(1, 'O título da página é obrigatório.').max(200),
  description: z.string().max(2000).optional(),
});

export async function saveTenantPageSettingsAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = settingsSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    title: formData.get('title'),
    description: text(formData.get('description')),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Verifique os campos da página.',
    };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const draft = await draftOf(context.tenantId);

  /**
   * A página NASCE na primeira gravação (decisão da fatia 1): uma instituição que
   * nunca abriu o editor não tem linha, e exigir um "criar página" antes seria uma
   * tela a mais para o mesmo ato.
   */
  const snapshot: TenantPageSnapshot = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    coverImageUrl: draft?.coverImageUrl ?? null,
    logoUrl: draft?.logoUrl ?? null,
    theme: readTenantTheme(formData),
    blocks: draft?.blocks ?? [],
  };

  const saved = await persistDraft({
    tenantId: context.tenantId,
    actorId: context.userId,
    snapshot,
  });

  if (!saved.ok) return saved;

  revalidateTenantPage(parsed.data.tenantSlug);

  return {
    ok: true,
    message: draft
      ? 'Aparência e identidade salvas no rascunho. Os visitantes ainda veem a versão publicada.'
      : 'Página criada como RASCUNHO. Ela ainda não aparece para os visitantes — publique quando estiver pronta.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Blocos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Lê o conteúdo de um bloco a partir do formulário, conforme o TIPO.
 *
 * O mapeamento é explícito (e não um `content` em JSON): um campo livre
 * transferiria para quem opera a responsabilidade de respeitar o schema, e o
 * schema é justamente o que o domínio existe para garantir. Os tipos sem campos
 * (`HERO`, `TEAM`, `SPONSORS`) não leem nada além do título.
 */
function readBlockContent(type: string, formData: FormData): unknown {
  const title = nullable(formData.get('title')) ?? undefined;

  switch (type) {
    case 'RICH_TEXT':
      return { title, body: text(formData.get('body')) };

    case 'ABOUT':
      return {
        title,
        body: text(formData.get('body')),
        ...(nullable(formData.get('foundedLabel'))
          ? { foundedLabel: text(formData.get('foundedLabel')) }
          : {}),
      };

    case 'PAST_EVENTS': {
      const limit = Number(formData.get('limit'));

      return {
        title,
        ...(nullable(formData.get('description'))
          ? { description: text(formData.get('description')) }
          : {}),
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      };
    }

    case 'CONTACT':
      return {
        title,
        ...(nullable(formData.get('address')) ? { address: text(formData.get('address')) } : {}),
        ...(nullable(formData.get('email')) ? { email: text(formData.get('email')) } : {}),
        ...(nullable(formData.get('phone')) ? { phone: text(formData.get('phone')) } : {}),
        ...(nullable(formData.get('mapUrl')) ? { mapUrl: text(formData.get('mapUrl')) } : {}),
      };

    case 'FAQ': {
      const questions = formData.getAll('faqQuestion').map((entry) => text(entry));
      const answers = formData.getAll('faqAnswer').map((entry) => text(entry));

      return {
        title,
        items: questions.map((question, index) => ({ question, answer: answers[index] ?? '' })),
      };
    }

    case 'CUSTOM_HTML':
      return { title, html: text(formData.get('html')) };

    case 'TEAM':
    case 'SPONSORS':
    case 'HERO':
      return { title };

    default:
      return { title };
  }
}

const blockTypeSchema = z
  .string()
  .trim()
  .refine(isTenantBlockType, 'Tipo de bloco desconhecido.');

const addBlockSchema = z.object({
  tenantSlug: tenantSlugSchema,
  type: blockTypeSchema,
});

export async function addTenantPageBlockAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = addBlockSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    type: formData.get('type'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione um tipo de bloco.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const draft = await draftOf(context.tenantId);
  if (!draft) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Salve a página uma vez antes de acrescentar blocos.',
    };
  }

  if (draft.blocks.length >= TENANT_MAX_PAGE_BLOCKS) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `A página aceita no máximo ${TENANT_MAX_PAGE_BLOCKS} blocos.`,
    };
  }

  const blocks = [
    ...draft.blocks,
    {
      id: randomUUID(),
      type: parsed.data.type,
      content: TENANT_DEFAULT_BLOCK_CONTENT[parsed.data.type] as Record<string, unknown>,
      style: {},
      displayOrder: draft.blocks.length * 10,
      isVisible: true,
    },
  ];

  const saved = await persistDraft({
    tenantId: context.tenantId,
    actorId: context.userId,
    snapshot: { ...draft, blocks: orderedBlocks(blocks) },
  });

  if (!saved.ok) return saved;

  revalidateTenantPage(parsed.data.tenantSlug);

  return {
    ok: true,
    message: `Bloco “${TENANT_BLOCK_LABELS[parsed.data.type]}” acrescentado ao fim da página.`,
  };
}

/** O bloco que o formulário mandou editar, com a posição dele como o domínio a vê. */
const blockRefSchema = z.object({
  tenantSlug: tenantSlugSchema,
  blockId: z.string().trim().min(1).max(64),
});

async function withBlock(
  formData: FormData,
  mutate: (input: {
    context: { tenantId: string; userId: string };
    draft: TenantPageSnapshot;
    blocks: TenantPageBlock[];
    block: TenantPageBlock;
    index: number;
  }) => TenantPageSnapshot,
): Promise<{ ok: true; tenantSlug: string } | { ok: false; state: TenantPageActionState }> {
  const parsed = blockRefSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    blockId: formData.get('blockId'),
  });

  if (!parsed.success) {
    return { ok: false, state: { ok: false, code: 'INVALID_INPUT', message: 'Bloco não identificado.' } };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return { ok: false, state: context.state };

  const draft = await draftOf(context.tenantId);

  if (!draft) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_FOUND', message: 'A página da instituição ainda não foi criada.' },
    };
  }

  const blocks = draft.blocks;
  const index = blocks.findIndex((block) => block.id === parsed.data.blockId);

  if (index < 0) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_FOUND', message: 'Este bloco não está mais na página.' },
    };
  }

  const block = blocks[index];
  if (!block) {
    return { ok: false, state: FORBIDDEN };
  }

  const snapshot = mutate({
    context: { tenantId: context.tenantId, userId: context.userId },
    draft,
    blocks,
    block,
    index,
  });

  const saved = await persistDraft({
    tenantId: context.tenantId,
    actorId: context.userId,
    snapshot,
  });

  if (!saved.ok) return { ok: false, state: saved };

  revalidateTenantPage(parsed.data.tenantSlug);

  return { ok: true, tenantSlug: parsed.data.tenantSlug };
}

const updateBlockSchema = z.object({
  tenantSlug: tenantSlugSchema,
  blockId: z.string().trim().min(1).max(64),
  type: blockTypeSchema,
  isVisible: z.coerce.boolean().default(true),
});

export async function updateTenantPageBlockAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = updateBlockSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    blockId: formData.get('blockId'),
    type: formData.get('type'),
    isVisible: formData.get('isVisible') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do bloco inválidos.',
    };
  }

  const result = await withBlock(formData, ({ draft, blocks, index, block }) => {
    const content = readBlockContent(parsed.data.type, formData);
    const updated: TenantPageBlock = {
      ...block,
      type: parsed.data.type,
      content: typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : {},
      isVisible: parsed.data.isVisible,
    };

    return { ...draft, blocks: [...blocks.slice(0, index), updated, ...blocks.slice(index + 1)] };
  });

  if (!result.ok) return result.state;

  return { ok: true, message: 'Bloco salvo no rascunho.' };
}

const moveBlockSchema = z.object({
  tenantSlug: tenantSlugSchema,
  blockId: z.string().trim().min(1).max(64),
  direction: z.enum(['up', 'down']),
});

export async function moveTenantPageBlockAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = moveBlockSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    blockId: formData.get('blockId'),
    direction: formData.get('direction'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const result = await withBlock(formData, ({ draft, blocks }) => {
    const order = moveBlockId(
      blocks.map((block) => block.id),
      parsed.data.blockId,
      parsed.data.direction,
    );
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const positions = new Map(assignDisplayOrder(order).map((item) => [item.id, item.displayOrder]));

    return {
      ...draft,
      blocks: order
        .map((id) => byId.get(id))
        .filter((block): block is TenantPageBlock => Boolean(block))
        .map((block) => ({ ...block, displayOrder: positions.get(block.id) ?? block.displayOrder })),
    };
  });

  if (!result.ok) return result.state;

  return { ok: true, message: 'Ordem atualizada.' };
}

export async function deleteTenantPageBlockAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const result = await withBlock(formData, ({ draft, blocks, block }) => ({
    ...draft,
    blocks: orderedBlocks(blocks.filter((item) => item.id !== block.id)),
  }));

  if (!result.ok) return result.state;

  return { ok: true, message: 'Bloco removido do rascunho.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Publicação
// ───────────────────────────────────────────────────────────────────────────────
const publishSchema = z.object({
  tenantSlug: tenantSlugSchema,
  /** `salvarAntes=1` grava o rascunho antes de publicar (o caminho da tela). */
  salvarAntes: z.coerce.boolean().default(false),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
});

/**
 * Publica o que está GRAVADO — nunca o que veio no formulário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA ACTION NÃO ACEITA CONTEÚDO (FASE 64 · fatia 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Publicar é um ato sobre o que já está no banco. Aceitar o conteúdo junto abriria
 *  a porta para ir ao ar algo que ninguém salvou — e para a versão publicada não
 *  corresponder ao rascunho que o organizador acabou de ver na prévia.
 *
 *  O que a tela pode pedir é `salvarAntes`, e SÓ ISSO: gravar o que ela está
 *  mostrando (título, descrição e a paleta, os campos do formulário de identidade)
 *  e então publicar. Os blocos não entram aí — cada bloco tem o próprio "salvar", e
 *  misturar os dois faria deste botão um segundo caminho de escrita de bloco.
 */
export async function publishTenantPageAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = publishSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    salvarAntes: formData.get('salvarAntes') === '1',
    title: text(formData.get('title')) || undefined,
    description: text(formData.get('description')) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const draft = await draftOf(context.tenantId);

  if (!draft) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Salve a página uma vez antes de publicar.',
    };
  }

  if (parsed.data.salvarAntes) {
    const saved = await persistDraft({
      tenantId: context.tenantId,
      actorId: context.userId,
      snapshot: {
        ...draft,
        title: parsed.data.title ?? draft.title,
        description: parsed.data.description ?? draft.description,
        theme: readTenantTheme(formData),
      },
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O SALVAR ANTES DE PUBLICAR PODE RECUSAR — E A RECUSA VENCE
     * ─────────────────────────────────────────────────────────────────────────────
     *  Se o formulário trouxe um título vazio (ou um tema fora do contrato), gravar
     *  falha e PUBLICAR O RASCUNHO ANTERIOR seria o pior resultado possível: o
     *  organizador veria "publicada" e a página no ar com o conteúdo antigo. A
     *  recusa sobe, e a tela diz por quê.
     */
    if (!saved.ok) return saved;
  }

  const result = await publishTenantPublicPage({
    tenantId: context.tenantId,
    actorId: context.userId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateTenantPage(parsed.data.tenantSlug);

  return {
    ok: true,
    message: 'Página publicada. O que estava no rascunho é o que os visitantes veem agora.',
  };
}

export async function unpublishTenantPageAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = z
    .object({ tenantSlug: tenantSlugSchema })
    .safeParse({ tenantSlug: formData.get('tenantSlug') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await unpublishTenantPublicPage({
    tenantId: context.tenantId,
    actorId: context.userId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateTenantPage(parsed.data.tenantSlug);

  return {
    ok: true,
    message:
      'A página saiu do ar. O endereço da instituição voltou a mostrar a lista de eventos, e o trabalho continua salvo no rascunho.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Capa e logotipo
// ───────────────────────────────────────────────────────────────────────────────
const requestImageSchema = z.object({
  tenantSlug: tenantSlugSchema,
  target: z.string().trim().min(1).max(32),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.coerce.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'Checksum SHA-256 inválido.').optional(),
  magicBytes: z.array(z.coerce.number().int().min(0).max(255)).max(16).optional(),
});

export async function requestTenantPageImageUploadAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const magicRaw = formData.get('magicBytes');

  const parsed = requestImageSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    target: formData.get('target'),
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType') ?? '',
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum') ?? undefined,
    ...(typeof magicRaw === 'string' && magicRaw.length > 0
      ? { magicBytes: magicRaw.split(',').map(Number) }
      : {}),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do envio inválidos.',
    };
  }

  if (!isTenantPageImageTarget(parsed.data.target)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Destino de imagem desconhecido.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const page = await currentPage(context.tenantId);

  if (!page) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Salve a página uma vez antes de enviar a imagem.',
    };
  }

  const result = await requestTenantPageAssetUpload({
    tenantId: context.tenantId,
    target: parsed.data.target,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    magicBytes: parsed.data.magicBytes ?? null,
    checksumSha256: parsed.data.checksum ?? null,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      bucket: result.bucket,
      requiredHeaders: result.requiredHeaders,
      mimeType: result.mimeType,
      maxBytes: result.maxBytes,
    },
  };
}

const confirmImageSchema = z.object({
  tenantSlug: tenantSlugSchema,
  target: z.string().trim().min(1).max(32),
  objectKey: z.string().trim().min(1).max(1024),
  bucket: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.coerce.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'Checksum SHA-256 inválido.'),
});

export async function confirmTenantPageImageUploadAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = confirmImageSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    target: formData.get('target'),
    objectKey: formData.get('objectKey'),
    bucket: formData.get('bucket'),
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType') ?? '',
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados da confirmação inválidos.' };
  }

  if (!isTenantPageImageTarget(parsed.data.target)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Destino de imagem desconhecido.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const draft = await draftOf(context.tenantId);

  if (!draft) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'A página da instituição ainda não foi criada.',
    };
  }

  const result = await confirmTenantPageAssetUpload({
    tenantId: context.tenantId,
    actorId: context.userId,
    target: parsed.data.target,
    objectKey: parsed.data.objectKey,
    bucket: parsed.data.bucket,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    checksum: parsed.data.checksum,
  });

  if (!result.ok) return result;

  /**
   * A imagem entra no RASCUNHO — nunca no publicado.
   *
   * Trocar a capa do site no instante do upload seria uma escrita silenciosa na
   * página no ar, e o organizador não teria como voltar atrás "antes de publicar".
   * O refresh da tela mostra a capa nova na prévia, e a publicação é o ato que a
   * leva ao ar.
   */
  const saved = await persistDraft({
    tenantId: context.tenantId,
    actorId: context.userId,
    snapshot:
      parsed.data.target === 'TENANT_COVER'
        ? { ...draft, coverImageUrl: result.url }
        : { ...draft, logoUrl: result.url },
  });

  if (!saved.ok) return saved;

  revalidateTenantPage(parsed.data.tenantSlug);

  return {
    ok: true,
    message: 'Imagem enviada e guardada em WebP.',
    data: {
      url: result.url,
      objectKey: result.objectKey,
      sizeBytes: result.sizeBytes,
      sourceBytes: result.sourceBytes,
      sourceMime: result.sourceMime,
    },
  };
}

/**
 * Remove a capa (ou o logotipo) do rascunho.
 *
 * Apagar a URL não apaga o objeto do bucket: a imagem pode estar em uso noutro
 * lugar, e quem decide isso é o acervo (que confere o uso antes). A tela diz isso
 * em vez de prometer uma exclusão que não aconteceu.
 */
export async function removeTenantPageImageAction(
  _prev: TenantPageActionState | null,
  formData: FormData,
): Promise<TenantPageActionState> {
  const parsed = z
    .object({ tenantSlug: tenantSlugSchema, target: z.string().trim().min(1).max(32) })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), target: formData.get('target') });

  if (!parsed.success || !isTenantPageImageTarget(parsed.data.target)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Destino de imagem desconhecido.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const draft = await draftOf(context.tenantId);

  if (!draft) {
    return { ok: false, code: 'NOT_FOUND', message: 'A página da instituição ainda não foi criada.' };
  }

  const saved = await persistDraft({
    tenantId: context.tenantId,
    actorId: context.userId,
    snapshot:
      parsed.data.target === 'TENANT_COVER'
        ? { ...draft, coverImageUrl: null }
        : { ...draft, logoUrl: null },
  });

  if (!saved.ok) return saved;

  revalidateTenantPage(parsed.data.tenantSlug);

  return { ok: true, message: 'Imagem removida do rascunho. O arquivo continua no acervo.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Sobre a identidade da instituição no editor
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O editor lê a identidade por `getTenantContext` (`lib/events/event-repository`) —
 * a MESMA leitura que a página pública usa para resolver slug → instituição.
 *
 * Ela NÃO é reexportada daqui de propósito: este módulo é `'use server'`, e tudo o
 * que ele exporta vira endpoint de Server Action. Uma leitura de identidade não é
 * um ato do organizador, e abrir um endpoint para ela seria superfície sem motivo.
 */