/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACA ESTRUTURAL AST — FASE 118 (Código morto e superfície de Server Actions)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA CATRACA EXISTE (ADR-475 · ADR-476)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. Toda função `export async function` em `src/app/actions/*.ts` (`'use server'`)
 *     vira um endpoint HTTP POST no build do Next.js. Uma Server Action sem nenhum
 *     consumidor em `src/` é superfície exposta sem dono.
 *  2. Um componente `.tsx` em `src/components/` sem nenhum importador em `src/`
 *     engorda a base e carrega código morto (como o antigo `badge-checkin-form.tsx`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walkTs(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full.replace(/\\/g, '/'));
    }
  }
  return out;
}

function resolveImportPath(importer: string, specifier: string, knownFiles: Set<string>): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = path.join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.join(path.dirname(importer), specifier);
  } else {
    return null;
  }

  const normalized = base.replace(/\\/g, '/');
  for (const candidate of [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
  ]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

describe('FASE 118 — Catraca de superfície de Server Actions e componentes órfãos', () => {
  const allSrcFiles = walkTs(SRC_ROOT);
  const knownFiles = new Set(allSrcFiles);
  const importedFiles = new Set<string>();
  const importedSymbolsByTarget = new Map<string, Set<string>>();

  for (const file of allSrcFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const record = (target: string, symbol: string) => {
      importedFiles.add(target);
      let set = importedSymbolsByTarget.get(target);
      if (!set) {
        set = new Set<string>();
        importedSymbolsByTarget.set(target, set);
      }
      set.add(symbol);
    };

    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const target = resolveImportPath(file, stmt.moduleSpecifier.text, knownFiles);
        if (!target) continue;
        const clause = stmt.importClause;
        if (!clause) {
          record(target, '*');
          continue;
        }
        if (clause.name) record(target, 'default');
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            record(target, '*');
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              record(target, el.propertyName ? el.propertyName.text : el.name.text);
            }
          }
        }
      } else if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const target = resolveImportPath(file, stmt.moduleSpecifier.text, knownFiles);
        if (!target) continue;
        if (!stmt.exportClause) {
          record(target, '*');
        } else if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            record(target, el.propertyName ? el.propertyName.text : el.name.text);
          }
        }
      }
    }
  }

  it('toda Server Action exportada em src/app/actions/*.ts possui ao menos um consumidor em src/', () => {
    const actionFiles = allSrcFiles.filter((f) => f.includes('/src/app/actions/') && f.endsWith('.ts'));
    expect(actionFiles.length).toBeGreaterThanOrEqual(30);

    const orphanActions: string[] = [];

    for (const file of actionFiles) {
      const source = fs.readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const consumed = importedSymbolsByTarget.get(file) ?? new Set<string>();

      for (const stmt of sf.statements) {
        const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported) continue;

        if (ts.isFunctionDeclaration(stmt) && stmt.name) {
          const name = stmt.name.text;
          if (!consumed.has(name) && !consumed.has('*')) {
            orphanActions.push(`${path.relative(ROOT, file).replace(/\\/g, '/')} → ${name}`);
          }
        }
      }
    }

    expect(
      orphanActions,
      `Server Actions exportadas sem nenhum consumidor em src/:\n${orphanActions.join('\n')}`,
    ).toEqual([]);
  });

  it('todo componente .tsx em src/components/ é importado em src/ (zero componentes órfãos)', () => {
    const componentFiles = allSrcFiles.filter(
      (f) => f.includes('/src/components/') && f.endsWith('.tsx'),
    );
    expect(componentFiles.length).toBeGreaterThanOrEqual(100);

    const orphans = componentFiles
      .filter((file) => !importedFiles.has(file))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));

    expect(
      orphans,
      `Arquivos de componente nunca importados em src/:\n${orphans.join('\n')}`,
    ).toEqual([]);
  });

  it('o componente legado BadgeCheckinForm permanece removido', () => {
    const legacyPath = path.join(SRC_ROOT, 'components/gamification/badge-checkin-form.tsx');
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});
