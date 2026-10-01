/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O FORMULÁRIO DE INSCRIÇÃO E O QUE ELE GUARDA (FASE 56 · dívida E54)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CPF MORA AQUI, E NÃO NO PERFIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CPF é pedido no formulário de INSCRIÇÃO NO EVENTO — e não no perfil da pessoa.
 *  Não é detalhe de arrumação: o CPF entra em documento (certificado, ata, lista de
 *  presença), a LGPD manda recolher o mínimo necessário para a finalidade, e o perfil
 *  é global (vale em todas as instituições, para sempre). Guardado na inscrição, ele
 *  tem finalidade, dono e prazo — e some junto com o evento, se for o caso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE VALIDAR O DÍGITO VERIFICADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CPF errado no certificado é documento errado — e quem digita onze números corre o
 *  risco de trocar um par. Recusar no formulário é a única hora em que a pessoa está
 *  ali para corrigir. `111.111.111-11` passa nas contas dos dígitos e não é CPF de
 *  ninguém: a sequência repetida é recusada de propósito.
 *
 *  O valor é GRAVADO EM DÍGITOS (11 caracteres, sem pontos nem traço) e formatado na
 *  hora de imprimir. Guardar a máscara obrigaria a desformatar em toda leitura.
 */
export const CPF_FORM_FIELD = 'cpf';

/** Onze dígitos, sem máscara — é assim que o CPF é gravado. */
export function cpfDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A régua do CPF: onze dígitos, sequência repetida recusada e os DOIS dígitos
 * verificadores conferidos pelo módulo 11.
 */
export function isValidCpf(value: string): boolean {
  const digits = cpfDigits(value);

  if (digits.length !== 11) return false;

  /** `00000000000`, `11111111111`… passam no cálculo e não existem. */
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (length: number): number => {
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }

    const remainder = (sum * 10) % 11;

    return remainder === 10 ? 0 : remainder;
  };

  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
}

/** O CPF pronto para imprimir (`000.000.000-00`) — ou `null` quando não é válido. */
export function formatCpf(value: string): string | null {
  const digits = cpfDigits(value);

  if (!isValidCpf(digits)) return null;

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Lê o CPF das respostas do formulário.
 *
 * As respostas são um JSON livre (o formulário cresce por campo novo, sem migração), e
 * é por isso que a leitura passa por aqui: uma chave digitada à mão em cada leitor faria
 * o certificado parar de achar o CPF no dia em que alguém renomeasse o campo. Devolve
 * `null` — e não string vazia — quando não há CPF válido: quem chama decide se o
 * elemento do certificado é desenhado.
 */
export function cpfFromFormResponses(responses: unknown): string | null {
  if (typeof responses !== 'object' || responses === null) return null;

  const raw = (responses as Record<string, unknown>)[CPF_FORM_FIELD];

  if (typeof raw !== 'string') return null;

  return isValidCpf(raw) ? cpfDigits(raw) : null;
}
