/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Perfil público do participante (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A IDEIA EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa escolhe **o que** aparece, **para quem** e **onde** — e o sistema monta
 *  o pacote campo a campo, com a mesma régua para a página, para a listagem e para
 *  qualquer rota futura.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS DECISÕES QUE DEFINEM TUDO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. **NÃO SE PAGA POR CONSENTIR.** Tornar o perfil público não credita XP. A FASE
 *     42 estabeleceu que consentimento não é pedágio (LGPD art. 8º §3º), e um
 *     "bônus por ser público" colocaria quem quer privacidade em desvantagem no
 *     jogo. A vitrine tem moldura, título e nível — o ato de autorizar, não.
 *
 *  2. **INTERESSE É DECLARADO, NUNCA INFERIDO.** Derivar interesses do que a pessoa
 *     assistiu é criar perfil comportamental — dado inferido, e mais sensível que o
 *     declarado. O que ela escreve é dela; o que o sistema deduz é vigilância com
 *     outro nome.
 *
 *  3. **O PACOTE É MONTADO CAMPO A CAMPO.** `buildPublicProfile` recebe a fonte
 *     completa e os campos autorizados, e devolve **só** o que passou pela régua.
 *     `PUBLIC_PROFILE_SHARE_KEYS` existe para o teste de igualdade: um campo novo no
 *     modelo que não tenha decisão de visibilidade **reprova** em vez de vazar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { CardRarity } from '@/domain/gamification/types';

// ───────────────────────────────────────────────────────────────────────────────
//  Visibilidade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Quem vê um campo. Os três valores são os MESMOS do material do palestrante
 * (FASE 25) de propósito: a plataforma tem um vocabulário só para "quem pode ver".
 */
export const PROFILE_AUDIENCES = ['PUBLIC', 'ATTENDEES_ONLY', 'PRIVATE'] as const;

export type ProfileAudience = (typeof PROFILE_AUDIENCES)[number];

export const PROFILE_AUDIENCE_LABELS: Readonly<Record<ProfileAudience, string>> = {
  PUBLIC: 'Qualquer pessoa na internet',
  ATTENDEES_ONLY: 'Só quem participa desta instituição',
  PRIVATE: 'Só eu',
};

export const PROFILE_AUDIENCE_HINTS: Readonly<Record<ProfileAudience, string>> = {
  PUBLIC: 'Aparece na página pública do seu perfil, para qualquer visitante.',
  ATTENDEES_ONLY: 'Aparece para quem entra na plataforma e tem vínculo ou inscrição nesta instituição.',
  PRIVATE: 'Não aparece para ninguém além de você (nem na sua própria página pública).',
};

/** Quem está olhando. `AUDIENCE` = autenticado COM vínculo ou inscrição na casa. */
export const PROFILE_VIEWERS = ['OWNER', 'AUDIENCE', 'ANONYMOUS'] as const;

export type ProfileViewer = (typeof PROFILE_VIEWERS)[number];

export function profileViewerOf(input: {
  isOwner: boolean;
  isInstitutionAudience: boolean;
}): ProfileViewer {
  if (input.isOwner) return 'OWNER';
  return input.isInstitutionAudience ? 'AUDIENCE' : 'ANONYMOUS';
}

/** O que cada tipo de visitante enxerga. O dono vê tudo (é a prévia). */
const AUDIENCES_FOR_VIEWER: Readonly<Record<ProfileViewer, readonly ProfileAudience[]>> = {
  OWNER: ['PUBLIC', 'ATTENDEES_ONLY', 'PRIVATE'],
  AUDIENCE: ['PUBLIC', 'ATTENDEES_ONLY'],
  ANONYMOUS: ['PUBLIC'],
};

// ───────────────────────────────────────────────────────────────────────────────
//  Os campos do perfil
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Todo campo exibível tem nome próprio, rótulo em português e um padrão.
 *
 * Os padrões foram escolhidos para o perfil ser ÚTIL sem susto: identidade e
 * conquista visíveis (é o que motiva), números e histórico só para quem participa
 * (é o que expõe), e nada disso na internet sem a pessoa querer.
 */
export const PUBLIC_PROFILE_FIELDS = [
  'displayName',
  'avatar',
  'headline',
  'bio',
  'interests',
  'links',
  'level',
  'xp',
  'streak',
  'pinnedCards',
  'collection',
  'eventCount',
  'events',
  'certificates',
  'standing',
] as const;

export type PublicProfileField = (typeof PUBLIC_PROFILE_FIELDS)[number];

export const PUBLIC_PROFILE_FIELD_LABELS: Readonly<Record<PublicProfileField, string>> = {
  displayName: 'Nome',
  avatar: 'Foto',
  headline: 'Título profissional',
  bio: 'Sobre você',
  interests: 'Interesses',
  links: 'ORCID, Lattes e site',
  level: 'Nível, título e prestígio',
  xp: 'XP total',
  streak: 'Dias seguidos de participação',
  pinnedCards: 'Cartas em destaque',
  collection: 'Resumo da coleção',
  eventCount: 'Quantos eventos participou',
  events: 'Quais eventos participou',
  certificates: 'Certificados',
  standing: 'Sua posição relativa (top % do evento)',
};

export const PUBLIC_PROFILE_FIELD_HINTS: Readonly<Record<PublicProfileField, string>> = {
  displayName:
    'O nome do seu cadastro na plataforma. Privado, a página mostra só o seu @handle — o nome não muda por aqui.',
  avatar: 'A mesma foto do seu perfil na plataforma.',
  headline: 'Uma linha: o que você faz. Ex.: "Pesquisadora em saúde pública".',
  bio: 'Um parágrafo curto sobre você.',
  interests: 'Escritos por você — o sistema nunca deduz interesse do que você assistiu.',
  links: 'ORCID, Lattes e o seu site.',
  level: 'Nível, título e prestígio.',
  xp: 'O número exato de XP. Desligado, a página mostra o nível e poupa comparações.',
  streak: 'Quantos dias seguidos de participação.',
  pinnedCards: 'Até três cartas que você escolheu destacar (o álbum inteiro continua privado).',
  collection: 'Quantas cartas você tem e as raridades — sem listar as secretas.',
  eventCount: 'Só o número.',
  events: 'A lista dos eventos que você AUTORIZAR um a um. Nunca mostra datas, minutos ou atividades internas.',
  certificates: 'Com o link público de validação de cada um.',
  standing: 'Só a sua posição ("top 10%"), nunca o ranking com o nome de outras pessoas.',
};

export const DEFAULT_PROFILE_AUDIENCES: Readonly<Record<PublicProfileField, ProfileAudience>> = {
  displayName: 'PUBLIC',
  avatar: 'PUBLIC',
  headline: 'PUBLIC',
  bio: 'PUBLIC',
  interests: 'PUBLIC',
  links: 'PUBLIC',
  level: 'PUBLIC',
  xp: 'ATTENDEES_ONLY',
  streak: 'ATTENDEES_ONLY',
  pinnedCards: 'PUBLIC',
  collection: 'ATTENDEES_ONLY',
  eventCount: 'PUBLIC',
  events: 'ATTENDEES_ONLY',
  certificates: 'PUBLIC',
  standing: 'ATTENDEES_ONLY',
};

/**
 * O que SAI do servidor quando tudo está autorizado.
 *
 * É a allowlist do pacote. O teste de igualdade garante que `buildPublicProfile`
 * devolve exatamente estas chaves — acrescentar campo ao modelo sem decidir a
 * visibilidade dele passa a reprovar em vez de vazar.
 */
export const PUBLIC_PROFILE_SHARE_KEYS = [
  'username',
  'displayName',
  'avatarUrl',
  'headline',
  'bio',
  'interests',
  'siteUrl',
  'orcidId',
  'lattesId',
  'level',
  'levelTitle',
  'prestige',
  'xp',
  'streak',
  'pinnedCards',
  'collection',
  'eventCount',
  'events',
  'certificates',
  'standing',
] as const;

export type PublicProfileShareKey = (typeof PUBLIC_PROFILE_SHARE_KEYS)[number];

function isProfileAudience(value: unknown): value is ProfileAudience {
  return typeof value === 'string' && (PROFILE_AUDIENCES as readonly string[]).includes(value);
}

/**
 * Lê a matriz gravada, **preenchendo o que falta com o padrão**.
 *
 * Nunca lança: `profileAudiences` é JSON livre no banco, e uma linha corrompida não
 * pode derrubar a página pública de ninguém — o pior caso aceitável é voltar ao
 * padrão, que já é conservador.
 */
export function parseProfileAudiences(
  raw: unknown,
): Record<PublicProfileField, ProfileAudience> {
  const parsed: Record<PublicProfileField, ProfileAudience> = { ...DEFAULT_PROFILE_AUDIENCES };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return parsed;

  const record = raw as Record<string, unknown>;

  for (const field of PUBLIC_PROFILE_FIELDS) {
    const value = record[field];
    if (isProfileAudience(value)) parsed[field] = value;
  }

  return parsed;
}

/** Os campos que ESTE visitante enxerga, na ordem em que a página os mostra. */
export function visibleProfileFields(input: {
  audiences: Record<PublicProfileField, ProfileAudience>;
  viewer: ProfileViewer;
}): PublicProfileField[] {
  const allowed = AUDIENCES_FOR_VIEWER[input.viewer];

  return PUBLIC_PROFILE_FIELDS.filter((field) => allowed.includes(input.audiences[field]));
}

export interface PublicProfileEvaluation {
  /** O que a página pode mostrar para este visitante. */
  visibleFields: PublicProfileField[];
  /**
   * `false` = a página NÃO existe para este visitante (404).
   *
   * É o caso de um perfil com todos os campos privados: dizer "existe, mas você não
   * pode ver" já seria revelar a existência daquele handle.
   */
  pageVisible: boolean;
  /** Há mais coisa para quem entrar — a página convida a entrar, sem mentir. */
  moreForAttendees: boolean;
}

/**
 * A régua da página: o que mostrar, e se ela existe para este visitante.
 *
 * ─── DUAS CONDIÇÕES, NÃO UMA ─────────────────────────────────────────────────
 *
 *  A página só existe onde a PESSOA tem vínculo: perfil de quem nunca participou desta
 *  instituição responde 404, mesmo com tudo público. Sem isso, o `@handle` (que é
 *  global) viraria uma porta para ler nome, foto, bio e interesses de qualquer pessoa
 *  dentro do site de QUALQUER instituição — e a tabela `user` é global, então a RLS não
 *  segura isso por nós (é a mesma armadilha que a ficha 360 da FASE 32 documenta).
 *
 *  O dono é a exceção: ele vê a própria prévia em qualquer lugar, porque é ele olhando
 *  o que ele mesmo configurou. Para os demais, ainda vale a segunda condição — ao menos
 *  um campo visível, ou 404 (dizer "existe, mas você não pode ver" já revelaria o
 *  handle).
 */
export function evaluatePublicProfile(input: {
  audiences: Record<PublicProfileField, ProfileAudience>;
  viewer: ProfileViewer;
  hasUsername: boolean;
  /** A pessoa do perfil participa DESTA instituição (vínculo ativo ou inscrição). */
  belongsToInstitution: boolean;
}): PublicProfileEvaluation {
  if (!input.hasUsername) {
    return { visibleFields: [], pageVisible: false, moreForAttendees: false };
  }

  if (!input.belongsToInstitution && input.viewer !== 'OWNER') {
    return { visibleFields: [], pageVisible: false, moreForAttendees: false };
  }

  const visibleFields = visibleProfileFields({
    audiences: input.audiences,
    viewer: input.viewer,
  });

  const moreForAttendees =
    input.viewer === 'ANONYMOUS' &&
    PUBLIC_PROFILE_FIELDS.some(
      (field) => input.audiences[field] === 'ATTENDEES_ONLY' && !visibleFields.includes(field),
    );

  if (input.viewer === 'OWNER') {
    return { visibleFields: [...PUBLIC_PROFILE_FIELDS], pageVisible: true, moreForAttendees };
  }

  return { visibleFields, pageVisible: visibleFields.length > 0, moreForAttendees };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O @handle
// ───────────────────────────────────────────────────────────────────────────────
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * Palavras que o handle NÃO pode ser.
 *
 * Não é preciosismo: `admin`, `api`, `painel` e `validar` são rotas reais desta
 * plataforma, e um perfil em `/t/<slug>/u/admin` confundiria gente e ferramenta.
 * `u` entra porque é o prefixo da própria rota do perfil.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  'admin',
  'administracao',
  'api',
  'app',
  'ajuda',
  'cadastro',
  'certificados',
  'comite',
  'conquistas',
  'convite',
  'dashboard',
  'equipe',
  'eventos',
  'instituicao',
  'instituicao-bloqueada',
  'login',
  'meu-cracha',
  'meu-perfil',
  'meu-perfil-publico',
  'meus-compartilhamentos',
  'meus-dados',
  'minhas-inscricoes',
  'minhas-mensagens',
  'organizacoes',
  'painel',
  'participantes',
  'patrocinador',
  'perfil',
  'root',
  'signup',
  'sobre',
  'suporte',
  'superadmin',
  't',
  'u',
  'validar',
  'verificacao',
];

/** Trocar de handle é raro e caro (o endereço antigo vira 404): 30 dias de espera. */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

/** Minúsculas, sem acento, sem espaço e sem símbolo: `Ana Souza` → `ana-souza`. */
export function normalizeUsername(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export type UsernameRefusalCode =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_CHARS'
  | 'RESERVED'
  | 'TAKEN';

export type UsernameVerdict =
  | { ok: true; username: string }
  | { ok: false; code: UsernameRefusalCode; message: string };

/**
 * Valida e NORMALIZA o handle.
 *
 * A checagem de `TAKEN` não mora aqui (o domínio é puro e não consulta o banco): o
 * serviço faz a leitura e devolve `TAKEN` — e o índice único do banco é a palavra
 * final, porque duas pessoas podem confirmar no mesmo instante (invariante 5).
 */
export function validateUsername(raw: string | null | undefined): UsernameVerdict {
  const original = (raw ?? '').trim();
  const username = normalizeUsername(original);

  if (username.length === 0) {
    return { ok: false, code: 'INVALID_CHARS', message: 'O @handle precisa ter letras ou números.' };
  }

  if (username.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: `O @handle precisa ter ao menos ${USERNAME_MIN_LENGTH} caracteres.`,
    };
  }

  if (username.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `O @handle pode ter no máximo ${USERNAME_MAX_LENGTH} caracteres.`,
    };
  }

  /** Depois de normalizar, o que sobra válido é só `a-z 0-9 -`. */
  if (!/^[a-z0-9-]+$/.test(username)) {
    return {
      ok: false,
      code: 'INVALID_CHARS',
      message: 'Use apenas letras sem acento, números e hífen.',
    };
  }

  if (RESERVED_USERNAMES.includes(username)) {
    return {
      ok: false,
      code: 'RESERVED',
      message: 'Este @handle é reservado pela plataforma. Escolha outro.',
    };
  }

  return { ok: true, username };
}

export interface UsernameChangeState {
  canChange: boolean;
  /** Quando a próxima troca será permitida (nulo = pode agora). */
  nextAllowedAt: Date | null;
  daysLeft: number;
}

/**
 * A espera entre trocas, decidida no domínio.
 *
 * O handle é o ENDEREÇO do perfil: trocar quebra todo link compartilhado. O prazo
 * não é punição — é o que impede alguém de "colecionar" endereços que os outros
 * estão usando para chegar até ele.
 */
export function usernameChangeState(input: {
  lastChangedAt: Date | null;
  now: Date;
}): UsernameChangeState {
  if (!input.lastChangedAt) return { canChange: true, nextAllowedAt: null, daysLeft: 0 };

  const nextAllowedAt = new Date(
    input.lastChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * 86_400_000,
  );

  if (nextAllowedAt.getTime() <= input.now.getTime()) {
    return { canChange: true, nextAllowedAt: null, daysLeft: 0 };
  }

  const daysLeft = Math.ceil((nextAllowedAt.getTime() - input.now.getTime()) / 86_400_000);

  return { canChange: false, nextAllowedAt, daysLeft };
}

/** O nome que a página mostra: o escolhido, ou o próprio handle quando vazio. */
export function resolvePublicDisplayName(input: {
  displayName: string | null | undefined;
  username: string;
}): string {
  const chosen = (input.displayName ?? '').trim();
  return chosen.length > 0 ? chosen : `@${input.username}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O que a pessoa declara
// ───────────────────────────────────────────────────────────────────────────────
export const MAX_INTERESTS = 6;
export const INTEREST_MIN_LENGTH = 2;
export const INTEREST_MAX_LENGTH = 24;
export const PUBLIC_BIO_MAX_LENGTH = 280;
export const PUBLIC_HEADLINE_MAX_LENGTH = 120;

/**
 * Interesses: lista curta, sem repetição e sem caixa duplicada.
 *
 * `Rust` e `rust` são o mesmo interesse, e mostrar os dois é ruído — por isso a
 * comparação é feita em minúsculas, preservando a grafia que a pessoa escreveu.
 */
export function normalizeInterests(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of raw) {
    const clean = entry.trim().replace(/\s+/g, ' ');

    if (clean.length < INTEREST_MIN_LENGTH || clean.length > INTEREST_MAX_LENGTH) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(clean);

    if (result.length === MAX_INTERESTS) break;
  }

  return result;
}

/** Texto curto e de linha única (título, bio): espaços colapsados, corte no teto. */
export function normalizePublicText(raw: string | null | undefined, max: number): string | null {
  const clean = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length === 0) return null;
  return clean.slice(0, max);
}

/** Site pessoal: só http/https. `javascript:` e `data:` nunca viram link público. */
export function normalizePublicSiteUrl(raw: string | null | undefined): string | null {
  const clean = (raw ?? '').trim();
  if (clean.length === 0) return null;

  try {
    const url = new URL(clean);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Link público do ORCID e do Lattes, quando a pessoa os declarou. */
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export function orcidUrl(orcidId: string | null | undefined): string | null {
  const clean = (orcidId ?? '').replace(/\s+/g, '');
  return ORCID_PATTERN.test(clean) ? `https://orcid.org/${clean}` : null;
}

export function lattesUrl(lattesId: string | null | undefined): string | null {
  const clean = (lattesId ?? '').replace(/\D/g, '');
  return clean.length === 16 ? `http://lattes.cnpq.br/${clean}` : null;
}

/**
 * Identificador acadêmico DIGITADO pela pessoa — vazio limpa, inválido recusa.
 *
 * O identificador entra no perfil como LINK, e um link quebrado é pior do que link
 * nenhum: por isso o formato é conferido aqui, e a mensagem diz o formato esperado em
 * vez de aceitar em silêncio (era o defeito do formulário: dois campos editáveis que
 * ninguém gravava).
 */
export type AcademicIdVerdict =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function normalizeOrcidId(raw: string | null | undefined): AcademicIdVerdict {
  const clean = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (clean.length === 0) return { ok: true, value: null };

  if (!ORCID_PATTERN.test(clean)) {
    return { ok: false, message: 'O ORCID tem o formato 0000-0000-0000-0000 (o último dígito pode ser X).' };
  }

  return { ok: true, value: clean };
}

export function normalizeLattesId(raw: string | null | undefined): AcademicIdVerdict {
  const clean = (raw ?? '').replace(/\D/g, '');
  if (clean.length === 0) return { ok: true, value: null };

  if (clean.length !== 16) {
    return { ok: false, message: 'O ID do Lattes tem 16 dígitos (o endereço lattes.cnpq.br/0000000000000000).' };
  }

  return { ok: true, value: clean };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O pacote que sai do servidor
// ───────────────────────────────────────────────────────────────────────────────
export interface PublicProfileCard {
  name: string;
  rarity: CardRarity;
  imageUrl: string | null;
  isFoil: boolean;
}

export interface PublicProfileEvent {
  title: string;
  /** Ano apenas — mês e dia são movimentação, e não currículo. */
  year: number;
}

export interface PublicProfileCertificate {
  title: string;
  kind: string;
  validationUrl: string;
  workloadLabel: string;
}

export interface PublicProfileSource {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  interests: string[];
  siteUrl: string | null;
  orcidId: string | null;
  lattesId: string | null;
  level: number;
  levelTitle: string;
  prestige: number;
  xp: number;
  streak: number;
  pinnedCards: PublicProfileCard[];
  collection: { owned: number; total: number; byRarity: Record<string, number>; foils: number };
  eventCount: number;
  events: PublicProfileEvent[];
  certificates: PublicProfileCertificate[];
  /** Posição relativa (`top 10` = está entre os 10% melhores). Nula sem base. */
  standing: { topPercent: number; sampleSize: number } | null;
}

/**
 * O pacote pronto: só as chaves autorizadas, e nada além delas.
 *
 * Os campos são OPCIONAIS de propósito — é o tipo que obriga a página a tratar a
 * ausência, em vez de renderizar `undefined` no lugar de um dado que a pessoa não
 * autorizou.
 */
export interface PublicProfilePayload {
  /** Sempre presente: é o endereço da página. */
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  interests?: string[];
  siteUrl?: string | null;
  orcidId?: string | null;
  lattesId?: string | null;
  level?: number;
  levelTitle?: string;
  prestige?: number;
  xp?: number;
  streak?: number;
  pinnedCards?: PublicProfileCard[];
  collection?: { owned: number; total: number; byRarity: Record<string, number>; foils: number };
  eventCount?: number;
  events?: PublicProfileEvent[];
  certificates?: PublicProfileCertificate[];
  standing?: { topPercent: number; sampleSize: number } | null;
}

/** Campo do perfil → chave que ele publica no pacote. */
const SHARE_KEYS_BY_FIELD: Readonly<Record<PublicProfileField, readonly PublicProfileShareKey[]>> = {
  displayName: ['displayName'],
  avatar: ['avatarUrl'],
  headline: ['headline'],
  bio: ['bio'],
  interests: ['interests'],
  links: ['siteUrl', 'orcidId', 'lattesId'],
  level: ['level', 'levelTitle', 'prestige'],
  xp: ['xp'],
  streak: ['streak'],
  pinnedCards: ['pinnedCards'],
  collection: ['collection'],
  eventCount: ['eventCount'],
  events: ['events'],
  certificates: ['certificates'],
  standing: ['standing'],
};

/**
 * Monta o pacote público.
 *
 * `@username` entra SEMPRE: é o endereço da página, e a página só existe porque a
 * pessoa escolheu ter um handle. Todo o resto passa pela lista de campos autorizados
 * — e nada entra por engano, porque a montagem é EXPLÍCITA campo a campo.
 */
export function buildPublicProfile(input: {
  source: PublicProfileSource;
  visibleFields: readonly PublicProfileField[];
}): PublicProfilePayload {
  const { source } = input;
  const allowed = new Set(input.visibleFields);

  const payload: PublicProfilePayload = { username: source.username };

  for (const field of PUBLIC_PROFILE_FIELDS) {
    if (!allowed.has(field)) continue;

    for (const key of SHARE_KEYS_BY_FIELD[field]) {
      switch (key) {
        case 'displayName':
          payload.displayName = resolvePublicDisplayName({
            displayName: source.displayName,
            username: source.username,
          });
          break;
        case 'avatarUrl':
          payload.avatarUrl = source.avatarUrl;
          break;
        case 'headline':
          payload.headline = source.headline;
          break;
        case 'bio':
          payload.bio = source.bio;
          break;
        case 'interests':
          payload.interests = source.interests;
          break;
        case 'siteUrl':
          payload.siteUrl = source.siteUrl;
          break;
        case 'orcidId':
          payload.orcidId = source.orcidId;
          break;
        case 'lattesId':
          payload.lattesId = source.lattesId;
          break;
        case 'level':
          payload.level = source.level;
          break;
        case 'levelTitle':
          payload.levelTitle = source.levelTitle;
          break;
        case 'prestige':
          payload.prestige = source.prestige;
          break;
        case 'xp':
          payload.xp = source.xp;
          break;
        case 'streak':
          payload.streak = source.streak;
          break;
        case 'pinnedCards':
          payload.pinnedCards = source.pinnedCards;
          break;
        case 'collection':
          payload.collection = source.collection;
          break;
        case 'eventCount':
          payload.eventCount = source.eventCount;
          break;
        case 'events':
          payload.events = source.events;
          break;
        case 'certificates':
          payload.certificates = source.certificates;
          break;
        case 'standing':
          payload.standing = source.standing;
          break;
        default:
          break;
      }
    }
  }

  return payload;
}

/**
 * "Top N%" a partir de quantas pessoas a pessoa **supera** — calculado, nunca copiado
 * do ranking.
 *
 * A direção do argumento é a armadilha: `betterThan` é "quantos ficaram atrás de mim",
 * e quem está no topo (que supera todo mundo) recebe **top 1%**, não top 100%. Como o
 * empate é resolvido pelo complemento, duas pessoas com a mesma pontuação recebem a
 * mesma fatia.
 *
 * Devolve só a fatia, e nunca a lista: mostrar "você está em 3º" exige mostrar de
 * quem são o 1º e o 2º, e essas pessoas não autorizaram nada.
 */
export function standingFromRank(input: {
  /** Quantas pessoas na instituição têm MENOS XP que esta. */
  betterThan: number;
  /** Quantas pessoas na instituição têm XP > 0 — a base da comparação. */
  total: number;
}): { topPercent: number; sampleSize: number } | null {
  if (input.total <= 1) return null;

  const better = Math.max(0, Math.min(input.betterThan, input.total));
  const topPercent = Math.max(1, Math.ceil(((input.total - better) / input.total) * 100));

  return { topPercent, sampleSize: input.total };
}
