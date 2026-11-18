import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkinContextKey,
  describeManualQueueTarget,
  describeParticipantContextEnrollment,
} from '@/domain/events/checkin-console-rules';
import { cn } from '@/lib/utils/cn';

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('FASE 115 — Regras puras de contexto sincronizado e vínculo na fila manual', () => {
  it('checkinContextKey devolve EVENT para portaria e o UUID quando o contexto é ACTIVITY', () => {
    expect(checkinContextKey({ kind: 'EVENT', activityId: null })).toBe('EVENT');
    expect(checkinContextKey({ kind: 'EVENT', activityId: 'act-1' })).toBe('EVENT');
    expect(checkinContextKey({ kind: 'ACTIVITY', activityId: 'act-1' })).toBe('act-1');
    expect(checkinContextKey({ kind: 'ACTIVITY', activityId: null })).toBe('EVENT');
  });

  it('describeManualQueueTarget descreve claramente Portaria vs Atividade aberta ou restrita', () => {
    const portaria = describeManualQueueTarget({ kind: 'EVENT' });
    expect(portaria.badgeLabel).toBe('Portaria');
    expect(portaria.targetTitle).toContain('Portaria do evento');

    const aberta = describeManualQueueTarget({
      kind: 'ACTIVITY',
      activityTitle: 'Cerimônia de abertura',
      requiresRegistration: false,
    });
    expect(aberta.badgeLabel).toBe('Atividade');
    expect(aberta.targetTitle).toBe('Atividade: Cerimônia de abertura');
    expect(aberta.helperText).toContain('Atividade aberta');

    const restrita = describeManualQueueTarget({
      kind: 'ACTIVITY',
      activityTitle: 'Minicurso de Rust',
      requiresRegistration: true,
    });
    expect(restrita.helperText).toContain('inscrição prévia');
  });

  it('describeParticipantContextEnrollment classifica inscrito, atividade aberta e presença avulsa', () => {
    expect(
      describeParticipantContextEnrollment({
        contextKind: 'ACTIVITY',
        activityId: 'act-rust',
        requiresRegistration: true,
        hasEventRegistration: true,
        registeredActivityIds: ['act-rust'],
        activityTitles: ['Minicurso de Rust'],
        fallbackActivityTitle: 'Minicurso de Rust',
      }),
    ).toEqual({
      label: 'Inscrito nesta atividade',
      tone: 'success',
    });

    expect(
      describeParticipantContextEnrollment({
        contextKind: 'ACTIVITY',
        activityId: 'act-cerimonia',
        requiresRegistration: false,
        hasEventRegistration: true,
        registeredActivityIds: ['act-rust'],
        activityTitles: ['Minicurso de Rust'],
        fallbackActivityTitle: 'Minicurso de Rust',
      }),
    ).toEqual({
      label: 'Atividade aberta do evento',
      tone: 'neutral',
    });

    expect(
      describeParticipantContextEnrollment({
        contextKind: 'ACTIVITY',
        activityId: 'act-oficina',
        requiresRegistration: true,
        hasEventRegistration: true,
        registeredActivityIds: [],
        activityTitles: [],
        fallbackActivityTitle: null,
      }),
    ).toEqual({
      label: 'Sem inscrição nesta atividade (presença avulsa)',
      tone: 'warning',
    });

    expect(
      describeParticipantContextEnrollment({
        contextKind: 'EVENT',
        activityId: null,
        requiresRegistration: false,
        hasEventRegistration: true,
        registeredActivityIds: ['act-1', 'act-2'],
        activityTitles: ['Oficina 1', 'Oficina 2'],
        fallbackActivityTitle: 'Oficina 1',
      }),
    ).toEqual({
      label: 'evento · +2 atividade(s)',
      tone: 'neutral',
    });
  });
});

describe('FASE 115 — Catracas estruturais de sincronização Monitor <-> Fila e scroll contido', () => {
  it('MonitorConsole emite CHECKIN_CONTEXT_EVENT ao alternar portaria e atividade', () => {
    const src = readSrc('src/components/credentials/monitor-console.tsx');

    expect(src).toContain("export const CHECKIN_CONTEXT_EVENT = 'ef:checkin-context'");
    expect(src).toContain('new CustomEvent(CHECKIN_CONTEXT_EVENT');
  });

  it('CheckinQueue escuta CHECKIN_CONTEXT_EVENT, exibe banner de destino, envia contextKind/targetActivityId e contém scroll max-h-[520px]', () => {
    const src = readSrc('src/components/gamification/checkin-queue.tsx');
    const badgeSrc = readSrc('src/components/ui/badge.tsx');

    expect(src).toContain('data-testid="queue-context-banner"');
    expect(src).toContain('name="contextKind"');
    expect(src).toContain('name="targetActivityId"');
    expect(src).toContain('max-h-[520px]');
    expect(src).toContain('overflow-y-auto');
    expect(badgeSrc).toContain('min-h-5');
    expect(badgeSrc).toContain('min-h-6');
    expect(
      cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 text-label-caps uppercase',
        'bg-warning-soft text-warning-strong',
        'min-h-5 py-0.5',
      ),
    ).toContain('text-label-caps');
  });

  it('CheckinQueueSection solicita deduplicateByUser: true e repassa activities para CheckinQueue', () => {
    const src = readSrc('src/components/credentials/checkin-queue-section.tsx');

    expect(src).toContain('deduplicateByUser: true');
    expect(src).toContain('activities={activities}');
  });
});
