/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Conferência de certificados em lote (dívida E7, FASE 51)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MESMA FUNÇÃO DA TELA DE UM CÓDIGO, E POR QUE ISSO NÃO É PREGUIÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Existe um validador só: `getPublicCertificate`, o mesmo que atende `/validar/<code>`.
 *  A tentação era escrever um "validador de lote" que fizesse UMA consulta com vários
 *  códigos — mais rápido, e errado: a policy de validação pública libera exatamente a
 *  linha cujo código está em `app.validation_code`, e uma segunda implementação
 *  divergiria da primeira no primeiro caso de borda (status `GENERATING`, expiração,
 *  assinatura que não confere). Aí a conferência em lote diria "válido" sobre um
 *  documento que a tela de um código recusa — e quem confere um contrato não saberia
 *  em qual das duas telas acreditar.
 *
 *  O preço é objetivo e está assumido: cada código custa duas transações (a leitura
 *  pela policy + a contagem de acesso no contexto da instituição). Com o teto de 50
 *  códigos, uma conferência custa no máximo cem transações curtas — e é o mesmo custo
 *  de conferir os cinquenta códigos um a um, que já era possível.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEQUENCIAL, DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `Promise.all` sobre os cinquenta abriria cem transações simultâneas e esgotaria o
 *  pool de conexões da aplicação — derrubando não só a conferência, mas o resto do
 *  sistema que compartilha o pool. A conferência é um ato manual (alguém colando uma
 *  lista), então a fila sequencial é o preço da previsibilidade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FALHA DE INFRAESTRUTURA NÃO VIRA "INVÁLIDO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getPublicCertificate` devolve `ok: false` quando o banco falha. Tratar isso como
 *  "documento inválido" seria a pior resposta possível numa conferência: um soluço de
 *  infraestrutura reprovaria certificados legítimos em nome da plataforma. Nesse caso o
 *  lote inteiro falha com a mensagem de indisponibilidade — o mesmo princípio da
 *  inspeção antivírus (inspeção indisponível não é veredito).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { getPublicCertificate } from '@/lib/certificates/certificate-service';
import {
  parseCertificateBatchInput,
  type CertificateBatchRefusalCode,
} from '@/domain/certificates/certificate-batch-rules';
import type { ValidationStatus } from '@/domain/certificates/certificate-rules';

export interface CertificateBatchRow {
  /** Código normalizado, como será conferido (é a chave da linha na tabela). */
  code: string;
  /** Veredito da MESMA função da tela individual (`VALID`, `REVOKED`, `NOT_FOUND`…). */
  status: ValidationStatus;
  /**
   * O documento pode ser aceito?
   *
   * É `isUsable` **e** a assinatura conferindo. A distinção existe porque o veredito
   * olha o estado do registro (emitido, não revogado, não expirado) e a assinatura olha
   * o CONTEÚDO: um documento com o texto alterado no banco é "emitido" e continua
   * dizendo que é autêntico — quem confere precisa saber disso, e a conferência não
   * pode dizer "válido" para ele.
   */
  valid: boolean;
  /** Nome de quem recebeu — `null` quando o código não existe. */
  recipientName: string | null;
  eventTitle: string | null;
  issuedAt: Date | null;
  /** Por que não vale (ou o que aconteceu com ele), em pt-BR. */
  reason: string;
}

export interface CertificateBatchResult {
  rows: CertificateBatchRow[];
  /** Códigos repetidos que foram conferidos uma vez só (normalizados). */
  duplicates: string[];
  /** Itens descartados por não conterem nenhum caractere de código. */
  ignored: number;
  validCount: number;
  invalidCount: number;
}

export type CertificateBatchOutcome =
  | { ok: true; batch: CertificateBatchResult }
  | {
      ok: false;
      code: CertificateBatchRefusalCode | 'INTERNAL';
      message: string;
      /** Quantos códigos/da entrada provocaram a recusa (para a mensagem da tela). */
      found: number;
    };

/**
 * Confere a lista colada e devolve uma linha por código DISTINTO, na ordem digitada.
 */
export async function verifyCertificateBatch(raw: string | null | undefined): Promise<CertificateBatchOutcome> {
  const parsed = parseCertificateBatchInput(raw);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: parsed.message, found: parsed.found };
  }

  const rows: CertificateBatchRow[] = [];

  for (const code of parsed.codes) {
    const result = await getPublicCertificate(code);

    if (!result.ok) {
      return {
        ok: false,
        code: 'INTERNAL',
        message:
          'Não foi possível conferir a lista agora. Nada foi concluído — tente de novo em alguns instantes.',
        found: rows.length,
      };
    }

    const { verdict, certificate } = result;
    const signatureValid = certificate?.signatureValid ?? false;
    const valid = verdict.isUsable && signatureValid;

    rows.push({
      code,
      status: verdict.status,
      valid,
      recipientName: certificate?.recipientName ?? null,
      eventTitle: certificate?.eventTitle || null,
      issuedAt: certificate?.issuedAt ?? null,
      /**
       * O motivo é o do veredito COMPARTILHADO (`evaluateValidation`), para a linha da
       * tabela dizer o mesmo que a página individual diria. A única frase acrescentada
       * é a da assinatura, que a tela individual mostra em separado.
       */
      reason:
        verdict.isUsable && !signatureValid
          ? 'A assinatura digital não confere com o conteúdo gravado: o documento pode ter sido alterado depois de emitido.'
          : verdict.message,
    });
  }

  const validCount = rows.filter((row) => row.valid).length;

  return {
    ok: true,
    batch: {
      rows,
      duplicates: parsed.duplicates,
      ignored: parsed.ignored,
      validCount,
      invalidCount: rows.length - validCount,
    },
  };
}
