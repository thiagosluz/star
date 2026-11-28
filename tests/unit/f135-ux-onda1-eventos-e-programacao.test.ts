import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  computeDurationMinutes,
  formatWorkloadHuman,
  groupActivitiesByDay,
  slugifyTitle,
  summarizeSchedule,
} from '@/domain/events/schedule-ux-rules';
import { ConfirmationFields } from '@/components/admin/confirmation-fields';
import { EventCreateFields } from '@/components/admin/event-create-fields';
import { ActivityCreateFields } from '@/components/admin/activity-create-fields';

describe('FASE 135 — UX Onda 1 (Criação de Evento, Nova Atividade, Confirmação Progressiva e Grade por Dia)', () => {
  it('slugifyTitle normaliza acentos, espaços e pontuação em kebab-case', () => {
    expect(slugifyTitle('Congresso de Tecnologia & Educação 2027!')).toBe(
      'congresso-de-tecnologia-educacao-2027',
    );
    expect(slugifyTitle('   Minicurso: Rust para iniciantes   ')).toBe('minicurso-rust-para-iniciantes');
  });

  it('calcula duração entre horários e formata carga horária de forma humana', () => {
    expect(computeDurationMinutes('2026-12-14T09:00', '2026-12-14T12:00')).toBe(180);
    expect(computeDurationMinutes('2026-12-14T14:00', '2026-12-14T15:30')).toBe(90);
    expect(computeDurationMinutes('2026-12-14T15:00', '2026-12-14T14:00')).toBeNull();

    expect(formatWorkloadHuman(45)).toBe('45 min');
    expect(formatWorkloadHuman(60)).toBe('1h');
    expect(formatWorkloadHuman(90)).toBe('1h30');
    expect(formatWorkloadHuman(240)).toBe('4h');
  });

  it('agrupa atividades cronologicamente por dia e resume a grade', () => {
    const items = [
      { id: '2', startsAt: new Date('2026-11-07T14:00:00Z'), workloadMinutes: 90, roomId: null },
      { id: '1', startsAt: new Date('2026-11-05T13:00:00Z'), workloadMinutes: 120, roomId: 'r1' },
      { id: '3', startsAt: new Date('2026-11-05T17:00:00Z'), workloadMinutes: 60, roomId: 'r1' },
    ];

    const groups = groupActivitiesByDay(items, 'America/Bahia');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.dateKey).toBe('2026-11-05');
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['1', '3']);
    expect(groups[1]?.dateKey).toBe('2026-11-07');

    const summary = summarizeSchedule(items);
    expect(summary.totalActivities).toBe(3);
    expect(summary.totalMinutes).toBe(270);
    expect(summary.totalWorkloadLabel).toBe('4h30');
    expect(summary.withoutRoomCount).toBe(1);
  });

  it('EventCreateFields coloca Título antes do Identificador (URL) e preserva campos No-JS', () => {
    const html = renderToStaticMarkup(
      createElement(EventCreateFields, {
        defaultStartLocal: '2026-12-14T09:00',
        defaultEndLocal: '2026-12-14T18:00',
        statusOptions: [{ value: 'DRAFT', label: 'Rascunho' }],
      }),
    );

    const titlePos = html.indexOf('name="title"');
    const slugPos = html.indexOf('name="slug"');
    expect(titlePos).toBeGreaterThan(-1);
    expect(slugPos).toBeGreaterThan(titlePos);
    expect(html).toContain('name="timezone"');
    expect(html).not.toContain('oklch()');
  });

  it('ActivityCreateFields exibe atalho para salas quando vazio e ConfirmationFields preserva fallback SSR', () => {
    const html = renderToStaticMarkup(
      createElement(ActivityCreateFields, {
        activityTypes: [{ value: 'LECTURE', label: 'Palestra' }],
        activityStatus: [{ value: 'SCHEDULED', label: 'Programada' }],
        roomOptions: [{ value: '', label: 'Sem sala definida' }],
        hasRooms: false,
        roomsHref: '/t/ufba-demo/administracao/eventos/123/salas',
        defaultStartLocal: '2026-12-14T09:00',
        defaultEndLocal: '2026-12-14T12:00',
      }),
    );

    expect(html.indexOf('name="title"')).toBeLessThan(html.indexOf('name="slug"'));
    expect(html).toContain('data-testid="activity-no-rooms-hint"');
    expect(html).toContain('data-testid="activity-workload-human"');
    expect(html).toContain('3h');

    const confirmHtml = renderToStaticMarkup(
      createElement(ConfirmationFields, {
        policy: 'AUTO',
        windowDays: null,
        requirements: [],
        place: null,
        instructions: null,
      }),
    );
    expect(confirmHtml).toContain('data-testid="activity-confirmation"');
    expect(confirmHtml).toContain('name="confirmationPolicy"');
  });
});
