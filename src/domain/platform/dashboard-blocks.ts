/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — o que o painel mostra a QUEM OLHA (FASE 84 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA REGRA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel da instituição nasceu na FASE 2 como demonstração verificável do RBAC:
 *  mostrava os papéis acumulados com escopo (UUID de evento e de atividade) e a
 *  lista crua das permissões efetivas. Era a prova de que o motor de autorização
 *  funcionava — e continua sendo, mas a prova mora em `/conta` desde a FASE 84,
 *  porque é a identidade (global) que acumula papéis entre casas.
 *
 *  No lugar disso, o painel passa a responder à pergunta de quem abre o sistema de
 *  manhã: "o que, para MIM, importa aqui?". A resposta depende do PERFIL — dono,
 *  organizador, revisor, palestrante, patrocinador, equipe do dia —, e é uma
 *  decisão com ordem, teto e um anúncio do que ficou de fora.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE É UMA FUNÇÃO PURA, E NÃO `if` NA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 2 vai renderizar o resultado; o teste tem de poder provar a matriz
 *  perfil × blocos sem banco, sem sessão e sem Next. Uma regra dentro do Server
 *  Component só seria exercitável com infraestrutura — e é justamente a matriz
 *  (onze papéis e as combinações) que precisa de prova barata.
 *
 *  Ela NÃO lê sessão, NÃO lê banco e NÃO decide autorização: recebe o fato já
 *  apurado (`DashboardSubject`) e devolve blocos. Quem apura é o painel (fatia 2),
 *  com as consultas que ele já paga.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS EXCEÇÕES AO CARTÃO "UM BLOCO, UM DESTINO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. O bloco `convite` aponta para `/conta` — e não para uma rota da instituição.
 *     O convite de EQUIPE pendente é um fato GLOBAL (o vínculo `INVITED` pode ser
 *     de outra casa, e o aceite exige o código que só existe no e-mail). A rota
 *     `t/<slug>/convite` sem código responde "convite não encontrado", e mandar
 *     alguém para lá seria um link que parece funcionar e não funciona. `/conta`
 *     é onde os acessos — inclusive os pendentes — passam a ser listados.
 *  2. Dois blocos podem apontar para a MESMA tela (`acuacao-prazo` e `participacao`
 *     levam a `/minhas-inscricoes` quando a pendência é uma vaga retida). Dois
 *     cartões para o mesmo destino não são dois atalhos: são o mesmo atalho dito
 *     duas vezes, e ocupam o teto. A regra COLAPSA o repetido — a precedência
 *     decide qual rótulo fica.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  PERMISSIONS,
  PRIVILEGED_ROLES,
  isRoleKey,
  permissionsForRole,
  type Permission,
} from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * Os fatos que decidem o painel — todos já apurados por quem chama.
 *
 * `roles` são as CHAVES cruas do principal (como vêm de `activeRoles`), e não os
 * rótulos: o que a tela mostra é rótulo, o que a regra compara é chave.
 *
 * Os três booleanos existem porque há blocos que NÃO se deduzem de papel:
 * `hasSpeakerProfile` e `hasSponsorLink` são VÍNCULOS (o papel `SPEAKER` nasce com
 * o aceite e o patrocinador é aberto pelo vínculo, não por `sponsor:read` — FASE
 * 59), e `hasPendingInvite` é um fato da PESSOA que o painel não pode inventar.
 */
export interface DashboardSubject {
  /** Chaves cruas do principal (`OWNER`, `REVIEWER`, `PARTICIPANT`…). */
  readonly roles: readonly string[];
  /**
   * Existe algo com PRAZO esperando a pessoa nesta instituição: vaga retida
   * vencendo, checklist/confirmação pendente.
   *
   * O prazo do PARECER não entra aqui: ele tem bloco próprio (`pareceres`) e
   * destino próprio (`/revisoes`); um único cartão não pode levar a duas telas.
   * Quem apura a fatia 2 decide quais fatos alimentam este campo (o custo está
   * declarado no relatório da fatia 1).
   */
  readonly hasDeadlineAction: boolean;
  /** A pessoa tem perfil de palestrante nesta instituição (assumido, não convidado). */
  readonly hasSpeakerProfile: boolean;
  /** A pessoa está vinculada a um patrocinador (`sponsor_users` ativo). */
  readonly hasSponsorLink: boolean;
  /**
   * Existe convite de EQUIPE pendente para esta pessoa (vínculo `INVITED`).
   *
   * É um campo próprio, e não uma consequência de `hasDeadlineAction`: convite é
   * um FATO (existe um acesso esperando), enquanto prazo é URGÊNCIA. Amarrar um ao
   * outro faria o bloco de convite aparecer para quem tem um parecer atrasado — e
   * desaparecer de quem tem um convite sem data marcada.
   */
  readonly hasPendingInvite: boolean;
}

/**
 * Os nove blocos, na ordem de precedência — e a ordem É o contrato.
 *
 * Os identificadores são estáveis: a fatia 2 os usa como `data-testid`, e o
 * histórico do produto se refere a eles pelo nome.
 */
export type DashboardBlockId =
  | 'acuacao-prazo'
  | 'gestao'
  | 'participacao'
  | 'submissoes'
  | 'pareceres'
  | 'palestrante'
  | 'patrocinador'
  | 'equipe'
  | 'convite';

/** Teto de blocos no painel. O cabeçalho de contexto NÃO conta (ele é a casca). */
export const DASHBOARD_BLOCK_LIMIT = 5;

/**
 * O destino dos convites pendentes — a casa dos acessos em `/conta`.
 *
 * O âncora leva direto à seção nova: o bloco promete "há um convite esperando", e
 * a resposta tem de estar a um clique, não no fim de uma página de seis cartões.
 */
export const ACCOUNT_ACCESSES_PATH = '/conta#seus-acessos';

/** Título, descrição e caminho de cada bloco — a página só renderiza. */
export interface DashboardBlockMeta {
  /** O rótulo que a pessoa lê no cartão. */
  readonly title: string;
  /** Uma frase que diz o que há lá dentro (não repete o título). */
  readonly description: string;
  /**
   * O caminho do destino.
   *
   * Para oito dos nove blocos é um caminho DENTRO da instituição, e
   * `dashboardBlockHref` o monta com `tenantPath` — nenhuma página repete o
   * prefixo `/t/<slug>`. A exceção é `convite`, cujo destino é global (ver o
   * cabeçalho deste arquivo).
   */
  readonly path: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CATÁLOGO DOS BLOCOS
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Cada destino é uma TELA REAL, com a permissão que a abre já conferida:
 *
 *    gestao        → /administracao/eventos  (event:update — OWNER, ADMIN, ORGANIZER)
 *    participacao  → /minhas-inscricoes      (registration:read:own)
 *    submissoes    → /submissoes             (submission:read:own)
 *    pareceres     → /revisoes               (review:submit:own ou submission:read:any)
 *    palestrante   → /palestrante            (abre também para convite pendente)
 *    patrocinador  → /patrocinador           (abre também para convite pendente)
 *    equipe        → /credenciamento         (registration:checkin)
 *
 *  `/administracao` NÃO serve ao bloco de gestão: a tela exige
 *  `tenant:member:invite`, que o ORGANIZER não tem — o cartão levaria de volta ao
 *  painel. `/administracao/eventos` é comum aos três papéis de gestão.
 *
 *  `/comite` NÃO serve ao bloco de pareceres: exige `submission:read:any` e
 *  redirecionaria o REVISOR, que é o dono natural do bloco. `/revisoes` abre para
 *  qualquer vínculo e mostra a lista (honesta, mesmo vazia) das revisões.
 */
export const DASHBOARD_BLOCK_META: Readonly<Record<DashboardBlockId, DashboardBlockMeta>> =
  Object.freeze({
    'acuacao-prazo': {
      path: '/minhas-inscricoes',
      title: 'Prazos e confirmações',
      description: 'Vaga retida, checklist ou confirmação da equipe esperando por você.',
    },
    gestao: {
      path: '/administracao/eventos',
      title: 'Gestão de eventos',
      description: 'Criar, publicar e operar os eventos da instituição.',
    },
    participacao: {
      path: '/minhas-inscricoes',
      title: 'Minhas inscrições',
      description: 'Suas inscrições, o comprovante e o seu crachá.',
    },
    submissoes: {
      path: '/submissoes',
      title: 'Minhas submissões',
      description: 'Seus trabalhos, rascunhos e o andamento de cada um.',
    },
    pareceres: {
      path: '/revisoes',
      title: 'Meus pareceres',
      description: 'As revisões atribuídas a você e os prazos delas.',
    },
    palestrante: {
      path: '/palestrante',
      title: 'Portal do palestrante',
      description: 'Seu perfil, os materiais das suas atividades e o certificado.',
    },
    patrocinador: {
      path: '/patrocinador',
      title: 'Área do patrocinador',
      description: 'O QR do estande, as leituras e o que a sua empresa patrocina.',
    },
    equipe: {
      path: '/credenciamento',
      title: 'Credenciamento',
      description: 'A portaria e a presença nas atividades do dia.',
    },
    convite: {
      path: ACCOUNT_ACCESSES_PATH,
      title: 'Convite pendente',
      description: 'Há um convite esperando por você — veja em Minha conta.',
    },
  });

/**
 * Uma permissão está no pacote de algum dos papéis?
 *
 * A pergunta é feita ao CATÁLOGO (`permissionsForRole`), não a uma lista paralela
 * de papéis: acrescentar um papel que receba `submission:read:own` amanhã passa a
 * mostrar o bloco de submissões sem edição aqui.
 */
function holdsPermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some(
    (role) => isRoleKey(role) && permissionsForRole(role).includes(permission),
  );
}

/**
 * O papel é de GESTÃO?
 *
 * OWNER, ADMIN e ORGANIZER são a resposta nominal. A segunda condição
 * (`event:manage`) existe para o dia em que um papel novo receber a gestão
 * operacional do evento sem estar nesta lista — e o comentário acima da regra diz
 * que hoje ela não acrescenta ninguém.
 */
function isManagementRole(role: string): boolean {
  if (PRIVILEGED_ROLES.some((privileged) => privileged === role)) return true;

  return isRoleKey(role) && permissionsForRole(role).includes(PERMISSIONS.EVENT_MANAGE);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PRECEDÊNCIA — a ordem desta lista É o contrato
 * ═══════════════════════════════════════════════════════════════════════════════
 *  1. AÇÃO COM PRAZO — o único bloco que muda de um dia para o outro. Quem tem uma
 *     vaga vencendo precisa vê-la antes de qualquer vitrine.
 *  2. GESTÃO — o ofício de quem responde pela instituição.
 *  3. PARTICIPAÇÃO — a vida da pessoa como público (inscrição, certificado).
 *  4. SUBMISSÕES PRÓPRIAS — a vida acadêmica como autor.
 *  5. PARECERES — a vida acadêmica como avaliador.
 *  6. PALESTRANTE — o ofício de quem apresenta.
 *  7. PATROCINADOR — o vínculo comercial.
 *  8. EQUIPE — o dia do evento (portaria).
 *  9. CONVITE — o acesso que ainda não foi aceito.
 *
 * A ordem também decide quem sobrevive ao teto: o que fica de fora é sempre a
 * cauda desta lista, e a página ANUNCIA quantos atalhos ficaram (F50/F51: "o que
 * a tela esconde, ela anuncia").
 */
const BLOCK_RULES: readonly {
  readonly id: DashboardBlockId;
  readonly applies: (subject: DashboardSubject) => boolean;
}[] = [
  {
    id: 'acuacao-prazo',
    applies: (subject) => subject.hasDeadlineAction,
  },
  {
    id: 'gestao',
    applies: (subject) => subject.roles.some(isManagementRole),
  },
  {
    id: 'participacao',
    applies: (subject) => holdsPermission(subject.roles, PERMISSIONS.REGISTRATION_READ_OWN),
  },
  {
    id: 'submissoes',
    applies: (subject) => holdsPermission(subject.roles, PERMISSIONS.SUBMISSION_READ_OWN),
  },
  {
    id: 'pareceres',
    applies: (subject) =>
      holdsPermission(subject.roles, PERMISSIONS.REVIEW_SUBMIT_OWN) ||
      holdsPermission(subject.roles, PERMISSIONS.SUBMISSION_READ_ANY),
  },
  {
    id: 'palestrante',
    applies: (subject) => subject.hasSpeakerProfile,
  },
  {
    id: 'patrocinador',
    applies: (subject) => subject.hasSponsorLink,
  },
  {
    id: 'equipe',
    applies: (subject) => holdsPermission(subject.roles, PERMISSIONS.REGISTRATION_CHECKIN),
  },
  {
    id: 'convite',
    applies: (subject) => subject.hasPendingInvite,
  },
];

/**
 * O plano do painel: os blocos que cabem e quantos ficaram de fora.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM OBJETO, E NÃO SÓ A LISTA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O corte e o anúncio são UMA decisão só. Se a página fizesse `blocks.slice(0, 5)`
 *  por conta própria, o número anunciado ("e mais 2 atalhos") poderia divergir do
 *  que a regra cortou no dia em que o teto mudasse — e a tela passaria a esconder
 *  em silêncio. Devolver `hidden` junto impede a segunda cópia da conta.
 */
export interface DashboardBlockPlan {
  /** Os blocos que o painel desenha, já na ordem de precedência. */
  readonly blocks: readonly DashboardBlockId[];
  /** Quantos blocos distintos ficaram fora do teto (0 = nada escondido). */
  readonly hidden: number;
}

/**
 * Decide os blocos do painel para este perfil.
 *
 * O COLAPSO acontece antes do teto: quando dois blocos levam à mesma tela, o de
 * maior precedência fica e o outro não ocupa vaga — nem entra em `hidden`, porque
 * ele não é um atalho escondido, é o mesmo atalho.
 */
export function dashboardBlocksFor(subject: DashboardSubject): DashboardBlockPlan {
  const selected: DashboardBlockId[] = [];
  const destinations = new Set<string>();

  for (const rule of BLOCK_RULES) {
    if (!rule.applies(subject)) continue;

    const destination = DASHBOARD_BLOCK_META[rule.id].path;
    if (destinations.has(destination)) continue;

    destinations.add(destination);
    selected.push(rule.id);
  }

  const blocks = selected.slice(0, DASHBOARD_BLOCK_LIMIT);

  return { blocks, hidden: selected.length - blocks.length };
}

/**
 * O endereço de um bloco dentro da instituição.
 *
 * É `tenantPath` e não concatenação: o prefixo `/t/<slug>` tem uma fonte só, e a
 * página não pode montar `/dashboard` cru (o Proxy responde 404 sem host de
 * instituição). A exceção do convite está documentada no cabeçalho.
 */
export function dashboardBlockHref(id: DashboardBlockId, tenantSlug: string): string {
  const { path } = DASHBOARD_BLOCK_META[id];

  return id === 'convite' ? path : tenantPath(tenantSlug, path);
}

/**
 * A frase que anuncia o que ficou de fora — ou `null` quando nada ficou.
 *
 * Ela é do domínio, e não da página, pela mesma razão do plano: o número que a
 * frase diz é o número que a regra escondeu. `null` é o estado "nada a anunciar",
 * e não uma string vazia que o JSX desenharia como espaço.
 */
export function dashboardHiddenPhrase(hidden: number): string | null {
  if (hidden <= 0) return null;

  return hidden === 1 ? 'e mais 1 atalho' : `e mais ${hidden} atalhos`;
}
