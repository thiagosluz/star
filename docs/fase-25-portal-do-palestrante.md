# FASE 25 — Portal do palestrante, vitrine pública e materiais

> **Itens entregues:** E18 (perfil do palestrante e vínculo de conta), E19 (posse e portal),
> E20 (materiais com visibilidade própria), E21 (vitrine pública e certificado de palestrante).
> **ADRs:** 113 a 118 (6 decisões) · **Migrações:** 1 (duas tabelas novas + 5 colunas).
> **Testes novos:** 46 unitários + 33 de integração + 5 E2E.
> **Revisão pós-entrega (§10):** o menu voltou a abrir os itens pessoais e o convite passou a
> ser uma porta de entrada — ADRs 119 e 120, +7 unitários, +2 de integração, +1 E2E.

---

## 1. Sumário executivo

O papel `SPEAKER` existia no catálogo desde a FASE 2 e **nunca teve tela**. `ActivitySpeaker`
existia desde a FASE 1 e **nunca era escrito pela aplicação**: a única forma de vincular um
palestrante a uma atividade era SQL. Esta fase dá vida aos dois — e o faz pela porta mais difícil,
que é a identidade.

| # | Entrega | Onde |
|---|---|---|
| E21 | Tabela `speaker_profiles`: o palestrante passa a ser PESSOA (nome, e-mail, instituição, bio, foto, redes), com `userId` opcional e convite por token hasheado | migração `20260919120000` · `src/lib/speakers/speaker-service.ts` |
| E21 | Reivindicação em dois caminhos: pelo CÓDIGO (link entregue pela organização) e pelo PAINEL (e-mail da conta), com papel `SPEAKER` concedido por ATIVIDADE | `attachSpeakerAccount` · `claimSpeakerProfile` · `/t/<slug>/palestrante/convite` |
| E22 | Portal do palestrante: perfil, foto, ementa/requisitos/bibliografia e materiais das atividades que ministra | `/t/<slug>/palestrante` |
| E22 | Tela da organização: cadastro, convite, vínculo com a atividade e desvínculo | `.../administracao/eventos/<id>/palestrantes` |
| E23 | Tabela `speaker_materials`: arquivo ou link, com visibilidade `PUBLIC` / `ATTENDEES_ONLY` / `PRIVATE` decidida por VISITANTE | `src/lib/speakers/material-service.ts` |
| E23 | Upload direto ao storage (URL pré-assinada + SHA-256 no cliente + confirmação com integridade) e download por rota própria com 401/403/404 | `/api/t/<slug>/palestrantes/materiais/<id>/arquivo` |
| E24 | Vitrine: bloco `SPEAKERS` com foto, bio e badges; ficha individual do palestrante; instrutores em destaque na ficha da atividade | `src/components/events/speaker-gallery.tsx` · `.../palestrantes/[speakerId]` |
| E24 | Certificado `SPEAKER` com carga horária somada das atividades EFETIVAMENTE ministradas, exigindo evento encerrado e credenciamento registrado | `certificate-rules.ts` · `speaker-rules.ts` (`computeSpeakerWorkload`) |

### 1.1 Números da fase

```text
Arquivos novos ............ 21 (1 migração · 1 de domínio · 3 de serviço · 1 de API ·
                              6 de tela/portal · 3 de componente · 3 de teste ·
                              1 documento · o bloco/lista de materiais)
Arquivos alterados ........ 23 (schema, seed, contrato de schema, 2 de domínio do RBAC,
                              regras de certificado, regras de imagem, guarda de página,
                              serviço de certificado, serviço de upload, acervo de mídia,
                              repositório público, bloco da landing, navegação, 2 telas,
                              3 arquivos de teste existentes e os 3 docs de acompanhamento)
Migrações ................. 1 (2 tabelas novas + 5 colunas em `activity_speakers`)
ADRs ...................... 6 (113–118) → o próximo é o ADR-119
Testes novos .............. 84 (46 unitários · 33 de integração · 5 E2E)
Totais após a fase ........ 50 arquivos de teste · 1241 testes Vitest · 74 E2E ·
                              17 migrações · 35 tabelas de tenant sob RLS · 57 permissões
```

---

## 2. O problema mais difícil da fase

**A identidade chega antes da conta — e a plataforma inteira assume que ela não chega.**

Todo o RBAC do projeto parte de um `userId`. Papel é concedido a um usuário, posse é comparada
com `userId`, a RLS isola por instituição de um usuário. Só que quem organiza um evento conhece o
palestrante pelo **nome e pelo e-mail**, não pelo id da conta — e muitas vezes ele nem tem conta
ainda. Exigir cadastro prévio inverteria a ordem real do trabalho: o convite acontece ANTES de a
pessoa entrar.

Isso criou uma contradição em três lugares diferentes:

1. **No modelo.** Nome, bio e foto viviam em `activity_speakers` — o vínculo com a ATIVIDADE. Com
   o palestrante em três atividades, ele corrigiria a bio em uma e as outras duas continuariam
   erradas. E o certificado, que soma as atividades ministradas, não teria sobre o que somar.
2. **No acesso.** O portal exige papel e vínculo ativo, mas o convidado externo não tem nenhum dos
   dois. Colocar o formulário de aceite dentro do painel criaria um impasse: sem vínculo não se
   aceita o convite, e sem aceitar o convite não se ganha o vínculo.
3. **Na prova de identidade.** O e-mail do perfil é digitado pelo organizador — que erra. O token é
   entregue à mão — e vaza (print, grupo da turma). Nenhum dos dois, sozinho, identifica alguém.

A resposta foi separar as três coisas: **o perfil é da pessoa** (`speaker_profiles`, com `userId`
nulo até ser reivindicado), **o vínculo guarda o que é do par** (papel na atividade, ordem, carga,
ementa), e **o aceite exige as duas provas** — o token (posse do link) e o e-mail da conta
(identidade), com o conflito resolvido a favor da conta e registrado na trilha. O aceite vive numa
**página pública autenticada** (`/palestrante/convite`), fora do shell que exige vínculo, e o
vínculo nasce como CONSEQUÊNCIA do aceite — com `kind = PARTICIPANT`, para que um convidado de
minicurso não consuma a quota de equipe do plano.

---

## 3. Decisões técnicas

### 3.1 Duas tabelas, e não colunas a mais (E21)

`speaker_profiles` é da INSTITUIÇÃO (a pessoa volta na edição seguinte, e a fronteira é o
`tenantId`); `activity_speakers` continua sendo o par (atividade × palestrante) e guarda o que só
faz sentido ali: `roleTitle` ("Keynote" na abertura, "Instrutor" no minicurso), `displayOrder`,
`workloadMinutes` e a contribuição de conteúdo.

As colunas legadas (`guestName`, `guestEmail`, `guestInstitution`, `guestBio`, `userId`) **ficaram**,
sincronizadas pelo serviço: a agenda pública, o certificado e o credenciamento as consultam desde a
FASE 3, e reescrever todos esses caminhos numa fase seria trocar um risco por outro. A duplicação é
mantida em dois lugares (vinculação e edição do perfil), nunca em duas telas — e a migração faz o
backfill de todo vínculo que já existia, um perfil por (instituição, usuário) para quem tem conta e
um por (instituição, nome) para convidado externo.

### 3.2 O convite é hash, e aparece uma vez (E21)

O banco guarda o SHA-256 do token; o token em claro só existe na resposta que o gerou. Regerar
INVALIDA o anterior — dois tokens válidos para o mesmo perfil significariam que o vazamento do
primeiro continua funcionando. Os 32 caracteres usam alfabeto sem `I`, `O`, `0` e `1`: o código é
ditado por telefone e copiado de papel, e a confusão entre `l`/`1` e `O`/`0` é o defeito clássico
de código impresso.

Quando a busca é pelo hash e nada casa, a resposta é "convite não encontrado" (e não "código
inválido"): a diferença importa para quem está com o código antigo na mão, porque a única saída
real é pedir outro.

### 3.3 A aceitação aceita duas provas, e o conflito tem regra (E21)

| Situação | Resultado |
|---|---|
| Token válido + e-mail da conta igual ao do perfil | vincula, confirma, concede o papel |
| Token válido + e-mail DIFERENTE | vincula e **corrige o e-mail do perfil** para o da conta (cenário real: organização cadastrou o institucional, a pessoa tem conta com o pessoal) — a divergência vai para a trilha |
| Sem token, e-mail da conta igual ao do perfil | vincula (caminho do painel) |
| Sem token, e-mail diferente | recusa dizendo que o convite é de outro e-mail |
| Perfil já vinculado a outra conta | recusa e não revela nada além disso |

O papel concedido é `SPEAKER` no escopo **ACTIVITY**, uma concessão por atividade vinculada.
Conceder no evento inteiro daria a um convidado de um minicurso a mesma visibilidade de quem
coordena a programação.

### 3.4 Material não é imagem: visibilidade por visitante (E23)

O bucket de imagens é público; o de material, não. Slides de aula trazem dado que não é público por
natureza (estudo de caso com paciente, contrato em anexo), então **todo download passa por uma rota
da aplicação** que decide o acesso na hora e só então assina uma URL de poucos minutos.

A decisão é do domínio (`canAccessMaterial`) e distingue o motivo da recusa:

| Visibilidade | Anônimo | Autenticado sem inscrição | Inscrito confirmado | Palestrante dono | Equipe |
|---|---|---|---|---|---|
| `PUBLIC` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ATTENDEES_ONLY` | 401 (entre e se inscreva) | 403 | ✅ | ✅ | ✅ |
| `PRIVATE` | 403 | 403 | 403 | ✅ | ✅ |

`401` e `403` são diferentes de propósito: o anônimo ainda PODE ter direito (falta identificar-se),
quem não está inscrito não tem. E o rascunho responde 403 até para o inscrito — mas 404 não, porque
a existência de um rascunho não é informação de quem não organiza.

O material fechado **não desaparece da página**: aparece como "exclusivo para inscritos". Escondê-lo
tiraria do visitante a única pista de que vale a pena se inscrever, e do inscrito a de que falta
confirmar a vaga.

### 3.5 A esteira de upload é a mesma da capa do evento (E20/E21)

URL pré-assinada com tipo e tamanho travados, envio direto do navegador, confirmação que lê o objeto
de volta e confere tamanho e checksum. Um caminho próprio para material divergiria exatamente na
verificação de assinatura real do arquivo — a parte que é segurança, não conveniência. A foto do
palestrante reusa a MESMA esteira com o alvo `SPEAKER_AVATAR`, e por isso entra na biblioteca de
mídia da instituição (que passou a varrer `speaker_profiles.avatarUrl`, senão ofereceria excluir uma
foto que está na vitrine).

Limite honesto: o upload é assinado sem o metadado de checksum, então o storage não o devolve e a
conferência cai no **tamanho** — o mesmo caminho mais fraco desde a FASE 4, agora declarado como
dívida.

### 3.6 Certificado de palestrante é fato consumado (E24)

Três portas, nesta ordem, cada uma com motivo próprio na mensagem:

1. **evento encerrado** — o certificado atesta que a pessoa ministrou a atividade inteira; durante o
   evento isso ainda não é fato;
2. **credenciamento registrado** — presença validada no balcão (o que o STAFF faz no dia);
3. **ao menos uma atividade apurada** — cancelada ou ainda não concluída NÃO entra na soma, e o
   motivo fica no `workloadBreakdown` do documento.

A carga declarada no vínculo vence a da atividade quando existe (dois palestrantes dividindo um
minicurso de 4 h, cada um com 2 h). O portal mostra a carga apurada, o detalhamento por atividade e
a razão da recusa ANTES de a pessoa clicar — porque a divergência entre a promessa da tela e a regra
do servidor é o defeito mais caro de uma tela de certificado.

### 3.7 A vitrine deriva das atividades, e o palestrante oculto continua na agenda

O bloco `SPEAKERS` existe desde a FASE 17 e sempre leu as ATIVIDADES — não há um segundo cadastro
para a página pública. O que a fase acrescentou foi foto, bio, papel e link para a ficha; sem perfil
(o cadastro antigo, só nome), o bloco cai na lista simples em vez de sumir.

`isPublic = false` esconde a pessoa da vitrine e da ficha, **mas não da agenda**: a atividade precisa
de quem a ministra, e o nome de quem conduz não é opcional. Um palestrante oculto também não assina
ementa na página pública — assinar é aparecer.

### 3.8 Reivindicar pode criar o vínculo, e ele não é de equipe

O aceite cria (ou reativa) o vínculo com `kind = PARTICIPANT`. Contar o convidado de um minicurso
como MEMBER consumiria a quota do plano — um evento com 20 palestrantes esgotaria o plano gratuito
sozinho. O acesso ao portal vem do PAPEL (por atividade), não do tipo de vínculo.

---

## 4. ADRs

### ADR-113 — O palestrante é uma PESSOA da instituição, não uma linha da atividade

**Contexto.** `ActivitySpeaker` guardava nome, e-mail, instituição e bio. Funcionava enquanto o
palestrante existia em uma única atividade.

**Decisão.** Tabela `speaker_profiles` (tenant-scoped, RLS) com a identidade, e `activity_speakers`
apontando para ela (`speakerProfileId`) guardando apenas o que é do par: papel na atividade, ordem,
carga atribuída, ementa/requisitos/bibliografia.

**Justificativa.** A pessoa fala em várias atividades e volta na edição seguinte; o certificado soma
as atividades dela; e o portal edita UM perfil. Manter a identidade no vínculo faria a bio divergir
entre as atividades — e a divergência apareceria na página pública.

**Consequências.** (+) Uma bio, uma foto, um certificado; reuso entre edições.
(−) As colunas legadas (`guestName` etc.) continuam existindo, sincronizadas pelo serviço, para a
agenda, o certificado e o credenciamento não terem de ser reescritos nesta fase.

### ADR-114 — O convite é entregue como código, guardado como hash

**Contexto.** O convidado externo precisa assumir o perfil sem que a plataforma tenha um canal de
e-mail (a F15 segue pendente).

**Decisão.** `inviteTokenHash` (SHA-256) + validade de 30 dias; o token em claro aparece UMA vez na
tela da organização, para entrega manual. Regerar invalida o anterior.

**Justificativa.** Um dump do banco (backup, suporte, relatório) não pode permitir reivindicar o
perfil de ninguém; e dois tokens vivos significam que o vazamento do primeiro continua funcionando.

**Consequências.** (+) Entrega manual funciona hoje e o canal por e-mail entra depois sem mudar o
modelo. (−) Perder o código exige gerar outro (a tela diz isso ao lado do código).

### ADR-115 — O aceite exige token E e-mail, e vive fora do shell autenticado

**Contexto.** O e-mail do perfil é digitado pelo organizador (erra); o token circula em papel e
print (vaza). E quem aceita pode ainda não ter vínculo com a instituição.

**Decisão.** Duas provas: o token identifica o CONVITE, o e-mail da conta identifica a PESSOA. O
conflito de e-mail resolve a favor da conta e vai para a trilha. A página de aceite é pública
(apenas autenticada), e o vínculo `PARTICIPANT` nasce como consequência.

**Justificativa.** Nenhuma das duas provas basta sozinha; e o aceite dentro do painel criaria o
impasse "sem vínculo não aceita, sem aceitar não tem vínculo".

**Consequências.** (+) O convidado externo entra pelo link, cria conta e assume o perfil sozinho.
(−) A página de aceite precisa de tratamento próprio de sessão (diz o que fazer quando deslogado).

### ADR-116 — Material tem visibilidade própria, decidida por visitante no servidor

**Contexto.** O bucket de imagens é público; material de aula frequentemente não pode ser.

**Decisão.** `visibility` por material (`PUBLIC`, `ATTENDEES_ONLY`, `PRIVATE`), bucket privado, e
todo download por rota da aplicação que decide o acesso e assina uma URL temporária, com 401/403/404
distintos.

**Justificativa.** Servir o bucket diretamente exigiria torná-lo público (dado de aula exposto a
quem descobrisse a chave) ou embutir URL assinada no HTML (que vaza em cache, log e Ctrl+C).

**Consequências.** (+) Rascunho, exclusivo de inscritos e aberto convivem na mesma atividade.
(−) Cada download passa pela aplicação (uma ida ao banco + assinatura), e a rota precisa do slug da
instituição no caminho para decidir sob RLS.

### ADR-117 — A carga do palestrante soma só o que foi ministrado

**Contexto.** `workloadMinutes` do vínculo podia somar atividades canceladas ou futuras.

**Decisão.** `computeSpeakerWorkload` exclui atividade cancelada e atividade que ainda não terminou,
e o motivo de cada exclusão entra no `workloadBreakdown` do certificado. A carga declarada no
vínculo vence a da atividade.

**Justificativa.** Certificado é declaração de fato consumado: somar uma oficina cancelada seria
certificar o que não houve, e uma em andamento, atestar o futuro.

**Consequências.** (+) O número do documento é auditável atividade por atividade.
(−) O certificado de um palestrante com atividade em andamento é recusado até o encerramento.

### ADR-118 — O portal é aberto por permissão, mas cada escrita confere a posse

**Contexto.** O papel de palestrante é concedido por ATIVIDADE; a tela do portal lista as atividades
que a pessoa ministra, e esse conjunto é definido pela POSSE, não pelo escopo da concessão.

**Decisão.** A entrada da tela usa `holdsPermission` ("é palestrante em algum lugar?"); cada consulta
filtra por `userId`; e cada escrita chama `can()` com o alvo exato e o `ownerId` lido do BANCO.

**Justificativa.** Exigir escopo de tenant na entrada recusaria o padrão que a própria plataforma
recomenda e deixaria o convidado de um minicurso sem portal. E confiar no `speakerProfileId` vindo do
formulário seria a mesma coisa que não autorizar.

**Consequências.** (+) O palestrante entra, vê só o que é dele e não alcança atividade de terceiro
(403). (−) Existem duas checagens por escrita (entrada e alvo), e a diferença precisa estar explicada
no código — está.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | E2E: o organizador salvava o palestrante, lia "cadastrado" e a lista continuava vazia | A action revalidava `/administracao` (outro caminho) e a tela aberta seguia servindo o RSC em cache | `revalidatePath(..., 'layout')` do segmento de administração — cobre a subárvore inteira (armadilha 40) |
| 2 | E2E: "a atividade precisa acontecer dentro do período do evento" com datas preenchidas pelo formulário | O evento começa no HORÁRIO CORRENTE de +30 dias; uma atividade na manhã desse mesmo dia cai antes da abertura | A atividade é marcada no dia seguinte, e a janela de inscrição passa a fechar depois dela |
| 3 | Teste de integração: o vínculo criado dentro de `withTenant` simplesmente não existia | `linkSpeakerToActivity` abre a PRÓPRIA transação, em outra conexão: `READ COMMITTED` não mostra o dado ainda não commitado da transação externa | Montagem em três transações separadas (criar, vincular, credenciar) — armadilha 41 |
| 4 | Teste de integração: a carga do palestrante vinha 0 mesmo com atividade de 180 min | `activity_speakers.workloadMinutes` tem `0` como padrão de COLUNA, e um `INSERT` cru gravava zero em vez de herdar a carga da atividade | A fixture passou a criar o vínculo pelo SERVIÇO (que herda a carga) — o teste media o próprio erro de montagem |
| 5 | Teste de integração: "checksum errado" era aceito na confirmação | O storage não devolve checksum quando o upload não é assinado com o metadado; a verificação cai no tamanho | O teste passou a provar o caminho forte (tamanho sempre reportado) e a declarar o fraco como dívida (armadilha 42) |
| 6 | `readSocialLinks` apagava TODAS as redes quando uma estava inválida | A leitura usava a mesma função estrita da escrita, que devolve `{ok:false}` para o conjunto | Leitura tolerante (descarta só o link ruim) e escrita estrita: basta um host sair da allowlist para o perfil perder as redes todas |
| 7 | O cenário de recusa do certificado passava (ou falhava) sem avaliar a regra | `requestCertificate` é idempotente e devolve o documento EXISTENTE antes de olhar elegibilidade — o palestrante do teste já tinha certificado | Cada cenário de recusa usa um palestrante PRÓPRIO |
| 8 | E2E: `getByLabel('Biografia')` nunca resolvia, e o rótulo não focava o campo | O primitivo `Field` liga o rótulo por `htmlFor={name}` e o controle precisa do `id` correspondente; os formulários novos passavam só o `name` | `{...fieldAria('nome')}` em todo controle dentro de um `Field` (armadilha 42), com `id` único onde dois formulários iguais convivem na mesma página |
| 9 | O palestrante dono do perfil recebia "permissão negada para editar o perfil" na própria tela | A ação checava `can(..., { scope: 'TENANT' }, { ownerId })`, e o papel vindo do aceite é concedido no escopo **ACTIVITY** — `scopeCovers('ACTIVITY', 'TENANT')` é falso | Para permissão `:own` numa tela PESSOAL, o que importa é ter a permissão em algum escopo (`holdsPermission`, já verificado na entrada) + a posse conferida no BANCO |
| 10 | E2E: dois selos idênticos na mesma linha do certificado (`strict mode violation`) | Ao remover o link oculto da fase de esboço, o selo de status ficou DUPLICADO no JSX — a tela mostrava o mesmo dado duas vezes | Um selo só, na linha de ações; o teste passou a prender o estado durável (o selo) em vez da mensagem transitória, que o próprio sucesso remove |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 50 arquivos, 1241 testes passando (+84)
npm run build                → ✓ Compiled successfully
                               ƒ /t/[tenantSlug]/(app)/palestrante
                               ƒ /t/[tenantSlug]/(app)/administracao/eventos/[eventId]/palestrantes
                               ƒ /t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]
npm run db:verify            → Contrato íntegro. (35 tabelas de tenant)
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run db:partitions        → partições em dia (872 linhas de auditoria no total)
npm run test:e2e             → 74 passed (1.9m)
npm run db:migrate:status    → 17 migrations found · Database schema is up to date!
npm run db:seed              → palestrante de demonstração no minicurso de Rust
```

### 6.2 E2E dos itens novos (contra o container de produção)

```text
✓ a organização cria a atividade e cadastra o palestrante com convite (E21)
✓ o palestrante aceita o convite, edita a bio, troca a foto e publica o slide (E22)
✓ o visitante anônimo vê a foto e a bio na vitrine e na ficha (E24)
✓ o anônimo não baixa o slide; o inscrito confirmado baixa (E23)
✓ o palestrante emite o certificado com a carga horária correta (E24)
```

O cenário do certificado prende o número: a oficina tem 180 minutos, o certificado é emitido com
`workloadMinutes = 180` e o `workloadBreakdown` registra a atividade que entrou na conta. O cenário
do material prende o STATUS HTTP: 401 para o anônimo, 302 para a URL assinada do inscrito confirmado,
e 200 no arquivo baixado do storage.

### 6.3 Integração (banco e storage reais)

```text
✓ cadastra o palestrante sem conta e devolve o convite UMA vez
✓ recusa e-mail repetido na mesma instituição
✓ vincular copia a identidade para o vínculo e assume a carga da atividade
✓ regerar o convite invalida o anterior
✓ reivindica o perfil pelo token: vincula a conta, confirma e NÃO deixa token vivo
✓ recusa reivindicar de novo (o perfil já tem dono)
✓ o aceite concede o papel SPEAKER no escopo da ATIVIDADE
✓ o vínculo legado passa a apontar para a conta
✓ o dono edita o próprio perfil e a agenda recebe o nome novo
✓ RECUSA editar o perfil de outra pessoa
✓ o dono salva a ementa da PRÓPRIA atividade e o público a lê assinada
✓ RECUSA salvar ementa em atividade de terceiro
✓ lista para o anônimo só o que é público, e CONTA o que está fechado
✓ o inscrito confirmado vê o material da turma; o não inscrito, não
✓ download: 401 para anônimo no material de inscritos, 200 assinado para o dono
✓ download: 403 para o inscrito no material privado e 404 para material inexistente
✓ o dono do material é lido do BANCO, não do formulário
✓ remover o material tira da página e da lista
✓ trocar a visibilidade muda o que o anônimo baixa
✓ vinculado a atividade que não ministra, o upload é recusado antes da assinatura
✓ sobe um PDF, confere a integridade e recusa objeto trocado (storage real)
✓ o portal do palestrante mostra as atividades dele e de mais ninguém
✓ o convite pendente aparece para o e-mail convidado (caminho do painel)
✓ a carga NÃO conta atividade que ainda não terminou (evento em andamento)
✓ com o evento encerrado e credenciamento, a carga é a soma das atividades
✓ a vitrine pública mostra o palestrante com perfil e esconde o oculto
✓ perfil oculto da vitrine não aparece nem tem ficha
✓ a ficha pública do palestrante não existe em evento não publicado
✓ desvincular tira o palestrante da agenda e despublica os materiais dele
✓ o acervo de palestrantes não atravessa instituições (RLS)
✓ um material de outra instituição não é encontrado nem pela organização
```

---

## 7. Comandos operacionais

```bash
# ── Organização ───────────────────────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/palestrantes
#   Cadastrar palestrante (gera o código de convite) · vincular a uma atividade
#   Novo convite · desvincular (despublica os materiais do vínculo)

# ── Palestrante ───────────────────────────────────────────────────────────────
# Link do convite:  /t/<slug>/palestrante/convite?codigo=<TOKEN>
# Portal:           /t/<slug>/palestrante
#   Perfil (bio, foto, instituição, redes) · ementa da atividade · materiais
#   Certificado: emite quando o evento terminou e o credenciamento foi registrado

# ── Público ───────────────────────────────────────────────────────────────────
# Vitrine:   /t/<slug>/eventos/<eventSlug>              (bloco "Palestrantes")
# Ficha:     /t/<slug>/eventos/<eventSlug>/palestrantes/<speakerId>
# Atividade: /t/<slug>/eventos/<eventSlug>/atividades/<activitySlug>
# Download:  /api/t/<slug>/palestrantes/materiais/<materialId>/arquivo
```

```sql
-- Palestrantes da instituição, com vínculo, convite e conta:
SELECT p.name, p.email, p."isConfirmed", (p."userId" IS NOT NULL) AS tem_conta,
       (p."inviteTokenHash" IS NOT NULL) AS convite_ativo, count(l.id) AS atividades
  FROM speaker_profiles p
  LEFT JOIN activity_speakers l ON l."speakerProfileId" = p.id
 WHERE p."tenantId" = '<tenantId>' AND p."deletedAt" IS NULL
 GROUP BY p.id ORDER BY p."displayOrder", p.name;

-- Materiais publicados, por visibilidade:
SELECT m.title, m.visibility, m.kind, a.title AS atividade,
       pg_size_pretty(m."sizeBytes"::bigint) AS tamanho
  FROM speaker_materials m JOIN activities a ON a.id = m."activityId"
 WHERE m."deletedAt" IS NULL ORDER BY m.visibility, m."createdAt" DESC;

-- Carga apurada do certificado de palestrante (o que o documento afirma):
SELECT c."recipientName", c."workloadMinutes", c.status, c."validationCode"
  FROM certificates c
 WHERE c.kind = 'SPEAKER' ORDER BY c."createdAt" DESC LIMIT 20;
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Convite não é enviado por e-mail (E25)** | A plataforma não tem provedor de e-mail (F15 pendente) | O organizador entrega o código à mão; a tela diz isso ao lado do código |
| 2 | **Checksum do upload não é conferido quando o storage não o reporta (E26)** | O `PUT` assinado não inclui o metadado `x-amz-meta-sha256`; a verificação cai no tamanho (mesmo caminho desde a FASE 4) | Um objeto trocado por outro de MESMO tamanho passaria; hoje nenhum caminho do sistema o produz |
| 3 | **O palestrante não define a foto por URL (E27)** | A foto entra só pela esteira de upload (decisão de segurança) | Quem hospeda a foto fora precisa enviá-la para cá |
| 4 | **Sem convite em lote nem reenvio automático (E28)** | Depende do canal de e-mail (F15) | Evento com 40 palestrantes gera 40 convites um a um |
| 5 | **`ActivitySpeaker` mantém as colunas legadas duplicadas (E29)** | Reescrever agenda, certificado e credenciamento na mesma fase somaria risco | Duas fontes do mesmo dado, mantidas em sincronia por dois caminhos de escrita |

---

## 9. Checklist de aceite

- [x] **E18** — tabela `speaker_profiles` com RLS + FORCE + policy e `activity_speakers."speakerProfileId"`
- [x] **E18** — backfill: nenhum vínculo existente ficou sem perfil
- [x] **E18** — convite com token hasheado, validade e regeração que invalida o anterior
- [x] **E18** — aceite pelos dois caminhos (código e painel), com papel `SPEAKER` por ATIVIDADE
- [x] **E18** — o aceite cria o vínculo `PARTICIPANT` de quem não tinha nenhum
- [x] **E19** — portal do palestrante com perfil, foto, ementa, materiais e certificado
- [x] **E19** — guarda por permissão (`speaker:profile:update:own`) e posse conferida no banco
- [x] **E19** — editar perfil ou ementa de terceiro responde `FORBIDDEN`
- [x] **E19** — tela da organização com cadastro, convite, vínculo e desvínculo
- [x] **E20** — materiais com `PUBLIC` / `ATTENDEES_ONLY` / `PRIVATE` decididos por visitante
- [x] **E20** — upload direto (URL pré-assinada + SHA-256 do cliente + integridade na confirmação)
- [x] **E20** — download por rota própria com 401, 403 e 404 distintos e URL assinada
- [x] **E20** — desvincular despublica os materiais do vínculo
- [x] **E21** — bloco `SPEAKERS` com foto, bio, papel e badges das atividades
- [x] **E21** — ficha individual do palestrante e instrutores em destaque na atividade
- [x] **E21** — perfil oculto sai da vitrine e da ficha, mas continua na agenda
- [x] **E21** — certificado `SPEAKER` com carga somada, evento encerrado e credenciamento exigidos
- [x] Toda mutação auditada (perfil, convite, vínculo, material, aceite)
- [x] Seed demonstra o fluxo com os serviços reais (Bruno palestrante do minicurso de Rust)
- [x] Testes novos: 46 unitários + 33 de integração + 5 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela

---

## 10. Revisão pós-entrega — o portal que ninguém achava

> **Natureza:** revisão do MESMO tema (F25), a partir do uso real. Nenhum número de fase novo
> foi consumido e nenhuma migração foi necessária — tudo o que a pessoa pedia já existia no
> código, **inalcançável pela interface**.
> **ADRs:** 119 e 120 · **Testes novos:** 7 unitários + 2 de integração + 1 E2E.

### 10.1 O que o uso revelou

Depois da entrega, duas queixas chegaram com a tela na mão:

- *"não achei opção para o palestrante mudar as informações dele, como bio, nome, redes
  sociais, fotos, etc."* — o formulário existia, completo, em `/t/<slug>/palestrante`.
- *"quando uma organização fizer o convite, poderia aparecer dentro da área do palestrante
  esse convite para ele aceitar, principalmente quando ele já tiver conta"* — a lista de
  convites também existia, na mesma tela, identificada pelo e-mail da conta.

As duas estavam certas: as telas existiam e **não havia como chegar nelas**. O palestrante
logava, via o painel e um menu com um único item.

| # | Relato | Causa raiz | Correção |
|---|---|---|---|
| 1 | "não achei opção para o palestrante mudar as informações dele" | `buildTenantNav` decidia **todo** item de menu com `can(permissão, { scope: 'TENANT' })`. Permissão `:own` sem `ownerId` é negação por desenho (fail-closed, invariante nº 4) — então o grupo "Minha participação" inteiro era descartado, para qualquer papel. Menu e página discordavam: a página usa `holdsPermission` desde a F25 | Item pessoal (`:own`) passa a ser decidido por `holdsPermission`, o MESMO predicado da página; a posse continua sendo conferida no dado, a cada leitura e a cada escrita |
| 2 | "o convite poderia aparecer na área do palestrante para ele aceitar" | O aceite pelo painel existia, mas a entrada exigia o papel `SPEAKER` — que **só nasce com o aceite**. Impasse: sem papel não se chega ao convite; sem o convite não se ganha o papel | Segunda porta: **convite pendente endereçado ao e-mail da conta** abre o portal (guarda e item de menu). Quem ainda não tem vínculo com a instituição usa a página pública do convite, que agora também lista os convites daquele e-mail |

### 10.2 Decisões

#### ADR-119 — Item de menu e página decidem a MESMA permissão com o MESMO predicado

**Contexto.** O menu existia para não oferecer link que só redireciona, e a página existia
para não confiar no menu. Os dois lados perguntavam a mesma coisa com predicados diferentes:
a página com `holdsPermission` ("pode isto em algum escopo?"), o menu com
`can(..., { scope: 'TENANT' })` — que, para uma permissão `:own`, nem chega a olhar o papel:
recusa antes, por falta de dono.

**Decisão.** O predicado é escolhido pelo TIPO da permissão: `:own` → `holdsPermission`
(a posse vai ser conferida no dado); o resto → `can()` no escopo da instituição, com `scopes`
explícito no item cuja página aceita mais de um escopo (`Credenciamento` aceita `EVENT`, como
`requirePagePermission({ allowedScopes: ['TENANT','EVENT'] })`).

**Alternativas descartadas.** (a) Passar `{ ownerId: principal.userId }` ao `can()` do menu —
recusaria quem tem o papel em escopo `EVENT`/`ACTIVITY`, que é justamente o padrão recomendado
para palestrante e equipe do dia; (b) manter o item sempre visível e deixar a página recusar —
é o "link que só redireciona" que o próprio arquivo diz evitar; (c) repetir a lista de itens
pessoais com outra permissão — só esconderia a divergência até a próxima permissão nova.

**Consequências.** `tests/unit/tenant-nav.test.ts` prende o contrato nos dois sentidos (item
pessoal aparece; item institucional continua exigindo escopo de instituição). O menu passa a
ser um lugar onde uma permissão `:own` nova funciona sem código adicional — e onde um item
institucional novo precisa declarar seus escopos se a página for mais generosa.

#### ADR-120 — O convite pendente é uma PORTA, e a prova é o e-mail da conta

**Contexto.** O aceite já aceitava duas provas desde a F25 (ADR-115): o código entregue pela
organização e o e-mail da conta logada. A porta de entrada, porém, exigia um papel que só o
aceite concede — e o convite ficava inalcançável para quem mais precisava dele.

**Decisão.** Convite **pendente** (`userId` nulo + `inviteTokenHash` gravado + e-mail do perfil
igual ao da conta) é, ele mesmo, autorização para entrar no portal e para o item de menu
aparecer. Três pontos sustentam a decisão: a condição é uma só (`pendingInviteWhere`), usada
pela lista do portal, pela guarda e pelo menu — não há como as três discordarem; o papel
`SPEAKER` continua sendo concedido apenas no aceite, por ATIVIDADE; e o prazo do CÓDIGO **não**
fecha essa porta, porque o caminho do painel não usa o código (`evaluateClaim` sem token
ignora a validade) — a tela diz exatamente isso a quem tem um convite vencido.

**Alternativas descartadas.** (a) Exigir o código para ver o convite na área — devolveria o
problema ao ponto de partida ("perdi o link"); (b) deixar a lista só na página pública do
convite — funciona para quem não tem vínculo, mas esconde o recurso de quem está dentro do
painel (o caso relatado); (c) conceder o papel `SPEAKER` no cadastro do perfil, antes do
aceite — daria acesso ao portal a quem nunca confirmou que é a pessoa certa.

**Consequências.** O e-mail da conta passa a ser a chave de entrada do convite — e a
verificação de e-mail é da F15 (dívida **E30**): até lá, quem cria uma conta com o endereço
convidado entra. É o mesmo grau de confiança que o aceite pelo painel já usava (ADR-115), e o
aceite continua registrado na auditoria. No menu, o rótulo segue a porta: quem ainda não
assumiu vê "Convite de palestrante"; quem já assumiu vê "Portal do palestrante" — e o aceite
revalida o LAYOUT da instituição, porque é o layout que desenha o menu.

### 10.3 Lições aprendidas (revisão)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 11 | O palestrante relatou "não achei opção para mudar meus dados" — e o formulário existia, completo, na tela | O menu decidia `:own` com `can()` sem dono (negação garantida) e descartava o grupo pessoal inteiro; nenhum teste olhava o menu, e o E2E da fase navegava por URL direta | Predicado por TIPO de permissão (ADR-119) + `tests/unit/tenant-nav.test.ts` prendendo o contrato |
| 12 | Um convite pendente era invisível para quem tinha conta — a "área do palestrante" ficava vazia e o aceite dependia do link | A entrada exigia o papel que o aceite concede: dependência circular entre porta e chave | Convite pendente como segunda porta (ADR-120), com a lista também na página pública do convite |
| 13 | O item de menu do credenciamento sumia para a equipe do dia (papel por EVENTO), embora a tela a autorize desde a F12 | O menu exigia escopo de instituição para um item cuja página aceita `['TENANT','EVENT']` — a mesma divergência do item 11, na direção oposta | `scopes` explícito no item, espelhando o `allowedScopes` da guarda da página |
| 14 | Um convite com o código vencido parecia "perdido" | A tela tratava validade do CÓDIGO como validade do CONVITE | A lista diz que o prazo venceu e que assumir o perfil por ali continua valendo (o caminho do painel não usa o código) — o teste de integração fixa as duas coisas |

### 10.4 Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 51 arquivos, 1250 testes passando (+9 nesta revisão)
npm run build                → ✓ Compiled successfully
npm run test:e2e             → 75 passed (1.8m)

E2E do caminho novo (contra o container de produção):
✓ quem foi convidado encontra o convite no MENU, aceita e edita o próprio perfil (revisão da F25)

Integração (banco real):
✓ o convite pendente é reconhecido pelo e-mail da conta — e a porta se fecha no aceite
✓ o prazo do CÓDIGO não fecha a porta: quem tem conta assume pelo e-mail
```

O cenário de E2E começa no PAINEL (não na URL do convite), clica no item do menu e termina com
a bio salva no banco: era exatamente o percurso que não existia. Ele também prende os dois
estados da porta — o item "Convite de palestrante" antes do aceite e "Portal do palestrante"
depois.

### 10.5 Checklist da revisão

- [x] Item pessoal (`:own`) do menu decidido pelo mesmo predicado da página (`holdsPermission`)
- [x] Item cuja página aceita `EVENT` declara os escopos no menu (credenciamento)
- [x] Convite pendente abre o portal e aparece no menu, com rótulo que diz o que é
- [x] A mesma condição (`pendingInviteWhere`) serve à lista, à guarda e ao menu
- [x] Página pública do convite lista os convites do e-mail da conta logada (caso sem vínculo)
- [x] Convite vencido continua visível e aceitável pelo e-mail, e a tela explica
- [x] Aceite revalida o layout da instituição (o menu muda de rótulo na hora)
- [x] Testes: 7 unitários (menu), 2 de integração (porta do convite), 1 E2E (percurso completo)
- [x] Bateria completa executada, com os números reais reportados na seção 10.4
- [x] `AGENTS.md`, `docs/dividas-tecnicas.md` e `README.md` atualizados

---

**Aguardando APROVADO: AVANÇAR**
