'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — link público da carta (FASE 51 · dívida E70)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO É NOVO, E NÃO MAIS UM BLOCO EM `gamification-actions.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `gamification-actions.ts` é o arquivo de gamificação inteiro (missão, XP,
 *  destaque, catálogo) e vive mudando. O link compartilhado ganhou regra própria
 *  (prazo escolhido por quem cria, contagem de aberturas, histórico com estado) e
 *  ficar aqui deixa a mudança isolada do que já existia — inclusive da ação antiga
 *  `shareCardAction`, que continua no lugar dela sem prazo nenhum.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A AUTORIZAÇÃO É CONFERIDA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `card:read:own` passa pela guarda compartilhada, que resolve a posse com o
 *  `userId` da SESSÃO (`:own` sem `ownerId` é recusado — invariante nº 4). O que a
 *  guarda NÃO prova é que a carta é do sujeito: isso o serviço confere no banco,
 *  com o `userCardId` tratado como palpite. Esconder o botão nunca foi autorização.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { SHARE_VALIDITY_IDS } from '@/domain/gamification/card-share-rules';
import { ensureCardShareLink } from '@/lib/gamification/card-share-service';

interface CardShareActionState {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * `dia` só é exigido quando a escolha é "Escolher a data", e essa regra NÃO fica
 * no schema: quem decide é o domínio (`shareExpiryFor`), que também confere se a
 * data existe no calendário e se ela já passou. Duplicar a regra aqui criaria duas
 * versões da mesma validação.
 */
const createShareSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  userCardId: z.string().uuid(),
  validade: z.enum(SHARE_VALIDITY_IDS).default('NEVER'),
  /** Texto cru do `<input type="date">`; a validade dele é do domínio. */
  dia: z.string().trim().max(10).optional(),
});

/** Cria (ou reaproveita) o link público de UMA carta, com o prazo escolhido. */
export async function createCardShareAction(
  _prev: CardShareActionState | null,
  formData: FormData,
): Promise<CardShareActionState> {
  const parsed = createShareSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    userCardId: formData.get('userCardId'),
    validade: formData.get('validade') ?? undefined,
    dia: formData.get('dia') ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Dados inválidos para compartilhar a carta.',
    };
  }

  const auth = await guardAction<CardShareActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CARD_READ_OWN,
  });

  if (!auth.ok) return auth.state;

  /**
   * O nome da instituição NÃO é buscado aqui: o serviço lê o nome e o fuso na
   * mesma transação que confere a posse e grava o link. Uma consulta a mais só
   * para montar a frase do compartilhamento seria uma ida ao banco por clique.
   */
  const result = await ensureCardShareLink({
    tenantId: auth.tenantId,
    userId: auth.userId,
    tenantSlug: parsed.data.tenantSlug,
    userCardId: parsed.data.userCardId,
    validity: parsed.data.validade,
    validityDay: parsed.data.dia ?? null,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/cartas'));

  return {
    ok: true,
    message: result.state.url
      ? 'Link pronto. Quem abrir vê apenas esta carta.'
      : 'Este link não pode ser exibido de novo — revogue e crie outro.',
    data: {
      url: result.state.url,
      linkId: result.state.linkId,
      shareText: result.state.shareText,
      shareDisplayName: result.state.shareDisplayName,
      showsRealName: result.state.showsRealName,
      createdAt: result.state.createdAt?.toISOString() ?? null,
      /** O prazo decidido volta para a tela confirmar o que foi criado. */
      status: result.state.status,
      statusLabel: result.state.statusLabel,
      expiresAt: result.state.expiresAt?.toISOString() ?? null,
      viewCount: result.state.viewCount,
      lastViewedLabel: result.state.lastViewedLabel,
    },
  };
}
