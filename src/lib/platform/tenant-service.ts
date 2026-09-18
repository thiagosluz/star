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
  evaluateMemberQuota,
  evaluateReactivation,
  evaluateSuspension,
  normalizeSlug,
  planQuotas,
  quotaWarnings,
  validatePlanChange,
  validateProvisioning,
  validatePublicProfile,
  type PlanChangeInput,
  type PlanQuotas,
  type ProvisioningInput,
  type PublicProfileInput,
  type TenantPlan,
  type TenantStatus,
} from '@/domain/platform/platform-rules';
import { ROLE_KEYS, type RoleKey } from '@/domain/rbac/permissions';
import {
  countTenantMembers,
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
  | 'ALREADY_MEMBER'
  | 'QUOTA_EXCEEDED'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'LAST_SUPERADMIN'
  | 'INTERNAL';

export type PlatformResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: PlatformErrorCode; message: string; details?: readonly string[] };

/**
 * Papéis que um vínculo de EQUIPE pode receber da plataforma.
 *
 * Derivado das chaves do RBAC, não escrito à mão: `SUPERADMIN` é de plataforma
 * (não pertence a instituição) e `PARTICIPANT` é o papel do público — concedê-lo
 * como "papel de equipe" criaria um membro que não administra nada. Um papel novo
 * no enum entra nesta lista automaticamente, e é o teste de RBAC que decide se
 * deveria.
 */
export const MEMBER_ROLES: readonly TenantMemberRole[] = ROLE_KEYS.filter(
  (role): role is TenantMemberRole => role !== 'SUPERADMIN' && role !== 'PARTICIPANT',
);

export type TenantMemberRole = Exclude<RoleKey, 'SUPERADMIN' | 'PARTICIPANT'>;

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
      const quotas = planQuotas(data.plan);

      const tenant = await tx.tenant.create({
        data: {
          slug: data.slug,
          name: data.name,
          plan: data.plan,
          status: 'ACTIVE',
          customDomain: data.customDomain,
          /**
           * ───────────────────────────────────────────────────────────────────────
           *  AS TRÊS QUOTAS VÊM DO PLANO (FASE 14)
           * ───────────────────────────────────────────────────────────────────────
           *  Antes, `maxStorageBytes` não era gravado: a coluna ficava no default do
           *  schema (5 GiB) e uma instituição ENTERPRISE nascia com armazenamento de
           *  plano gratuito — divergência silenciosa entre o que a tela mostrava e o
           *  que o plano prometia. `planQuotas` é a fonte única, e o valor informado
           *  no formulário (quando houver) tem precedência: é o override comercial.
           */
          maxEvents: data.maxEvents ?? quotas.maxEvents ?? 0,
          maxMembers: data.maxMembers ?? quotas.maxMembers ?? 0,
          maxStorageBytes: BigInt(quotas.maxStorageBytes ?? 0),
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
//  Plano e quotas (FASE 14 — item C3)
// ───────────────────────────────────────────────────────────────────────────────
export interface PlanChangeResultData {
  tenantId: string;
  slug: string;
  plan: TenantPlan;
  quotas: PlanQuotas;
  /** Quotas que ficaram abaixo do uso atual — a tela mostra antes de comemorar. */
  warnings: readonly string[];
}

/**
 * Troca o plano e/ou edita as quotas de uma instituição já provisionada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A REDUÇÃO DE QUOTA É PERMITIDA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O operador pode reduzir `maxEvents`/`maxMembers` abaixo do uso atual. Recusar
 *  seria pior: a plataforma ficaria presa entre "não posso reduzir" e "apague
 *  dados do cliente para reduzir". O que a redução faz é impedir o NOVO — e por
 *  isso o serviço devolve `warnings` descrevendo exatamente o que passou a estar
 *  bloqueado, em vez de aplicar a mudança em silêncio.
 *
 *  `useDefaults` aplica as quotas do plano escolhido; sem ele, as quotas informadas
 *  valem (vazio = ilimitado, que é `null` — não zero).
 */
export async function updateTenantPlan(
  actorId: string,
  input: { tenantId: string } & PlanChangeInput,
): Promise<PlatformResult<PlanChangeResultData>> {
  const validation = validatePlanChange(input);

  if (!validation.valid || !validation.normalized) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revise o plano e as quotas da instituição.',
      details: validation.errors,
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: {
      id: true,
      slug: true,
      plan: true,
      maxEvents: true,
      maxMembers: true,
      maxStorageBytes: true,
    },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const quotas = validation.normalized;
  const [eventCount, memberCount] = await Promise.all([
    adminPrisma.event.count({ where: { tenantId: tenant.id, deletedAt: null } }),
    countTenantMembers(tenant.id),
  ]);

  const warnings = quotaWarnings({ eventCount, memberCount, quotas });

  try {
    await adminPrisma.tenant.update({
      where: { id: tenant.id },
      data: {
        plan: quotas.plan,
        maxEvents: quotas.maxEvents ?? 0,
        maxMembers: quotas.maxMembers ?? 0,
        maxStorageBytes: BigInt(quotas.maxStorageBytes ?? 0),
      },
    });
  } catch (error) {
    console.error(`[platform] falha ao trocar plano: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar o plano agora.' };
  }

  await recordAudit({
    tenantId: null,
    userId: actorId,
    action: 'UPDATE',
    entityType: 'TenantPlan',
    entityId: tenant.id,
    changes: {
      plan: { from: tenant.plan, to: quotas.plan },
      maxEvents: { from: tenant.maxEvents, to: quotas.maxEvents },
      maxMembers: { from: tenant.maxMembers, to: quotas.maxMembers },
      // `BigInt` não é serializável em JSON: a trilha guarda número.
      maxStorageBytes: {
        from: Number(tenant.maxStorageBytes),
        to: quotas.maxStorageBytes,
      },
    },
  });

  return {
    ok: true,
    tenantId: tenant.id,
    slug: tenant.slug,
    plan: quotas.plan,
    quotas: {
      maxEvents: quotas.maxEvents,
      maxMembers: quotas.maxMembers,
      maxStorageBytes: quotas.maxStorageBytes,
    },
    warnings,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vínculo de membro da equipe (FASE 14 — item C1)
// ───────────────────────────────────────────────────────────────────────────────
export interface LinkedMember {
  userId: string;
  name: string;
  email: string;
  role: RoleKey;
  /** Slug da instituição — o painel revalida a página pública e a vitrine por ele. */
  slug: string;
  /** Contagem de membros DEPOIS do vínculo e o teto vigente. */
  memberCount: number;
  maxMembers: number | null;
}

/**
 * Vincula uma pessoa que JÁ TEM CONTA à equipe de uma instituição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE É O PONTO DE ENTRADA DA QUOTA `maxMembers`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O levantamento da FASE 14 registrou que a quota era decorativa porque "nenhum
 *  caminho conta vínculos nem recusa". Contar não bastava: era preciso um caminho
 *  de escrita que um humano possa usar — e este é ele. Antes dele, vincular alguém
 *  era SQL ou seed, e nenhuma quota pode ser aplicada a um caminho que não existe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A BUSCA POR E-MAIL FICA AQUI, E NÃO NO PAINEL DA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Procurar uma pessoa pelo e-mail é varredura da base GLOBAL de identidade. A
 *  plataforma já faz isso no provisionamento (o proprietário é designado por
 *  e-mail) e a operação é auditada; um administrador de instituição fazendo o mesmo
 *  teria um verificador de existência de contas alheias. O convite pela própria
 *  instituição existe como funcionalidade — e vai pelo caminho de convite, não por
 *  sondagem de e-mail (dívida D2, fase de Comunicação).
 *
 *  Um vínculo que era `PARTICIPANT` é PROMOVIDO a `MEMBER` (ver
 *  `membership-rules.ts`): a pessoa passa a contar na quota, porque passou a ser
 *  equipe.
 */
export async function addTenantMember(
  actorId: string,
  input: { tenantId: string; email: string; role: TenantMemberRole },
): Promise<PlatformResult<LinkedMember>> {
  const email = input.email?.trim().toLowerCase() ?? '';

  if (!email.includes('@')) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe o e-mail da pessoa que já tem conta na plataforma.',
    };
  }

  if (!MEMBER_ROLES.includes(input.role)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Papel inválido para um vínculo de equipe.',
      details: [`Papéis aceitos: ${MEMBER_ROLES.join(', ')}.`],
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, slug: true, name: true, maxMembers: true },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const user = await findUserByEmail(email);

  if (!user) {
    return {
      ok: false,
      code: 'OWNER_NOT_FOUND',
      message: `Não existe conta com o e-mail ${email}.`,
      details: [
        'A identidade é única na plataforma: a pessoa precisa criar a conta em /signup antes de ser vinculada.',
        'O convite por e-mail para quem ainda não tem conta é uma funcionalidade em desenvolvimento.',
      ],
    };
  }

  const members = await countTenantMembers(tenant.id);
  const decision = evaluateMemberQuota({ currentCount: members, maxMembers: tenant.maxMembers });

  if (!decision.allowed) {
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: decision.message ?? 'A quota de membros desta instituição está esgotada.',
      details: [
        `Membros hoje: ${members} de ${tenant.maxMembers}.`,
        'Ajuste o plano desta instituição em "Plano e quotas" antes de vincular mais alguém.',
      ],
    };
  }

  const existing = await adminPrisma.userTenantProfile.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    select: { id: true, status: true, kind: true, deletedAt: true },
  });

  if (existing && existing.kind === 'MEMBER' && existing.status === 'ACTIVE' && !existing.deletedAt) {
    return {
      ok: false,
      code: 'ALREADY_MEMBER',
      message: `${user.name} já é membro ativo desta instituição.`,
      details: ['Para mudar o papel de alguém que já é da equipe, use a concessão de papel.'],
    };
  }

  try {
    await adminPrisma.$transaction(async (tx) => {
      await tx.userTenantProfile.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          status: 'ACTIVE',
          kind: 'MEMBER',
          joinedAt: new Date(),
          invitedById: actorId,
          invitedAt: new Date(),
        },
        // Promoção explícita: participante vinculado à equipe passa a MEMBER.
        update: { status: 'ACTIVE', kind: 'MEMBER', deletedAt: null, joinedAt: new Date() },
      });

      const live = await tx.roleAssignment.findFirst({
        where: {
          tenantId: tenant.id,
          userId: user.id,
          role: input.role,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      });

      if (!live) {
        await tx.roleAssignment.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            role: input.role,
            scope: 'TENANT',
            grantedById: actorId,
            reason: 'Vínculo de equipe registrado pela plataforma',
          },
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'ALREADY_MEMBER',
        message: `${user.name} já é membro ativo desta instituição.`,
      };
    }

    console.error(`[platform] falha ao vincular membro: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível vincular a pessoa agora. Nenhuma alteração foi gravada.',
    };
  }

  await recordAudit({
    tenantId: null,
    userId: actorId,
    action: 'PERMISSION_CHANGE',
    entityType: 'TenantMember',
    entityId: user.id,
    changes: {
      tenant: { from: null, to: tenant.slug },
      email: { from: null, to: user.email },
      role: { from: null, to: input.role },
      kind: { from: existing?.kind ?? null, to: 'MEMBER' },
    },
  });

  return {
    ok: true,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: input.role,
    slug: tenant.slug,
    memberCount: members + (existing && existing.kind === 'MEMBER' ? 0 : 1),
    maxMembers: tenant.maxMembers,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Governança de SuperAdmins// ───────────────────────────────────────────────────────────────────────────────
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
