# FASE 11A — Identidade visual e padrão de interface

> **Leia junto com:** [`docs/design-system.md`](design-system.md) (o contrato do dia a
> dia), [`DESIGN.md`](../DESIGN.md) (os valores da marca) e `AGENTS.md`.

---

## 1. Sumário executivo

O sistema funcionava e parecia inacabado. Não era impressão: o `globals.css` ainda
tinha **os tokens cinza padrão do shadcn** (fundo branco puro, secundária cinza,
primária um roxo genérico), **nenhuma fonte era carregada** — o produto usava a fonte
do sistema operacional de quem abrisse a página — e **não existia nenhum primitivo de
UI**: cada uma das 27 telas escrevia as próprias classes, com 150 usos de cor crua do
Tailwind e três tons diferentes de cinza para "texto secundário".

Esta entrega instala a identidade do `DESIGN.md` e a transforma em padrão verificável.

### Entregas

| # | Entrega | Onde |
|---|---|---|
| 1 | Tokens canônicos (superfícies, marca, estados, raridade, elevação) | `src/app/globals.css` |
| 2 | Tipografia real: Plus Jakarta Sans (títulos) + Inter (corpo) | `src/app/layout.tsx` |
| 3 | 20 primitivos de UI em um ponto de entrada único | `src/components/ui/**` |
| 4 | Shell com barra lateral, navegação agrupada, gaveta no mobile e trilha | `src/components/shell/**` |
| 5 | Cabeçalho/rodapé públicos com a identidade da instituição | `(public)/layout.tsx` |
| 6 | Painel de plataforma no MESMO shell (variante plataforma) | `src/app/superadmin/layout.tsx` |
| 7 | Guia de estilo vivo, com a identidade renderizada pelo código | `/superadmin/design` |
| 8 | Telas-exemplo do padrão: painel administrativo, atividade pública, métricas e listagem de instituições | `administracao/page.tsx`, `superadmin/{metricas,tenants}` |
| 9 | Trava mecânica (catraca) + contrato escrito | `tests/unit/design-system-guard.test.ts`, `docs/design-system.md` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos criados | 12 (7 primitivos, 4 de shell/catálogo, 1 de teste) + 2 documentos |
| Arquivos alterados | 9 (tokens, layout raiz, 3 layouts, 3 telas, tema do evento) |
| Componente removido | `tenant-header.tsx` — substituído pelo shell (uma navegação, não duas) |
| Testes Vitest | 770 → **775** (a trava entram com 5 casos) |
| Testes E2E | 42 (nenhum quebrado; a navegação preserva os `data-testid`) |
| Migrações | nenhuma |
| ADRs | 63 → **67** |

---

## 2. O problema mais difícil da fase

**Mudar a aparência de 40 telas sem editar 40 telas — e sem que a mudança morra na
próxima fase.**

O caminho óbvio era abrir cada página e trocar as classes. Isso levaria dezenas de
edições, quebraria testes que dependem de rótulos e, pior, seria desfeito pela próxima
tela escrita com pressa — o problema não era a aparência, era a **ausência de um
vocabulário**.

A saída foi trocar o vocabulário, não as telas. As fases 1–10 já usavam nomes
semânticos (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`) em
**938 lugares**; o que faltava era esses nomes apontarem para uma identidade. Ao
repontar os tokens, todas as telas passaram a pertencer ao sistema de uma vez.

O segundo problema: **documentação não sobrevive sozinha**. Existe um teste que falha
quando alguém escreve `text-gray-500`, `#4F46E5` ou `text-[13px]` — e ele é uma
catraca: há uma lista explícita de dívida (arquivo → teto de ocorrências) que **só
pode encolher**. Arquivo novo não tem teto. Assim a próxima fase não pode piorar o
padrão por distração, e o restante da migração continua possível.

---

## 3. Decisões técnicas

### 3.1 O bloco YAML do DESIGN.md é a fonte da verdade

O documento traz duas camadas: o YAML estruturado (escala tonal completa, `#f9f9ff` de
canvas) e a prosa (valores de uso, `#F8FAFC` de canvas, bordas `#CBD5E1`). Escolhemos o
YAML porque é o artefato completo e coerente, e a prosa como **regra de uso** (que cor
para qual papel). O canvas `#F8FAFC` da prosa é o cinza-ardósia padrão do Tailwind —
usá-lo daria um sistema genérico, não uma assinatura.

### 3.2 Apelidos semânticos em três camadas

```
DESIGN.md (valores)  →  --ef-* (paleta crua)  →  --surface / --primary / --success (apelidos)
                                                  ↓
                                          utilidades do Tailwind (bg-card, text-muted-foreground…)
```

Componentes usam apelidos. A paleta crua existe em um lugar só, e o teste compara os
valores com o `DESIGN.md`: "ajustar a marca" exige atualizar o documento, senão a
suíte falha.

### 3.3 Sombra é hierarquia, não decoração

Quatro níveis (`surface` → `surface-low` → `card` + `shadow-card` → `shadow-modal`).
A regra que evita o visual "tudo flutuando": cartão dentro de cartão **não** recebe
sombra nova — resolve-se com um degrau de tonalidade (`elevated={false}`).

### 3.4 Cor de estado só com rótulo escrito

`Badge` exige `children` textual e oferece `withDot`: quem não distingue verde de
âmbar lê o estado. Pelo mesmo motivo o `Alert` tem ícone **e** texto.

### 3.5 Gradiente é exclusivo de conquista

Raridade usa gradiente (moldura de 1px com interior claro, o "metallic sheen" do
documento); status operacional usa par fundo/texto. Misturar os dois borraria a
fronteira entre "estado do sistema" e "mérito do participante" — que é o coração da
gamificação.

### 3.6 A navegação é um dado, filtrada no servidor

`buildTenantNav({ tenantSlug, principal })` devolve os grupos; o shell não conhece
RBAC. Cada item declara **a mesma permissão que a página exige** — menu e página
divergirem produz o link que só redireciona ou a tela inalcançável, defeito já visto
em fases anteriores.

---

## 4. ADRs

### ADR-064 — A identidade vem do `DESIGN.md`, e o teste verifica a igualdade

**Contexto.** Existiam duas descrições de cor no documento da marca e nenhuma no
código além do cinza padrão do shadcn.

**Decisão.** O bloco YAML é a fonte da verdade. Os valores vivem em `:root` no
`globals.css`, e `tests/unit/design-system-guard.test.ts` afirma os 14 valores
principais (`--ef-surface: #f9f9ff`, `--ef-primary-container: #4f46e5`, …).

**Justificativa.** Documento e código divergem em silêncio; teste não. Se a marca
mudar, muda-se o documento e o teste — nessa ordem, de propósito.

**Consequências.** Ajustar um token exige editar dois arquivos. É o atrito que impede
mudança de marca acidental em 40 telas.

### ADR-065 — Toda tela importa de `@/components/ui`; primitivo novo vai para o sistema

**Contexto.** Não havia primitivos: `Field` existia em duas implementações diferentes,
`<h2>` era estilizado em cada página e cinco arquivos definiam o próprio "cartão".

**Decisão.** 20 primitivos com um `index.ts` único. Se falta um componente, ele é
acrescentado ao diretório e exportado — nunca escrito solto na tela.

**Justificativa.** A alternativa (classes utilitárias repetidas) já tinha falhado: era
o estado anterior. Um caminho de importação único torna o padrão o caminho mais curto.

**Consequências.** PRs de UI passam a crescer no sistema, não na tela. Duas
implementações de `Field` foram mantidas nesta fase (a do painel admin) e estão
registradas como dívida da 11B.

### ADR-066 — A trava é uma catraca com dívida explícita, não um muro

**Contexto.** 150 usos de cor crua em 31 arquivos das fases 1–10.

**Decisão.** O teste tem duas listas (`RAW_COLOR_DEBT`, `ARBITRARY_TEXT_DEBT`) com
teto por arquivo. Falha se um arquivo **novo** introduzir violação, se um arquivo
**piorar** ou se a lista registrar **mais** do que o arquivo tem.

**Justificativa.** Permitir tudo não protege; proibir tudo de uma vez exigiria
reescrever 31 arquivos em uma entrega e travaria o desenvolvimento. A catraca protege
desde já e obriga a dívida a encolher quando alguém mexe no arquivo.

**Consequências.** Toda correção de arquivo legado precisa baixar o número. É trabalho
manual de propósito: a lista é o registro visível do que falta.

### ADR-067 — Um shell para instituição e plataforma; navegação agrupada por intenção

**Contexto.** A navegação era uma faixa horizontal com 11 destinos em ordem
cronológica de entrega, sem agrupamento, escondida em telas estreitas (metade dos
links fora da tela, sem indicação).

**Decisão.** `AppShell` único (variante `platform`), barra lateral fixa, quatro grupos
por intenção (Geral · Minha participação · Comitê científico · Operação), gaveta no
mobile e `AppShell` também na governança.

**Justificativa.** A pergunta de quem usa não é "o que veio primeiro", é "isto é meu,
é do comitê ou é da gestão?". E aprender a interface uma vez só vale para as duas
áreas.

**Consequências.** `tenant-header.tsx` foi removido (uma navegação, não duas). O
`data-testid="active-tenant"` foi preservado no bloco de contexto, mantendo os testes
da FASE 2 válidos.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O tema dos eventos referenciaba `var(--font-inter)`, mas a fonte não existia | Nenhuma fonte foi carregada em nenhuma fase; a variável era uma promessa | `next/font` no layout raiz, com `--font-inter`/`--font-jakarta`, e o tema do evento passou a herdar `--font-sans` |
| 2 | O tema do evento definia fallbacks em `oklch` roxo, alheios à marca | A FASE 3 escolheu um roxo de exemplo antes de existir identidade | Fallbacks agora apontam para tokens do sistema (`--color-primary`, `--color-surface`, `--radius-md`): o organizador sobrescreve, mas o padrão é da marca |
| 3 | A trava reprovou 15 arquivos de uma vez na primeira execução | Ela foi escrita depois do código legado, sem linha de base | Catraca com teto por arquivo, e as três telas-exemplo foram limpas na mesma entrega (a lista já nasceu menor) |
| 4 | `TenantHeader` ficou órfão depois do shell novo | Dois componentes de navegação coexistindo seria a origem do próximo menu divergente | Arquivo removido; `TenantMenu` (seletor de contexto) foi preservado e realocado no bloco de conta |
| 5 | O `Field` do painel admin e o `Field` do sistema eram componentes diferentes com o mesmo nome | A FASE 7 criou o próprio; a 11A criou o do sistema | Registrado como dívida da 11B (unificar), com o teste de guarda permitindo a convivência temporária |
| 6 | **E2E:** 3 testes falharam com `strict mode violation: getByTestId('active-tenant') resolved to 2 elements` | A gaveta mobile recebia o mesmo bloco de contexto da barra lateral, então o `data-testid` existia **duas vezes no DOM** — e o Playwright conta elementos, não elementos visíveis (a barra lateral fica `hidden` por CSS, mas está no DOM) | O bloco de contexto saiu da gaveta: a barra superior já mostra o nome e o seletor de instituição vive no bloco de conta. Um `data-testid`, um elemento — a regra que a suíte já cobrava desde a FASE 2 |

---

## 6. Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 775 testes / 27 arquivos
npx vitest run tests/unit/design-system-guard.test.ts
                             → 5 testes: paleta, hexadecimal, tipografia, tokens, valores
npm run build                → "Compiled successfully" (rota nova: /superadmin/design)
npm run db:verify            → "Contrato íntegro."
npm run test:e2e             → 42 testes / 9 arquivos (57,8 s)
```

Depois da correção do `data-testid` duplicado (lição 6), a suíte E2E voltou a 42/42 —
inclusive os três testes de troca de contexto da FASE 2, que continuam provando que
`active-tenant` mostra a instituição e os papéis corretos no shell novo.

---

## 7. Comandos operacionais

```bash
docker compose --profile app up -d --build web
# Identidade renderizada (precisa ser SuperAdmin):
#   http://localhost:3000/superadmin/design
# Telas-exemplo do padrão:
#   /t/ufba-demo/administracao        → painel administrativo com o shell novo
#   /t/ufba-demo/eventos              → páginas públicas com cabeçalho/rodapé
#   /superadmin/metricas              → governança no mesmo shell
npx vitest run tests/unit/design-system-guard.test.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Encaminhamento |
|---|---|---|---|
| 1 | 31 arquivos com cor crua (teto registrado no teste) e 23 com tamanho arbitrário | Telas das fases 3–10 ainda misturam tons fora da paleta | **FASE 11B**: migrar tela por tela, baixando os tetos |
| 2 | Tema escuro não revisado (`:root` claro é a identidade; `.dark` só evita variável indefinida) | Quem usa `prefers-color-scheme: dark` continua no claro | Definir a escala escura completa quando o tema entrar no produto |
| 3 | Dois `Field` (sistema × painel admin) | Formulários do painel não seguem as regras de acessibilidade do sistema | 11B: unificar no primitivo do sistema |
| 4 | `event-theme.css` reimporta o Tailwind (`@import 'tailwindcss'`) | CSS duplicado no bundle das páginas de evento | 11B: importar apenas o necessário |
| 5 | Componentes de gamificação (cartas) e raridade ainda usam cor própria | O visual de conquista não passa pelos tokens de tier | 11B: migrar `card-visual`/`card-rarity` para `RarityBadge` e `tier-*` |
| 6 | Sem tema por instituição no painel (só a landing usa `--ef-*`) | A instituição não personaliza a área autenticada | Decisão de produto futura |

---

## 9. Checklist de aceite

| Requisito | Situação |
|---|---|
| Tokens da identidade do `DESIGN.md` em código, com valores verificados por teste | ✅ |
| Tipografia carregada (Plus Jakarta Sans + Inter) e aplicada por papel | ✅ |
| Primitivos de UI com ponto de entrada único (`@/components/ui`) | ✅ |
| Shell com barra lateral, navegação agrupada por intenção e gaveta no mobile | ✅ |
| Páginas públicas com cabeçalho/rodapé consistentes | ✅ |
| Painel de governança no mesmo shell (variante plataforma) | ✅ |
| Guia de estilo vivo em `/superadmin/design` | ✅ |
| Telas-exemplo migradas (administração, públicas, métricas, instituições) | ✅ |
| `data-testid` e rótulos preservados (42 E2E continuam válidos) | ✅ |
| Trava mecânica contra cor crua, hexadecimal e tamanho arbitrário | ✅ |
| Padrão documentado para módulos futuros (`docs/design-system.md` + `AGENTS.md`) | ✅ |
| Dívida restante registrada com teto explícito (11B) | ✅ |
