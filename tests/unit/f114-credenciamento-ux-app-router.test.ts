import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCheckinHref,
  describeSelfCheckinPolicySummary,
  formatQueueTruncationNotice,
  resolveCheckinQueueStatusFilter,
  resolveCheckinTab,
} from '@/domain/events/checkin-console-rules';

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('FASE 114 — Regras puras do balcão de credenciamento', () => {
  it('resolveCheckinTab aceita apenas autocredenciamento e faz fallback seguro para balcao', () => {
    expect(resolveCheckinTab('autocredenciamento')).toBe('autocredenciamento');
    expect(resolveCheckinTab('balcao')).toBe('balcao');
    expect(resolveCheckinTab('outra-coisa')).toBe('balcao');
    expect(resolveCheckinTab(undefined)).toBe('balcao');
  });

  it('resolveCheckinQueueStatusFilter aceita pending e inside com fallback em all', () => {
    expect(resolveCheckinQueueStatusFilter('pending')).toBe('pending');
    expect(resolveCheckinQueueStatusFilter('inside')).toBe('inside');
    expect(resolveCheckinQueueStatusFilter('invalido')).toBe('all');
    expect(resolveCheckinQueueStatusFilter(null)).toBe('all');
  });

  it('buildCheckinHref preserva evento e limpa filtros de fila ao ir para autocredenciamento', () => {
    expect(
      buildCheckinHref({
        tenantSlug: 'ufba-demo',
        eventId: 'ev-1',
        tab: 'autocredenciamento',
        query: 'maria',
        status: 'inside',
      }),
    ).toBe('/t/ufba-demo/credenciamento?evento=ev-1&aba=autocredenciamento');

    expect(
      buildCheckinHref({
        tenantSlug: 'ufba-demo',
        eventId: 'ev-1',
        tab: 'balcao',
        query: 'joão',
        status: 'pending',
      }),
    ).toBe('/t/ufba-demo/credenciamento?evento=ev-1&q=jo%C3%A3o&situacao=pending');
  });

  it('formatQueueTruncationNotice só anuncia quando total excede a janela renderizada', () => {
    expect(formatQueueTruncationNotice(60, 60)).toBeNull();
    expect(formatQueueTruncationNotice(12, 10)).toBeNull();
    expect(formatQueueTruncationNotice(60, 145)).toBe(
      'Mostrando os 60 primeiros de 145 registros — refine pela busca acima.',
    );
  });

  it('describeSelfCheckinPolicySummary resume estado ativo/inativo e GPS em 1 frase', () => {
    expect(
      describeSelfCheckinPolicySummary({
        enabled: false,
        hasEventCoordinates: false,
        requireGeo: true,
        geoRadiusMeters: 200,
        blockConcurrentActivity: true,
        requireEventArrivalBeforeActivity: false,
      }),
    ).toBe('Autocredenciamento desativado neste evento.');

    expect(
      describeSelfCheckinPolicySummary({
        enabled: true,
        hasEventCoordinates: true,
        requireGeo: true,
        geoRadiusMeters: 250,
        blockConcurrentActivity: true,
        requireEventArrivalBeforeActivity: true,
      }),
    ).toBe('GPS ativo (raio 250 m) · anti-ubiquidade ON · exige portaria prévia');
  });
});

describe('FASE 114 — Catracas estruturais de React 19, App Router e UX', () => {
  it('credenciamento/page.tsx não chama getRequestContext após requirePagePermission e isola a fila em Suspense', () => {
    const code = stripComments(readSrc('src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx'));

    expect(code).toContain('requirePagePermission(');
    expect(code).not.toContain('getRequestContext');
    expect(code).toContain('<Suspense');
    expect(code).toContain('<CheckinQueueSection');
    expect(code).toContain('<CheckinTabBar');
    expect(code).toContain('getSelfCheckinStatusSummary(');
  });

  it('MonitorConsole posiciona feedback acima de ScanGate, protege fechamento com ConfirmSubmitButton e não sobrescreve modo em saída imediata', () => {
    const src = readSrc('src/components/credentials/monitor-console.tsx');

    const feedbackPos = src.indexOf('data-testid="monitor-feedback"');
    const scanGatePos = src.indexOf('<ScanGate');
    expect(feedbackPos).toBeGreaterThan(-1);
    expect(scanGatePos).toBeGreaterThan(feedbackPos);

    expect(src).toContain('<ConfirmSubmitButton');
    expect(src).toContain('handleOneShotCheckout');
    expect(src).not.toMatch(/handleOneShotCheckout[\s\S]{0,400}handleModeChange\(['"]OUT['"]\)/);
  });

  it('SelfCheckinManager usa última ação rastreada, resumo recolhível, Cartaz com PIN, exclusão com modal e fuso horário explícito', () => {
    const src = [
      readSrc('src/components/credentials/self-checkin-manager.tsx'),
      readSrc('src/components/credentials/self-checkin-policy-form.tsx'),
      readSrc('src/components/credentials/self-checkin-point-row.tsx'),
    ].join('\n');

    expect(src).toContain('lastActionKind');
    expect(src).toContain('data-testid="self-checkin-policy-toggle"');
    expect(src).toContain('data-testid={`self-checkin-copy-');
    expect(src).toContain('data-testid={`self-checkin-delete-open-');
    expect(src).toContain('Excluir QR Code deste ponto?');
    expect(src).toContain('incluirPin=1');
    expect(src).toContain('timeZone');
    expect(src).not.toContain('const feedback = regenState ?? state;');
  });
});
