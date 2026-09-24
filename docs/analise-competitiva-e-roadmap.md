# Análise Competitiva de Mercado & Roadmap Estratégico do EventFlow

> **⚠️ DOCUMENTO HISTÓRICO — leia com a data em mente.** Este levantamento é de **setembro de 2026**,
> com **39 fases** concluídas (2014 testes, 218 ADRs) e **antes da FASE 40**. Desde então o **editor
> visual do certificado** foi entregue (o gap de moldura drag-and-drop da §2 **não existe mais**),
> o lote de certificados em ZIP saiu na FASE 36, e as contagens daqui estão desatualizadas. A
> leitura **atualizada** — matriz de capacidades revista e sequência proposta de F41 em diante — é
> **[`docs/roadmap-de-produto.md`](roadmap-de-produto.md)**; este documento fica como registro do
> diagnóstico original.

> **Documento de Inteligência Competitiva e Estratégia de Produto.**
> Elaborado via `/orchestrate` (coordenação multi-agente: `explorer-agent`, `product-manager`, `product-owner`, `backend-specialist`).
> Data de consolidação: **Setembro de 2026** (com a base em 39 fases concluídas, 218 ADRs, 2014 testes unitários/integração e 137 testes E2E).

---

## 1. Sumário Executivo

O **EventFlow** atingiu um nível de maturidade técnica e arquitetural raro em plataformas SaaS brasileiras:
- Isolamento multi-tenant real com **PostgreSQL 18 Row-Level Security (RLS) FORCED** em todas as 51 tabelas de tenant;
- **Domínio puro** desacoplado de ORM e framework, garantindo regras blindadas e testadas;
- **Credenciamento offline-first** com IndexedDB, emissão de crachás em folha adesiva A4 milimétrica e impressora térmica (ZPL II);
- **Sorteios criptográficos de palco** com esquema *commit-reveal* (SHA-256), telão ao vivo e auditoria verificável no navegador;
- **Gamificação com livro-razão idempotente**, cartas colecionáveis com acabamento foil, missões e níveis;
- **Submissão acadêmica e chamadas de propostas (CFP)** com avaliação cega, prevenção de conflito de interesse e rubricas livres com até 12 critérios;
- **Portal do palestrante** completo e **quadro de demandas operacionais (Kanban)** funcional inclusive sem JavaScript.

### Diagnóstico de Mercado
Quando comparado aos dois maiores gigantes do mercado nacional:
1. **Even3 (Líder Acadêmico):** O EventFlow já possui motor de submissão, credenciamento, design e segurança amplamente superiores à Even3. O que falta para superá-la comercialmente é **fechar o ciclo acadêmico final (publicação dos Anais com depósito de DOI Crossref)** e **monetização (cobrança de inscrições e taxas)**.
2. **Sympla (Líder Corporativo / Entretenimento):** O EventFlow possui muito mais rigor em credenciamento, certificação e engajamento, mas a Sympla domina pela **facilidade de checkout (Pix, cartão, parcelamento, split automático)** e pelo **marketplace de descoberta de eventos**.

---

## 2. Matriz Comparativa Detalhada

| Recurso / Dimensão | **Even3** | **Sympla** | **EventFlow (Estado Atual)** | **Impacto Estratégico** |
|---|---|---|---|---|
| **Arquitetura & Segurança** | Monolito tradicional, multi-tenancy lógico no código | Microsserviços B2C | Next.js 16 + RLS PostgreSQL 18 + PgBouncer transacional + ClamAV | 🟢 **Vantagem EventFlow:** Compliance LGPD absoluto, sem risco de vazamento entre instituições. |
| **Monetização & Checkout** | Inscrições pagas por categoria, taxa por trabalho submetido | Ingressos em lote, parcelamento 12x, Pix instantâneo, split automático | **Inscrições 100% gratuitas** (sem motor de gateway ou checkout financeiro) | 🔴 **Gap Crítico:** É o motor de receita de qualquer plataforma comercial de eventos. |
| **Submissão & Revisão por Pares** | Completo, porém com interface antiga e engessada | Inexistente | Estado da arte: rubricas livres (até 12 critérios), avaliação cega, CFP universal | 🟢 **Vantagem EventFlow:** Experiência moderna e flexível para comissões científicas. |
| **Publicação de Anais & DOI** | Depósito direto de DOI (Crossref), anais com ISBN/ISSN, Google Acadêmico | Inexistente | Ainda não possui página pública de Anais nem depósito de DOI | 🔴 **Gap Acadêmico:** Pesquisadores exigem DOI para comprovação no Currículo Lattes. |
| **Credenciamento & Balcão** | App móvel básico; depende de internet estável | App Sympla Organizador veloz, foco em validar ingresso | Offline-first via IndexedDB, ZPL II nativo, etiquetas milimétricas, proteção contra bipes duplos | 🟢 **Vantagem EventFlow:** Imune a quedas de internet em centros de convenções. |
| **Gamificação & Retenção** | Inexistente | Inexistente | Cartas colecionáveis, XP auditável, missões, temporadas | 🟢 **Super Trunfo:** Retenção incomparável do público jovem e corporativo. |
| **Sorteios de Palco** | Manual / ferramentas externas opacas | Inexistente | Commit-reveal criptográfico, telão com roleta ao vivo, auditoria pública no browser | 🟢 **Super Trunfo:** Transparência total para eventos patrocinados. |
| **Portal do Palestrante** | Gestão básica de programação | Painel simples de produtor | Portal com posse de conta, controle de visibilidade de arquivos e certificado próprio | 🟢 **Vantagem EventFlow:** Reduz drasticamente o trabalho da secretaria do evento. |
| **Experiência de Patrocínio** | Logotipo em páginas e certificados | Banner estático no hotsite | Cotas com limite atômico, biblioteca de mídia e janela de exibição | 🟡 **Oportunidade:** Falta o coletor de leads (Lead Retrieval) via QR Code para expositores. |
| **Certificação** | Forte em modelos; gera múltiplos papéis | Básico por e-mail | Assinatura HMAC-SHA256, hash de integridade, lote ZIP em streaming, validação pública | 🟡 **Paridade:** Falta editor visual drag-and-drop de molduras. |

---

## 3. Os 4 Grandes Gaps Comerciais do EventFlow

### Gap 1: Motor Financeiro & Ticketing (Prioridade Máxima)
- **Problema:** Nenhuma conferência de médio/grande porte opera apenas com ingressos gratuitos. As plataformas tradicionais cobram entre 8% e 10% por inscrição transacionada.
- **Solução necessária:**
  1. Cadastro de ingressos e lotes com datas de vigência e quotas;
  2. Categorias de público (ex: Estudante de Graduação, Pós-graduando, Professor, Sócio);
  3. Checkout integrado com Pix dinâmico (confirmação em segundos via webhook) e Cartão de Crédito;
  4. Split de pagamento nativo (o dinheiro cai direto na conta bancária do organizador, com retenção automática da taxa de serviço do EventFlow).

### Gap 2: Publicação Científica Completa & DOI Crossref
- **Problema:** Em eventos acadêmicos, a Even3 é contratada principalmente para gerar os **Anais do Evento com DOI**, que os pesquisadores precisam para pontuar na CAPES/CNPq.
- **Solução necessária:**
  1. Módulo de Anais públicos com indexação automática (metatags Dublin Core e Highwire Press para leitura direta pelo Google Acadêmico);
  2. Exportação de citações acadêmicas automáticas (ABNT, APA, BibTeX);
  3. Integração com API da Crossref para emissão e depósito de DOI por artigo aprovado;
  4. Registro de ISSN / ISBN para os anais da conferência.

### Gap 3: Lead Retrieval para Patrocinadores (Monetização B2B)
- **Problema:** Empresas pagam cotas de patrocínio para capturar contatos nos seus estandes.
- **Solução necessária:**
  1. Credencial de expositor/estande associada ao patrocinador do evento;
  2. O expositor usa a câmera do próprio celular para ler o QR Code do crachá do participante (`event_credentials`);
  3. Registro instantâneo do lead com tags de interesse comercial, anotações de conversa e consentimento LGPD;
  4. Exportação do relatório de leads ao término do evento.

### Gap 4: Editor Visual de Certificados Multi-Papel
- **Problema:** Cada reitoria ou empresa possui uma diagramação rígida para certificados, exigindo diferentes modelos para ouvinte, palestrante, comissão organizadora e apresentador de trabalho.
- **Solução necessária:**
  1. Upload de imagem de fundo personalizada (A4 horizontal em alta resolução);
  2. Posicionamento visual das variáveis dinâmicas (`{nome}`, `{cpf}`, `{titulo_trabalho}`, `{autores}`, `{carga_horaria}`, `{qr_code}`);
  3. Emissão segmentada por papel desempenhado no evento.

---

## 4. Roadmap Estratégico em 4 Horizontes

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              ROADMAP ESTRATÉGICO                                       │
├─────────────────────────┬─────────────────────────┬────────────────────────────────────┤
│ HORIZONTE 1 (F40 - F42) │ HORIZONTE 2 (F43 - F45) │ HORIZONTE 3 (F46 - F48)            │
│ Monetização & Ingressos │ Publicação Acadêmica    │ Experiência B2B & Patrocínio       │
├─────────────────────────┼─────────────────────────┼────────────────────────────────────┤
│ • Lotes de ingressos    │ • Anais públicos online │ • Coletor de leads p/ expositores │
│ • Checkout Pix & Cartão │ • Indexação Google Acad.│ • Editor visual de certificados    │
│ • Split de pagamento    │ • Depósito DOI Crossref │ • Gamificação de estandes          │
│ • Descontos e cupons    │ • Citações ABNT/BibTeX  │ • Networking entre participantes   │
└─────────────────────────┴─────────────────────────┴────────────────────────────────────┘
```

### 📍 Horizonte 1: Monetização, Ticketing & Checkout (O Motor de Receita)

#### Fase 40 — Catálogo de Ingressos, Lotes e Categorias
* **Modelagem:** Tabela `ticket_tiers` vinculada a `events` e `activities` (lote, valor em centavos, vigência, vagas, categoria).
* **Regras de Negócio:**
  - Virada automática de lotes (por data-limite no fuso do evento ou por esgotamento de quota);
  - Cupons de desconto (percentual ou valor fixo, com limite de uso, validade e case-insensitive);
  - Ingressos do tipo combo (evento principal + N minicursos);
  - Comprovação de categoria: reuso do motor de `registration_confirmation_items` (Fase 37) para exigir anexo de comprovante estudantil/funcional antes da confirmação.

#### Fase 41 — Checkout Transacional e Pagamentos (Pix & Cartão)
* **Arquitetura de Checkout:**
  - Reserva temporária de vaga com TTL (lock atômico de 15 minutos para conclusão do pagamento);
  - Emissão de Pix Dinâmico Copia-e-Cola com QR Code instantâneo;
  - Pagamento com Cartão de Crédito e parcelamento;
  - Fila BullMQ para consumo assíncrono e idempotente de webhooks do gateway (`order_transactions`), imune a retentativas de rede.

#### Fase 42 — Split de Pagamentos e Painel Financeiro
* **Split Multi-Tenant:**
  - Configuração de conta bancária de recebimento pelo organizador (via Stripe Connect, Asaas Split ou Pagar.me);
  - Retenção automática da taxa de serviço da plataforma no ato do pagamento;
  - Relatório financeiro detalhado no painel da instituição: receita bruta, taxas, líquido a receber, estornos e gráficos de vendas.

---

### 📍 Horizonte 2: Excelência Acadêmica (Dominando o Mercado da Even3)

#### Fase 43 — Anais do Evento (Proceedings) & Indexação Científica
* **Anais Online:**
  - Agrupador de publicações organizado por volume, edição e trilha temática;
  - Página pública dos Anais com busca facetada (por título, autor, resumo e palavras-chave);
  - Metatags de indexação acadêmica (Highwire Press / Dublin Core) para indexação direta no Google Acadêmico;
  - Exportação de citações no formato ABNT (NBR 6023), APA e BibTeX com um clique.

#### Fase 44 — Integração Crossref & Atribuição de DOI
* **Depósito de DOI:**
  - Integração com a API do Crossref para registro e ativação de DOI por artigo publicado;
  - Geração de XML automatizado no schema oficial Crossref;
  - Registro de metadados de ISSN / ISBN para os anais da edição.

#### Fase 45 — Certificação Avançada por Papéis & Editor Visual
* **Multi-papéis:**
  - Certificados automáticos para: Ouvinte, Apresentador de Trabalho (com título e autores), Avaliador de Trabalhos e Comissão Organizadora;
  - Editor visual de layout de certificado: upload da moldura/background e arranjo de variáveis dinâmicas.

---

### 📍 Horizonte 3: B2B, Engajamento e Monetização de Patrocinadores

#### Fase 46 — Lead Retrieval para Patrocinadores e Expositores
* **Coleta de Leads no Estande:**
  - Perfil de expositor vinculado à cota de patrocínio;
  - Leitura do QR Code do crachá do participante (`event_credentials`) via câmera do smartphone do expositor;
  - Classificação do lead com tags de interesse, notas rápidas e consentimento LGPD;
  - Exportação da lista de contatos em planilha ao fim do evento.

#### Fase 47 — Gamificação de Estandes & Missões de Patrocinadores
* **Engajamento nos Estandes:**
  - Missões de visitação aos patrocinadores: visitar 5 estandes para liberar uma carta especial/rara do evento;
  - Mecânica de check-in em estande integrada ao livro-razão de XP.

---

### 📍 Horizonte 4: Escala, Distribuição e Mobilidade

#### Fase 48 — PWA do Participante & Organizador
* Interface PWA instalável com navegação nativa, agenda pessoal interativa ("minha grade"), notificações push e crachá salvo offline na tela inicial.

#### Fase 49 — Marketplace Público de Eventos (`/eventos`)
* Diretório aberto com busca geográfica e temática de eventos abertos para inscrição na plataforma (criando o mesmo efeito de rede de descoberta da Sympla).

---

## 5. Como Utilizar Este Documento

Este documento serve como a **bússola estratégica** para o momento em que a decisão de priorização for tomada:
1. Caso a meta seja **monetização e tração comercial imediata**, iniciar pela **Fase 40 (Catálogo de Ingressos, Lotes e Categorias)**;
2. Caso a meta seja **captar clientes acadêmicos e universidades concorrendo com a Even3**, priorizar as **Fases 43 e 44 (Anais e DOI Crossref)**;
3. Todas as fases propostas seguem estritamente o protocolo do `AGENTS.md`: requisitos definidos, código limpo em domínio puro, cobertura rigorosa de testes, migrações com RLS intacta e registro de ADRs sequenciais.
