/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A SIMULAÇÃO QUE NÃO MENTE — contagem, estimativa e a régua de consultas
 *  (FASE 85 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA — E O QUE ELE NÃO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a CONTAGEM da tela sai dos vereditos: pessoas elegíveis (não pares), pares a
 *    emitir e descartados com o motivo preservado;
 *  • a fração é elegíveis ÷ escopo e é `null` sem escopo — nunca 0 % inventado;
 *  • a estimativa de tempo respeita a amostra mínima e não inventa constante;
 *  • a projeção em lote tem NO MÁXIMO 6 chamadas Prisma (régua de fonte) e o
 *    preview não chama nada que grave.
 *
 *  O que ele NÃO prova é que os vereditos coincidem com a emissão: isso é a
 *  catraca de integração (`tests/integration/f85-preview-e-emissao.test.ts`), com
 *  banco real. Um teste de fonte não substitui o outro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BATCH_KINDS,
  MIN_GENERATION_SAMPLE,
  estimateGenerationTime,
  summarizeEventPreview,
  type PreviewPerson,
} from '../../src/domain/certificates/certificate-preview-rules';

const SERVICO = join(process.cwd(), 'src/lib/certificates/certificate-service.ts');

function pessoa(
  userId: string,
  name: string,
  vereditos: { kind: PreviewPerson['verdicts'][number]['kind']; eligible: boolean; reason?: string }[],
): PreviewPerson {
  return {
    userId,
    name,
    verdicts: vereditos.map((veredito) => ({
      kind: veredito.kind,
      eligible: veredito.eligible,
      reason: veredito.reason ?? (veredito.eligible ? 'Elegível.' : 'Não elegível.'),
    })),
  };
}

describe('a contagem da simulação', () => {
  it('conta PESSOAS elegíveis e PARES a emitir — e preserva o motivo de cada descarte', () => {
    const people: PreviewPerson[] = [
      pessoa('ana', 'Ana', [
        { kind: 'ATTENDANCE', eligible: true },
        { kind: 'MINI_COURSE', eligible: true },
      ]),
      pessoa('bruno', 'Bruno', [
        {
          kind: 'ATTENDANCE',
          eligible: false,
          reason: 'Presença de 10 min abaixo do mínimo de 45 min (75 % da carga).',
        },
        {
          kind: 'MINI_COURSE',
          eligible: false,
          reason: 'Nenhum minicurso com carga horária cumprida (mínimo de 75 % da carga da atividade).',
        },
      ]),
      pessoa('carla', 'Carla', [
        { kind: 'ATTENDANCE', eligible: true },
        { kind: 'MINI_COURSE', eligible: false, reason: 'Este evento não tem minicursos.' },
      ]),
      // Pessoa sem veredito (nenhum tipo simulado) continua no ESCOPO.
      pessoa('diego', 'Diego', []),
    ];

    const summary = summarizeEventPreview({ scope: 4, people });

    expect(summary.scope).toBe(4);
    expect(summary.eligiblePeople).toBe(2);
    expect(summary.eligibleRatio).toBe(0.5);
    expect(summary.certificatesToIssue).toBe(3);
    expect(summary.discarded).toHaveLength(3);

    // O motivo é o TEXTO do domínio, não uma frase da tela.
    expect(summary.discarded.map((item) => item.reason)).toContain(
      'Presença de 10 min abaixo do mínimo de 45 min (75 % da carga).',
    );
    expect(summary.discarded.map((item) => item.name)).toEqual(['Bruno', 'Bruno', 'Carla']);
  });

  it('sem escopo a fração é null — "não há denominador" não é 0 %', () => {
    const summary = summarizeEventPreview({ scope: 0, people: [] });

    expect(summary.scope).toBe(0);
    expect(summary.eligiblePeople).toBe(0);
    expect(summary.eligibleRatio).toBeNull();
    expect(summary.certificatesToIssue).toBe(0);
    expect(summary.discarded).toEqual([]);
  });

  it('a fração usa o escopo inteiro, inclusive quem não tem veredito', () => {
    const summary = summarizeEventPreview({
      scope: 3,
      people: [pessoa('ana', 'Ana', [{ kind: 'ATTENDANCE', eligible: true }]), pessoa('bruno', 'Bruno', [])],
    });

    // 1 elegível de 3 no escopo — não 1 de 2 pessoas com veredito.
    expect(summary.eligibleRatio).toBeCloseTo(1 / 3, 10);
  });
});

describe('a estimativa de tempo', () => {
  it('sem amostra, não há estimativa', () => {
    expect(estimateGenerationTime({ certificates: 40, sample: null })).toBeNull();
  });

  it(`com menos de ${MIN_GENERATION_SAMPLE} PDFs medidos, ainda não há estimativa`, () => {
    expect(
      estimateGenerationTime({
        certificates: 40,
        sample: { averageMs: 900, sampleSize: MIN_GENERATION_SAMPLE - 1 },
      }),
    ).toBeNull();
  });

  it('com a amostra mínima, o total é N × média (soma do trabalho)', () => {
    const estimate = estimateGenerationTime({
      certificates: 40,
      sample: { averageMs: 900, sampleSize: MIN_GENERATION_SAMPLE },
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.totalMs).toBe(36_000);
    expect(estimate?.sampleSize).toBe(MIN_GENERATION_SAMPLE);
    expect(estimate?.averageMs).toBe(900);
  });

  it('sem PDF a gerar o total é zero — e a amostra não é inventada', () => {
    const estimate = estimateGenerationTime({
      certificates: 0,
      sample: { averageMs: 1_200, sampleSize: 8 },
    });

    expect(estimate?.totalMs).toBe(0);
    expect(estimate?.sampleSize).toBe(8);
  });

  it('amostra inválida (média zero/negativa) não vira estimativa', () => {
    expect(
      estimateGenerationTime({
        certificates: 10,
        sample: { averageMs: 0, sampleSize: 10 },
      }),
    ).toBeNull();
  });
});

describe('a régua da projeção em lote (catraca de fonte)', () => {
  const source = readFileSync(SERVICO, 'utf8');

  function bloco(inicio: string, fim: string): string {
    const start = source.indexOf(inicio);
    const end = source.indexOf(fim, start);

    expect(start, `marcador ausente: ${inicio}`).toBeGreaterThan(-1);
    expect(end, `marcador ausente: ${fim}`).toBeGreaterThan(start);

    return source.slice(start, end);
  }

  it('a projeção faz no máximo 6 chamadas Prisma — e o custo não cresce com N', () => {
    const projecao = bloco('<!-- f85-projecao-inicio -->', '<!-- f85-projecao-fim -->');
    const chamadas = projecao.match(/tx\.[a-zA-Z]+\.(?:findMany|findFirst|count|groupBy|aggregate)\(/g) ?? [];

    expect(chamadas).toHaveLength(6);
    // O teto é o dobro da garantia: a catraca reprova quem acrescentar a sétima.
    expect(chamadas.length).toBeLessThanOrEqual(6);
  });

  it('o preview NÃO grava: não pede certificado, não enfileira e não gera PDF', () => {
    const preview = bloco('export async function previewEventCertificates', '//  Fase 1 — solicitação');

    expect(preview).not.toContain('requestCertificate(');
    expect(preview).not.toContain('issueCertificate(');
    expect(preview).not.toContain('enqueueCertificate(');
    expect(preview).not.toContain('generateCertificate(');
    expect(preview).not.toContain('tx.certificate.');
  });

  it('o preview alimenta a MESMA função de elegibilidade do domínio', () => {
    const preview = bloco('export async function previewEventCertificates', '//  Fase 1 — solicitação');

    expect(preview).toContain('evaluateEligibility(');
    // E os fatos passam pela MESMA montagem do caminho individual.
    expect(preview).toContain('baseFactsFrom(');
  });

  it('a simulação e o formulário marcam os mesmos tipos por padrão', () => {
    expect([...DEFAULT_BATCH_KINDS]).toEqual(['ATTENDANCE', 'MINI_COURSE']);
    // `MERIT` é decisão nominal do comitê, e `ORGANIZER` exige papel: nenhum dos
    // dois é um documento que o lote saiba distribuir.
    expect(DEFAULT_BATCH_KINDS).not.toContain('MERIT');
    expect(DEFAULT_BATCH_KINDS).not.toContain('ORGANIZER');
  });
});
