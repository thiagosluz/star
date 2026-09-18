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
  Mic,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';

import { can, holdsPermission, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS, type RoleScope } from '@/domain/rbac/permissions';
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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PERMISSÃO `:own` NÃO SE DECIDE POR ESCOPO (FASE 25, revisão)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este arquivo chamava `can(principal, permissão, { scope: 'TENANT' })` para TUDO —
 *  inclusive para as permissões pessoais (`registration:read:own`, `xp:read:own`,
 *  `speaker:profile:update:own`…). Só que `can()` recusa uma permissão `:own` sem
 *  `ownerId` (fail-closed, invariante nº 4), e o menu nunca passava dono nenhum: o
 *  grupo inteiro "Minha participação" era descartado para TODO MUNDO, com qualquer
 *  papel. O sintoma não era erro nenhum — era o silêncio: o palestrante entrava no
 *  painel e não tinha como chegar ao próprio portal, porque a única porta era
 *  digitar a URL.
 *
 *  A pergunta certa para um item pessoal é "esta pessoa PODE ter isto?" — a mesma de
 *  `requirePersonalPage`, que usa `holdsPermission` (a posse é conferida depois, no
 *  dado, por cada consulta e cada escrita). Menu e página voltam a usar o mesmo
 *  predicado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function buildTenantNav(input: {
  tenantSlug: string;
  principal: Principal;
  /**
   * Existe convite de palestrante pendente para o e-mail desta conta? (revisão da
   * FASE 25)
   *
   * Quem foi convidado e ainda NÃO assumiu o perfil não tem o papel `SPEAKER` — o
   * papel nasce com o aceite —, então sem este sinal o convite ficaria invisível
   * exatamente para quem precisa aceitá-lo.
   */
  hasPendingSpeakerInvite?: boolean;
}): ShellNavGroup[] {
  const { tenantSlug, principal, hasPendingSpeakerInvite = false } = input;

  /**
   * O predicado do item, escolhido pelo TIPO da permissão.
   *
   * Institucional (ex.: `event:read`, `tenant:member:invite`): vale para a instituição
   * inteira, então o alvo é o tenant. Pessoal (`:own`): vale onde a pessoa é dona — e
   * `can()` com alvo de tenant a recusaria sempre, porque permissão `:own` sem dono é
   * negação (fail-closed). A posse concreta é conferida no dado, por cada consulta e
   * cada escrita; aqui só se decide se o link PODE existir.
   *
   * `scopes` existe para o item cuja PÁGINA aceita mais de um escopo: o credenciamento
   * autoriza equipe do dia, concedida por EVENTO (`requirePagePermission` com
   * `allowedScopes: ['TENANT', 'EVENT']`). Item e página precisam concordar nos DOIS
   * sentidos — esconder o link de quem pode abrir a tela é o mesmo defeito, invertido.
   */
  const allowedFor = (
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
    scopes: readonly RoleScope[] = ['TENANT'],
  ) =>
    permission.endsWith(':own')
      ? holdsPermission(principal, permission)
      : scopes.some((scope) => can(principal, permission, { scope }));

  const isSpeaker = allowedFor(PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN);

  const href = (path: string) => tenantPath(tenantSlug, path);

  const groups: {
    title: string;
    items: {
      href: string;
      label: string;
      icon: React.ReactNode;
      permission?: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
      exact?: boolean;
      /** Escopos que autorizam a PÁGINA (padrão: só a instituição). */
      scopes?: readonly RoleScope[];
      /** Regra própria de visibilidade; quando presente, substitui a permissão. */
      visible?: boolean;
    }[];
  }[] = [
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
        {
          /**
           * Portal do palestrante (FASE 25, revisado).
           *
           * DUAS portas, porque são duas pessoas diferentes: quem já assumiu o perfil
           * (tem o papel, que nasce com o aceite) e quem foi convidado e ainda não
           * aceitou — este não tem papel nenhum, e é justamente quem precisa ver o
           * convite. O rótulo segue a porta: "Convite de palestrante" é o que a pessoa
           * convidada procura no menu.
           */
          href: href('/palestrante'),
          label: isSpeaker ? 'Portal do palestrante' : 'Convite de palestrante',
          icon: <Mic className="size-4" aria-hidden />,
          visible: isSpeaker || hasPendingSpeakerInvite,
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
          // A tela aceita a equipe do dia (papel concedido por EVENTO) — ver
          // `allowedScopes` em `credenciamento/page.tsx`.
          scopes: ['TENANT', 'EVENT'],
        },
        {
          href: href('/administracao'),
          label: 'Administração',
          icon: <Settings2 className="size-4" aria-hidden />,
          permission: PERMISSIONS.TENANT_MEMBER_INVITE,
        },
        {
          // FASE 14: a instituição precisa distinguir EQUIPE de PARTICIPANTES. A
          // guarda é a da seção de administração (`tenant:member:invite`): o papel
          // PARTICIPANT tem `tenant:read`, e `tenant:read` aqui entregaria nome,
          // e-mail e papéis da equipe inteira ao público de qualquer evento aberto.
          href: href('/administracao/equipe'),
          label: 'Equipe',
          icon: <Users className="size-4" aria-hidden />,
          permission: PERMISSIONS.TENANT_MEMBER_INVITE,
        },
      ],
    },
  ];

  return groups
    .map((group) => ({
      title: group.title,
      items: group.items
        /**
         * `visible` (quando presente) MANDA: é a regra que não vem de permissão — o
         * convite pendente que abre o portal para quem ainda não é palestrante. Sem
         * ele, a decisão é da permissão do item, sempre pelo predicado que combina com
         * o TIPO dela (`:own` por posse, o resto por escopo de instituição).
         */
        .filter((item) =>
          item.visible ?? (item.permission ? allowedFor(item.permission, item.scopes) : true),
        )
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
