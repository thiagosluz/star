# FASE 78 — o topo único (PLANO)

> **Estado: plano escrito a partir do inventário medido.** Aguarda `APROVADO: AVANÇAR`.

## O diagnóstico

**96 `page.tsx` + 6 arquivos de erro. 12 formatos de topo diferentes. 9 páginas (9,4%) usam o
`PageHeader`; 87 não.** A regra está escrita desde a F11 (`docs/design-system.md` §5: "Toda tela
começa por `PageHeader`"; §7: "não monte cabeçalho") — e a dívida **H1** ("cabeçalhos ainda escritos
à mão") está aberta desde então. **Não é deriva: é um mutirão interrompido** (F11B: "migração
incremental, tela a tela, sem fase dedicada").

**Os 12 formatos**, medidos: `PageHeader` 9 · eyebrow+ícone 15 · volta+h1 20 · só h1+subtítulo 8 ·
h1+ícone 3 · `SectionHeading` como título (**sem `<h1>`**) 6 · hero público 7 · público com eyebrow 7 ·
tema do evento 7 · auth 6 · estado/institucional 6 · redirect 2.

**O sintoma do print, medido:** o nome da instituição aparece em **25 páginas, em 3 lugares
diferentes** — badge ao lado do título (3), eyebrow (17) e dentro do texto (5).

## O que está errado além da aparência

- **6 páginas não têm `<h1>`** (api, dados, formulário, programação, reconhecimento, salas): usam
  `<h2>` como título. Não é violação automática do axe, mas quebra a navegação por cabeçalhos.
- **15 dos 33 links "←" não nomeiam o destino** ("← Painel" ×4, "← Voltar" ×1, outros genéricos).
- **`text-headline` não existe** no CSS nem no `DESIGN.md` — usado em 4 telas (conta, esqueci-senha,
  redefinir-senha, dois-fatores), que renderizam o título em 16px. Os topos mais fora de todos.
- **Strings soltas no topo**: "Minha participação" duplica o título do grupo do menu; "Organização",
  "Expansão Institucional", "EventFlow", "Instituição" idem.
- **O `design-system.md` mente**: §10 fala de "doze snapshots"; existem 23.

## A forma única

**`PageHeader` evoluído** — mesmo nome e export, movido para arquivo **server**. Critérios: (1) é a
regra já escrita, então padronizar nele **cumpre a regra e fecha a dívida H1**; (2) é o
**superconjunto** dos outros 11; (3) `text-title-lg` (28px) já é o token "título de página" do
`DESIGN.md` e o que as 6 páginas de erro usam.

**Slots:** `title` (obrigatório, o `<h1>`); `eyebrow` (opcional); `icon` (opcional, **irmão** do `<h1>`,
`aria-hidden`); `breadcrumbs` (obrigatório em tela de detalhe); `description`; `badge` (**só estado**:
"Exemplo", "SuperAdmin"); `actions`.
**A volta é DERIVADA da trilha, sem prop** — é o que mata o "← Painel" e dá nome acessível ao link.
**Sem `variant`**: painel é o padrão; auth usa o mesmo sem trilha; público mantém o renderizador do
tema (decisão da F64, não deriva).

### Uma decisão que eu preciso declarar (e que é reversível por uma linha)
**O eyebrow é o grupo de navegação** ("Minha participação", "Operação", "Comitê científico") — **não**
o nome da instituição. Motivo: a casca **já mostra** o nome no topo da barra lateral (está nos 10
prints); repeti-lo gasta a única linha que poderia dizer **onde a pessoa está**. Fonte única em
`tenant-nav.tsx`, o que elimina a string duplicada de `meu-perfil-publico:104`.
O nome da instituição sai do badge das 3 telas que o têm (administração, equipe, comunicação) e passa
a ser mostrado **uma vez**, na casca — onde já está.

## As fatias

1. **O componente** — separar `PageHeader`+`Breadcrumbs` do arquivo client para `ui/page-header.tsx`
   (server), implementar os slots, a trilha derivada e o badge de estado; mostrar em
   `/superadmin/design`; testes de unidade (slots, trilha, a11y: 1 `<h1>`, eyebrow `<p>`).
2. **Painel e participante (~45 telas)** + as **11 linhas de baseline do painel re-baseadas no mesmo
   commit**, com o motivo escrito e as imagens olhadas.
3. **Plataforma, auth e estado (16 telas)** — incluindo tirar o `text-headline` inexistente e dar
   `<h1>` às 6 telas que só têm `<h2>`.
4. **Público (21 telas)** + as 6–8 linhas de baseline restantes.
5. **A catraca, o par de E2E, o documento e a bateria** — fechar a dívida **H1** no
   `docs/dividas-tecnicas.md`, corrigir o `design-system.md` (23 snapshots), e o par obrigatório:
   `f78-topo-unico.test.ts` (fonte: teto 0 de `<h1`/`<header` nas páginas + presença do `PageHeader`,
   com allowlist motivada) **e** um E2E de ~12 telas com `h1 === 1`, `header h1 === 1` e o eyebrow como
   `p`.

## Invariantes

- **A catraca de fonte não prova o renderizado.** Ela reprova página que desenha o próprio topo; **não**
  garante que o header renderizado é o componente — por isso o par de E2E é obrigatório.
- **Nada de `<h1>` some nem dobra.** Os **12 `data-testid` em `<h1>`** ficam (tenant-page-title,
  profile-name, card-title, call-title, speaker-name, audit-title, raffle-result-title,
  stage-off-title, demand-detail-title, verification-title, tenant-detail-name, shared-card-title), e
  as ~13 asserções de nome acessível continuam valendo.
- **O eyebrow não é heading** — é `<p>`, e fica fora do `<h1>` (senão o nome acessível vira o texto do
  eyebrow colado ao título).
- **Re-baseline é ato declarado**: motivo por commit, imagem olhada, duas execuções medindo zero pixel
  — e **sem mascarar o topo**.
- **A dívida só encolhe**: a catraca usa o `ratchet()` que já existe no `design-system-guard`.

## O que fica fora, de propósito

- **Os 7 heroes de marketing** (`/eventos`, `/para-instituicoes`, a home): são páginas de venda, com
  desenho próprio, e não têm "gestão" no topo. Se o humano quiser, é uma fatia à parte.
- **O tema do evento** (7 telas) e a **página da casa** (F64): renderizador próprio por decisão
  registrada (ADR-324/325). A catraca os allowlista com o motivo.
- Os **redirects** (2): não têm tela.
