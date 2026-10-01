'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { guardSelfServiceAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PUBLIC_PROFILE_FIELDS, PROFILE_AUDIENCES } from '@/domain/profile/public-profile-rules';
import { PUBLIC_CONTACT_NETWORKS } from '@/domain/profile/public-contacts';
import {
  PROFILE_REPORT_CATEGORIES,
  REPORT_DETAILS_MAX_LENGTH,
  detailsProblemMessage,
  isProfileReportCategory,
} from '@/domain/profile/profile-moderation-rules';
import { reportPublicProfile } from '@/lib/profile/profile-report-service';
import { savePublicProfile } from '@/lib/profile/public-profile-service';
import type { AdminActionState } from '@/app/actions/admin-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVER ACTIONS — Perfil público (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É `:own` E A ESCRITA É SEMPRE NA PRÓPRIA LINHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `PROFILE_MANAGE_OWN` é conferida com o `ownerId` da sessão, e o serviço grava no
 *  `userId` que veio do contexto — nunca de um campo do formulário. Não existe
 *  action que edite o perfil de OUTRA pessoa: a instituição não administra a
 *  vitrine de ninguém (a ficha 360 lê, e só).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DENÚNCIA (FASE 56 · E62) MORA AQUI PELO LUGAR, NÃO PELA POSSE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela é o único ato desta tela que NÃO escreve na própria linha: escreve uma
 *  denúncia sobre outra pessoa. Por isso a guarda é diferente (sessão obrigatória,
 *  sem exigir vínculo) e as regras de mérito vivem no serviço — a vigilância de
 *  "quem denuncia o quê" não pode depender de qual formulário chamou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface PublicProfileActionState extends AdminActionState {
  username?: string;
}

const audienceSchema = z.enum(PROFILE_AUDIENCES);

/**
 * A matriz vem do formulário como N campos (`audience_<campo>`).
 *
 * Campo ausente cai no padrão do domínio (`parseProfileAudiences`), o que mantém o
 * formulário tolerante a uma tela que ainda não conheça um campo novo.
 */
function readAudiences(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};

  for (const field of PUBLIC_PROFILE_FIELDS) {
    const value = formData.get(`audience_${field}`);
    if (typeof value === 'string' && audienceSchema.safeParse(value).success) {
      raw[field] = value;
    }
  }

  return raw;
}

/**
 * Contatos vêm como N campos (`contact_<rede>`), um por rede.
 *
 * Não passa por validação de forma aqui: quem decide o que é um LinkedIn válido é o
 * domínio (`sanitizePublicContacts`), no serviço — a action só entrega o que o
 * formulário mandou, e a recusa sai com o motivo por campo.
 */
function readContacts(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};

  for (const network of PUBLIC_CONTACT_NETWORKS) {
    const value = formData.get(`contact_${network}`);
    if (typeof value === 'string') raw[network] = value;
  }

  return raw;
}

export async function savePublicProfileAction(
  _prev: PublicProfileActionState | null,
  formData: FormData,
): Promise<PublicProfileActionState> {
  const tenantSlug = String(formData.get('tenantSlug') ?? '');

  const guard = await guardSelfServiceAction({
    tenantSlug,
    permission: PERMISSIONS.PROFILE_MANAGE_OWN,
  });

  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason,
      message:
        guard.reason === 'NOT_AUTHENTICATED'
          ? 'Entre para editar o seu perfil.'
          : 'Você não tem acesso a esta instituição.',
    };
  }

  const interests = String(formData.get('interests') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const publicEventIds = formData
    .getAll('publicEventIds')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);

  const result = await savePublicProfile({
    tenantId: guard.tenantId,
    userId: guard.userId,
    username: String(formData.get('username') ?? ''),
    headline: (formData.get('headline') as string | null) ?? null,
    bio: (formData.get('bio') as string | null) ?? null,
    interests,
    siteUrl: (formData.get('siteUrl') as string | null) ?? null,
    orcidId: (formData.get('orcidId') as string | null) ?? null,
    lattesId: (formData.get('lattesId') as string | null) ?? null,
    contacts: readContacts(formData),
    audiences: readAudiences(formData),
    indexable: formData.get('indexable') === 'on',
    listedInDirectory: formData.get('listedInDirectory') === 'on',
    publicNameInResults: formData.get('publicNameInResults') === 'on',
    publicEventIds,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(tenantPath(tenantSlug, '/meu-perfil-publico'));
  revalidatePath(tenantPath(tenantSlug, `/u/${result.username}`));

  return {
    ok: true,
    username: result.username,
    message: result.handleChanged
      ? `Perfil salvo. O seu endereço agora é /u/${result.username}.`
      : 'Perfil salvo.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Denúncia do perfil público (FASE 56 · dívida E62)
// ───────────────────────────────────────────────────────────────────────────────
export interface ProfileReportActionState extends AdminActionState {
  reportId?: string;
}

const reportSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  /** O `@handle` cru da barra de endereços: quem normaliza é o serviço. */
  username: z.string().trim().min(1).max(60),
  category: z.enum(PROFILE_REPORT_CATEGORIES),
  /**
   * Sem `required` aqui: a obrigatoriedade depende da CATEGORIA (só `OTHER` exige),
   * e quem sabe disso é o domínio — `detailsProblem`. O teto é o dobro da coluna
   * apenas para não receber um texto ilimitado; a mensagem é a MESMA do domínio,
   * para a recusa não ter duas redações.
   */
  details: z.string().max(REPORT_DETAILS_MAX_LENGTH * 2, detailsProblemMessage('TOO_LONG')).optional(),
});

/**
 * Registra a denúncia de um perfil público.
 *
 * ─── A SESSÃO É OBRIGATÓRIA; A POSSE E O ANTIABUSO ESTÃO NO SERVIÇO ──────────
 *
 *  Denunciar exige estar autenticado — a denúncia é um ato atribuível, e sem isso a
 *  fila de moderação não teria como separar relato de vandalismo. O vínculo, porém,
 *  NÃO é exigido: quem chegou pelo link público de uma casa pode ver o perfil e tem
 *  o mesmo direito de denunciar (é a `guardSelfServiceAction`, a mesma da inscrição
 *  pública e da proposta de chamada).
 *
 *  As regras de mérito — não denunciar o próprio perfil, uma denúncia aberta por
 *  denunciante, o mínimo de detalhes em `OTHER` — vivem em `reportPublicProfile`,
 *  porque valem para QUALQUER chamador do serviço, e não só para este formulário.
 */
export async function reportPublicProfileAction(
  _prev: ProfileReportActionState | null,
  formData: FormData,
): Promise<ProfileReportActionState> {
  const parsed = reportSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    username: formData.get('username'),
    category: formData.get('category'),
    details: (formData.get('details') as string | null) ?? undefined,
  });

  if (!parsed.success) {
    /**
     * O que foi digitado VOLTA para a tela (armadilha 5): o React reseta o formulário
     * na resposta, e um relato longo não pode se perder porque a categoria veio
     * vazia. Os valores vão crus — quem valida é o domínio, e repetir a régua aqui
     * criaria uma segunda versão dela.
     */
    const sentCategory = formData.get('category');
    const sentDetails = formData.get('details');

    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revise a denúncia.',
      details: parsed.error.issues.map((issue) => issue.message),
      data: {
        ...(isProfileReportCategory(sentCategory) ? { category: sentCategory } : {}),
        details: typeof sentDetails === 'string' ? sentDetails : '',
      },
    };
  }

  const guard = await guardSelfServiceAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.PROFILE_MANAGE_OWN,
  });

  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason,
      message:
        guard.reason === 'NOT_AUTHENTICATED'
          ? 'Entre na sua conta para denunciar este perfil.'
          : 'Não foi possível registrar a denúncia nesta instituição.',
    };
  }

  const requestHeaders = await headers();

  const result = await reportPublicProfile({
    tenantId: guard.tenantId,
    reporterUserId: guard.userId,
    username: parsed.data.username,
    category: parsed.data.category,
    details: parsed.data.details ?? null,
    ipAddress: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details,
      /** Mesma razão do bloco de recusa do schema: o que a pessoa escreveu não se perde. */
      data: { category: parsed.data.category, details: parsed.data.details ?? '' },
    };
  }

  /**
   * ─── POR QUE NÃO HÁ `revalidatePath` AQUI ────────────────────────────────────
   *
   *  A confirmação desta action é o próprio formulário, que SAI DE CENA e dá lugar
   *  ao cartão de sucesso (o componente troca o `<form>` pelo aviso quando `ok`).
   *  Revalidar a página no mesmo instante substituiria esse cartão pelo estado
   *  renderizado pelo servidor — a pessoa leria "em andamento" sem nunca ver a
   *  confirmação do que acabou de fazer.
   *
   *  O estado da página não fica mentindo: `alreadyReported` é recalculado em toda
   *  renderização seguinte (recarregar, voltar, navegar), e é ele que faz o formulário
   *  não ser oferecido de novo. A recusa de verdade continua no serviço.
   */
  return {
    ok: true,
    reportId: result.reportId,
    message: 'Denúncia registrada. A moderação da plataforma vai analisar o perfil.',
  };
}
