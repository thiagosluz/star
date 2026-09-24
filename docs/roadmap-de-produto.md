# Roadmap de produto — onde o EventFlow está, com quem se parece e o que fazer depois

> **Documento de decisão de produto.** Não é documento de fase: ele existe para o humano
> escolher o próximo tema com o mapa na mão. Escrito depois da **FASE 40** (editor visual do
> certificado), com os números reais da árvore: **2146 testes** Vitest (93 arquivos) + **142**
> E2E, **226 ADRs**, **52 tabelas de tenant** sob RLS + FORCE, **65 permissões**, **35 migrações**,
> ESLint 0 · tsc 0 · build OK.
>
> **A leitura anterior** (`docs/analise-competitiva-e-roadmap.md`, de setembro de 2026, feita com
> 39 fases/2014 testes) continua válida no diagnóstico e **envelheceu em dois pontos**: o editor
> visual de molduras, que ela listava como lacuna, foi entregue na FASE 40; e os números dela são
> anteriores às FASES 36–40. Este documento é a leitura **atualizada** e a leva adiante.

---

## 1. Sumário executivo

### O que o EventFlow é hoje, em uma frase

**Um sistema operacional de evento acadêmico** — não um site de inscrições. Ele cobre o ciclo
inteiro de uma conferência (chamada → submissão → parecer cego → decisão → programação →
credenciamento → presença → certificado verificável → prestação de contas da operação), com
rigor de auditoria incomum: documento assinado e congelado, sorteio com *commit-reveal*,
trilha de auditoria particionada, isolamento por RLS provado por teste, e uma bateria que impede
regressão de design.

### O que a comparação com o mercado diz

| | Diagnóstico |
|---|---|
| **Even3** | É o concorrente direto no acadêmico e **perde para nós** em motor de avaliação (rubricas livres, cegueira, conflito de interesse), credenciamento (offline-first, etiqueta, ZPL) e certificação com validação pública. **Ganha** onde o dinheiro e o currículo estão: **inscrição paga** e **anais com DOI** — o pesquisador precisa do DOI para pontuar no Lattes. |
| **Sympla** | Domina **checkout** (Pix, cartão, parcelamento, split) e **descoberta** (marketplace). Em rigor de operação acadêmica e certificação, é outra categoria de produto. Não vale disputar o marketplace com ela. |
| **Doity** | Mesma faixa da Even3 (trabalhos científicos + ticketing), execução mais simples. |
| **Eventbrite / Cvent / Whova** | Referência de **experiência do participante** (app, agendamento pessoal, matchmaking, *lead retrieval* de expositor, engajamento) e de **enterprise** (SSO, API, relatórios). É de onde vem o próximo salto de percepção de valor — não de funcionalidade acadêmica. |
| **Fourwaves / Oxford Abstracts / Ex Ordo** | Concorrentes só de *abstract management*. Nosso motor de avaliação já é competitivo; o que eles vendem junto é **publicação** (anais, DOI) e **relatório para a comissão**. |

### A conclusão que organiza tudo

Temos **profundidade** (o que é difícil de copiar) e nos falta **a esteira que transforma
profundidade em receita**: cobrar, publicar e engajar. Nenhuma instituição troca de plataforma
por causa de rubrica livre; ela troca por **inscrição paga que funciona**, **anais publicados** e
**participante que volta no ano seguinte**.

---

## 2. Como o mercado ganha dinheiro (e o que isso significa para nós)

| Player | Modelo | Implicação para o EventFlow |
|---|---|---|
| **Sympla** | Taxa por ingresso vendido + taxa de serviço, **absorvida pelo organizador ou repassada ao participante**; parcelamento pode ser absorvido; o dinheiro é do organizador (split) — [taxas](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15444341510413-Taxas-da-Sympla-para-Organizadores-Valores-e-Como-Funcionam), [quem paga](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445173235085-Quem-paga-a-taxa-de-servi%C3%A7o-o-organizador-ou-o-participante), [parcelamento](https://blog.sympla.com.br/blog-do-produtor/como-funciona-a-absorcao-de-parcelamento-sem-juros-na-sympla/), [como cobrar](https://blog.sympla.com.br/blog-do-produtor/como-cobrar-por-eventos/) | É o modelo que o **plano** do EventFlow já desenha (`planQuotas`, `maxStorageBytes`) mas não sabe cobrar. Sem gateway, não existe taxa de plataforma — e sem ela, o SaaS não tem receita. |
| **Eventbrite** | **Grátis para evento gratuito**; cobra por ingresso pago — [free ticketing](https://www.eventbrite.com/event-ticketing/free-system/), [planos](https://www.eventbrite.es/help/pt-pt/articles/193833/[slug]/) | Confirma a leitura: o dinheiro está no ingresso pago. Evento gratuito é aquisição, e nós já o servimos muito bem. |
| **Even3 / Doity** | Cobra pela **inscrição** e pelo **trabalho submetido**, e entrega **anais com DOI** como parte do pacote — [DOI nos anais (Even3)](https://ajuda.even3.com.br/hc/pt-br/articles/4403470452109-Oferecer-DOI-aos-participantes-com-trabalhos-publicados-nos-anais-do-evento), [comunicar autores](https://ajuda.even3.com.br/hc/pt-br/articles/45537160439067-Comunicar-autores-sobre-a-publica%C3%A7%C3%A3o-dos-Anais), [trabalhos científicos (Doity)](https://doity.com.br/trabalhos-cientificos) | O DOI **não é enfeite**: é o motivo pelo qual a comissão científica assina a contratação. É receita de serviço, e é o complemento natural do nosso motor de avaliação. |
| **Cvent / Whova** | Assinatura enterprise + app do participante + *lead retrieval* pago à parte pelo expositor — [Whova overview](https://whova.com/pages/whova-overview/), [engajamento do participante (Cvent)](https://release.cvent.com/eventmanagement/announcements/attendee-engagement-releases-for-may-6-2026), [manual do expositor com lead retrieval](https://green-marine.org/media/hswpejih/gt26-whova-exhibitor-manual.pdf) | Duas lições: (a) **app do participante** é o que o público sente como "plataforma de verdade"; (b) **lead retrieval** é receita vendida ao patrocinador, não ao organizador. |

> **Nota de método (honestidade das fontes).** Parte destas páginas é protegida por Cloudflare e
> devolveu **403** (Sympla e Even3); nesses casos o dado vem do índice de busca — título e
> descrição do próprio material do fornecedor —, não da leitura integral. As páginas da Whova,
> Fourwaves, Cvent e os guias de *lead retrieval* foram lidos. Onde eu não medi, está escrito
> como leitura de mercado, não como fato verificado no produto de ninguém.

---

## 3. Matriz de capacidades (o que temos, o que eles têm)

Legenda: 🟢 vantagem nossa · 🟡 paridade ou quase · 🔴 lacuna que decide contrato · ⚪ fora do nosso jogo.

| Dimensão | Even3 / Doity | Sympla | Cvent / Whova | EventFlow (F40) |
|---|---|---|---|---|
| **Isolamento multi-tenant** | multi-tenancy no código | microsserviços B2C | enterprise | 🟢 **RLS + FORCE** em 52 tabelas, provado por teste de isolamento |
| **Domínio puro + auditoria** | monolito tradicional | foco B2C | enterprise | 🟢 regras puras testáveis sem infra; `audit_logs` particionada; `job_runs` com histórico |
| **Inscrição no evento e por atividade** | sim | ingresso simples | sim | 🟢 dois níveis (evento × atividade), lotação atômica, sala como teto, lista de espera |
| **Confirmação de vaga com prazo e checklist** | não | não | não | 🟢 **exclusivo**: retém a vaga, cobra item por item, libera e promove sozinho |
| **Submissão + parecer cego + rubrica livre** | sim (engessado) | ✗ | parcial | 🟢 **1 a 12 critérios**, precedência chamada → trilha → padrão, rubrica congelada no 1º parecer, conflito de interesse, afinidade |
| **Chamadas de propostas (CFP)** | sim | ✗ | parcial | 🟢 tipo, janela, cegueira e rubrica próprios; proposta é submissão; aceite cria atividade |
| **Anais, DOI, ISBN/ISSN, citação** | 🔴 **sim (DOI Crossref)** | ✗ | ✗ | 🔴 **não existe** |
| **Inscrição paga / checkout** | sim | 🟢 **Pix, cartão, parcelamento, split** | sim (enterprise) | 🔴 **não existe** (nenhum gateway no código) |
| **Cupom, lote, categoria de público** | sim | sim | sim | 🔴 não existe |
| **NFS-e / recibo / prestação de contas** | parcial | parcial | n/a | 🔴 não existe |
| **Credenciamento e presença** | app básico dependente de rede | validação de ingresso | app | 🟢 **offline-first** (IndexedDB), leitura por contexto, sessão por visita, minutos com teto |
| **Crachá** | etiqueta simples | ingresso | crachá | 🟢 folha A4 milimétrica configurável + **ZPL II** para térmica |
| **Certificação** | boa | básica | básica | 🟢 assinatura, hash, **validação pública por QR**, lote ZIP em fluxo, **editor visual com arte** (F40) |
| **Sorteio de palco** | manual/opaco | ✗ | ✗ | 🟢 *commit-reveal*, telão com roleta, auditoria que refaz as contas no navegador |
| **Gamificação** | ✗ | ✗ | ✗ | 🟢 XP idempotente, cartas, missões, temporadas |
| **Página pública / hotsite** | sim | hotsite | sim | 🟢 editor de blocos, versões, agendamento, acervo de mídia com quota |
| **Patrocínio** | logo | banner | cotas + **lead retrieval** | 🟡 cotas com limite atômico e janela de exibição · 🔴 sem captura de leads |
| **App do participante** | app | app organizador | 🟢 **app completo + matchmaking** | 🔴 **não existe** (tudo web) |
| **API pública / webhooks / SSO** | parcial | parcial | 🟢 | 🔴 não existe |
| **Relatórios e BI** | relatórios prontos | painel do produtor | 🟢 | 🟡 panorama e exportação CSV; sem relatório do comitê nem financeiro |
| **Marketplace de descoberta** | ✗ | 🟢 | ✗ | ⚪ não perseguir |
| **Streaming / híbrido** | integra | integra | 🟢 | ⚪ não perseguir por agora |

---

## 4. O que é nosso e ninguém copia rápido

1. **O documento é dado, não tela.** Certificado assinado, congelado, com o *layout* dentro do
   próprio payload canônico versionado — e validação pública que confere a assinatura. Nenhum
   concorrente nacional faz isso com o mesmo rigor.
2. **A operação do dia do evento.** Credenciamento offline, balcão que decide por contexto,
   etiqueta e ZPL, fila de confirmações, quadro de demandas. É o que a secretaria sente na pele —
   e o que a Even3 terceiriza para planilha.
3. **Provas que o comitê aceita.** Rubrica congelada, parecer cego, conflito de interesse, sorteio
   auditável com telão. São decisões que precisam de rastro, não de botão bonito.
4. **A postura de engenharia.** RLS provada, erros como valor, guard do design system, 2146 testes,
   armadilhas numeradas. Isso é o que permite continuar andando rápido sem quebrar o que existe.

---

## 5. As lacunas, em ordem de valor

### P1 — Motor financeiro: inscrição paga e conciliação 🔴 *(a maior lacuna, e a que destrava receita)*

**Por que decide contrato.** Nenhuma conferência de médio porte opera só com inscrição gratuita.
Sem gateway, o EventFlow é um excelente produto que a instituição **não pode comprar como
plataforma principal**.

**O que entra.** Ingresso (**lote** com vigência e quota, **categoria de público** — estudante,
professor, sócio —, **cupom** com regra de uso e limite, **preço por item**), checkout com
**PIX dinâmico** e **cartão** atrás de um provedor único (Mercado Pago, Pagar.me, Asaas ou Stripe),
**split** para a conta da instituição com a taxa da plataforma retida, **webhook assinado** como
fonte de verdade, **estorno/cancelamento**, **conciliação** (transação × inscrição × repasse),
**recibo** e **exportação para o financeiro**.

**O encaixe que já existe e ninguém tem de graça.** A FASE 34/37 construiu exatamente o mecanismo
que a cobrança precisa: a inscrição nasce **retendo a vaga** (`PENDING`), com **checklist de
itens** e **prazo**, e a equipe (ou o sistema) confirma. Trocar "taxa paga na secretaria" por
"pagamento confirmado pelo webhook" é substituir a **fonte do item**, não o mecanismo. O caminho é
`PIX pago → item PAYMENT = RECEIVED → obrigatórios resolvidos → vaga confirmada`, idempotente por
transação.

**Riscos e invariantes que não podem ser quebrados.** (a) **Dinheiro não pode depender do RLS
sozinho**: toda transação entra na trilha, com idempotência por `(provider, externalId)`; (b) o
webhook é **fonte de verdade**, mas a tela deve poder reconciliar por conta própria (webhook perdido
é rotina, não exceção); (c) **pagamento não pode bloquear emissão de certificado** (invariante nº 8
ao contrário: o documento do participante não depende da decisão financeira); (d) nada de guardar
dado de cartão — o checkout é do provedor, nós guardamos **referência**, nunca PAN; (e) **NFS-e**
é municipal: entra como **registro e aviso** ("nota emitida por", número, link do PDF), não como
emissor fiscal nosso na primeira versão.

**Dívidas que esta fase quita de passagem:** C6 (reconciliação banco × bucket ganha a mesma
régua no lado do dinheiro), C7 (rebaixar equipe para participante fica visível quando há
pagamento envolvido), E1 (fila de espera com prazo — a vaga paga precisa dela), E49 (prazo-limite).

**Tamanho:** **uma fase grande**, provavelmente a maior já feita — e a única que eu dividiria em
duas se o escopo vier inteiro: **F41a** (lote, categoria, cupom, PIX, webhook, conciliação) e
**F41b** (cartão, parcelamento, split, estorno, recibo/NFS-e).

---

### P2 — Publicação científica: anais com DOI, ISBN/ISSN e citação 🔴

**Por que decide contrato.** É *o* motivo pelo qual a Even3 é contratada: sem DOI, o autor não
pontua no Lattes, e sem Lattes o evento perde submissão no ano seguinte.

**O que entra.** Página pública de **anais** por evento (indexável: metatags Dublin Core e
Highwire Press), **um registro por trabalho aprovado** (título, autoria na ordem de crédito,
resumo, paginação, DOI, trilha), **exportação de citação** (ABNT, APA, BibTeX), **PDF do trabalho**
com a página de anais, **ISBN/ISSN** do conjunto e **depósito de DOI na Crossref** (prefixo da
instituição, XML de depósito, *status* por trabalho e reprocessamento).

**O encaixe que já existe.** A decisão do comitê, a autoria com ordem de crédito, a trilha e o
arquivo da submissão já estão no banco desde as FASES 4/17/33. Falta a **camada de publicação** —
e ela é sobretudo **catálogo + XML**, não um motor novo.

**Riscos.** DOI exige **contrato com a Crossref** (prefixo pago, por instituição) e um
**compromisso de permanência** (URL que não pode morrer) — o que significa que os anais públicos
não podem depender de sessão, cookie ou tenant ativo. Se a instituição for suspensa, o DOI já
depositado continua apontando: é a primeira coisa do sistema com **obrigação pós-contrato**.

**Tamanho:** uma fase média-grande. Rende **desproporcionalmente** em percepção de valor
acadêmico.

---

### P3 — App do participante (PWA) e engajamento 🟡🔴

**O que entra.** PWA instalável com **agenda pessoal** (minha programação, com choque de horário),
**meu crachá**, **meus certificados**, **caixa de entrada**, **notificações push** (Web Push) para
"começa em 10 minutos", **networking** (perfil, interesses, contato com consentimento) e
**matchmaking** simples por trilha/tema.

**Por que agora não é urgente, mas é inevitável.** O público compara com Whova e Cvent. Hoje
temos tudo isso em web — o PWA é **empacotamento + push + offline**, não um segundo produto. E o
service worker **já existe** na prática para o credenciamento offline (F35), então a casa já
conhece o padrão.

**Riscos.** Push exige VAPID e consentimento; matchmaking com dado pessoal exige decisão de
privacidade explícita (e a E44/E45 mostram que a casa leva isso a sério). Não fazer app nativo
nesta altura.

**Tamanho:** uma fase média.

---

### P4 — Lead retrieval para patrocinador e expositor 🟡 *(receita direta)*

**O que entra.** O expositor lê o **QR do crachá** pelo celular e captura o lead (nome, e-mail,
instituição, consentimento explícito na hora), com **relatório por expositor** (quantos, quem,
quando, exportação CSV) e **sessão de captura** por estande. O organizador define o que o
patrocinador enxerga e por quanto tempo.

**O encaixe.** O QR do crachá carrega só o código (ADR-152), o crachá é da pessoa no evento, e o
balcão já lê QR. Falta a **organização de leitura** (papel `EXHIBITOR` com escopo de evento), o
consentimento e o relatório.

**Riscos.** É a funcionalidade mais delicada em **LGPD**: lead sem consentimento é dado pessoal
vazado para terceiro. O desenho tem de ser "o patrocinador recebe o que a pessoa autorizou naquele
instante", com revogação e prazo (mesma régua da E44).

**Tamanho:** uma fase média, e provavelmente a de **melhor retorno por esforço** comercial —
patrocínio com relatório vale mais caro.

---

### P5 — API pública, webhooks e integrações institucionais 🟡

**O que entra.** Token de API por instituição com escopos, endpoints de leitura (eventos,
inscrições, presenças, certificados), **webhooks** de eventos do domínio (inscrição criada,
pagamento confirmado, certificado emitido, presença registrada) com assinatura, **SSO
institucional** (OIDC/SAML — universidades federais pedem login único) e **importação/exportação**
de participantes em formatos que a secretaria usa.

**Por que importa.** É o que separa "ferramenta que a secretaria usa" de "plataforma que a
instituição integra ao seu ERP/CRM". Também é o caminho para LGPD de exportação: webhook com
escopo estreito substitui o CSV solto (E44).

**Tamanho:** uma fase média.

---

### P6 — Comunicação de verdade: campanhas, segmentação e opt-out 🟡

Hoje temos **transacional** (16 templates, outbox, dedupe) e mensagem direta. Falta o **mala
direta**: segmento (não compareceu, tem certificado pendente, por trilha, por categoria),
**agendamento de campanha**, relatório de abertura/clique, **central de preferências** e
**webhook de entrega** do provedor. Quita **D7/D8/D9** e dá ao organizador a ferramenta que hoje
ele resolve no Mailchimp — e o nosso diferencial é que o segmento nasce do **fato** (presença,
certificado, pagamento), não de uma lista importada.

**Tamanho:** uma fase média.

---

### P7 — Acessibilidade, tema escuro e regressão visual 🟡 *(dívida acumulada, barata de quitar)*

`@axe-core` (H5), tema escuro de verdade (H3), snapshot visual (H6), composição das telas antigas
(H1), **mover por teclado** no palco do editor (E55) e no quadro (E51), a METADE restante da E50
(ação em linha que não depende de hidratação). Não vende sozinho, mas é o que sustenta uma
**licitação pública** (edital costuma exigir acessibilidade) e o que evita a regressão silenciosa
de design.

**Tamanho:** meio/mutirão (é literalmente o formato da FASE 12).

---

### P8 — Inteligência para a comissão e prestação de contas 🟡

Relatório do comitê (submissões por trilha, taxa de aceite, distribuição de notas, carga de
pareceristas — parte disso já existe e não tem tela), **dashboards do evento** (inscritos ×
presentes × certificados × receita), **prestação de contas** para órgão de fomento (relatório PDF
com números auditáveis) e **antifraude de proximidade** no credenciamento (F6).

**Tamanho:** uma fase média, e ótima candidata a **combo** com P1 (o financeiro precisa do
relatório).

---

## 6. Sequência proposta (o que eu faria, nesta ordem)

| Ordem | Fase sugerida | Tema | Tamanho | Por que nesta posição |
|---|---|---|---|---|
| 1º | **F41** | **Inscrição paga, PIX e conciliação** | grande | É a lacuna que impede a venda como plataforma principal, e ela se apoia no mecanismo de vaga retida + checklist que **já existe**. Se o escopo vier inteiro, dividir em F41a (PIX + lote + cupom) e F41b (cartão + split + estorno + NFS-e). |
| 2º | **F42** | **Anais, DOI Crossref e citação** | média-grande | Fecha o ciclo acadêmico e é **o** argumento de renovação anual. Só depende de contrato de prefixo DOI. |
| 3º | **F43** | **Lead retrieval do expositor** | média | Melhor retorno comercial por esforço: transforma patrocínio em relatório e valoriza a cota. Reusa QR do crachá que já existe. |
| 4º | **F44** | **App PWA do participante + push** | média | O que o público sente. Reusa service worker do credenciamento offline. |
| 5º | **F45** | **API pública, webhooks e SSO** | média | Abre a porta institucional (ERP/CRM) e substitui exportação solta por integração com escopo. |
| — | **Mutirão** | Acessibilidade + dívidas baratas (H1, H3, H5, H6, E50-metade, E51, E55, B6, B8, D9) | pequeno cada | Encaixa entre fases grandes, como na FASE 12. Quita o que dá atrito sem brilho. |

**Antes de qualquer uma delas, um ajuste de 10 minutos no repositório:** `docs/dividas-tecnicas.md`
ainda lista **E8** (exportação em ZIP) como aberta, e o lote em ZIP foi entregue na **FASE 36**.
Documento de dívida desatualizado é dívida também.

---

## 7. O que eu **não** faria (anti-roadmap)

* **Marketplace de descoberta de eventos.** É o negócio da Sympla, exige massa crítica de público
  e marketing de performance — e não é por onde a instituição nos escolhe.
* **Streaming/híbrido próprio.** Integração com Zoom/Meet, no máximo. Sala de vídeo é outro
  produto, com CDN e plantão.
* **App nativo iOS/Android.** PWA primeiro; nativo só com demanda paga comprovada.
* **Ser gateway/adquirente.** Nunca tocar em dado de cartão; o provedor é o dono do checkout.
* **Emissor fiscal na primeira versão de pagamento.** NFS-e entra como registro/aviso; emitir nota
  é obrigação municipal com regra própria.
* **IA generativa como funcionalidade.** Sem fonte de verdade no repositório vira enfeite caro;
  o gancho útil é busca semântica nos anais (depois da F42).
* **Internacionalização completa.** pt-BR é o mercado; inglês/espanhol só quando houver contrato
  que pague a tradução.

---

## 8. Como saberemos que funcionou

| Métrica | Hoje | Meta com F41–F43 |
|---|---|---|
| Eventos com inscrição paga | 0 | a maioria dos eventos de médio porte |
| Receita de taxa de plataforma | inexistente | previsível, por evento |
| Trabalho aprovado com DOI | 0 | 100% dos elegíveis, por evento |
| Expositores que recebem relatório de leads | 0 | todos os patrocinadores com estande |
| Tempo da secretaria por evento (credenciamento + certificados) | já muito baixo | manter, com pagamento dentro da mesma esteira |
| NPS do comitê científico | não medido | medir na F42 (é quem renova o contrato) |

---

## 9. Recomendação e o que eu preciso de você

**Recomendo começar pela F41 — inscrição paga, PIX e conciliação.** Três razões: é a maior lacuna
comercial; é a única que destrava **receita**; e ela **reaproveita** o mecanismo de vaga retida +
checklist + prazo que as FASES 34/37 já entregaram, em vez de abrir um subsistema paralelo.

Três decisões que são suas, antes de eu escrever a primeira linha:

1. **Escopo da F41:** PIX + lote + cupom (F41a) **ou** o pacote com cartão, split, estorno e NFS-e
   (F41a + F41b)?
2. **Provedor de pagamento:** Mercado Pago, Pagar.me, Asaas ou Stripe? (Muda o desenho do webhook,
   do split e do PIX; o resto do domínio fica igual.)
3. **Taxa da plataforma:** por ingresso vendido, assinatura por plano, ou as duas? Isso define se
   `planQuotas` vira também `planFees`.

Se preferir outro caminho, a F42 (anais + DOI) é igualmente defensável — ela **não** depende de
gateway e é o argumento mais forte no meio acadêmico. Diga o tema e eu apresento o **plano da
fase** (domínio → aplicação → interface → testes → documentação) antes de escrever código.

---

## 10. Fontes consultadas

**Concorrentes diretos (Brasil)**
* Even3 — DOI nos anais: <https://ajuda.even3.com.br/hc/pt-br/articles/4403470452109-Oferecer-DOI-aos-participantes-com-trabalhos-publicados-nos-anais-do-evento> *(403 ao abrir; dado do índice)*
* Even3 — comunicar autores sobre os anais: <https://ajuda.even3.com.br/hc/pt-br/articles/45537160439067-Comunicar-autores-sobre-a-publica%C3%A7%C3%A3o-dos-Anais> *(403 ao abrir)*
* Sympla — taxas do organizador: <https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15444341510413-Taxas-da-Sympla-para-Organizadores-Valores-e-Como-Funcionam> *(403 ao abrir)*
* Sympla — quem paga a taxa de serviço: <https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445173235085-Quem-paga-a-taxa-de-servi%C3%A7o-o-organizador-ou-o-participante> *(403 ao abrir)*
* Sympla — absorção de parcelamento: <https://blog.sympla.com.br/blog-do-produtor/como-funciona-a-absorcao-de-parcelamento-sem-juros-na-sympla/>
* Sympla — como cobrar por eventos: <https://blog.sympla.com.br/blog-do-produtor/como-cobrar-por-eventos/>
* Doity — trabalhos científicos: <https://doity.com.br/trabalhos-cientificos> · plataforma: <https://doity.com.br/en/>

**Globais e enterprise**
* Eventbrite — sistema gratuito: <https://www.eventbrite.com/event-ticketing/free-system/> · planos: <https://www.eventbrite.es/help/pt-pt/articles/193833/[slug]/>
* Whova — visão geral: <https://whova.com/pages/whova-overview/> · softwares acadêmicos: <https://whova.com/blog/best-academic-conference-management-software/>
* Cvent — engajamento do participante: <https://release.cvent.com/eventmanagement/announcements/attendee-engagement-releases-for-may-6-2026> · novidades: <https://release.cvent.com/eventmanagement/announcements/product-news-digest-for-january-28-2026>
* Fourwaves — alternativa ao Oxford Abstracts: <https://fourwaves.com/blog/oxford-abstracts-alternative/>

**Lead retrieval**
* Guia de oferta (IASLC/WCLC 2026): <https://wclc.iaslc.org/wp-content/uploads/2026/03/LR_OfferingGuide_WCLC26.pdf>
* Manual do expositor (Informa): <https://informaconnect.com/medtech-summit-exhibitor-manual/lead-retrieval/>

**Fiscal (Brasil)**
* Consulta SF/DEJUG nº 6/2022 (ISSQN e NFS-e, São Paulo): <https://www.prefeitura.sp.gov.br/cidade/upload/sc_06-2022_1647169937.pdf>

---

## 11. Como manter este documento

Este é um documento de **decisão de produto**, não de fase. Ele deve ser revisado quando: (a) uma
fase do roadmap for entregue (mover o item para "feito" e recontar); (b) aparecer um concorrente
novo no nicho acadêmico; (c) o humano escolher um caminho fora desta ordem — a escolha vira a
linha "por que não seguimos a ordem sugerida". Números de teste, ADR, tabela e migração **não**
devem ser copiados para cá em detalhe: a fonte é o `AGENTS.md` e o documento da última fase.
