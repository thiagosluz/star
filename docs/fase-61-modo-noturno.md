# FASE 61 — Modo noturno (dívida H3)

> **Estado: EM ANDAMENTO** — a dívida **H3**, registrada desde a FASE 11A: *"`.dark` só evita
> variável indefinida; a escala escura não foi desenhada"*. Quem usa o computador em modo escuro
> via o sistema claro.

## 1. Sumário executivo

Decisões do humano (as quatro perguntas da fase, todas na opção recomendada):

| Pergunta | Decisão |
|---|---|
| Como se escolhe | **Seguir o sistema por padrão** + escolha manual de **três estados**: Claro · Escuro · Sistema |
| Até onde vale | **O sistema inteiro da plataforma**, com duas exceções por desenho |
| Onde fica o controle | No **menu de conta** da barra lateral **e** em `/conta`, funcionando sem JavaScript |
| Página do evento | **Mantém o tema do organizador** — as cores que ele escolheu não são invertidas |

| Entrega | Onde |
|---|---|
| **A escala escura** (só a camada `--ef-*`, sem tocar em componente) | `src/app/globals.css` + `DESIGN.md` |
| **A fiação**: cookie, classe no `<html>`, Server Action e o controle de 3 estados | `src/lib/theme/**` · `src/app/layout.tsx` · `src/app/actions/**` · menu de conta e `/conta` |
| **A varredura** do que assumia superfície clara | componentes e telas da plataforma |
| **Contraste medido nos DOIS modos** | catraca de contraste (a mesma régua da FASE 52) |
| O portão WCAG AA varrendo **no escuro** | `tests/e2e/accessibility.spec.ts` |

## 2. O problema: o tema escuro é uma decisão de TOKENS, não de tela

A tentação é sair trocando cores por tela. Neste projeto isso seria um erro caro, porque a camada
de tokens já existe e é ela que faz o trabalho: os componentes escrevem papéis
(`bg-surface`, `border-border`, `text-muted-foreground`, `text-warning-strong`), e o
`globals.css` traduz papel em valor — `--ef-*` no `:root`, publicado no `@theme` como `--color-*`.

Isso define o desenho da fase: **o modo escuro redefine apenas a camada `--ef-*`**. Nenhum
componente precisa saber que o modo existe; quem tem de saber é a escala. O que sobra — e é onde o
trabalho de verdade mora — são os lugares que **escaparam** do sistema de tokens: cor crua, hex
inline, fundo claro assumido, `dark:` herdado da 11A e componentes com cor calculada.

Três armadilhas específicas deste produto:

1. **O telão do sorteio é escuro por DESENHO** (FASES 29/30): ele tem tokens próprios
   (`inverse-surface`, `warning-strong-on-dark`) porque é lido a metros de distância. Se o modo
   claro o "clareasse", a fase estragaria a operação de palco — e se fosse o modo escuro a mandar
   nele, a fase não teria feito nada. Ele fica de fora dos dois lados.
2. **O organizador escolheu as cores da página pública** (FASE 17/41): inverter o tema dele seria
   desfazer uma decisão de terceiro. A página do evento mantém o tema; a plataforma em volta
   (casco, login, inscrição, listas, área de conta) segue o modo.
3. **Documento impresso não tem modo escuro**: o certificado e o crachá são PDF/ZPL, renderizados
   no servidor para papel branco. Eles não podem ler token de tema — e isso vira item de
   verificação, não suposição.

## 3. Decisões técnicas

- **A escolha é do NAVEGADOR, não do perfil.** Cookie `ef_tema`, lido no servidor e gravado no
  `<html>` na primeira resposta: sem "piscar" claro e escurecer depois, e sem depender de
  JavaScript. A alternativa (coluna no banco) faria a preferência viajar entre dispositivos ao
  custo de uma escrita e de uma consulta por render — e não é o que "modo noturno" costuma
  significar para quem usa.
- **"Sistema" não escreve classe nenhuma.** Sem escolha gravada, quem responde é
  `@media (prefers-color-scheme: dark)` — é assim que a preferência do sistema operacional vale
  **sem JavaScript e sem cookie**, que é exatamente o defeito da H3.
- **A classe é uma só (`dark`)** — a mesma que o bloco da 11A já usava —, e o `data-tema` existe
  para o teste prender o ESTADO, não para estilizar.
- **`color-scheme` acompanha o modo**, senão controles nativos, barras de rolagem e autofill
  continuam claros dentro de uma tela escura — o defeito clássico de tema escuro meia-boca.
- **Contraste se mede nos dois modos**, com a mesma régua da FASE 52: o teste lê o CSS, calcula a
  razão do WCAG e **prende o número**. Nenhum par entra por olhômetro.

## 4. ADRs

### ADR-323 — O modo é do NAVEGADOR, e "Sistema" é o padrão que não escreve nada

**Contexto.** A H3 dizia "quem usa tema escuro do sistema vê o claro". Havia três caminhos:
guardar a preferência no perfil (banco), no cliente (JavaScript) ou no navegador (cookie lido no
servidor).

**Decisão.** Cookie `ef_tema` com três estados — `claro`, `escuro` e **ausente = sistema** —, lido
no servidor e aplicado no `<html>` da primeira resposta. A escolha explícita escreve a classe
`dark`; **"Sistema" não escreve classe nenhuma** e deixa a decisão para
`@media (prefers-color-scheme: dark)`. O controle é um formulário com Server Action: funciona sem
JavaScript, como a barra recolhível da FASE 59.

**Consequências.** Não há "flash" de tema (a marcação já chega decidida), o sistema operacional
manda em quem nunca escolheu, e a preferência não vira dado de perfil — trocar de máquina não
carrega a escolha, que é o comportamento esperado de modo noturno. O custo é que a preferência não
segue a pessoa entre dispositivos; a alternativa foi descartada de propósito, e não por esquecimento.

### ADR-324 — A escala escura troca VALORES, nunca o contrato dos componentes

**Contexto.** O sistema de tokens publica papéis (`surface`, `border`, `muted-foreground`,
`warning-strong`) e os componentes os consomem. Sair corrigindo tela por tela para o escuro
produziria uma segunda interface, que envelhece separada da primeira.

**Decisão.** O modo escuro redefine **apenas a camada `--ef-*`**; nenhum componente ganha
condicional de tema. O que não passa por token é corrigido para passar (ou é declarado exceção):
o **telão do sorteio** mantém os tokens escuros próprios nos dois modos, o **documento impresso**
(certificado e crachá) não lê token de tema, e a **página pública do evento** continua com o tema
do organizador.

**Consequências.** O modo claro não muda visualmente (é o `:root` de hoje, intacto) e a operação
não aprende uma segunda forma de desenhar. O preço é disciplina: token novo nasce nas duas escalas,
e é a catraca que impede a escura de ficar incompleta.

### ADR-325 — Contraste é medido nos DOIS modos, e o portão de acessibilidade varre no escuro

**Contexto.** A FASE 52 mediu o contraste do token de aviso e prendeu o número numa catraca que lê
o CSS. Um tema escuro novo significa **um conjunto novo de pares** texto/fundo — e nenhum deles
tem histórico.

**Decisão.** A catraca de contraste passa a medir os pares nos dois modos (≥ 4,5:1 para texto e
≥ 3:1 para interface), e o portão do `axe` ganha uma varredura do painel **em modo escuro** — as
duas provas que o "modo noturno" precisa para não ser só uma opinião sobre cores.

**Consequências.** Escala escura com par ruim não entra: o teste diz o número. E a acessibilidade
deixa de ser medida num único modo — o que era uma lacuna silenciosa, porque o `axe` só via a tela
como ela nascia no servidor.

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **"Escolhi Claro e continuo no escuro"** (o defeito da H3 de cabeça para baixo), em sistema operacional escuro | A media query do modo do sistema veio **sem guarda**: `@media (prefers-color-scheme: dark) { :root { … } }` tem a mesma especificidade do `:root` da escolha explícita e vem depois — o `data-tema="claro"` era ignorado pelo CSS | `:root:not([data-tema='claro'])` na media query. Achado pelo agente da fiação, que sabia qual gancho estava gravando (`data-tema` sempre) — e é o tipo de defeito que **nenhum dos dois lados veria sozinho** |
| **6 pares do modo CLARO reprovavam o AA desde antes desta fase**: `--ef-success-strong` 3,59:1 na tela, `--ef-danger-strong` 4,41:1 sobre o suave, `--ef-outline-variant` **1,63:1** como borda de campo | A catraca da FASE 52 media **UM** par (o token de aviso). A paleta nunca foi medida inteira, e o portão do `axe` não pega texto de estado que não aparece nas telas varridas nem borda de campo | Os três tokens foram corrigidos (`#047857`, `#b91c1c`, `#83808f`), a paleta passou a ser medida **inteira e nos dois modos** (35 pares no claro, 42 no escuro) e a **lista de exceção ficou vazia** |
| **5 defeitos que só existem no escuro**: o botão secundário perdia fundo e hairline, o realce de linha da tabela sumia, o véu do modal virava névoa BRANCA, e o palco do editor de certificado mostrava tinta escura sobre cartão escuro (rótulo invisível) | Todos eram **cor fixa ou papel trocado**: `rgb(15 23 42 / 0.05)` é tinta escura (invisível no escuro), `bg-foreground/45` no véu usa o token de TEXTO (que é claro no escuro) e o editor de certificado simula **papel** seguindo o tema | Trocados por token de papel (`on-surface`, `inverse-surface`, `destructive-foreground`) e por **papel branco literal** no editor — que no claro é exatamente o mesmo valor. O modo claro foi medido antes/depois: diferença máxima de 1,6/255 por canal |
| **A página pública do organizador escurecia junto com a plataforma** (quem escolheu só a cor primária) | O CSS do evento usa `var(--color-surface…, <fallback>)`: quando o organizador não define aquele papel, o valor **cai no token da plataforma** — e a decisão "o organizador manda" só valia para tema completo | O mapa do tema passou a definir **todos** os papéis que o CSS do evento consome, e uma catraca lê o CSS do evento e o gerador e reprova se um `var()` puder cair na plataforma (ver o relatório desta frente) |
| **`DESIGN.md` não existia** — e era citado como fonte da verdade por `docs/design-system.md`, pelo `README.md` e por comentários de 6 componentes, há 50 fases | A catraca de identidade confere os valores direto no `globals.css`; ninguém precisou abrir o documento que ela dizia conferir | Reconstruído a partir dos valores **vigentes**, com a proveniência declarada no topo (reconstrução, não documento original), e agora é ele que a catraca trava |
| **`@theme inline` não publica `--color-*`** (0 declarações no CSS construído) | Um valor arbitrário escrito como `var(--color-primary-foreground)` **não resolve** — o botão ficaria sem realce nos dois modos, silenciosamente | Usar o apelido (`var(--primary-foreground)`); a medição no CSS compilado virou parte do relatório da varredura |
| **7 arquivos `page.tsx.bak2…bak8` commitados** em fases antigas | Sobra de cirurgia de linha que **escapa de toda catraca** (não termina em `.tsx`) e guarda cópias de páginas que ninguém lê | Removidos (nenhuma referência no código) |
| **"essa parte aqui no final deu uma quebrada"** (relato com imagem): o bloco de conta estourou a barra e o **botão de sair apareceu cortado na borda** | Armadilha clássica do flexbox: o seletor de instituição é um `<details>` (ITEM flex) e o padrão de `min-width` de um item flex é `auto` — ele **não encolhe** abaixo do próprio conteúdo, então a linha empurra os dois botões novos para fora em vez de truncar nome/e-mail | `min-w-0` na cadeia (linha do bloco, `<details>` e `<summary>`), `shrink-0` no chevron e no formulário de sair. Provado por **mutação**: sem o `min-w-0` do `<details>`, o botão passa **501 px** da borda — e a catraca nova reprova (`f61-layout-da-conta`) |
| O projeto mede contraste, mas **não media GEOMETRIA** (a dívida **H6**, "regressão visual", segue aberta) | `toHaveScreenshot` nunca entrou, e um controle novo ao lado de outros dois não tem régua: medir acessibilidade não pega um botão que sai da caixa | A prova barata do caso relatado: `tests/e2e/f61-layout-da-conta.spec.ts` mede a **caixa** dos dois controles contra a caixa do container, nos **três** estados (barra inteira, barra recolhida e gaveta do celular) — e o teste da gaveta usa `expect.poll` porque a gaveta desliza em 200 ms e medir no meio da animação acusa uma borda que não existe |

## 6. Evidência de verificação

```text
npm run lint ......................... 0 erros, 0 warnings
npm run typecheck .................... 0 erros
npm test ............................. 155 arquivos · 2956 testes passando
npm run build ........................ Compiled successfully in 19.7s
npm run test:e2e ..................... 268 passed · 1 skipped · 1 failed (6,8 min)
   A vermelha é `demand-board.spec.ts` ("Alt+↓ reordena e anuncia a posição"), que passa
   **isolada** (`7 passed`, 11,3 s): é a flake sob carga paralela que a FASE 60 havia
   reduzido — a suíte ganhou 6 cenários nesta fase e a interferência reapareceu. Ver §8.

testes da fase (unit):
  f61-escala-escura ..................... 9   (cobertura dos 64 tokens nos dois sentidos)
  f61-contraste-dos-dois-modos .......... 9   (35 pares no claro + 42 no escuro, presos)
  f61-varredura-escuro .................. 5   (cor crua, rgb(), cobertura, impressos sem token)
  f61-modo-noturno ...................... 17  (regra pura do modo)
  f61-tema-do-evento .................... 10  (catraca do tema do organizador)
E2E da fase:
  f61-modo-noturno ...................... 2   (atravessa telas, reload e o casco; e sem JavaScript)
  f61-pagina-do-evento .................. 3   (o organizador manda, com o painel no escuro)
  f61-layout-da-conta ................... 3   (o bloco de conta cabe na barra, na trilha e na gaveta)
  accessibility ......................... 13  (o painel em modo escuro entrou na varredura)
```

**Prova de que a catraca da conta morde** (mutação, feita e desfeita): sem o `min-w-0` do
`<details>`, `f61-layout-da-conta` reprova com `o botão de sair passa da borda` e a medida de
**501 px** além do limite — o mesmo defeito do relato. Com a correção: `3 passed`, e o conjunto
`f61-layout-da-conta + f59-nav-colapsavel + accessibility` fecha em **17 passed (20,7 s)**.

## 7. Comandos operacionais

```bash
# A escolha do usuário (cookie do NAVEGADOR; sem cookie = modo do sistema)
#   Claro   → ef_tema=claro    (vence o sistema operacional escuro)
#   Escuro  → ef_tema=escuro
#   Sistema → apagar o cookie  (quem responde é @media (prefers-color-scheme: dark))
document.cookie = 'ef_tema=escuro; path=/'

# Onde trocar: menu de conta na barra lateral e /conta → "Aparência"

# As provas
npx vitest run tests/unit/f61-escala-escura.test.ts tests/unit/f61-contraste-dos-dois-modos.test.ts
npx playwright test tests/e2e/f61-modo-noturno.spec.ts tests/e2e/f61-pagina-do-evento.spec.ts
npx playwright test tests/e2e/accessibility.spec.ts        # inclui o painel no escuro
```

Para **acrescentar um token de cor**: ele nasce nas DUAS escalas (`:root` e o bloco escuro) — a
catraca `f61-escala-escura` reprova a escala incompleta e a `f61-varredura-escuro` diz quais telas
usam o token que ficou sem par. Para **acrescentar uma cor ao tema do evento**, ela entra no mapa
(`landing-page.ts`), nunca como fallback no CSS: a catraca do tema do evento lê o CSS e reprova
qualquer `var()` que possa cair no token da plataforma.
## 8. Dívidas técnicas

**Quitada:** **H3** ("tema escuro completo"), aberta desde a FASE 11A/11B.

**Nova:**
- **E81 — a elevação por sombra não existe no modo escuro.** `--shadow-card` e `--shadow-modal` são preto em alfa: no escuro a sombra desaparece sobre superfície já escura. O cartão continua se distinguindo **por tom** (`#23252d` sobre `#17181e`), então não é defeito de leitura — é perda de hierarquia. A correção é decidir a elevação do escuro (tom mais claro em vez de sombra, ou sombra com alfa maior) e prendê-la.

**Reaberta, com a medição desta fase:**
- **I3 — a interferência na suíte E2E paralela NÃO está fechada.** A FASE 60 corrigiu o mecanismo que ela identificou (casos lendo o dado do caso anterior) e a execução completa fechou verde naquela fase; nesta, com **6 cenários novos** na suíte, a execução completa voltou a acusar **1 vermelho** — `demand-board.spec.ts`, "Alt+↓ reordena e anuncia a posição" — e o **mesmo arquivo passa isolado** (`7 passed`, 11,3 s). Ou seja: o vermelho continua podendo ser carga, e não defeito. O que falta é medir o limite (workers, tempo por cenário) e/ou tornar determinística a espera da ação de reordenar.

**Preservados por decisão (não são dívida):**
- o **telão do sorteio** continua escuro nos dois modos (tokens próprios, par medido em 9,17:1);
- os **impressos** (certificado e crachá) não leem token de tema — confirmado em 9 módulos de PDF/ZPL, com catraca;
- a **página pública do evento** obedece ao organizador;
- dois pares ficam **fora** da régua de 3:1, com o motivo escrito no teste: o **preenchimento** do botão de ação no escuro (1,57:1 contra a tela — nenhum indigo fecha 3:1 de área e 4,5:1 com o rótulo branco ao mesmo tempo) e o `secondary-container` do chip como área grande (rótulo em 6,59:1).

## 9. Checklist de aceite

- [x] **Três estados** (Claro · Escuro · Sistema), com **Sistema** como padrão de quem nunca escolheu
- [x] A escolha do sistema vale **sem cookie e sem JavaScript** (`prefers-color-scheme`)
- [x] A escolha explícita de **Claro vence o sistema operacional escuro** (a guarda da media query)
- [x] O tema chega no **`<html>` da primeira resposta** (sem piscar claro e escurecer depois)
- [x] O controle está no **menu de conta** e em **`/conta`**, funciona **sem JavaScript** e anuncia a opção atual
- [x] A escolha **persiste** entre telas e sobrevive ao recarregamento (provado no E2E)
- [x] A escala escura redefine **só a camada de tokens**: nenhum componente aprendeu o que é "modo"
- [x] **Todo** token de cor do claro tem par no escuro (e vice-versa), preso por catraca
- [x] Contraste **medido nos dois modos**, com os números presos no teste e a lista de exceções **vazia**
- [x] O portão WCAG AA varre o painel **em modo escuro**
- [x] O **telão**, os **impressos** e a **página do organizador** ficaram de fora, e há catraca para os dois primeiros
- [x] O modo **claro não mudou** (a não ser pelos três tokens que reprovavam o AA, corrigidos de propósito e declarados)
- [x] `lint`, `typecheck`, `npm test` e `build` verdes; a suíte E2E com **268 passed · 1 skipped** e **1 flake declarada** (a I3 reaberta, medida no §8)
- [x] As duas capturas do painel (claro e escuro) em `docs/imagens/f61-painel-*.png`, com a prova do fundo computado
- [x] O **bloco de conta cabe na barra** nos três estados (inteira, recolhida e gaveta do celular), preso por catraca provada por mutação
