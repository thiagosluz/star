/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Palestrantes (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO DECIDE (E POR QUE NÃO ESTÁ NO SERVIÇO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cinco decisões, todas com consequência de segurança ou de dinheiro:
 *
 *    1. **Posse** — o palestrante só mexe no que é dele. A pergunta "esta pessoa é
 *       ministrante desta atividade?" é respondida aqui, com dado que o serviço
 *       carrega; a política de RLS continua sendo a última linha.
 *    2. **Visibilidade do material** — `PUBLIC`, `ATTENDEES_ONLY` ou `PRIVATE`. É a
 *       regra que decide se um PDF de aula com dados de paciente pode ser baixado
 *       por qualquer visitante anônimo.
 *    3. **Carga horária** — o certificado de palestrante soma as atividades que ele
 *       EFETIVAMENTE ministrou. Atividade cancelada ou que ainda não terminou não
 *       conta: certificado é declaração de fato consumado.
 *    4. **Convite** — o token é a prova de posse do link, e o e-mail é a identidade.
 *       As duas coisas precisam concordar, e o token nunca é gravado em claro.
 *    5. **Redes sociais** — link colado pelo usuário vira `href` na página pública.
 *       `javascript:` num `href` é XSS com outro nome, então só entra http(s) de
 *       host conhecido para cada rede.
 *
 *  Nada aqui toca Prisma, Next ou React: são funções puras, testadas em
 *  milissegundos (`tests/unit/speaker-portal.test.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { formatBytes } from '../events/image-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Papéis na atividade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Rótulos oferecidos na tela. É uma lista FECHADA de sugestões, não uma allowlist
 * do que pode ser gravado: `roleTitle` é texto livre com 120 caracteres, porque
 * "Coordenadora do GT de Saúde Digital" é um papel legítimo que nenhuma lista
 * preveria. A lista existe para o caso comum ser um clique, não uma digitação.
 */
export const SPEAKER_ROLE_TITLES = [
  'Keynote',
  'Palestrante',
  'Instrutor(a)',
  'Ministrante',
  'Painelista',
  'Mediador(a)',
  'Debatedor(a)',
  'Convidado(a)',
] as const;

export type SpeakerRoleTitle = (typeof SPEAKER_ROLE_TITLES)[number];

export const DEFAULT_ROLE_TITLE = 'Palestrante';

export const MAX_ROLE_TITLE_LENGTH = 120;
export const MAX_SPEAKER_NAME_LENGTH = 160;
export const MAX_SPEAKER_BIO_LENGTH = 4000;
export const MAX_SPEAKER_INSTITUTION_LENGTH = 200;

// ───────────────────────────────────────────────────────────────────────────────
//  Redes e páginas
// ───────────────────────────────────────────────────────────────────────────────
export const SOCIAL_NETWORKS = [
  'linkedin',
  'github',
  'lattes',
  'website',
  'instagram',
  'youtube',
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  lattes: 'Lattes',
  website: 'Site',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

/**
 * Hosts aceitos por rede.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LISTA É POR REDE, E NÃO UMA LISTA ÚNICA DE HOSTS "CONFIÁVEIS"
 * ─────────────────────────────────────────────────────────────────────────────
 *  O campo é rotulado "LinkedIn" na tela e vira link na página pública. Aceitar
 *  qualquer host ali transformaria o rótulo em mentira: um link marcado como
 *  LinkedIn que leva a um domínio de phishing se apoia na confiança do rótulo. O
 *  `website` é o único sem restrição de host (é o site da pessoa), e por isso exige
 *  http(s) como todos os outros.
 */
const NETWORK_HOSTS: Record<SocialNetwork, readonly string[]> = {
  linkedin: ['linkedin.com', 'www.linkedin.com', 'br.linkedin.com'],
  github: ['github.com', 'www.github.com', 'gist.github.com'],
  lattes: ['lattes.cnpq.br', 'buscatextual.cnpq.br', 'www.lattes.cnpq.br'],
  instagram: ['instagram.com', 'www.instagram.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  website: [],
};

export type SocialLinkError =
  | { network: SocialNetwork; code: 'INVALID_URL'; message: string }
  | { network: SocialNetwork; code: 'UNSUPPORTED_HOST'; message: string }
  | { network: SocialNetwork; code: 'NOT_HTTP'; message: string };

export type SocialLinks = Partial<Record<SocialNetwork, string>>;

export type SocialLinksResult =
  | { ok: true; links: SocialLinks }
  | { ok: false; errors: readonly SocialLinkError[] };

/**
 * Normaliza e valida os links informados.
 *
 * Campo vazio é simplesmente ausente (`undefined`) — a tela manda string vazia
 * quando o organizador não preenche, e gravar `''` faria a página pública
 * renderizar um `<a href="">` que recarrega a própria página ao ser clicado.
 *
 * Sem esquema (`linkedin.com/in/fulano`) o `https://` é assumido: é o que a pessoa
 * quis dizer, e recusar por isso seria burocracia. COM esquema, só `http` e `https`
 * passam — `javascript:` e `data:` são recusados e o motivo é dito.
 */
export function sanitizeSocialLinks(input: Record<string, unknown>): SocialLinksResult {
  const links: SocialLinks = {};
  const errors: SocialLinkError[] = [];

  for (const network of SOCIAL_NETWORKS) {
    if (input[network] === undefined || input[network] === null) continue;

    const result = sanitizeOne(network, input[network]);

    if (result.ok) {
      if (result.url) links[network] = result.url;
      continue;
    }

    errors.push(result.error);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, links };
}

/**
 * Lê os links gravados (JSON da coluna) descartando o que não é mais válido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LEITURA É TOLERANTE E A ESCRITA NÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Na ESCRITA, um link inválido é recusado com o motivo — quem colou precisa saber.
 *  Na LEITURA, descartar o conjunto inteiro por causa de UM valor ruim apagaria os
 *  outros três da página: basta o host de uma rede sair da allowlist para o perfil
 *  perder todas as redes de uma vez. Aqui o link ruim some sozinho.
 */
export function readSocialLinks(value: unknown): SocialLinks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const links: SocialLinks = {};

  for (const network of SOCIAL_NETWORKS) {
    const result = sanitizeOne(network, (value as Record<string, unknown>)[network]);
    if (result.ok && result.url) links[network] = result.url;
  }

  return links;
}

type SanitizeOneResult =
  | { ok: true; url: string | null }
  | { ok: false; error: SocialLinkError };

/** Valida UM link: é a peça que a escrita (estrita) e a leitura (tolerante) usam. */
function sanitizeOne(network: SocialNetwork, raw: unknown): SanitizeOneResult {
  if (raw === undefined || raw === null) return { ok: true, url: null };

  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: { network, code: 'INVALID_URL', message: `${SOCIAL_NETWORK_LABELS[network]}: valor inválido.` },
    };
  }

  const text = raw.trim();
  if (text.length === 0) return { ok: true, url: null };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      ok: false,
      error: { network, code: 'INVALID_URL', message: `${SOCIAL_NETWORK_LABELS[network]}: endereço inválido.` },
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error: {
        network,
        code: 'NOT_HTTP',
        message: `${SOCIAL_NETWORK_LABELS[network]}: apenas endereços http(s) são aceitos.`,
      },
    };
  }

  const allowed = NETWORK_HOSTS[network];
  if (allowed.length > 0 && !allowed.includes(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      error: {
        network,
        code: 'UNSUPPORTED_HOST',
        message: `${SOCIAL_NETWORK_LABELS[network]}: o endereço precisa ser de ${allowed[0]}.`,
      },
    };
  }

  parsed.hash = '';
  return { ok: true, url: parsed.toString() };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Posse — quem pode mexer no quê
// ───────────────────────────────────────────────────────────────────────────────
export interface SpeakerLinkRef {
  activityId: string;
  speakerProfileId: string | null;
  userId: string | null;
}

/**
 * Esta pessoa é ministrante desta atividade?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O VÍNCULO DA CONTA **E** O DO PERFIL SÃO ACEITOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  `activity_speakers.userId` é o vínculo antigo (a pessoa foi cadastrada já com
 *  conta) e `speaker_profileId → profile.userId` é o novo (ela reivindicou o perfil
 *  depois). Recusar o primeiro deixaria a equipe que cadastrou o palestrante com
 *  conta, antes desta fase, sem acesso ao próprio material — o tipo de regressão que
 *  só aparece quando o primeiro palestrante reclama.
 */
export function isSpeakerOfActivity(input: {
  links: readonly SpeakerLinkRef[];
  activityId: string;
  userId: string;
  /** Perfis já vinculados a esta pessoa (reivindicados). */
  claimedProfileIds?: readonly string[];
}): boolean {
  const claimed = new Set(input.claimedProfileIds ?? []);

  return input.links.some((link) => {
    if (link.activityId !== input.activityId) return false;
    if (link.userId === input.userId) return true;
    if (link.speakerProfileId && claimed.has(link.speakerProfileId)) return true;
    return false;
  });
}

/** Ids dos perfis que esta pessoa reivindicou. */
export function claimedProfileIdsFor(input: {
  profiles: readonly { id: string; userId: string | null }[];
  userId: string;
}): string[] {
  return input.profiles.filter((profile) => profile.userId === input.userId).map((p) => p.id);
}

/** Atividades em que a pessoa é ministrante (ids, sem repetição). */
export function activitiesOfSpeaker(input: {
  links: readonly SpeakerLinkRef[];
  userId: string;
  claimedProfileIds: readonly string[];
}): string[] {
  const ids = new Set<string>();
  for (const link of input.links) {
    if (
      isSpeakerOfActivity({
        links: [link],
        activityId: link.activityId,
        userId: input.userId,
        claimedProfileIds: input.claimedProfileIds,
      })
    ) {
      ids.add(link.activityId);
    }
  }
  return [...ids];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Carga horária do palestrante
// ───────────────────────────────────────────────────────────────────────────────
export interface SpeakerWorkloadEntry {
  activityId: string;
  activityTitle: string;
  activityStatus: string;
  startsAt: Date;
  endsAt: Date;
  activityWorkloadMinutes: number;
  /** Carga atribuída especificamente a este palestrante, quando declarada. */
  declaredWorkloadMinutes: number | null;
}

export interface SpeakerWorkloadResult {
  totalMinutes: number;
  entries: {
    activityId: string;
    activityTitle: string;
    minutes: number;
    /** A atividade foi contada? (`false` = cancelada ou ainda não terminou) */
    counted: boolean;
    reason: string | null;
  }[];
  countedActivities: number;
  /** Atividades vinculadas que NÃO entraram na soma (auditoria do certificado). */
  excludedActivities: number;
}

/**
 * Soma a carga horária das atividades que o palestrante EFETIVAMENTE ministrou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS REGRAS, E TODAS ELAS EXISTEM PARA NÃO CERTIFICAR O QUE NÃO ACONTECEU
 * ─────────────────────────────────────────────────────────────────────────────
 *    1. **Atividade cancelada não conta.** O minicurso foi cancelado, o palestrante
 *       não ministrou nada, e a carga dele não pode incluir o que não houve.
 *    2. **Atividade que ainda não terminou não conta.** Certificado é declaração de
 *       fato consumado: emitir a carga de uma atividade em andamento é atestar o
 *       futuro.
 *    3. **A carga declarada no vínculo vence a da atividade** quando existe — é o
 *       caso de dois palestrantes dividindo um minicurso de 4 h, cada um com 2 h.
 *
 * A soma é feita sobre as MESMAS entradas que o resultado devolve, para que o
 * certificado possa gravar o detalhamento (`workloadBreakdown`) sem recalcular.
 */
export function computeSpeakerWorkload(
  entries: readonly SpeakerWorkloadEntry[],
  now: Date,
): SpeakerWorkloadResult {
  const detail: SpeakerWorkloadResult['entries'] = [];
  let totalMinutes = 0;
  let countedActivities = 0;
  let excludedActivities = 0;

  for (const entry of entries) {
    const minutes = entry.declaredWorkloadMinutes ?? entry.activityWorkloadMinutes ?? 0;

    if (entry.activityStatus === 'CANCELED') {
      excludedActivities += 1;
      detail.push({
        activityId: entry.activityId,
        activityTitle: entry.activityTitle,
        minutes: 0,
        counted: false,
        reason: 'Atividade cancelada.',
      });
      continue;
    }

    if (entry.endsAt.getTime() > now.getTime()) {
      excludedActivities += 1;
      detail.push({
        activityId: entry.activityId,
        activityTitle: entry.activityTitle,
        minutes: 0,
        counted: false,
        reason: 'Atividade ainda não concluída.',
      });
      continue;
    }

    totalMinutes += minutes;
    countedActivities += 1;
    detail.push({
      activityId: entry.activityId,
      activityTitle: entry.activityTitle,
      minutes,
      counted: true,
      reason: null,
    });
  }

  return { totalMinutes, entries: detail, countedActivities, excludedActivities };
}

/** Resumo legível da carga por atividade — usado na tela do portal. */
export function formatWorkloadBreakdown(result: SpeakerWorkloadResult): string[] {
  return result.entries.map((entry) =>
    entry.counted
      ? `${entry.activityTitle}: ${formatMinutes(entry.minutes)}`
      : `${entry.activityTitle}: não contabilizada (${entry.reason?.toLowerCase()})`,
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${String(rest).padStart(2, '0')} min`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Materiais
// ───────────────────────────────────────────────────────────────────────────────
export const MATERIAL_KINDS = ['SLIDES', 'HANDOUT', 'ARTICLE', 'LINK', 'OTHER'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  SLIDES: 'Slides da apresentação',
  HANDOUT: 'Apostila / material de apoio',
  ARTICLE: 'Artigo ou leitura recomendada',
  LINK: 'Link útil',
  OTHER: 'Outro material',
};

export const MATERIAL_VISIBILITIES = ['PUBLIC', 'ATTENDEES_ONLY', 'PRIVATE'] as const;
export type MaterialVisibility = (typeof MATERIAL_VISIBILITIES)[number];

export const MATERIAL_VISIBILITY_LABELS: Record<MaterialVisibility, string> = {
  PUBLIC: 'Aberto a qualquer visitante',
  ATTENDEES_ONLY: 'Somente inscritos na atividade',
  PRIVATE: 'Rascunho (só você e a organização)',
};

export const MATERIAL_VISIBILITY_HINTS: Record<MaterialVisibility, string> = {
  PUBLIC: 'Aparece na página do evento e pode ser baixado por qualquer pessoa.',
  ATTENDEES_ONLY: 'Aparece na página, mas o download exige inscrição confirmada na atividade.',
  PRIVATE: 'Não aparece na página pública enquanto você não publicar.',
};

/** Quem está pedindo o material. */
export type MaterialViewer =
  | { kind: 'ANONYMOUS' }
  | { kind: 'ATTENDEE'; userId: string; confirmed: boolean }
  | { kind: 'SPEAKER'; userId: string; owner: boolean }
  | { kind: 'ORGANIZER'; userId: string };

export interface MaterialAccessInput {
  visibility: MaterialVisibility;
  viewer: MaterialViewer;
}

export type MaterialAccessVerdict =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; /** 401 = entre para acessar; 403 = não é para você. */ httpStatus: 401 | 403 };

/**
 * Decide se o material pode ser baixado — e diz POR QUE não, com o status certo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE 401 E 403 SÃO DIFERENTES AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *  `ATTENDEES_ONLY` para um visitante anônimo é "entre para baixar" (401: a pessoa
 *  ainda pode ter direito, falta identificar-se). Para alguém autenticado que não é
 *  inscrito é "não é para você" (403). Devolver 403 no primeiro caso esconderia do
 *  visitante o caminho para conseguir o material; devolver 401 no segundo
 *  convidaria quem não tem direito a tentar de novo.
 *
 * Material `PRIVATE` responde 404 para quem não é dono nem equipe: a existência de
 * um rascunho não é informação de quem não participa da organização.
 */
export function canAccessMaterial(input: MaterialAccessInput): MaterialAccessVerdict {
  const { visibility, viewer } = input;

  if (viewer.kind === 'ORGANIZER') {
    return { allowed: true, reason: 'Equipe da instituição.' };
  }

  if (viewer.kind === 'SPEAKER' && viewer.owner) {
    return { allowed: true, reason: 'Palestrante responsável pelo material.' };
  }

  switch (visibility) {
    case 'PUBLIC':
      return { allowed: true, reason: 'Material público.' };

    case 'ATTENDEES_ONLY':
      if (viewer.kind === 'ANONYMOUS') {
        return {
          allowed: false,
          reason: 'Entre na plataforma e inscreva-se na atividade para baixar este material.',
          httpStatus: 401,
        };
      }

      if (viewer.kind === 'ATTENDEE' && viewer.confirmed) {
        return { allowed: true, reason: 'Inscrição confirmada na atividade.' };
      }

      return {
        allowed: false,
        reason: 'Este material é exclusivo de quem está inscrito na atividade.',
        httpStatus: 403,
      };

    case 'PRIVATE':
    default:
      /**
       * Rascunho não é "proibido", é INEXISTENTE para quem não é dono nem equipe —
       * inclusive para o inscrito na atividade. Responder 403 confirmaria que existe
       * um material ali, e a existência de um rascunho não é informação de quem não
       * participa da organização.
       */
      return { allowed: false, reason: 'Material não encontrado.', httpStatus: 403 };
  }
}

/** Materiais que aparecem para este visitante (a lista da página pública). */
export function filterVisibleMaterials<T extends { visibility: MaterialVisibility }>(
  materials: readonly T[],
  viewer: MaterialViewer,
): T[] {
  return materials.filter((material) =>
    canAccessMaterial({ visibility: material.visibility, viewer }).allowed,
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Upload de material (documento, não imagem)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Tipos aceitos para material de apoio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE APENAS ESTES, E POR QUE PPTX ENTRA
 * ─────────────────────────────────────────────────────────────────────────────
 *  PDF é o formato que todo mundo abre. PPTX/DOCX entram porque é o que o
 *  palestrante TEM na mão no dia da aula — recusá-los empurraria o envio para fora
 *  da plataforma. O que NÃO entra é qualquer coisa que o navegador execute: HTML,
 *  SVG e JavaScript são documentos que viram código no domínio da instituição.
 *
 *  O bucket de materiais não é público e o download sai com
 *  `Content-Disposition: attachment`, então mesmo um HTML renomeado seria baixado —
 *  mas ele não passa: a assinatura real do arquivo é conferida (ver
 *  `validateMaterialUpload`).
 */
export const MATERIAL_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'text/plain',
  'application/zip',
] as const;

export type MaterialMimeType = (typeof MATERIAL_MIME_TYPES)[number];

const EXTENSION_BY_MATERIAL_MIME: Record<MaterialMimeType, readonly string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/msword': ['doc'],
  'text/plain': ['txt', 'md', 'csv'],
  'application/zip': ['zip'],
};

/** 25 MB: uma apresentação com imagens passa disso com facilidade. */
export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;

export const MATERIAL_ACCEPT_ATTRIBUTE = [
  '.pdf',
  '.pptx',
  '.docx',
  '.xlsx',
  '.ppt',
  '.doc',
  '.zip',
  '.txt',
  '.md',
].join(',');

/** `%PDF`. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
/** `PK\x03\x04` — OOXML (pptx/docx/xlsx) e ZIP são o mesmo contêiner. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** `PK\x05\x06` — zip vazio. */
const ZIP_EMPTY_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];

function startsWith(bytes: readonly number[], signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === signature[index]);
}

/**
 * Tipo real do arquivo, deduzido da assinatura.
 *
 * Devolve a FAMÍLIA (`application/zip` para todo OOXML), porque distinguir pptx de
 * docx exigiria abrir o ZIP e ler `[Content_Types].xml` — o serviço prefere o tipo
 * declarado quando ele é da mesma família e a assinatura confere. O que a assinatura
 * impede é o caso ruim: um `.exe`, um HTML ou um script disfarçado de `.pdf`.
 */
export function detectMaterialFamily(
  magicBytes: readonly number[] | null | undefined,
): 'pdf' | 'zip' | 'text' | null {
  if (!magicBytes || magicBytes.length === 0) return null;

  if (startsWith(magicBytes, PDF_SIGNATURE)) return 'pdf';
  if (startsWith(magicBytes, ZIP_SIGNATURE) || startsWith(magicBytes, ZIP_EMPTY_SIGNATURE)) {
    return 'zip';
  }

  // Texto puro não tem assinatura: se os primeiros bytes são imprimíveis/UTF-8
  // plausíveis, é texto. `text/plain` é o único caso em que isso é aceitável.
  const sample = magicBytes.slice(0, 16);
  const printable = sample.every(
    (byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte !== 0x7f),
  );

  return printable ? 'text' : null;
}

export type MaterialValidationError =
  | { code: 'EMPTY'; message: string }
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'UNSUPPORTED_TYPE'; message: string }
  | { code: 'NOT_A_DOCUMENT'; message: string }
  | { code: 'TYPE_MISMATCH'; message: string };

export type MaterialValidation =
  | { ok: true; mimeType: MaterialMimeType; maxBytes: number }
  | { ok: false; errors: readonly MaterialValidationError[] };

export interface MaterialDescriptor {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  magicBytes?: readonly number[] | null;
}

/**
 * Valida o arquivo declarado para material de apoio.
 *
 * Mesma ordem do upload de imagem — do mais barato ao mais caro — e a mesma
 * conclusão: quando os primeiros bytes chegam, eles decidem. Um `text/html`
 * renomeado para `.pdf` tem assinatura desconhecida e é recusado mesmo que o
 * cliente jure que é PDF.
 */
export function validateMaterialUpload(input: MaterialDescriptor): MaterialValidation {
  const errors: MaterialValidationError[] = [];

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, errors: [{ code: 'EMPTY', message: 'O arquivo está vazio.' }] };
  }

  if (input.sizeBytes > MAX_MATERIAL_BYTES) {
    errors.push({
      code: 'TOO_LARGE',
      message: `O material excede o limite de ${formatBytes(MAX_MATERIAL_BYTES)}.`,
    });
  }

  const declared = input.mimeType.trim().toLowerCase();
  const extension = fileExtension(input.fileName);
  const family = detectMaterialFamily(input.magicBytes);
  const hasBytes = Array.isArray(input.magicBytes) && input.magicBytes.length > 0;

  if (hasBytes && family === null) {
    errors.push({
      code: 'NOT_A_DOCUMENT',
      message: 'O conteúdo do arquivo não é um documento PDF, Office, ZIP ou texto.',
    });
    return { ok: false, errors };
  }

  if (family === 'pdf') return finishMaterial(errors, 'application/pdf');

  if (family === 'zip') {
    if (isZipFamilyMime(declared) || extension === 'zip') {
      return finishMaterial(errors, declared as MaterialMimeType);
    }

    errors.push({
      code: 'TYPE_MISMATCH',
      message: 'O arquivo é um pacote Office/ZIP, mas o formato declarado é outro.',
    });
    return { ok: false, errors };
  }

  if (family === 'text') {
    if (declared === 'text/plain') return finishMaterial(errors, 'text/plain');
    errors.push({
      code: 'TYPE_MISMATCH',
      message: 'O arquivo é texto simples, mas o formato declarado é outro.',
    });
    return { ok: false, errors };
  }

  // Sem bytes: aceitamos tipo declarado + extensão coerentes (caminho mais fraco).
  if (!isMaterialMime(declared)) {
    errors.push({
      code: 'UNSUPPORTED_TYPE',
      message: 'Formato não aceito. Envie PDF, PPTX, DOCX, XLSX, ZIP ou texto.',
    });
    return { ok: false, errors };
  }

  if (!extension || !EXTENSION_BY_MATERIAL_MIME[declared].includes(extension)) {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `O arquivo ${input.fileName} não corresponde ao formato declarado (${declared}).`,
    });
    return { ok: false, errors };
  }

  return finishMaterial(errors, declared);
}

function finishMaterial(
  errors: MaterialValidationError[],
  mimeType: MaterialMimeType,
): MaterialValidation {
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, mimeType, maxBytes: MAX_MATERIAL_BYTES };
}

/** Extensão canônica para a chave do objeto (nunca o nome enviado). */
export function canonicalMaterialExtension(mimeType: MaterialMimeType): string {
  return EXTENSION_BY_MATERIAL_MIME[mimeType][0] ?? 'bin';
}

function isMaterialMime(value: string): value is MaterialMimeType {
  return (MATERIAL_MIME_TYPES as readonly string[]).includes(value);
}

function isZipFamilyMime(value: string): boolean {
  return value === 'application/zip' || (isMaterialMime(value) && value.includes('openxmlformats'));
}

function fileExtension(fileName: string): string | null {
  const match = /\.([a-z0-9]{2,5})$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Link externo de material
// ───────────────────────────────────────────────────────────────────────────────
export type ExternalLinkResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

/** Valida o link colado (`LINK`/`ARTICLE`): http(s), sem credenciais embutidas. */
export function validateExternalMaterialUrl(raw: string): ExternalLinkResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, message: 'Informe o endereço do material.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, message: 'Endereço inválido.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: 'Apenas endereços http(s) são aceitos.' };
  }

  /**
   * Credenciais embutidas (`https://user:senha@host`) vazariam para a página
   * pública no `href` — e o navegador as enviaria no primeiro clique.
   */
  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Remova usuário e senha do endereço.' };
  }

  return { ok: true, url: parsed.toString() };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Convite e reivindicação de perfil
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O token de convite mora em `@/domain/tenancy/invite-token-rules` desde a FASE 42
 * (o convite do patrocinador usa o MESMO formato). Estas reexportações mantêm a API
 * que a FASE 25 publicou — nenhum chamador antigo precisou mudar.
 */
export {
  INVITE_ALPHABET,
  INVITE_TOKEN_LENGTH,
  INVITE_TTL_DAYS,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFrom,
  isInviteExpired,
  newInviteToken,
  normalizeInviteToken,
} from '@/domain/tenancy/invite-token-rules';

/** Os mesmos helpers, agora como nomes LOCAIS (a reivindicação de perfil usa dois). */
import { hashInviteToken, isInviteExpired } from '@/domain/tenancy/invite-token-rules';

export type ClaimRefusalCode =
  | 'INVALID_TOKEN'
  | 'EXPIRED'
  | 'ALREADY_CLAIMED'
  | 'EMAIL_MISMATCH'
  | 'NO_EMAIL';

export type ClaimVerdict =
  | { ok: true; /** O e-mail do perfil deve ser atualizado para o da conta. */ updateEmailTo: string | null }
  | { ok: false; code: ClaimRefusalCode; message: string };

export interface ClaimInput {
  profile: {
    email: string | null;
    userId: string | null;
    inviteTokenHash: string | null;
    inviteExpiresAt: Date | null;
  };
  /** Token informado na tela (em claro). `null` quando o caminho é o do painel. */
  token: string | null;
  /** E-mail da conta autenticada. */
  userEmail: string;
  userId: string;
  now: Date;
}

/**
 * Decide se a reivindicação pode acontecer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DUAS PROVAS, DUAS ORIGENS (E POR QUE AS DUAS SÃO NECESSÁRIAS)
 * ─────────────────────────────────────────────────────────────────────────────
 *  • **Token** prova que a pessoa recebeu o link que a instituição entregou. Sem
 *    ele, qualquer conta com o e-mail do palestrante reivindicaria o perfil — e o
 *    e-mail do perfil é digitado pelo organizador, que erra.
 *  • **E-mail da conta** prova quem a pessoa é. Sem essa conferência, o token
 *    vazado (print, grupo de WhatsApp da turma) entregaria o perfil a um terceiro.
 *
 *  Quando os dois existem e divergem, o e-mail do PERFIL é atualizado para o da
 *  conta — cenário real: o organizador cadastrou o e-mail institucional e a pessoa
 *  tem conta com o pessoal. A divergência vai para a trilha de auditoria.
 */
export function evaluateClaim(input: ClaimInput): ClaimVerdict {
  const { profile } = input;

  if (profile.userId) {
    if (profile.userId === input.userId) {
      return { ok: false, code: 'ALREADY_CLAIMED', message: 'Este perfil já está vinculado à sua conta.' };
    }
    return {
      ok: false,
      code: 'ALREADY_CLAIMED',
      message: 'Este perfil já foi reivindicado por outra conta.',
    };
  }

  if (input.token !== null) {
    if (!profile.inviteTokenHash) {
      return {
        ok: false,
        code: 'INVALID_TOKEN',
        message: 'Este perfil não tem convite ativo. Peça um novo convite à organização.',
      };
    }

    if (hashInviteToken(input.token) !== profile.inviteTokenHash) {
      return { ok: false, code: 'INVALID_TOKEN', message: 'Código de convite inválido.' };
    }

    if (isInviteExpired(profile.inviteExpiresAt, input.now)) {
      return {
        ok: false,
        code: 'EXPIRED',
        message: 'Este convite expirou. Peça um novo convite à organização.',
      };
    }

    const sameEmail =
      profile.email !== null && profile.email.toLowerCase() === input.userEmail.toLowerCase();

    return { ok: true, updateEmailTo: sameEmail ? null : input.userEmail };
  }

  // Caminho do painel: só o e-mail identifica.
  if (!profile.email) {
    return {
      ok: false,
      code: 'NO_EMAIL',
      message: 'Este perfil não tem e-mail cadastrado. Use o código de convite enviado pela organização.',
    };
  }

  if (profile.email.toLowerCase() !== input.userEmail.toLowerCase()) {
    return {
      ok: false,
      code: 'EMAIL_MISMATCH',
      message: 'Este convite é de outro e-mail. Entre com a conta que recebeu o convite.',
    };
  }

  return { ok: true, updateEmailTo: null };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil — normalização para gravação
// ───────────────────────────────────────────────────────────────────────────────
export interface SpeakerProfileDraft {
  name: string;
  email: string | null;
  institution: string | null;
  company: string | null;
  roleTitle: string | null;
  bio: string | null;
  socialLinks: SocialLinks;
}

export type SpeakerProfileNormalization =
  | { ok: true; draft: SpeakerProfileDraft }
  | { ok: false; errors: readonly string[] };

/** E-mail em minúsculas: é a chave do vínculo automático e não pode ter caixa. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normaliza o que a tela mandou, sem nunca inventar dado.
 *
 * String vazia vira `null` (ausente), e não `''`: gravar `''` faria o perfil
 * aparecer na vitrine com "Instituição: " em branco e a busca por e-mail encontrar
 * um perfil sem e-mail.
 */
export function normalizeSpeakerProfile(input: {
  name: string;
  email?: string | null;
  institution?: string | null;
  company?: string | null;
  roleTitle?: string | null;
  bio?: string | null;
  socialLinks?: Record<string, unknown>;
}): SpeakerProfileNormalization {
  const errors: string[] = [];

  const name = input.name.trim().slice(0, MAX_SPEAKER_NAME_LENGTH);
  if (name.length < 3) {
    errors.push('Informe o nome do palestrante (mínimo 3 caracteres).');
  }

  const rawEmail = input.email?.trim() ?? '';
  let email: string | null = null;
  if (rawEmail.length > 0) {
    // Validação deliberadamente simples: o e-mail é contato, e a prova de posse é
    // o convite (ou o vínculo da conta), não o formato.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
      errors.push('E-mail inválido.');
    } else {
      email = normalizeEmail(rawEmail);
    }
  }

  const roleTitle = input.roleTitle?.trim() ?? '';
  if (roleTitle.length > MAX_ROLE_TITLE_LENGTH) {
    errors.push(`O papel na atividade deve ter até ${MAX_ROLE_TITLE_LENGTH} caracteres.`);
  }

  const socials = sanitizeSocialLinks(input.socialLinks ?? {});
  if (!socials.ok) {
    errors.push(...socials.errors.map((error) => error.message));
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    draft: {
      name,
      email,
      institution: blankToNull(input.institution, MAX_SPEAKER_INSTITUTION_LENGTH),
      company: blankToNull(input.company, MAX_SPEAKER_INSTITUTION_LENGTH),
      roleTitle: roleTitle.length > 0 ? roleTitle : null,
      bio: blankToNull(input.bio, MAX_SPEAKER_BIO_LENGTH),
      socialLinks: socials.ok ? socials.links : {},
    },
  };
}

function blankToNull(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.trim() ?? '';
  if (text.length === 0) return null;
  return text.slice(0, maxLength);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vitrine pública
// ───────────────────────────────────────────────────────────────────────────────
/** O palestrante aparece na vitrine? Perfil oculto ou removido não aparece. */
export function isPubliclyVisible(profile: {
  isPublic: boolean;
  deletedAt: Date | null;
}): boolean {
  return profile.isPublic && profile.deletedAt === null;
}

/**
 * Ordena a vitrine.
 *
 * `displayOrder` primeiro (é o controle explícito do organizador), depois a
 * ordem em que a pessoa aparece na agenda (o primeiro horário em que fala), e por
 * último o nome — para que uma lista de convidados sem nenhuma ordem declarada
 * saia determinística em vez de depender do plano de execução do banco.
 */
export function orderSpeakersForDisplay<
  T extends { displayOrder: number; firstActivityAt: Date | null; name: string },
>(speakers: readonly T[]): T[] {
  return [...speakers].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;

    const aTime = a.firstActivityAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.firstActivityAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;

    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/** Nome público com iniciais para o avatar quando não há foto. */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 1);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
