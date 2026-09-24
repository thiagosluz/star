/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — OS FATOS QUE FALTAVAM (FASE 43)
 *
 *  A fase fechou três buracos: inscrição confirmada, certificado emitido e sorteio
 *  ganho não moviam nada — nem XP, nem carta, nem missão. E aposentou duas promessas
 *  falsas do formulário de missão ("Indicação" e "Bônus", sem nenhum emissor).
 *
 *  O que estes testes prendem, e por que cada um importa:
 *
 *    • a ESCALA: inscrever-se vale menos que comparecer (senão a estratégia vira
 *      clicar em "inscrever" em tudo);
 *    • o sorteio vale 0 XP — o prêmio já é a recompensa, e pontos por sorte premiariam
 *      o acaso;
 *    • a lista de missões oferece TUDO o que tem emissor e NADA do que não tem, sem
 *      sumir com nenhuma origem em silêncio (o teste fecha a união);
 *    • cada origem nova tem gatilho de carta correspondente, e a visita ao patrocinador
 *      continua FORA do mapeamento automático (ela concede carta pelo próprio fluxo).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { cardTriggerForSource } from '../../src/domain/gamification/card-rules';
import { XP_SOURCES, XP_SOURCE_LABELS } from '../../src/domain/gamification/xp-rules';
import {
  CARD_TRIGGERS,
  MISSION_TRIGGER_KINDS,
  RETIRED_XP_SOURCE_KINDS,
  XP_SOURCE_KINDS,
  cardTriggerLabel,
} from '../../src/domain/gamification/types';

// ═══════════════════════════════════════════════════════════════════════════════
describe('origens novas de XP', () => {
  it('valem o que a fase decidiu', () => {
    expect(XP_SOURCES.REGISTRATION_CONFIRMED).toBe(30);
    expect(XP_SOURCES.CERTIFICATE_ISSUED).toBe(50);
    expect(XP_SOURCES.RAFFLE_WON).toBe(0);
  });

  it('inscrever-se vale MENOS que comparecer', () => {
    /**
     * A presença é o fato; a inscrição é a intenção. Invertida a ordem, a estratégia
     * do participante passa a ser inscrever-se em tudo e não aparecer em nada.
     */
    expect(XP_SOURCES.REGISTRATION_CONFIRMED).toBeLessThan(XP_SOURCES.ACTIVITY_ATTENDANCE);
    expect(XP_SOURCES.REGISTRATION_CONFIRMED).toBeLessThan(XP_SOURCES.CHECKIN);
  });

  it('o certificado vale por documento, e não por evento', () => {
    /** Participante, autor e palestrante são três trabalhos — e três certificados. */
    expect(XP_SOURCES.CERTIFICATE_ISSUED).toBeGreaterThan(0);
    expect(XP_SOURCES.CERTIFICATE_ISSUED).toBeLessThan(XP_SOURCES.SUBMISSION_ACCEPTED);
  });

  it('ser sorteado não vale XP: o prêmio É a recompensa', () => {
    expect(XP_SOURCES.RAFFLE_WON).toBe(0);
  });

  it('toda origem tem rótulo em português, e nenhum é o enum cru', () => {
    for (const source of XP_SOURCE_KINDS) {
      expect(XP_SOURCE_LABELS[source], `origem sem rótulo: ${source}`).toBeTruthy();
      expect(XP_SOURCE_LABELS[source]).not.toBe(source);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('as origens que o formulário de missão oferece', () => {
  it('deixa de fora as aposentadas — as que nenhum caminho emite', () => {
    for (const retired of RETIRED_XP_SOURCE_KINDS) {
      expect(MISSION_TRIGGER_KINDS, `origem sem emissor oferecida: ${retired}`).not.toContain(retired);
    }
  });

  it('oferece todas as outras: nenhuma origem some em silêncio', () => {
    /** A união fecha: oferecidas ∪ aposentadas = todas as origens do enum. */
    expect([...MISSION_TRIGGER_KINDS, ...RETIRED_XP_SOURCE_KINDS].sort()).toEqual(
      [...XP_SOURCE_KINDS].sort(),
    );
  });

  it('as aposentadas continuam no enum, com rótulo — o histórico precisa ser legível', () => {
    for (const retired of RETIRED_XP_SOURCE_KINDS) {
      expect(XP_SOURCE_KINDS).toContain(retired);
      expect(XP_SOURCE_LABELS[retired]).toBeTruthy();
    }
  });

  it('oferece as três origens novas', () => {
    expect(MISSION_TRIGGER_KINDS).toContain('REGISTRATION_CONFIRMED');
    expect(MISSION_TRIGGER_KINDS).toContain('CERTIFICATE_ISSUED');
    expect(MISSION_TRIGGER_KINDS).toContain('RAFFLE_WON');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cartas dos fatos novos', () => {
  it('cada origem nova tem o gatilho de mesmo nome', () => {
    expect(cardTriggerForSource('REGISTRATION_CONFIRMED')).toBe('REGISTRATION_CONFIRMED');
    expect(cardTriggerForSource('CERTIFICATE_ISSUED')).toBe('CERTIFICATE_ISSUED');
    expect(cardTriggerForSource('RAFFLE_WON')).toBe('RAFFLE_WON');
  });

  it('a visita ao patrocinador continua FORA do mapeamento automático', () => {
    /**
     * A carta da visita é concedida pelo PRÓPRIO fluxo da leitura, com a carta
     * escolhida no QR. Mapear aqui daria uma segunda concessão por leitura.
     */
    expect(cardTriggerForSource('SPONSOR_QR')).toBeNull();
  });

  it('todo gatilho tem frase, e a do sorteio fala de sorte', () => {
    for (const trigger of CARD_TRIGGERS) {
      expect(cardTriggerLabel(trigger), `gatilho sem frase: ${trigger}`).not.toBe(trigger);
      expect(cardTriggerLabel(trigger)).not.toBe('Conquista desbloqueada');
    }

    expect(CARD_TRIGGERS).toContain('RAFFLE_WON');
    expect(cardTriggerLabel('RAFFLE_WON')).toMatch(/sorte/i);
  });
});
