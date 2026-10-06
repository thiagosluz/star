/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O MOTIVO DO DESCADASTRO (FASE 69 · dívida E88)
 *
 *  Sem banco e sem navegador: o que se prende aqui é a REGRA da coluna `reason` e a
 *  sua LEITURA. Duas famílias de caso, e a primeira é a que dá o tom:
 *
 *    • **a saída nunca depende do motivo** — valor ausente, "prefiro não dizer",
 *      valor desconhecido, tipo errado e texto gigante. Nenhum deles é erro, e
 *      nenhum deles é recusa: a resposta é sempre `null` ou o texto aparado. É a
 *      tradução em teste da decisão que o ADR da fase registra: a pessoa que quer
 *      sair tem de conseguir sair sem preencher nada — e um formulário que recusa
 *      o motivo transforma a cortesia em pedágio;
 *    • **a frase agregada é do domínio** — quantos motivos aparecem, em que ordem,
 *      o que acontece com o texto livre que a equipe registra por telefone e o que
 *      se diz de quem saiu sem responder. A ordem é presa aqui porque DUAS leituras
 *      do mesmo dado não podem produzir frases diferentes: uma linha que troca de
 *      ordem sozinha parece que mudou de conteúdo.
 *
 *  O texto livre do caminho `MANUAL` entra nos casos de propósito: é a prova de que
 *  o motivo escrito por uma pessoa (por telefone) e o motivo escolhido na página
 *  convivem na MESMA coluna e aparecem na MESMA frase — que é a razão de o valor
 *  gravado ser a frase, e não um código.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_UNSUBSCRIBE_REASON_LENGTH,
  UNSUBSCRIBE_REASON_CHOICES,
  UNSUBSCRIBE_REASON_DECLINE,
  UNSUBSCRIBE_REASON_OPTIONS,
  isUnsubscribeReasonChoice,
  isUnsubscribeReasonOption,
  summarizeUnsubscribeReasons,
  unsubscribeReasonFor,
} from '../../src/domain/communication/unsubscribe-reason-rules';

describe('o motivo que vai para a coluna `reason`', () => {
  it('a opção conhecida é gravada como a própria frase', () => {
    for (const opcao of UNSUBSCRIBE_REASON_OPTIONS) {
      if (opcao === 'Outro motivo') continue;

      expect(unsubscribeReasonFor({ option: opcao })).toBe(opcao);
    }
  });

  /**
   * "Outro motivo" é a única com texto livre — e as três respostas dela são
   * diferentes de propósito: com texto, o texto; sem texto, a frase; e o texto é
   * aparado nas duas pontas.
   */
  it('"Outro motivo" grava o texto escrito, aparado e com espaços colapsados', () => {
    expect(
      unsubscribeReasonFor({ option: 'Outro motivo', note: '  Mudei de cidade\n\ne a lista é daí.  ' }),
    ).toBe('Mudei de cidade e a lista é daí.');
  });

  it('"Outro motivo" sem texto grava a própria frase', () => {
    expect(unsubscribeReasonFor({ option: 'Outro motivo', note: '   ' })).toBe('Outro motivo');
    expect(unsubscribeReasonFor({ option: 'Outro motivo' })).toBe('Outro motivo');
  });

  it('o texto livre NÃO é aceito sozinho, sem a opção', () => {
    expect(unsubscribeReasonFor({ option: '', note: 'Escrevi no campo e não escolhi.' })).toBeNull();
    expect(unsubscribeReasonFor({ option: null, note: 'solta' })).toBeNull();
  });

  it('texto livre gigante é APARADO, e não recusado', () => {
    const gigante = 'a'.repeat(MAX_UNSUBSCRIBE_REASON_LENGTH + 500);
    const gravado = unsubscribeReasonFor({ option: 'Outro motivo', note: gigante });

    expect(gravado).toHaveLength(MAX_UNSUBSCRIBE_REASON_LENGTH);
    expect(gravado).toBe('a'.repeat(MAX_UNSUBSCRIBE_REASON_LENGTH));
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O CORAÇÃO DA DÍVIDA: VALOR TORTO NÃO DERRUBA A SAÍDA
   * ─────────────────────────────────────────────────────────────────────────────
   *  A lista abaixo é o que pode chegar de um formulário (inclusive de um POST
   *  montado à mão): nada escolhido, a opção de não dizer, um código que a tela
   *  nunca ofereceu, um número, um objeto e o campo ausente. Todos devolvem `null`
   *  — e `null` é uma resposta LEGÍTIMA, gravada como "saiu sem dizer". Nenhum
   *  caminho deste arquivo devolve recusa, porque não existe recusa a devolver.
   */
  it('nada disso impede a saída: o motivo fica vazio', () => {
    const torcidos: readonly unknown[] = [
      undefined,
      null,
      '',
      '   ',
      UNSUBSCRIBE_REASON_DECLINE,
      'TOO_MANY_MESSAGES',
      'Recebo mensagens demais ',
      42,
      true,
      { option: 'Outro motivo' },
      ['Outro motivo'],
    ];

    for (const torcido of torcidos) {
      expect(unsubscribeReasonFor({ option: torcido })).toBeNull();
    }
  });

  it('a opção de não dizer existe, está na tela e NÃO é um motivo', () => {
    expect(UNSUBSCRIBE_REASON_CHOICES).toContain(UNSUBSCRIBE_REASON_DECLINE);
    expect(isUnsubscribeReasonChoice(UNSUBSCRIBE_REASON_DECLINE)).toBe(true);

    /**
     * Ela é escolha da TELA e não opção gravada: a asserção nos dois sentidos é o
     * que impede alguém de "consertar" a lista de opções incluindo-a — e aí a frase
     * "Prefiro não dizer" passaria a ser gravada como se fosse um motivo.
     */
    expect(isUnsubscribeReasonOption(UNSUBSCRIBE_REASON_DECLINE)).toBe(false);
    expect(UNSUBSCRIBE_REASON_OPTIONS).not.toContain(UNSUBSCRIBE_REASON_DECLINE);
  });

  it('a tela oferece as quatro opções em português antes de "não dizer"', () => {
    expect(UNSUBSCRIBE_REASON_CHOICES).toEqual([
      'Recebo mensagens demais',
      'Não é do meu interesse',
      'Não participo mais desta instituição',
      'Outro motivo',
      'Prefiro não dizer',
    ]);
  });
});

describe('a frase agregada dos motivos', () => {
  it('ninguém saiu: nenhuma frase', () => {
    expect(summarizeUnsubscribeReasons([])).toBeNull();
    expect(summarizeUnsubscribeReasons([{ reason: null, count: 0 }])).toBeNull();
    expect(summarizeUnsubscribeReasons([{ reason: 'Qualquer', count: -3 }])).toBeNull();
  });

  it('a frase conta por motivo e diz quantos saíram sem responder', () => {
    expect(
      summarizeUnsubscribeReasons([
        { reason: 'Recebo mensagens demais', count: 2 },
        { reason: null, count: 1 },
      ]),
    ).toBe('2 por “Recebo mensagens demais” e 1 sem motivo informado');
  });

  it('o texto livre escrito pela equipe entra na MESMA frase', () => {
    expect(
      summarizeUnsubscribeReasons([
        { reason: 'Recebo mensagens demais', count: 1 },
        { reason: 'Ligou pedindo para não receber mais.', count: 1 },
      ]),
    ).toBe('1 por “Ligou pedindo para não receber mais.” e 1 por “Recebo mensagens demais”');
  });

  it('a ordem é decidida: mais gente primeiro e, no empate, o texto', () => {
    const frase = summarizeUnsubscribeReasons([
      { reason: 'Zebra', count: 1 },
      { reason: 'Abelha', count: 1 },
      { reason: 'Maior', count: 5 },
    ]);

    expect(frase).toBe('5 por “Maior”, 1 por “Abelha” e 1 por “Zebra”');
    /** Duas leituras do mesmo dado dizem a mesma coisa, mesmo fora de ordem. */
    expect(
      summarizeUnsubscribeReasons([
        { reason: 'Maior', count: 5 },
        { reason: 'Zebra', count: 1 },
        { reason: 'Abelha', count: 1 },
      ]),
    ).toBe(frase);
  });

  it('mais de três motivos diferentes: os que sobram continuam contados', () => {
    const frase = summarizeUnsubscribeReasons([
      { reason: 'Um', count: 4 },
      { reason: 'Dois', count: 3 },
      { reason: 'Três', count: 2 },
      { reason: 'Quatro', count: 1 },
      { reason: 'Cinco', count: 1 },
      { reason: null, count: 2 },
    ]);

    expect(frase).toBe('4 por “Um”, 3 por “Dois”, 2 por “Três”, 2 sem motivo informado e 2 com outros motivos');
  });

  it('texto repetido com espaços diferentes é o MESMO motivo', () => {
    expect(
      summarizeUnsubscribeReasons([
        { reason: 'Recebo  mensagens demais', count: 1 },
        { reason: ' Recebo mensagens demais ', count: 1 },
      ]),
    ).toBe('2 por “Recebo mensagens demais”');
  });

  it('motivo comprido é cortado na frase — e não no banco', () => {
    const longo = 'a'.repeat(200);
    const frase = summarizeUnsubscribeReasons([{ reason: longo, count: 1 }]);

    expect(frase).toContain('…');
    expect(frase?.length).toBeLessThan(100);
  });
});
