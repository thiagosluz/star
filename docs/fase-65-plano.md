# FASE 65 — O dia do evento na mão do participante (PLANO aprovado)

> **Estado: EM ANDAMENTO.** Guarda as decisões já tomadas pelo humano e o recorte das fatias, para
> o trabalho atravessar sessões sem depender da conversa. O documento da fase
> (`docs/fase-65-dia-do-evento.md`) nasce na entrega, com ADRs, lições, evidências e checklist.

## Decisões do humano (não reabrir)

1. **"Minha grade" = FAVORITOS ∪ INSCRIÇÕES**, com marcas visuais distintas. **Favoritar NÃO consome
   vaga** — quem garante lugar é a inscrição (loteria, lista de espera e quota seguem intactas).
2. **O detector de choque SÓ AVISA, nunca bloqueia** (na escolha, na agenda e no resumo). A casa não
   decide pelo participante. Aviso sobre o **intervalo puro** — margem de deslocamento entre salas
   fica declarada como dívida.
3. **Exportação: arquivo + Google agora** (`.ics` por atividade e da grade inteira, botão do Google;
   o Apple entra pelo próprio arquivo). **Assinatura webcal fica como dívida declarada.**
4. **"Acontecendo Agora": aba na página do evento + faixa no topo da programação** quando houver algo
   em curso.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **Fundação** | `activity_favorites` (RLS + FORCE + migração) e serviços por `withTenant`; **regra pura de sobreposição** com as bordas decididas (encostar não é choque; conter é); **regra pura da grade** (união com marcas distintas); **gerador `.ics`** (RFC 5545: dobra em 75 octetos, CRLF, escape, `UID` estável, UTC a partir do fuso do evento) |
| 2 | **Minha agenda e favoritar** | Botão de favoritar na programação **funcionando sem JavaScript** (form + Server Action); **aviso visual de choque** que nunca bloqueia; tela **"minha agenda"** (favoritos ∪ inscrições, com o resumo de choques) |
| 3 | **Exportação 1-clique** | Rota do `.ics` (por atividade e da grade inteira) e o link do Google Calendar; E2E conferindo o **conteúdo** do arquivo |
| 4 | **Acontecendo Agora** | Aba na página do evento decidida **no servidor, no fuso do evento**; faixa no topo da programação; atividades **em andamento por sala**; **barra de progresso acessível** (tempo restante em texto, não decorativo); link direto para o **crachá do participante** ou o **balcão** (com permissão) |
| 5 | **Catracas e documento** | Unidade + integração (RLS, favoritar/desfavoritar, isolamento) + E2E; **portão WCAG AA** com as telas novas sem isenção; **regressão visual** com a barra do "agora" **mascarada** (relativa ao relógio — lição da F64); `docs/fase-65-dia-do-evento.md` (ADR-334+) e as atualizações de `README.md`, `AGENTS.md` e dívidas |

## Regras da casa que valem aqui

- **Runtime só por `withTenant`** (RLS + FORCE na tabela nova), nunca `adminPrisma`.
- **Regra pura no domínio** (sobreposição, grade) — provada sem navegador; o `.ics` é formatação e
  mora fora do domínio, com teste de unidade contra os casos do RFC.
- **O "agora" é decidido no servidor**, no fuso do evento (`formatZonedDateTime`/régua da F24/F57).
- **Sem `any`**, `kebab-case.ts`, erros como valor, comentários explicam **POR QUE**, tudo em português.
- **Catraca nova só morde se provada por mutação**; nenhuma isenção nova no portão de acessibilidade.
- Bateria da §4 do `AGENTS.md` antes de declarar concluído, com os **números reais**.
