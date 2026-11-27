# FASE 130 — Operação de Banco, Cache & Storage (`B5`, `B8`, `C6`) e DX Vitest

## 1. Sumário executivo

Esta fase quita **3 dívidas técnicas de produção** (`39 → 36`, zerando os temas **B** e **C**)
e separa os projetos Vitest para destravar feedback rápido nos unitários sem abrir mão do
isolamento sequencial na integração.

| Entrega | Dívida / Objetivo | Onde |
|---|---|---|
| Vitest Projects (`unit` paralelo × `integration` sequencial) | DX & Velocidade | `vitest.config.ts` · `package.json` |
| Migração de `unstable_cache` → Redis versionado | Quita **B5** | `src/lib/platform/directory-service.ts` |
| Política de retenção fail-closed para `audit_logs` + CLI | Quita **B8** | `partition-retention-rules.ts` · `partition-service.ts` · `prisma/scripts/prune-audit-partitions.ts` |
| Reconciliação Banco × MinIO com carência de 24h + CLI | Quita **C6** | `storage-reconciliation-rules.ts` · `storage-reconciliation-service.ts` · `prisma/scripts/reconcile-storage.ts` |

Números: **5** Vitest unitários/catraca + **2** integração real (Postgres + MinIO); sem migração.

## 2. O problema mais difícil

Operações destrutivas de manutenção (`DROP TABLE` de partições e `DeleteObject` no MinIO) não
podem depender de memória humana nem apagar dados em uso. Por isso ambas seguem **fail-closed**:
dry-run por padrão, piso mínimo de retenção (`6` meses), janela de carência (`24h`) para uploads
pré-assinados em andamento e exclusão real apenas com `--confirmar`.

## 3. Decisões e ADRs

- **ADR-516 — Vitest Projects (`unit` paralelo × `integration` sequencial).** `fileParallelism: false`
  global penalizava todos os 202 arquivos unitários puros. Com `projects` nativo do Vitest 5,
  `npm run test:unit` roda em paralelo em segundos, `npm run test:integration` permanece sequencial
  contra o banco real e `npm test` executa ambos como gate completo.
- **ADR-517 — Eliminação definitiva de `unstable_cache` (quita B5).** O último uso em
  `directory-service.ts` migrou para `getOrSetVersionedPublicCache` (`public-directory:global`),
  compartilhando invalidação O(1) via Redis entre réplicas com fallback aberto ao Postgres e
  catraca unitária travando qualquer retorno de `unstable_cache`.
- **ADR-518 — Retenção de auditoria (`B8`) e reconciliação de storage (`C6`) com dry-run padrão.**
  Regras puras em `partition-retention-rules.ts` e `storage-reconciliation-rules.ts`, serviços de
  plataforma sob `src/lib/platform/**` (`adminPrisma`, invariante nº 1) e CLIs
  `npm run db:partitions:prune` e `npm run storage:reconcile` exigindo `--confirmar`.

## 4. Lições aprendidas

Nenhuma regressão nas catracas (`f75`, `f79`, `f107`, `f117`, `f119`); mover a reconciliação de
storage para `src/lib/platform/` manteve a invariante nº 1 (`adminPrisma` restrito a plataforma/CLI).

## 5. Evidência de verificação

- `npm run lint`: `0` erros, `0` warnings
- `npx tsc --noEmit --noUnusedLocals`: `0` erros
- `npm run test:unit`: `202 passed (202)` · `3634 passed (3634)` (~22s em paralelo)
- `npm test`: `316 passed (316)` · **`5035 passed (5035)`** (`220.91s`)
- `npm run db:partitions:prune -- --months=12`: simulação (dry-run) OK (exit 0)
- `npm run storage:reconcile`: auditoria Banco × MinIO (dry-run) OK (exit 0)
- `npm run build`: `Compiled successfully` (`4.2s`)
- `npm run db:verify`: `Contrato íntegro.`
- `npm run db:verify:isolation`: `9/9 verificações passaram.`
- `npm run db:partitions`: partições em dia
- `(Get-Item AGENTS.md).Length`: **`64032` bytes** (abaixo do teto de ~64.800 bytes)

## 6. Comandos operacionais

```bash
npm run test:unit                                      # unitários puros em paralelo
npm run test:integration                               # integração sequencial (Postgres/Redis/MinIO)
npm run db:partitions:prune -- --months=12             # simulação de retenção (dry-run)
npm run db:partitions:prune -- --months=12 --confirmar # aplica DROP TABLE das partições elegíveis
npm run storage:reconcile                              # auditoria Banco × MinIO (dry-run)
npm run storage:reconcile -- --confirmar               # remove órfãos fora da carência de 24h
```

## 7. Dívidas e pontos de atenção

- **Quitadas:** `B5`, `B8` e `C6` (**39 → 36 dívidas abertas**; temas **B** e **C** zerados).
- O agendamento automático de `pruneAuditPartitions` e `reconcilePlatformStorage` no worker pode
  ser ligado quando o ambiente de produção definir `AUDIT_RETENTION_MONTHS`.

## 8. Checklist de aceite

- [x] `test:unit` paralelo e `test:integration` sequencial no Vitest, mantendo `npm test` completo
- [x] Zero `unstable_cache` em `src/` (catraca ativa)
- [x] Política de retenção de partições com piso seguro, dry-run padrão e CLI
- [x] Reconciliação Banco × MinIO com janela de carência de 24h, dry-run padrão e CLI
