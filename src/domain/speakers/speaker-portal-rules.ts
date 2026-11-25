/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — COCKPIT DO PALESTRANTE POR INTENÇÃO E KPIs (FASE 127)
 *
 *  Regras puras (sem Prisma nem Next) para:
 *    1. Navegação por abas de intenção (`?aba=visao-geral|atividades|perfil|certificados`);
 *    2. Projeção executiva de completude do perfil, atividades/ementas, materiais
 *       de apoio por visibilidade e prontidão do certificado;
 *    3. Formatação segura de janela da atividade no fuso do evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { MaterialVisibility, SocialLinks } from '@/domain/speakers/speaker-rules';

export const SPEAKER_PORTAL_TABS = [
  'visao-geral',
  'atividades',
  'perfil',
  'certificados',
] as const;

export type SpeakerPortalTab = (typeof SPEAKER_PORTAL_TABS)[number];

export const SPEAKER_PORTAL_TAB_LABELS: Record<SpeakerPortalTab, string> = {
  'visao-geral': 'Visão geral',
  atividades: 'Atividades & materiais',
  perfil: 'Meu perfil público',
  certificados: 'Certificados',
};

const VALID_TABS = new Set<string>(SPEAKER_PORTAL_TABS);

export function resolveSpeakerPortalTab(rawTab?: string | null): SpeakerPortalTab {
  const normalized = (rawTab ?? '').trim().toLowerCase();
  return VALID_TABS.has(normalized) ? (normalized as SpeakerPortalTab) : 'visao-geral';
}

export function buildSpeakerPortalHref(
  baseHref: string,
  params?: { aba?: SpeakerPortalTab | null },
): string {
  if (!params?.aba || params.aba === 'visao-geral') {
    return baseHref;
  }
  const search = new URLSearchParams();
  search.set('aba', params.aba);
  return `${baseHref}?${search.toString()}`;
}

export interface SpeakerPortalKpiProfileInput {
  speakerProfileId: string;
  bio: string | null;
  avatarUrl: string | null;
  institution: string | null;
  roleTitle: string | null;
  socialLinks: SocialLinks;
  isPublic: boolean;
  activities: readonly {
    eventSlug: string;
    status: string;
    workloadMinutes: number;
    syllabus: string | null;
    materials: readonly {
      visibility: MaterialVisibility;
      isFile: boolean;
    }[];
  }[];
}

export interface SpeakerPortalKpiCertificateInput {
  eligible: boolean;
  workloadMinutes: number;
  certificate: { id: string; status: string } | null;
}

export interface SpeakerPortalKpis {
  profileCompleteness: {
    filledCount: number;
    totalCount: number;
    percent: number;
    isComplete: boolean;
    hasBio: boolean;
    hasAvatar: boolean;
    hasInstitutionOrRole: boolean;
    hasSocialLinks: boolean;
    isPublic: boolean;
    publicProfilePath: string | null;
  };
  activitiesSummary: {
    totalActivities: number;
    totalWorkloadMinutes: number;
    completedActivities: number;
    withSyllabusCount: number;
  };
  materialsSummary: {
    totalMaterials: number;
    publicCount: number;
    attendeesOnlyCount: number;
    privateCount: number;
    filesCount: number;
    linksCount: number;
  };
  certificatesSummary: {
    totalEvents: number;
    issuedCount: number;
    eligibleToEmitCount: number;
    pendingCompletionCount: number;
    totalCountedMinutes: number;
  };
}

export function computeSpeakerPortalKpis(input: {
  profiles: readonly SpeakerPortalKpiProfileInput[];
  certificates: readonly SpeakerPortalKpiCertificateInput[];
}): SpeakerPortalKpis {
  const primary = input.profiles[0] ?? null;

  const hasBio = Boolean(primary?.bio && primary.bio.trim().length > 0);
  const hasAvatar = Boolean(primary?.avatarUrl && primary.avatarUrl.trim().length > 0);
  const hasInstitutionOrRole = Boolean(
    (primary?.institution && primary.institution.trim().length > 0) ||
      (primary?.roleTitle && primary.roleTitle.trim().length > 0),
  );
  const hasSocialLinks = primary
    ? Object.values(primary.socialLinks).some((v) => typeof v === 'string' && v.trim().length > 0)
    : false;

  const filledCount =
    (hasBio ? 1 : 0) +
    (hasAvatar ? 1 : 0) +
    (hasInstitutionOrRole ? 1 : 0) +
    (hasSocialLinks ? 1 : 0);
  const totalCount = 4;
  const percent = Math.round((filledCount / totalCount) * 100);

  const firstEventSlug = primary?.activities[0]?.eventSlug?.trim() ?? '';
  const publicProfilePath =
    primary && primary.isPublic && firstEventSlug.length > 0
      ? `/eventos/${firstEventSlug}/palestrantes/${primary.speakerProfileId}`
      : null;

  let totalActivities = 0;
  let totalWorkloadMinutes = 0;
  let completedActivities = 0;
  let withSyllabusCount = 0;

  let totalMaterials = 0;
  let publicCount = 0;
  let attendeesOnlyCount = 0;
  let privateCount = 0;
  let filesCount = 0;
  let linksCount = 0;

  for (const profile of input.profiles) {
    for (const activity of profile.activities) {
      totalActivities += 1;
      totalWorkloadMinutes += Math.max(0, activity.workloadMinutes);
      if (activity.status === 'COMPLETED') completedActivities += 1;
      if (activity.syllabus && activity.syllabus.trim().length > 0) {
        withSyllabusCount += 1;
      }

      for (const material of activity.materials) {
        totalMaterials += 1;
        if (material.visibility === 'PUBLIC') publicCount += 1;
        else if (material.visibility === 'ATTENDEES_ONLY') attendeesOnlyCount += 1;
        else privateCount += 1;

        if (material.isFile) filesCount += 1;
        else linksCount += 1;
      }
    }
  }

  let issuedCount = 0;
  let eligibleToEmitCount = 0;
  let pendingCompletionCount = 0;
  let totalCountedMinutes = 0;

  for (const cert of input.certificates) {
    totalCountedMinutes += Math.max(0, cert.workloadMinutes);
    if (cert.certificate) {
      issuedCount += 1;
    } else if (cert.eligible) {
      eligibleToEmitCount += 1;
    } else {
      pendingCompletionCount += 1;
    }
  }

  return {
    profileCompleteness: {
      filledCount,
      totalCount,
      percent,
      isComplete: filledCount === totalCount,
      hasBio,
      hasAvatar,
      hasInstitutionOrRole,
      hasSocialLinks,
      isPublic: Boolean(primary?.isPublic),
      publicProfilePath,
    },
    activitiesSummary: {
      totalActivities,
      totalWorkloadMinutes,
      completedActivities,
      withSyllabusCount,
    },
    materialsSummary: {
      totalMaterials,
      publicCount,
      attendeesOnlyCount,
      privateCount,
      filesCount,
      linksCount,
    },
    certificatesSummary: {
      totalEvents: input.certificates.length,
      issuedCount,
      eligibleToEmitCount,
      pendingCompletionCount,
      totalCountedMinutes,
    },
  };
}
