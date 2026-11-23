import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { ElementContentCell } from '@/components/admin/certificate-template/element-row';
import { emptyElement, type EditorElement } from '@/components/admin/certificate-template/types';
import { MonitorFeedbackCard } from '@/components/credentials/monitor-feedback-card';
import { QR_READ_COOLDOWN_MS, shouldAcceptQrRead } from '@/components/credentials/use-qr-camera-scanner';
import { roundSubtitle } from '@/components/raffles/raffle-stage-types';
import {
  ROULETTE_INITIAL_DELAY_MS,
  ROULETTE_MAX_DELAY_MS,
  nextRouletteDelay,
  roulettePickIndex,
} from '@/components/raffles/use-raffle-roulette';

const ROOT = process.cwd();

function measureFileMetrics(relPath: string): { lines: number; maxJsxDepth: number } {
  const fullPath = join(ROOT, relPath);
  const content = readFileSync(fullPath, 'utf8');
  const lines = content.split(/\r?\n/).length;
  const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let maxJsxDepth = 0;

  function visit(node: ts.Node, depth: number) {
    let nextDepth = depth;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      nextDepth = depth + 1;
      if (nextDepth > maxJsxDepth) maxJsxDepth = nextDepth;
    } else if (ts.isJsxSelfClosingElement(node)) {
      if (depth + 1 > maxJsxDepth) maxJsxDepth = depth + 1;
    }
    ts.forEachChild(node, (child) => visit(child, nextDepth));
  }

  visit(sf, 0);
  return { lines, maxJsxDepth };
}

describe('FASE 120 — Funções puras extraídas dos hooks e tipos', () => {
  it('nextRouletteDelay desacelera progressivamente até o teto e roulettePickIndex gira determinístico', () => {
    let delay = ROULETTE_INITIAL_DELAY_MS;
    for (let i = 0; i < 30; i += 1) {
      delay = nextRouletteDelay(delay);
    }
    expect(delay).toBe(ROULETTE_MAX_DELAY_MS);

    expect(roulettePickIndex(0, 5)).toBe(0);
    expect(roulettePickIndex(1, 5)).toBe(2);
    expect(roulettePickIndex(2, 5)).toBe(4);
    expect(roulettePickIndex(3, 0)).toBe(0);
  });

  it('roundSubtitle formata rodada com e sem título de prêmio', () => {
    expect(roundSubtitle(null)).toBeNull();
    expect(
      roundSubtitle({
        roundNumber: 2,
        prizeTitle: null,
        prizeDescription: null,
        sponsorName: null,
        drawnAtIso: null,
        seedCommitment: null,
        seedRevealed: null,
        resultHash: null,
        winnersCount: 1,
        alternatesCount: 0,
        rollNames: [],
        winners: [],
        alternates: [],
      }),
    ).toBe('Rodada 2');
    expect(
      roundSubtitle({
        roundNumber: 2,
        prizeTitle: 'Livro técnico',
        prizeDescription: null,
        sponsorName: null,
        drawnAtIso: null,
        seedCommitment: null,
        seedRevealed: null,
        resultHash: null,
        winnersCount: 1,
        alternatesCount: 0,
        rollNames: [],
        winners: [],
        alternates: [],
      }),
    ).toBe('Rodada 2 — Livro técnico');
  });

  it('shouldAcceptQrRead respeita janela anti-rajada para o mesmo crachá e libera código distinto', () => {
    const t0 = 1_000_000;
    expect(shouldAcceptQrRead(null, '', t0)).toBe(false);
    expect(shouldAcceptQrRead(null, 'CR-1111-AAAA', t0)).toBe(true);

    const prev = { code: 'CR-1111-AAAA', at: t0 };
    expect(shouldAcceptQrRead(prev, 'CR-1111-AAAA', t0 + 1_000)).toBe(false);
    expect(shouldAcceptQrRead(prev, 'CR-1111-AAAA', t0 + QR_READ_COOLDOWN_MS)).toBe(false);
    expect(shouldAcceptQrRead(prev, 'CR-1111-AAAA', t0 + QR_READ_COOLDOWN_MS + 1)).toBe(true);
    expect(shouldAcceptQrRead(prev, 'CR-2222-BBBB', t0 + 100)).toBe(true);
  });
});

describe('FASE 120 — Contratos SSR e progressivos dos subcomponentes extraídos', () => {
  it('ElementContentCell preserva inputs ocultos paralelos em TEXT, VARIABLE, BODY e QR sem JS', () => {
    const base: EditorElement = emptyElement(0);
    const noop = () => {};

    const textDom = new JSDOM(
      renderToStaticMarkup(createElement(ElementContentCell, { index: 0, element: base, onUpdate: noop })),
    ).window.document;
    expect(textDom.querySelector('input[type="hidden"][name="elementVariable"]')?.getAttribute('value')).toBe('');
    expect(textDom.querySelector('textarea[name="elementText"]')).not.toBeNull();

    const varDom = new JSDOM(
      renderToStaticMarkup(
        createElement(ElementContentCell, {
          index: 1,
          element: { ...base, kind: 'VARIABLE', variable: 'nome' },
          onUpdate: noop,
        }),
      ),
    ).window.document;
    expect(varDom.querySelector('select[name="elementVariable"]')).not.toBeNull();
    expect(varDom.querySelector('input[type="hidden"][name="elementText"]')?.getAttribute('value')).toBe('');

    const bodyDom = new JSDOM(
      renderToStaticMarkup(
        createElement(ElementContentCell, {
          index: 2,
          element: { ...base, kind: 'BODY' },
          onUpdate: noop,
        }),
      ),
    ).window.document;
    expect(bodyDom.querySelector('input[type="hidden"][name="elementVariable"]')).not.toBeNull();
    expect(bodyDom.querySelector('input[type="hidden"][name="elementText"]')).toBeNull();

    const qrDom = new JSDOM(
      renderToStaticMarkup(
        createElement(ElementContentCell, {
          index: 3,
          element: { ...base, kind: 'QR' },
          onUpdate: noop,
        }),
      ),
    ).window.document;
    expect(qrDom.querySelector('input[type="hidden"][name="elementVariable"]')).not.toBeNull();
    expect(qrDom.querySelector('input[type="hidden"][name="elementText"]')).not.toBeNull();
  });

  it('MonitorFeedbackCard renderiza status, categoria, minutos e alertas de erro', () => {
    const okDom = new JSDOM(
      renderToStaticMarkup(
        createElement(MonitorFeedbackCard, {
          eventTitle: 'Congresso UFBA',
          feedback: {
            ok: true,
            message: 'Saída registrada',
            details: ['Leitura fora da lista de inscritos'],
            data: {
              action: 'CHECKED_OUT',
              userName: 'Ana Souza',
              minutes: 45,
              closedMinutes: 90,
              categoryLabel: 'Palestrante',
            },
          },
        }),
      ),
    ).window.document;

    const card = okDom.querySelector('[data-testid="monitor-feedback"]');
    expect(card?.getAttribute('role')).toBe('status');
    expect(card?.getAttribute('data-action')).toBe('CHECKED_OUT');
    expect(card?.textContent).toContain('Ana Souza');
    expect(okDom.querySelector('[data-testid="monitor-category"]')?.textContent).toContain('Palestrante');
    expect(card?.textContent).toContain('45 minuto(s)');
    expect(okDom.querySelector('[data-testid="monitor-warnings"]')?.textContent).toContain('fora da lista');

    const errDom = new JSDOM(
      renderToStaticMarkup(
        createElement(MonitorFeedbackCard, {
          eventTitle: 'Congresso UFBA',
          feedback: {
            ok: false,
            message: 'Crachá revogado',
            details: [],
            data: undefined,
          },
        }),
      ),
    ).window.document;
    expect(errDom.querySelector('[data-testid="monitor-feedback"]')?.getAttribute('role')).toBe('alert');
    expect(errDom.querySelector('[data-testid="monitor-feedback"]')?.getAttribute('data-action')).toBe('ERRO');
  });
});

describe('FASE 120 — Catraca AST de tamanho, profundidade JSX e contratos públicos (ADR-481 … 484)', () => {
  it('os 4 orquestradores refatorados respeitam os novos tetos de linhas e jsxDepth', () => {
    const cert = measureFileMetrics('src/components/admin/certificate-template-editor.tsx');
    expect(cert.lines).toBeLessThanOrEqual(260);
    expect(cert.maxJsxDepth).toBeLessThanOrEqual(7);

    const stage = measureFileMetrics('src/components/raffles/raffle-stage.tsx');
    expect(stage.lines).toBeLessThanOrEqual(240);
    expect(stage.maxJsxDepth).toBeLessThanOrEqual(7);

    const monitor = measureFileMetrics('src/components/credentials/monitor-console.tsx');
    expect(monitor.lines).toBeLessThanOrEqual(350);
    expect(monitor.maxJsxDepth).toBeLessThanOrEqual(7);

    const qr = measureFileMetrics('src/components/credentials/qr-camera-reader.tsx');
    expect(qr.lines).toBeLessThanOrEqual(160);
    expect(qr.maxJsxDepth).toBeLessThanOrEqual(6);
  });

  it('as fachadas originais continuam exportando exatamente seus contratos públicos', async () => {
    const certMod = await import('@/components/admin/certificate-template-editor');
    expect(typeof certMod.CertificateTemplateEditor).toBe('function');

    const stageMod = await import('@/components/raffles/raffle-stage');
    expect(typeof stageMod.RaffleStage).toBe('function');

    const monitorMod = await import('@/components/credentials/monitor-console');
    expect(typeof monitorMod.MonitorConsole).toBe('function');
    expect(monitorMod.CHECKIN_CONTEXT_EVENT).toBe('ef:checkin-context');

    const qrMod = await import('@/components/credentials/qr-camera-reader');
    expect(typeof qrMod.QrCameraReader).toBe('function');
  });
});
