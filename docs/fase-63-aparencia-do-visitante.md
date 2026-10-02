# FASE 63 — A aparência do visitante

> **Estado: ENTREGUE** — o visitante **anônimo** passou a escolher a aparência, numa linha do
> **rodapé** das páginas públicas da plataforma. É a lacuna que a F61 deixou: o cookie, a leitura no
> servidor e a Server Action já existiam e já funcionavam para anônimo — faltava o **controle**.

## 1. Sumário executivo

| Entrega | Onde |
|---|---|
| **Um componente, quatro chamadas** | variante `public` em `src/components/theme/theme-choice.tsx`, chamada por `/` (`page.tsx:118`), `/organizacoes` (`organizacoes/page.tsx:273`), `/validar/<código>` (`validar/[code]/page.tsx:26`, nas **duas** respostas — recusa e veredito) e `/validar/lote` (`validar/lote/page.tsx:316`) |
| **Funciona sem JavaScript** | `<form>` + três `<button name="tema">`, o atual marcado por `aria-pressed`, rótulos de `THEME_MODE_LABELS` |
| **A escolha convive com a do dono do cookie** | o **mesmo** `ef_tema`: a preferência do visitante **sobrevive ao login**, sem duas verdades (ADR-330) |
| **Medição do `revalidatePath`** | mudou na **mesma resposta** nos três lugares — e a **ablação** mostrou que quem carrega a mudança é o cookie lido pelo layout raiz (rota dinâmica), não a revalidação |
| **Portão de acessibilidade** | a página pública entrou na varredura: **15 testes**, `ISENCOES` continua `[]` |
| **Regressão visual** | o rodapé público nos dois modos: **14 linhas de base** |

**A fase nasceu de uma imagem que o humano mandou:** numa aba anônima a página pública abriu escura
(era o sistema operacional) e ele não tinha como discordar. Estava certo pelo desenho da F61
("a plataforma pública segue o modo") e errado pelo produto: seguir não é escolher.

## 2. O problema mais difícil: três rodapés, uma verdade

O rodapé de cada página pública é um componente diferente, e a tentação era copiar o controle nos
três. Seriam três lugares para a mesma verdade divergir — o mesmo defeito que a E79 pagou caro
(régua copiada diverge). A decisão foi **uma variante** do componente que já existia, com a
justificativa escrita nele: `THEME_MODES`, o `aria-pressed`, o `name="tema"` e a Server Action
existem **uma vez** para as três superfícies (e continuam existindo uma vez para o menu de conta).

A variante pública troca `<fieldset>/<legend>` por `role="group"` + `aria-labelledby` apontando para
o texto **visível** (`Aparência:`): a linha do rodapé é uma só, e `legend` em linha depende do
layout especial que cada navegador dá ao `fieldset`.

## 3. Decisões técnicas

- **`aria-labelledby` no texto visível** em vez de rótulo escondido: quem enxerga e quem usa leitor
  de tela leem a mesma pergunta. O preço é que esse texto vira **nome acessível** e não pode ser
  esmaecido — o que virou catraca (abaixo).
- **A escolha é do COOKIE, não da sessão.** Sem usuário, o cookie é a única memória possível; com
  usuário, ele é a mesma memória. Duas chaves dariam duas verdades e uma pergunta sem resposta
  ("qual vale depois de entrar?").
- **A página do EVENTO fica de fora.** Ali o tema é do organizador (ADR-325) e a plataforma é
  visitante. O controle não foi colocado no `PublicFooter` (que envolve as páginas da instituição)
  — e um teste **prende** que a variante pública não entrou nesse layout.
- **A revalidação fica onde estava**, mesmo tendo sido provada desnecessária hoje: a ablação mostrou
  que a mudança chega pelo cookie + layout dinâmico, mas a linha é a única proteção se uma dessas
  páginas nascer estática. O comentário no código guarda as duas medições.

## 4. ADR-330 — O visitante escolhe, e a escolha é dele depois de entrar

**Contexto.** Sem sessão, o `<html>` obedecia apenas a `prefers-color-scheme`. O visitante não tinha
como discordar do sistema operacional — e a F61 declarou que as páginas públicas "seguem o modo",
o que descrevia o comportamento, não uma escolha.

**Decisão.** O controle de aparência entra no **rodapé** das páginas públicas **da plataforma**,
gravando no **mesmo** cookie `ef_tema` que a pessoa logada usa. A escolha do visitante **permanece**
depois do login; a página do evento do organizador não recebe o controle.

**Consequências.** Uma verdade só para a aparência (visitante e conta), sem migração e sem coluna
nova. O que fica declarado como limite: numa página de instituição/evento o visitante anônimo
**continua sem poder** discordar do tema — o rodapé da plataforma existe lá, mas quem manda no
desenho é a instituição (dívida **E84**).

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| O portão WCAG AA reprovou a página pública com **exatamente 1 violação**, no rótulo `Aparência:` (`text-muted`, **1,05:1** no claro e **1,08:1** no escuro) | **`--muted` não é token de TEXTO**: ele resolve em `--ef-surface-low`, a superfície de agrupamento. O rótulo estava pintado com a cor do fundo. E era o **único** uso de `text-muted` como cor de texto em todo o `src/` | `text-muted-foreground` → **8,93:1** (claro) e **10,43:1** (escuro), com dois comentários no componente: por que o token estava errado e por que o rótulo **não pode** ser esmaecido (é o `aria-labelledby` do grupo) |
| **A violação era resíduo de mutação, não defeito de produto** | O agente que prova as catracas foi instruído a "derrubar o contraste" para mostrar que o `axe` morde; ele mutou o rótulo e **morreu antes de desfazer**. Quem separou as hipóteses foi medir a **tinta dentro das linhas de base visuais** (`#464555`/`#c5c6d0`, o token correto), que foram capturadas **antes** da mutação | Correção aplicada (o token certo voltou) e o par **preso por catraca** nos dois modos, mais um caso que prende a causa raiz: token de superfície usado como texto reprova em `1,05`/`1,08`. A linha de base que **não muda quando a classe muda** é a pista: ou ela é mais antiga que o defeito, ou a classe nunca chegou a ser aplicada |
| O `--update-snapshots` deu **zero byte** de diferença depois da correção | As baselines nasceram com a tinta correta; a mutação veio depois | Nada regerado, e o cabeçalho do arquivo registra o que foi **medido** (SHA-256, comparação pixel a pixel independente) em vez de afirmar uma regeração que não houve |

## 6. Evidência de verificação

```text
npm run typecheck .................... exit 0
npm run lint ......................... exit 0 (0 erros, 0 warnings)
npm test ............................. (ver a bateria final do relatório)
npm run build ........................ (ver a bateria final do relatório)

testes da fase:
  unit  f63-aparencia-do-visitante .... 11  (o componente de verdade, por react-dom/server)
  unit  f61-contraste-dos-dois-modos .. 10  (era 9: o par do rótulo do rodapé + a causa raiz)
  E2E   f63-aparencia-do-visitante ....  6  (sistema escuro, SEM sessão, mesma resposta, reload,
                                             troca de página, e SEM JavaScript)
  E2E   accessibility ................. 15  (era 13: a landing e a validação pública entraram;
                                             ISENCOES continua [] e nenhum aviso de isenção saiu)
  E2E   f62-regressao-visual .......... 14  (era 12: o rodapé público nos dois modos)

medição do revalidatePath (E2E, marcador em window que morre em qualquer reload):
  / · /organizacoes · /validar/<código> .... POST 200 · sem recarregar: true · data-tema=claro
  ablação (linha comentada + container reconstruído) ... 6/6 continuaram verdes
  → quem carrega a mudança é o cookie lido pelo layout raiz (rota dinâmica); a linha fica por ser
    a única proteção se alguma dessas páginas nascer estática
```

## 7. Comandos operacionais

```bash
npm run dev                                    # http://localhost:3000 em aba anônima
# o rodapé traz: Aparência: [Claro] [Escuro] [Sistema]
npx playwright test tests/e2e/f63-aparencia-do-visitante.spec.ts
npx playwright test tests/e2e/accessibility.spec.ts        # 15 casos, sem isenções
npx playwright test tests/e2e/f62-regressao-visual.spec.ts # 14 linhas de base
```

## 8. Dívidas técnicas

**Nova — E84:** o visitante anônimo **não escolhe** a aparência nas páginas da **instituição/evento**.
O `PublicFooter` (assinatura da plataforma) aparece lá, mas o desenho daquela superfície é do
organizador (ADR-325): levar o controle para lá é decisão de produto (o tema do organizador deveria
obedecer à escolha do visitante? o controle vale só para a moldura da plataforma?), não um ajuste.

**Sem outra dívida nova.** A fase não toca banco, não cria migração e não muda token de cor.

## 9. Checklist de aceite

- [x] O visitante **sem sessão** escolhe a aparência nas páginas públicas **da plataforma**
- [x] O controle vive no **rodapé**, em **um componente só** (variante `public`), chamado por quatro páginas
- [x] Funciona **sem JavaScript** e marca o estado atual com `aria-pressed`
- [x] A escolha usa o **mesmo cookie** da pessoa logada e **sobrevive ao login**, sem duas verdades
- [x] A **página do evento do organizador ficou de fora**, com catraca prendendo isso
- [x] A mudança aparece **na mesma resposta** (medido nos três lugares) e a ablação explica o porquê
- [x] A página pública entrou no **portão WCAG AA**, **sem isenção nova** (o controle acusou contraste e foi corrigido por medição)
- [x] O rótulo tem o contraste **preso por catraca** nos dois modos, com o caso da causa raiz
- [x] O rodapé público entrou na **regressão visual** nos dois modos
- [x] `lint`, `typecheck`, `npm test`, `build` e os E2E da fase verdes
