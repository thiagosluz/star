# FASE 59 — O item do patrocinador e a barra lateral que recolhe

> **Estado: EM ANDAMENTO** — dois pedidos do humano na mesma rodada: (1) o item "Área do
> patrocinador" aparecia para quem não tem vínculo, e (2) a barra lateral precisa de uma
> opção de colapsar.

## 1. Sumário executivo

| Entrega | Onde |
|---|---|
| **Defeito corrigido**: o item do menu passa a depender do VÍNCULO, não da permissão | `src/components/shell/tenant-nav.tsx` + `src/app/t/[tenantSlug]/(app)/layout.tsx` |
| Regressão presa em teste (o arquivo não cobria este item) | `tests/unit/tenant-nav-sponsor.test.ts` |
| **Recurso**: barra lateral colapsável, com o estado em cookie e sem depender de JavaScript | `src/components/shell/app-shell.tsx` + ação do cookie + `layout.tsx` |
| Regra do cookie (pura) e prova no navegador | `tests/unit/nav-mode.test.ts` · `tests/e2e/f59-nav-colapsavel.spec.ts` |
| O painel **recolhido** entra no portão WCAG AA | `tests/e2e/accessibility.spec.ts` |

## 2. O defeito: permissão respondendo a pergunta do VÍNCULO

O relato veio com duas telas: uma pessoa **REVIEWER** e outra **OWNER** vendo "Área do
patrocinador" no grupo *Minha participação* — e, no clique, a própria página respondendo
*"Você não está vinculado a nenhum patrocinador desta instituição."*

A causa é uma linha:

```ts
const isSponsor = holdsPermission(principal, PERMISSIONS.SPONSOR_READ);
```

`sponsor:read` está no **pacote mínimo de quem participa** — é ela que permite a PÁGINA da
área ser aberta para mostrar o convite de quem ainda não tem vínculo. Usá-la para decidir o
**item do menu** faz o item aparecer para todo mundo, inclusive para quem organiza.

As duas perguntas são diferentes e o código confundia as duas:

- **permissão** — *"pode entrar?"* (abre a porta; o convite vive atrás dela);
- **vínculo** — *"tem algo lá dentro?"* (é o que o menu deve mostrar).

A área do patrocinador é aberta por **vínculo** desde a FASE 42 (`sponsor_users` com
`status = ACTIVE` e `deletedAt IS NULL`), e é essa a fonte que a própria página consulta. O
menu passou a usar a MESMA fonte (`listSponsorAccess`), com o convite pendente como segunda
porta — o desenho que o comentário do código já descrevia e que a implementação contrariava.

**Por que passou por três fases:** o `tenant-nav.test.ts` da FASE 25 nunca cobriu este item.
A regra existia sem catraca — e a fase anterior (F58) tinha acabado de mostrar o valor de
prender a REGRA, não só a tela.

## 3. O recurso: recolher a barra

A barra do painel ocupava 288 px fixos. O pedido é poder encolhê-la para uma **trilha de
ícones** — o que muda o desenho em três pontos:

- **o estado é do SERVIDOR, não do cliente.** Ele vive num cookie (`ef_nav`), lido no layout:
  a página chega desenhada no estado certo, sem "piscar" aberta e fechar depois, e sem
  JavaScript o botão continua funcionando (é um formulário com Server Action). Estado só no
  cliente perderia a persistência entre navegações, que é o ponto do recurso;
- **a trilha precisa de NOME.** Ícone sozinho não tem nome acessível, e o portão WCAG AA não
  tem isenções (FASE 52): cada link guarda o rótulo para leitor de tela e ganha `title` para
  o ponteiro. Foi por isso que a barra recolhida entrou no portão como um cenário próprio;
- **mobile não muda.** Em tela pequena a barra já é outra coisa (`mobile-nav`), e o recurso
  vale para a barra fixa do painel.

## 4. ADRs

### ADR-319 — O menu mostra o que a pessoa TEM, não o que ela PODE

**Contexto.** O item "Área do patrocinador" aparecia para revisor, dono e qualquer
participante porque a condição era `sponsor:read` — permissão do pacote mínimo, necessária
para a página aceitar o convite.

**Decisão.** O item do menu é decidido pelo **vínculo** (`sponsor_users` ativo, a mesma fonte
que a página usa) ou pelo **convite pendente**. A permissão continua sendo a porta da página,
e não o critério do menu.

**Consequências.** O menu deixa de prometer o que não existe: quem não tem vínculo não vê o
item, e quem foi convidado vê "Convite de patrocinador" (a segunda porta, que o desenho da
FASE 42/25 já previa). A regra vale como padrão para os próximos itens: **permissão abre
porta; vínculo (ou fato) decide se há o que mostrar** — e item novo de menu nasce com teste
unitário no `buildTenantNav`, que é onde a regra é barata de prender.

### ADR-320 — O estado da barra vive em COOKIE, e a trilha mantém o nome acessível

**Contexto.** Uma barra colapsável pode guardar o estado no cliente (`useState`,
`localStorage`) ou no servidor (cookie). A escolha define três coisas: o que acontece sem
JavaScript, se o estado sobrevive à navegação e se a página "pisca" ao abrir.

**Decisão.** O estado vive no cookie `ef_nav` (`full` | `rail`), lido no layout e aplicado na
renderização; o botão é um formulário com Server Action (funciona sem JS) e o valor
desconhecido cai em `full`. Na trilha, cada item mantém **nome acessível** e `title`.

**Consequências.** A barra chega desenhada no estado certo, a escolha sobrevive à navegação e
nada depende de JavaScript. O custo é uma re-renderização do layout a cada clique (o cookie é
lido no servidor) — aceitável para um gesto que a pessoa faz uma vez por sessão — e a
obrigação de testar a trilha no portão de acessibilidade, porque ícone sem nome reprova.

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **O relato**: "Área do patrocinador" na barra para REVIEWER e OWNER, e a página respondendo "não está vinculado" | `isSponsor = holdsPermission(principal, SPONSOR_READ)` — e `sponsor:read` está no **pacote mínimo** de quem participa (é a porta da PÁGINA, que precisa abrir para mostrar o convite). O menu fazia a pergunta da permissão quando a pergunta era do VÍNCULO | O menu passou a usar `listSponsorAccess` (a MESMA fonte que a página usa) + o convite pendente como segunda porta (ADR-319) |
| **A regra existia sem catraca**: o `tenant-nav.test.ts` da FASE 25 não cobria este item, e o defeito sobreviveu a três fases | Testar o menu pelo que ele MOSTRA para um papel não cobre item que depende de FATO do banco (vínculo, convite). O caso "tem a permissão e não tem o fato" não existia em teste nenhum | `tests/unit/tenant-nav-sponsor.test.ts` nasce com o caso que quebrou (`PARTICIPANT`/`OWNER`/`REVIEWER` **sem vínculo** → item ausente), os dois sentidos do vínculo e a precedência vínculo > convite |
| **O E2E da barra falhava no `aside[data-nav]` depois de clicar em "Eventos"** | O item "Eventos" leva à página PÚBLICA da instituição, que tem outro layout e não tem barra lateral: a asserção media a tela errada, e o teste acusava o recurso | A navegação do cenário passou a ser para DENTRO do painel ("Minhas inscrições") — a persistência só pode ser medida onde a barra existe |
| **A trilha de ícones é uma superfície nova para o portão**: ícone sem nome acessível reprova com `link-name` | Encolher a barra esconde o TEXTO — e o texto é o nome do link para leitor de tela | Cada item mantém o rótulo em `sr-only` + `title`, o botão diz a AÇÃO ("Recolher"/"Expandir") com `aria-expanded`, e a varredura da barra RECOLHIDA entrou no portão (12 testes, `ISENCOES` vazia) |

## 6. Evidência de verificação

```text
npm run lint ................... 0 erros, 0 warnings
npm run typecheck .............. 0 erros
npm test ....................... 145 arquivos · 2870 testes passando
npx vitest run tests/unit/tenant-nav-sponsor.test.ts ..... 6 passed
npx vitest run tests/unit/tenant-nav.test.ts ............. 7 passed
npx vitest run tests/unit/nav-mode.test.ts ............... 6 passed
npx playwright test f59-item-do-patrocinador.spec.ts ..... 2 passed
npx playwright test f59-nav-colapsavel.spec.ts ........... 1 passed
npx playwright test accessibility.spec.ts ................ 12 passed (era 11)
```

## 7. Comandos operacionais

```bash
# O defeito: quem não tem vínculo não vê o item (a página continua alcançável)
/t/<slug>/patrocinador                     # mostra "não está vinculado…" para quem não tem vínculo

# A barra: recolher/expandir, com o estado no cookie `ef_nav` (full | rail, 30 dias)
#   • o botão fica no cabeçalho da barra (`data-testid="nav-collapse-toggle"`);
#   • funciona sem JavaScript (formulário + Server Action);
#   • apagar o cookie volta a barra ao estado inteiro.
document.cookie = 'ef_nav=; Max-Age=0; path=/'   # no console do navegador
```

## 8. Dívidas técnicas

Nenhuma dívida nova. Dois limites declarados:

- **o caminho sem JavaScript do botão** é o mesmo desenho do `signOutAction` (form + Server
  Action) e não tem teste com `javaScriptEnabled: false`; a prova indireta é que o estado vem
  do HTML do servidor — é o `page.reload()` do E2E que prende isso, e o ADR-320 registra a
  consequência;
- **a responsividade fina da trilha** (rótulos longos em janelas estreitas) não foi medida
  visualmente: a régua usada é o `data-nav` e a largura em px do rótulo.

## 9. Checklist de aceite

- [x] O item "Área do patrocinador" só aparece com **vínculo** ativo (`sponsor_users`) ou **convite pendente**
- [x] Quem só tem a permissão (`sponsor:read`) — participante, dono e revisor — **não** vê o item
- [x] A PÁGINA continua alcançável para quem tem convite (o conserto é do menu, não do acesso)
- [x] O rótulo segue a porta: "Área do patrocinador" (vínculo) × "Convite de patrocinador" (convite)
- [x] A regra está presa em teste unitário, incluindo o caso que quebrou
- [x] A barra tem dois estados (`full` × `rail`), com o estado no cookie `ef_nav`, lido no SERVIDOR
- [x] O estado **persiste** na navegação e no recarregamento (provado no E2E)
- [x] O botão funciona sem JavaScript e tem nome de AÇÃO + `aria-expanded`
- [x] Na trilha, todo item mantém nome acessível (`sr-only` + `title`)
- [x] O mobile não muda (`mobile-nav` intocado)
- [x] A barra recolhida entra no portão WCAG AA, com a lista de isenções **vazia**
- [x] `lint`, `typecheck`, `npm test` e os E2E das três frentes verdes