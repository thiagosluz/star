# FASE 77 — o organizador novo (PLANO)

> **Estado: ENTREGUE.** O plano abaixo foi escrito a partir da medição e as quatro fatias
> foram fechadas — o registro da entrega (ADRs 369–371, lições, evidências e pontos de
> atenção) está em [`fase-77-organizador-novo.md`](fase-77-organizador-novo.md).

## O diagnóstico

Três ideias pedidas para reduzir o "por onde começo?". Medido, **duas já existem em outra forma** e uma tem
problema de desenho. O trabalho desta fase não é construir as três: é **ligar o que já existe** onde a
pessoa procura, e **não construir** a que produziria dívida.

## Ideia 1 — o guia de partida · **vale, como recorte da prontidão, com outro nome**

A régua da prontidão tem **7 pendências** e **nenhuma delas é a página publicada**; um evento **vazio com
prazo de inscrição preenchido sai com ZERO pendências** ("Tudo em ordem", medido com a função real). E
`sem-programacao` só entra **quando o evento está no ar**, de propósito — rascunho tem programação vazia por
definição.

**Por que o guia de 3 passos como pedido contradiria o painel:**
- "Dados + Programação + Página" **não é** o critério do painel: um evento com os três ainda pode ter
  `inscricoes-sem-prazo` e, no ar, `sem-inscricao`;
- e um evento **sem página e sem atividade** pode sair com **zero pendências** — dois sinais opostos na
  mesma tela. O organizador novo aprende a não confiar em nenhum dos dois;
- um guia com "Programação" no passo 2 marcaria pendência **num rascunho**, onde o painel cala.

**O que fazer:** uma função de domínio nova, `eventLaunchPath`, com **3 fatias e os fatos que o render já
tem** (`registrationHasDeadline`, `activityCount > 0`, `pagePublished`) — **zero consulta nova**. Rótulos
honestos: **"Dados e prazos · Programação · Página no ar"**. "Dados Básicos" prometeria validar nome, data e
local — que o formulário já exige e o sistema não confere em lugar nenhum. **A palavra "pronto" não entra.**
Renderizar **dentro da seção de prontidão, acima da lista** (a raiz tem 377 linhas, 5 `<section>` no DOM e 17
cartões; uma 6ª seção empurraria os 7 cartões de Configurar para baixo da dobra). E **não é um guia de links**:
as três áreas já são cartões do mapa; um guia estático seria o mapa com menos informação.

**Não** acrescento a página como 8ª pendência da régua: mudaria a filosofia declarada da F53 e faria o guia
virar recorte puro de um painel que agora cobra o que ele nunca cobrou. Fica como ponto declarado.

## Ideia 2 — a exportação de segurança · **vale, e o dado é a obra**

**A exportação existe inteira desde a F49** e é boa: pedido com **prazo de 24 h**, marca d'água no topo **e em
cada linha**, 5.000 linhas, revogação, download por sessão (410 se vencida), trilha `CREATE`/`EXPORT`/`DELETE`
com IP e "quem baixou". O painel é um componente **sem JavaScript**, reaproveitável com 3 props.

**O que falta, medido — e são duas coisas:**

1. **Lugar (barato).** Não há entrada na raiz do evento; quem quer os inscritos de **um** evento sai da tela
   do evento, vai ao diretório, escolhe no `<select>` — e o diretório **esconde eventos em `DRAFT`**, então o
   evento recém-criado nem aparece lá. Um `<ExportPanel kind="PARTICIPANTS_CSV" filters={{ evento }}>` na raiz
   resolve o alcance.

2. **Dado (caro, e é o que impede o botão de mentir).** Hoje `?evento=` filtra **quem aparece**, mas as
   colunas — Inscrições, Presenças, Visitas, Minutos, Comparecimento, Certificados, Cartas, XP — vêm de
   agregações **por instituição**, sem `eventId`. Um CSV "do evento" entrega as pessoas daquele evento com a
   **vida inteira delas** na instituição: o organizador lê "Presenças: 12" achando que é do evento. E **não há
   presença por atividade** no CSV: o dado bruto existe em `attendances.activityId` (com índice), mas não há
   projeção que o entregue. **Botão novo sobre número errado piora** — dá cara de recorte a um total global.

**Fazer:** o botão **e** a projeção por evento (as colunas passam a respeitar o evento) **e** a presença por
atividade. **Excel: não adicionar dependência** — não há biblioteca de planilha no projeto (nem `pdf-lib`; o PDF
e o ZIP são escritos à mão) e o **CSV com BOM já abre no Excel pt-BR**, que é a razão declarada do BOM. Se
alguém quiser `.xlsx` nativo um dia, o escritor de ZIP já existe e OOXML é ZIP de XML — sem dependência nova.

## Ideia 3 — o modo demonstração de 1 clique · **não vale como proposto**

Três números matam:

- **29 das 43 tabelas** que o dataset toca **não têm `deletedAt`** — presença, XP (livro-razão append-only),
  certificados, salas, demandas, versões de página, papéis (só `revokedAt`), `audit_logs` (particionada);
- **não existe exclusão de evento no produto** (`ARCHIVED` é status e **não libera quota**), e o guarda de
  atividade **recusa** apagar quando há presença — o sistema já decidiu que registro com presença não se apaga;
- a quota de eventos do próprio tenant demo é **3** (o seed grava o plano PROFESSIONAL e não as quotas): "40
  eventos" é impossível e "alguns" fica **irremovível**.

Agravantes: `xp_transactions`/`user_cards` têm `eventId` **`SET NULL`** — apagar o evento deixa XP e cartas no
extrato/álbum da pessoa para sempre; e `audit_logs.tenantId` é `SET NULL`, então a trilha **sobrevive órfã**.
O que apareceria: a trilha de `/administracao` mostra as últimas **15** — 40 eventos falsos escondem a real por
dias; a lista de eventos pega 100 e ensina a ignorar o painel de prontidão; `/panorama` e `/superadmin` passam
a mentir sobre a plataforma inteira.

**A alternativa que cabe: demo de LEITURA.** Dados fixos, tipados, renderizados por uma tela — nada é gravado,
a RLS nem entra, e o custo é uma tela + fixtures + uma catraca que reprova qualquer ação de escrita nela. É o
precedente da casa do "1 clique cria exemplo" (`seedRecommendedBlocks`: só com a página vazia, auditado e com
versão) sem tocar no dado real.

## As fatias

1. **O caminho de partida** — `eventLaunchPath` puro (3 fatias, fatos do render), a faixa na seção de
   prontidão, os rótulos honestos, e teste que prove que o guia **nunca** diz "pronto" junto do banner.
2. **A exportação no evento** — o botão na raiz; a projeção por evento (as colunas respeitam o `eventId`); a
   presença por atividade; `DRAFT` visível; e teste que prove que o CSV "do evento" **não** traz número global.
3. **O demo de leitura** — a tela com fixtures tipadas, entrada a partir do estado vazio, e catraca de
   "nenhuma escrita".
4. **O fechamento** — documento com ADR-369+, estado sob o teto do `AGENTS.md` (64.827 bytes hoje; **haverá
   condensação**), bateria completa.

## Invariantes

- **Um guia não pode discordar do painel.** Se discordar, um dos dois está errado — e o organizador vai
  acreditar no que for mais conveniente.
- **Número com rótulo de recorte tem de ser do recorte.** "Do evento" e "da instituição" não podem ter a mesma
  forma.
- **Demo não escreve no dado real.** Sem desfazer possível, não se cria.
- **O que já existe se liga; não se reescreve.**
