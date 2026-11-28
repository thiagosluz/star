# FASE 133 — Estúdio de Certificados (Fase C: Zoom, Grade Magnética 5 mm, Prévia PDF Real e Tipografia/Assinaturas)

## 1. Sumário executivo

Entrega os recursos avançados de edição do Estúdio de Certificados, permitindo ajustar a escala do palco, ativar encaixe em grade de 5 mm, testar o PDF real diretamente do rascunho antes de salvar e formatar tipografia/assinaturas com feedback visual imediato.

| Entrega | Onde |
|---|---|
| Domínio de zoom (`75%`/`100%`/`125%`), grade magnética (`5mm` com prioridade ao centro), contraste WCAG AA no palco e gerador de bloco de assinatura | `src/domain/certificates/certificate-studio-rules.ts` |
| Rota `POST /api/t/[tenantSlug]/certificados/previa-pdf` gerando PDF real pelo mesmo `renderCertificateLayoutPdf` da emissão | `src/app/api/t/[tenantSlug]/certificados/previa-pdf/route.ts` |
| Controles de zoom, toggle `Grade 5 mm` (com overlay SVG sem hex cru) e botão `Abrir PDF real` na bancada do estúdio | `template-stage.tsx` · `template-workbench.tsx` · `certificate-template-editor.tsx` |
| Prévia visual da fonte selecionada + atalho `Inserir modelo de assinatura` no inspetor | `element-inspector.tsx` |

Números: **6** Vitest unitários/API; sem migração de banco.

## 2. O problema mais difícil

Conciliar o encaixe em grade de `5mm` com o encaixe magnético ao centro da folha A4 (`297mm` → centro de uma caixa de `100mm` fica em `98,5mm`, que não é múltiplo de `5`) e garantir que a prévia em PDF real reflita o rascunho atual do estúdio sem gravar no banco nem confiar em URLs externas de fundo vindas do cliente.

## 3. Decisões e ADRs

- **ADR-523 — Zoom do palco (`75%`/`100%`/`125%`), grade magnética de `5mm` com prioridade ao centro e bloco de assinatura no domínio puro.**
  `resolveStageWidthPx` ancora `100%` em `1200px` (preservando `>= 24px` WCAG 2.2 AA `target-size` em todos os campos); `snapElementPosition` aceita `gridStepMm` opcional mas sempre dá precedência ao encaixe central (`snapCenterX`/`snapCenterY`) quando dentro da tolerância de `3mm`; `buildSignatureBlockText` padroniza linha + nome + cargo sem exigir tabela adicional.
- **ADR-524 — Prévia ao vivo em PDF real via `POST /api/t/[tenantSlug]/certificados/previa-pdf`.**
  Usa `POST` (não `GET`) para aceitar o rascunho ainda não salvo no banco, exige `guardAction` com `PERMISSIONS.CERTIFICATE_ISSUE`, valida o layout com `validateLayout`, lê a arte de fundo exclusivamente do `templateId` autorizado do tenant via `getCertificateTemplate` + `readTemplateBackground`, e renderiza pelo mesmo `renderCertificateLayoutPdf` da emissão real (`Cache-Control: no-store`).

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `design-system-guard.test.ts` acusou 1 cor literal em `previa-pdf/route.ts` | A catraca varre `src/app/**` e pegou o fallback `'#111827'` passado para `buildLayoutFromRows` | Removido o fallback literal (`asString(item.color)`), delegando o padrão ao domínio |
| `TS2322` em `template-workbench.tsx` (`variant="default"`) | O componente `Button` do design system usa `primary` em vez de `default` | Ajustado para `variant={snapGrid ? 'primary' : 'outline'}` |

## 5. Evidência de verificação

- `npm run lint` — **0 erros, 0 warnings**
- `npx tsc --noEmit --noUnusedLocals` — **0 erros**
- `npm test` — **5051 testes (320 arquivos)** verdes (5050/5051 na rodada completa + `design-system-guard` e `f133` revalidados 11/11 após remover a cor literal da rota)
- `docker compose --profile app up -d --build web` — `next build` concluído no container em **65.3s** com a nova rota `/api/t/[tenantSlug]/certificados/previa-pdf` listada e container `eventflow-web` recriado e `healthy`
- `npm run db:verify` — **Contrato íntegro.**
- `npm run db:verify:isolation` — **9/9 verificações passaram.**
- `npm run db:partitions` — partições mensais em dia (`todas as partições do intervalo já existiam`)
- `npx playwright test` (`accessibility.spec.ts:2694`, `accessibility.spec.ts:2730`, `certificate-template.spec.ts`, `f131-estudio-certificados-canva.spec.ts`) — **9/9 passando em 42.8s** contra o container `eventflow-web` atualizado
- `AGENTS.md` — **63.419 bytes** (abaixo do teto de `64.800` bytes; FASE 115 movida para `docs/fases-historico.md`)

## 6. Comandos

```bash
npx vitest run tests/unit/f133-estudio-zoom-grade-pdf-assinatura.test.ts
```

## 7. Checklist de aceite

- [x] Seletor de zoom (`75%`, `100%`, `125%`) e overlay visual + snap de grade `5mm`
- [x] Botão `Abrir PDF real` conectado a `POST /api/t/[slug]/certificados/previa-pdf`
- [x] Prévia visual de tipografia + atalho de assinatura formatada no inspetor
- [x] Zero regressão nas catracas (`design-system-guard`, `f61`, `f75`, `f79`, `f119`, `f120`, WCAG 2.2 AA)
