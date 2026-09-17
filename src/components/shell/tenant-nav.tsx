import {
  Award,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  Compass,
  FileText,
  Gauge,
  GraduationCap,
  Layers,
  Medal,
  Settings2,
  Sparkles,
} from 'lucide-react';

import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import type { ShellNavGroup } from '@/components/shell/app-shell';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NAVEGAÇÃO DA INSTITUIÇÃO — agrupada por intenção (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AGRUPAR, E POR QUE ESTA ORDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ordem anterior era cronológica (a ordem em que as fases entregaram cada
 *  tela). Para quem usa, a pergunta não é "o que veio primeiro", é "isto é meu, é
 *  do comitê ou é da gestão?". Os quatro grupos respondem isso:
 *
 *      1. GERAL          — onde estou e o que está acontecendo
 *      2. PARTICIPAÇÃO   — o que é meu (inscrição, trabalho, carta, certificado)
 *      3. COMITÊ         — trabalho coletivo de avaliação
 *      4. OPERAÇÃO       — o dia do evento e a administração
 *
 *  Cada item mantém a MESMA permissão que a página exige (`can()` decide). Menu e
 *  página concordando é o que evita o link que só redireciona e a tela
 *  inalcançável — divergência que já apareceu em fases anteriores.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function buildTenantNav(input: {
  tenantSlug: string;
  principal: Principal;
}): ShellNavGroup[] {
  const { tenantSlug, principal } = input;

  const allowed = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) =>
    can(principal, permission, { scope: 'TENANT' });

  const href = (path: string) => tenantPath(tenantSlug, path);

  const groups: { title: string; items: { href: string; label: string; icon: React.ReactNode; permission?: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]; exact?: boolean }[] }[] = [
    {
      title: 'Geral',
      items: [
        { href: href('/dashboard'), label: 'Painel', icon: <Gauge className="size-4" aria-hidden />, exact: true },
        {
          href: href('/eventos'),
          label: 'Eventos',
          icon: <CalendarDays className="size-4" aria-hidden />,
          permission: PERMISSIONS.EVENT_READ,
        },
      ],
    },
    {
      title: 'Minha participação',
      items: [
        {
          href: href('/minhas-inscricoes'),
          label: 'Minhas inscrições',
          icon: <ClipboardCheck className="size-4" aria-hidden />,
          permission: PERMISSIONS.REGISTRATION_READ_OWN,
        },
        {
          href: href('/submissoes'),
          label: 'Minhas submissões',
          icon: <FileText className="size-4" aria-hidden />,
          permission: PERMISSIONS.SUBMISSION_READ_OWN,
        },
        {
          href: href('/conquistas'),
          label: 'Conquistas',
          icon: <Sparkles className="size-4" aria-hidden />,
          permission: PERMISSIONS.XP_READ_OWN,
        },
        {
          href: href('/cartas'),
          label: 'Cartas',
          icon: <Layers className="size-4" aria-hidden />,
          permission: PERMISSIONS.CARD_READ_OWN,
        },
        {
          href: href('/certificados'),
          label: 'Certificados',
          icon: <Award className="size-4" aria-hidden />,
          permission: PERMISSIONS.CERTIFICATE_READ_OWN,
        },
      ],
    },
    {
      title: 'Comitê científico',
      items: [
        {
          href: href('/comite'),
          label: 'Pareceres e decisões',
          icon: <BookOpenCheck className="size-4" aria-hidden />,
          permission: PERMISSIONS.SUBMISSION_READ_ANY,
        },
        {
          href: href('/revisoes'),
          label: 'Minhas revisões',
          icon: <GraduationCap className="size-4" aria-hidden />,
          permission: PERMISSIONS.REVIEW_SUBMIT_OWN,
        },
      ],
    },
    {
      title: 'Operação',
      items: [
        {
          href: href('/credenciamento'),
          label: 'Credenciamento',
          icon: <BadgeCheck className="size-4" aria-hidden />,
          permission: PERMISSIONS.REGISTRATION_CHECKIN,
        },
        {
          href: href('/administracao'),
          label: 'Administração',
          icon: <Settings2 className="size-4" aria-hidden />,
          permission: PERMISSIONS.TENANT_MEMBER_INVITE,
        },
      ],
    },
  ];

  return groups
    .map((group) => ({
      title: group.title,
      items: group.items
        .filter((item) => (item.permission ? allowed(item.permission) : true))
        .map((item) => ({ href: item.href, label: item.label, icon: item.icon, exact: item.exact })),
    }))
    .filter((group) => group.items.length > 0);
}

/** Navegação pública da instituição (fora do shell autenticado). */
export const PUBLIC_TENANT_LINKS = [
  { path: '/eventos', label: 'Programação', icon: <CalendarDays className="size-4" aria-hidden /> },
] as const;

/** Navegação da plataforma (painel de governança). */
export function buildPlatformNav(): ShellNavGroup[] {
  return [
    {
      title: 'Governança',
      items: [
        { href: '/superadmin/metricas', label: 'Métricas', icon: <Gauge className="size-4" aria-hidden />, exact: true },
        {
          href: '/superadmin/tenants',
          label: 'Instituições',
          icon: <Layers className="size-4" aria-hidden />,
        },
        {
          href: '/superadmin/governanca',
          label: 'Governança',
          icon: <Medal className="size-4" aria-hidden />,
        },
      ],
    },
    {
      title: 'Referência',
      items: [
        {
          href: '/superadmin/design',
          label: 'Guia de estilo',
          icon: <Compass className="size-4" aria-hidden />,
        },
        {
          href: '/organizacoes',
          label: 'Diretório público',
          icon: <CalendarDays className="size-4" aria-hidden />,
        },
      ],
    },
  ];
}
