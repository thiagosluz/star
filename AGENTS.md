# AGENTS.md — Protocolo de trabalho do EventFlow

> **Este arquivo é o primeiro que uma sessão de agente deve ler.**
> Ele existe porque a memória durável deste projeto é o **repositório**, não a
> conversa: uma sessão nova não lembra de nada do chat anterior, mas encontra aqui o
> combinado de como trabalhar, o que verificar e onde as coisas estão.

---

## 1. O que é este projeto

**EventFlow** — plataforma SaaS multi-tenant para eventos acadêmicos, corporativos e
comunitários: eventos e inscrições, submissão de trabalhos com avaliação por pares,
gamificação (XP, cartas, missões) e certificação com validação pública por QR Code.

**Estado atual:**

```text
Fases concluídas ........ 1 a 11B (docs/fase-NN-*.md)
Testes ................. 775 (Vitest: unit + integração) + 42 (Playwright E2E)
ADRs ................... 70 (numeração GLOBAL e sequencial — a próxima é ADR-071)
Permissões ............. 54 (11 papéis, 4 escopos)
Tabelas de tenant ...... 31 sob RLS + FORCE
Qualidade .............. ESLint 0 · tsc 0 · next build OK
```

Stack: Next.js 16 (App Router, Server Actions) · React 19 · PostgreSQL 18 com
Row-Level Security · Prisma 7 · Redis + BullMQ · MinIO · Tailwind 4 · Vitest · Playwright.

---

## 2. O PROTOCOLO DE FASES (leia antes de escrever código)

O projeto é construído em **fases numeradas**, com um contrato rígido:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. O humano define a fase (requisitos, entregáveis obrigatórios).          │
│  2. O agente entrega a fase COMPLETA:                                       │
│        • código (domínio → aplicação → interface)                           │
│        • testes (unitários + integração + E2E)                              │
│        • documentação em docs/fase-NN-*.md                                  │
│        • comandos exatos de verificação                                     │
│  3. O agente PARA e escreve: "Aguardando APROVADO: AVANÇAR".                │
│  4. Só com a string literal "APROVADO: AVANÇAR" a próxima fase começa.      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Regras que não se negociam:**

- **Nunca** gerar o sistema inteiro de uma vez, nem "adiantar" partes da fase
  seguinte sem autorização.
- **Nunca** iniciar uma fase nova sem a string de aprovação da anterior — mesmo que
  o pedido pareça implícito ("e agora?").
- Se a fase for interrompida (falha, reinício da máquina), **retomá-la e concluí-la**
  antes de qualquer outra coisa.
- Ao terminar: rodar a bateria de verificação da seção 4 e **reportar os números
  reais**, não os esperados.

### Documento de fase — estrutura esperada

`docs/fase-NN-<tema>.md` deve conter:

1. Sumário executivo com **tabela de entregas** e **números da fase** (arquivos,
   testes, migrações).
2. O problema mais difícil da fase e por que ele define o desenho.
3. Decisões técnicas explicadas (o "porquê", com alternativas descartadas).
4. **ADRs** — contexto, decisão, justificativa, consequências. Numeração global.
5. **Lições aprendidas** — tabela de defeitos REAIS encontrados por testes, com
   sintoma → causa raiz → correção. Sem inventar: só o que aconteceu.
6. **Evidência de verificação** — saída real dos comandos.
7. Comandos operacionais.
8. **Dívidas técnicas** e pontos de atenção.
9. **Checklist de aceite** com todos os requisitos marcados.

Depois de criar/atualizar uma fase, **atualizar o `README.md`**: índice da
documentação, capacidades e contagens.

---

## 3. Convenções de código

| Regra | Detalhe |
|---|---|
| **Idioma** | Português em código, comentários, mensagens de erro, documentação e UI (produto para instituições brasileiras) |
| **Comentários** | Explicam **POR QUE**, nunca "o que". O código já diz o que faz. Comentário que só repete o código é ruído — e é removido |
| **Domínio puro** | `src/domain/**` não importa Prisma nem Next. Regras são funções puras, testáveis sem infraestrutura |
| **Sem `any`** | Tipos explícitos; uniões de string espelham os enums do schema (o domínio não importa o ORM) |
| **Erros como valor** | Serviços devolvem `{ ok: true, ... } | { ok: false, code, message, details? }` — não lançam para o chamador |
| **Comentários de bloco** | Decisões não óbvias ganham um bloco `// ───` explicando a armadilha evitada |
| **Nomes de arquivo** | `kebab-case.ts`; domínio em `src/domain/<área>/<área>-rules.ts` |
| **Seed** | `prisma/seed.ts` executa os **serviços reais** (não grava à mão) para que o dado de demonstração nasça consistente |

---

## 4. Bateria de verificação (rodar SEMPRE antes de declarar concluído)

```bash
npm run lint          # esperado: 0 erros, 0 warnings
npm run typecheck     # esperado: 0 erros
npm test              # esperado: 775+ testes passando
npm run build         # esperado: "Compiled successfully" e a rota nova listada
npm run db:verify     # esperado: "Contrato íntegro."
npm run db:verify:isolation   # esperado: "9/9 verificações passaram."

# E2E exige o container rodando o código NOVO:
docker compose --profile app up -d --build web
docker images | grep eventflow/web        # conferir que a imagem é recente
npm run test:e2e      # esperado: 42+ testes passando
```

**Armadilha crítica de verificação:** se o `--build` falhar, o `docker compose`
**mantém o container anterior no ar** e o E2E passa a medir código que não existe.
Um `docker compose ps` dizendo "healthy" **não prova** que a imagem é a nova. Por
isso: (a) leia a saída completa do build, (b) confirme a data da imagem,
(c) confirme que a rota nova responde (307/200, não 404).

---

## 5. Armadilhas conhecidas (custaram depuração real)

| # | Armadilha | Regra |
|---|---|---|
| 1 | `.env` define `NODE_ENV=development`, carregado pelo Next no build | Use **`npm run build`** (aplica `cross-env NODE_ENV=production`); `npx next build` direto quebra em `/_global-error` |
| 2 | Tabela nova com `tenantId` nasce **sem policy** (fail-closed: a app não lê nada) | Rode `npm run db:rls` e depois `npm run db:verify` (o provisionamento descobre tabelas por introspecção desde a FASE 8) |
| 3 | Build falho + Compose preserva o container antigo → rota nova responde 404 com processo "saudável" | Confirme a imagem recriada **e** o build bem-sucedido antes do E2E |
| 4 | Arquivo `'use server'` exportando função não-async | `tsc` e ESLint **não** pegam; só o `next build` recusa ("Server Actions must be async functions") |
| 5 | React 19 **reseta o formulário** depois de uma action | Se duas ações compartilham o formulário (conferir → executar), os campos precisam ser **controlados**, senão o segundo passo usa valores padrão |
| 6 | `zod` valida objeto de forma **tudo-ou-nada** | Um campo inválido descarta os válidos: valide campo a campo quando quiser preservar o resto |
| 7 | `unknown`/objeto simples não é aceito como JSON do Prisma | Faça o cast explícito (`as unknown as object`) ao gravar em colunas `Json` |
| 8 | `lastIndexOf('xref')` acha o `xref` dentro de `startxref` | Em análise de formato, ancore a busca (`\nxref\n`) |
| 9 | Múltiplos cadastros no mesmo contexto de navegador E2E reutilizam a sessão | `page.request.post('/api/auth/sign-out')` antes de cada login |
| 10 | Rate limiter do Better Auth é em memória/por processo | `RATE_LIMIT_ENABLED=false` no container para os E2E |
| 11 | `docker compose ps` esconde erro de build quando a saída é filtrada | Nunca filtre (`Select-Object -Last 3`) a saída de um `--build` |
| 12 | Contagens escritas em prosa envelhecem (o doc da F2 dizia "50 permissões"; o código tinha 52 desde então) | **Confira no código**: `npx tsx -e "import {ALL_PERMISSIONS} from '@/domain/rbac/permissions'; console.log(ALL_PERMISSIONS.length)"` |
| 13 | No Next.js 16 `revalidateTag(tag)` exige 2 argumentos (o segundo é um perfil de `cacheLife`) | Use `revalidateTag(tag, 'max')` e `revalidatePath()` das telas afetadas |
| 14 | O Next.js empacota Proxy, páginas e Server Actions em **bundles separados**: cada um tem a própria instância dos módulos, então um `Map` de cache invalidado em uma Server Action **não** alcança o Proxy | Não coloque decisão de acesso em cache de módulo. O status do tenant é relido a cada resolução (`tenant-resolver.ts`); o cache guarda só a identidade, e vive no `globalThis` para ser um só por processo |
| 15 | `unstable_cache` **serializa** o valor: uma `Date` pode voltar como string | Cacheie números/strings (ex.: `getTime()`) e converta na leitura — `getTime()` em string estoura só em produção |
| 16 | Diagnóstico de depuração deixado na interface: a página pública exibia `cap=… mem=… can=…` para qualquer visitante | Estado interno vai para atributos `data-*`, nunca para texto visível; o teste E2E lê atributo com `evaluate`, não `innerText` |
| 17 | Dois cenários E2E com o mesmo `label` colidem no slug da instituição (`tenants_slug_key`) | Rótulo ÚNICO por cenário (`publica-inscricao`, não `publica`) |
| 18 | Cor e tamanho escritos à mão em componente (`text-gray-500`, `#4F46E5`, `text-[13px]`) sobrevivem a qualquer revisão e apodrecem o visual | **Antes de qualquer tela nova:** leia `docs/design-system.md`, importe de `@/components/ui` e rode `npx vitest run tests/unit/design-system-guard.test.ts` — a trava reprova paleta crua, hexadecimal e tamanho arbitrário |

---

## 6. Ambiente e acesso

```bash
cp .env.example .env
npm install
docker compose up -d            # postgres, redis, minio (+ provisionamento de buckets)
npm run db:setup                # migrate + rls + verify + isolation + seed
npm run dev                     # http://localhost:3000
docker compose --profile app up -d --build   # + web e worker (fila de certificados)
```

Portas: **3000** app · **5432** postgres · **6379** redis · **9000/9001** MinIO.

### Contas do seed — **não têm senha**

`ana@`, `bruno@`, `carla@`, `diego@example.test` existem para exercitar RBAC e
tenancy; elas **não têm linha em `account`**, então login por senha falha — e isso é
intencional. Para usar a interface com elas:

1. crie uma conta em `/signup`;
2. vincule-a (`user_tenant_profiles`, `status = ACTIVE`, com `tenantId`) e conceda um
   papel (`role_assignments`, ex. `role = 'ADMIN'`, `scope = 'TENANT'`).

O caminho mais rápido é reaproveitar `tests/e2e/helpers.ts` (`linkUser` + `grantRole`)
ou o Prisma Studio (`npm run db:studio`).

### Contas de teste com senha — o caminho rápido para testar a interface

```bash
npm run db:seed:dev      # uma conta por perfil (os 10 papéis + estados de borda)
# senha de todas: EventFlow@2026   ·   doc: docs/contas-de-teste.md
```

15 contas `@eventflow.test`: `superadmin@`, `owner@`, `admin@`, `organizador@`,
`organizador-evento@`, `presidente@`, `revisor@`, `palestrante@`, `equipe@`,
`participante@`, `patrocinador@`, `multi@`, `convidado@`, `suspenso@`, `semvinculo@`.
O script é idempotente, **regrava a senha** em cada execução e **recusa rodar com
`NODE_ENV=production`**. Ele apaga e recria as PRÓPRIAS concessões (marcadas por
`reason`), então mudar um escopo no script não deixa a concessão antiga vigente.

Sobre a senha: ela vive em `account.password` (`providerId = 'credential'`, hash scrypt
do Better Auth, via `better-auth/crypto`). O campo `user.passwordHash` é **legado e não
é usado pela biblioteca** — não perca tempo com ele ao depurar login.

### Dados de demonstração

Dois tenants (`ufba-demo`, `fiocruz-demo`), 2 eventos, 4 atividades, 1 trilha com
rubrica, 2 perfis de revisor, 7 cartas, 6 missões, 9 fatos de XP, 2 certificados
emitidos (códigos impressos no fim do seed) e **1 sorteio apurado**. Percursos em
`README.md` §6.

---

## 7. Onde as coisas estão

```
docs/                  documentação por fase (ADRs, lições, evidências)
README.md              instalação, seed, contas, variáveis, scripts, índice dos docs
src/domain/**          regras puras por área (tenancy, rbac, events, review,
                       gamification, certificates, raffles, platform)
src/lib/**             aplicação e infraestrutura (db, auth, events, review,
                       gamification, certificates, raffles, admin, storage)
src/lib/platform/**    governança global (único uso de adminPrisma na aplicação)
src/app/actions/**     Server Actions — TODA autorização é verificada aqui
src/app/t/[slug]/**    (public) landing pages · (app) painel autenticado
src/app/(public)/organizacoes/**  diretório público de instituições
src/app/superadmin/**  painel de governança (404 para quem não é SuperAdmin)
src/app/instituicao-bloqueada/**  página de bloqueio de instituição suspensa
src/app/validar/**     validação pública de certificado (sem login)
src/workers/           worker BullMQ (fila de certificados)
prisma/schema.prisma   modelo de dados (camelCase citado nas colunas)
prisma/migrations/**   migrações (algumas escritas à mão: índices parciais, policies)
docker/postgres/init/  roles, extensões e policies de RLS (idempotentes)
tests/{unit,integration,e2e}
```

---

## 8. Invariantes do sistema (não quebre)

1. **RUNTIME NUNCA** usa a role admin: `withTenant()` (role `eventflow_app`, sujeita
   a RLS) para tudo da aplicação; `adminPrisma` só para CLI/seed/provisionamento e
   para `src/lib/platform/**` (governança/diretório — operação global que, sob o
   contexto de UMA instituição, devolveria contagem zero em vez de negar).
2. **Contexto de tenant por transação** (`set_config(..., true)` = `SET LOCAL`). Nunca
   `SET` global — vaza entre requisições no pool.
3. **RLS é a última linha, não a única:** layout, páginas e Server Actions autorizam;
   a policy garante que um filtro esquecido não vire vazamento.
4. **Permissão `:own` exige posse explícita** (`can(..., { ownerId })`); sem isso a
   negação é intencional (fail-closed).
5. **Concorrência é decidida no banco:** índice único parcial, `UPDATE` condicional,
   `SELECT ... FOR UPDATE`. O retorno de 0 linhas é resposta de negócio.
6. **Idempotência por chave do fato** (XP, certificado, sorteio): repetir não duplica.
7. **Documento é dado, não tela:** snapshot imutável + hash sobre conteúdo canônico;
   renderizador (PDF/SVG) é apresentação. Ordem de chaves canônicas é CONTRATO.
8. **A recompensa nunca derruba o fluxo acadêmico:** ganchos de gamificação falham em
   silêncio (log), nunca bloqueiam submissão ou parecer.

---

## 9. Estado por fase e próximos passos

| Fase | Tema | Situação |
|---|---|---|
| 1 | Infraestrutura, modelagem, RLS | ✅ |
| 2 | Autenticação, RBAC, multi-tenancy | ✅ |
| 3 | Eventos, inscrições, landing pages | ✅ |
| 4 | Submissões e avaliação por pares | ✅ |
| 5 | Gamificação (XP, cartas, missões) | ✅ |
| 6 | Certificação (PDF assinado, QR, fila) | ✅ |
| 7 | Painel administrativo + E2E completo | ✅ |
| 8 | Motor de sorteios por presença real | ✅ |
| 9 | Diretório público de organizações e governança global (SuperAdmin) | ✅ |
| 10 | Inscrição pública e vínculo automático de participante | ✅ |
| 11A | Identidade visual, primitivos de UI e shell de navegação | ✅ |
| 11B | Propagação do design a todas as telas e quitação da dívida (catraca zerada) | ✅ |
| 12+ | *a definir pelo humano* | ⏳ |

**Dívidas mapeadas** (candidatas naturais às próximas fases, por risco):
rate limit em Redis · assinatura assimétrica (PKCS#7/CMS) · observabilidade
(OpenTelemetry, métricas de fila) · entrega de prêmios e suplentes nos sorteios ·
editor visual da landing page · convites de membros · notificações por e-mail ·
antivírus nos arquivos de submissão.

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md` e o documento da **última fase** (`docs/fase-11b-*.md`).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.



