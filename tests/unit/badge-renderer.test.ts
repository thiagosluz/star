/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — folha de crachás em PDF (FASE 31)
 *
 *  O que só o renderizador pode provar:
 *    • o arquivo é um PDF VÁLIDO com N páginas (o certificado tem uma só; a folha de
 *      crachás é o primeiro documento multipágina do projeto);
 *    • a etiqueta carrega as três coisas que o balcão precisa: QR, CÓDIGO e NOME;
 *    • o MESMO lote gera os MESMOS bytes (determinismo, como no certificado);
 *    • um crachá só não gera página em branco, e 9 crachás geram duas páginas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  BADGES_PER_PAGE,
  renderBadgeSheetPdf,
  type BadgeLabel,
} from '../../src/lib/credentials/badge-renderer';
import { buildQrMatrix } from '../../src/lib/documents/pdf-text';

const badge = (index: number): BadgeLabel => ({
  name: `Participante Número ${index}`,
  code: `CR-ABCD-EFG${index}`,
  subtitle: 'Congresso de Tecnologia · UFBA',
});

const document = {
  tenantName: 'Universidade Federal da Bahia',
  eventTitle: 'Congresso de Tecnologia e Educação',
  generatedAt: new Date('2026-09-21T12:00:00.000Z'),
  badges: [badge(1), badge(2), badge(3)],
};

/** Conta as páginas declaradas no catálogo (`/Count N`). */
function declaredPages(pdf: string): number {
  const match = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf);

  return match ? Number(match[1]) : -1;
}

describe('a folha de crachás', () => {
  it('é um PDF válido, com trailer e xref', () => {
    const pdf = renderBadgeSheetPdf(document).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('xref');
    expect(pdf).toContain('trailer');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('declara UMA página para um lote que cabe em uma', () => {
    const pdf = renderBadgeSheetPdf({ ...document, badges: [badge(1)] }).toString('latin1');

    expect(declaredPages(pdf)).toBe(1);
  });

  it('declara DUAS páginas quando o lote passa de oito crachás', () => {
    const badges = Array.from({ length: BADGES_PER_PAGE + 1 }, (_, index) => badge(index % 10));
    const pdf = renderBadgeSheetPdf({ ...document, badges }).toString('latin1');

    expect(declaredPages(pdf)).toBe(2);
    expect(pdf).toContain('página 1/2');
    expect(pdf).toContain('página 2/2');
  });

  it('lote vazio ainda gera um PDF válido (uma página sem crachá)', () => {
    const pdf = renderBadgeSheetPdf({ ...document, badges: [] }).toString('latin1');

    expect(declaredPages(pdf)).toBe(1);
    expect(pdf).toContain('/Type /Page ');
  });

  it('a etiqueta tem o NOME, o CÓDIGO e o QR Code', () => {
    const pdf = renderBadgeSheetPdf({
      ...document,
      badges: [{ name: 'Ana Souza', code: 'CR-ABCD-EFGH', subtitle: null }],
    }).toString('latin1');

    expect(pdf).toContain('(Ana Souza) Tj');
    expect(pdf).toContain('(CR-ABCD-EFGH) Tj');

    // O QR é desenhado como vetor: a quantidade de retângulos tem de bater com a
    // matriz do gerador (é o mesmo QR que a câmera vai ler).
    const qr = buildQrMatrix('CR-ABCD-EFGH');
    const filled = [...qr.data].filter(Boolean).length;

    expect(pdf.split(' re f').length - 1).toBeGreaterThanOrEqual(filled);
  });

  it('o texto é escapado (parêntese e barra no nome não quebram o arquivo)', () => {
    const pdf = renderBadgeSheetPdf({
      ...document,
      badges: [{ name: 'Ana (Souza)', code: 'CR-ABCD-EFGH' }],
    }).toString('latin1');

    expect(pdf).toContain('(Ana \\(Souza\\)) Tj');

    const withBackslash = renderBadgeSheetPdf({
      ...document,
      badges: [{ name: 'A\\B', code: 'CR-ABCD-EFGH' }],
    }).toString('latin1');

    expect(withBackslash).toContain('(A\\\\B) Tj');
  });

  it('o MESMO lote gera os MESMOS bytes', () => {
    const first = renderBadgeSheetPdf(document);
    const second = renderBadgeSheetPdf(document);

    expect(first.equals(second)).toBe(true);
  });

  it('nome longo é quebrado em vez de sair da etiqueta', () => {
    const pdf = renderBadgeSheetPdf({
      ...document,
      badges: [
        {
          name: 'Maria da Conceição Aparecida dos Santos Oliveira Albuquerque Neta',
          code: 'CR-ABCD-EFGH',
        },
      ],
    }).toString('latin1');

    // Duas linhas de nome: duas chamadas com o mesmo tamanho de fonte.
    expect(pdf.split('/F2 13 Tf').length - 1).toBe(2);
  });
});
