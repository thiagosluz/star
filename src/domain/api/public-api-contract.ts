/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O CONTRATO DA PROJEÇÃO PÚBLICA DA API (FASE 72 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE ANTES DA PRIMEIRA ROTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A API por evento não pode montar a própria consulta: ela lê a MESMA projeção
 *  que a página pública já lê (`getPublicEventView` → `getPublicEvent`). O que
 *  este módulo define é o outro lado dessa fronteira: o FORMATO que sai dela.
 *
 *  Duas coisas aqui são contrato e não estilo:
 *    • a ORDEM das chaves (invariante 7 da casa) — dela depende o `ETag` da
 *      fatia 2, e duas respostas iguais com ordens diferentes não são iguais;
 *    • a LISTA FECHADA do que a API nunca devolve — endereço de sala online,
 *      dado de participante, resposta de formulário, CPF, lista de espera,
 *      contador interno e campo de rascunho.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  REPROVAR, E NÃO FILTRAR EM SILÊNCIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `assertApiProjectionSemCampoProibido` LANÇA. A alternativa — filtrar o campo
 *  proibido e devolver o resto — foi descartada por um motivo concreto: o filtro
 *  silencioso transforma o defeito em "campo que simplesmente não aparece", e a
 *  próxima pessoa que mexer na projeção não tem como saber que aquele dado já
 *  vazou em uma versão anterior nem que a lista fechada foi violada. Lançar faz
 *  o serviço responder erro (fail-closed), registra o nome do campo no log e
 *  mantém o teste vermelho enquanto o defeito existir. Nenhum caminho devolve o
 *  dado proibido.
 *
 *  O módulo é PURO: não importa Prisma, Next, relógio nem gerador de id. O
 *  instante entra por parâmetro (`generatedAt`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const API_RESOURCES = [
  'evento',
  'atividades',
  'palestrantes',
  'patrocinadores',
  'chamadas',
] as const;

export type ApiResource = (typeof API_RESOURCES)[number];

/**
 * A ordem canônica de cada recurso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ORDEM É UMA LISTA ESCRITA À MÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `Object.keys` devolve a ordem de inserção do objeto que o chamador montou. Se
 *  a ordem dependesse disso, um `...spread` novo — ou um mapper reescrito em
 *  outra ordem — mudaria o JSON sem mudar nenhum valor, e o `ETag` da fatia 2
 *  passaria a mentir sobre o conteúdo. A lista é a fonte única: o envelope
 *  reordena por ela e RECUSA chave que não esteja declarada.
 */
export const API_FIELD_ORDER = {
  evento: [
    'id',
    'slug',
    'title',
    'subtitle',
    'summary',
    'description',
    'status',
    'modality',
    'startsAt',
    'endsAt',
    'timezone',
    'venueName',
    'venueAddress',
    'city',
    'state',
    'country',
    'coverImageUrl',
    'logoUrl',
    'primaryColor',
    'theme',
    'registrationOpensAt',
    'registrationClosesAt',
    'registrationOpen',
    'capacity',
    'remainingSeats',
    'activityCount',
    'usesCall',
    'registrationRequiresMembership',
    'tenant',
  ],
  atividades: [
    'id',
    'slug',
    'title',
    'description',
    'type',
    'status',
    'modality',
    'startsAt',
    'endsAt',
    'workloadMinutes',
    'roomName',
    'capacity',
    'remainingSeats',
    'requiresRegistration',
    'isFeatured',
    'tags',
    'speakerIds',
    'speakerNames',
  ],
  palestrantes: [
    'id',
    'name',
    'roleTitle',
    'avatarUrl',
    'institution',
    'isKeynote',
    'bio',
    'company',
    'socialLinks',
    'activities',
  ],
  patrocinadores: [
    'id',
    'name',
    'logoUrl',
    'websiteUrl',
    'tierId',
    'tierName',
    'tierKey',
    'tierColor',
    'tierLogoScale',
    'tierDescription',
  ],
  chamadas: [
    'id',
    'slug',
    'title',
    'summary',
    'instructions',
    'kind',
    'kindLabel',
    'state',
    'opensAt',
    'closesAt',
    'windowLabel',
    'countdown',
    'trackName',
    'formPath',
  ],
} as const satisfies Record<ApiResource, readonly string[]>;

/**
 * A ordem dentro dos objetos aninhados que o recurso carrega.
 *
 * Sem esta lista, a ordem do tema (que vem do Zod), dos links sociais (que vêm
 * do leitor tolerante) e do vínculo do palestrante com a atividade dependeria de
 * quem os montou. São poucos objetos e todos têm forma fechada — declará-los é
 * mais barato do que descobrir a diferença em um `ETag` que não bate.
 */
export const API_NESTED_FIELD_ORDER = {
  evento: {
    tenant: ['slug', 'name'],
    theme: [
      'primaryColor',
      'secondaryColor',
      'accentColor',
      'backgroundColor',
      'textColor',
      'colorMode',
      'radius',
      'fontFamily',
      'spacing',
      'heroStyle',
      'animation',
      'heroImageUrl',
    ],
  },
  atividades: {},
  palestrantes: {
    socialLinks: ['linkedin', 'github', 'lattes', 'instagram', 'youtube', 'website'],
    activities: ['activityId', 'activitySlug', 'title', 'roleTitle'],
  },
  patrocinadores: {},
  chamadas: {},
} as const satisfies Record<ApiResource, Record<string, readonly string[]>>;

/** A ordem do envelope. `etag` e `count` são opcionais e entram nessa posição. */
export const API_META_FIELD_ORDER = ['generatedAt', 'etag', 'count'] as const;

// ───────────────────────────────────────────────────────────────────────────────
//  A LISTA FECHADA
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os campos que NUNCA atravessam a fronteira da API.
 *
 * A lista é por NOME de chave normalizado (minúsculo, sem acento e sem
 * pontuação), porque as três armadilhas reais são:
 *   • o campo mudar de `onlineUrl` para `online_url`/`online-url` e escapar de
 *     uma comparação literal;
 *   • o dado chegar aninhado (`data.page.settings...`), não só no topo;
 *   • o nome vir em português no próximo mapper (`inscrição`, `presença`).
 *
 * `API_FORBIDDEN_PREFIXES` cobre famílias inteiras (toda chave que comece por
 * `waitlist` é lista de espera; toda chave que comece por `participant` é dado
 * de participante). Um prefixo só entra quando a família INTEIRA é proibida —
 * prefixo frouxo reprovaria campo legítimo e ensinaria a desligar a catraca.
 */
export interface ApiForbiddenField {
  /** O nome como ele aparece no JSON (a lista de prefixos é separada). */
  readonly campo: string;
  /** Por que ele não pode sair. A frase é lida no relatório do teste. */
  readonly motivo: string;
}

export const API_FORBIDDEN_FIELDS: readonly ApiForbiddenField[] = [
  // ── Endereço da sala online (F68/F71) ──────────────────────────────────────
  { campo: 'onlineUrl', motivo: 'endereço da sala online — só quem tem lugar vê; a API não tem sessão.' },
  { campo: 'roomUrl', motivo: 'endereço da sala online, sob outro nome.' },
  { campo: 'meetingUrl', motivo: 'endereço da sala online, sob outro nome.' },
  { campo: 'streamUrl', motivo: 'endereço de transmissão da sala online.' },
  { campo: 'joinUrl', motivo: 'endereço de entrada da sala online.' },
  { campo: 'broadcastUrl', motivo: 'endereço de transmissão da sala online.' },
  { campo: 'webinarUrl', motivo: 'endereço da sala online, sob outro nome.' },

  // ── Dado de participante (nome, inscrição, presença, e-mail) ───────────────
  { campo: 'participant', motivo: 'dado de participante.' },
  { campo: 'participantId', motivo: 'identificador de participante.' },
  { campo: 'participantName', motivo: 'nome de participante.' },
  { campo: 'participantEmail', motivo: 'e-mail de participante.' },
  { campo: 'registration', motivo: 'inscrição de participante.' },
  { campo: 'registrationId', motivo: 'identificador de inscrição.' },
  { campo: 'registrationStatus', motivo: 'situação de inscrição de participante.' },
  { campo: 'registrationAnswers', motivo: 'respostas do formulário de inscrição.' },
  { campo: 'attendee', motivo: 'dado de participante.' },
  { campo: 'attendeeName', motivo: 'nome de participante.' },
  { campo: 'attendance', motivo: 'presença de participante.' },
  { campo: 'attendanceCount', motivo: 'contador de presença de participante.' },
  { campo: 'presence', motivo: 'presença de participante.' },
  { campo: 'checkIn', motivo: 'registro de presença de participante.' },
  { campo: 'checkedInAt', motivo: 'instante de presença de participante.' },
  { campo: 'badge', motivo: 'crachá de participante.' },
  { campo: 'badgeToken', motivo: 'código do crachá de participante.' },
  { campo: 'user', motivo: 'conta de participante.' },
  { campo: 'userId', motivo: 'identificador de conta de participante.' },
  { campo: 'email', motivo: 'e-mail — o organizador só o expõe se o declarar público.' },
  { campo: 'emailMasked', motivo: 'e-mail, ainda que mascarado.' },
  { campo: 'contactEmail', motivo: 'e-mail de contato — dado do organizador/patrocinador.' },
  { campo: 'contactPhone', motivo: 'telefone de contato — dado do organizador/patrocinador.' },
  { campo: 'contactName', motivo: 'nome do contato comercial do patrocinador.' },
  { campo: 'phone', motivo: 'telefone de participante ou contato.' },
  { campo: 'telefone', motivo: 'telefone de participante ou contato.' },
  { campo: 'celular', motivo: 'telefone de participante ou contato.' },
  { campo: 'cpf', motivo: 'CPF — dado sensível, vive nas respostas do formulário.' },
  { campo: 'documento', motivo: 'documento fiscal de participante.' },
  { campo: 'answers', motivo: 'respostas do formulário do organizador.' },
  { campo: 'respostas', motivo: 'respostas do formulário do organizador.' },
  { campo: 'formAnswers', motivo: 'respostas do formulário do organizador.' },
  { campo: 'formResponses', motivo: 'respostas do formulário do organizador.' },
  { campo: 'responses', motivo: 'respostas do formulário do organizador.' },
  { campo: 'proposalData', motivo: 'dados brutos da proposta do autor.' },
  { campo: 'organizers', motivo: 'pessoas da equipe — nome, foto e contato sob outra régua.' },
  { campo: 'teams', motivo: 'pessoas da equipe — nome, foto e contato sob outra régua.' },
  { campo: 'members', motivo: 'pessoas da equipe — nome, foto e contato sob outra régua.' },
  { campo: 'memberCount', motivo: 'contagem de pessoas da equipe.' },

  // ── Lista de espera e posições ─────────────────────────────────────────────
  { campo: 'position', motivo: 'posição na lista de espera ou na fila.' },
  { campo: 'queuePosition', motivo: 'posição na lista de espera.' },
  { campo: 'waitlistPosition', motivo: 'posição na lista de espera.' },
  { campo: 'waitlistEntry', motivo: 'linha da lista de espera.' },
  { campo: 'waitlistEntries', motivo: 'linhas da lista de espera.' },

  // ── Descontos e cupons ─────────────────────────────────────────────────────
  { campo: 'coupon', motivo: 'cupom de desconto — regra comercial interna.' },
  { campo: 'coupons', motivo: 'cupons de desconto — regra comercial interna.' },
  { campo: 'cupom', motivo: 'cupom de desconto — regra comercial interna.' },
  { campo: 'cupons', motivo: 'cupons de desconto — regra comercial interna.' },
  { campo: 'discount', motivo: 'desconto — regra comercial interna.' },
  { campo: 'discounts', motivo: 'descontos — regra comercial interna.' },
  { campo: 'desconto', motivo: 'desconto — regra comercial interna.' },
  { campo: 'descontos', motivo: 'descontos — regra comercial interna.' },

  // ── Contadores internos de operação ────────────────────────────────────────
  { campo: 'confirmedCount', motivo: 'contador interno de vagas confirmadas.' },
  { campo: 'waitlistCount', motivo: 'contador interno da lista de espera.' },
  { campo: 'roomCapacity', motivo: 'teto operacional da sala.' },
  { campo: 'checkInEnabled', motivo: 'configuração operacional de credenciamento.' },
  { campo: 'proposals', motivo: 'quantidade de propostas recebidas — contador de operação.' },
  { campo: 'proposalCount', motivo: 'quantidade de propostas recebidas — contador de operação.' },
  { campo: 'decided', motivo: 'quantidade de propostas decididas — contador de operação.' },
  { campo: 'decidedCount', motivo: 'quantidade de propostas decididas — contador de operação.' },
  { campo: 'submissionCount', motivo: 'quantidade de submissões — contador de operação.' },
  { campo: 'maxSubmissionsPerAuthor', motivo: 'regra operacional de limite por autor.' },
  { campo: 'requiresBlindReview', motivo: 'regra operacional de avaliação cega.' },

  // ── Rascunho e publicação ──────────────────────────────────────────────────
  { campo: 'draft', motivo: 'conteúdo de rascunho.' },
  { campo: 'isDraft', motivo: 'estado de rascunho.' },
  { campo: 'isPublished', motivo: 'estado de publicação — a API só serve o que já está no ar.' },
  { campo: 'publishAt', motivo: 'agendamento de publicação.' },
  { campo: 'unpublishAt', motivo: 'janela de exibição.' },
  { campo: 'archivedAt', motivo: 'arquivamento.' },
  { campo: 'deletedAt', motivo: 'exclusão lógica.' },
  { campo: 'page', motivo: 'página do evento — contém blocos e rascunho.' },
  { campo: 'pages', motivo: 'páginas do evento — contêm blocos e rascunho.' },
  { campo: 'blocks', motivo: 'blocos do editor visual.' },
  { campo: 'settings', motivo: 'configurações internas do evento.' },
  { campo: 'metadata', motivo: 'metadados internos.' },
  { campo: 'createdAt', motivo: 'carimbo interno de criação.' },
  { campo: 'updatedAt', motivo: 'carimbo interno de atualização.' },

  // ── Segredos ───────────────────────────────────────────────────────────────
  { campo: 'token', motivo: 'token de acesso ou de link selado.' },
  { campo: 'secret', motivo: 'segredo.' },
  { campo: 'password', motivo: 'senha.' },
  { campo: 'passwordHash', motivo: 'hash de senha.' },
  { campo: 'apiKey', motivo: 'chave de API.' },
  { campo: 'hash', motivo: 'hash interno.' },
];

/**
 * Famílias em que TODO campo é proibido.
 *
 * A escolha é conservadora: `waitlistEnabled` também cai, embora a página o
 * mostre — a API não precisa da política de espera para exibir conteúdo, e uma
 * allowlist estreita é mais fácil de defender do que uma exceção.
 */
export const API_FORBIDDEN_PREFIXES = [
  'waitlist',
  'participant',
  'attendee',
  'attendance',
  'cpf',
  'badge',
  'email',
  'checkin',
] as const;

/** Normaliza a chave para comparar nomes que mudaram de grafia. */
export function normalizeApiFieldName(field: string): string {
  return field
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const FORBIDDEN_EXACT: ReadonlySet<string> = new Set(
  [
    ...API_FORBIDDEN_FIELDS.map((entry) => entry.campo),
    /**
     * Equivalentes em português: os mappers desta casa são escritos em português,
     * e uma chave `inscrição`/`presença` seria o mesmo vazamento com outro nome.
     */
    'inscricao',
    'inscricoes',
    'presenca',
    'presencas',
    'filaDeEspera',
    'posicaoNaFila',
  ].map(normalizeApiFieldName),
);

const FORBIDDEN_PREFIXES: readonly string[] = API_FORBIDDEN_PREFIXES.map(normalizeApiFieldName);

export interface ApiForbiddenFieldFound {
  readonly campo: string;
  readonly caminho: string;
}

/** O erro que o serviço registra e transforma em resposta de falha. */
export class ApiProjectionLeakError extends Error {
  constructor(
    readonly resource: ApiResource,
    readonly campo: string,
    readonly caminho: string,
  ) {
    super(
      `A projeção da API para "${resource}" tentou devolver o campo proibido "${campo}" em ${caminho}. ` +
        'O campo não é filtrado em silêncio: a projeção é recusada inteira (fail-closed).',
    );
    this.name = 'ApiProjectionLeakError';
  }
}

/** O erro de contrato: chave fora da ordem canônica declarada. */
export class ApiContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiContractError';
  }
}

/**
 * Procura o primeiro campo proibido em QUALQUER profundidade.
 *
 * Devolve o caminho (`data.atividades[0].onlineUrl`) para o relatório dizer onde
 * o campo entrou, em vez de só dizer que ele existe. `null` = projeção limpa.
 */
export function findForbiddenApiField(value: unknown): ApiForbiddenFieldFound | null {
  return walk(value, 'data');
}

function walk(value: unknown, path: string): ApiForbiddenFieldFound | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = walk(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isPlainObject(value)) return null;

  for (const [field, nested] of Object.entries(value)) {
    if (isForbiddenField(field)) return { campo: field, caminho: `${path}.${field}` };

    const found = walk(nested, `${path}.${field}`);
    if (found) return found;
  }

  return null;
}

function isForbiddenField(field: string): boolean {
  const normalized = normalizeApiFieldName(field);

  if (FORBIDDEN_EXACT.has(normalized)) return true;

  return FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Reprova a projeção inteira quando um campo da lista fechada aparece nela.
 *
 * É `assert` de propósito: o chamador que ignorar o retorno (não há retorno) não
 * consegue seguir em frente com o dado. Ver o cabeçalho para a justificativa de
 * não filtrar.
 */
export function assertApiProjectionSemCampoProibido(
  resource: ApiResource,
  value: unknown,
): void {
  const found = findForbiddenApiField(value);
  if (found) throw new ApiProjectionLeakError(resource, found.campo, found.caminho);
}

// ───────────────────────────────────────────────────────────────────────────────
//  O ENVELOPE E A ORDEM
// ───────────────────────────────────────────────────────────────────────────────
export interface ApiEnvelopeMeta {
  generatedAt: string;
  etag?: string;
  count?: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiEnvelopeMeta;
}

/**
 * Converte o dado para JSON PRIMITIVO e estável.
 *
 * `Date` vira ISO-8601 UTC — o mesmo formato que o `JSON.stringify` do route
 * handler produziria, mas SEM depender dele: a fatia 2 vai calcular o `ETag`
 * sobre o conteúdo canônico, e `toJSON` implícito é mais uma camada em que a
 * ordem pode mudar. `undefined` deixa de existir (chave ausente, não `null`).
 */
export function toApiJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map((item) => toApiJson(item));

  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};

    for (const [field, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      output[field] = toApiJson(nested);
    }

    return output;
  }

  return value;
}

/**
 * Monta `{ data, meta }` com a ordem canônica do recurso.
 *
 * `generatedAt` entra por PARÂMETRO: o domínio não lê relógio. A função é pura e
 * determinística — o mesmo dado e o mesmo instante produzem o mesmo envelope.
 *
 * `etag` é opcional porque a fatia 2 o calcula sobre este resultado; `count`
 * aparece sozinho quando `data` é lista (é a contagem da resposta, não contador
 * interno de operação).
 */
export function buildApiEnvelope<T>(input: {
  resource: ApiResource;
  data: T;
  generatedAt: Date;
  etag?: string;
}): ApiEnvelope<T> {
  const json = toApiJson(input.data);

  assertApiProjectionSemCampoProibido(input.resource, json);

  const ordered = orderApiData(input.resource, json) as T;

  const meta: ApiEnvelopeMeta = { generatedAt: input.generatedAt.toISOString() };

  if (input.etag !== undefined) meta.etag = input.etag;

  if (Array.isArray(ordered)) meta.count = ordered.length;

  return { data: ordered, meta };
}

/** Aplica a ordem canônica ao dado (topo e objetos aninhados declarados). */
export function orderApiData(resource: ApiResource, value: unknown): unknown {
  return orderValue(value, API_FIELD_ORDER[resource], API_NESTED_FIELD_ORDER[resource], 'data');
}

function orderValue(
  value: unknown,
  order: readonly string[],
  nestedOrder: Record<string, readonly string[]>,
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => orderValue(item, order, nestedOrder, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    throw new ApiContractError(`A projeção em ${path} deveria ser um objeto para ter ordem canônica.`);
  }

  return orderRecord(value, order, nestedOrder, path);
}

function orderRecord(
  record: Record<string, unknown>,
  order: readonly string[],
  nestedOrder: Record<string, readonly string[]>,
  path: string,
): Record<string, unknown> {
  const known = new Set(order);

  /**
   * Chave fora da ordem declarada é ERRO, não "vai no fim". A lista canônica é o
   * contrato do recurso: um campo novo só entra quando alguém decide que ele
   * entra — e decide junto em que posição. O teste de unidade prende a mesma
   * coisa sem precisar de banco.
   */
  for (const field of Object.keys(record)) {
    if (!known.has(field)) {
      throw new ApiContractError(
        `A projeção em ${path} tem o campo "${field}", que não está na ordem canônica do recurso.`,
      );
    }
  }

  const output: Record<string, unknown> = {};

  for (const field of order) {
    if (!(field in record)) continue;

    const value = record[field];
    const nested = nestedOrder[field];

    output[field] = nested
      ? orderValue(value, nested, {}, `${path}.${field}`)
      : value;
  }

  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}
