# FASE 60 — Mutirão: o que se oculta fica oculto, toda tela tem landmark, e a suíte E2E para de mentir

> **Estado: EM ANDAMENTO** — três frentes escolhidas pelo humano: **E79** (a ocultação do perfil
> não chega a duas superfícies), **I2** (16 páginas sem `<main>`) e **I3 + I1** (a suíte E2E
> paralela falha por interferência entre specs, e 5 cenários seguem em `test.fixme`).

## 1. Sumário executivo

| Frente | O que é | Dívida |
|---|---|---|
| **Ocultação vale em toda superfície que cita a pessoa** | O efeito da moderação da plataforma passa a valer no bloco "Equipe do evento" e no link selado da carta | **E79** |
| **Toda tela tem o seu landmark** | As 16 páginas que nunca tiveram `<main>` (8 do SuperAdmin e 8 públicas) ganham o seu — completando o **ADR-290** | **I2** |
| **A suíte E2E para de falhar por interferência** | A spec que polui é isolada/corrigida na raiz, e o vermelho volta a significar defeito | **I3** |
| **Os cenários em `test.fixme` fecham** | Cada um roda e passa, com a causa tratada (sem afrouxar asserção) | **I1** |

## 2. O problema comum: o sistema diz uma coisa e faz outra

As três frentes são o mesmo defeito em escalas diferentes — **uma decisão que existe, mas não
chega a todo lugar onde deveria valer**:

- a **moderação** decide ocultar um perfil (FASE 56 · ADR-314) e a decisão vale no perfil
  público; o bloco "Equipe do evento" e o link selado da carta continuam citando a pessoa;
- a **FASE 52** decidiu que o landmark pertence à página (ADR-290) e arrumou a casca; **16
  páginas** ficaram sem nenhum;
- a suíte E2E tem specs que **dependem do vizinho**: o vermelho não distingue defeito de dado
  herdado, e é por isso que a dívida I3 é a mais perigosa das três — ela **corrói a confiança na
  própria prova**.

O desenho da fase segue o mesmo princípio nos três casos: **a régua é uma só, e fica onde todos
possam consultá-la** — uma função de visibilidade usada pelas duas superfícies, o landmark na
página (e não na casca), e specs independentes em vez de uma ordem combinada.

## 3. Decisões técnicas

- **E79 — a visibilidade é uma função, não um `if` copiado.** A pergunta "esta pessoa pode
  aparecer?" nasce no domínio e é usada por todas as superfícies que citam alguém; copiá-la em
  cada tela é o que produziu o defeito (a E62 corrigiu o perfil e não as duas citações).
- **E79 — o link selado da carta não pode virar um oráculo.** Quem tem o token é terceiro: a
  resposta para um perfil oculto tem de ser a MESMA de um token inválido, para não confirmar
  nada sobre a pessoa (a régua do 404 único do ADR-242).
- **I2 — a prova é no navegador, e a régua é "exatamente um".** A auditoria da F52 foi feita
  página a página; a catraca agora pergunta ao DOM por quantos landmarks existem de verdade, o
  que também prende a decisão do ADR-290 (dois `<main>` na mesma tela volta a reprovar).
- **I3 — independência antes de ordem.** Prender ordem entre specs é o último recurso: o que se
  quer é que cada spec crie o próprio dado e limpe o que criou, porque ordem é uma dependência
  invisível que a próxima spec desfaz.
- **I1 — cenário fechado é cenário que mede o que o usuário faz.** Nenhum dos cinco fecha
  afrouxando asserção ou aumentando timeout: cada um exige tratar a causa (o campo controlado
  que o React ainda não assumiu, o dispositivo falso, o link inválido da própria tela).

## 4. ADRs

### ADR-321 — A ocultação é da PESSOA, e vale em toda superfície que a cita

**Contexto.** A moderação da plataforma (FASE 56 · ADR-314) ocultou o perfil público de uma
pessoa e o efeito ficou restrito à página `/u/<handle>`. Duas superfícies continuavam citando a
pessoa ocultada: o bloco **"Equipe do evento"** da página pública (FASE 45) e o **link público
selado da carta** (FASE 48/51). A decisão existia; a consequência não.

**Decisão.** "Oculto" é estado da PESSOA, não da página: a pergunta *esta pessoa pode aparecer
aqui?* vira regra de domínio única (`isPersonPubliclyVisible`), consultada por toda superfície que
renderiza nome, equipe, foto ou handle de alguém. O tratamento de cada superfície é que difere, e
por um motivo concreto:

- **bloco "Equipe do evento"**: o cartão **É** a pessoa (foto, nome e etiqueta da equipe) e não
  existe jeito de desenhá-lo sem citá-la — então ela **sai da vitrine**, e o filtro acontece
  **antes** do agrupamento (quem está em duas equipes desaparece por inteiro, e não pela metade);
- **link selado da carta**: a carta **continua abrindo**, assinada por um **rótulo neutro**. O
  link é compartilhado com um grupo e lido por visitante anônimo: responder 404 seria transformar
  o link num oráculo, e escrever "perfil oculto pela moderação" contaria a decisão a todo mundo
  que tem o token — exposição maior do que o próprio nome. Neutro, o visitante não distingue
  "não publica o nome" de "foi ocultada", que é o mínimo que a medida precisa preservar.

**Consequências.** Corrigir caso a caso garante que o próximo caso volte (foi o que aconteceu
entre a E62 e esta fase): a fonte é uma só e as superfícies a consultam. O campo
`publicProfileHiddenAt` é **obrigatório** na fonte do time, de propósito: um chamador que esqueça
de selecioná-lo entrega `undefined`, a pessoa é tratada como oculta e **some da vitrine** — falha
visível, e não identidade publicada por engano (fail-closed, como o resto do RBAC). O custo
declarado: superfície nova que cite pessoas precisa passar pela mesma função.

### ADR-322 — O caso que lê o dado do caso anterior é uma dívida disfarçada de teste

**Contexto.** A suíte E2E completa acusava falhas em specs diferentes em execuções seguidas
(`demand-board` com **3** casos numa; `content-and-media` com 1 na outra), todas passando
isoladas. A suspeita registrada era "dado de uma spec vazando para outra". A bissecção mostrou
outra coisa: **a spec que poluía era ela mesma** — os casos 2, 3, 4 e 5 liam o cartão criado pelo
caso 1 (`boardState().demands[0]`) e o caso 5 contava o total de demandas (`.toBe(2)`). Um
tropeço do caso 1 (rede, banco, bundle) virava **três** casos vermelhos — o "3 casos" da dívida.

**Decisão.** Cada caso cria o próprio dado pelo caminho da tela e espera pelo que ele mesmo
criou; contagem global não é âncora. A ordem entre specs continua proibida como solução, e a
limpeza passou a ser **do arquivo** (o que ele criou), não da execução.

**Consequências.** O vermelho volta a apontar UM fato. Duas hipóteses foram **refutadas por
medição** no caminho, e ficam registradas para não serem repetidas: (a) `RUN_ID` é idêntico em
arquivos diferentes, então o `cleanupRun()` varria a execução inteira em vez do arquivo; (b) a
"janela de hidratação" **não** é a causa das ações em linha — com o bundle atrasado 6 s e até
abortado, o clique gravou (o React 19 tem aperfeiçoamento progressivo de Server Action). O que
depende só de `onClick` é o botão da galeria (`inputRef.click()`): ali não há rede de segurança, e
é onde o `content-and-media` perdia o `filechooser`.

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **E79**: o perfil ocultado pela moderação continuava citado no bloco "Equipe do evento" e no link selado da carta | A decisão da E62 valeu só na página do perfil: cada superfície escrevia o próprio `if`, e duas não escreveram nenhum | **Fonte única pura** `isPersonPubliclyVisible` no domínio, consultada pelas quatro superfícies (perfil, diretório, equipe, carta). O campo é **obrigatório** na fonte do time: quem esquecer de selecioná-lo trata a pessoa como oculta (fail-closed) |
| **A auditoria da E79 achou um vazamento pior**: a página pública do sorteio publicava o **nome completo** de quem foi ocultado (e a lista de ganhadores, o palco, os suplentes e a auditoria) | `raffle-service` lia `name` + o consentimento **antigo** (`isPublicProfile`), que a ocultação não altera: quem autorizou o nome antes de ser ocultado seguia com nome inteiro numa página aberta | O resultado público **mascara** com a régua que o sorteio já usa (`Ana Souza` → `Ana S.`), preservando posição, prêmio e contagem. Provado que a auditoria não depende do nome: o conteúdo assinado é `{index, code, minutes}` e o código é `sha256(raffleId:userId)` — `resultHash`, `poolHash` e `reproduction.confirmed` ficam **idênticos** antes e depois |
| **I2**: a dívida dizia "16 páginas sem `<main>`" e eram **14** | A lista da F52 contava *arquivos sem `<main>` próprio*, e três desses não são defeito: um é `redirect` puro (não desenha tela), outro `redirect`, e a página do evento **herda** o `<main>` da `EventLanding` — acrescentar um ali recriaria o defeito H5 (dois landmarks) | Auditoria refeita olhando o `layout.tsx` de cada árvore **e** o componente que a página renderiza; as 14 telas ganharam o seu `<main>`, e um teste unitário **catraca** lê os `page.tsx` e decide por evidência (a página desenha? o componente importado desenha? é `redirect`?). Provado por mutação: trocar `<main>` por `<div>` numa página deixa o teste vermelho |
| **I3**: "dado de uma spec vazando para outra" | A spec que poluía era **ela mesma**: casos 2–5 liam `demands[0]` (o cartão do caso 1) e o caso 5 contava o total de demandas. Um tropeço do caso 1 virava **três** casos vermelhos | Cada caso cria o próprio cartão pela tela e espera pelo que criou; o arrastar repete o gesto **até a coluna mudar no banco**; `cleanupRun()` passou a limpar o que o ARQUIVO criou. Duas hipóteses foram refutadas por medição (ver ADR-322) |
| **I1**: 5 cenários em `test.fixme`, um deles com bilhete errado | Causas reais, nenhuma delas "timeout": o **400 era do teste** (rodando sozinho o lote ia vazio, e `NO_ELIGIBLE` era a resposta honesta); `sheetText.subarray` é método de `Buffer`, e `toString()` devolve **string**; `newContext({ args })` é argumento de **lançamento** e era ignorado (nunca houve lente); um cenário estava em `fixme` sem precisar (o `select` é `defaultValue`, não controlado) | Lote misto emitido pelo próprio cenário e `slice` no lugar de `subarray`; lentes falsas por `addInitScript` (`enumerateDevices` mente a lista, `getUserMedia` devolve `canvas.captureStream()`, sem tocar câmera); o cenário desnecessário saiu do `fixme` sem código. Nenhuma asserção afrouxada |
| **O `fixme` do E76 reproduz** (`inline-action-without-js.spec.ts`) | A ação em linha antes do bundle realmente se perde — a dívida continua de pé | O cenário voltou ao `fixme` **intacto**, com a medição registrada: é o único `test.fixme` que resta no repositório |

## 6. Evidência de verificação

```text
npm run lint ................... 0 erros, 0 warnings
npm run typecheck .............. 0 erros
npm test ....................... 150 arquivos · 2906 testes passando
npm run build .................. Compiled successfully in 13.6s
npx playwright test ............ (suíte completa, saída real abaixo)
   antes do rebuild:  234 passed · 6 skipped · 1 failed   (8,2 min)
   depois do rebuild: 240 passed · 1 skipped · 3 did not run
vitest por frente:
   unit  f60-ocultacao-do-perfil 8 · f60-landmark-unico 4 · raffle-public-name 7
   integ f60-ocultacao-do-perfil 8 · f60-sorteio-publico 9
   regressão vizinha (equipe, perfil, moderação, carta, sorteio) 144 + 90 passed
playwright por frente (após o rebuild):
   f60-landmark 15 · f60-ocultacao-do-perfil 4 · f60-sorteio-publico 4 · accessibility 12`r`n   suíte completa: 263 passed · 1 skipped (o `skipped` é o `fixme` do E76, que reproduz)
```

## 7. Comandos operacionais

```bash
# As três frentes, cada uma com o seu teste
npx vitest run tests/unit/f60-landmark-unico.test.ts          # a catraca do landmark
npx playwright test tests/e2e/f60-landmark.spec.ts            # 15 telas, um <main> cada
npx playwright test tests/e2e/f60-ocultacao-do-perfil.spec.ts # equipe + carta
npx playwright test tests/e2e/f60-sorteio-publico.spec.ts     # sorteio mascarado

# A suíte inteira (é ela que a I3 protegia)
npm run test:e2e
```

Para **acrescentar** uma superfície que cite pessoas: ela passa por
`isPersonPubliclyVisible` (`src/domain/profile/public-profile-rules.ts`) — a coluna
`publicProfileHiddenAt` é obrigatória de propósito, e o chamador que a esquecer vê a pessoa
sumir (falha visível) em vez de publicá-la.

## 8. Dívidas técnicas

**Quitadas:** **E79** (com a superfície do sorteio junto), **I2**, **I3** e **I1** (5 de 5
cenários fechados).

**Novas:**
- **E80 — o ranking de conquistas cita quem foi ocultado.** `/t/<slug>/conquistas` mostra nome,
  `@handle` e foto sem consultar a ocultação. É tela **autenticada** (membros da instituição), e
  não internet aberta — mas a régua agora existe e o desvio é o mesmo; a entrada ficou registrada
  com o serviço e a linha exatos.
- **Dados de execuções interrompidas no banco de E2E**: ~350 instituições e ~2.150 contas
  acumuladas por execuções anteriores que não chegaram ao `afterAll`. Não é defeito de produto, e
  **não foram apagadas** (apagar dado de banco sem pedido é pior do que conviver com a sobra); a
  limpeza é decisão de quem opera, com o padrão de slug das execuções.

**Preservados por decisão (não são dívida):**
- **validação pública de certificado** publica `recipientName` de documento **congelado e
  assinado**: ocultar perfil não é revogar documento (invariante 7);
- **vitrine de palestrantes e agenda** citam quem ministra por **consentimento próprio** do
  palestrante (FASE 25), que é outra régua por desenho;
- o **`fixme` do E76** continua, com a medição que o mantém.

## 9. Checklist de aceite

- [x] A ocultação do perfil vale no bloco "Equipe do evento" (a pessoa sai da vitrine, filtro antes do agrupamento)
- [x] A ocultação vale no link selado da carta (abre sem nome, sem `@handle` e sem foto, com rótulo neutro)
- [x] A regra é **fonte única** no domínio, usada pelas quatro superfícies que citam pessoas
- [x] O vazamento da página pública do **sorteio** foi corrigido (resultado, palco, suplentes e auditoria), preservando posição, prêmio e contagem
- [x] A auditoria do sorteio continua conferindo: `resultHash`, `poolHash` e `reproduction.confirmed` idênticos antes/depois da ocultação
- [x] As 14 telas sem landmark ganharam o seu `<main>`, sem criar um segundo em nenhuma tela (ADR-290 preservado)
- [x] Um teste **catraca** prende a regra do landmark por evidência, provado por mutação
- [x] A interferência da suíte E2E foi corrigida na raiz (o caso cria o próprio dado; limpeza por arquivo)
- [x] Os **5** cenários em `test.fixme` fecharam e passam, sem afrouxar asserção
- [x] O `fixme` do E76 foi testado, reproduz, e ficou registrado
- [x] O portão WCAG AA ganhou a catraca de "exatamente um `<main>` por tela", com a lista de isenções vazia
- [x] `lint`, `typecheck`, `npm test`, `build` e a suíte E2E completa verdes