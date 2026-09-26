# FASE 47 — Área de conta: dados, senha, dois fatores e recuperação

> **Tema escolhido pelo humano.** O pedido: "uma área de perfil, onde vamos ter opção
> para troca dos dados, troca de senha, ativar ou desativar autenticação de dois
> fatores, e uma opção para esqueci minha senha".

---

## 1. Sumário executivo

### 1.1 O que entrou

| # | Entrega | Onde |
|---|---|---|
| 1 | **Área de conta global** (`/conta`): nome, e-mail, foto, senha, segundo fator e dispositivos conectados | `src/app/conta/page.tsx` · `src/components/account/account-forms.tsx` |
| 2 | **Esqueci minha senha** — link no login, página de pedido, página de nova senha e o `redirectTo` que faltava | `/esqueci-senha` · `/redefinir-senha` · `auth-actions.ts` |
| 3 | **Troca de senha** com a senha atual, encerrando as outras sessões — e **criação de senha** para contas que não têm (`setPassword`) | `account-actions.ts` |
| 4 | **Segundo fator (TOTP)** com QR gerado no servidor, **10 códigos de recuperação** e desligamento com senha | `src/lib/auth/auth.ts` (plugin) · `account-actions.ts` |
| 5 | **Desafio no login**: senha correta + código, com o contexto da instituição preservado | `/login/dois-fatores` · `verifyTwoFactorLoginAction` |
| 6 | **Troca de e-mail** com confirmação no endereço NOVO e a senha atual como prova | `requestEmailChangeAction` |
| 7 | **Foto de perfil** — o ESCRITOR que `user.image` não tinha (perfil público F44 e cartões de equipe F45) | `src/lib/auth/user-avatar-service.ts` · `AccountAvatarField` |
| 8 | **Dispositivos conectados**: lista com navegador/sistema, "este dispositivo", encerrar uma ou todas as outras | `account-service.ts` · `AccountSessionsList` |
| 9 | **Tabela `two_factor`** com o privilégio REVOGADO da role de runtime (o segredo do TOTP não é dado de instituição) | `prisma/migrations/20260927180000_two_factor` · `IDENTITY_ONLY_TABLES` |
| 10 | **Template `EMAIL_CHANGE`** (22º) — a troca de e-mail usa o mesmo gancho da verificação, com texto próprio | `email-templates.ts` |

### 1.2 Números da fase

| | |
|---|---|
| Arquivos novos | **15** — 10 de código, 1 migração, 3 de teste e 1 documento (este) |
| Arquivos modificados | **19** — 13 de código/configuração, 2 de teste e 4 de documentação (`README.md`, `AGENTS.md`, `docs/dividas-tecnicas.md`, `docs/roadmap-de-produto.md`) |
| Migrações | **42 → 43** (`two_factor`) |
| Testes novos | **26** — 13 unitários, 9 de integração e **4 E2E** |
| Suíte | **106 arquivos · 2351 testes** (de 2329) · E2E **159** (de 155) |
| ADRs | **254 a 259** (a próxima é a 260) |
| Permissões / tabelas de tenant | **66** · **55** (ambas inalteradas) |
| Templates de e-mail | 21 → **22** |
| Defeitos reais encontrados | **3 de produto** e **2 de teste** (seção 5) |
| Dívidas declaradas | **E67** e **E68** |

---

## 2. O problema mais difícil da fase

**O segundo fator acontece no meio do login — e o login deste projeto é uma Server
Action.**

Ligar o 2FA é a parte fácil (QR, código, pronto). O difícil é o que vem depois: com o
segundo fator ativo, a senha correta **não cria sessão**. O Better Auth responde
`twoFactorRedirect` e deixa um cookie assinado de curta duração que autoriza *apenas* o
desafio; a sessão nasce quando o código é aceito. Ou seja: o fluxo de entrada que
existe desde a FASE 2 (`signInAction` → cookie de sessão → redireciona) ganhou um
estado intermediário em que **não há sessão, mas há um segredo em trânsito**.

Três decisões sustentam isso:

1. **O cookie do desafio precisa sobreviver à Server Action.** Quem o grava é o
   `nextCookies()` (que reaplica *todos* os `Set-Cookie` da resposta da biblioteca) e
   quem o lê é a action do código, via `headers()`. Nada disso é óbvio, e é a peça que
   o E2E prova de ponta a ponta — foi ele que mostrou que a corrente inteira funciona.
2. **O contexto da instituição viaja na URL e só é gravado no fim.** O cookie do tenant
   é escrito no *desafio aceito*, não no login: gravá-lo antes entregaria contexto
   operacional a quem ainda não provou o segundo fator. O `tenantSlug` e o `redirectTo`
   passam pela query e voltam em campos ocultos.
3. **O `redirect()` fica FORA do `try`.** Ele funciona lançando um erro especial: um
   `catch` em volta o engoliria e a pessoa ficaria presa na tela, sem erro nenhum. É a
   mesma família da armadilha 97 — o erro engolido que vira sucesso silencioso.

**O segundo problema é o que a tela promete.** Um segundo fator que tranca a pessoa
fora de casa é pior do que não ter segundo fator: por isso os **códigos de
recuperação** entraram (a saída de quem perde o celular), o enrollment só termina com
um código válido (`skipVerificationOnEnable` desligado) e o desligamento exige a senha.

---

## 3. Decisões técnicas

### 3.1 A área de conta é GLOBAL, e não de uma instituição

Nome, e-mail, senha, segundo fator, foto e sessões são da PESSOA (ADR-002). Uma área por
instituição daria à mesma pessoa várias "contas" diferentes e deixaria de fora
justamente quem não tem vínculo — o participante de um evento público, que é quem mais
precisa redefinir a senha. A entrada fica no menu do shell (ao lado do nome, que é o
dado editado) e o endereço é `/conta`.

### 3.2 A senha tem DUAS portas, e a tela sabe qual oferecer

| Situação | O que a tela oferece | Por quê |
|---|---|---|
| A conta tem senha (`account.providerId = 'credential'` com hash) | **trocar** (senha atual + nova) | é o caminho normal |
| A conta NÃO tem senha (convite de equipe, palestrante, patrocinador, contas do seed) | **criar** (`setPassword`) | pedir "senha atual" daria "senha incorreta" para sempre, e a pessoa não teria como entender |

Trocar a senha encerra as **outras** sessões (`revokeOtherSessions`): quem troca a senha
está dizendo que algo pode ter vazado, e manter os outros dispositivos conectados
esvaziaria a decisão. A sessão de quem troca continua viva — senão a pessoa seria
expulsa da própria tela.

### 3.3 O e-mail é a chave da identidade, e por isso a troca é cara

Trocar o e-mail exige **duas provas**: a senha atual (que a biblioteca não pede, e nós
pedimos) e a confirmação no **endereço NOVO**. A razão é o que está em jogo — é este
endereço que recebe a redefinição de senha. `updateEmailWithoutVerification` fica
desligado: ligado, uma sessão roubada trocaria o e-mail na hora, sem provar nada.

O texto do e-mail é próprio (`EMAIL_CHANGE`): "complete a sua conta" seria falso para
quem já tem conta e escolheu trocar o endereço. O gancho é o MESMO da verificação, e a
distinção vem do BANCO (o `user.email` gravado difere do endereço que o gancho recebe)
— o caminho da requisição não distingue os três casos que compartilham o token.

### 3.4 O segredo do TOTP não é dado de instituição — e o runtime não o alcança

A tabela `two_factor` não tem `tenantId` (a identidade é global), então RLS não teria
por onde isolar. A resposta foi **tirar o privilégio** da role de runtime
(`IDENTITY_ONLY_TABLES`, a mesma esteira de `job_runs` na FASE 36): quem lê é a
biblioteca de autenticação, pela conexão de plataforma.

A diferença para `account` (que guarda o hash scrypt e convive com o privilégio padrão)
é o que está guardado: um hash de senha só serve para conferir; a semente do TOTP
**gera códigos válidos**. A verificação de contrato passou a exigir a revogação, e o
segredo ainda é cifrado pela biblioteca (AES-GCM com `BETTER_AUTH_SECRET`).

### 3.5 Operações "sensíveis" exigem sessão recente — e a tela diz o caminho

Trocar senha, criar senha e confirmar a senha (na troca de e-mail) passam pelo
`sensitiveSessionMiddleware` da biblioteca, que exige sessão criada nas **últimas 24
horas**. Não é estorvo gratuito: é o que impede que uma sessão esquecida num computador
alheio vire troca de senha. Como isso pode acontecer com quem está legitimamente
logado, a mensagem traduzida (`SESSION_NOT_FRESH`) **oferece o caminho de volta**
("Entrar novamente") em vez de só recusar.

### 3.6 A foto da pessoa: o mesmo pipeline, um dono diferente

A esteira é a da FASE 46 (assina → navegador envia → decodifica e converte para WebP),
com o alvo novo `USER_AVATAR` e a chave global `users/<id>/avatar/…`. Três diferenças,
todas explicadas no código:

* **não entra em `media_assets`** — aquele acervo é da instituição e tem RLS por
  `tenantId`; a foto não é ativo de ninguém além da pessoa;
* **não consome quota de plano** — o plano mede o que a instituição guarda;
* **a foto anterior é apagada**, e só quando é nossa (o prefixo é conferido): `user.image`
  pode apontar para um provedor social, e apagar o que não é nosso seria destruir dado
  alheio.

O bucket é o público, e a tela diz o que isso significa: o arquivo é público (a matriz
de visibilidade do perfil público decide se ele **aparece**), e remover a foto apaga o
arquivo — não só esconde da página.

### 3.7 Os códigos de recuperação são normalizados para o formato do SERVIDOR

A biblioteca gera `abcde-fghij` (com hífen e com maiúsculas) e confere com comparação
**exata**. A primeira versão da normalização baixava a caixa e tirava o hífen, "para ser
tolerante" — e passou a recusar códigos CORRETOS, deixando sem saída justamente quem
perdeu o celular. O domínio agora reconstrói o formato canônico: só espaços somem (o que
o teclado acrescenta) e o hífen é reposto quando não vem. Quem digita do papel precisa
acertar a maiúscula, e a tela mostra os códigos agrupados exatamente como devem ser
digitados.

---

## 4. ADRs

### ADR-254 — A área de conta é global, fora da instituição

**Contexto.** O produto é multi-tenant e quase tudo vive sob `/t/<slug>`. Mas nome,
e-mail, senha e segundo fator são da PESSOA, e existem mesmo para quem não tem vínculo
(inscrição pública, convite de palestrante, contato de patrocinador).

**Decisão.** Área única em `/conta`, sem tenant, com entrada no menu do shell (que
existe em todas as telas e ao lado do nome de quem está logado).

**Justificativa.** Uma área por instituição daria à mesma pessoa várias contas e deixaria
sem recuperação de senha quem não tem casa — o caso mais comum de quem se inscreve num
evento.

**Consequências.** A página não carrega vínculos nem principal (é a variante leve da
sessão); a foto e o perfil público continuam decididos dentro de cada instituição.

### ADR-255 — Segunda credencial com saída garantida: TOTP + códigos de recuperação

**Contexto.** O humano pediu "ativar ou desativar autenticação de dois fatores". Um
segundo fator sem saída de emergência é uma forma eficiente de perder a conta: celular
perdido, trocado, sem bateria ou restaurado.

**Decisão.** TOTP (aplicativo autenticador) + **10 códigos de recuperação** de uso único,
com o enrollment só concluído após um código válido e o desligamento exigindo a senha.
Ninguém é obrigado a ligar.

**Justificativa.** Os códigos são a única saída que não depende de suporte. O enrollment
verificado evita o caso clássico de ligar o 2FA sem ter configurado o aplicativo e se
trancar fora no minuto seguinte.

**Consequências.** O login ganha um estado intermediário (seção 2) e a sessão passa a ter
uma tela própria (`/login/dois-fatores`). Não há "confiar neste dispositivo por 30 dias"
— declarado na dívida E68.

### ADR-256 — O segredo do segundo fator não tem RLS: tem privilégio revogado

**Contexto.** `two_factor` guarda a semente TOTP e os códigos de recuperação cifrados.
A tabela não tem `tenantId`, então RLS não teria por onde isolar. `account` (que guarda
hash de senha) convive sem RLS desde a FASE 2.

**Decisão.** A tabela entra em `IDENTITY_ONLY_TABLES`: é declarada no contrato como
tabela que a role de runtime **não pode alcançar**, e a migração revoga o privilégio
(como `job_runs` na FASE 36). A verificação de contrato reprova se ele voltar.

**Justificativa.** Um hash de senha só serve para conferir; a semente do TOTP gera
códigos válidos. Entre policy e revogação, a revogação é a resposta que sobrevive a um
erro de consulta futuro.

**Consequências.** Só a conexão de plataforma (`adminPrisma`, usada pela biblioteca de
autenticação) lê a tabela. `twoFactorEnabled` continua em `user`, que o runtime lê — a
tela precisa saber se o segundo fator está ligado, e isso não é segredo.

### ADR-257 — Esqueci minha senha: a resposta é a mesma, exista ou não a conta

**Contexto.** A FASE 15 ligou o envio (`sendResetPassword`), o template, a validade de 60
minutos e o limite de 3 pedidos/5 min — mas não havia tela nenhuma, e o link do e-mail
caía em 404.

**Decisão.** Página de pedido (`/esqueci-senha`), link no login e página de nova senha
(`/redefinir-senha?token=`), com `redirectTo` apontando para a página do formulário. A
resposta ao pedido é **sempre a mesma**, e a redefinição **encerra as sessões abertas**
(`revokeSessionsOnPasswordReset`).

**Justificativa.** Dizer "não existe conta com este e-mail" transformaria a tela num
oráculo de quem tem conta na plataforma — e a plataforma é multi-tenant. Encerrar as
sessões é o que se espera de quem redefine a senha: muitas vezes o faz porque desconfia
dela.

**Consequências.** Quem redefine precisa entrar de novo em todos os dispositivos. O token
vive no campo oculto do formulário (não em cookie, não em log) e é consumido no primeiro
uso.

### ADR-258 — Trocar senha e criar senha são operações DIFERENTES

**Contexto.** As contas criadas por convite (equipe, palestrante, patrocinador) e as do
seed nascem sem linha em `account` — não têm senha. Oferecer "trocar senha" a elas daria
"senha atual incorreta" para sempre.

**Decisão.** A tela escolhe pelo estado real da conta (`hasPassword`, lido da tabela
`account`): trocar (com a senha atual) ou **criar** (sem senha, pela posse da sessão). O
caminho de criação usa `setPassword` da biblioteca, que recusa quando já existe senha.

**Justificativa.** A posse da sessão é a prova disponível para quem entrou por convite; o
caminho alternativo (redefinição por e-mail) exige o endereço, que é o que a pessoa já
tem.

**Consequências.** Duas rotas diferentes para o mesmo campo, decididas por dado e não por
tela. O `setPassword` exige sessão recente (ADR-259).

### ADR-259 — Operações sensíveis exigem sessão recente, e a recusa ensina o caminho

**Contexto.** O `sensitiveSessionMiddleware` da biblioteca exige sessão criada nas
últimas 24 h para trocar/criar senha e para conferir a senha atual (na troca de e-mail).
A sessão do projeto vive 7 dias.

**Decisão.** Manter o padrão da biblioteca (não relaxar `freshAge`), traduzir
`SESSION_NOT_FRESH` para uma mensagem que diz o que fazer e oferecer o link para entrar
novamente.

**Justificativa.** Relaxar o prazo esvaziaria a única checagem que existe no
`setPassword` (que não tem senha atual para conferir). Recusar sem ensinar o caminho
seria a pior parte: a pessoa está logada, vê "não é possível" e não sabe por quê.

**Consequências.** Quem está logado há mais de um dia e tenta trocar a senha é convidado
a entrar de novo — e volta direto para `/conta`.

---

## 5. Lições aprendidas — defeitos REAIS encontrados

### 5.1 De produto (3)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **"Esqueci minha senha" era um beco sem saída** | o envio existia desde a FASE 15, mas não havia tela: o link do e-mail apontava para uma rota inexistente (404) | páginas de pedido e de nova senha, link no login e `redirectTo` (ADR-257) |
| 2 | **O código de recuperação CORRETO era recusado** | a normalização do domínio baixava a caixa e tirava o hífen, e o servidor compara exatamente (`codes.includes`) | a normalização reconstrói o formato canônico (ADR-259/§3.7); a lição está no teste e no comentário |
| 3 | **O template `EMAIL_CHANGE` nasceu fora da lista de testes** | `EMAIL_TEMPLATE_KEYS` é uma lista explícita, e `tests/**` fica fora do `typecheck`: o tipo mapeado que deveria quebrar a compilação não quebrou | o template entrou na lista, a contagem (22) é afirmada e o comentário registra a armadilha |

### 5.2 De teste (2)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 4 | O cenário da troca de senha falhava na **segunda** tentativa | o React 19 **reseta campos não controlados** quando a action termina — inclusive no erro. O teste repunha só a senha atual, e os outros dois campos chegavam vazios | o teste repõe os três campos, como a pessoa faria; a lição está comentada no spec |
| 5 | O cenário do desligamento do 2FA esperava a mensagem de sucesso | desligar ROTACIONA a sessão; o `revalidatePath` reconstrói a página, o painel volta ao estado "desligado" e **desmonta** o componente que guardava aquela mensagem | a prova passou a ser o BANCO + a tela inicial, não a mensagem de um formulário que a operação remove |

> A lição 5 é a mesma família da lição 6 da FASE 46: a asserção procurava algo que o
> próprio sucesso destrói.

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 106 arquivos · 2351 testes passando
npm run build ..................... ✓ Compiled successfully
npm run db:verify ................. Contrato íntegro. (inclui a nova tabela de identidade)
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npx prisma migrate status ......... 43 migrations found · Database schema is up to date!
npm run db:seed ................... ✓ (o seed não é afetado: nenhuma conta do demo tem 2FA)
docker compose --profile app up -d --build web worker   ✓
npm run test:e2e .................. 159 passed
npx playwright test tests/e2e/account-area.spec.ts
                                   → 4 passed · a redefinição pelo link do e-mail, o
                                     segundo fator com o código CALCULADO no teste e um
                                     código de recuperação, a troca de senha, e a foto
                                     (WebP) com o encerramento de outra sessão
```

### 6.1 O que os testes unitários provam (13)

Os códigos do segundo fator são normalizados para o formato que o servidor compara
(com hífen, preservando a caixa) e o que não tem o tamanho certo é recusado **antes** de
gastar uma tentativa da conta; o rótulo do dispositivo acerta Windows/Chrome,
Linux/Firefox, iPhone/Safari e **não diz "Chrome" para quem está no Edge**; sessão sem
reconhecimento recebe rótulo honesto; a sessão atual vem primeiro na lista; o e-mail é
comparado sem caixa; a chave digitável do TOTP só sai de um URI de TOTP; e a
confirmação de senha não aceita vazio.

### 6.2 O que os testes de integração provam (9)

A foto vira `.webp` em `users/<id>/avatar/`, o objeto enviado é apagado e a **anterior
também**; a chave de OUTRA pessoa é recusada; remover a foto limpa a coluna **e** apaga
o arquivo; a visão da conta diz a verdade sobre ter senha (convite não cria senha);
conta inexistente devolve `null` em vez de inventar estado; e a lista de sessões marca a
atual, ordena com ela no topo e conta o que a tela mostra.

---

## 7. Comandos operacionais

```bash
# A área de conta
# /conta .................. dados, foto, senha, segundo fator e dispositivos
# /esqueci-senha .......... pedido do link
# /redefinir-senha?token= . nova senha (destino do link do e-mail)
# /login/dois-fatores ..... desafio do segundo fator

# O segredo do TOTP NÃO é acessível pela role de runtime (por desenho)
psql "$DATABASE_URL" -c '\dp two_factor'

# Quem tem segundo fator ligado (a coluna fica em `user`)
psql "$DATABASE_URL" -c 'SELECT email, "twoFactorEnabled" FROM "user" WHERE "twoFactorEnabled" ORDER BY email'

# Sessões abertas de uma conta
psql "$DATABASE_URL" -c 'SELECT "userId", "userAgent", "createdAt", "updatedAt" FROM session ORDER BY "updatedAt" DESC LIMIT 10'

# A caixa de saída de plataforma (sem instituição) — redefinição e confirmação
# /superadmin/... não mostra estas: elas têm tenantId nulo por desenho
psql "$DATABASE_URL" -c "SELECT template, status, \"createdAt\" FROM email_messages WHERE \"tenantId\" IS NULL ORDER BY \"createdAt\" DESC LIMIT 10"
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Declaradas nesta fase

| Código | Dívida |
|---|---|
| **E67** | **A identidade não tem trilha de auditoria.** `audit_logs` tem `tenantId` e RLS: ela registra o que acontece DENTRO de uma instituição. Trocar senha, ligar/desligar o segundo fator, trocar e-mail e encerrar sessões são fatos GLOBAIS e não têm onde ser auditados. O que existe é o efeito no banco (`twoFactorEnabled`, `updatedAt`) e o rastro da biblioteca — não quem fez, quando e de onde. |
| **E68** | **Quem perde o celular E os códigos de recuperação depende do suporte.** Não há caminho de administração para desligar o segundo fator de outra pessoa (nem para a própria, além dos códigos), e não há "confiar neste dispositivo por 30 dias" (`trustDevice` do plugin), que reduziria a frequência do problema. |

### 8.2 Pontos de atenção

* **O segundo fator é TOTP apenas.** O plugin suporta código por e-mail (`otpOptions`),
  que não foi ligado: sem domínio verificado no provedor (dívida D7), o código por
  e-mail repetiria o problema do "esqueci a senha" — chegaria só a um endereço.
* **SMS não é opção** (custo por mensagem e portabilidade no Brasil); quem não tem
  aplicativo autenticador usa os códigos de recuperação.
* **A foto é pública por natureza.** A tela diz isso; restringir o campo do perfil
  público esconde da página, mas não despublica o arquivo. Remover a foto apaga.
* **`tests/**` continua fora do `typecheck`** — a lição 3 desta fase é consequência
  direta disso, e é a segunda vez que a armadilha aparece (a primeira foi na FASE 45).
* **`formatBytes` passou a descer até bytes.** A função é a MESMA dos limites de imagem e
  da quota de armazenamento; abaixo de 1 KB ela agora diz `512 B`, e não `0 KB` (que
  afirmaria sobrar espaço para um arquivo de 1 KB). Efeito colateral medido: a mensagem de
  recusa de quota mudou, e a expectativa presa desde a FASE 21 (`restam 0 KB`) foi
  atualizada para `restam 0 B`, com o motivo escrito no teste.
* **A troca de e-mail não realoca convites.** Quem tem convite pendente para o endereço
  ANTIGO (equipe, palestrante) continua com ele: o vínculo nasce pelo e-mail da conta no
  momento do aceite. Trocar de e-mail antes de aceitar exige pedir convite novo.
* **A tela de conta não mostra o histórico de acesso** (login, IP, data de cada sessão
  além do "último uso"). Foi pedido parcialmente coberto por "dispositivos conectados";
  histórico completo é outra decisão de produto.

---

## 9. Checklist de aceite

* [x] Área de conta com **troca dos dados** (nome, e-mail com confirmação, foto).
* [x] **Troca de senha** com a senha atual, encerrando as outras sessões.
* [x] **Criação de senha** para contas que entraram por convite (sem senha).
* [x] **Ativar** o segundo fator com QR + verificação do código.
* [x] **Desativar** o segundo fator exigindo a senha.
* [x] **Códigos de recuperação** (10), exibidos uma vez, de uso único e regeneráveis.
* [x] **Desafio no login** com o código do aplicativo **ou** um código de recuperação.
* [x] **Esqueci minha senha**: link no login, pedido, e-mail e definição da nova senha.
* [x] A redefinição **encerra as sessões** e o pedido não revela se a conta existe.
* [x] **Dispositivos conectados**: lista com navegador/sistema, "este dispositivo",
      encerrar uma e encerrar as outras.
* [x] A foto de perfil tem **escritor** (o que faltava para o perfil público e a equipe).
* [x] O segredo do TOTP é **inalcançável** pela role de runtime (contrato verifica).
* [x] Nenhuma permissão nova (66) e nenhuma tabela de instituição nova (55).
* [x] Suíte verde: **2351 testes + 159 E2E**, com a imagem reconstruída.
* [x] Documentação, README e dívidas (**E67**, **E68**) atualizados.
