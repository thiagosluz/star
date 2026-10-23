# FASE 76 — o mutirão dos 500 que deviam ser 404 (PLANO)

> **Estado: plano escrito a partir da medição.** Pronto para executar em fatias.

## O defeito, medido

Um **id malformado** na URL chega ao Prisma e responde **500** (`invalid input syntax for type uuid`,
armadilha 25). Medido com o container no ar, 42 URLs com `nao-e-uuid`:

```
25 × 500 (60%)   8 × 404   5 × 200 (painel de erro)   3 × 400   1 × 403
```

Só **13 das 42** respondem o que deveriam. E o controle fecha o diagnóstico: com **uuid bem formado
e inexistente**, as 8 URLs testadas dão **404** — o 500 é **exclusivo do formato inválido**.

**A causa é sempre a mesma e é simples**: `where: { id }` sem validar o formato, e o
`if (!x) notFound()` que já existe fica **depois** do erro — o caminho malformado nunca o alcança.

## O universo

| Categoria | Quantos | Hoje |
|---|---|---|
| Páginas com id no path | **27** (18 de evento, 4 de submissão/participante/tenant, 4 que já dão 404, 1 de demanda) | 18 × 500 · 4 × 200 com painel · 4 × 404 (catch-all) |
| Páginas com id na **query** | **3** com defeito (`certificados?evento` 500, `modelos?modelo` 500, `pagina/midia?evento` **200 alargando em silêncio**) | — |
| Rotas de API com id | **11** (7 no path, 4 na query) | 5 × 500 **de corpo vazio**, 1 × 403, 1 × 200 com erro, 1 × 404 com envelope diferente |
| Server Actions | **30** arquivos | **29 já validam** (`z.string().uuid`, 225 ocorrências) — **nenhuma precisa de conserto** |
| Helper compartilhado de id | **0** | a mesma regex existe **3×** em 3 módulos, usada por **2 páginas** |

## As fatias

### 1 — O helper único e as páginas (o grosso do defeito)
- `src/lib/validation/id.ts`: `isUuid(value)` + `requireUuidParam(params, chave)` (chama `notFound()`).
  **Mate as 3 cópias** da regex (`media-filter-rules.ts:86`, `segments.ts:114`,
  `segment-form.ts:236`) — e **preserve a política de cada chamador**: um devolve `null` (sem filtro),
  um recusa, um valida. O helper é o **teste**; a política fica no chamador.
- **1 linha** no topo das **18 páginas com 500** e das **4 com 200+painel**
  (`[eventId]/api`, `reconhecimento`, `comite/<submissionId>`, `participantes/<userId>`), mantendo os
  `notFound()` existentes; **as 4 `generateMetadata` com id** também (senão o metadata estoura antes
  da página).
- **Não toque** nas 4 que já dão 404 por catch-all (`sorteios/[id]` ×3, `palestrantes/[id]`): elas
  dão a resposta certa pelo motivo errado — o catch-all **mascara falha real como 404**, e isso fica
  **declarado** como ponto de atenção, não consertado aqui.

### 2 — A query não é endereço
- `certificados?evento=` e `modelos?modelo=` (hoje 500): **ignoram o filtro** e a tela **avisa** que o
  filtro foi descartado (o que se esconde, se anuncia).
- `pagina/midia?evento=` deixa de **alargar a consulta em silêncio**: mesmo tratamento.
- **Nada disso vira 404** — filtro malformado é filtro ignorado, não endereço inexistente.

### 3 — As rotas de API: um envelope, e 404 em vez de 500 vazio
- As 5 que dão **500 sem corpo**, a de **403** e a de **200 com erro** passam a **404 com envelope**.
- **Um** envelope para `/api/t/**`: `{ ok:false, code, message }` (é o que 35 sítios já escrevem à mão
  em 9 arquivos) — e o **QR**, que hoje responde `{ error }`, passa a ele (6 sítios). Declare que é
  mudança de contrato para quem consome.
- A de `ao-vivo` já responde certo: **não tocar**.

### 4 — As catracas (as duas)
- **Fonte** (catálogo, como o da F75): todo `page.tsx`/`route.ts` cujo segmento seja `[<x>Id]` tem de
  chamar `requireUuidParam` com **aquele** param; igualdade exata, rota nova **reprova**, e
  `generateMetadata` entra na regra. **Limite declarado**: prova que a chamada existe, não que o valor
  validado é o usado (`const id = eventId` engana).
- **Comportamento**: tabela parametrizada no E2E — **38 rotas** (27 páginas + 11 APIs) com
  `nao-e-uuid` esperando **404** (e, onde couber, uuid inexistente → 404 também). Uma `for` de `test()`
  por sessão; a suíte é `workers: 1`.
- **Re-apontar o caso do F75** que mede 500 (`f75-paginas-de-erro.spec.ts`): ele hoje **auto-skipa**
  quando a rota é consertada — tem de passar a **esperar 404**.

### 5 — O documento e a bateria
`docs/fase-76-500-que-deviam-ser-404.md` (9 seções, **ADR-366+**) com: a medição 25/42; as **4 páginas
que mudam de observável** (200+painel → 404, declarado); a lista dos **ids que NÃO são uuid**
(`blockId`, lead `id`, `lattesId`/`orcidId`/`taxId`, `presetId`, slugs, `[token]`, `[code]`,
`[username]`) para a catraca não pegá-los de boa-fé; o **catch-all** das 4 rotas como ponto de
atenção; e a **query ≠ endereço**. README/AGENTS/dívidas sob o teto (~64.800 bytes), bateria da §4.

## Invariantes

- **Formato inválido não é recurso inexistente por acidente** — é 404 **por decisão**, antes de
  consultar.
- **Filtro não é endereço**: query malformada é ignorada e anunciada, nunca 404.
- **API responde com envelope**, inclusive quando erra — corpo vazio é o pior contrato.
- **A catraca prende o que dá para prender** e declara o que não dá (o alias do valor validado).
- Nenhuma action precisa de conserto: as 29 que validam ganham **teste**, não código.
