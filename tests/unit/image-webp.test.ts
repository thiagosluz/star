/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — WebP como formato de armazenamento (FASE 46)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra da fase é "toda imagem enviada vira WebP no servidor". Aqui ela é
 *  verificada em dois níveis:
 *
 *    • a POLÍTICA (domínio) — todo alvo tem política, as fotos têm teto e os
 *      logotipos não, a chave troca de extensão, a economia é relatada;
 *    • a CONVERSÃO (infraestrutura) — com BYTES DE VERDADE, gerados no próprio
 *      teste: o arquivo sai WebP, o teto é respeitado, a transparência sobrevive,
 *      a orientação do EXIF é assentada, os metadados somem, imagem animada é
 *      recusada e bomba de pixels é recusada ANTES de alocar memória.
 *
 *  Nada aqui depende de fixture binária no repositório: as imagens de entrada são
 *  construídas pelo `sharp` e o único arquivo montado à mão é o cabeçalho (usado
 *  justamente porque o corpo não precisa existir para a checagem que ele exercita).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { deflateSync, crc32 } from 'node:zlib';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  ASSET_TARGETS,
  MAX_SOURCE_PIXELS,
  STORED_IMAGE_MIME,
  WEBP_POLICY,
  imageFormatLabel,
  webpKeyFor,
  webpSavingsLabel,
} from '../../src/domain/events/image-rules';
import { encodeAssetAsWebp } from '../../src/lib/storage/image-converter';

// ───────────────────────────────────────────────────────────────────────────────
//  Construtores de bytes
// ───────────────────────────────────────────────────────────────────────────────
async function png(width: number, height: number, alpha = true): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 12, g: 120, b: 200, alpha: 0.5 } : { r: 12, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

/** PNG cujo CABEÇALHO declara as medidas e cujo corpo não existe. */
function pngHeaderOnly(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body) >>> 0, 0);

    return Buffer.concat([length, body, checksum]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    // 1 bit por pixel: o tamanho comprimido não tem relação com o número de pixels,
    // que é exatamente o que faz a bomba de descompressão existir.
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** WebP com a marca de ANIMAÇÃO no contêiner (`VP8X`, bit 0x02). */
function animatedWebpHeader(): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write('VP8X', 12, 'latin1');
  bytes.writeUInt32LE(10, 16);
  bytes[20] = 0x02;
  return bytes;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('política de armazenamento', () => {
  it('todo destino de imagem tem política de WebP — inclusive os que vierem depois', () => {
    /**
     * Este teste é uma CATRACA: um alvo novo em `ASSET_TARGETS` sem política não
     * compila e não passa aqui. Sem ele, o alvo novo cairia no `undefined` do
     * `Record` em runtime — e a imagem seria gravada no formato que o cliente mandou.
     */
    for (const target of ASSET_TARGETS) {
      expect(WEBP_POLICY[target], `sem política de WebP para ${target}`).toBeDefined();
      expect(['FOTOGRAFIA', 'GRAFICO']).toContain(WEBP_POLICY[target].mode);
    }
  });

  it('as fotos têm teto de pixels e os logotipos não', () => {
    expect(WEBP_POLICY.SPEAKER_AVATAR.maxLongestSide).toBe(512);
    expect(WEBP_POLICY.COVER.maxLongestSide).toBe(1920);
    expect(WEBP_POLICY.GALLERY.maxLongestSide).toBe(2560);

    // Logotipo é pequeno e é visto no tamanho que tem: reduzir borraria a marca.
    expect(WEBP_POLICY.LOGO.maxLongestSide).toBeNull();
    expect(WEBP_POLICY.SPONSOR_LOGO.maxLongestSide).toBeNull();

    // O modo decide a codificação: marca tem borda de letra e não pode ter perda.
    expect(WEBP_POLICY.LOGO.mode).toBe('GRAFICO');
    expect(WEBP_POLICY.COVER.mode).toBe('FOTOGRAFIA');
  });

  it('a chave do objeto troca só a extensão', () => {
    expect(webpKeyFor('tenants/t/eventos/e/assets/cover/abc-capa.png')).toBe(
      'tenants/t/eventos/e/assets/cover/abc-capa.webp',
    );
    expect(webpKeyFor('a/foto.jpeg')).toBe('a/foto.webp');
    expect(webpKeyFor('a/foto.avif')).toBe('a/foto.webp');
    // Idempotente: reconverter a chave já convertida não vira `foto.webp.webp`.
    expect(webpKeyFor('a/foto.webp')).toBe('a/foto.webp');
    // Sem extensão, ganha uma.
    expect(webpKeyFor('a/foto')).toBe('a/foto.webp');
  });

  it('a economia só é anunciada quando existe', () => {
    expect(webpSavingsLabel(1000, 250)).toBe('75% menor');
    // Imagem minúscula pode CRESCER ao virar WebP: aí a frase certa é nenhuma.
    expect(webpSavingsLabel(100, 100)).toBeNull();
    expect(webpSavingsLabel(100, 140)).toBeNull();
    expect(webpSavingsLabel(0, 10)).toBeNull();
    expect(webpSavingsLabel(Number.NaN, 10)).toBeNull();
  });

  it('o rótulo do formato é o que o acervo mostra', () => {
    expect(STORED_IMAGE_MIME).toBe('image/webp');
    expect(imageFormatLabel('image/webp')).toBe('WebP');
    expect(imageFormatLabel('image/png')).toBe('PNG');
    // O acervo anterior à fase continua dizendo a verdade sobre o que guarda.
    expect(imageFormatLabel('image/jpeg; charset=binary')).toBe('JPEG');
    expect(imageFormatLabel('application/octet-stream')).toBe('application/octet-stream');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('conversão para WebP', () => {
  it('o PNG enviado vira WebP — e a assinatura do arquivo confirma', async () => {
    const source = await png(900, 600);
    const result = await encodeAssetAsWebp({
      bytes: source,
      target: 'GALLERY',
      sourceMime: 'image/png',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.bytes.toString('latin1', 0, 4)).toBe('RIFF');
    expect(result.bytes.toString('latin1', 8, 12)).toBe('WEBP');
    expect(result.bytes.length).toBeLessThan(source.length);
    expect(result.widthPx).toBe(900);
    expect(result.heightPx).toBe(600);
    expect(result.resized).toBe(false);
  });

  it('a foto acima do teto é reduzida sem perder a proporção', async () => {
    const result = await encodeAssetAsWebp({
      bytes: await png(3000, 2000),
      target: 'COVER',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.resized).toBe(true);
    expect(Math.max(result.widthPx, result.heightPx)).toBe(WEBP_POLICY.COVER.maxLongestSide);
    // 3000×2000 é 3:2 — a proporção sobrevive (1920×1280), e não vira quadrado.
    expect(result.widthPx).toBe(1920);
    expect(result.heightPx).toBe(1280);
  });

  it('a foto do palestrante cabe em 512 px', async () => {
    const result = await encodeAssetAsWebp({
      bytes: await png(1200, 1600),
      target: 'SPEAKER_AVATAR',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.heightPx).toBe(512);
    expect(result.widthPx).toBe(384);
  });

  it('NUNCA amplia: imagem menor que o teto fica do tamanho que é', async () => {
    const result = await encodeAssetAsWebp({
      bytes: await png(200, 150),
      target: 'SPEAKER_AVATAR',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.resized).toBe(false);
    expect(result.widthPx).toBe(200);
    expect(result.heightPx).toBe(150);
  });

  it('a transparência sobrevive à conversão', async () => {
    const result = await encodeAssetAsWebp({
      bytes: await png(64, 64, true),
      target: 'LOGO',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const meta = await sharp(result.bytes).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('o logotipo vai SEM PERDA — e ainda assim fica menor que o PNG', async () => {
    /**
     * Logotipo é gráfico chapado: com perda, o artefato aparece na borda da letra. O
     * WebP sem perda resolve os dois lados — a marca continua nítida e o arquivo
     * ainda é menor que o PNG de origem.
     */
    const source = await sharp({
      create: { width: 300, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="300" height="120"><rect x="10" y="10" width="280" height="100" fill="#cc0000"/></svg>',
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    const result = await encodeAssetAsWebp({
      bytes: source,
      target: 'LOGO',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.mode).toBe('GRAFICO');
    expect(result.widthPx).toBe(300);
    expect(result.bytes.length).toBeLessThan(source.length);
  });

  it('assenta a orientação do EXIF e NÃO leva os metadados junto', async () => {
    /**
     * A foto de celular deitada carrega a orientação no EXIF. O WebP gravado sem os
     * metadados depende de a orientação já estar ASSENTADA nos pixels — senão a
     * vitrine mostraria a foto girada. E os metadados que somem incluem a data e as
     * coordenadas, que é o ganho de privacidade anunciado na tela.
     */
    const rotated = await sharp({
      create: { width: 60, height: 30, channels: 3, background: '#123456' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const before = await sharp(rotated).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();

    const result = await encodeAssetAsWebp({
      bytes: rotated,
      target: 'GALLERY',
      sourceMime: 'image/jpeg',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 60×30 com orientação 6 é, de fato, 30×60.
    expect(result.widthPx).toBe(30);
    expect(result.heightPx).toBe(60);

    const after = await sharp(result.bytes).metadata();
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
  });

  it('recusa o que não é imagem — é a única checagem que DECODIFICA o arquivo', async () => {
    const result = await encodeAssetAsWebp({
      bytes: Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
      target: 'COVER',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/não pôde ser lido como imagem/i);
  });

  it('recusa imagem ANIMADA em vez de achatá-la em um quadro', async () => {
    // O contêiner declara animação. O corpo nem existe: a recusa acontece antes de
    // decodificar, então nada é alocado para dizer não.
    const result = await encodeAssetAsWebp({
      bytes: animatedWebpHeader(),
      target: 'GALLERY',
      sourceMime: 'image/webp',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/animada não é aceita/i);
  });

  it('recusa a bomba de pixels pelo CABEÇALHO, sem abrir a imagem', async () => {
    /**
     * 8.000 × 6.000 = 48 megapixels, acima do teto de 40 — e o arquivo tem algumas
     * dezenas de bytes, porque só o cabeçalho existe. Limite por BYTES não pegaria
     * isto: é o limite por PIXELS que impede a imagem pequena de pedir gigabytes.
     */
    const bomb = pngHeaderOnly(8000, 6000);
    expect(bomb.length).toBeLessThan(200);

    const result = await encodeAssetAsWebp({
      bytes: bomb,
      target: 'COVER',
      sourceMime: 'image/png',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/acima do limite/i);
    expect(8000 * 6000).toBeGreaterThan(MAX_SOURCE_PIXELS);
  });
});
