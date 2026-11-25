import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  buildSpeakerPortalHref,
  computeSpeakerPortalKpis,
  resolveSpeakerPortalTab,
} from '../../src/domain/speakers/speaker-portal-rules';
import { SpeakerPortalKpiCards } from '../../src/components/speakers/speaker-portal-kpi-cards';

describe('FASE 127 · domínio do cockpit do palestrante', () => {
  it('resolve abas válidas e constrói URLs limpas sem ?aba= para visão geral', () => {
    expect(resolveSpeakerPortalTab(undefined)).toBe('visao-geral');
    expect(resolveSpeakerPortalTab('desconhecida')).toBe('visao-geral');
    expect(resolveSpeakerPortalTab('ATIVIDADES')).toBe('atividades');
    expect(resolveSpeakerPortalTab('perfil')).toBe('perfil');
    expect(resolveSpeakerPortalTab('certificados')).toBe('certificados');

    const base = '/t/ufba-demo/palestrante';
    expect(buildSpeakerPortalHref(base)).toBe(base);
    expect(buildSpeakerPortalHref(base, { aba: 'visao-geral' })).toBe(base);
    expect(buildSpeakerPortalHref(base, { aba: 'atividades' })).toBe(`${base}?aba=atividades`);
    expect(buildSpeakerPortalHref(base, { aba: 'perfil' })).toBe(`${base}?aba=perfil`);
    expect(buildSpeakerPortalHref(base, { aba: 'certificados' })).toBe(
      `${base}?aba=certificados`,
    );
  });

  it('calcula completude do perfil, materiais por visibilidade e prontidão de certificado', () => {
    const kpis = computeSpeakerPortalKpis({
      profiles: [
        {
          speakerProfileId: 'spk-1',
          bio: 'Pesquisadora em sistemas distribuídos.',
          avatarUrl: 'https://cdn.example.com/avatar.webp',
          institution: 'UFBA',
          roleTitle: 'Keynote',
          socialLinks: { linkedin: 'https://linkedin.com/in/teste' },
          isPublic: true,
          activities: [
            {
              eventSlug: 'simposio-2026',
              status: 'COMPLETED',
              workloadMinutes: 120,
              syllabus: 'Arquitetura orientada a eventos.',
              materials: [
                { visibility: 'PUBLIC', isFile: true },
                { visibility: 'ATTENDEES_ONLY', isFile: true },
                { visibility: 'PRIVATE', isFile: false },
              ],
            },
            {
              eventSlug: 'simposio-2026',
              status: 'SCHEDULED',
              workloadMinutes: 60,
              syllabus: null,
              materials: [],
            },
          ],
        },
      ],
      certificates: [
        { eligible: true, workloadMinutes: 120, certificate: null },
        {
          eligible: true,
          workloadMinutes: 60,
          certificate: { id: 'cert-1', status: 'ISSUED' },
        },
      ],
    });

    expect(kpis.profileCompleteness).toEqual({
      filledCount: 4,
      totalCount: 4,
      percent: 100,
      isComplete: true,
      hasBio: true,
      hasAvatar: true,
      hasInstitutionOrRole: true,
      hasSocialLinks: true,
      isPublic: true,
      publicProfilePath: '/eventos/simposio-2026/palestrantes/spk-1',
    });

    expect(kpis.activitiesSummary).toEqual({
      totalActivities: 2,
      totalWorkloadMinutes: 180,
      completedActivities: 1,
      withSyllabusCount: 1,
    });

    expect(kpis.materialsSummary).toEqual({
      totalMaterials: 3,
      publicCount: 1,
      attendeesOnlyCount: 1,
      privateCount: 1,
      filesCount: 2,
      linksCount: 1,
    });

    expect(kpis.certificatesSummary).toEqual({
      totalEvents: 2,
      issuedCount: 1,
      eligibleToEmitCount: 1,
      pendingCompletionCount: 0,
      totalCountedMinutes: 180,
    });
  });

  it('omite publicProfilePath quando o perfil está oculto ou sem atividade vinculada', () => {
    const kpis = computeSpeakerPortalKpis({
      profiles: [
        {
          speakerProfileId: 'spk-2',
          bio: '',
          avatarUrl: null,
          institution: null,
          roleTitle: null,
          socialLinks: {},
          isPublic: false,
          activities: [],
        },
      ],
      certificates: [],
    });

    expect(kpis.profileCompleteness.filledCount).toBe(0);
    expect(kpis.profileCompleteness.percent).toBe(0);
    expect(kpis.profileCompleteness.publicProfilePath).toBeNull();
  });
});

describe('FASE 127 · renderização SSR da faixa executiva do palestrante', () => {
  it('renderiza os 4 cartões de KPI e o link direto para a ficha pública', () => {
    const kpis = computeSpeakerPortalKpis({
      profiles: [
        {
          speakerProfileId: 'spk-1',
          bio: 'Professora adjunta.',
          avatarUrl: null,
          institution: 'UFBA',
          roleTitle: 'Instrutor(a)',
          socialLinks: {},
          isPublic: true,
          activities: [
            {
              eventSlug: 'congresso-2026',
              status: 'SCHEDULED',
              workloadMinutes: 90,
              syllabus: 'Introdução ao App Router',
              materials: [{ visibility: 'PUBLIC', isFile: false }],
            },
          ],
        },
      ],
      certificates: [{ eligible: false, workloadMinutes: 90, certificate: null }],
    });

    const html = renderToStaticMarkup(
      createElement(SpeakerPortalKpiCards, {
        tenantSlug: 'ufba-demo',
        portalHref: '/t/ufba-demo/palestrante',
        kpis,
      }),
    );

    expect(html).toContain('data-testid="speaker-portal-kpis"');
    expect(html).toContain('data-testid="speaker-kpi-profile"');
    expect(html).toContain('data-testid="speaker-kpi-activities"');
    expect(html).toContain('data-testid="speaker-kpi-materials"');
    expect(html).toContain('data-testid="speaker-kpi-certificates"');
    expect(html).toContain('data-testid="speaker-public-profile-link"');
    expect(html).toContain('/t/ufba-demo/eventos/congresso-2026/palestrantes/spk-1');
    expect(html).toContain('50%');
  });
});
