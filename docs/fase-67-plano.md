# FASE 67 — Comunicação segmentada por fatos reais (PLANO aprovado)

> **Estado: EM ANDAMENTO.** Guarda as decisões do humano e o recorte das fatias, para o trabalho
> atravessar sessões sem depender da conversa. O documento da fase (`docs/fase-67-*.md`) nasce na
> entrega, com ADRs, lições, evidências e checklist.

## Decisões do humano (não reabrir)

1. **Onde mora**: **aba "Segmentos"** na tela de comunicação que já existe
   (`/t/<slug>/administracao/comunicacao`) — o histórico de envios fica no mesmo lugar.
2. **Como o filtro é montado**: **catálogo de condições** (todas precisam valer) **+ um "exceto
   quem…"** (exclusão). Nada de construtor booleano livre: a definição tem de ser explicável em uma
   frase e testável sem navegador.
3. **Descadastro ENTRA nesta fase**: link no rodapé da mensagem, **página sem login por token**,
   registro de quem saiu e quando, e o envio **pula** quem saiu. Caminho de volta (voltar a receber)
   também entra.
4. **Quem ocultou o perfil RECEBE** — a ocultação (F60/E79) é sobre **visibilidade pública**, não
   sobre receber o que é da instituição dela. A **máscara vale nas telas internas**: prévia, lista do
   segmento e CSV.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **Fundação** | Catálogo de segmentos como **regra de domínio pura** (id, rótulo, parâmetros, frase explicativa) + **catraca** de que toda condição tem construtor de consulta e vice-versa; avaliação sob `withTenant`; tabela de **campanhas** com o **snapshot da definição** (os fatos, não os ids) e a contagem; **uma linha por destinatário** no outbox existente com `dedupeKey` da campanha; tabela de **descadastro** por instituição (RLS + FORCE, token) |
| 2 | **A aba "Segmentos"** | Montar condições + "exceto quem", **ver a contagem antes de enviar**, **prévia mascarada**, escolher/escrever o texto (reusando os templates), **prévia com dados reais**, **enviar teste só para si**, disparar **em lotes** respeitando o limite de ritmo, e o **histórico de campanhas** |
| 3 | **Descadastro** | Link no rodapé, página sem login por token, registro de quem saiu e quando, envio que pula quem saiu, e o caminho de volta |
| 4 | **Catracas e documento** | Unidade (catálogo, composição, máscara), **integração de cada condição contra fatos reais semeados**, E2E (a aba e o descadastro), **portão WCAG AA** com as telas novas sem isenção, **regressão visual**, `docs/fase-67-*.md` (ADR-338+) e as atualizações de `README.md`, `AGENTS.md` e dívidas |

## O catálogo proposto (além dos três do pedido)

| Fato | Condição |
|---|---|
| Vaga | Inscritos numa **trilha**/atividade que **não confirmaram a vaga** · em **lista de espera** · com inscrição **cancelada** |
| Presença | Presentes pela manhã que **não voltaram à tarde** · inscritos que **nunca fizeram check-in** · **minutos acumulados** abaixo de um limite |
| Acadêmico | **Autores com submissão aprovada sem material enviado** · revisores **com parecer pendente** · propostas **em rascunho** |
| Vínculo | **Sem certificado emitido** (com presença suficiente) · **certificado emitido e nunca baixado** · inscritos numa **sala/atividade** |
| Engajamento | **Sem foto ou bio** no perfil · com **XP ou conquista** acima de um patamar |

## Invariantes que esta fase NÃO pode quebrar

- **Uma linha por destinatário** no outbox, com `dedupeKey` da campanha: reenviar **não duplica**, e
  ninguém recebe uma lista no "Para:".
- **A definição do segmento é dado** (os fatos, não a lista de ids): seis meses depois ainda se
  explica por que aquela pessoa recebeu.
- **A contagem vem antes do envio** e a lista interna é **mascarada** pela ocultação (F60/E79).
- **A comunicação nunca derruba o fluxo acadêmico** (invariante 8) e o disparo respeita o **limite de
  ritmo** (F13) em lotes.
- **Runtime só por `withTenant`**; RLS + FORCE em toda tabela nova; nada de `adminPrisma`.
- **Sem `any`**, `kebab-case.ts`, erros como valor, comentários explicam **POR QUE**, tudo em português.
- **Nenhuma isenção nova** no portão de acessibilidade; catraca nova só vale se **provada por mutação**.
- Bateria da §4 do `AGENTS.md` antes de declarar concluído, com os **números reais**.
