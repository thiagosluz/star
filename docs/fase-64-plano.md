# FASE 64 — página pública da instituição (PLANO aprovado)

> **Estado: EM ANDAMENTO.** Este arquivo guarda as decisões já tomadas pelo humano e o recorte das
> fatias, para o trabalho atravessar sessões sem depender da conversa. O documento da fase
> (`docs/fase-64-pagina-da-instituicao.md`) nasce na entrega, com ADRs, lições, evidências e checklist.

## Decisões do humano (não reabrir)

1. **Editor de blocos, como no evento**, + o **histórico de eventos automático** (não é bloco opcional).
2. **Os três grupos vêm das DATAS**: `em breve` (começa depois de agora) · `acontecendo` (a janela
   contém agora) · `antigos` (terminou), no **fuso da instituição**, com **limite por grupo** e
   **"ver todos"**. Nada de curadoria manual.
3. **A instituição tem tema próprio, como o evento** — e **o claro/escuro do VISITANTE continua
   valendo por cima da paleta dela**.
   - Isto **difere de propósito** da página do **evento** (F61/ADR-325: lá o modo é do organizador).
     Razão: a página da instituição vive **dentro do casco da plataforma** (cabeçalho, rodapé e o
     controle de aparência da F63), então a escolha do visitante não pode desaparecer ali.
   - Consequência: **E84 fica quitada para a página da instituição** e segue aberta para a do evento.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **Fundação** | Domínio puro (blocos reusando as regras do editor do evento + a regra dos três grupos por data, no fuso da instituição) · tabela `tenant_public_pages` (blocos em JSON) **sob RLS + FORCE** + migração · repositório por `withTenant` · serviços de leitura (render), gravação (com trilha) e publicação (rascunho × publicado) |
| 2 | **Página pública** | `/t/<slug>`: capa, descrição, identidade, os três grupos com limite e "ver todos", e os blocos — tudo **lido na renderização**, com **um único `<main>`**, o rodapé da F63 (aparência) e a paleta da instituição com o modo do visitante por cima |
| 3 | **Editor do organizador** | `/t/<slug>/administracao/pagina`: descrição, capa por upload (WebP, original apagado, quota conferida **antes** de assinar a URL), blocos e **prévia pelo mesmo componente da página real**, publicar/despublicar |
| 4 | **Capa e tema** | Capa da instituição (arquivo + recorte) e a paleta dela, publicando os papéis `--ef-*` como o tema do evento faz, **sem** matar o claro/escuro do visitante |
| 5 | **Catracas e documento** | Unidade · integração (RLS, rascunho × publicado) · E2E (organizador edita → público muda; anônimo lê **sem sessão**; os três grupos com fixtures de data) · **portão WCAG AA** com a tela nova · **regressão visual** · `docs/fase-64-*.md` (ADR-331+) · `README.md`/`AGENTS.md` · **E84** quitada para a instituição |

## Regras da casa que valem aqui

- **Runtime só por `withTenant`** (RLS + FORCE na tabela nova), nunca `adminPrisma`.
- **Documento é dado, não tela**: a página pública **lê** os eventos na renderização; nada de copiar
  evento para dentro do bloco (a lição da F33).
- **Regra pura no domínio**, sem Prisma nem Next, provada sem navegador.
- **Sem `any`**, `kebab-case.ts`, comentários explicam **POR QUE**, tudo em português.
- **Catraca nova só morde se provada por mutação** — e a suíte visual (`f62-regressao-visual`) e o
  portão (`accessibility.spec.ts`) ganham a tela nova **sem isenção**.
- Bateria da §4 do `AGENTS.md` antes de declarar concluído, com os **números reais**.
