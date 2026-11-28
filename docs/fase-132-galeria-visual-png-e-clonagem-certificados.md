# FASE 132 — Estúdio de Certificados (Fase B: Galeria Visual SVG, PNG/WebP→JPEG Automático, Clonagem Herdada e Streaming)

## 1. Sumário executivo

Fecha a transformação da experiência de certificação iniciada na FASE 131, eliminando os
principais atritos entre as três rotas (`/eventos/[id]/certificados`, `/eventos/[id]/certificados/modelos`
e `/administracao/certificados/modelos`).

| Entrega | Onde |
|---|---|
| Conversão automática PNG/WebP → JPEG RGB baseline (`sharp`) preservando JPEG intocado | `src/lib/certificates/certificate-template-service.ts` · `background-asset-panel.tsx` |
| Miniaturas SVG reais nos 5 presets da galeria | `src/components/admin/certificate-templates-screen.tsx` |
| Botão 1-clique **"Personalizar cópia neste evento"** nos modelos herdados da instituição | `cloneInstitutionalTemplateToEvent` · `cloneInstitutionalTemplateFormAction` · `certificate-templates-screen.tsx` |
| Trilha visual em 3 etapas + streaming `<Suspense>` da simulação/fila em `/certificados` | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/certificados/page.tsx` |

Números: **3** Vitest unitários/SSR + **1** integração real (Postgres/RLS); sem migração.

## 2. O problema mais difícil

Quem cria artes no Canva exporta em **PNG** por padrão, mas o renderizador PDF embute JPEG RGB
baseline; além disso, testes existentes (`certificate-template.spec.ts`) exigem que JPEG CMYK
continue sendo recusado e que JPEG RGB preserve o checksum e tamanho exatos. Detectar PNG e WebP
pelos magic bytes e converter somente esses formatos resolve o atrito sem quebrar o contrato.

## 3. Decisões e ADRs

- **ADR-521 — Conversão automática PNG/WebP → JPEG RGB baseline para arte de certificado.**
  `normalizeCertificateBackgroundBytes` (`certificate-template-service.ts`) detecta PNG (`89 50 4E 47`)
  e WebP (`RIFF....WEBP`), achata transparência sobre branco (`#FFFFFF`), aplica rotação EXIF e
  converte em sRGB JPEG baseline (`quality: 92`, `progressive: false`). Bytes que já são JPEG
  seguem intocados para manter a recusa explícita de CMYK/progressivo e a integridade do checksum.
- **ADR-522 — Galeria visual com miniaturas SVG, clonagem herdada em 1 clique e streaming em `/certificados`.**
  Os 5 presets exibem miniaturas SVG geradas no servidor pelo mesmo `renderCertificateLayoutSvg`;
  modelos herdados da instituição ganham `cloneInstitutionalTemplateFormAction` (cria cópia própria
  no evento, inclusive duplicando a arte de fundo se existir, e abre direto no estúdio); e
  `/eventos/[id]/certificados` apresenta a jornada em 3 passos com `<Suspense>` isolando
  `previewEventCertificates` + Redis (`certificateQueueStats`).

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `TS2322` em `certificate-template-service.ts:924` no `next build` | `CertificateTemplateRecord.kind` é `string \| null`, enquanto `prisma.certificateTemplate.create` exige o enum `CertificateKind \| null` | Cast explícito `source.kind as CertificateKind \| null` (já importado do domínio e validado na leitura) |

Nenhuma regressão nas catracas (`f61`, `f75`, `f79`, `f107`, `f119`, `f120`, `design-system-guard`).

## 5. Evidência de verificação

- `npm run lint` — **0 erros, 0 warnings**
- `npx tsc --noEmit --noUnusedLocals` — **0 erros**
- `npm test` — **5045 testes** (**319 arquivos**): 318 arquivos (5044/5045) na rodada completa + reexecução imediata do flake pré-existente `tests/integration/credential-service.test.ts` (**30/30 passando em 2.58s**), incluindo os 2 novos arquivos da FASE 132 (`f132-galeria-visual-e-clonagem-certificados.test.ts` e `f132-certificate-template-clone.test.ts`)
- `npm run build` — **Compiled successfully in 4.3s**, TypeScript em **6.6s**, `18/18` páginas estáticas geradas
- `npm run db:verify` — **Contrato íntegro.**
- `npm run db:verify:isolation` — **9/9 verificações passaram.**
- `npm run db:partitions` — partições mensais em dia (`todas as partições do intervalo já existiam`)
- `AGENTS.md` — **63.674 bytes** (abaixo do teto de `64.800` bytes; FASE 114 movida para `docs/fases-historico.md`)
- *Nota de ambiente (E2E/Docker):* o rebuild da imagem `eventflow/web` continua sujeito à lentidão externa do `npm ci` dentro do Docker Desktop observada desde a F130; o bundle de produção foi validado integralmente via `npm run build` local e pode ser reconstruído no container quando o acesso ao registry do Docker normalizar.

## 6. Comandos

```bash
npm run test:unit
npx vitest run tests/integration/f132-certificate-template-clone.test.ts
```

## 7. Checklist de aceite

- [x] Miniaturas SVG reais nos 5 modelos prontos
- [x] Botão "Personalizar cópia neste evento" nos modelos herdados da instituição
- [x] Conversão automática PNG/WebP → JPEG RGB mantendo recusa de CMYK e checksum de JPEG
- [x] Jornada em 3 etapas + `<Suspense>` na simulação/fila de `/eventos/[id]/certificados`
