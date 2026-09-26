/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MORA AQUI, E O QUE NÃO MORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada de senha, token ou segredo passa por este módulo: quem confere senha, gera
 *  token e valida TOTP é a biblioteca de autenticação, com o custo e o formato do
 *  crypto dela. Reimplementar aqui seria criar uma segunda régua — e a que vale é a
 *  que o servidor aplica.
 *
 *  O que mora aqui é o que a TELA precisa saber para não mentir:
 *    • os limites da senha (para o texto e a validação local baterem com o servidor);
 *    • o formato do código de seis dígitos e do código de recuperação, que são
 *      digitados à mão e merecem ser normalizados antes de ir (espaço, hífen, caixa);
 *    • o rótulo legível do dispositivo que abriu a sessão — heurística, e assumida
 *      como heurística: serve para a pessoa RECONHECER o aparelho, não para decidir
 *      nada de segurança.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Senha
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Limites da senha — os MESMOS declarados no `betterAuth({ emailAndPassword })`.
 *
 * Eles existem aqui para o formulário poder dizer o mínimo antes de enviar. A
 * validação que decide continua sendo a do servidor: um cliente que ignore esta
 * régua recebe a recusa de lá.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Teto do texto de confirmação — nunca ecoamos a senha, só conferimos igualdade. */
export function passwordsMatch(password: string, confirmation: string): boolean {
  return password.length > 0 && password === confirmation;
}

/**
 * O que a tela diz sobre a senha nova.
 *
 * Não há medidor de "força": comprimento mínimo é a única regra que o servidor
 * aplica, e inventar uma barra de força ao lado de uma regra binária faria a pessoa
 * achar que a plataforma avalia algo que ela não avalia.
 */
export function passwordHint(): string {
  return `Ao menos ${PASSWORD_MIN_LENGTH} caracteres. Use uma frase que você lembre e ninguém adivinhe.`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Códigos do segundo fator
// ───────────────────────────────────────────────────────────────────────────────
/** Quantos dígitos tem o código do aplicativo autenticador (TOTP). */
export const TOTP_CODE_LENGTH = 6;

/** Quantos códigos de recuperação a conta recebe ao ligar o segundo fator. */
export const BACKUP_CODE_AMOUNT = 10;

/** Quantos caracteres tem cada código de recuperação (sem o hífen do meio). */
export const BACKUP_CODE_LENGTH = 10;

/**
 * O código do aplicativo, como o servidor espera receber.
 *
 * `null` = não é um código de seis dígitos. Devolver `null` em vez de `false` obriga
 * quem chama a dizer o que fazer com o valor — e o serviço recusa antes de gastar uma
 * tentativa da conta (o plugin conta falhas e bloqueia).
 */
export function normalizeTotpCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  const digits = input.replace(/[^0-9]/g, '');
  return digits.length === TOTP_CODE_LENGTH ? digits : null;
}

/**
 * O código de recuperação, no formato que o servidor COMPARA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A NORMALIZAÇÃO RECONSTRÓI; NÃO "ARRUMA" (FASE 47)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão desta função tirava o hífen e baixava a caixa, na suposição de
 *  que o servidor fosse tolerante. Não é: a biblioteca gera os códigos como
 *  `abcde-fghij` (com hífen e com maiúsculas) e confere com comparação EXATA
 *  (`codes.includes(code)`). O resultado era o pior possível — a tela mandava um
 *  código que ela mesma tinha alterado, e o segundo fator recusava um código correto.
 *  Quem perdeu o celular ficava sem a saída que a plataforma prometeu.
 *
 *  O que se normaliza é só o que o TECLADO acrescenta: espaço (colar do aplicativo,
 *  digitar do papel) — e o hífen é reposto quando a pessoa digita os 10 caracteres
 *  seguidos, porque o formato canônico é conhecido. Caixa é preservada: quem digita
 *  do papel precisa acertar a maiúscula, e a tela mostra os códigos agrupados
 *  exatamente como devem ser digitados.
 */
export function normalizeBackupCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  const compact = input.trim().replace(/\s+/g, '');
  const characters = compact.replace(/-/g, '');

  if (characters.length !== BACKUP_CODE_LENGTH) return null;
  if (!/^[A-Za-z0-9]+$/.test(characters)) return null;

  return `${characters.slice(0, 5)}-${characters.slice(5)}`;
}

/** Mostra os códigos em grupos, para quem copiou no papel não errar a leitura. */
export function formatBackupCode(code: string): string {
  const characters = code.replace(/[\s-]/g, '');

  return characters.length === BACKUP_CODE_LENGTH
    ? `${characters.slice(0, 5)}-${characters.slice(5)}`
    : characters;
}

/**
 * A chave que a pessoa pode digitar, quando a câmera não ajuda.
 *
 * O URI do `otpauth://` é o que vira QR code; a chave legível é o parâmetro
 * `secret`, que alguns aplicativos pedem para quem prefere digitar (ou para quem
 * acessa a plataforma pelo computador e não consegue ler o QR da própria tela).
 *
 * Devolve `null` quando o URI não é de TOTP — quem chama trata como "sem chave
 * manual", em vez de mostrar texto inventado.
 */
export function totpSecretFromUri(uri: unknown): string | null {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith('otpauth://totp/')) return null;

  try {
    const secret = new URL(uri).searchParams.get('secret');
    return secret && secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  E-mail da conta
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O endereço digitado é o mesmo que já está na conta?
 *
 * Compara sem caixa (e-mail não diferencia maiúscula na prática) e sem espaços das
 * pontas. Serve para recusar cedo a troca que não troca nada — a biblioteca também
 * recusa, mas a mensagem dela é genérica.
 */
export function isSameEmail(current: string, next: string): boolean {
  return current.trim().toLowerCase() === next.trim().toLowerCase();
}

// ───────────────────────────────────────────────────────────────────────────────
//  Sessões
// ───────────────────────────────────────────────────────────────────────────────
export interface SessionHint {
  device: string;
  browser: string;
}

/**
 * Traduz o `User-Agent` para algo que a pessoa reconheça.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  É HEURÍSTICA, E A TELA DIZ ISSO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `User-Agent` é texto que o navegador manda e pode ser qualquer coisa; a função
 *  serve para a pessoa olhar a lista e dizer "essa sou eu" — nunca para autorizar,
 *  bloquear ou decidir se uma sessão é suspeita. Por isso não há "risco" nem
 *  "confiança" calculados aqui: seria dar peso de segurança a um palpite.
 *
 *  Sem reconhecimento, o rótulo é honesto: "Dispositivo não identificado".
 */
export function describeSession(userAgent: string | null | undefined): SessionHint {
  const ua = (userAgent ?? '').trim();

  if (ua.length === 0) {
    return { device: 'Dispositivo não identificado', browser: 'Navegador não identificado' };
  }

  const device =
    /windows/i.test(ua) ? 'Windows'
    : /iphone|ipad|ipod/i.test(ua) ? 'iPhone ou iPad'
    : /android/i.test(ua) ? 'Android'
    : /mac os x|macintosh/i.test(ua) ? 'Mac'
    : /linux/i.test(ua) ? 'Linux'
    : 'Dispositivo não identificado';

  /**
   * A ordem importa: Edge e Opera se apresentam como Chrome, e o Chrome como Safari.
   * Procurar do mais específico para o mais genérico evita dizer "Chrome" para quem
   * está no Edge.
   */
  const browser =
    /edg\//i.test(ua) ? 'Edge'
    : /opr\/|opera/i.test(ua) ? 'Opera'
    : /firefox\//i.test(ua) ? 'Firefox'
    : /chrome\//i.test(ua) ? 'Chrome'
    : /safari\//i.test(ua) ? 'Safari'
    : 'Navegador não identificado';

  return { device, browser };
}

/** Sessão como a tela da conta mostra. */
export interface AccountSession {
  token: string;
  device: string;
  browser: string;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** É a sessão de quem está olhando? (não pode ser encerrada por esta tela) */
  isCurrent: boolean;
}

/**
 * Ordena as sessões para exibição: a ATUAL primeiro, depois as mais recentes.
 *
 * A sessão atual no topo não é estética: é a linha que a pessoa precisa identificar
 * para não encerrar a própria sessão por engano.
 */
export function orderSessionsForDisplay<T extends { isCurrent: boolean; lastUsedAt: string }>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
}
