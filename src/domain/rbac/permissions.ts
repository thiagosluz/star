/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Catálogo de permissões (RBAC)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PRINCÍPIOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. Este arquivo NÃO importa nada do Next.js, do Prisma ou do React. É domínio
 *     puro e, por isso, testável sem banco e sem servidor.
 *
 *  2. Permissões são strings tipadas no formato `recurso:ação:escopo`. O
 *     terceiro segmento declara **sobre o que** a ação incide:
 *
 *         :any      qualquer registro dentro do escopo do papel
 *         :own      apenas registros dos quais o usuário é dono/autor
 *         (ausente) ação global, não vinculada a um registro
 *
 *     Sem essa distinção, `review:read:any` concedido a um revisor deixaria ele
 *     ler os pareceres de todos os colegas. Com ela, REVIEWER recebe
 *     `review:read:own` e a checagem de propriedade é obrigatória.
 *
 *  3. LISTA BRANCA, não lista negra. Toda permissão existente está declarada
 *     aqui. Conceder algo que não existe é impossível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Catálogo
// ───────────────────────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  // ── Plataforma / Tenant ─────────────────────────────────────────────────────
  TENANT_READ: 'tenant:read',
  TENANT_UPDATE: 'tenant:update',
  TENANT_DELETE: 'tenant:delete',
  TENANT_BILLING_MANAGE: 'tenant:billing:manage',
  TENANT_MEMBER_INVITE: 'tenant:member:invite',
  TENANT_MEMBER_REMOVE: 'tenant:member:remove',
  TENANT_ROLE_ASSIGN: 'tenant:role:assign',
  TENANT_ANALYTICS_READ: 'tenant:analytics:read',
  TENANT_AUDIT_READ: 'tenant:audit:read',
  /**
   * Comunicação da instituição — FASE 15.
   *
   * Dá acesso à caixa de saída (o que a plataforma enviou em nome da instituição,
   * para quem e com que resultado). É permissão de ADMINISTRAÇÃO: o conteúdo inclui
   * endereço de pessoas e o texto das mensagens.
   */
  COMMUNICATION_READ: 'communication:read',

  // ── Eventos ─────────────────────────────────────────────────────────────────
  EVENT_CREATE: 'event:create',
  EVENT_READ: 'event:read',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:delete',
  EVENT_PUBLISH: 'event:publish',
  /**
   * Administração operacional do evento — FASE 8.
   *
   * Distinta de `event:update` (editar cadastro): `event:manage` cobre ações que
   * AFETAM PESSOAS e produzem resultado auditável — hoje, executar sorteios.
   * Separar as duas permite conceder "cuida do evento" sem conceder "pode
   * sortear".
   */
  EVENT_MANAGE: 'event:manage',

  // ── Atividades ──────────────────────────────────────────────────────────────
  ACTIVITY_CREATE: 'activity:create',
  ACTIVITY_READ: 'activity:read',
  ACTIVITY_UPDATE: 'activity:update',
  ACTIVITY_DELETE: 'activity:delete',

  // ── Inscrições ──────────────────────────────────────────────────────────────
  REGISTRATION_CREATE: 'registration:create',
  REGISTRATION_READ_ANY: 'registration:read:any',
  REGISTRATION_READ_OWN: 'registration:read:own',
  REGISTRATION_UPDATE_ANY: 'registration:update:any',
  REGISTRATION_CANCEL_OWN: 'registration:cancel:own',
  REGISTRATION_CHECKIN: 'registration:checkin',
  REGISTRATION_CHECKOUT: 'registration:checkout',

  // ── Presença ────────────────────────────────────────────────────────────────
  ATTENDANCE_READ: 'attendance:read',
  ATTENDANCE_MANAGE: 'attendance:manage',

  // ── Submissões / Peer review ────────────────────────────────────────────────
  TRACK_MANAGE: 'track:manage',
  SUBMISSION_CREATE: 'submission:create',
  SUBMISSION_READ_ANY: 'submission:read:any',
  SUBMISSION_READ_OWN: 'submission:read:own',
  SUBMISSION_READ_REVIEWABLE: 'submission:read:reviewable',
  SUBMISSION_UPDATE_OWN: 'submission:update:own',
  SUBMISSION_DECIDE: 'submission:decide',
  SUBMISSION_ASSIGN_REVIEWER: 'submission:assign-reviewer',
  REVIEW_SUBMIT_OWN: 'review:submit:own',
  REVIEW_READ_ANY: 'review:read:any',
  REVIEW_READ_OWN: 'review:read:own',
  CONFLICT_MANAGE: 'conflict:manage',

  // ── Gamificação ─────────────────────────────────────────────────────────────
  CARD_TEMPLATE_MANAGE: 'card-template:manage',
  CARD_GRANT: 'card:grant',
  CARD_READ_OWN: 'card:read:own',
  TASK_MANAGE: 'task:manage',
  XP_READ_OWN: 'xp:read:own',
  XP_ADJUST: 'xp:adjust',

  // ── Certificados ────────────────────────────────────────────────────────────
  CERTIFICATE_ISSUE: 'certificate:issue',
  CERTIFICATE_READ_ANY: 'certificate:read:any',
  CERTIFICATE_READ_OWN: 'certificate:read:own',
  CERTIFICATE_REVOKE: 'certificate:revoke',

  // ── Patrocinadores ──────────────────────────────────────────────────────────
  SPONSOR_MANAGE: 'sponsor:manage',
  SPONSOR_READ: 'sponsor:read',

  // ── Palestrantes (FASE 25) ──────────────────────────────────────────────────
  /**
   * Cadastro do palestrante pela instituição: criar o perfil, vinculá-lo a uma
   * atividade, gerar convite e ler os materiais enviados por ele.
   */
  SPEAKER_MANAGE: 'speaker:manage',
  /**
   * O palestrante edita o PRÓPRIO perfil (bio, foto, instituição, redes).
   *
   * `:own` porque a posse é o que separa este portal de um cadastro aberto: a
   * permissão sozinha não basta — `can()` exige o `ownerId`, e o serviço confirma
   * que o perfil é da pessoa antes de escrever.
   */
  SPEAKER_PROFILE_UPDATE_OWN: 'speaker:profile:update:own',
  /** O palestrante gerencia os materiais DAS ATIVIDADES que ministra. */
  SPEAKER_MATERIAL_MANAGE_OWN: 'speaker:material:manage:own',

  // ── Conteúdo / Landing page ─────────────────────────────────────────────────
  PAGE_MANAGE: 'page:manage',

  // ── Perfil público do participante (FASE 44) ────────────────────────────────
  /**
   * A pessoa mantém o PRÓPRIO perfil público: `@handle`, bio, interesses, links e a
   * decisão de visibilidade de cada campo.
   *
   * `:own` porque o dado é dela: a permissão sozinha não basta — o serviço escreve
   * sempre na linha do `userId` que veio da SESSÃO, e nunca em outra pessoa. É a
   * única porta que edita identidade global (`user`), e por isso ela é estreita.
   */
  PROFILE_MANAGE_OWN: 'profile:manage:own',

  // ── Central do participante (FASE 32) ───────────────────────────────────────
  /**
   * Ver o diretório de participantes da instituição (todos os eventos) e abrir a
   * ficha de uma pessoa: inscrições, frequência, certificados, cartas, XP e a
   * comunicação que ela recebeu.
   *
   * É a permissão mais sensível da fase: a ficha reúne dado pessoal que nenhuma
   * outra tela junta. Por isso ela é SEPARADA de `registration:read:any` — quem
   * opera a inscrição de um evento não ganha, por consequência, o histórico da
   * pessoa em todos os eventos da instituição.
   */
  PARTICIPANT_READ: 'participant:read',
  /**
   * Enviar recado a um participante (e-mail pelo outbox + mensagem na caixa de
   * entrada dele).
   *
   * Separada da leitura de propósito: consultar a ficha é ato de conferência, e
   * enviar mensagem é ato de COMUNICAÇÃO, com efeito para fora da plataforma —
   * quem só precisa conferir não deve poder disparar e-mail em massa.
   */
  PARTICIPANT_MESSAGE: 'participant:message',

  // ── Demandas internas do evento (FASE 38) ───────────────────────────────────
  /**
   * Ver o quadro de demandas do evento: cartões, prazos, responsáveis, equipes e
   * comentários.
   *
   * É a permissão de quem TRABALHA no evento — não dá acesso a dado pessoal de
   * participante nem a decisão acadêmica. Fica separada de `event:read` porque o
   * quadro diz quem está fazendo o quê e o que está atrasado: é a agenda interna da
   * equipe, e nem todo mundo que enxerga o evento precisa dela.
   */
  DEMAND_READ: 'demand:read',
  /**
   * Criar, editar, mover e concluir demandas.
   *
   * Mover o cartão é o ato central do quadro, e é de quem EXECUTA: a equipe do dia
   * move o que está fazendo sem poder criar ou apagar a estrutura do trabalho.
   */
  DEMAND_MANAGE: 'demand:manage',
  /**
   * Definir responsáveis e equipe de QUALQUER demanda do evento.
   *
   * Distribuir trabalho é ato de coordenação: quem organiza decide quem faz o quê.
   */
  DEMAND_ASSIGN: 'demand:assign',
  /**
   * O LÍDER da equipe distribui trabalho DENTRO da própria equipe.
   *
   * `:own` porque a posse é o que separa isto de `demand:assign`: sem o `ownerId`
   * conferido (o `teamId` da demanda contra a liderança de quem age), a permissão
   * sozinha não autoriza nada — é o invariante nº 4, e é o que permite o líder
   * existir sem virar papel novo a cada equipe criada.
   */
  DEMAND_ASSIGN_OWN_TEAM: 'demand:assign:own-team',
  /**
   * Criar, editar e excluir as EQUIPES do evento e seus membros.
   *
   * Só vínculo `MEMBER` ativo entra numa equipe: participante de evento não é força
   * de trabalho por acidente, e a quota de equipe da instituição não é consumida por
   * quem só se inscreveu.
   */
  DEMAND_TEAM_MANAGE: 'demand:team:manage',

  // ── Plataforma (FASE 9) ─────────────────────────────────────────────────────
  /**
   * Governança global: provisionar instituições, definir planos e quotas,
   * suspender tráfego e ler métricas consolidadas.
   *
   * Existe em um escopo PRÓPRIO (`PLATFORM`) e nunca é concedida a papéis de
   * tenant: quem administra uma instituição não administra a plataforma, e quem
   * administra a plataforma não entra no conteúdo das instituições.
   */
  PLATFORM_MANAGE: 'platform:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Todas as permissões válidas, para validação e testes. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS),
);

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Type guard: a string é uma permissão conhecida? */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escopos
// ───────────────────────────────────────────────────────────────────────────────
export const ROLE_SCOPES = ['PLATFORM', 'TENANT', 'EVENT', 'ACTIVITY'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/**
 * Hierarquia de escopos: um papel concedido em um escopo mais amplo vale nos
 * escopos mais estreitos contidos nele.
 *
 *   TENANT (3) ⊃ EVENT (2) ⊃ ACTIVITY (1)
 *
 * Exemplo: quem é ORGANIZER no tenant também organiza qualquer evento dele.
 * O contrário NÃO vale: um papel concedido em um evento não vaza para o tenant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  PLATFORM EXISTE, MAS NÃO COBRE OS DEMAIS ESCOPOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  O papel de plataforma governa INSTITUIÇÕES (criar, suspender, medir) e NÃO
 *  concede poder DENTRO delas: um SuperAdmin não vira ADMIN de todos os tenants.
 *
 *  Para agir em uma instituição, a pessoa precisa de vínculo e papel ali. É o que
 *  mantém a fronteira de RLS com significado — e o que impede que uma conta de
 *  suporte comprometida seja uma chave-mestra de todo o conteúdo hospedado.
 */
export const SCOPE_RANK: Record<RoleScope, number> = {
  PLATFORM: 4,
  TENANT: 3,
  EVENT: 2,
  ACTIVITY: 1,
};

/** O escopo `granted` cobre o escopo `required`? */
export function scopeCovers(granted: RoleScope, required: RoleScope): boolean {
  /**
   * A plataforma é um mundo à parte: cobre a si mesma e nada mais. A comparação
   * por nota seria perigosa aqui justamente porque `PLATFORM` tem a maior nota —
   * ela diria que o SuperAdmin cobre `TENANT`, que é exatamente o que não pode.
   */
  if (granted === 'PLATFORM' || required === 'PLATFORM') {
    return granted === 'PLATFORM' && required === 'PLATFORM';
  }

  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Papéis
// ───────────────────────────────────────────────────────────────────────────────
export const ROLE_KEYS = [
  /**
   * Papel de PLATAFORMA (FASE 9): governa instituições, não conteúdo.
   *
   * Fica no mesmo enum dos papéis de tenant porque a concessão usa a mesma tabela
   * — mas vive em outro escopo (`PLATFORM`), e `scopeCovers` garante que ele não
   * vaze para dentro das instituições.
   */
  'SUPERADMIN',
  'OWNER',
  'ADMIN',
  'ORGANIZER',
  'FINANCE',
  'REVIEWER',
  'CHAIR',
  'SPEAKER',
  'STAFF',
  'PARTICIPANT',
  'SPONSOR',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * Rótulo do papel em português (FASE 21).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE MAPA SAIU DO MÓDULO DE E-MAIL
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ele nasceu na FASE 15, dentro de `domain/communication/email-rules.ts`, porque o
 *  primeiro lugar que precisou dele foi o convite por e-mail. A tela de equipe da
 *  FASE 21 precisa do MESMO rótulo para as caixas de seleção de papel — e importar
 *  o domínio de comunicação para rotular RBAC inverteria a dependência. O rótulo é
 *  do papel, e o papel é daqui.
 */
export const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  SUPERADMIN: 'Administração da plataforma',
  OWNER: 'Proprietário(a)',
  ADMIN: 'Administrador(a)',
  ORGANIZER: 'Organizador(a)',
  FINANCE: 'Financeiro',
  REVIEWER: 'Revisor(a)',
  CHAIR: 'Coordenação científica',
  SPEAKER: 'Palestrante',
  STAFF: 'Equipe de operação',
  PARTICIPANT: 'Participante',
  SPONSOR: 'Patrocinador(a)',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as RoleKey] ?? role;
}

/** Papéis que só fazem sentido no escopo de tenant (não por evento/atividade). */
export const TENANT_ONLY_ROLES: readonly RoleKey[] = Object.freeze(['OWNER', 'ADMIN']);

/**
 * Papéis que, mesmo no escopo EVENT/ACTIVITY, enxergam a organização inteira.
 * Usado para decidir se o usuário pode trocar de contexto livremente.
 */
export const PRIVILEGED_ROLES: readonly RoleKey[] = Object.freeze([
  'OWNER',
  'ADMIN',
  'ORGANIZER',
]);

/** Permissões de organização (operam o evento inteiro, não só o próprio dado). */
const ORGANIZER_PERMISSIONS: Permission[] = [
  PERMISSIONS.TENANT_READ,
  PERMISSIONS.TENANT_ANALYTICS_READ,
  PERMISSIONS.EVENT_CREATE,
  PERMISSIONS.EVENT_READ,
  PERMISSIONS.EVENT_UPDATE,
  PERMISSIONS.EVENT_DELETE,
  PERMISSIONS.EVENT_PUBLISH,
  /**
   * `event:manage` — sortear participantes é ato de organização, com efeito
   * público e auditável. Fica com quem responde pelo evento, não com quem apenas
   * coordena a trilha científica (CHAIR).
   */
  PERMISSIONS.EVENT_MANAGE,
  PERMISSIONS.ACTIVITY_CREATE,
  PERMISSIONS.ACTIVITY_READ,
  PERMISSIONS.ACTIVITY_UPDATE,
  PERMISSIONS.ACTIVITY_DELETE,
  PERMISSIONS.REGISTRATION_READ_ANY,
  PERMISSIONS.REGISTRATION_UPDATE_ANY,
  PERMISSIONS.REGISTRATION_CHECKIN,
  PERMISSIONS.REGISTRATION_CHECKOUT,
  PERMISSIONS.ATTENDANCE_READ,
  PERMISSIONS.ATTENDANCE_MANAGE,
  PERMISSIONS.TRACK_MANAGE,
  PERMISSIONS.SUBMISSION_READ_ANY,
  PERMISSIONS.SUBMISSION_DECIDE,
  PERMISSIONS.SUBMISSION_ASSIGN_REVIEWER,
  PERMISSIONS.REVIEW_READ_ANY,
  PERMISSIONS.CONFLICT_MANAGE,
  PERMISSIONS.CARD_TEMPLATE_MANAGE,
  PERMISSIONS.CARD_GRANT,
  PERMISSIONS.TASK_MANAGE,
  PERMISSIONS.XP_ADJUST,
  PERMISSIONS.CERTIFICATE_ISSUE,
  PERMISSIONS.CERTIFICATE_READ_ANY,
  PERMISSIONS.CERTIFICATE_REVOKE,
  PERMISSIONS.SPONSOR_MANAGE,
  PERMISSIONS.SPONSOR_READ,
  /**
   * `speaker:manage` — cadastrar palestrante é ato de organização do evento: a
   * vitrine pública exibe quem a instituição convidou. O palestrante NÃO recebe
   * esta permissão: ele edita o próprio perfil e os próprios materiais, e a posse
   * é verificada em cada escrita.
   */
  PERMISSIONS.SPEAKER_MANAGE,
  PERMISSIONS.PAGE_MANAGE,
  /**
   * `participant:read` e `participant:message` — quem organiza responde pela
   * relação com o público: enxerga quem participou e fala com essas pessoas. As
   * duas ficam juntas porque é o mesmo ofício (a mesma razão de `communication:read`
   * estar aqui), e continuam separadas de `registration:read:any`, que é operação
   * de inscrição.
   */
  PERMISSIONS.PARTICIPANT_READ,
  PERMISSIONS.PARTICIPANT_MESSAGE,
  /**
   * `communication:read` — quem organiza o evento responde também pelos avisos que
   * ele gera (convites de equipe, atribuições de avaliação, certificados). Fica com
   * o ORGANIZER, e não com o CHAIR: a caixa de saída é da instituição inteira, não da
   * trilha científica.
   */
  PERMISSIONS.COMMUNICATION_READ,
  /**
   * Demandas internas — FASE 38. As quatro permissões de coordenação ficam com quem
   * organiza: ler o quadro, criar e mover demandas, distribuir trabalho entre
   * pessoas e equipes, e manter as equipes do evento. O papel STAFF recebe as três
   * de execução (ler, mover e liderar a própria equipe) e não a de coordenar.
   */
  PERMISSIONS.DEMAND_READ,
  PERMISSIONS.DEMAND_MANAGE,
  PERMISSIONS.DEMAND_ASSIGN,
  PERMISSIONS.DEMAND_ASSIGN_OWN_TEAM,
  PERMISSIONS.DEMAND_TEAM_MANAGE,
];

/** Permissões de quem participa (todo usuário tem, no mínimo, estas). */
const PARTICIPANT_PERMISSIONS: Permission[] = [
  PERMISSIONS.TENANT_READ,
  PERMISSIONS.EVENT_READ,
  PERMISSIONS.ACTIVITY_READ,
  PERMISSIONS.REGISTRATION_CREATE,
  PERMISSIONS.REGISTRATION_READ_OWN,
  PERMISSIONS.REGISTRATION_CANCEL_OWN,
  PERMISSIONS.SUBMISSION_CREATE,
  PERMISSIONS.SUBMISSION_READ_OWN,
  PERMISSIONS.SUBMISSION_UPDATE_OWN,
  PERMISSIONS.CARD_READ_OWN,
  PERMISSIONS.XP_READ_OWN,
  PERMISSIONS.CERTIFICATE_READ_OWN,
  PERMISSIONS.SPONSOR_READ,
  /**
   * O perfil público é de QUEM PARTICIPA, e por isso está nesta lista: ela é o
   * "mínimo que todo usuário tem". Publicar a própria vitrine não é ato de equipe.
   */
  PERMISSIONS.PROFILE_MANAGE_OWN,
];

/**
 * Mapa papel → permissões.
 *
 * `OWNER` recebe todas as permissões existentes EXCETO as de participante que
 * não lhe fazem sentido — na prática, todas. É derivado do catálogo para que
 * uma permissão nova não seja esquecida.
 */
/**
 * Permissões que valem DENTRO de uma instituição.
 *
 * A separação existe por causa de `OWNER: ALL_PERMISSIONS`: ao acrescentar
 * `platform:manage` ao catálogo, listá-la para os papéis de tenant daria a TODO
 * dono de instituição uma permissão de plataforma — inofensiva hoje (o `can()`
 * exige escopo `PLATFORM`), mas um vazamento à espera de quem consultar a
 * permissão sem olhar o escopo.
 *
 * A defesa é em profundidade: permissão de plataforma só consta em papel de
 * plataforma, E o escopo precisa bater.
 */
export const TENANT_PERMISSIONS: readonly Permission[] = Object.freeze(
  ALL_PERMISSIONS.filter((permission) => permission !== PERMISSIONS.PLATFORM_MANAGE),
);

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  /**
   * SuperAdmin da plataforma: UMA permissão, em UM escopo.
   *
   * Não herda nada de tenant — o que ele pode fazer é criar, medir, suspender e
   * reativar instituições.
   */
  SUPERADMIN: [PERMISSIONS.PLATFORM_MANAGE],

  OWNER: TENANT_PERMISSIONS,

  // ADMIN é o OWNER sem os poderes destrutivos/financeiros do tenant.
  ADMIN: TENANT_PERMISSIONS.filter(
    (p) =>
      p !== PERMISSIONS.TENANT_DELETE &&
      p !== PERMISSIONS.TENANT_BILLING_MANAGE &&
      p !== PERMISSIONS.TENANT_ROLE_ASSIGN,
  ),

  ORGANIZER: ORGANIZER_PERMISSIONS,

  // CHAIR coordena a trilha científica: decide, mas não opera o evento.
  CHAIR: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.TRACK_MANAGE,
    PERMISSIONS.SUBMISSION_READ_ANY,
    PERMISSIONS.SUBMISSION_DECIDE,
    PERMISSIONS.SUBMISSION_ASSIGN_REVIEWER,
    PERMISSIONS.REVIEW_READ_ANY,
    PERMISSIONS.CONFLICT_MANAGE,
    PERMISSIONS.REGISTRATION_READ_ANY,
    PERMISSIONS.CERTIFICATE_ISSUE,
    PERMISSIONS.CERTIFICATE_READ_ANY,
    PERMISSIONS.SPONSOR_READ,
    ...PARTICIPANT_PERMISSIONS,
  ],

  // REVIEWER só lê o que lhe foi atribuído — daí :reviewable.
  REVIEWER: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.SUBMISSION_READ_REVIEWABLE,
    PERMISSIONS.REVIEW_SUBMIT_OWN,
    PERMISSIONS.REVIEW_READ_OWN,
    PERMISSIONS.SPONSOR_READ,
    /** Revisor é uma PESSOA na instituição: também publica o próprio perfil (FASE 44). */
    PERMISSIONS.PROFILE_MANAGE_OWN,
  ],

  // FINANCE cuida do comercial: patrocínios e relatórios.
  FINANCE: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.TENANT_BILLING_MANAGE,
    PERMISSIONS.TENANT_ANALYTICS_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.SPONSOR_MANAGE,
    PERMISSIONS.SPONSOR_READ,
    PERMISSIONS.REGISTRATION_READ_ANY,
    PERMISSIONS.PROFILE_MANAGE_OWN,
  ],

  // SPEAKER apresenta: gerencia o próprio material e a própria presença.
  SPEAKER: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.SUBMISSION_CREATE,
    PERMISSIONS.SUBMISSION_READ_OWN,
    PERMISSIONS.SUBMISSION_UPDATE_OWN,
    PERMISSIONS.REGISTRATION_READ_OWN,
    PERMISSIONS.CERTIFICATE_READ_OWN,
    PERMISSIONS.CARD_READ_OWN,
    PERMISSIONS.XP_READ_OWN,
    PERMISSIONS.SPONSOR_READ,
    /**
     * FASE 25 — o portal. As duas permissões são `:own` por desenho: habilitam o
     * palestrante a editar o PRÓPRIO perfil e os materiais das atividades em que
     * consta como ministrante, e não concedem acesso a palestrante nenhum.
     */
    PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN,
    PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
    PERMISSIONS.PROFILE_MANAGE_OWN,
  ],

  // STAFF opera credenciamento no dia do evento.
  STAFF: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.REGISTRATION_READ_ANY,
    PERMISSIONS.REGISTRATION_CHECKIN,
    PERMISSIONS.REGISTRATION_CHECKOUT,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.CERTIFICATE_READ_ANY,
    PERMISSIONS.SPONSOR_READ,
    /**
     * FASE 38 — a equipe do dia TRABALHA no quadro: lê, cria e move demandas. Não
     * recebe `demand:assign` (distribuir trabalho entre todos é coordenação), mas
     * recebe `demand:assign:own-team`: quem lidera uma equipe distribui dentro dela,
     * e a posse é conferida no serviço. Quem não lidera equipe nenhuma não
     * consegue atribuir nada — a permissão sozinha não abre nada.
     */
    PERMISSIONS.DEMAND_READ,
    PERMISSIONS.DEMAND_MANAGE,
    PERMISSIONS.DEMAND_ASSIGN_OWN_TEAM,
    PERMISSIONS.PROFILE_MANAGE_OWN,
  ],

  PARTICIPANT: PARTICIPANT_PERMISSIONS,

  // SPONSOR tem acesso mínimo: enxerga o evento em que patrocina.
  SPONSOR: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.SPONSOR_READ,
    /** O contato da empresa é uma PESSOA: o perfil dela é dela (FASE 44). */
    PERMISSIONS.PROFILE_MANAGE_OWN,
  ],
};

/** Permissões efetivas de um papel. */
export function permissionsForRole(role: RoleKey): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Este papel pode ser concedido no escopo informado? */
export function roleAllowedInScope(role: RoleKey, scope: RoleScope): boolean {
  if (TENANT_ONLY_ROLES.includes(role)) return scope === 'TENANT';
  return true;
}
