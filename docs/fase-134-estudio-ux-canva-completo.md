# FASE 134 — Estúdio de Certificados (Fase D: Miniaturas Reais, Barra de Identidade no Topo, Edição Direta de Texto e Tabela Recolhível)

## 1. Sumário executivo

Fecha os atritos de UX identificados em uso real do Estúdio de Certificados: corrige o recorte das miniaturas SVG na galeria, promove nome/público/escopo e salvamento para o topo do editor, habilita personalização em 1 clique do texto de campos dinâmicos com chips de variáveis, ajusta o palco à largura da tela sem scroll horizontal e recolhe a tabela técnica de coordenadas para usuários comuns.

| Entrega | Onde |
|---|---|
| Miniaturas SVG dos 5 presets escaladas integralmente (`[&_svg]:block [&_svg]:size-full`) + botão `Criar a partir deste modelo` com âncora `#editor` | `src/components/admin/certificate-templates-screen.tsx` |
| Barra de Identidade e Salvamento no topo (`Rascunho não salvo` / `Modelo salvo`, Nome, `Para quem é este certificado?`, Escopo, Formato e CTA primário) | `src/components/admin/certificate-template-editor.tsx` |
| Edição direta de texto: seletor de tipo no inspetor, botão `Personalizar este texto` (`convertVariableElementToEditable`), chips `+ Nome / + Evento / + Carga horária...` e duplo clique no palco | `certificate-studio-rules.ts` · `element-inspector.tsx` · `template-stage.tsx` |
| Palco no modo `Ajustar` (`zoom='fit'`, sem scroll horizontal) com `role="group"` + `aria-roledescription` preservando 0 violações WCAG 2.2 AA | `template-stage.tsx` · `template-workbench.tsx` |
| Planilha `Elementos da página` recolhida em `<details>` no modo interativo e sempre aberta sem JS | `elements-fieldset.tsx` |

Números: **4** Vitest unitários/SSR; sem migração de banco.

## 2. O problema mais difícil

Tornar editáveis os textos vindos dos 5 presets (que nascem como `VARIABLE` com hash SHA-256 fixado em `f86-corpo-do-certificado.test.ts`) e encaixar a folha A4 inteira sem barra de rolagem horizontal sem regredir o portão WCAG 2.2 AA (`accessibility.spec.ts`) nem o fluxo No-JS (`certificate-template.spec.ts`).

## 3. Decisões e ADRs

- **ADR-525 — Conversão em 1 clique de variável automática para texto/corpo editável no inspetor.**
  `convertVariableElementToEditable` mantém os 5 presets intactos (preservando os hashes fixados), mas oferece no inspetor o botão `Personalizar este texto` que converte `VARIABLE:corpo` em `BODY` pré-preenchido com gabarito + chips clicáveis `STUDIO_BODY_VARIABLE_CHIPS` e demais variáveis em `TEXT` com o texto atual, preservando geometria e tipografia.
- **ADR-526 — Palco ajustado à tela (`zoom='fit'`), barra de identidade no topo e tabela técnica sob `<details>` progressivo.**
  O palco usa `zoom='fit'` por padrão (`w-full`, sem scroll horizontal) e `role="group"` + `aria-roledescription="elemento do certificado"` com `tabIndex={0}` (semântica WAI-ARIA adequada para objetos posicionáveis 2D por teclado, mantendo 0 violações WCAG 2.2 AA). A barra de identidade/salvamento sobe para o topo do `<form>` e a planilha técnica fica recolhida em `<details>` quando `interactive === true`, permanecendo totalmente aberta sem JS.

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `f120-modularizacao-srp-client-components.test.ts` acusou `267 > 260` linhas em `certificate-template-editor.tsx` | A nova barra de identidade no topo elevou o arquivo orquestrador 7 linhas acima do teto da FASE 120 | Extraído o componente coeso `TemplateIdentityBar` em `src/components/admin/certificate-template/template-identity-bar.tsx`, reduzindo o orquestrador para ~218 linhas |

## 5. Evidência de verificação

- `npm run lint` — **0 erros, 0 warnings**
- `npx tsc --noEmit --noUnusedLocals` — **0 erros**
- `npm test` — **5055 testes (321 arquivos)** verdes (5054/5055 na rodada completa + `f120`, `f134` e `design-system-guard` revalidados **16/16** após extrair `TemplateIdentityBar`)
- `docker compose --profile app up -d --build web` — `next build` concluído no container e `eventflow-web` recriado e `healthy`
- `npm run db:verify` — **Contrato íntegro.**
- `npm run db:verify:isolation` — **9/9 verificações passaram.**
- `npm run db:partitions` — partições mensais em dia (`todas as partições do intervalo já existiam`)
- `npx playwright test` (`accessibility.spec.ts:2694`, `accessibility.spec.ts:2731`, `certificate-template.spec.ts` ×6, `f131-estudio-certificados-canva.spec.ts` ×1) — **9/9 passando** contra o container `eventflow-web` atualizado (0 violações WCAG 2.2 AA com palco no modo `Ajustar` sem scroll horizontal)
- `AGENTS.md` — **63.268 bytes** (abaixo do teto de `64.800` bytes; FASE 116 movida para `docs/fases-historico.md`)

## 6. Comandos

```bash
npx vitest run tests/unit/f134-estudio-ux-canva-completo.test.ts
```

## 7. Checklist de aceite

- [x] Miniaturas SVG dos 5 presets visíveis por completo na galeria
- [x] Barra de identidade e salvamento no topo com badge de rascunho/salvo e público-alvo
- [x] Edição direta de texto (`Personalizar este texto`, chips de variáveis, duplo clique no palco)
- [x] Palco em modo `Ajustar` sem scroll horizontal e 0 violações WCAG 2.2 AA
- [x] Tabela `Elementos da página` recolhida por padrão (e aberta sem JS)
