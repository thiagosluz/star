# FASE 73 — o resultado da chamada que o organizador publica (PLANO)

> **Estado: PLANO APROVADO pelo humano.** Pronto para executar.

## Decisões do humano

1. **A lista deriva das decisões e o organizador escolhe**: todas as submissões da chamada aparecem
   com o status da decisão ao lado, as **aceitas já marcadas**, e ele desmarca o que não quer
   publicar — podendo publicar algo ainda em avaliação, se quiser.
2. **Nome completo sempre** — e isto é uma **EXCEÇÃO DECLARADA** à régua da E79 (ocultação):
   a lista de aprovados é documento público e o ato de aprovar torna os autores públicos. É a
   **única** superfície que ignora a ocultação, e a exceção fica presa por dois testes:
   (a) a lista mostra o nome completo mesmo de quem se oculta; (b) **todas as outras** superfícies
   públicas continuam respeitando a ocultação — para a régua da lista não se alastrar por cópia.
   O documento da fase e a §10 do `AGENTS.md` registram a exceção com o nome de quem decidiu e a fase.
3. **O final trava**: mudar exige **reabrir**, com confirmação e trilha.
4. **Público para qualquer visitante**, na página da chamada (e, por consequência, na landing que
   lê a chamada na renderização).

## O pedido

Na tela de **chamadas do evento** (`/administracao/eventos/<eventId>/chamadas`), o organizador
precisa **publicar o resultado parcial e o final** das submissões de uma chamada: um **texto
público**, a **lista dos aprovados**, os **próximos passos** — e tudo isso visível na **parte
pública** para todos os participantes.

## O princípio que define a fase

**O resultado é um ATO, não uma VISTA.** O comitê já decide cada proposta (`/comite/<submissionId>`,
o protocolo de aceite da F33). A publicação **deriva dessa decisão por padrão** — para o organizador
não redigitar título e autores de cada trabalho — mas o que vai ao público é o que ele **escolheu**
publicar, com o **texto dele** e os **próximos passos dele**. Publicar é o ato; a decisão interna
(notas, pareceres, quem recusou o quê) **nunca** sai por aqui.

## O que vai ao público, e o que nunca vai

**Vai:** o estado do resultado (parcial × final), o texto do organizador, a data da publicação, a
lista com **título · autores (com NOME COMPLETO, inclusive quem se oculta (decisão 2)) · tipo**, e os
próximos passos.

**Nunca:** nota, parecer, revisor, ordem de mérito não publicada, e-mail, CPF, dado de inscrição,
qualquer campo do `proposalData` que não o título/tipo que o próprio autor declarou, lista de espera,
ou o resultado em rascunho.

## Os estados (por chamada)

```
SEM_RESULTADO ──publicar parcial──▶ PARCIAL ──publicar final──▶ FINAL
       ▲                              │  ▲                        │
       └────────── rascunho ──────────┘  └──── reabrir (com trilha)┘
```
- **Rascunho**: o organizador escreve e escolhe a lista; **nada aparece no público**.
- **Parcial**: publicado, **editável** (a próxima publicação substitui e fica na trilha).
- **Final**: publicado e **travado**; mudar exige **reabrir** (confirmação + trilha) — resultado
  final que muda em silêncio não é final.

## Onde a configuração mora

JSON na **chamada** (`Call`), lido por **leitor tolerante** (o padrão de `readRegistrationForm` /
`readEventApiConfig`): `{ estado, texto, proximosPassos, publicados: [submissionId], atualizadoEm,
publicadoEm? }`. **A fatia 1 mede** se o `Call` já tem coluna JSON (reuso, sem migração) ou se é
necessária uma coluna nova — e diz qual foi o caso.

## A tela do organizador (`.../chamadas`)

Um cartão por chamada com: **textarea** do texto público, o **seletor da lista** (uma caixa por
submissão da chamada, com as **aceitas pré-marcadas** e o status da decisão ao lado), o **próximo
passo**, e os botões **Salvar rascunho · Publicar parcial · Publicar final · Reabrir**. Funciona
**sem JavaScript** e mostra, ao lado, **o que o público vai ver** (a prévia do bloco).

## A página pública

Na página da chamada (`/t/<slug>/eventos/<eventSlug>/chamada/<callSlug>`), uma seção **Resultado**
que só existe quando há resultado publicado: etiqueta do estado, data, texto, lista e próximos passos.
Como o bloco de chamadas da landing **lê a chamada na renderização** (ADR-168), o resultado aparece
lá também sem trabalho extra.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **Domínio puro + onde mora** | `Call` result: regras de estado (transições legais, trava do final), a máscara da lista (E79), a projeção pública (o mínimo), o leitor tolerante; a medição da coluna | 
| 2 | **Serviço e Server Actions** | salvar rascunho / publicar parcial / publicar final / reabrir, com `EVENT_MANAGE` conferida **na action**, trilha por ato, e a lista validada contra as submissões **daquela** chamada | 
| 3 | **A tela do organizador** | o cartão em `.../chamadas` com o seletor, a prévia e os quatro gestos, sem JavaScript |
| 4 | **A página pública** | a seção Resultado na página da chamada (e por consequência na landing), sem resultado publicado = sem seção |
| 5 | **Catracas e documento** | unidade das regras/estados/máscara; integração (rascunho invisível, parcial editável, final travado, reabrir com trilha, notas e pareceres nunca no corpo público); E2E (publicar → o público vê → reabrir); portão WCAG AA na página da chamada e na tela do organizador; `docs/fase-73-*.md` (ADR-357+); README/AGENTS/dívidas; bateria da §4 |

## Invariantes

- **Publicar é ato**: rascunho não vaza; final não muda em silêncio.
- **A lista deriva da decisão, mas é escolhida** — publicar não é sinônimo de aceitar.
- **A exceção declarada**: a lista mostra o nome completo mesmo de quem se oculta (documento público). É a ÚNICA superfície assim — presa por catraca de fonte (o módulo não importa a máscara) e por teste que exige a ocultação em TODAS as outras.
- **Nota, parecer e revisor não existem na superfície pública** — preso por teste.
- **Sem JavaScript** para publicar; **portão WCAG AA** sem isenção nova.
