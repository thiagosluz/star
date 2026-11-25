# FASE 127 — Cockpit do Palestrante por Intenção, Ergonomia de Materiais & Agenda e Otimização SSR

## 1. Sumário Executivo

A página `/t/[tenantSlug]/palestrante` empilhava na mesma rolagem vertical todos os formulários da jornada do palestrante (aceite de convite, perfil público com 12 campos, ementas recolhíveis, múltiplos uploaders de material/link e emissão de certificado), sem faixa de KPIs executivos, sem separação por intenção e com uma segunda transação `withTenant` desnecessária no SSR além de overfetching de `materials` dentro de cada `activityLink`.

A FASE 127 entrega o **Cockpit do Palestrante por Intenção**, reduzindo a carga cognitiva com uma faixa executiva fixa no topo, abas SSR por URL (`?aba=visao-geral|atividades|perfil|certificados`), cabeçalhos de atividade com agenda/sala/link público, limpeza automática de link externo após publicação e leitura em transação única sem payload duplicado.

### Tabela de Entregas

| Camada | Arquivo | Entregável |
|---|---|---|
| Domínio | [`src/domain/speakers/speaker-portal-rules.ts`](../src/domain/speakers/speaker-portal-rules.ts) | Abas por intenção (`SPEAKER_PORTAL_TABS`, `resolveSpeakerPortalTab`, `buildSpeakerPortalHref`) e projeção `computeSpeakerPortalKpis` (completude do perfil, carga horária, materiais por visibilidade e certificação) |
| Aplicação | [`src/lib/speakers/speaker-portal-service.ts`](../src/lib/speakers/speaker-portal-service.ts) | Seleção única de `materials` no nível de `speakerProfile` (eliminando $O(K \times M)$), enriquecimento de `PortalActivity` (`activitySlug`, `eventTimezone`, `modality`, `roomName`, `onlineUrl`) e resolução de `fallbackEventId` na mesma transação `withTenant` |
| Interface SSR & UX | [`src/components/speakers/speaker-portal-kpi-cards.tsx`](../src/components/speakers/speaker-portal-kpi-cards.tsx) · [`src/components/speakers/portal-forms.tsx`](../src/components/speakers/portal-forms.tsx) · [`src/app/t/[tenantSlug]/(app)/palestrante/page.tsx`](../src/app/t/[tenantSlug]/(app)/palestrante/page.tsx) | 4 KPIs executivos, navegação em abas `?aba=`, cabeçalho enriquecido por atividade, estado visual de alteração de visibilidade em `SpeakerMaterialRow` e reset automático de `url`/`title`/`description` após publicação de link externo |
| Testes | [`tests/unit/f127-cockpit-do-palestrante.test.ts`](../tests/unit/f127-cockpit-do-palestrante.test.ts) · [`tests/e2e/f127-cockpit-do-palestrante.spec.ts`](../tests/e2e/f127-cockpit-do-palestrante.spec.ts) | 4 testes unitários/SSR + 1 cenário E2E completo contra o container |

### Números da Fase
- **Arquivos criados:** 3 (`speaker-portal-rules.ts`, `speaker-portal-kpi-cards.tsx`, `f127-cockpit-do-palestrante.test.ts`, `f127-cockpit-do-palestrante.spec.ts` — 4 novos + este doc).
- **Testes adicionados:** **4** testes Vitest unitários/SSR + **1** teste Playwright E2E.
- **Migrações:** 0.

---

## 2. O Problema Mais Difícil da Fase

Equilibrar a separação por abas de intenção (`?aba=atividades`, `?aba=perfil`, `?aba=certificados`) com a jornada contínua testada em [`tests/e2e/speaker-portal.spec.ts`](../tests/e2e/speaker-portal.spec.ts), na qual o palestrante cai em `/t/[slug]/palestrante` (sem query string) logo após aceitar o convite e preenche perfil + envia slide na mesma navegação, e posteriormente emite o certificado na URL raiz.

---

## 3. Decisões Técnicas (ADRs)

### ADR-508 — Aba Raiz `'visao-geral'` Preservando a Jornada Contínua e Abas `?aba=` para Foco Operacional
- **Contexto:** Esconder o formulário de perfil ou de certificado na URL raiz `/palestrante` quebraria o fluxo histórico de quem acabou de aceitar o convite e quer completar tudo de uma vez (E19/E21).
- **Decisão:** Adotar `?aba=visao-geral` como padrão quando `aba` está ausente na URL, mantendo as três áreas acessíveis no primeiro acesso, e oferecer abas reais SSR (`?aba=atividades`, `?aba=perfil`, `?aba=certificados`) para foco imediato sem ruído visual.
- **Alternativa descartada:** Definir `?aba=atividades` como padrão e ocultar `SpeakerProfileForm` da rota raiz.
- **Consequência:** Zero regressão na jornada de onboarding e redução drástica de carga cognitiva quando o palestrante volta para subir slides ou conferir seu certificado.

### ADR-509 — Consolidação de `fallbackEventId` e `materials` na Transação Única de `loadSpeakerPortal`
- **Contexto:** `SpeakerPortalPage` abria uma segunda transação `withTenant` para buscar `tx.event.findFirst` em todo carregamento mesmo quando o palestrante já tinha atividades vinculadas, e `loadSpeakerPortal` selecionava `speakerProfile.materials` repetidamente dentro de cada `activityLink`.
- **Decisão:** Mover `materials` para o `select` raiz de `speakerProfile` e resolver `fallbackEventId` dentro do `Promise.all` da única transação `withTenant` (apenas quando nenhuma atividade existir).
- **Consequência:** Uma única transação `withTenant` por renderização e payload linear de materiais.

### ADR-510 — Limpeza Automática de Link Externo e Indicação de Alteração Pendente por Material
- **Contexto:** `SpeakerMaterialUploader` mantinha o endereço antigo digitado no campo `url` após o sucesso de `saveLinkAction`, induzindo reenvio duplicado; e `SpeakerMaterialRow` não diferenciava alteração pendente de estado salvo.
- **Decisão:** Sincronizar `lastSyncedLinkState` no render para limpar `url`, `title` e `description` após `{ ok: true }`, e controlar `selectedVisibility` em `SpeakerMaterialRow` para destacar o botão `"Aplicar"` (`variant="primary"`) quando houver mudança não salva.
- **Consequência:** Feedback visual imediato sem depender de `useEffect` pós-commit.

---

## 4. Evidência de Verificação

> Preenchida com os números reais da execução da FASE 127.

- `npm run lint` → 0 erros, 0 warnings
- `npx tsc --noEmit --noUnusedLocals` → 0 erros
- `npm test` → **5015** testes passando (**311** arquivos)
- `npm run build` → Compiled successfully (`19/19` estáticas + dinâmicas listadas)
- `npm run db:verify` · `npm run db:verify:isolation` (`9/9`) · `npm run db:partitions` (`260044` linhas) → íntegros
- `docker compose --profile app up -d --build web` → container atualizado (`eventflow/web:local` `8eb19b00d0e0`)
- `npm run test:e2e` → **571 passed, 1 skipped** (`10.7m`)

---

## 5. Checklist de Aceite

- [x] Faixa executiva de 4 KPIs (`Perfil na vitrine`, `Atividades & carga`, `Materiais publicados`, `Certificação`)
- [x] Abas reais por URL (`?aba=visao-geral|atividades|perfil|certificados`) preservando a URL padrão para `speaker-portal.spec.ts`
- [x] Transação única `withTenant` no portal e remoção da duplicação de `materials` em `activityLinks`
- [x] Agenda, sala e atalho `"Ver página da atividade"` no cabeçalho de cada atividade
- [x] Reset automático do formulário de link externo após sucesso e destaque de alteração de visibilidade
