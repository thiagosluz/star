import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  fieldControlsForType,
  REGISTRATION_FIELD_PRESETS,
  registrationStatusTone,
  summarizeMyRegistrations,
} from '@/domain/events/registration-ux-rules';
import {
  FreeTextFieldNotice,
  RegistrationFieldForm,
} from '@/components/admin/registration-form-editor';

describe('FASE 136 — UX Onda 2 (Formulário Progressivo, Presets e Minhas Inscrições)', () => {
  it('REGISTRATION_FIELD_PRESETS entrega 5 presets válidos sem tipo sensível', () => {
    expect(REGISTRATION_FIELD_PRESETS).toHaveLength(5);
    const ids = new Set(REGISTRATION_FIELD_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(5);

    for (const preset of REGISTRATION_FIELD_PRESETS) {
      expect(preset.buttonLabel.length).toBeGreaterThan(2);
      expect(preset.label.length).toBeGreaterThan(2);
      expect(preset.help.length).toBeGreaterThan(5);
      if (preset.type === 'SINGLE_CHOICE') {
        expect(preset.options?.length ?? 0).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('fieldControlsForType revela apenas controles compatíveis com cada FormFieldType', () => {
    expect(fieldControlsForType('SHORT_TEXT')).toEqual({
      showMaxLength: true,
      showMinMax: false,
      showOptions: false,
      requiresPurpose: false,
    });
    expect(fieldControlsForType('LONG_TEXT')).toEqual({
      showMaxLength: true,
      showMinMax: false,
      showOptions: false,
      requiresPurpose: true,
    });
    expect(fieldControlsForType('NUMBER')).toEqual({
      showMaxLength: false,
      showMinMax: true,
      showOptions: false,
      requiresPurpose: false,
    });
    expect(fieldControlsForType('SINGLE_CHOICE')).toEqual({
      showMaxLength: false,
      showMinMax: false,
      showOptions: true,
      requiresPurpose: false,
    });
    expect(fieldControlsForType('BOOLEAN')).toEqual({
      showMaxLength: false,
      showMinMax: false,
      showOptions: false,
      requiresPurpose: false,
    });
    expect(fieldControlsForType('DATE')).toEqual({
      showMaxLength: false,
      showMinMax: false,
      showOptions: false,
      requiresPurpose: false,
    });
  });

  it('summarizeMyRegistrations e registrationStatusTone agregam e classificam todos os status', () => {
    const summary = summarizeMyRegistrations([
      { status: 'CONFIRMED' },
      { status: 'CONFIRMED' },
      { status: 'PENDING' },
      { status: 'WAITLISTED' },
      { status: 'ATTENDED' },
      { status: 'CANCELLED' },
    ]);
    expect(summary).toEqual({
      total: 6,
      confirmed: 2,
      pendingConfirmation: 1,
      waitlisted: 1,
      attended: 1,
    });

    expect(registrationStatusTone('CONFIRMED')).toBe('success');
    expect(registrationStatusTone('ATTENDED')).toBe('success');
    expect(registrationStatusTone('PENDING')).toBe('warning');
    expect(registrationStatusTone('WAITLISTED')).toBe('info');
    expect(registrationStatusTone('CANCELLED')).toBe('neutral');
  });

  it('RegistrationFieldForm mantém fallback No-JS completo no SSR e FreeTextFieldNotice segue exportado', () => {
    const noopAction = async () => {};
    const html = renderToStaticMarkup(
      createElement(RegistrationFieldForm, {
        eventId: 'evt-1',
        field: null,
        action: noopAction,
        submitLabel: 'Acrescentar campo',
        testId: 'add-field-form',
      }),
    );

    expect(html).toContain('name="label"');
    expect(html).toContain('name="type"');
    expect(html).toContain('name="maxLength"');
    expect(html).toContain('name="min"');
    expect(html).toContain('name="max"');
    expect(html).toContain('name="options"');
    expect(html).toContain('name="purpose"');

    const noticeHtml = renderToStaticMarkup(createElement(FreeTextFieldNotice));
    expect(noticeHtml).toContain('Quem organiza responde pelo que pergunta');
  });
});
