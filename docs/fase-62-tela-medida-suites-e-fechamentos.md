# FASE 62 — Mutirão: a tela medida, a suíte honesta e dois fechamentos

> **Estado: ENTREGUE** — quatro dívidas numa fase: **H6** (regressão visual), **I3** (a suíte E2E
> deixa de mentir), **E80** (o ranking cita quem foi ocultado) e **E81** (a elevação do modo escuro).
> No caminho, a catraca nova **achou um defeito grave que quatro fases não viram**.

## 1. Sumário executivo

| Frente | O que é | Dívida |
|---|---|---|
| **A tela medida** | Regressão visual com `toHaveScreenshot`: painel e uma tela densa, nos **dois modos**, em **dois tamanhos**, com o rodapé da barra e a gaveta do celular | **H6** |
| **A suíte honesta** | A espera do quadro passou a repetir o GESTO até o FATO; custo e paralelismo medidos; ferramenta de limpeza do dado de teste | **I3** |
| **O ranking e a ocultação** | A pessoa ocultada pela moderação permanece na posição, **mascarada** — e a régua interna × pública ficou escrita | **E80** |
| **A elevação do escuro** | Elevação por **TOM**: o degrau que faltava ganhou token (`--ef-surface-popover`) e a sombra virou reforço | **E81** |

**O achado que justifica a fase inteira:** o primeiro snapshot de celular mostrou que a **gaveta de
navegação estava presa dentro do cabeçalho** (64 px de altura) — `backdrop-filter` no cabeçalho cria
containing block para descendentes `position: fixed`, e o `inset-0` da gaveta passou a resolver
contra a caixa do cabeçalho em vez da viewport. **A navegação em telefone estava inutilizável**, e
passou por F52, F58, F59 e F61 porque todas essas fases medem geometria e contraste de NÓS do DOM —
nenhuma olhava a tela.

## 2. O problema: o que não é medido não é visto

A casa mede bem o que escolheu medir: contraste (F52/F61), acessibilidade com `axe` (F50/F58),
geometria dos controles (F61). O que faltava era a pergunta mais simples de todas — **a tela está
como deveria estar?** — e é uma pergunta que nenhuma dessas catracas responde: o botão cortado na
borda e a gaveta presa no cabeçalho são invisíveis para as três.

A fase ataca isso em duas dimensões: **a tela** (snapshot) e **o teste que mente** (a suíte que
acusa vermelho por ambiente compartilhado, não por defeito).

## 3. Decisões técnicas

- **Snapshot com `maxDiffPixelRatio: 0`** — nenhum pixel diferente passa. Tolerância que "sempre
  passa" seria a negação do arquivo.
- **As máscaras são do DADO, não do desenho**: nome/e-mail da conta, a URL canônica e o endereço do
  ambiente. Mascarar o desenho seria esconder o defeito.
- **A linha de base é do AMBIENTE** e isso está escrito no arquivo: fonte e canvas variam por
  sistema e por imagem; rodar noutro lugar exige `--update-snapshots` **consciente**.
- **A espera mede o FATO, e o gesto se repete.** O `Alt+↑` do quadro não tem aperfeiçoamento
  progressivo (o `onKeyDown` vive no bundle): esperar o banco não conserta uma tecla que caiu antes
  do React. Repetir é seguro porque o alvo é função do índice que a tecla LÊ (idempotente).
- **`workers: 1` mantido, com número**: `2` foi 8,9% mais rápido no relógio e **70% mais lento por
  cenário** (eficiência 1,55× de 2× ideais) — ganho não demonstrado, configuração intacta.
- **O que apaga dado é DRY RUN por padrão**: `npm run e2e:clean` só apaga com `--confirmar`, recusa
  produção e prova nominalmente que a demonstração e o seed sobrevivem.

## 4. ADRs

### ADR-326 — A tela também é medida, e a linha de base é declarada

**Contexto.** Contraste, `axe` e geometria não pegam um botão cortado nem uma gaveta presa; o
defeito do rodapé da barra chegou por imagem do humano, e o da gaveta por snapshot.

**Decisão.** Uma suíte de regressão visual com `toHaveScreenshot`, escopo **pequeno e escolhido**
(painel + uma tela densa × claro/escuro × desktop/celular, mais o rodapé da barra e a gaveta),
`maxDiffPixelRatio: 0`, máscaras só no dado, linhas de base commitadas e o comando de atualização no
cabeçalho.

**Consequências.** Quebra visual passa a ter dono e data. O custo declarado: a linha de base vale
para **este** ambiente (fonte/canvas), e mudança de desenho intencional exige regenerar —
conscientemente, com o motivo escrito.

### ADR-327 — A espera é o FATO; o gesto que não tem rede se repete

**Contexto.** O cenário do `Alt+↑` esperava o banco depois de **um** `press`. Quando a tecla cai
antes do bundle, nenhum POST acontece e nenhum poll, por maior que seja, muda o cartão — o vermelho
apontava para o teste, não para o produto.

**Decisão.** `teclarAte(...)` repete o gesto **até a ordem mudar no banco**; a asserção negativa (a
seta sozinha não move) só roda **depois** de a positiva ter acontecido; nenhum timeout aumentou. E a
regra geral ficou escrita no cabeçalho do `helpers.ts` (5 itens).

**Consequências.** O vermelho volta a significar defeito — e o "1 vermelho que passa isolado" ganhou
nome medido: **ambiente compartilhado** (outro processo escrevendo artefatos causa `ENOENT` ao gravar
o trace) → execução completa concorrente precisa de `--output=<dir próprio>`.

### ADR-328 — A régua das superfícies INTERNAS: mascarar sem tirar a posição

**Contexto.** A E80: o ranking de conquistas citava quem a moderação ocultou. A F60 decidira o lado
público (a vitrine remove; o link selado usa rótulo neutro; o sorteio mascara) e deixara as
superfícies internas sem régua.

**Decisão.** Interna (membro autenticado): a pessoa **permanece** na lista — posição, XP e contagem
são o conteúdo — com o **nome abreviado** e **sem `@handle` nem foto**. Pública: identidade não é
publicada de forma alguma.

**Consequências.** A lista não encolhe e o cabeçalho da própria tela (`rank`/`rankedCount`) continua
batendo com o que se vê. O `maskPersonName` passou a viver ao lado de `isPersonPubliclyVisible` — a
lição da E79 é que régua copiada diverge.

### ADR-329 — A elevação do escuro é TOM, e a sombra é reforço

**Contexto.** No escuro, `--shadow-card`/`--shadow-modal` (preto em alfa) não desenham degrau sobre
superfície escura; a F61 já tentara alfa maior e a dívida sobreviveu.

**Decisão.** Elevação por **tom**: novo `--ef-surface-popover` (`#2f323c`, acima do cartão
`#23252d`), `--ef-surface-container` deixou de empatar com o cartão e a sombra ficou como reforço do
que flutua. O `--ef-outline-variant` do escuro subiu para `#7a7f8d` — **consequência medida**: com o
flutuante mais claro, a hairline media 2,64:1 (abaixo dos 3:1 do AA non-text).

**Consequências.** A escada do escuro é mensurável e presa por catraca (ordem de luminosidade
estrita + salto medido, com piso). O modo claro não mudou um pixel: `--popover` no claro resolve no
mesmo `#ffffff` de antes, e um teste prende isso.

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **A navegação do celular era INUTILIZÁVEL** e quatro fases não viram | `backdrop-filter` no cabeçalho cria containing block para `position: fixed`; o `inset-0` da gaveta passou a resolver contra os 64 px do cabeçalho. As catracas mediam nós do DOM (e o `boundingBox` de um filho clipado continua "dentro") | A gaveta saiu do containing block (portal), com **asserção de geometria** (a gaveta aberta ocupa a altura da viewport) e as linhas de base de celular regeradas |
| **"1 vermelho que passa isolado"** (a I3, reaberta na F61) | Não era uma spec poluindo outra: (a) o `Alt+↑` não tem aperfeiçoamento progressivo e o teste esperava a consequência de um gesto que não aconteceu; (b) **ambiente compartilhado** — outro processo vivo escrevendo `test-results/` faz o Playwright falhar com `ENOENT` ao gravar o trace | (a) `teclarAte` repete o gesto até o fato; (b) execução concorrente usa `--output` próprio; (c) `workers` mantido em 1 **com número** (2 foi 8,9% melhor no relógio e 70% pior por cenário) |
| A dívida do dado acumulado (375 instituições, 2.228 contas) não explicava a lentidão | Medido: o tempo por teste **caiu** com a pilha maior (1,60 → 1,42 s) — era contenção, não banco pesado | Ferramenta `npm run e2e:clean` (dry run por padrão) com preservação **nominal** da demonstração e do seed, e trava de FK provada em 0 |
| O ranking citava quem foi ocultado | A F60 fixou a régua do lado PÚBLICO e as superfícies internas ficaram sem régua | ADR-328 (mascarar sem tirar a posição) — e a mesma família apareceu no **ranking de revisores** (`achievement-service.ts:232`), que ficou declarada |
| O `--ef-outline-variant` do escuro reprovava o AA non-text **depois** da mudança de elevação | Consequência de desenho: o flutuante ficou mais claro que o cartão, e a hairline perdeu contraste sobre ele (2,64:1) | Valor corrigido com medição (`#7a7f8d`: 3,20:1 no flutuante, 3,82:1 no cartão, 4,43:1 no canvas) e 4 pares novos presos na catraca de contraste |

## 6. Evidência de verificação

```text
npm run lint ......................... 0 erros, 0 warnings
npm run typecheck .................... 0 erros
npm test ............................. (ver o relatório da bateria final)
npm run build ........................ (ver o relatório da bateria final)
npx playwright test .................. execução 1 (antes): 272 passed · 1 skipped · 0 failed (6,4 min)
                                        execução 3 (2 workers): 286 passed · 1 skipped · 1 failed (de terceiro)

testes da fase:
  unit       f62-ranking-e-ocultacao 6 · f62-elevacao-do-escuro 4 · (vizinhos: 22 arquivos, 312 testes)
  integração f62-ranking-e-ocultacao 6
  E2E        f62-ranking-e-ocultacao 4 · f62-regressao-visual 12 snapshots
  catracas provadas por mutação: o popover escuro de volta em #23252d reprova 2 casos;
             a remoção do `min-w-0` do bloco de conta reprova a geometria; o snapshot do rodapé
             reprova com o desenho antigo
```

## 7. Comandos operacionais

```bash
# Regressão visual: rodar e atualizar (conscientemente) a linha de base
npx playwright test tests/e2e/f62-regressao-visual.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots

# Suíte completa — em ambiente compartilhado, com diretório de artefato próprio
npx playwright test --output=test-results-meu

# Limpeza do dado de teste (SIMULA por padrão; só apaga com a palavra)
npm run e2e:clean
npm run e2e:clean -- --confirmar
```

## 8. Dívidas técnicas

**Quitadas:** **H6**, **I3**, **E80**, **E81**.

**Novas:**
- **E82 — o ranking de REVISORES cita quem foi ocultado.** `getReviewerRanking`
  (`src/lib/gamification/achievement-service.ts:232`) usa `reviewer.name` sem a fonte única,
  consumido pelo painel de Reconhecimento. A régua interna agora existe (ADR-328); aplicar ali muda
  o painel de premiação, que também nomeia quem recebeu a carta — decisão de produto.
- **E83 — a espera por GESTO em outros cenários.** `certificate-template.spec.ts:433-446` tem a
  mesma forma latente do `Alt+↑` (aperta a tecla uma vez e repete só a asserção) e o
  `f51-credential-badge.spec.ts:463` flocou 1× sob carga com mecanismo próprio (clique tardio do
  laço do select). Nenhum dos dois foi medido em antes/depois — ficam declarados em vez de
  "consertados" no escuro.

**Declarado (não é dívida):** as 2.135 contas `@exemplo.test` são fixture dos testes de integração
do Vitest e ficam fora do escopo do `e2e:clean`; a trilha de identidade dessas contas permanece (é
trilha, e por desenho não tem FK).

## 9. Checklist de aceite

- [x] Regressão visual com `toHaveScreenshot` cobrindo painel e tela densa, nos dois modos e dois tamanhos
- [x] O **rodapé da barra** (o defeito relatado na F61) e a **gaveta do celular** entre os snapshots
- [x] `maxDiffPixelRatio: 0`, máscaras só no dado, linhas de base commitadas e comando de atualização documentado
- [x] O limite de ambiente (fonte/canvas) declarado no arquivo, sem tolerância que "sempre passa"
- [x] **A suíte visual achou e a fase corrigiu** um defeito real: a gaveta de navegação presa no cabeçalho
- [x] A gaveta tem **asserção de geometria** (altura da viewport) e as linhas de base foram regeradas
- [x] A espera do quadro mede o **fato** (a ordem mudou no banco) e o gesto se repete, sem timeout maior
- [x] `workers` decidido **com medição** (`1` mantido; o `2` piorou 70% por cenário) e config intacta
- [x] Ferramenta de limpeza com **dry run por padrão**, recusa em produção e preservação nominal provada
- [x] A regra de independência de spec escrita no `helpers.ts`
- [x] O ranking mascara quem foi ocultado **sem tirar a posição**, e a régua interna × pública ficou escrita
- [x] A elevação do escuro é por tom, com catraca de ordem de luminosidade provada por mutação
- [x] O modo claro não mudou (tokens de superfície presos na catraca) e o contraste dos dois modos segue passando
- [x] `lint`, `typecheck`, `npm test`, `build` e a suíte E2E verdes (com o vermelho de terceiro declarado)
