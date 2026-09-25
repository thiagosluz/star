import {
  Award,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Contact,
  IdCard,
  Compass,
  FileText,
  Gauge,
  Globe,
  GraduationCap,
  Handshake,
  Inbox,
  Layers,
  Mail,
  Medal,
  Mic,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
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
  /**
   * Existe convite de PATROCINADOR pendente para o e-mail desta conta? (FASE 42)
   *
   * Mesma razão do convite de palestrante: o papel `SPONSOR` nasce com o aceite, e
   * quem foi convidado precisa de um caminho de clique até o convite — sem ele, a
   * única porta seria a URL que chegou por e-mail, e a área do patrocinador ficaria
   * invisível para quem ainda não tem vínculo.
   */
  hasPendingSponsorInvite?: boolean;
}): ShellNavGroup[] {
  const {
    tenantSlug,
    principal,
    hasPendingSpeakerInvite = false,
    hasPendingSponsorInvite = false,
  } = input;

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

  /**
   * A área do patrocinador tem DUAS portas, como o portal do palestrante: quem tem o
   * papel (nasceu com o aceite) e quem foi convidado e ainda não aceitou. O rótulo
   * segue a porta, e quem não é nem uma coisa nem outra não vê o item.
   */
  const isSponsor = holdsPermission(principal, PERMISSIONS.SPONSOR_READ);

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
          /**
           * Crachá online (FASE 31): a pessoa mostra o QR na tela do celular quando não
           * tem a etiqueta em mão. É a MESMA permissão da inscrição própria — quem vê as
           * próprias inscrições vê o próprio crachá.
           */
          href: href('/meu-cracha'),
          label: 'Meu crachá',
          icon: <IdCard className="size-4" aria-hidden />,
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
          /**
           * Caixa de entrada do participante (FASE 32): os recados que a instituição
           * mandou. A porta é PESSOAL (a mesma permissão das próprias inscrições) e a
           * posse é conferida na consulta — a permissão abre a tela, o `userId` da
           * sessão decide o que aparece nela.
           */
          href: href('/minhas-mensagens'),
          label: 'Minhas mensagens',
          icon: <Inbox className="size-4" aria-hidden />,
          permission: PERMISSIONS.REGISTRATION_READ_OWN,
        },
        {
          /**
           * Meus compartilhamentos (FASE 42): onde a pessoa vê o que autorizou aos
           * patrocinadores e revoga quando quiser. A porta é PESSOAL — a mesma das
           * próprias inscrições — e a consulta filtra por `userId` da sessão.
           */
          href: href('/meus-compartilhamentos'),
          label: 'Meus compartilhamentos',
          icon: <ShieldCheck className="size-4" aria-hidden />,
          permission: PERMISSIONS.REGISTRATION_READ_OWN,
        },
        {
          /**
           * Área do patrocinador (FASE 42). Mesmo desenho do portal do palestrante:
           * duas portas, um item.
           */
          href: href('/patrocinador'),
          label: isSponsor ? 'Área do patrocinador' : 'Convite de patrocinador',
          icon: <Handshake className="size-4" aria-hidden />,
          visible: isSponsor || hasPendingSponsorInvite,
        },
        {
          /**
           * Meu perfil público (FASE 44): a vitrine da pessoa — o que ela escolheu
           * mostrar. A porta é PESSOAL (`profile:manage:own`) e a posse é a própria
           * sessão: ninguém edita o perfil de outra pessoa.
           */
          href: href('/meu-perfil-publico'),
          label: 'Meu perfil público',
          icon: <Globe className="size-4" aria-hidden />,
          permission: PERMISSIONS.PROFILE_MANAGE_OWN,
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
        {
          // FASE 15: a caixa de saída mostra o que a plataforma enviou em nome da
          // instituição. A permissão é a MESMA da página (`communication:read`),
          // decidida pelo mesmo predicado de instituição — menu e tela precisam
          // concordar nos dois sentidos (armadilha 44).
          href: href('/administracao/comunicacao'),
          label: 'Comunicação',
          icon: <Mail className="size-4" aria-hidden />,
          permission: PERMISSIONS.COMMUNICATION_READ,
        },
        {
          /**
           * Central do participante (FASE 32): quem são as pessoas da instituição e o
           * que elas viveram aqui, atravessando TODOS os eventos.
           *
           * `participant:read` é separada de `registration:read:any` de propósito:
           * operar a inscrição de um evento não pode entregar, por consequência, o
           * histórico de uma pessoa em toda a instituição.
           */
          href: href('/participantes'),
          label: 'Participantes',
          icon: <Contact className="size-4" aria-hidden />,
          permission: PERMISSIONS.PARTICIPANT_READ,
        },
        {
          /**
           * Inteligência da instituição (FASE 32): a tela que finalmente usa
           * `tenant:analytics:read` — permissão que existia desde a FASE 2 e nenhuma
           * tela consumia.
           */
          href: href('/panorama'),
          label: 'Panorama',
          icon: <ChartColumn className="size-4" aria-hidden />,
          permission: PERMISSIONS.TENANT_ANALYTICS_READ,
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
        {
          /**
           * Rotinas automáticas (FASE 36): as varreduras da plataforma — prazos,
           * presenças, confirmação de vaga, inspeção de arquivos e partições da
           * auditoria — com histórico, saúde e o pedido de execução imediata.
           *
           * É item de PLATAFORMA porque uma passada atende todas as instituições;
           * quem opera a instituição não tem o que decidir sobre o relógio da
           * plataforma.
           */
          href: '/superadmin/rotinas',
          label: 'Rotinas',
          icon: <Timer className="size-4" aria-hidden />,
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
