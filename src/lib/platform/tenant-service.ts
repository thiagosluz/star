/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Governança da plataforma
 *
 *  Provisionar, suspender, reativar e dar perfil público a uma instituição são
 *  operações que NÃO PERTENCEM a instituição alguma. Elas rodam com a conexão
 *  administrativa (ver a nota em `global-repository.ts`) e só são alcançáveis
 *  depois de `requirePlatformPermission` — a autorização NÃO mora aqui, mora na
 *  guarda; aqui mora o negócio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS COISAS QUE ESTE SERVIÇO NUNCA FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. NÃO CRIA INSTITUIÇÃO EM ESTADO INVÁLIDO. O provisionamento é uma transação
 *     única: instituição + vínculo do proprietário + papel OWNER. Se qualquer
 *     passo falhar (slug duplicado por corrida, por exemplo), NADA fica: uma
 *     instituição sem dono é um órfão que ninguém consegue administrar.
 *
 *  2. NÃO SUSPENDE SEM JUSTIFICATIVA. A frase é lida pelo dono na tela de bloqueio
 *     e pelo suporte meses depois; por isso o mínimo de caracteres é regra de
 *     domínio, não validação de formulário.
 *
 *  3. NÃO DESFAZ AUDITORIA. A trilha é escrita DEPOIS do commit e nunca lança: um
 *     erro ao auditar não pode reverter uma operação já validada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { invalidateTenantCache } from '@/lib/tenancy/tenant-resolver';
import {
  evaluateReactivation,
  evaluateSuspension,
  normalizeSlug,
  validateProvisioning,
  validatePublicProfile,
  type ProvisioningInput,
  type PublicProfileInput,
  type TenantPlan,
  type TenantStatus,
} from '@/domain/platform/platform-rules';
import {
  findTenantById,
  findUserByEmail,
  isDomainTaken,
  isSlugTakenGlobally,
  listTenants,
  listTenantMembers,
  getPlatformMetrics,
  type ListTenantsOptions,
  type PlatformMetrics,
  type TenantAdminRow,
  type TenantMemberRow,
} from '@/lib/platform/global-repository';

export type PlatformErrorCode =
  | 'INVALID_INPUT'
  | 'SLUG_TAKEN'
  | 'OWNER_NOT_FOUND'
  | 'ALREADY_OWNER'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'LAST_SUPERADMIN'
  | 'INTERNAL';

export type PlatformResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: PlatformErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Provisionamento
// ───────────────────────────────────────────────────────────────────────────────
export interface ProvisionTenantInput extends ProvisioningInput {
  /** Nome do dono, usado só quando a conta ainda não existe. */
  ownerName?: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  slug: string;
  name: string;
  ownerEmail: string;
  /**
   * `true` quando a conta do proprietário foi encontrada e vinculada.
   *
   * Só existe este caminho: NÃO criamos uma conta "meio-pronta" com senha nula,
   * porque o e-mail é único e o cadastro passaria a recusar aquele endereço para
   * sempre — a pessoa nunca conseguiria entrar nem se cadastrar. Ver ADR da fase.
   */
  ownerLinked: true;
}

/**
 * Provisiona uma instituição e designa o proprietário — tudo ou nada.
 */
export async function provisionTenant(
  actorId: string,
  input: ProvisionTenantInput,
): Promise<PlatformResult<ProvisionedTenant>> {
  const validation = validateProvisioning(input);

  if (!validation.valid || !validation.normalized) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revise os dados da instituição.',
      details: validation.errors,
    };
  }

  const data = validation.normalized;

  /**
   * Checagens de disponibilidade ANTES da transação, para dar mensagem útil.
   * Elas NÃO são a garantia: entre a checagem e o INSERT cabe outra requisição,
   * e quem decide a corrida é o índice único do banco (tratado abaixo).
   */
  if (await isSlugTakenGlobally(data.slug)) {
    return {
      ok: false,
      code: 'SLUG_TAKEN',
      message: `O identificador "${data.slug}" já está em uso por outra instituição.`,
    };
  }

  if (data.customDomain && (await isDomainTaken(data.customDomain))) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `O domínio "${data.customDomain}" já está vinculado a outra instituição.`,
      details: ['Escolha outro domínio personalizado ou deixe o campo vazio.'],
    };
  }

  const owner = await findUserByEmail(data.ownerEmail);
  if (!owner) {
    return {
      ok: false,
      code: 'OWNER_NOT_FOUND',
      message: `Não existe conta com o e-mail ${data.ownerEmail}.`,
      details: [
        'A identidade é única na plataforma: a pessoa precisa criar a conta em /signup antes de ser designada proprietária.',
        'Depois do cadastro, provisione novamente com o mesmo e-mail — nada foi criado até aqui.',
      ],
    };
  }

  try {
    const tenantId = await adminPrisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: data.slug,
          name: data.name,
          plan: data.plan,
          status: 'ACTIVE',
          customDomain: data.customDomain,
          maxEvents: data.maxEvents ?? 0,
          maxMembers: data.maxMembers ?? 0,
          description: data.description,
          isPublic: data.isPublic,
        },
        select: { id: true },
      });

      /**
       * Vínculo já ATIVO (não INVITED).
       *
       * Quem é designado proprietário por um SuperAdmin não está "convidado": o
       * convite aconteceu fora da plataforma, no contato entre as partes. Deixar
       * o vínculo pendente exigiria um segundo aceite — e deixaria a instituição
       * recém-criada sem ninguém capaz de administrá-la se o aceite não viesse.
       */
      await tx.userTenantProfile.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
          invitedById: actorId,
          invitedAt: new Date(),
        },
      });

      await tx.roleAssignment.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          role: 'OWNER',
          scope: 'TENANT',
          grantedById: actorId,
          reason: 'Proprietário designado no provisionamento da instituição',
        },
      });

      return tenant.id;
    });

    await recordAudit({
      tenantId: null,
      userId: actorId,
      action: 'CREATE',
      entityType: 'Tenant',
      entityId: tenantId,
      changes: {
        slug: { from: null, to: data.slug },
        name: { from: null, to: data.name },
        plan: { from: null, to: data.plan },
        status: { from: null, to: 'ACTIVE' },
        owner: { from: null, to: data.ownerEmail },
      },
    });

    /**
     * O cache de resolução de tenant guarda o resultado NEGATIVO apenas na memória
     * do bundle que o produziu (o resolvedor passou a não cachear "não
     * encontrado" na FASE 9). A invalidação aqui é o caminho rápido para o caso em
     * que o próprio processo já resolveu esse slug antes de ele existir.
     */
    invalidateTenantCache(data.slug);

    return {
      ok: true,
      tenantId,
      slug: data.slug,
      name: data.name,
      ownerEmail: data.ownerEmail,
      ownerLinked: true,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const index = violatedIndexName(error) ?? '';

      if (index.includes('customDomain') || index.includes('custom_domain')) {
        return {
          ok: false,
          code: 'INVALID_INPUT',
          message: `O domínio "${data.customDomain}" já está vinculado a outra instituição.`,
        };
      }

      return {
        ok: false,
        code: 'SLUG_TAKEN',
        message: `O identificador "${data.slug}" já está em uso por outra instituição.`,
      };
    }

    console.error(`[platform] falha ao provisionar instituição: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível provisionar a instituição agora. Nenhuma alteração foi gravada.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ciclo de vida
// ───────────────────────────────────────────────────────────────────────────────
export interface StatusChangeResult {
  tenantId: string;
  slug: string;
  status: TenantStatus;
}

/**
 * Suspende ou reativa uma instituição.
 *
 * A suspensão corta o tráfego IMEDIATAMENTE porque quem decide isso é o estado da
 * linha, lido pelo middleware e pelos layouts a cada requisição — não um cache, não
 * um token, não uma sessão já emitida.
 */
export async function setTenantStatus(
  actorId: string,
  input: { tenantId: string; status: Extract<TenantStatus, 'ACTIVE' | 'SUSPENDED'>; reason?: string },
): Promise<PlatformResult<StatusChangeResult>> {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, slug: true, name: true, status: true, suspendedAt: true, suspensionReason: true },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const reason = input.reason?.trim() ?? '';
  const decision =
    input.status === 'SUSPENDED'
      ? evaluateSuspension({ status: tenant.status, reason })
      : evaluateReactivation(tenant.status);

  if (!decision.allowed) {
    return { ok: false, code: 'INVALID_STATE', message: decision.message ?? 'Transição não permitida.' };
  }

  const now = new Date();

  try {
    await adminPrisma.tenant.update({
      where: { id: tenant.id },
      data:
        input.status === 'SUSPENDED'
          ? { status: 'SUSPENDED', suspendedAt: now, suspensionReason: reason }
          : { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
    });
  } catch (error) {
    console.error(`[platform] falha ao mudar estado da instituição: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível alterar o estado da instituição.' };
  }

  await recordAudit({
    tenantId: null,
    userId: actorId,
    action: 'UPDATE',
    entityType: 'Tenant',
    entityId: tenant.id,
    changes: {
      status: { from: tenant.status, to: input.status },
      suspensionReason:
        input.status === 'SUSPENDED'
          ? { from: tenant.suspensionReason, to: reason }
          : { from: tenant.suspensionReason, to: null },
    },
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O CORTE NÃO DEPENDE DESTA INVALIDAÇÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *  `lookupTenant` relê o STATUS a cada resolução (ver `tenant-resolver.ts`), então
   *  a suspensão vale na requisição seguinte em qualquer bundle e em qualquer
   *  instância, com ou sem esta chamada. Foi preciso mudar o resolvedor porque o
   *  Next.js empacota Proxy, páginas e Server Actions separadamente: invalidar o
   *  cache daqui não alcançava o cache do Proxy, e a instituição suspensa
   *  continuava servindo páginas (o E2E pegou).
   *
   *  A invalidação permanece como caminho rápido: descarta também a IDENTIDADE em
   *  cache (nome, tema), para que uma mudança feita junto com o estado apareça sem
   *  esperar o TTL.
   */
  invalidateTenantCache(tenant.slug);

  return { ok: true, tenantId: tenant.id, slug: tenant.slug, status: input.status };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil público
// ───────────────────────────────────────────────────────────────────────────────
export async function updateTenantProfile(
  actorId: string,
  input: { tenantId: string } & PublicProfileInput,
): Promise<PlatformResult<{ tenantId: string; slug: string }>> {
  const validation = validatePublicProfile(input);

  if (!validation.valid || !validation.normalized) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revise os dados públicos da instituição.',
      details: validation.errors,
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: {
      id: true,
      slug: true,
      description: true,
      logoUrl: true,
      websiteUrl: true,
      isPublic: true,
    },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const profile = validation.normalized;

  try {
    await adminPrisma.tenant.update({
      where: { id: tenant.id },
      data: {
        description: profile.description,
        logoUrl: profile.logoUrl,
        websiteUrl: profile.websiteUrl,
        isPublic: profile.isPublic,
      },
    });
  } catch (error) {
    console.error(`[platform] falha ao atualizar perfil público: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar o perfil público.' };
  }

  await recordAudit({
    tenantId: null,
    userId: actorId,
    action: 'UPDATE',
    entityType: 'TenantProfile',
    entityId: tenant.id,
    changes: {
      description: { from: tenant.description, to: profile.description },
      logoUrl: { from: tenant.logoUrl, to: profile.logoUrl },
      websiteUrl: { from: tenant.websiteUrl, to: profile.websiteUrl },
      isPublic: { from: tenant.isPublic, to: profile.isPublic },
    },
  });

  // O nome/identidade resolvidos pela aplicação também vêm do cache de tenant.
  invalidateTenantCache(tenant.slug);

  return { ok: true, tenantId: tenant.id, slug: tenant.slug };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Governança de SuperAdmins
// ───────────────────────────────────────────────────────────────────────────────
export async function grantSuperAdmin(
  actorId: string,
  input: { email: string; reason?: string | null },
): Promise<PlatformResult<{ userId: string; email: string }>> {
  const email = input.email?.trim().toLowerCase() ?? '';
  const user = await findUserByEmail(email);

  if (!user) {
    return {
      ok: false,
      code: 'OWNER_NOT_FOUND',
      message: `Não existe conta com o e-mail ${email}.`,
      details: ['Peça à pessoa para criar a conta antes de receber o papel de plataforma.'],
    };
  }

  const existing = await adminPrisma.roleAssignment.findFirst({
    where: { userId: user.id, scope: 'PLATFORM', tenantId: null, revokedAt: null },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: false,
      code: 'ALREADY_OWNER',
      message: `${user.email} já é SuperAdmin da plataforma.`,
    };
  }

  try {
    await adminPrisma.roleAssignment.create({
      data: {
        tenantId: null,
        userId: user.id,
        role: 'SUPERADMIN',
        scope: 'PLATFORM',
        grantedById: actorId,
        reason: input.reason?.trim() || 'Concessão de governança da plataforma',
      },
    });
  } catch (error) {
    console.error(`[platform] falha ao conceder SUPERADMIN: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível conceder o papel de plataforma.' };
  }

  await recordAudit({
    tenantId: null,
    userId: actorId,
    action: 'PERMISSION_CHANGE',
    entityType: 'RoleAssignment',
    entityId: user.id,
    changes: { role: { from: null, to: 'SUPERADMIN' }, scope: { from: null, to: 'PLATFORM' } },
  });

  return { ok: true, userId: user.id, email: user.email };
}

/**
 * Revoga o papel de plataforma.
 *
 * O ÚLTIMO SuperAdmin não pode ser revogado: sem essa trava, um clique deixaria a
 * plataforma sem ninguém capaz de governá-la — e não haveria caminho de volta pela
 * interface. É a mesma lógica do "não remova o último owner" das instituições.
 */
export async function revokeSuperAdmin(
  actorId: string,
  userId: string,
): Promise<PlatformResult<{ userId: string; revoked: number }>> {
  const active = await adminPrisma.roleAssignment.count({
    where: { scope: 'PLATFORM', tenantId: null, revokedAt: null },
  });

  const target = await adminPrisma.roleAssignment.count({
    where: { scope: 'PLATFORM', tenantId: null, revokedAt: null, userId },
  });

  if (target === 0) {
    return { ok: false, code: 'NOT_FOUND', message: 'Esta pessoa não é SuperAdmin.' };
  }

  if (active - target < 1) {
    return {
      ok: false,
      code: 'LAST_SUPERADMIN',
      message: 'Este é o último SuperAdmin ativo: conceda o papel a outra pessoa antes de revogar.',
    };
  }

  try {
    const result = await adminPrisma.roleAssignment.updateMany({
      where: { scope: 'PLATFORM', tenantId: null, revokedAt: null, userId },
      data: { revokedAt: new Date() },
    });

    await recordAudit({
      tenantId: null,
      userId: actorId,
      action: 'PERMISSION_CHANGE',
      entityType: 'RoleAssignment',
      entityId: userId,
      changes: { revoked: { from: false, to: true }, count: { from: null, to: result.count } },
    });

    return { ok: true, userId, revoked: result.count };
  } catch (error) {
    console.error(`[platform] falha ao revogar SUPERADMIN: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível revogar o papel de plataforma.' };
  }
}

/** SuperAdmins vigentes (para a tela de governança). */
export async function listSuperAdmins(): Promise<
  { userId: string; name: string; email: string; grantedAt: Date; reason: string | null }[]
> {
  const rows = await adminPrisma.roleAssignment.findMany({
    where: { scope: 'PLATFORM', tenantId: null, revokedAt: null },
    orderBy: { grantedAt: 'asc' },
    select: { userId: true, grantedAt: true, reason: true, user: { select: { name: true, email: true } } },
  });

  return rows.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    grantedAt: row.grantedAt,
    reason: row.reason,
  }));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura para o painel
// ───────────────────────────────────────────────────────────────────────────────
export interface TenantSummaryList {
  tenants: TenantAdminRow[];
  metrics: PlatformMetrics;
}

/** Resumo do painel: instituições + métricas consolidadas. */
export async function getTenantSummaries(
  options: ListTenantsOptions = {},
): Promise<TenantSummaryList> {
  const [tenants, metrics] = await Promise.all([listTenants(options), getPlatformMetrics()]);
  return { tenants, metrics };
}

export interface TenantDetail {
  tenant: TenantAdminRow;
  slugNormalized: string;
  members: TenantMemberRow[];
}

/** Detalhe de uma instituição: dados, contadores e membros com papéis. */
export async function getTenantDetail(tenantId: string): Promise<TenantDetail | null> {
  const tenant = await findTenantById(tenantId);
  if (!tenant) return null;

  return {
    tenant,
    slugNormalized: normalizeSlug(tenant.slug),
    members: await listTenantMembers(tenantId),
  };
}

export type { TenantAdminRow, TenantMemberRow, PlatformMetrics, TenantPlan };
