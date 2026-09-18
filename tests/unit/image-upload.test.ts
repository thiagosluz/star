/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — IMAGENS do evento (FASE 17, item E4)
 *
 *  Uma imagem enviada pelo organizador é servida PÚBLICA e indefinidamente pela
 *  página do evento. Isso muda a natureza da validação: não basta o tamanho — o
 *  arquivo precisa SER uma imagem, e não um documento disfarçado de `.png`.
 *
 *  Por isso o teste central aqui é o da ASSINATURA DO ARQUIVO: um `text/html` com
 *  extensão `.png` precisa ser recusado, porque o navegador interpretaria o
 *  `Content-Type` servido e executaria o que estivesse dentro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  ASSET_TARGETS,
  ASSET_TARGET_LABELS,
  IMAGE_ACCEPT_ATTRIBUTE,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  canonicalExtension,
  detectImageMime,
  formatBytes,
  validateImageUpload,
  type AssetTarget,
} from '../../src/domain/events/image-rules';

// ── Assinaturas reais, usadas como fixture ─────────────────────────────────────
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const AVIF = [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66];
/** SVG (texto) e HTML: NÃO são imagens aceitas. */
const SVG = [0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22];
const HTML = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0x20, 0x68, 0x74];

// ═══════════════════════════════════════════════════════════════════════════════
describe('catálogo de imagens', () => {
  it('toda finalidade tem rótulo e limite', () => {
    for (const target of ASSET_TARGETS) {
      expect(ASSET_TARGET_LABELS[target], `sem rótulo: ${target}`).toBeTruthy();
      expect(MAX_IMAGE_BYTES[target]).toBeGreaterThan(0);
    }
  });

  it('a capa aceita mais bytes que o logotipo (a capa é foto)', () => {
    expect(MAX_IMAGE_BYTES.COVER).toBeGreaterThan(MAX_IMAGE_BYTES.LOGO);
  });

  it('o atributo `accept` do formulário lista exatamente os tipos aceitos', () => {
    for (const mime of IMAGE_MIME_TYPES) {
      expect(IMAGE_ACCEPT_ATTRIBUTE).toContain(mime);
    }
    expect(IMAGE_ACCEPT_ATTRIBUTE).not.toContain('svg');
  });

  it('formata bytes de forma legível', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('detectImageMime()', () => {
  it('reconhece PNG, JPEG, WebP e AVIF pela assinatura', () => {
    expect(detectImageMime(PNG)).toBe('image/png');
    expect(detectImageMime(JPEG)).toBe('image/jpeg');
    expect(detectImageMime(WEBP)).toBe('image/webp');
    expect(detectImageMime(AVIF)).toBe('image/avif');
  });

  it('não reconhece SVG, HTML nem bytes insuficientes', () => {
    expect(detectImageMime(SVG)).toBeNull();
    expect(detectImageMime(HTML)).toBeNull();
    expect(detectImageMime([0x89, 0x50])).toBeNull();
    expect(detectImageMime(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateImageUpload()', () => {
  const cover = (overrides: Partial<Parameters<typeof validateImageUpload>[0]> = {}) => ({
    target: 'COVER' as AssetTarget,
    fileName: 'capa.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    magicBytes: PNG,
    ...overrides,
  });

  it('ACEITA arquivo cuja assinatura confere', () => {
    const result = validateImageUpload(cover());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe('image/png');
  });

  it('RECUSA HTML renomeado para .png — o caso que motiva o módulo', () => {
    /**
     * O cliente pode mentir sobre o tipo e sobre a extensão; os BYTES não. Aceitar
     * isto significaria servir HTML no domínio da instituição, com o navegador do
     * visitante interpretando `<script>` — e o objeto ficaria público no bucket.
     */
    const result = validateImageUpload(
      cover({ fileName: 'capa.png', mimeType: 'image/png', magicBytes: HTML }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('NOT_AN_IMAGE');
  });

  it('a via fraca (tipo declarado + extensão) só vale quando NÃO há bytes', () => {
    expect(validateImageUpload(cover({ magicBytes: null })).ok).toBe(true);
    expect(validateImageUpload(cover({ magicBytes: null, fileName: 'capa.txt' })).ok).toBe(false);
  });

  it('RECUSA SVG explicitamente, com o motivo na mensagem', () => {
    const result = validateImageUpload(
      cover({ fileName: 'logo.svg', mimeType: 'image/svg+xml', magicBytes: SVG }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('NOT_SVG');
      expect(result.errors[0]?.message).toContain('script');
    }
  });

  it('recusa arquivo vazio', () => {
    const result = validateImageUpload(cover({ sizeBytes: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('EMPTY');
  });

  it('recusa acima do limite DA FINALIDADE', () => {
    const overCover = validateImageUpload(cover({ sizeBytes: MAX_IMAGE_BYTES.COVER + 1 }));
    expect(overCover.ok).toBe(false);
    if (!overCover.ok) expect(overCover.errors[0]?.code).toBe('TOO_LARGE');

    // 2 MB é aceitável na capa e recusado no logotipo.
    expect(validateImageUpload(cover({ sizeBytes: 2 * 1024 * 1024 })).ok).toBe(true);
    expect(
      validateImageUpload(
        cover({ target: 'LOGO', sizeBytes: 2 * 1024 * 1024, fileName: 'logo.png' }),
      ).ok,
    ).toBe(false);
  });

  it('ACEITA quando a assinatura é de imagem e o tipo declarado é genérico', () => {
    /**
     * Caso normal, não excepcional: câmera e "arrastar e soltar" mandam
     * `application/octet-stream` com um JPEG dentro. O tipo GRAVADO é o real.
     */
    const result = validateImageUpload(
      cover({ mimeType: 'application/octet-stream', fileName: 'IMG_1234.jpg', magicBytes: JPEG }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe('image/jpeg');
  });

  it('recusa tipo declarado fora da allowlist quando não há assinatura', () => {
    const result = validateImageUpload(
      cover({ mimeType: 'application/pdf', fileName: 'capa.pdf', magicBytes: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('recusa nome de arquivo incoerente com o tipo declarado (sem assinatura)', () => {
    const result = validateImageUpload(
      cover({ fileName: 'capa.pdf', mimeType: 'image/png', magicBytes: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('TYPE_MISMATCH');
  });

  it('a divergência entre tipo declarado e extensão NÃO impede quando a assinatura confere', () => {
    const result = validateImageUpload(
      cover({ fileName: 'foto.jpeg', mimeType: 'image/png', magicBytes: JPEG }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe('image/jpeg');
  });

  it('usa a extensão CANÔNICA do tipo real (o nome enviado não vai para o bucket)', () => {
    expect(canonicalExtension('image/jpeg')).toBe('jpg');
    expect(canonicalExtension('image/png')).toBe('png');
    expect(canonicalExtension('image/webp')).toBe('webp');
    expect(canonicalExtension('image/avif')).toBe('avif');
  });
});
