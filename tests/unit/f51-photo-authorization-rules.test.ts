/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — a DECLARAÇÃO de autorização da foto (FASE 51 · dívida E66)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a E66 a plataforma guardava só QUEM afirmou ter autorização (na trilha). Isso
 *  responsabiliza quem publicou, mas não demonstra a base legal: se o uso da imagem
 *  fosse questionado, a instituição mostraria a declaração dela mesma, sem o texto
 *  aceito e sem o caminho pelo qual o consentimento chegou.
 *
 *  Aqui se prova o que é PURO e o que decide a gravação:
 *
 *    • o texto tem VERSÃO (mudar a redação amanhã não reescreve o que foi aceito hoje);
 *    • os CANAIS são uma lista fechada com rótulo em português — o valor que vai para
 *      a coluna, e o que a pessoa lê na tela;
 *    • valor desconhecido é NORMALIZADO para `null` (e o serviço recusa), nunca
 *      adivinhado;
 *    • só a FOTO NOVA pede declaração — manter a mesma foto não reabre a pergunta;
 *    • a REMOÇÃO da foto manda limpar a declaração (ela era sobre aquela imagem).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  PHOTO_AUTHORIZATION_CHANNELS,
  PHOTO_AUTHORIZATION_CHANNEL_LABELS,
  PHOTO_AUTHORIZATION_TEXT,
  PHOTO_AUTHORIZATION_VERSION,
  evaluatePhotoAuthorization,
  normalizePhotoAuthorizationChannel,
  photoAuthorizationChannelLabel,
} from '../../src/domain/speakers/speaker-rules';

const AT = new Date('2026-11-04T15:30:00.000Z');
const FOTO_A = 'https://storage.test/eventflow-assets/tenants/x/equipe/retrato.webp';
const FOTO_B = 'https://storage.test/eventflow-assets/tenants/x/equipe/outra.webp';

// ═══════════════════════════════════════════════════════════════════════════════
describe('o texto e a versão da declaração', () => {
  it('o texto vive no domínio, é legível e não é um rótulo vazio', () => {
    /**
     * A tela mostra este texto e o serviço grava ESTE texto: se ele fosse vazio (ou
     * um "tenho autorização"), a prova gravada não diria nada sobre o que foi aceito.
     */
    expect(PHOTO_AUTHORIZATION_TEXT.length).toBeGreaterThan(80);
    expect(PHOTO_AUTHORIZATION_TEXT).toMatch(/autoriza/i);
    expect(PHOTO_AUTHORIZATION_TEXT).toMatch(/foto/i);
  });

  it('a versão cabe na coluna (VarChar(8)) e não é vazia', () => {
    expect(PHOTO_AUTHORIZATION_VERSION.length).toBeGreaterThan(0);
    expect(PHOTO_AUTHORIZATION_VERSION.length).toBeLessThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('os canais oferecidos', () => {
  it('são cinco, fechados, com rótulo em português para cada um', () => {
    expect([...PHOTO_AUTHORIZATION_CHANNELS]).toEqual([
      'EMAIL',
      'PHONE',
      'EVENT_CONTRACT',
      'SIGNED_DOCUMENT',
      'OTHER',
    ]);

    for (const channel of PHOTO_AUTHORIZATION_CHANNELS) {
      const label = PHOTO_AUTHORIZATION_CHANNEL_LABELS[channel];
      expect(label, `rótulo de ${channel}`).toBeTruthy();
      // O rótulo é o que a pessoa lê: não pode ser a chave crua do enum.
      expect(label).not.toBe(channel);
      expect(label).toMatch(/[A-Za-zÀ-ÿ]/);
    }
  });

  it('o rótulo de cada canal é único (a tela não pode oferecer duas opções iguais)', () => {
    const labels = PHOTO_AUTHORIZATION_CHANNELS.map(
      (channel) => PHOTO_AUTHORIZATION_CHANNEL_LABELS[channel],
    );

    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalização do canal', () => {
  it('aceita a chave do enum, o rótulo lido e variações de caixa/acento', () => {
    expect(normalizePhotoAuthorizationChannel('EMAIL')).toBe('EMAIL');
    expect(normalizePhotoAuthorizationChannel('  email ')).toBe('EMAIL');
    expect(normalizePhotoAuthorizationChannel('E-mail')).toBe('EMAIL');
    expect(normalizePhotoAuthorizationChannel('e-mail')).toBe('EMAIL');

    expect(normalizePhotoAuthorizationChannel('PHONE')).toBe('PHONE');
    expect(normalizePhotoAuthorizationChannel('Telefone ou WhatsApp')).toBe('PHONE');
    expect(normalizePhotoAuthorizationChannel('telefone ou whatsapp')).toBe('PHONE');

    expect(normalizePhotoAuthorizationChannel('EVENT_CONTRACT')).toBe('EVENT_CONTRACT');
    expect(normalizePhotoAuthorizationChannel('Contrato do evento')).toBe('EVENT_CONTRACT');
    expect(normalizePhotoAuthorizationChannel('contrato-do-evento')).toBe('EVENT_CONTRACT');

    expect(normalizePhotoAuthorizationChannel('Documento assinado')).toBe('SIGNED_DOCUMENT');
    expect(normalizePhotoAuthorizationChannel('OTHER')).toBe('OTHER');
  });

  it('valor DESCONHECIDO vira `null` — nunca um chute', () => {
    /**
     * Adivinhar (`OTHER` para tudo) apagaria a diferença entre "não sei" e "outro
     * meio", que é justamente o que a coluna existe para registrar. E o serviço
     * transforma `null` em recusa.
     */
    expect(normalizePhotoAuthorizationChannel('pombo-correio')).toBe(null);
    expect(normalizePhotoAuthorizationChannel('whatsapp')).toBe(null);
    expect(normalizePhotoAuthorizationChannel('correio-eletronico')).toBe(null);
    expect(normalizePhotoAuthorizationChannel('')).toBe(null);
    expect(normalizePhotoAuthorizationChannel('   ')).toBe(null);
    expect(normalizePhotoAuthorizationChannel(null)).toBe(null);
    expect(normalizePhotoAuthorizationChannel(undefined)).toBe(null);
    expect(normalizePhotoAuthorizationChannel(42)).toBe(null);
    expect(normalizePhotoAuthorizationChannel({ channel: 'EMAIL' })).toBe(null);
    expect(normalizePhotoAuthorizationChannel(['EMAIL'])).toBe(null);
  });

  it('o rótulo de exibição sai do valor gravado, e é nulo quando não há canal', () => {
    expect(photoAuthorizationChannelLabel('EMAIL')).toBe('E-mail');
    expect(photoAuthorizationChannelLabel('EVENT_CONTRACT')).toBe('Contrato do evento');
    // Valor gravado que a plataforma não entende não vira rótulo inventado.
    expect(photoAuthorizationChannelLabel('pombo-correio')).toBe(null);
    expect(photoAuthorizationChannelLabel(null)).toBe(null);
    expect(photoAuthorizationChannelLabel(undefined)).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a régua da declaração', () => {
  it('foto NOVA sem a caixa marcada é recusada', () => {
    const verdict = evaluatePhotoAuthorization({
      previousPhotoUrl: null,
      nextPhotoUrl: FOTO_A,
      declared: false,
      channel: 'EMAIL',
      at: AT,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('DECLARATION_REQUIRED');
    expect(verdict.message).toMatch(/autorização do palestrante/i);
  });

  it('foto NOVA declarada SEM canal é recusada — é metade da prova que falta', () => {
    for (const channel of [null, undefined, '', '   ']) {
      const verdict = evaluatePhotoAuthorization({
        previousPhotoUrl: null,
        nextPhotoUrl: FOTO_A,
        declared: true,
        channel,
        at: AT,
      });

      expect(verdict.ok, `canal ${JSON.stringify(channel)}`).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.code).toBe('CHANNEL_REQUIRED');
      expect(verdict.message).toMatch(/canal/i);
    }
  });

  it('foto NOVA declarada com canal DESCONHECIDO é recusada com o motivo certo', () => {
    const verdict = evaluatePhotoAuthorization({
      previousPhotoUrl: null,
      nextPhotoUrl: FOTO_A,
      declared: true,
      channel: 'pombo-correio',
      at: AT,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('INVALID_CHANNEL');
    expect(verdict.message).toMatch(/desconhecido/i);
  });

  it('foto NOVA com caixa e canal grava TEXTO + VERSÃO + CANAL + DATA', () => {
    const verdict = evaluatePhotoAuthorization({
      previousPhotoUrl: null,
      nextPhotoUrl: FOTO_A,
      declared: true,
      channel: 'Telefone ou WhatsApp',
      at: AT,
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    // O texto gravado é EXATAMENTE o constante do domínio — não uma paráfrase.
    expect(verdict.write).toEqual({
      text: PHOTO_AUTHORIZATION_TEXT,
      version: PHOTO_AUTHORIZATION_VERSION,
      channel: 'PHONE',
      at: AT,
    });
    expect(verdict.clear).toBe(false);
  });

  it('manter a MESMA foto não reexige nada e não reescreve a declaração vigente', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ARMADILHA QUE ESTE CASO TRANCA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Se a checagem fosse "a caixa está marcada?", corrigir o NOME de um palestrante
     *  exigiria marcar a caixa e escolher o canal de novo — e a caixa marcada sem ler
     *  (porque a tela não deixa salvar) deixaria de significar qualquer coisa no dia
     *  em que fosse questionada. `write: null` aqui é o que PRESERVA o que já está no
     *  perfil.
     */
    const verdict = evaluatePhotoAuthorization({
      previousPhotoUrl: FOTO_A,
      nextPhotoUrl: FOTO_A,
      declared: false,
      channel: null,
      at: AT,
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.write).toBe(null);
    expect(verdict.clear).toBe(false);
  });

  it('a REMOÇÃO da foto manda LIMPAR a declaração (ela era sobre aquela imagem)', () => {
    const verdict = evaluatePhotoAuthorization({
      previousPhotoUrl: FOTO_A,
      nextPhotoUrl: null,
      declared: false,
      channel: null,
      at: AT,
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.write).toBe(null);
    expect(verdict.clear).toBe(true);
  });

  it('trocar a foto por OUTRA pede declaração nova (com o canal de novo)', () => {
    const refused = evaluatePhotoAuthorization({
      previousPhotoUrl: FOTO_A,
      nextPhotoUrl: FOTO_B,
      declared: false,
      channel: 'EMAIL',
      at: AT,
    });
    expect(refused.ok).toBe(false);

    const accepted = evaluatePhotoAuthorization({
      previousPhotoUrl: FOTO_A,
      nextPhotoUrl: FOTO_B,
      declared: true,
      channel: 'SIGNED_DOCUMENT',
      at: AT,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.write?.channel).toBe('SIGNED_DOCUMENT');
    expect(accepted.write?.at).toBe(AT);
  });
});
