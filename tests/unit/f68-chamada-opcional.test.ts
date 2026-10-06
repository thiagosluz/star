/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A CHAMADA DE TRABALHOS É OPCIONAL (FASE 68)
 *
 *  Duas regras puras sustentam a fase, e as duas são provadas aqui, sem navegador:
 *
 *    • o bloco de TRILHAS da página pública cala quando o evento não recebe
 *      trabalhos, inventaria quando ainda não há chamada publicada e convida quando
 *      há — em vez de anunciar "submeta seu trabalho" para todo mundo;
 *    • o caminho ANTIGO de submissão (por trilha) é recusado com `CFP_CLOSED` quando
 *      o evento tem chamada publicada, e segue valendo quando não tem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  legacySubmissionPermission,
  tracksAnnouncement,
} from '../../src/domain/events/call-optional-rules';

describe('bloco de trilhas da página pública', () => {
  it('evento que NÃO recebe trabalhos não anuncia chamada — nem com trilha cadastrada', () => {
    expect(
      tracksAnnouncement({ receivesSubmissions: false, hasPublishedCall: false, trackCount: 3 }),
    ).toBe('SILENT');
  });

  it('sem trilha, o bloco não desenha nada (a lista vazia não vira título solto)', () => {
    expect(
      tracksAnnouncement({ receivesSubmissions: true, hasPublishedCall: true, trackCount: 0 }),
    ).toBe('SILENT');
  });

  it('recebe trabalhos sem chamada publicada: mostra os eixos, MAS não convida a submeter', () => {
    expect(
      tracksAnnouncement({ receivesSubmissions: true, hasPublishedCall: false, trackCount: 2 }),
    ).toBe('INVENTORY');
  });

  it('recebe trabalhos com chamada publicada: o convite é verdadeiro', () => {
    expect(
      tracksAnnouncement({ receivesSubmissions: true, hasPublishedCall: true, trackCount: 2 }),
    ).toBe('ANNOUNCE');
  });

  /**
   * A CONTRADIÇÃO se resolve a favor do que o público está vendo: um evento com o
   * interruptor desligado e uma chamada PUBLICADA continua convidando — quem chama
   * combina as duas fontes (`receivesSubmissions = interruptor OU chamada publicada`),
   * e o teste prende a saída do domínio para esse caso.
   */
  it('o domínio decide pelo fato recebido, e não por dedução própria', () => {
    expect(
      tracksAnnouncement({ receivesSubmissions: true, hasPublishedCall: true, trackCount: 2 }),
    ).toBe('ANNOUNCE');
  });
});

describe('o caminho antigo de submissão e a chamada da F33', () => {
  it('recusa com CFP_CLOSED quando o evento tem chamada publicada', () => {
    const recusa = legacySubmissionPermission({ eventHasPublishedCall: true });

    expect(recusa.ok).toBe(false);
    if (recusa.ok) return;

    expect(recusa.code).toBe('CFP_CLOSED');
    /** A mensagem diz ONDE a chamada vive: sem isso o autor procura o prazo no lugar errado. */
    expect(recusa.message).toContain('chamada');
  });

  it('libera o caminho antigo quando o evento não tem chamada publicada', () => {
    expect(legacySubmissionPermission({ eventHasPublishedCall: false })).toEqual({ ok: true });
  });
});
