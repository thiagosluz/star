# FASE 52 — "Fechar o que abrimos": acessibilidade, um landmark por tela, o E2E medido e a dívida do vizinho

> **Escopo definido pelo humano.** Depois do levantamento das dívidas técnicas (49 abertas),
> o humano escolheu o pacote **"Fechar o que abrimos"**: o que as duas fases anteriores
> criaram e deixaram declarado — mais as correções que o próprio levantamento precisava.
> A frase que abriu a fase: **"APROVADO: AVANÇAR"**.

---

## 1. Sumário executivo

| Entrega | O que mudou | Situação |
|---|---|---|
| **E74** · contraste do token de aviso | O tom único (`#d97706`) media **2,89:1** no painel claro e 4,15:1 no telão: **não existe um valor que sirva às duas superfícies**. Agora são dois tokens medidos — `warning-strong` (`#92400e`, 6,44:1 / 7,09:1) e `warning-strong-on-dark` (`#fcd34d`, 9,17:1) —, presos por **teste catraca** que lê o `globals.css` e calcula o contraste do WCAG | ✅ quitada |
| **E75** · dois `<main>` por tela | O landmark duplicado (casca + página) virou **um só**. Quem perdeu o `<main>` foi a **casca** — ela é espaçamento, não conteúdo —, e as quatro telas que se apoiavam nela ganharam o seu; a `EventLanding` passou a ter o dela, o que também deu landmark à página pública do evento | ✅ quitada |
| **I1** · os 13 cenários E2E em `test.fixme` | **8 dos 13 voltaram a rodar e passar** (mídia 2, catálogo 3, link da carta 1, crachá 2). Cada um tinha uma causa própria e real — nenhuma era "teste chato": ver §5 | ⚠️ **parcial** (5 permanecem, com motivo medido) |
| **Defeito real de produto** (achado por I1) | A tela de crachás oferecia a pessoa **inscrita no evento** para emissão à mão e o serviço só aceitava quem tinha **vínculo**: a secretaria escolhia e recebia *"Nenhum participante para emitir crachá"*. O serviço passou a usar a **mesma população da tela** (inscrição ∪ vínculo) | ✅ corrigido e preso por teste |
| **E77** · logo na etiqueta | **NÃO entregue.** O renderizador de crachá é um **escritor de PDF à mão**, sem suporte a imagem (`XObject`); embutir o logo é somar essa capacidade + o download/recorte do arquivo + o bitmap no ZPL. Declarada de novo, com o caminho escrito — ver §8 | ❌ residual |
| **Levantamento** | **E8 riscada** (o ZIP de certificados existe desde a FASE 36 — a verificação original procurou biblioteca de terceiro e não viu o escritor próprio); **B6 corrigida** (são **206** `console.*` nos serviços, não ~66); e a contagem de dívidas abertas revisada | ✅ |

**Números da fase:** 2 tokens novos na paleta, 1 teste de unidade novo (5 casos), 1 teste de
integração novo (4 casos), 4 arquivos de página tocados para o landmark, 1 arquivo de serviço
corrigido, 1 spec E2E reescrito em 4 frentes, 2 documentos atualizados. **Nenhuma migração**
(a fase não toca o banco — e o defeito de emissão foi corrigido na consulta, não no schema).

---

## 2. O problema mais difícil: não existe um tom de aviso que sirva às duas telas

A dívida E74 parecia "trocar uma cor". Ela é uma **impossibilidade aritmética**, e foi isso que
a manteve aberta por uma fase inteira com isenção no portão de acessibilidade:

```text
superfície clara (warning-soft #fff2e4) ....... precisa de tom ESCURO  (>= 4,5:1)
superfície escura (telão #2c3039) ............. precisa de tom CLARO   (>= 4,5:1)

#d97706  ..... 2,89:1 no claro   ·  4,15:1 no escuro   (o tom único: reprova nos dois)
#92400e  ..... 6,44:1 no claro   ·  1,86:1 no escuro   (bom no claro, péssimo no escuro)
#fcd34d  ..... 1,31:1 no claro   ·  9,17:1 no escuro   (bom no escuro, péssimo no claro)
```

O comentário que a FASE 50 deixou no portão já dizia o certo — *"a correção é separar o token"*.
O que faltava era **medir e prender**: cada tom agora vive no token do seu contexto, e um teste
de unidade reprova quem voltar a usar um só. O teste também prova o próprio valor: o primeiro
caso afirma que **o tom antigo falharia**, para que o número não precise ser acreditado.

**Alternativa descartada:** trocar o aviso por um ícone + texto neutro. Esconderia a cor sem
resolver o contraste dos ~57 pontos que já usavam o token — e a cor de aviso é informação.

---

## 3. Decisões técnicas

### 3.1 Quem perde o landmark é a CASCA, não a página (`E75`)

Havia dois `<main>` em toda tela autenticada: um no `app-shell` (o invólucro de espaçamento) e
outro na página. As opções eram (a) tirar o das ~40 páginas, ou (b) tirar o da casca.

Ficou **(b)**, por três razões: o wrapper da casca é **layout** (padding, largura máxima) e não
afirma nada sobre o conteúdo; a pergunta "o que é o principal desta tela?" só a tela responde; e
o custo é 1 arquivo em vez de 40. As **quatro** páginas que não tinham `<main>` próprio
(administração, equipe, comunicação e a prévia da página pública) ganharam o seu — a prévia
herda o da `EventLanding`, que passou a ser o landmark da página pública do evento (que não
tinha nenhum).

### 3.2 A catraca de contraste lê o CSS de verdade

O teste novo (`tests/unit/f52-warning-contrast.test.ts`) não repete os valores: ele **parseia o
`globals.css`**, calcula a luminância relativa pela fórmula do WCAG e compara com o mínimo AA.
Trocar o token por um tom que não passa quebra o teste — que é o oposto de um comentário na
paleta, que não impede ninguém de "clarear um pouquinho" na próxima revisão visual.

Três detalhes que ele prende: o tom claro tem **folga** (sobrevive a um invólucro com
`opacity-90`, que era o outro número da dívida — 2,59:1); o tom do escuro é **mais claro** que o
do claro (é o que os separa); e os dois são **diferentes** entre si.

### 3.3 A emissão à mão usa a população da TELA (defeito real)

O serviço aceitava, para uma seleção explícita, apenas quem tinha `user_tenant_profile`; a tela
lista quem tem `registration` no evento. **Duas populações, um botão.** A régua passou a ser a
união — inscrição no evento ∪ vínculo —, e quem não tem nenhum dos dois continua de fora (a
recusa honesta, que impede crachá para estranho).

---

## 4. ADRs

**ADR-289 — O aviso tem dois tons, e a escolha é MEDIDA, não visual.** O token de aviso ganhou
um par (`warning-strong` para superfícies claras, `warning-strong-on-dark` para o telão), com os
valores presos por teste de contraste. Consequência: qualquer novo uso de aviso precisa saber em
que superfície está — e há uma catraca para lembrar.

**ADR-290 — A casca não é o landmark.** O `<main>` pertence à página. Consequência: páginas
novas nascem com a obrigação de declarar o seu; a auditoria das 82 páginas mostrou **16 sem
landmark nenhum** (8 do SuperAdmin e 8 públicas, que já era assim) — declaradas como dívida
**I2**, porque a promessa do AA é sobre o que atrapalha o uso, e isto é boa prática.

**ADR-291 — A emissão à mão aceita quem a tela oferece.** A população da emissão explícita é a
união de inscrição no evento e vínculo na instituição. Consequência: o serviço e a tela deixam de
divergir; quem não é nem inscrito nem vinculado não recebe crachá.

**ADR-292 — Um cenário E2E monta o próprio estado.** Os cenários que dependiam do cenário
anterior (o crachá emitido no caso 1 era pressuposto do caso 3) passaram a preparar o que
precisam. Consequência: rodar um caso sozinho — o que se faz ao depurar — funciona, e a falha
aponta para o lugar certo. (Mesma família da dependência de ordem quitada na FASE 50.)

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | A secretaria seleciona a pessoa inscrita, clica em "Emitir" e recebe **"Nenhum participante para emitir crachá"** | O serviço buscava a seleção explícita só em `user_tenant_profiles`; a tela lista por `registrations`. Duas populações, um botão | União das duas populações na emissão explícita + 4 testes de integração |
| 2 | O caso E2E do crachá falhava com `credential?.category === undefined` **mesmo com a caixa marcada na tela** | O clique caía **antes da hidratação**: o DOM ficava marcado e o **estado do React** vazio — e como o React não re-renderiza, nada desmarcava. O formulário monta os `userIds` do ESTADO, então ia vazio | O helper passou a exigir o **input escondido** (`input[name="userIds"]`) como prova de que o React assumiu; a marca é refeita (desmarca e marca) enquanto ele não existir. Armadilha 106 |
| 3 | Os mesmos casos passavam **sozinhos** e falhavam no arquivo inteiro (e vice-versa) | Dependência de ordem entre cenários: o caso 3 pressupunha o crachá emitido pelo caso 1 | Cada cenário limpa e emite o que confere (`limparCrachas` + `emitirPelaTela`) |
| 4 | Filtro de mídia: "esperava 4 linhas, achou 6" (e o caso passava a medir outra coisa) | O helper `assetRows` contava `media-list li` — e cada imagem tem uma **lista interna** de usos, com `<li>`s próprios (4 imagens + 2 em uso = 6) | Combinador de filho direto (`> li`) |
| 5 | O spec do catálogo lia `page.url()` logo após o clique e via a URL **antiga** | `page.url()` lê na hora; a navegação ainda não tinha acontecido | `expect(page).toHaveURL(...)`, que espera |
| 6 | O spec do link da carta comparava o **HTML inteiro** de "vencido" com "inexistente" e reprovava | O `<head>` carrega a URL canônica, e ela contém o próprio token consultado: comparar bytes mede que dois endereços são diferentes — não é a promessa | A comparação passou a ser do **que o visitante lê** (`body`), mais a asserção de que a palavra "expirado" não aparece |
| 7 | **16 páginas sem `<main>` nenhum** (8 do SuperAdmin, 8 públicas) | Anterior a esta fase: o landmark vinha da casca só no painel autenticado; as outras árvores nunca tiveram | Declarada a dívida **I2** (boa prática, não bloqueio) — e a página pública do evento deixou de estar nela, por herdar o da `EventLanding` |
| 8 | O levantamento dizia "E8: nada no código (`zip\|archiver\|jszip` = 0)" | O ZIP de certificados existe desde a FASE 36 — escrito **à mão** (`zip-writer.ts`), sem biblioteca de terceiro. A verificação procurou a ferramenta, não a função | E8 riscada, com a prova da rota |
| 9 | O levantamento dizia "~66 `console.*` nos serviços" | A contagem era estimativa de uma leitura anterior; a medição de hoje dá **206** ocorrências contra **9** arquivos que usam o `logger` | B6 corrigida |

---

## 6. Evidência de verificação

```text
npm run lint ....................... 0 erros, 0 warnings
npm run typecheck .................. 0 erros
npm test ........................... 131 arquivos · 2706 testes passando
npm run build ...................... ✓ Compiled successfully
npm run db:verify .................. Contrato íntegro.
npx prisma migrate status .......... 49 migrations · Database schema is up to date!
npx playwright test tests/e2e/accessibility.spec.ts ..... 7 passed (SEM isenções)
npx playwright test tests/e2e/f51-media-filters.spec.ts . 3 passed
npx playwright test tests/e2e/f51-catalog-archive.spec.ts  3 passed
npx playwright test tests/e2e/f51-card-share-expiry.spec.ts 3 passed
npx playwright test tests/e2e/f51-credential-badge.spec.ts 2 passed · 5 skipped (fixme)
npm run test:e2e (suíte completa) .. 209 passed · 6 skipped · 0 failed
npx vitest run tests/unit/f52-warning-contrast.test.ts ... 5 passed
npx vitest run tests/integration/f52-credential-emission.test.ts ... 4 passed
```

**A isenção de acessibilidade foi REMOVIDA**: o portão roda as 6 telas com a lista de isenções
vazia, e qualquer violação de `color-contrast` volta a reprovar em qualquer nó.

---

## 7. Comandos operacionais

```bash
# O contraste do aviso (a catraca lê o globals.css de verdade)
npx vitest run tests/unit/f52-warning-contrast.test.ts

# O portão de acessibilidade — hoje SEM isenções
npx playwright test tests/e2e/accessibility.spec.ts

# A emissão à mão do crachá (inscrição ∪ vínculo)
npx vitest run tests/integration/f52-credential-emission.test.ts

# Os cenários E2E que voltaram a rodar
npx playwright test tests/e2e/f51-media-filters.spec.ts tests/e2e/f51-catalog-archive.spec.ts \
  tests/e2e/f51-card-share-expiry.spec.ts tests/e2e/f51-credential-badge.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

**Quitadas nesta fase:** **E74**, **E75** (declaradas na F50) e **E8** (riscada: já estava feita
desde a F36).

**I1 — parcial, e o que falta é conhecido.** Dos 13 cenários que a FASE 51 deixou em `test.fixme`,
**8 rodam e passam**. Os 5 restantes seguem marcados, cada um com o motivo escrito no arquivo:

| Cenário | O que falta |
|---|---|
| 3 · trocar a categoria de UM crachá | O `select` da linha é controlado; falta aplicar a ele o mesmo remédio já usado no seletor do lote |
| 4 · a folha e a etiqueta | A rota de impressão responde **400** pelo endereço que a própria tela publica — é investigação da ROTA |
| 5 · o crachá online | A pessoa do cenário é criada só com inscrição; `/meu-cracha` é aberto por posse dentro da instituição |
| 6 e 7 · o seletor de lente | Precisam de `enumerateDevices` falso no contexto e do comportamento quando a lista chega depois |

**E77 — logo na etiqueta (declarada de novo, com o caminho).** O crachá sai com a **cor do tema**
e a **faixa da categoria**; o logo da instituição não entra. O motivo é estrutural: o
renderizador (`src/lib/credentials/badge-renderer.ts`) escreve o PDF **à mão**, operação por
operação, e não tem suporte a imagem (`XObject`). Fechar exige: (a) buscar o `logoUrl` e reduzir
com o `sharp` para JPEG (a esteira da F46 já existe), (b) somar o objeto de imagem e o
posicionamento ao escritor, (c) **cachear por instituição** com invalidação, e (d) o bitmap no
`^GF` do ZPL para a térmica. E com a regra que já vale na impressão: **falha de download não
derruba o crachá** — ele sai sem logo e a trilha registra o aviso.

**I2 — 16 páginas sem landmark `<main>` (nova).** 8 do painel de plataforma (`/superadmin/**`) e
8 públicas (`/t/<slug>/eventos/<eventSlug>`, chamada, inscrição, convite, ficha do palestrante…).
Não é violação do AA (é boa prática de landmark), mas é o mesmo tema do E75 e ficou visível agora
que a casca deixou de fornecer o landmark. Correção: envolver o conteúdo de cada página.

**Correções no levantamento** (`docs/dividas-tecnicas.md`): E8 riscada com a prova; B6 corrigida
para **206**; e a nota de contagem revisada.

---

## 9. Checklist de aceite

- [x] **E74** — dois tons de aviso, medidos (6,44:1 / 7,09:1 no claro; 9,17:1 no escuro) e presos
      por teste que lê o CSS e calcula o contraste do WCAG
- [x] **E74** — a isenção de `color-contrast` **removida** do portão; as 6 telas passam com a
      lista vazia
- [x] **E74** — o telão usa o token do escuro (era o único ponto de aviso sobre superfície escura)
- [x] **E75** — um único `<main>` por tela autenticada (a casca deixou de ser landmark)
- [x] **E75** — as 4 telas que se apoiavam na casca ganharam o próprio; a `EventLanding` também,
      o que deu landmark à página pública do evento
- [x] **E75** — auditoria das 82 páginas com o resultado registrado (16 sem landmark → dívida I2)
- [x] **I1** — 8 dos 13 cenários de volta, com causas distintas corrigidas (hidratação, ordem,
      helper frouxo, URL lida cedo, HTML vs conteúdo lido) e sem afrouxar nenhuma asserção
- [x] **I1** — os 5 restantes documentados **dentro do arquivo**, com o que falta em cada um
- [x] **Defeito real** — emissão à mão usa a população da tela (inscrição ∪ vínculo), presa por
      4 testes de integração
- [x] **Levantamento** — E8 riscada, B6 corrigida, contagem revisada
- [x] Bateria completa verde, com números reais medidos nesta árvore
- [ ] **E77** — logo na etiqueta: **não entregue** (residual declarado com o caminho)
