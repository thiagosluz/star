import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_TEMPLATE_PRESETS,
  validateCertificateBackground,
} from '@/domain/certificates/certificate-layout-rules';
import { normalizeCertificateBackgroundBytes } from '@/lib/certificates/certificate-template-service';
import { CertificateTemplatesScreen } from '@/components/admin/certificate-templates-screen';

describe('FASE 132 — Galeria visual (SVG), conversão PNG/WebP→JPEG RGB e clonagem herdada', () => {
  it('converte PNG e WebP (como exportados do Canva) para JPEG RGB baseline aceito pelo PDF', async () => {
    const pngBytes = await sharp({
      create: { width: 1800, height: 1272, channels: 4, background: { r: 248, g: 250, b: 252, alpha: 0.9 } },
    })
      .png()
      .toBuffer();

    const normalizedPng = await normalizeCertificateBackgroundBytes(new Uint8Array(pngBytes));
    expect(normalizedPng[0]).toBe(0xff);
    expect(normalizedPng[1]).toBe(0xd8);
    expect(
      validateCertificateBackground({ bytes: normalizedPng, page: 'A4_LANDSCAPE' }).ok,
    ).toBe(true);

    const webpBytes = await sharp({
      create: { width: 1800, height: 1272, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .webp()
      .toBuffer();

    const normalizedWebp = await normalizeCertificateBackgroundBytes(new Uint8Array(webpBytes));
    expect(normalizedWebp[0]).toBe(0xff);
    expect(normalizedWebp[1]).toBe(0xd8);
    expect(
      validateCertificateBackground({ bytes: normalizedWebp, page: 'A4_LANDSCAPE' }).ok,
    ).toBe(true);
  });

  it('mantém bytes JPEG intocados (preservando checksum original e recusa de CMYK)', async () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const untouched = await normalizeCertificateBackgroundBytes(fakeJpeg);
    expect(untouched).toBe(fakeJpeg);
  });

  it('renderiza miniaturas SVG reais nos 5 presets e botão de clonagem em modelos herdados', () => {
    const html = renderToStaticMarkup(
      createElement(CertificateTemplatesScreen, {
        data: {
          tenantSlug: 'ufba-demo',
          event: { id: 'ev-1', title: 'Congresso UFBA' },
          basePath: '/t/ufba-demo/administracao/eventos/ev-1/certificados/modelos',
          filterNotice: null,
          outOfScope: false,
          own: [],
          inherited: [
            {
              id: 'tpl-inst-1',
              name: 'Padrão UFBA',
              eventId: null,
              kind: 'PARTICIPATION',
              page: 'A4_LANDSCAPE',
              hasBackground: false,
              backgroundBytes: 0,
              backgroundNotice: null,
              elementCount: 4,
              updatedAt: new Date('2026-11-01T12:00:00.000Z'),
            },
          ],
          institutionalCount: 1,
          editingName: null,
          presetName: null,
          editorModel: null,
          salvo: false,
        },
      }),
    );

    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      expect(html).toContain(`data-testid="preset-thumbnail-${preset.id}"`);
    }
    expect(html).toContain('<svg');
    expect(html).toContain('data-testid="template-readonly-tpl-inst-1"');
    expect(html).toContain('data-testid="template-clone-to-event-tpl-inst-1"');
    expect(html).toContain('Personalizar cópia neste evento');
  });
});
