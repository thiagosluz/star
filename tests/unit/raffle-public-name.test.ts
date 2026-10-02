/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — O NOME PÚBLICO DO SORTEIO E A OCULTAÇÃO DA MODERAÇÃO
 *  (FASE 60 · dívida E79)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra do nome público do sorteio consultava só o consentimento ANTIGO
 *  (`User.isPublicProfile`). Quem a moderação da plataforma ocultou (F56 · E62) e
 *  tinha aquele consentimento ligado continuava com o nome COMPLETO numa página
 *  aberta a qualquer visitante — o resultado do sorteio, o telão do palco e a
 *  auditoria. O caso exato está no primeiro teste abaixo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES TAMBÉM PRENDEM (E POR QUE)
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a coluna AUSENTE (`undefined`, o `select` que esqueceu de pedi-la) é
 *      fail-closed, como a régua de posse: mascara, em vez de publicar;
 *    • `maskName` não muda: quem NÃO autorizou o nome continua abreviado como
 *      sempre, porque a mudança não podia reinterpretar o consentimento existente;
 *    • nome e marca de máscara saem JUNTOS (`publicWinnerEntry`): `masked: false` com
 *      nome abreviado (ou o contrário) é o defeito de duas respostas para uma
 *      pergunta só, e é o que a tela publica em `data-masked`.
 *
 *  O que só o banco prova (a coluna lida de verdade, o efeito da decisão do
 *  SuperAdmin e as quatro leituras públicas do serviço) está em
 *  `tests/integration/f60-sorteio-publico.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { maskName, publicWinnerEntry, publicWinnerName } from '../../src/domain/raffles/raffle-rules';

/** A data da decisão de moderação: o conteúdo é irrelevante, o FATO é o que conta. */
const OCULTADA_EM = new Date('2026-05-04T12:00:00Z');

describe('o nome público do sorteio com a ocultação da moderação', () => {
  it('o caso do defeito: perfil público LIGADO + ocultado NÃO sai com o nome completo', () => {
    expect(
      publicWinnerName({
        name: 'Ana Souza',
        publicProfile: true,
        publicProfileHiddenAt: OCULTADA_EM,
      }),
    ).toBe('Ana S.');
  });

  it('sem decisão de moderação (`null`), o consentimento continua valendo', () => {
    expect(
      publicWinnerName({ name: 'Ana Souza', publicProfile: true, publicProfileHiddenAt: null }),
    ).toBe('Ana Souza');

    expect(
      publicWinnerName({ name: 'Ana Souza', publicProfile: false, publicProfileHiddenAt: null }),
    ).toBe('Ana S.');
  });

  it('a ocultação VENCE o consentimento — a decisão é da plataforma, não um degrau da pessoa', () => {
    const ocultada = { name: 'Ana Souza', publicProfile: true, publicProfileHiddenAt: OCULTADA_EM };

    expect(publicWinnerEntry(ocultada)).toEqual({ name: 'Ana S.', masked: true });
  });

  it('a coluna AUSENTE (`select` que esqueceu de pedir) mascara em vez de publicar', () => {
    expect(
      publicWinnerName({
        name: 'Ana Souza',
        publicProfile: true,
        publicProfileHiddenAt: undefined as unknown as Date | null,
      }),
    ).toBe('Ana S.');
  });

  it('a máscara é a MESMA de quem não autoriza — nada denuncia a moderação', () => {
    const porOcultacao = publicWinnerEntry({
      name: 'Ana Souza',
      publicProfile: true,
      publicProfileHiddenAt: OCULTADA_EM,
    });

    const porFaltaDeConsentimento = publicWinnerEntry({
      name: 'Ana Souza',
      publicProfile: false,
      publicProfileHiddenAt: null,
    });

    expect(porOcultacao).toEqual(porFaltaDeConsentimento);
    expect(porOcultacao.name).not.toMatch(/modera|ocult|bloquead/i);
  });

  it('nome e marca de máscara saem juntos, nos dois sentidos', () => {
    const visivel = publicWinnerEntry({
      name: 'Bruno Visivel',
      publicProfile: true,
      publicProfileHiddenAt: null,
    });

    const oculto = publicWinnerEntry({
      name: 'Bruno Visivel',
      publicProfile: true,
      publicProfileHiddenAt: OCULTADA_EM,
    });

    expect(visivel).toEqual({ name: 'Bruno Visivel', masked: false });
    expect(oculto).toEqual({ name: maskName('Bruno Visivel'), masked: true });
  });

  it('nome de uma palavra continua preservado: a máscara não piora a régua da FASE 16', () => {
    expect(
      publicWinnerName({ name: 'Ana', publicProfile: true, publicProfileHiddenAt: OCULTADA_EM }),
    ).toBe('Ana');
  });
});
