/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — versões da página, publicação agendada e cópia de patrocínio
 *  (FASE 23, itens E11, E12 e E13)
 *
 *  O foco é o que quebra em silêncio:
 *    • checksum estável (ordem de chave não pode mudar o hash, senão a deduplicação
 *      e a marcação de "versão atual" param de funcionar);
 *    • despublicar LIMPA a data (senão a página volta ao ar sozinha);
 *    • cópia de patrocinador casa a cota pela CHAVE e nasce oculta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_PAGE_VERSIONS,
  PAGE_VERSION_REASONS,
  canonicalize,
  shouldRecordVersion,
  snapshotChecksum,
  snapshotToBlockRows,
  summarizeSnapshot,
  versionsToPrune,
  type PageSnapshot,
} from '../../src/domain/events/page-version-rules';
import {
  PUBLICATION_STATE_LABELS,
  planPublication,
  resolvePublicationState,
} from '../../src/domain/events/landing-page';
import {
  isAlreadySponsored,
  planSponsorCopy,
  type SponsorCopySource,
} from '../../src/domain/events/sponsor-rules';
import { ASSET_TARGETS, MAX_IMAGE_BYTES, validateImageUpload } from '../../src/domain/events/image-rules';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    title: 'Congresso 2026',
    metaTitle: null,
    metaDescription: null,
    isPublished: false,
    publishAt: null,
    blocks: [{ type: 'RICH_TEXT', content: { body: 'Olá' }, displayOrder: 0, isVisible: true }],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('canonicalize() e snapshotChecksum()', () => {
  it('a ORDEM DAS CHAVES não muda o resultado', () => {
    /**
     * Sem canonicalizar, dois objetos iguais com chaves em ordem diferente produzem
     * strings diferentes — e a deduplicação de versões falharia em silêncio, gravando
     * uma versão "nova" a cada salvamento.
     */
    const a = { b: 1, a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, b: 1 };

    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('a ordem de um ARRAY é preservada — ela é o dado', () => {
    // A ordem das perguntas frequentes é escolha do organizador.
    expect(canonicalize([3, 1, 2])).not.toBe(canonicalize([1, 2, 3]));
  });

  it('o checksum é estável e muda quando o conteúdo muda', () => {
    const base = snapshot();
    expect(snapshotChecksum(base)).toBe(snapshotChecksum(snapshot()));

    expect(snapshotChecksum(snapshot({ title: 'Outro' }))).not.toBe(snapshotChecksum(base));

    const changedBlock = snapshot({
      blocks: [{ type: 'RICH_TEXT', content: { body: 'Outro texto' }, displayOrder: 0, isVisible: true }],
    });
    expect(snapshotChecksum(changedBlock)).not.toBe(snapshotChecksum(base));
  });

  it('o checksum é hexadecimal de 64 caracteres (SHA-256)', () => {
    expect(snapshotChecksum(snapshot())).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('shouldRecordVersion()', () => {
  it('não grava quando o estado é idêntico ao da última versão', () => {
    const current = snapshot();
    expect(shouldRecordVersion(snapshotChecksum(current), current)).toBe(false);
  });

  it('grava quando não há versão anterior', () => {
    expect(shouldRecordVersion(null, snapshot())).toBe(true);
  });

  it('grava quando só a VISIBILIDADE de um bloco mudou', () => {
    const hidden = snapshot({
      blocks: [{ type: 'RICH_TEXT', content: { body: 'Olá' }, displayOrder: 0, isVisible: false }],
    });
    expect(shouldRecordVersion(snapshotChecksum(snapshot()), hidden)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('summarizeSnapshot()', () => {
  it('conta blocos e lista os tipos', () => {
    const summary = summarizeSnapshot(
      snapshot({
        blocks: [
          { type: 'RICH_TEXT', content: {}, displayOrder: 0, isVisible: true },
          { type: 'FAQ', content: {}, displayOrder: 10, isVisible: true },
        ],
      }),
    );

    expect(summary.blockCount).toBe(2);
    expect(summary.types).toEqual(['RICH_TEXT', 'FAQ']);
  });

  it('DESCARTA tipo desconhecido em vez de quebrar o histórico', () => {
    // Uma versão gravada antes da remoção de um tipo precisa continuar listável.
    const summary = summarizeSnapshot(
      snapshot({
        blocks: [
          { type: 'BLOCO_DO_PASSADO' as never, content: {}, displayOrder: 0, isVisible: true },
          { type: 'FAQ', content: {}, displayOrder: 10, isVisible: true },
        ],
      }),
    );

    expect(summary.blockCount).toBe(2);
    expect(summary.types).toEqual(['FAQ']);
  });

  it('resiste a snapshot corrompido', () => {
    expect(summarizeSnapshot(null).blockCount).toBe(0);
    expect(summarizeSnapshot({ blocks: 'não é lista' }).blockCount).toBe(0);
  });

  it('carrega o estado de publicação gravado', () => {
    const summary = summarizeSnapshot(
      snapshot({ isPublished: true, publishAt: '2026-12-01T12:00:00.000Z' }),
    );
    expect(summary.isPublished).toBe(true);
    expect(summary.publishAt).toBe('2026-12-01T12:00:00.000Z');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('versionsToPrune()', () => {
  it('não poda enquanto está dentro do teto', () => {
    const versions = Array.from({ length: MAX_PAGE_VERSIONS }, (_, i) => ({ id: `v${i}` }));
    expect(versionsToPrune(versions)).toEqual([]);
  });

  it('poda as MAIS ANTIGAS (a lista chega da mais recente para a mais antiga)', () => {
    const versions = Array.from({ length: MAX_PAGE_VERSIONS + 3 }, (_, i) => ({ id: `v${i}` }));
    expect(versionsToPrune(versions)).toEqual([
      `v${MAX_PAGE_VERSIONS}`,
      `v${MAX_PAGE_VERSIONS + 1}`,
      `v${MAX_PAGE_VERSIONS + 2}`,
    ]);
  });

  it('respeita um teto explícito', () => {
    expect(versionsToPrune([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).toEqual(['c']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('snapshotToBlockRows()', () => {
  it('reindexa a ordem a partir de zero, com o passo pedido', () => {
    const rows = snapshotToBlockRows(
      snapshot({
        blocks: [
          { type: 'FAQ', content: {}, displayOrder: 40, isVisible: true },
          { type: 'RICH_TEXT', content: {}, displayOrder: 7, isVisible: false },
        ],
      }),
      10,
    );

    expect(rows.map((row) => row.displayOrder)).toEqual([0, 10]);
    expect(rows.map((row) => row.type)).toEqual(['FAQ', 'RICH_TEXT']);
    expect(rows[1]?.isVisible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('planPublication()', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');
  const tomorrow = new Date('2026-09-19T12:00:00.000Z');
  const yesterday = new Date('2026-09-17T12:00:00.000Z');

  it('publicar agora grava publicado e SEM data', () => {
    const plan = planPublication({ publishNow: true, publishAt: null, now });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('PUBLISHED');
      expect(plan.isPublished).toBe(true);
      expect(plan.publishAt).toBeNull();
    }
  });

  it('data no futuro agenda, sem publicar', () => {
    const plan = planPublication({ publishNow: false, publishAt: tomorrow, now });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('SCHEDULED');
      expect(plan.isPublished).toBe(false);
      expect(plan.publishAt).toEqual(tomorrow);
      expect(plan.message).toContain('entra no ar');
    }
  });

  it('RECUSA publicar agora E agendar ao mesmo tempo', () => {
    const plan = planPublication({ publishNow: true, publishAt: tomorrow, now });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('publicar agora ou agendar');
  });

  it('DESPUBLICAR LIMPA a data — senão a página voltaria ao ar sozinha', () => {
    /**
     * O caso real: a página foi agendada para ontem, já entrou no ar, e o organizador
     * a tira do ar. Se a data continuasse gravada, a condição de visibilidade
     * (`isPublished || publishAt <= now`) a republicaria no instante seguinte.
     */
    const plan = planPublication({ publishNow: false, publishAt: null, now });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('DRAFT');
      expect(plan.isPublished).toBe(false);
      expect(plan.publishAt).toBeNull();
    }
  });

  it('data no PASSADO publica imediatamente (não deixa a página fora do ar para sempre)', () => {
    const plan = planPublication({ publishNow: false, publishAt: yesterday, now });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('PUBLISHED');
      expect(plan.isPublished).toBe(true);
      expect(plan.publishAt).toBeNull();
    }
  });

  it('data igual a agora publica (o limite é inclusivo)', () => {
    const plan = planPublication({ publishNow: false, publishAt: now, now });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.state).toBe('PUBLISHED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolvePublicationState()', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');

  it('publicada vence qualquer data', () => {
    expect(resolvePublicationState({ isPublished: true, publishAt: null }, now)).toBe('PUBLISHED');
    expect(
      resolvePublicationState({ isPublished: true, publishAt: new Date('2027-01-01') }, now),
    ).toBe('PUBLISHED');
  });

  it('data futura é agendada; data passada é publicada; sem data é rascunho', () => {
    expect(
      resolvePublicationState({ isPublished: false, publishAt: new Date('2027-01-01') }, now),
    ).toBe('SCHEDULED');
    expect(
      resolvePublicationState({ isPublished: false, publishAt: new Date('2026-01-01') }, now),
    ).toBe('PUBLISHED');
    expect(resolvePublicationState({ isPublished: false, publishAt: null }, now)).toBe('DRAFT');
  });

  it('todo estado tem rótulo em pt-BR', () => {
    for (const state of ['DRAFT', 'SCHEDULED', 'PUBLISHED'] as const) {
      expect(PUBLICATION_STATE_LABELS[state]).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('planSponsorCopy()', () => {
  const source: SponsorCopySource = {
    name: 'Instituto de Tecnologia Aberta',
    description: 'Apoiadora do congresso.',
    websiteUrl: 'https://example.org/ita',
    logoUrl: 'https://cdn.test/ita.png',
    contactName: 'Marina Alves',
    contactEmail: 'marina@example.org',
    contactPhone: '+55 71 99999-0000',
    taxId: '12345678000199',
    tierKey: 'GOLD',
  };

  it('casa a cota pela CHAVE, não pelo nome', () => {
    const plan = planSponsorCopy(source, {
      eventId: 'e2',
      tiers: [{ id: 't-ouro', key: 'GOLD' }],
    });

    expect(plan.tierId).toBe('t-ouro');
    expect(plan.tierMatched).toBe(true);
  });

  it('sem cota correspondente, entra sem cota e AVISA', () => {
    const plan = planSponsorCopy(source, {
      eventId: 'e2',
      tiers: [{ id: 't-prata', key: 'SILVER' }],
    });

    expect(plan.tierId).toBeNull();
    expect(plan.tierMatched).toBe(false);
  });

  it('a cópia nasce OCULTA — não publica marca sem contrato fechado', () => {
    expect(planSponsorCopy(source, { eventId: 'e2', tiers: [] }).isActive).toBe(false);
  });

  it('leva contato, site, logo e documento; o VALOR do contrato não existe no plano', () => {
    const plan = planSponsorCopy(source, { eventId: 'e2', tiers: [] });

    expect(plan.contactEmail).toBe('marina@example.org');
    expect(plan.websiteUrl).toBe('https://example.org/ita');
    expect(plan.logoUrl).toBe('https://cdn.test/ita.png');
    expect(plan.taxId).toBe('12345678000199');
    // O valor é renegociado a cada edição: não há campo no plano de cópia.
    expect('contractValueCents' in plan).toBe(false);
  });

  it('sem cota na origem, não inventa cota no destino', () => {
    const plan = planSponsorCopy({ ...source, tierKey: null }, {
      eventId: 'e2',
      tiers: [{ id: 't-ouro', key: 'GOLD' }],
    });

    expect(plan.tierId).toBeNull();
    expect(plan.tierMatched).toBe(false);
  });
});

describe('isAlreadySponsored()', () => {
  it('ignora caixa, acento e espaço repetido', () => {
    expect(isAlreadySponsored('Editora Ciência Viva', ['editora ciencia  viva'])).toBe(true);
    expect(isAlreadySponsored('INSTITUTO PARCEIRO', ['Instituto Parceiro'])).toBe(true);
  });

  it('não confunde empresas diferentes', () => {
    expect(isAlreadySponsored('Instituto Alfa', ['Instituto Beta'])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('imagem de galeria (E10)', () => {
  it('GALLERY é uma finalidade com limite próprio', () => {
    expect(ASSET_TARGETS).toContain('GALLERY');
    expect(MAX_IMAGE_BYTES.GALLERY).toBeGreaterThan(0);
    // Múltiplas imagens na mesma página: o limite é menor que o da capa.
    expect(MAX_IMAGE_BYTES.GALLERY).toBeLessThan(MAX_IMAGE_BYTES.COVER);
  });

  it('aceita PNG dentro do limite e recusa acima dele', () => {
    const ok = validateImageUpload({
      target: 'GALLERY',
      fileName: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: MAX_IMAGE_BYTES.GALLERY,
      magicBytes: PNG,
    });
    expect(ok.ok).toBe(true);

    const tooBig = validateImageUpload({
      target: 'GALLERY',
      fileName: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: MAX_IMAGE_BYTES.GALLERY + 1,
      magicBytes: PNG,
    });
    expect(tooBig.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('rótulos das versões', () => {
  it('todo motivo canônico é texto em pt-BR legível', () => {
    for (const reason of Object.values(PAGE_VERSION_REASONS)) {
      expect(reason.length).toBeGreaterThan(3);
      expect(reason.length).toBeLessThanOrEqual(120);
    }
  });
});
