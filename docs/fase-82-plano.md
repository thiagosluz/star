# FASE 82 — a porta de entrada (PLANO)

> **Estado: plano escrito a partir da medição.** Aguarda `APROVADO: AVANÇAR`.

## O diagnóstico

Três sintomas, **duas causas**: (a) o destino pós-entrada é um `redirect` **incondicional** — não
há um único branch de decisão, nem para plataforma, nem para quantidade de vínculo; (b) o link
"Página inicial" da tela de seleção aponta para `/` **literal**.

**Medido:**

1. **"Página inicial"** — `selecionar-instituicao/page.tsx:67`, `href="/"`. Como `/` deixou de
   redirecionar na F75 (vitrine), o link **não leva ao painel**. Pior: com **um** vínculo, a linha
   do seletor é um `<span>` "Contexto atual" (`tenant-switcher.tsx:33-40`), não um botão — então a
   tela **não oferece nenhum caminho para o painel**. Só sobra esse link e "Sair da conta".
2. **SuperAdmin** — cai no seletor porque `auth-actions.ts:230` é incondicional. O `if` da linha
   218 (`tenantSlug` presente) **nunca roda**, porque nenhuma tela passa essa prop ao `AuthForm` —
   ou seja, **o `redirectTo` do login já está quebrado hoje** (no signup funciona).
3. **Sem vínculo** — a tela renderiza o ramo "Nenhuma instituição vinculada" (`page.tsx:27-45`) e
   **não redireciona** para lugar nenhum. `/eventos` é público e é o destino que faz sentido.

**Um beco medido, que o pedido não menciona:** hoje **não existe link para `/superadmin` a partir da
área da instituição** — o operador só chega digitando a URL. E o shell da plataforma monta o
`AccountBlock` **sem `memberships`** (`superadmin/layout.tsx:42`), então mandar o superadmin direto
para lá **fecha a porta de volta** para a instituição e para `/conta`. Isso decide desenho.

## A regra única

**Uma função pura de domínio** — `resolveEntryDestination` em `src/domain/platform/entry-destination-rules.ts`
(irmã de `vitrine-account-rules.ts`), consumida por um adaptador em `src/lib/auth/` que carrega os
vínculos e `loadPlatformPrincipal`. **O flag de plataforma NÃO entra em `getRequestContext()`** —
custaria uma consulta admin por render de toda página. A regra do CTA "Minha área" da vitrine passa a
usar a mesma função, para o botão e o redirect não divergirem.

**Precedência — e `redirectTo` é OVERRIDE, não fallback:**

1. **`redirectTo` válido** (relativo, não `//`) → volta para lá. O pedido o punha em último; a casa
   prova o contrário: `registration-journey:475-519` existe para garantir "voltou para a atividade
   onde eu estava". Superadmin entrando por convite/proposta também não pode perder o destino.
2. **SuperAdmin** → `/superadmin` (uma constante, a mesma do `PLATFORM_CRUMB`).
3. **Vínculo ACTIVE** → `/t/<slug>/dashboard` (`tenantDashboardPath`).
4. **Nenhum vínculo** → `/eventos`.
5. **Só convite pendente** → `/selecionar-instituicao` — senão a pessoa perde a tela do convite
   (`auth-tenancy:340-364`).

**O link "Página inicial"** passa a `tenantDashboardPath(activeTenant.tenantSlug)`; no ramo sem
vínculo, `/eventos`. **Nunca `href="/dashboard"` cru** — o proxy responde 404 para `dashboard` sem
host de tenant (`proxy.ts:76,152-153`). E o **rótulo** muda: "página inicial" é `/` no resto do produto.

## O que quebra (medido por leitura)

- **Quebram e serão re-apontados:** `auth-tenancy:51` (helper de 6 casos) e `:74-79`; `registration-journey:117`
  (helper de 8 casos); `account-area:130,279,295` (2FA sem vínculo). Todos esperam o seletor.
- **Não quebram:** `auth-tenancy:161,281,355` (multi-vínculo, outro tenant, convite pendente) e
  `f51-media-filters:128-135` — **a prova de que o seletor tem de sobreviver** para quem tem vínculo
  ou convite.
- **Dependem da tela existir:** `f78-topo-unico` e `f78-fatia3` — **não** transformar a tela em
  redirect puro, nem perder `<main>`/`<PageHeader>`.
- **Nenhum teste pina o link "Página inicial"** (grep: 0). Um E2E novo o cobre.
- `/selecionar-instituicao` e `/eventos` **não estão no portão `axe`** — a mudança não é obrigada por
  ele, mas incluir `/eventos` é cobertura que passa a fazer sentido.

## As fatias

1. **A regra e o adaptador** — `resolveEntryDestination` puro + a matriz unitária
   (superadmin × vínculo × convite × `redirectTo` × `redirectTo` inválido) + o adaptador com
   `loadPlatformPrincipal`. Sem tocar em página.
2. **A entrada** — os três `redirect` (`auth-actions:147,230,357`), `/login` e `/signup` passam a
   chamar a regra; consertar o `redirectTo` do login (hoje morto); 1 E2E com `grantPlatformRole`.
3. **O beco** — o link "Página inicial" para a dashboard (com o rótulo certo) e, no ramo sem vínculo,
   `/eventos`; **o `AccountBlock` da plataforma recebe `memberships`** para a porta de volta existir.
4. **Os testes re-apontados** e o E2E do link; `/eventos` entra no portão `axe`.
5. **O fechamento** — documento com ADR-378+, estado, bateria inteira e E2E.

## Invariantes

- **`redirectTo` vence a padrão, sempre** — e só aceita destino relativo.
- **A tela de seleção não vira redirect puro**: ela é onde o convite pendente aparece.
- **Superadmin não perde a porta de volta** para a instituição e para `/conta`.
- **Uma regra, não cinco `if`s** — o CTA da vitrine, os redirects de entrada e (opcionalmente) as
  guardas de página consultam a mesma função.

## O que fica de fora, declarado

**"Pedir para entrar" não existe no produto.** Não há `joinRequest` em `src/`. O caminho real é
convite, `addTenantMember` pela plataforma, ou **inscrição pública** — que já cria vínculo `ACTIVE` +
papel `PARTICIPANT` automaticamente. Então `/eventos` entrega **descoberta e inscrição**, não uma
solicitação de vínculo. Isso é lacuna de produto, não bug de navegação: fica registrada como dívida,
com o texto honesto na tela.
