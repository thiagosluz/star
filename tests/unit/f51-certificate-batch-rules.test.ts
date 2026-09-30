/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — regras da lista de códigos (FASE 51, dívida E7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O parser é uma regra PURA: separadores, duplicatas, itens sem código e o teto. Sem
 *  banco, sem Next, sem navegador — é aqui que a decisão fica descrita, e é por isso
 *  que ela vive no domínio e não dentro da tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_BATCH_LIMIT,
  CERTIFICATE_BATCH_MAX_INPUT,
  parseCertificateBatchInput,
  splitCertificateCodes,
} from '../../src/domain/certificates/certificate-batch-rules';
import { VALIDATION_ALPHABET } from '../../src/domain/certificates/certificate-rules';

/** Código de formato VÁLIDO a partir de um índice — para montar listas grandes. */
function codeAt(index: number): string {
  let remaining = index;
  let body = '';

  for (let position = 0; position < 8; position += 1) {
    body = VALIDATION_ALPHABET[remaining % VALIDATION_ALPHABET.length] + body;
    remaining = Math.floor(remaining / VALIDATION_ALPHABET.length);
  }

  return `CERT-${body}`;
}

describe('separadores da lista', () => {
  it('aceita um por linha, vírgula, ponto e vírgula, espaço e tabulação', () => {
    expect(splitCertificateCodes('CERT-ABCD2345\nCERT-EFGH6789')).toEqual([
      'CERT-ABCD2345',
      'CERT-EFGH6789',
    ]);
    expect(splitCertificateCodes('CERT-ABCD2345, CERT-EFGH6789')).toHaveLength(2);
    expect(splitCertificateCodes('CERT-ABCD2345;CERT-EFGH6789')).toHaveLength(2);
    expect(splitCertificateCodes('CERT-ABCD2345\tCERT-EFGH6789')).toHaveLength(2);
    expect(splitCertificateCodes('  CERT-ABCD2345   \n\n  CERT-EFGH6789  ')).toEqual([
      'CERT-ABCD2345',
      'CERT-EFGH6789',
    ]);
  });

  it('sequência de separadores não produz item vazio', () => {
    expect(splitCertificateCodes(',, ;;  ,\n\n')).toEqual([]);
    expect(splitCertificateCodes('CERT-ABCD2345,,,CERT-EFGH6789')).toHaveLength(2);
  });
});

describe('normalização e ordem', () => {
  it('caixa, espaços e prefixo não criam códigos diferentes', () => {
    const parsed = parseCertificateBatchInput(' cert-abcd2345 \nABCD2345 ');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Duas grafias do MESMO código: uma linha só, na posição da primeira.
    expect(parsed.codes).toEqual(['CERT-ABCD2345']);
    expect(parsed.duplicates).toEqual(['CERT-ABCD2345']);
  });

  it('a ordem da resposta é a ordem digitada', () => {
    const parsed = parseCertificateBatchInput('CERT-EFGH6789\nCERT-ABCD2345\nCERT-JKMN2345');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.codes).toEqual(['CERT-EFGH6789', 'CERT-ABCD2345', 'CERT-JKMN2345']);
  });

  it('duplicata só conta uma vez, mesmo repetida três vezes', () => {
    const parsed = parseCertificateBatchInput(
      'CERT-ABCD2345\nCERT-ABCD2345\ncert-abcd2345\nCERT-EFGH6789',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.codes).toEqual(['CERT-ABCD2345', 'CERT-EFGH6789']);
    expect(parsed.duplicates).toEqual(['CERT-ABCD2345']);
  });
});

describe('itens sem código', () => {
  it('item sem NENHUM caractere de código é ignorado, e não vira linha de erro', () => {
    /**
     * `-`, `()` e `CERT-` são pontuação (ou o prefixo sozinho): não há código ali para
     * conferir. Transformá-los em linhas "código inválido" encheria a tabela de erros
     * que a pessoa não digitou como código.
     */
    const parsed = parseCertificateBatchInput('-\n()\nCERT-\nCERT-ABCD2345');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.codes).toEqual(['CERT-ABCD2345']);
    expect(parsed.ignored).toBe(3);
  });

  it('linha em branco e separador solto NÃO contam como ignorados', () => {
    /**
     * Eles não chegam a virar item: o separador `[\s,;]+` engole a sequência inteira.
     * O contador `ignored` mede o que sobrou COM caracteres e sem código — por isso
     * aqui ele é zero, e é assim que a tela explica o número.
     */
    const parsed = parseCertificateBatchInput('\n\n,\n;;\nCERT-ABCD2345\n, ,\n');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.codes).toEqual(['CERT-ABCD2345']);
    expect(parsed.ignored).toBe(0);
  });

  it('item COM caractere de código é conferido e reprovado — nunca descartado em silêncio', () => {
    // "1)" vira `CERT-1`: o formato reprova na hora da conferência. Descartar esconderia
    // da pessoa que aquela linha NÃO foi conferida.
    const parsed = parseCertificateBatchInput('1)\nCERT-ABC');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.codes).toEqual(['CERT-1', 'CERT-ABC']);
    expect(parsed.ignored).toBe(0);
  });
});

describe('recusas', () => {
  it('lista vazia é recusada', () => {
    for (const entrada of ['', '   ', '\n\n', ', ,', null, undefined]) {
      const parsed = parseCertificateBatchInput(entrada);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.code).toBe('EMPTY');
    }
  });

  it('exatamente no teto passa; um a mais é recusado com o número e o caminho', () => {
    const noLimite = Array.from({ length: CERTIFICATE_BATCH_LIMIT }, (_, index) => codeAt(index));
    const acima = [...noLimite, codeAt(CERTIFICATE_BATCH_LIMIT)];

    const ok = parseCertificateBatchInput(noLimite.join('\n'));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.codes).toHaveLength(CERTIFICATE_BATCH_LIMIT);

    const recusado = parseCertificateBatchInput(acima.join('\n'));
    expect(recusado.ok).toBe(false);
    if (recusado.ok) return;

    expect(recusado.code).toBe('TOO_MANY');
    expect(recusado.found).toBe(CERTIFICATE_BATCH_LIMIT + 1);
    expect(recusado.message).toContain(String(CERTIFICATE_BATCH_LIMIT));
    expect(recusado.message).toMatch(/divida a lista/i);
  });

  it('o teto conta códigos DISTINTOS: repetição não consome a cota', () => {
    /**
     * É o número de códigos distintos que mede o custo da conferência (uma consulta por
     * código). Cinquenta códigos repetidos centenas de vezes continuam sendo UMA
     * consulta — e o texto colado é limitado por caracteres, que é o outro teto.
     */
    const repetido = Array.from({ length: 500 }, () => codeAt(0)).join('\n');

    const parsed = parseCertificateBatchInput(repetido);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.codes).toEqual([codeAt(0)]);
    expect(parsed.duplicates).toEqual([codeAt(0)]);
  });

  it('texto acima do teto de caracteres é recusado antes de ser percorrido', () => {
    const parsed = parseCertificateBatchInput('x'.repeat(CERTIFICATE_BATCH_MAX_INPUT + 1));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.code).toBe('TOO_LONG');
    expect(parsed.found).toBe(CERTIFICATE_BATCH_MAX_INPUT + 1);
  });
});
