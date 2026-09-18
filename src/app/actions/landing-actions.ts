'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Página pública do evento (FASE 17, itens E3 e E4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERMISSÃO É `page:manage`, E NÃO `event:update`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `page:manage` existe no catálogo desde a FASE 2 e nunca tinha sido usada: era
 *  a permissão prevista para exatamente isto — montar a vitrine pública. Usar
 *  `event:update` (que já guarda o cadastro do evento) juntaria duas
 *  responsabilidades diferentes: quem corrige a data do evento não precisa poder
 *  publicar uma página no ar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE REVALIDAR É OBRIGATÓRIO AQUI, E NÃO OPCIONAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A landing page é pública e cacheada por rota. Sem `revalidatePath` da página
 *  pública, o organizador salva um bloco, abre a página e vê a versão antiga — e
 *  conclui que "não salvou". A revalidação acontece em TODA ação que muda conteúdo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { ASSET_TARGETS, type AssetTarget } from '@/domain/events/image-rules';
import { PAGE_BLOCK_TYPES, type PageBlockType } from '@/domain/events/landing-page';
import {
  addPageBlock,
  deletePageBlock,
  ensureHomePage,
  movePageBlock,
  savePageSettings,
  seedRecommendedBlocks,
  updatePageBlock,
} from '@/lib/admin/landing-service';
import { confirmAssetUpload, requestAssetUpload } from '@/lib/admin/asset-service';
import { restorePageVersion } from '@/lib/admin/page-version-service';
import { deleteMediaAsset } from '@/lib/admin/media-asset-service';
import { isValidTimeZone, zonedWallTimeToInstant } from '@/domain/events/scheduling-rules';

export interface LandingActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Guarda
// ───────────────────────────────────────────────────────────────────────────────
async function guard(input: {
  tenantSlug: string;
  /** A tela usa `page:manage`; o logotipo do patrocinador usa `sponsor:manage`. */
  permission: typeof PERMISSIONS.PAGE_MANAGE | typeof PERMISSIONS.SPONSOR_MANAGE;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: LandingActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Você não tem vínculo ativo com esta instituição.' },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, input.permission, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

/** A página pública e o editor precisam das duas rotas revalidadas. */
function revalidateLanding(tenantSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
  /**
   * Revalida TODO o caminho público de eventos.
   *
   * `revalidatePath` com o caminho exato exigiria conhecer o slug do evento aqui, e
   * um evento recém-criado poderia ficar com a página antiga no cache. Revalidar o
   * segmento é mais barato do que servir conteúdo velho na vitrine.
   */
  revalidatePath(tenantPath(tenantSlug, '/eventos'), 'layout');
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Página
// ───────────────────────────────────────────────────────────────────────────────
const tenantEventSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid('Evento inválido.'),
});

export async function ensureHomePageAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await ensureHomePage({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    title: nullable(formData.get('title')) ?? undefined,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return {
    ok: true,
    message: result.created
      ? 'Página criada como RASCUNHO. Adicione blocos e publique quando estiver pronta.'
      : 'A página do evento já existia.',
    data: { pageId: result.pageId },
  };
}

/**
 * Tema do evento enviado pelo editor.
 *
 * Campo vazio significa "usar o padrão do sistema" — e é por isso que as cores são
 * opcionais: apagar a cor primária devolve o token da plataforma, em vez de gravar
 * um preto silencioso. (Um `<input type="color">` vazio enviaria `#000000`, que é
 * exatamente o defeito que este formato evita.)
 */
const themeSchema = z.object({
  primaryColor: z.string().trim().max(9).optional(),
  secondaryColor: z.string().trim().max(9).optional(),
  accentColor: z.string().trim().max(9).optional(),
  backgroundColor: z.string().trim().max(9).optional(),
  textColor: z.string().trim().max(9).optional(),
  colorMode: z.enum(['light', 'dark', 'auto']).default('light'),
  radius: z.coerce.number().int().min(0).max(48).default(12),
  fontFamily: z.enum(['inter', 'geist', 'system', 'serif', 'mono', 'rounded']).default('inter'),
  spacing: z.enum(['compact', 'normal', 'spacious']).default('normal'),
  heroStyle: z.enum(['solid', 'gradient', 'image', 'minimal']).default('gradient'),
  animation: z.enum(['none', 'fade', 'slide']).default('fade'),
});

const pageSettingsSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  title: z.string().trim().min(3, 'O título da página precisa ter ao menos 3 caracteres.').max(200),
  metaTitle: z.string().trim().max(200).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  isPublished: z.coerce.boolean().default(false),
  /** `datetime-local` — vazio significa "sem agendamento". */
  publishAt: z.string().trim().max(32).optional(),
  /** `datetime-local` — vazio significa "sem data de término" (FASE 24). */
  unpublishAt: z.string().trim().max(32).optional(),
  /**
   * Fuso do EVENTO, enviado em campo oculto (FASE 24, item E17).
   *
   * É o fuso em que a data digitada deve ser interpretada. Vem do formulário (e não
   * de uma consulta) porque é ele que a tela mostrou ao organizador: usar outro
   * valor aqui gravaria uma hora diferente da que ele viu.
   */
  eventTimezone: z.string().trim().max(64).optional(),
  theme: themeSchema,
});

/**
 * Converte `<input type="datetime-local">` em instante, NO FUSO DO EVENTO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA FUNÇÃO CORRIGE (item E17)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 23 o valor era lido com `new Date(texto)`, que interpreta a hora de
 *  parede no fuso do PROCESSO — UTC em produção. O organizador digitava "seis da
 *  tarde" e a página entrava no ar às três da tarde, três horas antes, sem erro e
 *  sem nada na tela explicando por quê.
 *
 *  Agora a hora de parede é convertida a partir do fuso do evento. Sem fuso válido
 *  no formulário (JavaScript desabilitado, valor adulterado), caímos em UTC e a
 *  mensagem de sucesso diz qual fuso foi usado — o organizador confere o que foi
 *  gravado em vez de descobrir depois.
 */
function toScheduledDate(
  value: FormDataEntryValue | null,
  timeZone: string,
): { ok: true; date: Date | undefined } | { ok: false; message: string } {
  const text = nullable(value);
  if (!text) return { ok: true, date: undefined };

  const date = zonedWallTimeToInstant(text, timeZone);
  if (!date) {
    return {
      ok: false,
      message: `A data "${text}" não é válida (use o formato do campo, ex.: 2026-12-01T18:00).`,
    };
  }

  return { ok: true, date };
}

/**
 * Salva identidade, publicação e tema.
 *
 * O tema é validado DUAS vezes de propósito: aqui (formato dos campos) e no
 * domínio (`resolveTheme`, a allowlist de cores). A primeira dá mensagem por campo;
 * a segunda é a garantia — é a mesma função que a renderização usa.
 */
export async function savePageSettingsAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const colors = {
    primaryColor: nullable(formData.get('primaryColor')) ?? undefined,
    secondaryColor: nullable(formData.get('secondaryColor')) ?? undefined,
    accentColor: nullable(formData.get('accentColor')) ?? undefined,
    backgroundColor: nullable(formData.get('backgroundColor')) ?? undefined,
    textColor: nullable(formData.get('textColor')) ?? undefined,
  };

  const parsed = pageSettingsSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    metaTitle: nullable(formData.get('metaTitle')) ?? undefined,
    metaDescription: nullable(formData.get('metaDescription')) ?? undefined,
    isPublished: formData.get('isPublished') === 'on',
    publishAt: nullable(formData.get('publishAt')) ?? undefined,
    unpublishAt: nullable(formData.get('unpublishAt')) ?? undefined,
    eventTimezone: nullable(formData.get('eventTimezone')) ?? undefined,
    theme: {
      ...colors,
      colorMode: formData.get('colorMode') || 'light',
      radius: formData.get('radius') || 12,
      fontFamily: formData.get('fontFamily') || 'inter',
      spacing: formData.get('spacing') || 'normal',
      heroStyle: formData.get('heroStyle') || 'gradient',
      animation: formData.get('animation') || 'fade',
    },
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os campos da página.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  /**
   * O fuso informado é validado antes de qualquer uso. Um fuso inválido no campo
   * oculto (formulário adulterado, evento antigo sem fuso) NÃO pode virar data
   * errada em silêncio: caímos em UTC e a mensagem dirá isso.
   */
  const requestedZone = parsed.data.eventTimezone ?? '';
  const timeZone = isValidTimeZone(requestedZone) ? requestedZone : 'UTC';

  const publishAt = toScheduledDate(formData.get('publishAt'), timeZone);
  if (!publishAt.ok) return { ok: false, code: 'INVALID_INPUT', message: publishAt.message };

  const unpublishAt = toScheduledDate(formData.get('unpublishAt'), timeZone);
  if (!unpublishAt.ok) return { ok: false, code: 'INVALID_INPUT', message: unpublishAt.message };

  const result = await savePageSettings({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    title: parsed.data.title,
    metaTitle: parsed.data.metaTitle ?? null,
    metaDescription: parsed.data.metaDescription ?? null,
    isPublished: parsed.data.isPublished,
    publishAt: publishAt.date ?? null,
    unpublishAt: unpublishAt.date ?? null,
    theme: parsed.data.theme,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  /**
   * A mensagem vem do DOMÍNIO (`planPublication`), e não daqui: é ele que sabe se a
   * página ficou publicada, agendada ou rascunho — e a explicação de cada caso (por
   * que as datas foram limpas, quando a página entra e sai do ar) precisa ser a
   * mesma em todos os caminhos que salvam a página.
   *
   * O fuso entra na mensagem porque é a única forma de o organizador CONFERIR a
   * conversão: "01/12 18:00" só significa algo se ele souber em que fuso foi lido.
   */
  return {
    ok: true,
    message: `${result.message} (horário em ${timeZone}.)`,
    data: { publication: result.publication, timeZone },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Blocos
// ───────────────────────────────────────────────────────────────────────────────
export async function addBlockAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema
    .extend({ type: z.enum(PAGE_BLOCK_TYPES as unknown as [PageBlockType, ...PageBlockType[]]) })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      type: formData.get('type'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione um tipo de bloco.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await addPageBlock({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    type: parsed.data.type,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Bloco adicionado ao fim da página.', data: { blockId: result.blockId } };
}

export async function seedRecommendedBlocksAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await seedRecommendedBlocks({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return {
    ok: true,
    message: `${result.created} bloco(s) criados na ordem recomendada. Preencha o que fizer sentido e remova o resto.`,
  };
}

/**
 * Lê o conteúdo do bloco a partir do formulário, conforme o TIPO.
 *
 * Cada tipo tem campos próprios, e o mapeamento é explícito aqui em vez de
 * genérico: um formulário que enviasse `content` como JSON abriria a porta para
 * qualquer estrutura — e a validação do domínio viraria a única barreira, quando
 * ela deve ser a última.
 */
function readBlockContent(type: PageBlockType, formData: FormData): unknown {
  const title = nullable(formData.get('title')) ?? undefined;

  switch (type) {
    case 'RICH_TEXT':
      return { title, body: text(formData.get('body')) };

    case 'FAQ': {
      const questions = formData.getAll('faqQuestion').map((entry) => text(entry));
      const answers = formData.getAll('faqAnswer').map((entry) => text(entry));
      return {
        title,
        items: questions.map((question, index) => ({ question, answer: answers[index] ?? '' })),
      };
    }

    case 'GALLERY': {
      const urls = formData.getAll('galleryUrl').map((entry) => text(entry));
      const captions = formData.getAll('galleryCaption').map((entry) => text(entry));
      return {
        title,
        images: urls.map((url, index) => ({
          url,
          ...(captions[index] ? { caption: captions[index] } : {}),
        })),
      };
    }

    case 'SPONSORS':
      return { title, ...(nullable(formData.get('tierId')) ? { tierId: text(formData.get('tierId')) } : {}) };

    case 'COUNTDOWN':
      return { title, label: nullable(formData.get('label')) ?? undefined };

    case 'REGISTRATION_CTA':
      return {
        title,
        description: nullable(formData.get('description')) ?? undefined,
        ctaLabel: nullable(formData.get('ctaLabel')) ?? undefined,
      };

    case 'CUSTOM_HTML':
      return { title, html: text(formData.get('html')) };

    default:
      return { title };
  }
}

export async function updateBlockAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema
    .extend({
      blockId: z.string().uuid(),
      type: z.enum(PAGE_BLOCK_TYPES as unknown as [PageBlockType, ...PageBlockType[]]),
      isVisible: z.coerce.boolean().default(true),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      blockId: formData.get('blockId'),
      type: formData.get('type'),
      isVisible: formData.get('isVisible') === 'on',
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do bloco inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await updatePageBlock({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    blockId: parsed.data.blockId,
    content: readBlockContent(parsed.data.type, formData),
    isVisible: parsed.data.isVisible,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Bloco salvo.' };
}

export async function moveBlockAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema
    .extend({
      blockId: z.string().uuid(),
      direction: z.enum(['up', 'down']),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      blockId: formData.get('blockId'),
      direction: formData.get('direction'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await movePageBlock({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    blockId: parsed.data.blockId,
    direction: parsed.data.direction,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Ordem atualizada.' };
}

export async function deleteBlockAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema
    .extend({ blockId: z.string().uuid() })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      blockId: formData.get('blockId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await deletePageBlock({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    blockId: parsed.data.blockId,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Bloco removido.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Versões da página (FASE 23, item E12)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Restaura a página a partir de uma versão do histórico.
 *
 * A permissão é a MESMA da edição (`page:manage`): restaurar é escrever na página.
 * Não há permissão nova porque não há ato novo — o que muda é de onde vem o conteúdo.
 */
export async function restorePageVersionAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = tenantEventSchema
    .extend({ versionId: z.string().uuid() })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      versionId: formData.get('versionId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await restorePageVersion({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    versionId: parsed.data.versionId,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return {
    ok: true,
    message: `Versão restaurada (${result.blockCount} bloco(s)). O estado de publicação não mudou.`,
    data: { pageId: result.pageId, blockCount: result.blockCount },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Biblioteca de mídia (FASE 24, item E14)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Remove uma imagem do acervo.
 *
 * A permissão é `page:manage` porque o acervo é o material da página. E o serviço
 * RECUSA quando a imagem está em uso — apagar uma imagem publicada deixaria a página
 * com um ícone quebrado, e o organizador não saberia por quê.
 */
export async function deleteMediaAssetAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      assetId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      assetId: formData.get('assetId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.PAGE_MANAGE });
  if (!context.ok) return context.state;

  const result = await deleteMediaAsset({
    tenantId: context.tenantId,
    actorId: context.userId,
    assetId: parsed.data.assetId,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Imagem removida do acervo.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Imagens (capa e logotipo) — upload direto ao storage
// ───────────────────────────────────────────────────────────────────────────────
const requestAssetSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  target: z.enum(ASSET_TARGETS as unknown as [AssetTarget, ...AssetTarget[]]),
  sponsorId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.coerce.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'Checksum SHA-256 inválido.'),
  magicBytes: z.array(z.coerce.number().int().min(0).max(255)).max(16).optional(),
});

/** Permissão por destino: a página usa `page:manage`; o patrocínio, `sponsor:manage`. */
function permissionForTarget(target: AssetTarget) {
  return target === 'SPONSOR_LOGO' ? PERMISSIONS.SPONSOR_MANAGE : PERMISSIONS.PAGE_MANAGE;
}

export async function requestAssetUploadAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const magicRaw = formData.get('magicBytes');

  const parsed = requestAssetSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    target: formData.get('target'),
    sponsorId: nullable(formData.get('sponsorId')) ?? undefined,
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType') ?? '',
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum'),
    ...(typeof magicRaw === 'string' && magicRaw.length > 0
      ? { magicBytes: magicRaw.split(',').map(Number) }
      : {}),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados de upload inválidos.',
    };
  }

  const context = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: permissionForTarget(parsed.data.target),
  });
  if (!context.ok) return context.state;

  const result = await requestAssetUpload({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    target: parsed.data.target,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    magicBytes: parsed.data.magicBytes ?? null,
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

const confirmAssetSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  target: z.enum(ASSET_TARGETS as unknown as [AssetTarget, ...AssetTarget[]]),
  sponsorId: z.string().uuid().optional(),
  objectKey: z.string().trim().min(1).max(1024),
  bucket: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.coerce.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
});

export async function confirmAssetUploadAction(
  _prev: LandingActionState | null,
  formData: FormData,
): Promise<LandingActionState> {
  const parsed = confirmAssetSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    target: formData.get('target'),
    sponsorId: nullable(formData.get('sponsorId')) ?? undefined,
    objectKey: formData.get('objectKey'),
    bucket: formData.get('bucket'),
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType') ?? '',
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados de confirmação inválidos.' };
  }

  const context = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: permissionForTarget(parsed.data.target),
  });
  if (!context.ok) return context.state;

  const result = await confirmAssetUpload({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    target: parsed.data.target,
    ...(parsed.data.sponsorId ? { sponsorId: parsed.data.sponsorId } : {}),
    objectKey: parsed.data.objectKey,
    bucket: parsed.data.bucket,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    checksum: parsed.data.checksum,
  });

  if (!result.ok) return result;

  revalidateLanding(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Imagem enviada e vinculada.', data: { url: result.url } };
}
