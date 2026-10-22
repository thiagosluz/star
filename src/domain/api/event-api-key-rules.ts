/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — a chave da API por evento, guardada em `Event.settings.api` (F72)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA VIVE EM `settings`, SEM MIGRAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É configuração POR EVENTO, do mesmo tipo que a política de inscrição (F12) e o
 *  formulário do organizador (F70): um objeto pequeno, lido por inteiro e sem
 *  consulta por campo. Criar uma tabela só para ele obrigaria uma migração, uma
 *  policy de RLS e um serviço de leitura para guardar três datas e três booleanos.
 *  O custo real de `settings` — não ter índice por chave — não existe aqui: a
 *  leitura é sempre pelo SLUG do evento, e o SHA-256 da chave é guardado como
 *  índice de COMPARAÇÃO, não como caminho de busca.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LEITOR É TOLERANTE, E A TOLERÂNCIA É FAIL-CLOSED
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `settings` é campo livre: uma configuração torta (texto, lista, data inválida)
 *  não pode derrubar a rota com 500 nem, muito menos, ser aceita "mais ou menos".
 *  A leitura devolve `configured: false` e o MOTIVO em `problems`; quem chama
 *  transforma isso em 401 (a chave não vale) — nunca em 200.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  EXPOR É DECISÃO EXPLÍCITA (decisão 3 do humano)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma seção só está ligada com `true` EXPLÍCITO. Ausente, `false`, `"true"`,
 *  `1` — tudo isso desliga. O padrão silencioso exporia palestrantes,
 *  patrocinadores e chamadas no instante em que a chave fosse criada, e a tela da
 *  fatia 3 mostraria três interruptores que ninguém tocou. O evento e as
 *  atividades NÃO são interruptáveis nesta fatia: eles respondem sempre que a
 *  chave vale (decisão do humano; mudar isso é uma pergunta, não um commit).
 *
 *  O módulo é PURO: não importa Prisma, Next, `node:crypto` nem relógio. O selo e
 *  o hash chegam prontos do cofre (`src/lib/api/event-api-key-vault.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Entropia da chave: 192 bits (32 caracteres base64url). */
export const EVENT_API_KEY_BYTES = 24;

/** As seções que o organizador pode desligar na API. */
export const EVENT_API_SECTIONS = ['palestrantes', 'patrocinadores', 'chamadas'] as const;

export type EventApiSection = (typeof EVENT_API_SECTIONS)[number];

export interface EventApiSectionToggles {
  palestrantes: boolean;
  patrocinadores: boolean;
  chamadas: boolean;
}

/** O que fica gravado em `settings.api` — o selo, o índice e os interruptores. */
export interface EventApiStoredConfig {
  /** AES-256-GCM (`iv.tag.cifra`, base64url). O banco sozinho não abre. */
  chaveSelada: string;
  /** SHA-256 da chave, em hexadecimal — o índice de comparação. */
  chaveHash: string;
  /** ISO-8601. */
  criadaEm: string;
  /** ISO-8601; `null` enquanto a chave vale. */
  revogadaEm: string | null;
  secoes: EventApiSectionToggles;
}

export interface ReadEventApiConfigResult {
  /**
   * `true` quando existe configuração BEM FORMADA. Revogada continua
   * `configured: true` (e `revogadaEm` preenchido): "revogada" é um estado da
   * chave, não um JSON inválido — e a trilha precisa distinguir os dois.
   */
  configured: boolean;
  config: EventApiStoredConfig | null;
  /** Por que a configuração foi recusada — a rota usa isto no log, nunca na resposta. */
  problems: readonly string[];
}

const EMPTY_SECTIONS: EventApiSectionToggles = {
  palestrantes: false,
  patrocinadores: false,
  chamadas: false,
};

/** `settings` é JSON livre: qualquer coisa que não seja objeto vira "sem configuração". */
function settingsObject(settings: unknown): Record<string, unknown> | null {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;

  return settings as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** ISO-8601 válido — a mesma régua que o `toISOString` produz. */
function isoTimestamp(value: unknown): string | null {
  const text = nonEmptyString(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

/**
 * Lê `settings.api` com tolerância e devolve o motivo da recusa.
 *
 * A conferência do `chaveHash` é deliberadamente rígida (64 hexadecimais): um
 * hash truncado ou em base64 compararia errado e transformaria toda leitura em
 * 401 — melhor recusar na leitura e dizer por quê.
 */
export function readEventApiConfig(settings: unknown): ReadEventApiConfigResult {
  const root = settingsObject(settings);
  if (!root) return { configured: false, config: null, problems: [] };

  const raw = root.api;

  /** Ausente é o caso normal — o evento que nunca gerou chave —, não um erro. */
  if (raw === undefined || raw === null) {
    return { configured: false, config: null, problems: [] };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      configured: false,
      config: null,
      problems: ['settings.api deveria ser um objeto.'],
    };
  }

  const record = raw as Record<string, unknown>;
  const problems: string[] = [];

  const chaveSelada = nonEmptyString(record.chaveSelada);
  if (!chaveSelada) problems.push('settings.api.chaveSelada ausente ou vazia.');

  const chaveHash = nonEmptyString(record.chaveHash);
  if (!chaveHash || !/^[0-9a-f]{64}$/.test(chaveHash)) {
    problems.push('settings.api.chaveHash deveria ser um SHA-256 em hexadecimal.');
  }

  const criadaEm = isoTimestamp(record.criadaEm);
  if (!criadaEm) problems.push('settings.api.criadaEm deveria ser uma data ISO-8601.');

  let revogadaEm: string | null = null;
  if (record.revogadaEm !== undefined && record.revogadaEm !== null) {
    const parsed = isoTimestamp(record.revogadaEm);
    if (!parsed) {
      problems.push('settings.api.revogadaEm deveria ser uma data ISO-8601 ou nula.');
    } else {
      revogadaEm = parsed;
    }
  }

  if (problems.length > 0 || !chaveSelada || !chaveHash || !criadaEm) {
    return { configured: false, config: null, problems };
  }

  return {
    configured: true,
    config: {
      chaveSelada,
      chaveHash,
      criadaEm,
      revogadaEm,
      secoes: readEventApiSections(record.secoes),
    },
    problems: [],
  };
}

/** Cada seção só liga com `true` explícito (ver o cabeçalho). */
export function readEventApiSections(raw: unknown): EventApiSectionToggles {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_SECTIONS };

  const record = raw as Record<string, unknown>;

  return {
    palestrantes: record.palestrantes === true,
    patrocinadores: record.patrocinadores === true,
    chamadas: record.chamadas === true,
  };
}

/** A pergunta que a rota faz: esta seção está exposta? */
export function isEventApiSectionEnabled(
  config: EventApiStoredConfig,
  section: EventApiSection,
): boolean {
  return config.secoes[section] === true;
}

/** A chave já foi revogada? Revogada não autentica nada. */
export function isEventApiKeyRevoked(config: EventApiStoredConfig): boolean {
  return config.revogadaEm !== null;
}

/**
 * Monta a configuração a ser gravada a partir do selo e do índice.
 *
 * As seções nascem DESLIGADAS: quem gera a chave ainda não escolheu o que expor,
 * e a fatia 3 é onde a escolha é feita. Ver o cabeçalho ("expor é decisão
 * explícita").
 */
export function buildEventApiConfig(input: {
  chaveSelada: string;
  chaveHash: string;
  criadaEm: Date;
  secoes?: Partial<EventApiSectionToggles>;
}): EventApiStoredConfig {
  return {
    chaveSelada: input.chaveSelada,
    chaveHash: input.chaveHash,
    criadaEm: input.criadaEm.toISOString(),
    revogadaEm: null,
    secoes: { ...EMPTY_SECTIONS, ...input.secoes },
  };
}
