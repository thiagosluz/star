/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS E CATRACAS DE FONTE — FASE 88
 *  O sign-out real da suíte (I9), a leitura única de patrocinador (I10) e o log
 *  obrigatório nos catches de leitura/contagem (B10)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ENTRY_DISCOVERY_PATH } from '../../src/domain/platform/entry-destination-rules';
import {
  resolveEntryDestinationForUser,
  type EntryDestinationDeps,
} from '../../src/lib/auth/entry-destination';

const ROOT = process.cwd();

function ler(relativo: string): string {
  return readFileSync(join(ROOT, relativo), 'utf8');
}

/** Remove comentários de bloco e de linha — a catraca inspeciona apenas o que executa. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ───────────────────────────────────────────────────────────────────────────────
//  1. DÍVIDA I9 — O `sign-out` da suíte E2E passa SEMPRE pelo helper `signOut`
// ───────────────────────────────────────────────────────────────────────────────
describe('FASE 88 · I9 — nenhuma spec E2E chama /api/auth/sign-out sem o helper', () => {
  const dirE2e = join(ROOT, 'tests/e2e');
  const specs = readdirSync(dirE2e).filter((nome) => nome.endsWith('.spec.ts'));

  it('o helper signOut em tests/e2e/helpers.ts envia data: {} e afirma response.ok()', () => {
    const codigo = semComentarios(ler('tests/e2e/helpers.ts'));

    expect(codigo).toContain('export async function signOut(');
    expect(codigo).toContain("page.request.post('/api/auth/sign-out'");
    expect(codigo).toContain('data: {}');
    expect(codigo).toContain('expect(response.ok()');
  });

  it('nenhum dos arquivos .spec.ts chama /api/auth/sign-out diretamente fora do helper', () => {
    const violacoes: string[] = [];

    for (const spec of specs) {
      const codigo = semComentarios(ler(`tests/e2e/${spec}`));

      if (codigo.includes('/api/auth/sign-out')) {
        violacoes.push(spec);
      }
    }

    expect(
      violacoes,
      `Chamada direta a /api/auth/sign-out encontrada fora de helpers.ts: ${violacoes.join(', ')}`,
    ).toEqual([]);
  });

  it('as 81 specs que faziam logout agora importam e chamam signOut de ./helpers', () => {
    let comSignOut = 0;

    for (const spec of specs) {
      const codigo = semComentarios(ler(`tests/e2e/${spec}`));

      if (/\bsignOut\s*\(/.test(codigo)) {
        comSignOut += 1;
        expect(codigo, `${spec} usa signOut sem importar de ./helpers`).toMatch(
          /import\s*\{[\s\S]*?\bsignOut\b[\s\S]*?\}\s*from\s*'\.\/helpers'/,
        );
      }
    }

    expect(comSignOut).toBeGreaterThanOrEqual(81);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  2. DÍVIDA I10 — `readSponsorAccess` unifica a leitura entre layout e página
// ───────────────────────────────────────────────────────────────────────────────
describe('FASE 88 · I10 — layout, painel e portal do patrocinador usam readSponsorAccess', () => {
  const CONSUMIDORES_RSC = [
    'src/app/t/[tenantSlug]/(app)/layout.tsx',
    'src/app/t/[tenantSlug]/(app)/dashboard/page.tsx',
    'src/app/t/[tenantSlug]/(app)/patrocinador/page.tsx',
  ] as const;

  it('sponsor-portal-service exporta readSponsorAccess envolto em React.cache com argumentos primitivos', () => {
    const codigo = semComentarios(ler('src/lib/sponsors/sponsor-portal-service.ts'));

    expect(codigo).toContain("import { cache } from 'react'");
    expect(codigo).toContain('export const readSponsorAccess');
    expect(codigo).toContain('cache((tenantId: string, userId: string) =>');
    expect(codigo).toContain('listSponsorAccess(tenantId, userId)');
  });

  for (const arquivo of CONSUMIDORES_RSC) {
    it(`${arquivo} consome readSponsorAccess e não chama listSponsorAccess direto`, () => {
      const codigo = semComentarios(ler(arquivo));

      expect(codigo).toContain('readSponsorAccess(');
      expect(codigo).not.toContain('listSponsorAccess');
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
//  3. DÍVIDA B10 — Nenhum catch mudo em serviços de contagem e leituras tolerantes
// ───────────────────────────────────────────────────────────────────────────────
describe('FASE 88 · B10 — falhas toleradas em contagens e leituras registram log', () => {
  it('resolveEntryDestinationForUser registra console.error quando loadPlatformPrincipal falha e preserva o fallback', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const deps: EntryDestinationDeps = {
        loadMemberships: async () => [],
        loadPlatformPrincipal: async () => {
          throw new Error('timeout na leitura do principal');
        },
        readDesiredTenantSlug: async () => null,
      };

      const destino = await resolveEntryDestinationForUser('user-b10', {}, deps);

      expect(destino).toBe(ENTRY_DISCOVERY_PATH);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain(
        '[entrada] falha ao consultar o principal de plataforma: timeout na leitura do principal',
      );
    } finally {
      spy.mockRestore();
    }
  });

  const SERVICOS_DE_CONTAGEM_E_LEITURA = [
    'src/lib/events/event-area-counts.ts',
    'src/lib/platform/profile-moderation.ts',
    'src/lib/review/rubric-guard.ts',
    'src/lib/exports/attendance-export-service.ts',
    'src/lib/auth/entry-destination.ts',
    'src/lib/auth/auth.ts',
  ] as const;

  for (const arquivo of SERVICOS_DE_CONTAGEM_E_LEITURA) {
    it(`${arquivo} não tem catch sem parâmetro e registra o erro capturado`, () => {
      const codigo = semComentarios(ler(arquivo));

      expect(codigo, `${arquivo} contém 'catch {' mudo`).not.toMatch(/\bcatch\s*\{/);
      expect(codigo).toMatch(/console\.(?:error|warn)|logger\.(?:error|warn)/);
    });
  }

  it('as leituras de métricas de fila (queue.ts e email-queue.ts) registram logger.warn nos catches', () => {
    const certQueue = semComentarios(ler('src/lib/certificates/queue.ts'));
    const emailQueue = semComentarios(ler('src/lib/communication/email-queue.ts'));

    expect(certQueue).toContain("logger.warn('não foi possível ler as contagens da fila de certificados'");
    expect(certQueue).toContain("logger.warn('não foi possível ler a amostra de duração dos certificados'");
    expect(emailQueue).toContain("logger.warn('não foi possível ler as contagens da fila de e-mails'");
    expect(emailQueue).not.toMatch(/\bcatch\s*\{/);
  });
});

