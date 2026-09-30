/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Conferência de certificados em lote (dívida E7, FASE 51)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO DECIDE, E POR QUE NÃO É A TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem confere uma lista cola texto de qualquer jeito: um código por linha, tudo numa
 *  linha separado por vírgula, com espaço, com ponto e vírgula, com o cabeçalho da
 *  planilha junto, com o mesmo código repetido duas vezes. Transformar esse texto numa
 *  LISTA DE CÓDIGOS é uma regra de domínio — e é ela que decide três coisas que não
 *  podem ficar implícitas:
 *
 *    1. **o que é separador** — espaço, vírgula, ponto e vírgula e quebra de linha;
 *    2. **o que é duplicata** — o MESMO código depois de normalizado (`cert-abcd2345`
 *       e `CERT-ABCD2345` são a mesma pessoa: conferir duas vezes gastaria duas
 *       consultas para responder a mesma pergunta e devolveria duas linhas iguais);
 *    3. **o que é o teto** — e ele é contado em códigos DISTINTOS, porque é o número
 *       de códigos distintos que mede o custo da conferência (ver o bloco abaixo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE UM TETO, E O QUE ELE PROTEGE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de um código é pública de propósito (`/validar/<code>`): quem confere é um
 *  TERCEIRO — um empregador, uma banca — que não tem conta na plataforma. Uma tela em
 *  lote pelo mesmo motivo é pública, mas pública E EM LOTE muda a economia da
 *  enumeração: em vez de uma tentativa por requisição, uma requisição testa N códigos.
 *
 *  O teto de 50 mantém a consulta em lote no MESMO patamar de custo de cinquenta
 *  consultas individuais (que já são possíveis, uma a uma, hoje) e torna o custo de
 *  cada requisição previsível — o que a plataforma não pode aceitar é uma requisição
 *  que peça 10.000 códigos e transforme uma tela de conferência num oráculo barato. O
 *  espaço de códigos ajuda: 29⁸ ≈ 5 × 10¹¹, então adivinhar um código válido é
 *  inviável; o teto existe para que TENTAR continue inviável, e não para esconder
 *  algo.
 *
 *  Ele é um limite de REQUISIÇÃO, não de uso: quem tem 300 códigos para conferir
 *  divide a lista em seis consultas. Recusar acima do teto (em vez de conferir os
 *  primeiros 50) é deliberado: uma resposta parcial com cara de completa é pior que
 *  uma recusa — quem confere contrato precisa saber que a lista inteira foi olhada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  VALIDATION_CODE_PREFIX,
  normalizeValidationCode,
} from '@/domain/certificates/certificate-rules';

/** Máximo de códigos DISTINTOS conferidos numa consulta. */
export const CERTIFICATE_BATCH_LIMIT = 50;

/**
 * Teto do texto colado, em caracteres.
 *
 * O teto de códigos já limita o trabalho; este limita a LEITURA do texto. Cinquenta
 * códigos com separadores e cabeçalho não chegam perto de 8.000 caracteres, então o
 * número só é atingido por colagem abusiva (ou por um arquivo colado por engano).
 */
export const CERTIFICATE_BATCH_MAX_INPUT = 8_000;

/**
 * Separadores aceitos: quebra de linha, vírgula, ponto e vírgula e espaço (inclusive
 * tabulação). O agrupamento `+` faz uma sequência deles valer por um só — o que
 * também significa que linha vazia não produz item nenhum.
 */
const CODE_SEPARATOR = /[\s,;]+/;

export type CertificateBatchRefusalCode = 'EMPTY' | 'TOO_MANY' | 'TOO_LONG';

export interface CertificateBatchList {
  /** Códigos distintos, normalizados, NA ORDEM em que foram digitados. */
  codes: string[];
  /** Códigos que apareceram mais de uma vez (normalizados), na ordem da 1ª repetição. */
  duplicates: string[];
  /**
   * Quantos itens foram descartados por não conterem NENHUM caractere de código
   * (pontuação solta, `CERT-` sem o código). Linha em branco e separador solto não
   * entram nesta conta: o separador os absorve e nenhum item chega a existir.
   */
  ignored: number;
}

export type CertificateBatchParse =
  | ({ ok: true } & CertificateBatchList)
  | { ok: false; code: CertificateBatchRefusalCode; message: string; found: number };

/**
 * Separa o texto colado em itens, sem normalizar nada.
 *
 * Fica exposto porque é a única parte do parser que a tela precisa explicar ao
 * usuário ("um por linha, ou separados por vírgula/espaço") — e explicar com a mesma
 * função que executa evita a promessa divergir do comportamento.
 */
export function splitCertificateCodes(raw: string): string[] {
  return raw.split(CODE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
}

/**
 * Texto colado → lista de códigos distintos, ou a recusa com o motivo.
 *
 * A ordem de saída é a ORDEM DIGITADA (primeira ocorrência de cada código): quem
 * confere uma planilha espera ver as linhas na mesma ordem em que as colou, e o
 * resultado fora de ordem obrigaria a pessoa a casar linha por linha a olho.
 */
export function parseCertificateBatchInput(raw: string | null | undefined): CertificateBatchParse {
  const text = raw ?? '';

  /**
   * O corte por caracteres vem ANTES de qualquer análise: um texto gigante não deve
   * nem ser percorrido. É o único caso em que a recusa olha o texto cru.
   */
  if (text.length > CERTIFICATE_BATCH_MAX_INPUT) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `A lista tem ${text.length} caracteres e o limite é ${CERTIFICATE_BATCH_MAX_INPUT}. Confira se o conteúdo colado é a lista de códigos.`,
      found: text.length,
    };
  }

  const codes: string[] = [];
  const duplicates: string[] = [];
  let ignored = 0;

  for (const part of splitCertificateCodes(text)) {
    const code = normalizeValidationCode(part);
    const body = code.startsWith(VALIDATION_CODE_PREFIX)
      ? code.slice(VALIDATION_CODE_PREFIX.length)
      : code;

    /**
     * Item sem NENHUM caractere de código é ignorado, não recusado.
     *
     * É o caso da pontuação solta (`-`, `()`) e do prefixo sem o código (`CERT-`): não
     * há código ali para conferir, e transformá-los em linhas "código inválido" encheria
     * a tabela de erros que a pessoa não digitou como código.
     *
     * Linha em branco e separador solto NÃO chegam aqui: o separador `[\s,;]+` engole a
     * sequência inteira e nada é produzido — por isso o contador `ignored` não os conta,
     * e a tela explica o número com esta mesma precisão.
     *
     * Já um item que TEM caractere de código é sempre conferido, mesmo que o formato vá
     * reprovar ("1)" vira `CERT-1`): descartá-lo esconderia que aquela linha não foi
     * conferida.
     */
    if (!body) {
      ignored += 1;
      continue;
    }

    if (codes.includes(code)) {
      if (!duplicates.includes(code)) duplicates.push(code);
      continue;
    }

    codes.push(code);
  }

  if (codes.length === 0) {
    return {
      ok: false,
      code: 'EMPTY',
      message: 'Cole pelo menos um código de certificado para conferir.',
      found: 0,
    };
  }

  if (codes.length > CERTIFICATE_BATCH_LIMIT) {
    return {
      ok: false,
      code: 'TOO_MANY',
      message: `Você enviou ${codes.length} códigos e esta conferência aceita no máximo ${CERTIFICATE_BATCH_LIMIT} por vez. Divida a lista em partes menores e confira cada uma.`,
      found: codes.length,
    };
  }

  return { ok: true, codes, duplicates, ignored };
}
