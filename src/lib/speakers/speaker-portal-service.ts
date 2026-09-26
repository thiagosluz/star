/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Portal do palestrante (FASE 25, itens E19 e E21)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FRONTEIRA DE SEGURANÇA DESTE ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Toda leitura filtra por `userId` e toda escrita CONFERE A POSSE com o dado do
 *  banco, nunca com o que o formulário mandou. Um `speakerProfileId` recebido da tela
 *  é apenas uma pergunta ("é este?"); a resposta vem do `userId` gravado no perfil.
 *
 *  São dois vínculos possíveis, e os dois contam (ver `isSpeakerOfActivity`):
 *    • `activity_speakers.userId` — a pessoa foi cadastrada já com conta;
 *    • `speaker_profiles.userId`  — ela reivindicou o perfil depois.
 *
 *  Tentar editar perfil ou material de terceiro devolve `FORBIDDEN` — e a rota HTTP
 *  de download traduz isso em `403`, que é onde "Forbidden" é literal.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit, diffFields } from '@/lib/admin/audit';
import {
  computeSpeakerWorkload,
  evaluateClaim,
  hashInviteToken,
  isInviteExpired,
  normalizeInviteToken,
  normalizeSpeakerProfile,
  readSocialLinks,
  type ClaimRefusalCode,
  type MaterialVisibility,
  type SocialLinks,
  type SpeakerAvatarSource,
  type SpeakerWorkloadResult,
} from '@/domain/speakers/speaker-rules';
import { attachSpeakerAccount } from '@/lib/speakers/speaker-service';

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura do painel
// ───────────────────────────────────────────────────────────────────────────────
export interface PortalMaterial {
  id: string;
  title: string;
  kind: string;
  visibility: MaterialVisibility;
  isFile: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}

export interface PortalActivity {
  linkId: string;
  activityId: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventEndsAt: Date;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  roleTitle: string | null;
  isKeynote: boolean;
  workloadMinutes: number;
  syllabus: string | null;
  requirements: string | null;
  bibliography: string | null;
  materials: PortalMaterial[];
}

export interface PortalProfile {
  speakerProfileId: string;
  name: string;
  email: string | null;
  institution: string | null;
  company: string | null;
  roleTitle: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Quem enviou a foto publicada (FASE 46) — o portal avisa quando não foi a pessoa. */
  avatarSource: SpeakerAvatarSource | null;
  socialLinks: SocialLinks;
  isConfirmed: boolean;
  isPublic: boolean;
  activities: PortalActivity[];
  workload: SpeakerWorkloadResult;
}

export interface PendingInvite {
  speakerProfileId: string;
  name: string;
  email: string | null;
  institution: string | null;
  hasValidToken: boolean;
  inviteExpiresAt: Date | null;
  activities: { activityId: string; title: string; eventTitle: string }[];
}

/**
 * O que faz um convite estar PENDENTE para esta conta.
 *
 * Três condições, e as três são necessárias:
 *   • `userId` nulo — ninguém assumiu o perfil ainda;
 *   • `inviteTokenHash` gravado — existe um convite (e não um perfil criado à mão);
 *   • e-mail do perfil igual ao da conta logada — é o endereço que a organização
 *     cadastrou, e é ele que diz de quem é o convite.
 *
 * O aceite ZERA o hash e preenche o `userId` (`attachSpeakerAccount`), então o convite
 * deixa de ser pendente exatamente quando deixa de existir. Não há estado a limpar.
 */
function pendingInviteWhere(tenantId: string, userEmail: string) {
  return {
    tenantId,
    deletedAt: null,
    userId: null,
    inviteTokenHash: { not: null },
    email: userEmail.trim().toLowerCase(),
  };
}

/**
 * Convites pendentes endereçados ao e-mail desta conta.
 *
 * A MESMA resposta serve a dois lugares que antes discordavam: a lista "Convites para
 * você" do portal e a porta de entrada de quem ainda não é palestrante (o papel
 * `SPEAKER` nasce com o aceite, então exigir o papel para chegar ao convite era um
 * impasse). Por isso a consulta vive aqui, e não dentro do carregamento do painel.
 */
async function queryPendingInvites(
  tx: TxClient,
  input: { tenantId: string; userEmail: string; now: Date },
): Promise<PendingInvite[]> {
  const rows = await tx.speakerProfile.findMany({
    where: pendingInviteWhere(input.tenantId, input.userEmail),
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: {
      id: true,
      name: true,
      email: true,
      institution: true,
      inviteTokenHash: true,
      inviteExpiresAt: true,
      activityLinks: {
        select: {
          activityId: true,
          activity: { select: { title: true, event: { select: { title: true } } } },
        },
      },
    },
  });

  return rows.map((row) => ({
    speakerProfileId: row.id,
    name: row.name,
    email: row.email,
    institution: row.institution,
    /**
     * `hasValidToken` é o que a TELA mostra ("convite expirado" x "convite válido") e o
     * que o aceite vai recusar. Um convite vencido continua PENDENTE de propósito: a
     * pessoa precisa ver que ele existiu e pedir outro à organização — sumir com o
     * convite vencido deixaria o palestrante sem entender por que não foi convidado.
     */
    hasValidToken: row.inviteTokenHash !== null && !isInviteExpired(row.inviteExpiresAt, input.now),
    inviteExpiresAt: row.inviteExpiresAt,
    activities: row.activityLinks
      .filter((link) => link.activity !== null)
      .map((link) => ({
        activityId: link.activityId,
        title: link.activity!.title,
        eventTitle: link.activity!.event?.title ?? 'Evento',
      })),
  }));
}

/** Convites pendentes desta conta (usa a própria transação). */
export async function loadSpeakerPendingInvites(input: {
  tenantId: string;
  userEmail: string;
  now?: Date;
}): Promise<PendingInvite[]> {
  return withTenant(input.tenantId, (tx) =>
    queryPendingInvites(tx, { ...input, now: input.now ?? new Date() }),
  );
}

/**
 * Existe convite pendente para este e-mail?
 *
 * Versão barata da pergunta acima, para quem só precisa decidir uma PORTA (o item do
 * menu e a guarda do portal): não carrega atividades nem monta objeto nenhum.
 */
export async function hasPendingSpeakerInvite(input: {
  tenantId: string;
  userEmail: string;
}): Promise<boolean> {
  return withTenant(input.tenantId, async (tx) => {
    const row = await tx.speakerProfile.findFirst({
      where: pendingInviteWhere(input.tenantId, input.userEmail),
      select: { id: true },
    });

    return row !== null;
  });
}

export interface SpeakerCertificateStatus {
  eventId: string;
  eventTitle: string;
  eventEndsAt: Date;
  workloadMinutes: number;
  countedActivities: number;
  excludedActivities: number;
  /** Detalhamento por atividade: o que entrou e o que ficou de fora, com o motivo. */
  breakdown: { activityId: string; title: string; minutes: number; counted: boolean; reason: string | null }[];
  eventFinished: boolean;
  checkedIn: boolean;
  eligible: boolean;
  reason: string;
  certificate: { id: string; status: string; validationCode: string } | null;
}

export interface SpeakerPortalData {
  profiles: PortalProfile[];
  pendingInvites: PendingInvite[];
  /** A pessoa não consta como palestrante em lugar nenhum (tela explicativa). */
  isEmpty: boolean;
  certificates: SpeakerCertificateStatus[];
}

/**
 * Carrega tudo o que o portal mostra.
 *
 * `now` é parâmetro (e não `new Date()` interno) porque a apuração de carga horária e
 * a elegibilidade do certificado dependem do relógio: em teste, o mesmo conjunto de
 * dados precisa poder ser avaliado "durante" e "depois" do evento.
 */
export async function loadSpeakerPortal(input: {
  tenantId: string;
  userId: string;
  userEmail: string;
  now?: Date;
}): Promise<SpeakerPortalData> {
  const now = input.now ?? new Date();

  return withTenant(input.tenantId, async (tx) => {
    const profiles = await tx.speakerProfile.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        institution: true,
        company: true,
        roleTitle: true,
        bio: true,
        avatarUrl: true,
        avatarSource: true,
        socialLinks: true,
        isConfirmed: true,
        isPublic: true,
        activityLinks: {
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            activityId: true,
            roleTitle: true,
            isKeynote: true,
            workloadMinutes: true,
            syllabus: true,
            requirements: true,
            bibliography: true,
            activity: {
              select: {
                title: true,
                startsAt: true,
                endsAt: true,
                status: true,
                workloadMinutes: true,
                eventId: true,
                event: { select: { title: true, slug: true, endsAt: true } },
              },
            },
            speakerProfile: { select: { materials: { where: { deletedAt: null } } } },
          },
        },
      },
    });

    const portalProfiles: PortalProfile[] = profiles.map((profile) => {
      const activities: PortalActivity[] = profile.activityLinks
        .filter((link) => link.activity !== null)
        .map((link) => ({
          linkId: link.id,
          activityId: link.activityId,
          eventId: link.activity!.eventId,
          eventTitle: link.activity!.event?.title ?? 'Evento',
          eventSlug: link.activity!.event?.slug ?? '',
          eventEndsAt: link.activity!.event?.endsAt ?? link.activity!.endsAt,
          title: link.activity!.title,
          startsAt: link.activity!.startsAt,
          endsAt: link.activity!.endsAt,
          status: link.activity!.status,
          roleTitle: link.roleTitle,
          isKeynote: link.isKeynote,
          workloadMinutes: link.workloadMinutes ?? link.activity!.workloadMinutes,
          syllabus: link.syllabus,
          requirements: link.requirements,
          bibliography: link.bibliography,
          materials: (link.speakerProfile?.materials ?? [])
            .filter((material) => material.activityId === link.activityId)
            .map((material) => ({
              id: material.id,
              title: material.title,
              kind: material.kind,
              visibility: material.visibility as MaterialVisibility,
              isFile: material.storageKey !== null,
              fileName: material.fileName,
              sizeBytes: material.sizeBytes,
              createdAt: material.createdAt,
            })),
        }));

      const workload = computeSpeakerWorkload(
        activities.map((activity) => ({
          activityId: activity.activityId,
          activityTitle: activity.title,
          activityStatus: activity.status,
          startsAt: activity.startsAt,
          endsAt: activity.endsAt,
          activityWorkloadMinutes: activity.workloadMinutes,
          declaredWorkloadMinutes: null,
        })),
        now,
      );

      return {
        speakerProfileId: profile.id,
        name: profile.name,
        email: profile.email,
        institution: profile.institution,
        company: profile.company,
        roleTitle: profile.roleTitle,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        avatarSource: profile.avatarSource,
        socialLinks: readSocialLinks(profile.socialLinks),
        isConfirmed: profile.isConfirmed,
        isPublic: profile.isPublic,
        activities,
        workload,
      };
    });

    const pendingInvites = await queryPendingInvites(tx, {
      tenantId: input.tenantId,
      userEmail: input.userEmail,
      now,
    });

    const certificates = await loadSpeakerCertificateStatus(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      now,
      profiles: portalProfiles,
    });

    return {
      profiles: portalProfiles,
      pendingInvites,
      isEmpty: portalProfiles.length === 0 && pendingInvites.length === 0,
      certificates,
    };
  });
}

/**
 * Situação do certificado de palestrante, por evento.
 *
 * Os fatos vêm das MESMAS fontes que a emissão consulta (credenciamento no evento e
 * carga apurada), para que a tela nunca diga "pode emitir" e o servidor recuse — a
 * divergência entre promessa e regra é o defeito mais caro de uma tela de certificado.
 */
async function loadSpeakerCertificateStatus(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    now: Date;
    profiles: readonly PortalProfile[];
  },
): Promise<SpeakerCertificateStatus[]> {
  const byEvent = new Map<string, { eventId: string; eventTitle: string; eventEndsAt: Date; activities: PortalProfile['activities'] }>();

  for (const profile of input.profiles) {
    for (const activity of profile.activities) {
      const entry = byEvent.get(activity.eventId) ?? {
        eventId: activity.eventId,
        eventTitle: activity.eventTitle,
        eventEndsAt: activity.eventEndsAt,
        activities: [],
      };
      entry.activities.push(activity);
      byEvent.set(activity.eventId, entry);
    }
  }

  if (byEvent.size === 0) return [];

  const eventIds = [...byEvent.keys()];

  const [registrations, certificates] = await Promise.all([
    tx.registration.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, eventId: { in: eventIds }, deletedAt: null },
      select: { eventId: true, checkedInAt: true },
    }),
    tx.certificate.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, eventId: { in: eventIds }, kind: 'SPEAKER' },
      select: { id: true, eventId: true, status: true, validationCode: true, revokedAt: true },
    }),
  ]);

  const checkedInEvents = new Set(
    registrations.filter((row) => row.checkedInAt !== null).map((row) => row.eventId),
  );

  const statuses: SpeakerCertificateStatus[] = [];

  for (const [eventId, entry] of byEvent) {
    const workload = computeSpeakerWorkload(
      entry.activities.map((activity) => ({
        activityId: activity.activityId,
        activityTitle: activity.title,
        activityStatus: activity.status,
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        activityWorkloadMinutes: activity.workloadMinutes,
        declaredWorkloadMinutes: null,
      })),
      input.now,
    );

    const eventFinished = entry.eventEndsAt.getTime() <= input.now.getTime();
    const checkedIn = checkedInEvents.has(eventId);

    const reason = !eventFinished
      ? 'O certificado é emitido após o término do evento.'
      : !checkedIn
        ? 'Falta o credenciamento no evento — procure a organização no local.'
        : workload.countedActivities === 0
          ? 'Nenhuma atividade ministrada entrou na apuração.'
          : 'Você já pode emitir seu certificado de palestrante.';

    const certificate = certificates.find((row) => row.eventId === eventId && row.revokedAt === null) ?? null;

    statuses.push({
      eventId,
      eventTitle: entry.eventTitle,
      eventEndsAt: entry.eventEndsAt,
      workloadMinutes: workload.totalMinutes,
      countedActivities: workload.countedActivities,
      excludedActivities: workload.excludedActivities,
      breakdown: workload.entries.map((entry) => ({
        activityId: entry.activityId,
        title: entry.activityTitle,
        minutes: entry.minutes,
        counted: entry.counted,
        reason: entry.reason,
      })),
      eventFinished,
      checkedIn,
      eligible: eventFinished && checkedIn && workload.countedActivities > 0,
      reason,
      certificate: certificate
        ? { id: certificate.id, status: certificate.status, validationCode: certificate.validationCode }
        : null,
    });
  }

  return statuses.sort((a, b) => b.eventEndsAt.getTime() - a.eventEndsAt.getTime());
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita — sempre com posse conferida
// ───────────────────────────────────────────────────────────────────────────────
export type PortalErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'INTERNAL';

export type PortalResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: PortalErrorCode; message: string; details?: readonly string[] };

/** Perfis reivindicados por esta pessoa (a base de toda checagem de posse). */
export async function claimedProfileIds(
  tenantId: string,
  userId: string,
): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.speakerProfile.findMany({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  });
}

export async function updateMySpeakerProfile(input: {
  tenantId: string;
  userId: string;
  speakerProfileId: string;
  name: string;
  email?: string | null;
  institution?: string | null;
  company?: string | null;
  roleTitle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  socialLinks?: Record<string, unknown>;
}): Promise<PortalResult<{ speakerProfileId: string }>> {
  const normalization = normalizeSpeakerProfile({
    name: input.name,
    email: input.email,
    institution: input.institution,
    company: input.company,
    roleTitle: input.roleTitle,
    bio: input.bio,
    socialLinks: input.socialLinks,
  });

  if (!normalization.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: normalization.errors[0]!, details: normalization.errors };
  }

  const draft = normalization.draft;

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const profile = await tx.speakerProfile.findFirst({
        where: { id: input.speakerProfileId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          userId: true,
          name: true,
          email: true,
          institution: true,
          company: true,
          roleTitle: true,
          bio: true,
          avatarUrl: true,
          avatarSource: true,
          isConfirmed: true,
        },
      });

      if (!profile) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Perfil não encontrado.' };
      }

      /**
       * A POSSE É CONFERIDA AQUI, com o `userId` do BANCO. O serviço não recebe
       * "dono" do formulário: se o perfil não aponta para esta conta, a resposta é
       * `FORBIDDEN` mesmo que o id esteja certo.
       */
      if (profile.userId !== input.userId) {
        return {
          ok: false as const,
          code: 'FORBIDDEN' as const,
          message: 'Este perfil de palestrante pertence a outra conta.',
        };
      }

      const nextAvatarUrl =
        input.avatarUrl === undefined ? profile.avatarUrl : input.avatarUrl?.trim() || null;

      const data = {
        name: draft.name,
        // O e-mail só é atualizável enquanto é ele que identifica a pessoa no
        // convite; depois do vínculo, quem manda é o e-mail da conta.
        email: draft.email,
        institution: draft.institution,
        company: draft.company,
        roleTitle: draft.roleTitle,
        bio: draft.bio,
        /**
         * A foto é gravada pelo SERVIDOR a partir do upload confirmado: o campo
         * escondido do formulário só carrega a URL que a esteira devolveu, e ela
         * passa pela mesma validação de imagem da capa do evento.
         *
         * ─────────────────────────────────────────────────────────────────────────────
         *  AUSENTE PRESERVA; VAZIO REMOVE (FASE 46)
         * ─────────────────────────────────────────────────────────────────────────────
         *  São duas situações diferentes e ambas existem: um formulário que não traz o
         *  campo (nada a decidir) e a pessoa que clicou em "Remover foto" (que manda o
         *  campo vazio de propósito). Antes da FASE 46 as duas faziam a mesma coisa, e
         *  era impossível TIRAR uma foto publicada — só trocá-la por outra.
         *
         *  Quem enviou também é gravado: a origem volta a ser `SPEAKER` sempre que a
         *  URL muda por aqui, porque foi a própria pessoa que subiu.
         */
        avatarUrl: nextAvatarUrl,
        avatarSource:
          nextAvatarUrl === profile.avatarUrl
            ? profile.avatarSource
            : nextAvatarUrl === null
              ? null
              : 'SPEAKER',
        socialLinks: draft.socialLinks as unknown as object,
        isConfirmed: true,
      };

      await tx.speakerProfile.update({ where: { id: profile.id }, data });

      /**
       * O nome novo é propagado para os vínculos: a agenda, a lista de presença e o
       * certificado leem `guestName`, e um palestrante que corrige o próprio nome no
       * portal não pode continuar aparecendo com o nome antigo na programação.
       */
      await tx.activitySpeaker.updateMany({
        where: { tenantId: input.tenantId, speakerProfileId: profile.id },
        data: { guestName: draft.name, guestEmail: draft.email, guestInstitution: draft.institution, guestBio: draft.bio },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'speakerProfile',
          entityId: profile.id,
          changes: diffFields(
            {
              name: profile.name,
              email: profile.email,
              institution: profile.institution,
              company: profile.company,
              roleTitle: profile.roleTitle,
              bio: profile.bio,
            },
            { name: data.name, email: data.email, institution: data.institution, company: data.company, roleTitle: data.roleTitle, bio: data.bio },
            ['name', 'email', 'institution', 'company', 'roleTitle', 'bio'],
          ),
        },
        tx,
      );

      return { ok: true as const, speakerProfileId: profile.id };
    });
  } catch (error) {
    console.error(`[speakers] falha ao atualizar perfil próprio: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar seu perfil.' };
  }
}

/**
 * Ementa, requisitos e bibliografia de UMA atividade.
 *
 * São propostas ATRIBUÍDAS: ficam no vínculo (palestrante × atividade), e não na
 * atividade. Dois ministrantes do mesmo minicurso não sobrescrevem o texto um do
 * outro, e a página pública pode creditar quem escreveu.
 */
export async function updateSpeakerNotes(input: {
  tenantId: string;
  userId: string;
  linkId: string;
  syllabus?: string | null;
  requirements?: string | null;
  bibliography?: string | null;
}): Promise<PortalResult<{ linkId: string }>> {
  const limit = (value: string | null | undefined): string | null => {
    const text = value?.trim() ?? '';
    return text.length > 0 ? text.slice(0, 6000) : null;
  };

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const link = await tx.activitySpeaker.findFirst({
        where: { id: input.linkId, tenantId: input.tenantId },
        select: {
          id: true,
          userId: true,
          speakerProfileId: true,
          syllabus: true,
          requirements: true,
          bibliography: true,
          activityId: true,
        },
      });

      if (!link) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Vínculo não encontrado.' };
      }

      const owns = await tx.speakerProfile.findFirst({
        where: { tenantId: input.tenantId, userId: input.userId, id: link.speakerProfileId ?? undefined },
        select: { id: true },
      });

      if (link.userId !== input.userId && owns === null) {
        return {
          ok: false as const,
          code: 'FORBIDDEN' as const,
          message: 'Você não é ministrante desta atividade.',
        };
      }

      const data = {
        syllabus: limit(input.syllabus),
        requirements: limit(input.requirements),
        bibliography: limit(input.bibliography),
      };

      await tx.activitySpeaker.update({ where: { id: link.id }, data });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'activitySpeaker',
          entityId: link.id,
          changes: {
            ementa: { from: link.syllabus ? 'preenchida' : null, to: data.syllabus ? 'preenchida' : null },
            requisitos: { from: link.requirements ? 'preenchidos' : null, to: data.requirements ? 'preenchidos' : null },
            bibliografia: { from: link.bibliography ? 'preenchida' : null, to: data.bibliography ? 'preenchida' : null },
          },
        },
        tx,
      );

      return { ok: true as const, linkId: link.id };
    });
  } catch (error) {
    console.error(`[speakers] falha ao salvar ementa: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar o conteúdo da atividade.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Reivindicação
// ───────────────────────────────────────────────────────────────────────────────
export interface ClaimInput {
  tenantId: string;
  userId: string;
  userEmail: string;
  /** Perfil indicado pelo painel (lista de convites). */
  speakerProfileId?: string;
  /** Código digitado/colado. */
  token?: string | null;
  now?: Date;
}

/**
 * Reivindica um perfil: dois caminhos, uma função.
 *
 * Sem `speakerProfileId`, o token identifica o perfil (é o caso do link entregue pelo
 * organizador); com ele, o caminho é a lista do painel e o e-mail é a identidade.
 */
export async function claimSpeakerProfile(
  input: ClaimInput,
): Promise<PortalResult<{ speakerProfileId: string; attachedActivities: number }>> {
  const now = input.now ?? new Date();
  const token = input.token ? normalizeInviteToken(input.token) : null;

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const profile = await tx.speakerProfile.findFirst({
        where: {
          tenantId: input.tenantId,
          deletedAt: null,
          ...(input.speakerProfileId
            ? { id: input.speakerProfileId }
            : token
              ? { inviteTokenHash: hashInviteToken(token) }
              : { id: '__none__' }),
        },
        select: {
          id: true,
          email: true,
          userId: true,
          inviteTokenHash: true,
          inviteExpiresAt: true,
        },
      });

      if (!profile) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: token
            ? 'Convite não encontrado. Confira o código ou peça um novo à organização.'
            : 'Convite não encontrado.',
        };
      }

      const verdict = evaluateClaim({
        profile: {
          email: profile.email,
          userId: profile.userId,
          inviteTokenHash: profile.inviteTokenHash,
          inviteExpiresAt: profile.inviteExpiresAt,
        },
        token,
        userEmail: input.userEmail,
        userId: input.userId,
        now,
      });

      if (!verdict.ok) {
        return {
          ok: false as const,
          code: claimErrorCode(verdict.code),
          message: verdict.message,
        };
      }

      const activities = await tx.activitySpeaker.count({
        where: { tenantId: input.tenantId, speakerProfileId: profile.id },
      });

      await attachSpeakerAccount(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        speakerProfileId: profile.id,
        updateEmailTo: verdict.updateEmailTo,
        actorId: input.userId,
      });

      return { ok: true as const, speakerProfileId: profile.id, attachedActivities: activities };
    });
  } catch (error) {
    console.error(`[speakers] falha ao reivindicar perfil: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível aceitar o convite.' };
  }
}

function claimErrorCode(code: ClaimRefusalCode): PortalErrorCode {
  switch (code) {
    case 'INVALID_TOKEN':
    case 'EXPIRED':
      return 'INVALID_INPUT';
    case 'ALREADY_CLAIMED':
    case 'EMAIL_MISMATCH':
    case 'NO_EMAIL':
      return 'FORBIDDEN';
    default:
      return 'INVALID_INPUT';
  }
}
