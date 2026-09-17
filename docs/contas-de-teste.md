# Contas de teste — desenvolvimento

> **⚠️ SOMENTE DESENVOLVIMENTO.** Estas contas têm **senha conhecida e pública** e não
> podem existir em produção. O script que as cria **se recusa a rodar** com
> `NODE_ENV=production`, sem variável de contorno.

Objetivo: poder testar **qualquer** funcionalidade em segundos, sem criar conta,
vincular ao banco e conceder papel à mão. Uma conta por perfil, todas com a mesma
senha.

```text
Senha de todas as contas:  a definida em SEED_TEST_PASSWORD no seu .env
                           (hoje: 1234567890 · padrão do script: EventFlow@2026)
Login:                     http://localhost:3000/login
Instituições de teste:     ufba-demo · fiocruz-demo (do seed de demonstração)
```

---

## 1. Como criar (ou recriar)

```bash
# 1. Dados de demonstração (instituições, evento, atividades, cartas, certificados…)
npm run db:seed

# 2. As contas de teste
npm run db:seed:dev

# Ou os dois de uma vez, em um ambiente novo:
npm run db:setup:dev
```

O script é **idempotente**: rodar de novo não duplica nada, **regrava a senha** (é o
caminho de recuperação quando você trocou a senha na interface) e reafirma os vínculos
— inclusive devolvendo `suspenso@` ao estado suspenso depois de você testar a
reativação.

Para usar outra senha (o `.env` deste ambiente já define uma):

```bash
SEED_TEST_PASSWORD="MinhaSenhaForte123" npm run db:seed:dev
```

> **Se você rodar `npm run db:seed` de novo depois**, as instituições de demonstração
> são recriadas e os vínculos das contas de teste caem junto (cascata). Rode
> `npm run db:seed:dev` em seguida e tudo volta.

---

## 2. As contas

| E-mail | Perfil | Papéis | Para que serve |
|---|---|---|---|
| `superadmin@eventflow.test` | SuperAdmin da Plataforma | `SUPERADMIN` (escopo `PLATFORM`) | Painel `/superadmin`: provisionar, suspender, reativar instituições, métricas e governança |
| `owner@eventflow.test` | Dono da Instituição | `OWNER` em ufba-demo | Topo da instituição: tudo do tenant, billing, exclusão e concessão de papéis |
| `admin@eventflow.test` | Administrador | `ADMIN` em ufba-demo | Rotina administrativa (sem billing, sem exclusão do tenant, sem conceder papéis) |
| `organizador@eventflow.test` | Organizador (instituição) | `ORGANIZER` em ufba-demo | Criar/editar eventos, salas, atividades e trilhas em toda a instituição |
| `organizador-evento@eventflow.test` | Organizador (um evento) | `ORGANIZER` escopo `EVENT` | **Escopo de evento**: administra só o Congresso 2026; o que está fora é recusado |
| `presidente@eventflow.test` | Presidente do Comitê | `CHAIR` em ufba-demo | Distribuir avaliações, ler pareceres, decidir aceite/rejeição |
| `revisor@eventflow.test` | Revisor | `REVIEWER` em ufba-demo | Fila de revisão cega, envio de parecer, recusa de ler parecer alheio |
| `palestrante@eventflow.test` | Palestrante | `SPEAKER` escopo `EVENT` | Convidado de atividade: agenda própria e a atividade em que é speaker |
| `equipe@eventflow.test` | Equipe de Credenciamento | `STAFF` em ufba-demo | Check-in/check-out por busca ou QR Code em `/credenciamento` (todos os eventos) |
| `equipe-evento@eventflow.test` | Equipe do Dia (um evento) | `STAFF` escopo `EVENT` | Mesma tela, enxergando **apenas** o Congresso 2026 — o caso que a FASE 12 destravou |
| `participante@eventflow.test` | Participante | `PARTICIPANT` em ufba-demo | Jornada completa: inscrição, minhas inscrições, certificados, cartas, missões, conquistas |
| `patrocinador@eventflow.test` | Patrocinador | `SPONSOR` em ufba-demo | **Tem vínculo e NÃO tem permissão de inscrição** — a fronteira "é membro ≠ pode agir" |
| `multi@eventflow.test` | Multi-institucional | `ADMIN` em ufba-demo · `CHAIR` + `PARTICIPANT` em fiocruz-demo | Acúmulo de papéis e **troca de contexto** no seletor de instituição |
| `convidado@eventflow.test` | Convidado | `PARTICIPANT` com vínculo **INVITED** | Fail-closed: a instituição **não** aparece no seletor e o acesso é negado |
| `suspenso@eventflow.test` | Vínculo Suspenso | `PARTICIPANT` com vínculo **SUSPENDED** | Instituição bloqueou a pessoa: inscrição recusada e "Acesso bloqueado" na atividade |
| `semvinculo@eventflow.test` | Sem Vínculo | **nenhum** | Inscrição pública (FASE 10): inscreve-se e vira participante; nada mais é acessível |

---

## 3. Roteiro rápido por funcionalidade

| Funcionalidade | Entre com | Abra |
|---|---|---|
| Governança da plataforma | `superadmin@` | `/superadmin` |
| Diretório público (sem login) | — | `/organizacoes` |
| Painel administrativo | `admin@` ou `owner@` | `/t/ufba-demo/administracao` |
| Eventos, salas e programação | `organizador@` | `/t/ufba-demo/administracao/eventos` |
| Escopo de evento (RBAC restringindo) | `organizador-evento@` | `/t/ufba-demo/administracao/eventos/<id do Congresso>` — e depois tente o painel geral |
| Comitê científico e decisões | `presidente@` | `/t/ufba-demo/comite` |
| Revisão cega (parecer) | `revisor@` | `/t/ufba-demo/revisoes` |
| Credenciamento (QR Code) | `equipe@` | `/t/ufba-demo/credenciamento` |
| Inscrição e certificados | `participante@` | `/t/ufba-demo/eventos` |
| Inscrição pública (aberta) | `semvinculo@` | `/t/ufba-demo/eventos/congresso-2026/atividades/minicurso-rust` |
| Bloqueio por vínculo suspenso | `suspenso@` | mesma atividade acima → "Acesso bloqueado" |
| Vínculo sem permissão | `patrocinador@` | mesma atividade acima → "Inscrição não permitida" |
| Convite pendente (fail-closed) | `convidado@` | `/t/ufba-demo/dashboard` → redireciona para o seletor |
| Troca de contexto | `multi@` | `/selecionar-instituicao` |
| Sorteios por presença real | `admin@` | `/t/ufba-demo/administracao/eventos/<id>/sorteios` |
| Validação pública de certificado (sem login) | — | `/validar/<código>` (o seed imprime códigos) |

**Como descobrir o `<id>` do Congresso:**

```bash
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c \
  "SELECT id FROM events WHERE slug = 'congresso-2026';"
```

---

## 4. Contas com comportamento especial (não é defeito)

| Conta | O que você vai ver | Por quê |
|---|---|---|
| `multi@` | Ao abrir `/t/ufba-demo/...` pela primeira vez, você é levado ao **seletor de instituição** | Com mais de um vínculo ativo não existe contexto implícito — a escolha é explícita (`/selecionar-instituicao`) |
| `organizador-evento@` | O painel geral (`/administracao`) **redireciona** ao painel; a página do evento abre normalmente | O papel tem escopo de EVENTO: ele administra aquele evento, não a instituição |
| `convidado@` | Nenhuma instituição aparece | A plataforma é **fail-closed**: `INVITED` não concede contexto |
| `suspenso@` | "Acesso bloqueado" na página da atividade | Decisão da instituição (ADR-061): a inscrição pública **não** readmite quem foi suspenso |
| `patrocinador@` | "Inscrição não permitida" | Tem vínculo ativo, mas `SPONSOR` não tem `registration:create` — a fronteira entre "é membro" e "pode agir" |
| `semvinculo@` | Formulário de inscrição, com aviso de que a conta passará a ser participante | Inscrição pública (FASE 10): o vínculo nasce da inscrição |

---

## 5. Ponto de atenção — **RESOLVIDO na FASE 12**

**Equipe com escopo de evento não abria `/credenciamento`.** A tela exigia permissão de
alcance institucional (`attendance:manage` no escopo `TENANT`), então um `STAFF`
concedido apenas para um evento era redirecionado ao painel — apesar de o próprio seed de
demonstração usar esse padrão (equipe do dia, com validade).

A FASE 12 corrigiu a guarda (item **I7**): a tela aceita escopo `TENANT` **ou** `EVENT`, e
a listagem passa a mostrar **somente** os eventos em que a pessoa é equipe — escopo
estreito não vira acesso largo. A conta `equipe-evento@eventflow.test` existe hoje para
você conferir exatamente isso, e há teste E2E
(`tests/e2e/team-scope.spec.ts`) provando os dois lados: acesso ao próprio evento e
ausência do evento alheio.

---

## 6. Como as contas são criadas (para quem for mexer no script)

`prisma/seed-dev-users.ts`:

1. **Usuário** — `user` (nome, e-mail, `emailVerified = true`).
2. **Senha** — vive em **`account.password`** (`providerId = 'credential'`,
   `accountId = user.id`), com hash **scrypt do Better Auth**
   (`hashPassword`, de `better-auth/crypto`).
   > O campo `user.passwordHash` é **legado e não é usado pelo Better Auth** — as
   > contas do seed principal (ana, bruno, carla, diego) não conseguem logar porque
   > não têm linha em `account`, e não por causa daquele campo.
3. **Vínculo** — `user_tenant_profiles` (`ACTIVE`, `INVITED` ou `SUSPENDED`).
4. **Papéis** — `role_assignments`, com `reason` marcado como deste script. As
   concessões do próprio script são apagadas e recriadas a cada execução, para que
   mudar um escopo aqui não deixe a concessão antiga vigente ao lado da nova.
5. **Governança** — para `superadmin@`, uma linha com `scope = PLATFORM` e
   `tenantId = NULL` (invisível para a role de runtime, por RLS).

Trava de ambiente na primeira linha executável:

```ts
if (nodeEnv === 'production') {
  console.error('✖ RECUSADO: este script cria contas com senha conhecida…');
  process.exit(1);
}
```

---

## 7. Dicas

- **Trocar de conta rápido:** o botão *Sair* fica no cabeçalho; ou use uma janela
  anônima para manter duas sessões ao mesmo tempo (ex.: `owner@` e `semvinculo@`).
- **Testar convite/vínculo sem passar pela interface:** use
  `npx tsx prisma/seed-dev-users.ts` novamente — ele reafirma o estado original.
- **Reset completo do ambiente:** `npm run db:reset` (apaga o banco) seguido de
  `npm run db:setup:dev`.
- **Nunca** reaproveite estas senhas fora do ambiente local: o único motivo de elas
  serem simples é a velocidade de teste.
