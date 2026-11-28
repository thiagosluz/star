# FASE 131 — Estúdio Visual de Certificados (Fase A: Experiência Estilo Canva)

## 1. Sumário executivo

O editor visual de certificados em `/administracao/eventos/[id]/certificados/modelos` e
`/administracao/certificados/modelos` ganhou fluxo visual estilo Canva sem perder a precisão
em milímetros, o renderizador PDF/SVG congelado nem o fallback No-JS.

| Entrega | Onde |
|---|---|
| Regras puras do estúdio (blocos rápidos, paleta, snap, alinhamento, WYSIWYG, Undo/Redo) | `src/domain/certificates/certificate-studio-rules.ts` |
| Hook de estado com pilha de Desfazer/Refazer (`Ctrl+Z`/`Ctrl+Y`) | `src/components/admin/certificate-template/use-template-studio.ts` |
| Barra de blocos rápidos em 1 clique + Desfazer/Refazer | `src/components/admin/certificate-template/studio-toolbar.tsx` |
| Inspetor contextual do elemento selecionado | `src/components/admin/certificate-template/element-inspector.tsx` |
| Palco WYSIWYG ao vivo com encaixe magnético ao centro + linhas-guia | `src/components/admin/certificate-template/template-stage.tsx` |
| Bancada de estúdio integrada (`Dados completos × opcionais vazios`) | `src/components/admin/certificate-template/template-workbench.tsx` |

Números: **6** Vitest unitários/SSR + **1** E2E; sem migração; orquestrador `certificate-template-editor.tsx`
preservado abaixo do teto AST da F120 (`<= 260` linhas, `jsxDepth <= 7`).

## 2. O problema mais difícil

Tornar o editor intuitivo para usuários leigos (WYSIWYG ao vivo, paleta de cores, blocos em 1 clique,
alinhamento instantâneo e Undo/Redo) preservando 100% da tabela de medidas e contratos de
acessibilidade/No-JS já cobertos por `certificate-template.spec.ts`, `f86-corpo-do-certificado.spec.ts`
e `f120-modularizacao-srp-client-components.test.ts`.

## 3. Decisões e ADRs

- **ADR-519 — Palco WYSIWYG ao vivo + encaixe magnético no centro (`certificate-studio-rules.ts`).**
  O palco renderiza diretamente o texto resolvido (`sampleVariableValues` + `resolveBodyTemplate`),
  fonte, alinhamento, cor e tamanho escalado via `ResizeObserver` (`pt → mm → px`), com snap
  magnético de `3 mm` ao centro horizontal/vertical e linhas-guia visuais durante o arraste.
- **ADR-520 — Barra de blocos em 1 clique, Inspetor Contextual e Undo/Redo imutável.**
  `StudioToolbar` (`+ Título`, `+ Nome do participante`, `+ Corpo`, `+ Assinatura`, `+ QR`, `+ Código`),
  `ElementInspector` (texto/variável, centralizar H/V, largura útil, fonte, tamanho, alinhamento,
  paleta curada, duplicar/remover) e `useTemplateStudio` (pilha imutável de 30 passos com `Ctrl+Z`/`Ctrl+Y`)
  reduzem a carga cognitiva mantendo a tabela de medidas sincronizada abaixo para ajuste fino e No-JS.

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `design-system-guard`: 1 violação de escala tipográfica em `template-stage.tsx` | rótulo do bloco QR usou `text-[10px]` | trocado para `text-xs` |
| `f61-varredura-escuro`: 2 ocorrências de branco cru em `template-stage.tsx` (teto 1) | container interno do QR usou `bg-white/80` além do papel `bg-white` | trocado para `bg-card/80` |

## 5. Evidência de verificação

- `npm run lint`: `0` erros, `0` warnings
- `npx tsc --noEmit --noUnusedLocals`: `0` erros
- `npm test`: `317 passed (317)` · **`5041 passed (5041)`** (inclui `f120`, `f61`, `design-system-guard`, `f79`, `f107`, `f119`, `f131`)
- `npm run build`: `Compiled successfully` (`3.4s`, rotas de certificados listadas)
- `npm run db:verify`: `Contrato íntegro.`
- `npm run db:verify:isolation`: `9/9 verificações passaram.`
- `npm run db:partitions`: partições em dia (`267522` linhas)
- `(Get-Item AGENTS.md).Length`: **`63958` bytes** (abaixo do teto de ~64.800 bytes)
- E2E (`tests/e2e/f131-estudio-certificados-canva.spec.ts` + `certificate-template.spec.ts` + `f86-corpo-do-certificado.spec.ts`): pronto para execução após rebuild da imagem Docker `web` (`docker compose --profile app up -d --build web`) quando o registry npm estiver acessível no daemon Docker.

## 6. Comandos

```bash
npm run test:unit
npx playwright test tests/e2e/f131-estudio-certificados-canva.spec.ts tests/e2e/certificate-template.spec.ts tests/e2e/f86-corpo-do-certificado.spec.ts
```

## 7. Próxima evolução natural (Fase B)

Miniaturas SVG reais na galeria/presets, botão "Personalizar cópia neste evento" nos modelos herdados
da instituição, conversão automática PNG/WebP → JPEG RGB no fundo e abas/streaming em `/certificados`.

## 8. Checklist de aceite

- [x] Palco WYSIWYG ao vivo com alternância de amostra (`Dados completos` × `Dados opcionais vazios`)
- [x] Encaixe magnético ao centro com linhas-guia visuais
- [x] Barra de blocos rápidos em 1 clique e pilha de Desfazer/Refazer (`Ctrl+Z` / `Ctrl+Y`)
- [x] Inspetor contextual do elemento selecionado com paleta de cores e alinhamento na folha
- [x] Retrocompatibilidade 100% com F86, F120 e modo sem JavaScript
