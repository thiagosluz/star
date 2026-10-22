# FASE 74 — a proposta que exige anexo e não pede (PLANO)

> **Estado: PLANO APROVADO pelo humano.** Pronto para executar.

## Decisões do humano

1. **O rascunho não conta** como proposta recebida no painel **nem** no limite por autor — o
   rascunho de uma tentativa que falhou deixa de ser lixo e deixa de trancar a pessoa fora.
2. **Sim, anexar na própria página da proposta** (DECISAO REVISTA PELO HUMANO: A, nao B. A E46 NAO foi quitada, foi re-escopada -- ver o cabecalho; o upload NAO vai para a pagina publica, e a pagina avisa e o rascunho leva a area do autor). Anexar:  → anexar o
   `BLIND_PDF` → enviar, reusando o uploader e o portão de inspeção existentes.
3. **A chamada HERDA da trilha** quando não diz nada: a coluna passa a aceitar "herdar da trilha"
   (nula) e a trilha cega volta a valer. Exige decisão de migração para as chamadas existentes.

**A ordem é obrigatória**: a posse do upload (fatia 1) vem **antes** de qualquer superfície nova de
upload — senão o furo de IDOR ganha alcance.

## Achados novos desta investigação (entram nas fatias)

- **A tela do rascunho também mente**: a lista de bloqueios em `submissoes/[submissionId]/page.tsx:132-140`
  **não inclui** "Selecione a trilha", que o serviço exige (`submission-rules.ts:587-601`) — numa
  chamada científica **sem** trilha a tela pode dizer "Tudo pronto para o envio" e o servidor recusar.
  É o mesmo defeito do relato: a tela não conta o que o servidor vai exigir.
- **A chamada de minicursos do seed é o caso ambíguo vivo**: a trilha é cega, a chamada é aberta, e a
  implementação ignora a trilha em silêncio — enquanto o ADR-160 descreve o contrário.
- **O organizador pode pedir por escrito o que o formulário não tem** (o campo `instructions`, com a
  dica "o que anexar"): é o contorno que existe hoje, e ele não isenta o conserto.
- **A tela anuncia a cegueira** ("A avaliação é cega: quem julga não vê a autoria") **e não menciona o
  anexo** em "O que esta chamada pede" — a promessa e a exigência aparecem separadas.

## O pedido

O organizador (ou o autor) tenta enviar uma proposta numa chamada de **trabalho científico** pela
página pública e recebe: *"A submissão está incompleta. A trilha exige revisão cega: anexe a versão
sem identificação dos autores."* — e o formulário **não tem onde anexar**.

## O que a investigação mediu

- **A recusa nasce no domínio** (`evaluateSubmissionReadiness`, `submission-rules.ts:614-619`), chamada
  pelo serviço (`submission-service.ts:839-861`), e exige **só o `BLIND_PDF`** (a versão anonimizada,
  com checksum); o `IDENTIFIED_PDF` é **aviso**.
- **A exigência vem da CHAMADA** (`call.requiresBlindReview ?? track.requiresBlindReview ?? true`),
  que para PAPER/POSTER nasce `true` (`defaultBlindFor`). Como a coluna da chamada é boolean **não
  nulo**, **a trilha nunca vence** — uma chamada "aberta" com trilha cega **ignora** a trilha
  (desvio do ADR-160, sem ADR que trate o caso).
- **O formulário público nunca teve upload** (`proposal-form.tsx:97-244`); a dívida **E46**
  (`fase-33:540`, ADR-158) declara a lacuna desde a F33.
- **Dá para terminar hoje**: o rascunho é criado, o autor abre `/t/<slug>/submissoes/<id>`, anexa o
  `BLIND_PDF` e envia — mas **nada na tela de erro indica essa porta**, e o caminho legado
  (`/submissoes/nova`) está fechado pela F68.
- **Abrangência**: nenhuma das duas chamadas do seed cai nela; **toda chamada PAPER/POSTER** cai
  (cega ou não). Só a `artigos-completos` (criada hoje) está nesse estado.

## Os danos colaterais (medidos) e o furo adjacente

1. **Rascunho órfão por tentativa falha** — o do humano está no banco (protocolo `2026-KY8Y`, 0 arquivos).
2. Ele **aparece ao organizador como proposta recebida** (`call-service.ts:868-871`, sem filtro de
   status; `countProposals` conta DRAFT como viva).
3. Ele **consome o limite por autor** (`submission-service.ts:304-312` conta DRAFT) — com limite
   configurado, a pessoa **se tranca fora** tentando.
4. `redirectTo` aponta para **`/minhas-submissoes`**, rota inexistente (`call-actions.ts:676`).
5. **FURO DE SEGURANÇA**: `requestUpload`/`confirmUpload` **não conferem `submittedById`** — a
   `requiresOwnership` valida a permissão `:own` do próprio usuário, não a posse do alvo. Quem pode
   editar a própria submissão pode anexar na de **outra pessoa** conhecendo o UUID.

## O que a fase faz

**A segurança vem primeiro**: fechar a posse em `requestUpload`/`confirmUpload` (o alvo é do autor da
sessão, fail-closed) **antes** de qualquer superfície nova de upload. Um teste de integração prova
que o UUID de outra pessoa é recusado.

**A falha fica acionável**: a action devolve o `submissionId` do rascunho e a tela leva a "Continuar na
área do autor"; a página da chamada diz **em "O que esta chamada pede"** que artigo/pôster exige o PDF
anonimizado; o redirecionamento aponta para a rota certa.

**O rascunho deixa de mentir**: rascunho não aparece como "proposta recebida" e não consome o limite
por autor **[DECIDIR]**.

**O upload na página pública (E46) [DECIDIR]**: o formulário cria o rascunho, envia o `BLIND_PDF`
(reusando o uploader e o portão de inspeção da F36) e só então envia para avaliação.

**A precedência CHAMADA × TRILHA [DECIDIR]**: hoje a chamada sempre vence e a trilha cega só vale
quando não há chamada. Corrigir exige a coluna da chamada **herdar** da trilha (`null` = herda) e um
ADR que trate o caso.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **A posse do upload** | `requestUpload`/`confirmUpload` conferem `submittedById` (fail-closed); teste de integração com UUID alheio recusado e a submissão do dono intacta |
| 2 | **A falha acionável** | O rascunho já criado é oferecido como saída (id + link), a página diz o que a chamada exige, e o redirecionamento aponta para a rota certa |
| 3 | **O rascunho honesto** | Rascunho fora da contagem de "propostas recebidas" e fora do limite por autor **[se aprovado]** |
| 4 | **O upload na proposta pública** | Criar rascunho → anexar `BLIND_PDF` → enviar, reusando a esteira e o portão de inspeção **[se aprovado]** |
| 5 | **A precedência CHAMADA × TRILHA** | `null` herda da trilha; ADR do caso "chamada aberta + trilha cega" **[se aprovado]** |
| 6 | **Catracas e documento** | Integração: PAPER + trilha cega → protocolo **ou** rascunho acionável; E2E: PAPER no navegador; o IDOR; `docs/fase-74-*.md` (ADR-360+); README/AGENTS/dívidas sob o teto; bateria da §4 |

## Invariantes

- **Nenhuma proposta cega entra em avaliação sem o `BLIND_PDF`** — "item pendente" numa chamada cega
  deixaria a revisão sem o que avaliar e o snapshot cego viraria ficção.
- **A posse é conferida no servidor**, nunca só na tela.
- **Rascunho não é proposta recebida** — nem no painel, nem no limite.
- **A falha diz o que fazer**: erro sem saída é o defeito.
