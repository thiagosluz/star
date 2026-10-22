# FASE 72 — a API de leitura de cada evento (PLANO)

> **Estado: PLANO APROVADO pelo humano** (decisões abaixo). Pronto para executar.

## Decisões do humano

1. **CORS aberto** para qualquer origem — o dado é o mesmo da página pública; o limite de taxa protege
   o servidor.
2. **CHAVE POR EVENTO, revogável.** Consequência que o desenho absorve: **a API é por evento e toda
   leitura exige a chave daquele evento** — a lista de eventos da instituição **sai do `v1`**, porque
   uma lista entre eventos exigiria uma chave de instituição, que não foi aprovada. Uma chave, um
   evento, um consumidor identificado.
   - A chave é **SELADA** como o link da carta da F48 (AES-GCM): o organizador **re-exibe** quando
     quiser e o banco sozinho não a abre; o índice de busca é o SHA-256. Não é hash puro justamente
     porque o organizador precisa copiá-la de novo — hash puro obrigaria a "gerar outra e revogar".
   - Vive em `Event.settings.api` (sem migração): `{ chaveSelada, criadaEm, revogadaEm?,
     secoes: { palestrantes, patrocinadores, chamadas } }`, lida pelo leitor tolerante da casa.
   - Envio pelo cabeçalho `Authorization: Bearer <chave>`; ausente/errada/revogada → `401` com o
     motivo (sem revelar se o evento existe); a **trilha** registra criação, revogação e cada recusa
     por chave inválida (a taxa de erro é sinal de abuso).
3. **Interruptor por seção** (palestrantes, patrocinadores, chamadas): desligado ⇒ a seção responde
   `404` **como se não existisse** naquela API, e a tela diz qual está desligada.
4. **Além da lista**: entram as **chamadas de propostas publicadas** (tipo, prazo, link do
   formulário). **Não** entram: estatísticas agregadas, contato público, `.ics`, links de inscrição
   por atividade.

## O pedido

Uma **API por evento**, **somente leitura**, para que um site externo consuma o que já está
cadastrado e publicado: dados básicos do evento, palestrantes, atividades/programação,
patrocinadores — e o que mais fizer sentido.

## O princípio que define a fase

**A API não lê o banco: ela lê a MESMA projeção pública da página do evento.** O sistema já tem uma
fronteira testada entre "o que o público pode ver" e "o que é do organizador ou do participante" —
a projeção pública da página, com a ocultação da F60, o endereço da sala online nunca exposto
(F68/F71), as respostas do formulário e o CPF fora (F70) e os rascunhos fora. Uma API que monta a
própria consulta seria um **segundo caminho** para o banco, e o primeiro defeito dela seria o
vazamento que a página evita. Portanto: **uma função de projeção, dois consumidores** (a página e a
API), com **teste catraca** que reprova se as duas divergirem.

## Desenho (REST sobre os route handlers que a casa já usa)

Base versionada — o formato, uma vez publicado, é **contrato**:

```
GET /api/v1/t/<slug>/eventos                          → eventos PUBLICADOS da instituição
GET /api/v1/t/<slug>/eventos/<eventSlug>              → o evento (identidade, datas, local, tema,
                                                        inscrição aberta × encerrada, vagas)
GET /api/v1/t/<slug>/eventos/<eventSlug>/atividades   → a programação (dia, sala, trilha, tipo)
GET /api/v1/t/<slug>/eventos/<eventSlug>/palestrantes → palestrantes (campos públicos)
GET /api/v1/t/<slug>/eventos/<eventSlug>/patrocinadores → cotas e patrocinadores
GET /api/v1/t/<slug>/eventos/<eventSlug>/chamadas     → chamadas PUBLICADAS (prazos)
```

- **Envelope de sucesso:** `{ "data": …, "meta": { … } }` — `meta` leva `generatedAt`, `etag` e a
  contagem quando for lista. **Envelope de erro:** o da casa (`code`, `message`), com HTTP adequado:
  `404` evento inexistente **ou não publicado** (o mesmo código, para não revelar rascunho).
- **Cache:** `ETag` derivado do conteúdo canônico + `Cache-Control: public, max-age=60` + `304` no
  `If-None-Match`. Um site externo que consulta de hora em hora não deve custar consulta de hora em
  hora.
- **Limite de taxa:** o limitador em Redis que a F13 já tem, por IP, com `429` e `Retry-After`.
- **CORS [DECIDIR]:** liberado (`*`) porque o dado é público, ou restrito a leitura **server-side**
  (sem `Access-Control-Allow-Origin`)? A resposta muda o que o site do cliente consegue fazer no
  navegador.
- **Autenticação [DECIDIR]:** sem chave (o dado já está na página pública) ou com chave por evento
  (para medir uso e poder revogar)? A recomendação é **sem chave + limite de taxa**; chave só se o
  organizador precisar de controle de acesso próprio.

## O que a API NUNCA devolve (lista fechada, presa por teste)

Endereço da sala online · dado de participante (nomes, inscrições, presença, e-mail) · respostas do
formulário do organizador · CPF · lista de espera e posições · contadores internos de operação ·
descontos/cupons · qualquer campo de rascunho · a página não publicada · e-mail de contato só se o
organizador o declarar público.

## A tela do organizador

`/t/<slug>/administracao/eventos/<eventId>/api` como **cartão da raiz** (grupo CONFIGURAR, o padrão
da F55):

- o endereço de cada recurso do **evento selecionado**, com **prévia do JSON real** (copiável);
- o **estado** honesto: o evento está publicado? A API responde 404 enquanto não estiver;
- **[DECIDIR] interruptor por seção** (palestrantes, patrocinadores, chamadas): o organizador escolhe
  o que expõe, guardado em `Event.settings.api` com leitor tolerante — **expor é decisão explícita**,
  nunca o padrão silencioso;
- a **documentação** (página estática em `docs/` + link na tela) com exemplos e o contrato.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **A projeção única** | Extrair a projeção pública dos recursos da API do que a página já monta; teste catraca "página e API não divergem"; unidade da projeção sem banco |
| 2 | **Os endpoints** | Os seis recursos com envelope, ETag, `304`, `404` de não publicado; CORS e limite de taxa conforme decidido |
| 3 | **A tela do organizador** | O cartão, a prévia do JSON, o estado de publicação e os interruptores por seção (se aprovados) |
| 4 | **Catracas e documento** | Integração por recurso provando o que **não** sai (sala online, participante, resposta de formulário, CPF, rascunho), o `304`, o `429`, o CORS; E2E da tela; `docs/fase-72-api-do-evento.md` (ADR-354+); README/AGENTS/dívidas; bateria da §4 |

## Fora de escopo, declarado

**Escrita** (POST/PUT/DELETE) · OAuth · GraphQL · webhooks · API por instituição inteira além da
lista de eventos · inscrição pela API. Se o humano quiser escrita depois, ela entra como **fase
própria** — com autorização por chave, idempotência e trilha, que é outro desenho.

## Invariantes

- **A API não abre caminho novo para o banco**: projeta o que a página já projeta.
- **Publicado é a porta**: rascunho responde `404`, o mesmo do inexistente.
- **O que se oculta fica oculto** — na API também, e por teste.
- **Formato é contrato**: `v1` no caminho, campo que sai não muda de tipo nem de nome sem `v2`.
- Sem `any`; erros como valor no serviço; o envelope de erro é o da casa.
