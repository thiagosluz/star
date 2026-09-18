/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Regras de atividade (revisão da FASE 3)
 *
 *  Fixam as três decisões que a interface não pode reimplementar:
 *    • o rótulo do TIPO é português, e existe para TODO valor do enum;
 *    • o tipo define o PADRÃO de inscrição individual, não a imposição;
 *    • atividade ABERTA recebe quem se inscreveu no evento — e a exclusão de
 *      atividade com gente inscrita é recusada, com o motivo escrito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES,
  acceptsAutoEnrollment,
  activityStatusLabel,
  activityTypeLabel,
  canDeleteActivity,
  defaultRequiresRegistration,
  isOpenActivity,
} from '../../src/domain/events/activity-rules';

describe('rótulos de atividade em português', () => {
  it('todo valor do enum tem rótulo — e nenhum é o próprio enum', () => {
    for (const type of ACTIVITY_TYPES) {
      const label = ACTIVITY_TYPE_LABELS[type];
      expect(label, `sem rótulo para ${type}`).toBeTruthy();
      // O defeito relatado era exatamente este: `LECTURE` aparecendo na tela.
      expect(label).not.toBe(type);
      expect(label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it('não sobra rótulo sem valor correspondente', () => {
    expect(Object.keys(ACTIVITY_TYPE_LABELS).sort()).toEqual([...ACTIVITY_TYPES].sort());
  });

  it('rótulo desconhecido cai em "Atividade", e não no enum cru', () => {
    expect(activityTypeLabel('SOMETHING_NEW')).toBe('Atividade');
    expect(activityTypeLabel('')).toBe('Atividade');
  });

  it('a situação também tem rótulo próprio', () => {
    expect(activityStatusLabel('SCHEDULED')).toBe('Programada');
    expect(activityStatusLabel('CANCELED')).toBe('Cancelada');
    expect(Object.keys(ACTIVITY_STATUS_LABELS)).toHaveLength(6);
  });
});

describe('inscrição individual — padrão por tipo', () => {
  it('minicurso, oficina e maratona nascem com inscrição própria', () => {
    expect(defaultRequiresRegistration('MINI_COURSE')).toBe(true);
    expect(defaultRequiresRegistration('WORKSHOP')).toBe(true);
    expect(defaultRequiresRegistration('HACKATHON')).toBe(true);
  });

  it('palestra, mesa-redonda e as demais nascem ABERTAS', () => {
    for (const type of [
      'LECTURE',
      'ROUND_TABLE',
      'POSTER_SESSION',
      'ORAL_PRESENTATION',
      'CULTURAL',
      'OTHER',
    ]) {
      expect(defaultRequiresRegistration(type), type).toBe(false);
    }
  });

  it('tipo desconhecido nasce exigindo inscrição (fail-closed)', () => {
    // Sem saber o que é, o seguro é tratar como atividade com público próprio.
    expect(defaultRequiresRegistration('SOMETHING_NEW')).toBe(true);
  });
});

describe('atividade aberta', () => {
  it('aberta é o inverso de exigir inscrição', () => {
    expect(isOpenActivity({ requiresRegistration: false })).toBe(true);
    expect(isOpenActivity({ requiresRegistration: true })).toBe(false);
  });

  it('aceita os inscritos do evento — exceto quando cancelada', () => {
    expect(acceptsAutoEnrollment({ requiresRegistration: false, status: 'SCHEDULED' })).toBe(true);
    // Rascunho entra: a programação pode ser publicada depois da inscrição.
    expect(acceptsAutoEnrollment({ requiresRegistration: false, status: 'DRAFT' })).toBe(true);
    expect(acceptsAutoEnrollment({ requiresRegistration: false, status: 'CANCELED' })).toBe(false);

    // Atividade com inscrição própria nunca recebe ninguém automaticamente.
    expect(acceptsAutoEnrollment({ requiresRegistration: true, status: 'SCHEDULED' })).toBe(false);
  });
});

describe('exclusão de atividade', () => {
  it('permite excluir o que não tem ninguém', () => {
    expect(
      canDeleteActivity({ title: 'Palestra', liveRegistrations: 0, attendances: 0 }),
    ).toEqual({ allowed: true });
  });

  it('recusa com inscrição viva, dizendo quantas e o que fazer', () => {
    const verdict = canDeleteActivity({
      title: 'Minicurso de Rust',
      liveRegistrations: 12,
      attendances: 0,
    });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toBe('HAS_REGISTRATIONS');
    expect(verdict.message).toContain('12');
    expect(verdict.message).toMatch(/cancele/i);
  });

  it('presença registrada pesa mais que inscrição', () => {
    const verdict = canDeleteActivity({
      title: 'Mesa-redonda',
      liveRegistrations: 30,
      attendances: 4,
    });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    // O motivo relatado é o credenciamento: é o que sustenta certificado e XP.
    expect(verdict.reason).toBe('HAS_ATTENDANCE');
    expect(verdict.message).toContain('4');
  });
});
