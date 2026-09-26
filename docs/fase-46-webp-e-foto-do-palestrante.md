# FASE 46 — Imagens em WebP e a foto do palestrante sem conta

> **Tema escolhido pelo humano.** O pedido chegou em duas partes: (1) toda foto
> enviada deve ser guardada em WebP para ocupar menos espaço no servidor — "um padrão
> do sistema para toda imagem feita por upload"; (2) o palestrante que **não faz
> cadastro** na plataforma precisa ter imagem na vitrine.

---

## 1. Sumário executivo

### 1.1 O que entrou

| # | Entrega | Onde |
|---|---|---|
| 1 | **WebP é o formato de armazenamento** de toda imagem enviada — capa, logotipo, patrocinador, galeria e foto do palestrante | `src/domain/events/image-rules.ts` · `src/lib/storage/image-converter.ts` · `src/lib/admin/asset-service.ts` |
| 2 | **A conversão acontece no SERVIDOR**, na confirmação do upload: o arquivo é decodificado, reencodado e gravado; o **original é apagado** | `src/lib/admin/asset-service.ts` |
| 3 | **Política de codificação por finalidade** — foto com perda calibrada (`FOTOGRAFIA`) × logotipo sem perda (`GRAFICO`), com teto de pixels onde ele economiza | `src/domain/events/image-rules.ts` |
| 4 | **A conversão é a validação de conteúdo**: o que não decodifica não é imagem — e é recusado com o objeto apagado | `src/lib/storage/image-converter.ts` |
| 5 | **Recusa honesta de imagem animada** e **teto de pixels antes de decodificar** (bomba de descompressão) | `src/lib/storage/image-converter.ts` |
| 6 | **O aviso e a economia ficam visíveis** na tela: "guardada em WebP (620 KB — 74% menor)" | `src/components/admin/asset-uploader.tsx` · `src/components/speakers/speaker-photo-field.tsx` |
| 7 | **O acervo mostra o formato guardado** (WebP/PNG/JPEG/AVIF) por imagem | `.../pagina/midia/page.tsx` |
| 8 | **A organização publica a foto de quem não tem conta**, com **declaração de autorização** registrada na trilha | `src/lib/speakers/speaker-service.ts` · `admin-speaker-panel.tsx` |
| 9 | **A origem da foto é coluna** (`ORGANIZATION` × `SPEAKER`) e o portal avisa quando a foto não foi a pessoa que enviou | `prisma/schema.prisma` · `portal-forms.tsx` |
| 10 | **A ficha do palestrante passou a ser EDITÁVEL** pela organização (antes só existia criação) | `admin-speaker-panel.tsx` · `.../palestrantes/page.tsx` |
| 11 | **O palestrante pode REMOVER a própria foto** — "remover" passou a existir | `speaker-photo-field.tsx` · `speaker-portal-service.ts` |

### 1.2 Números da fase

| | |
|---|---|
| Arquivos novos | **8** — 2 de código, 1 migração, 4 de teste, 1 documento (este) |
| Arquivos modificados | **25** — 17 de código/configuração, 2 de dependência, 6 de teste |
| Dependência nova | **`sharp` 0.35.4** (libvips 8.18.6) — produção, com o binário da plataforma |
| Migrações | **41 → 42** (`speaker_avatar_source`) |
| Testes novos | **31** — 15 unitários, 13 de integração e **3 E2E** |
| Suíte | **104 arquivos · 2328 testes** (de 2300) · E2E **155** (de 152) |
| ADRs | **248 a 253** (a próxima é a 254) |
| Permissões / tabelas de tenant | **66** · **55** (ambas inalteradas) |
| Defeitos reais encontrados | **4 de produto** e **2 de teste** (seção 5) |
| Dívidas declaradas | **E65** e **E66** |

---

## 2. O problema mais difícil da fase

**A aplicação não via o arquivo.** Desde a FASE 17 o upload de imagem vai direto do
navegador para o storage por URL pré-assinada — o processo Node nunca toca nos bytes.
A decisão era boa e continua: um PDF de 20 MB não passa pela memória da aplicação.

Converter para WebP exige exatamente o que o desenho original evitava: **ler os bytes**.
As saídas possíveis eram três:

1. **converter no navegador** — mais barato (subiria já menor), mas a garantia ficaria
   com quem envia: um cliente que ignore o passo, ou que fale direto com a URL assinada,
   deixaria o acervo fora do padrão;
2. **manter os dois objetos** (original + WebP) — nada de economia, que é o objetivo;
3. **converter na confirmação, e apagar o original** — a aplicação lê UM objeto de até
   5 MB (o teto já existente por finalidade), grava o WebP e remove o que subiu.

A terceira é a escolhida. E o que parecia um custo virou o maior ganho da fase: **a
partir do momento em que o servidor DECODIFICA o arquivo, ele deixa de confiar no
`Content-Type` assinado** — que era a única conferência de conteúdo do caminho. O
HTML disfarçado de PNG, que antes era aceito e servido publicamente pelo bucket, agora
não decodifica e é recusado (ADR-249, §5 defeito 3).

**A arte de fundo do certificado ficou de fora, e não por esquecimento:** o PDF embute
a arte como `/DCTDecode` (JPEG cru, sem recomprimir, ADR-216). PDF não embute WebP —
converter a arte quebraria a emissão, e não há ganho que justifique reencodar um JPEG
que vai para papel (ADR-251).

---

## 3. Decisões técnicas

### 3.1 A política é DADO, com duas variáveis por finalidade

```ts
export const WEBP_POLICY: Record<AssetTarget, WebpPolicy> = {
  COVER:          { mode: 'FOTOGRAFIA', maxLongestSide: 1920 },
  GALLERY:        { mode: 'FOTOGRAFIA', maxLongestSide: 2560 },
  SPEAKER_AVATAR: { mode: 'FOTOGRAFIA', maxLongestSide: 512 },
  LOGO:           { mode: 'GRAFICO',    maxLongestSide: null },
  SPONSOR_LOGO:   { mode: 'GRAFICO',    maxLongestSide: null },
};
```

* **Modo** decide a codificação: `FOTOGRAFIA` usa perda calibrada (qualidade 82, o
  joelho da curva para foto); `GRAFICO` vai **sem perda**, porque logotipo tem borda de
  letra e o artefato aparece justamente ali. Medido no teste: um logo PNG de 571 bytes
  sai em **62 bytes** de WebP sem perda — menor e nítido.
* **Maior lado** sai de ONDE a imagem é exibida, não de um número redondo: avatar de
  56 px não precisa de 12 megapixels; a capa cobre a largura de tela; o logotipo é
  pequeno e é visto no tamanho que tem — reduzir ali só borraria a marca.
* **Nunca amplia** (`withoutEnlargement`): uma imagem menor que o teto fica do tamanho
  que é.

**Catraca:** um teste percorre `ASSET_TARGETS` e exige política para cada alvo. Um alvo
novo sem política não passa — sem ele, o alvo cairia no `undefined` do `Record` em
runtime e a imagem seria gravada no formato que o cliente mandou.

### 3.2 A chave troca de extensão (o objeto não é sobrescrito)

O upload assina a chave com a extensão do arquivo enviado (`…-capa.png`); a conversão
grava em **outra chave**, com a extensão do formato real (`…-capa.webp`), e o objeto
antigo é apagado. Gravar bytes de WebP num objeto `.png` seria uma mentira no bucket —
e é a extensão que CDN, cache e navegador leem. `webpKeyFor` é puro e idempotente
(`foto.webp` → `foto.webp`, sem virar `foto.webp.webp`).

### 3.3 A conversão também apaga os metadados — e assenta a orientação

Não há `withMetadata()` no caminho, então **data, modelo da câmera e coordenadas não
seguem para a página pública**. E `rotate()` sem argumento aplica a orientação do EXIF
aos pixels, o que é obrigatório justamente porque o EXIF não vai junto: sem ele, a foto
de celular deitada apareceria girada. O teste unitário prende as duas coisas
(60×30 com orientação 6 vira 30×60 **sem** `exif`).

A tela diz isso ao organizador — é a única parte da conversão que interessa a ele além
do tamanho:

> Guardamos toda imagem em WebP: o arquivo fica menor e os dados da câmera (data e
> local) não são publicados.

### 3.4 A foto de terceiro: a organização publica, e a declaração fica na trilha

O palestrante que nunca vai assumir o perfil tem a foto em mãos da organização (por
e-mail, no contrato do evento). A plataforma não tem como VERIFICAR esse consentimento
— o que ela pode fazer é **guardar quem declarou**:

* a caixa "Tenho autorização do palestrante para publicar esta foto" é exigida **pelo
  serviço**, e só quando a foto é NOVA (`publishingNewPhoto`). Exigir a cada gravação
  transformaria a caixa em ruído — o organizador marcaria sem ler para corrigir um nome;
* a declaração entra na trilha como fato próprio (`autorizacaoDaFoto`), não misturada à
  mudança da coluna: se o uso da imagem for questionado, o que se procura é quem
  declarou e quando;
* `avatarSource` (`ORGANIZATION` × `SPEAKER`) é **coluna**, e não dedução: é o que
  permite o portal avisar "a organização enviou esta foto; você pode trocá-la ou
  removê-la". Sem ela, a tela não teria como distinguir a foto dele da que puseram no
  lugar.

### 3.5 Dois formulários, uma esteira

O campo da foto virou componente único (`SpeakerPhotoField`), usado pelo portal e pela
organização. A FASE 25 tinha escrito a esteira dentro do portal, porque só o palestrante
podia enviar; a segunda cópia divergiria no primeiro ajuste — bastava um lado ganhar o
aviso da conversão para as duas telas contarem histórias diferentes sobre o mesmo
arquivo.

A esteira de upload (`uploadAssetFile`) recebeu um contrato **estrutural**
(`UploadActionState`) em vez do estado de uma página: ela é chamada por dois formulários
que devolvem estados de tipos diferentes e idênticos na forma. Amarrá-la a um deles
obrigaria a duplicar o módulo inteiro só para satisfazer o compilador.

### 3.6 O que a tela mostra

| Onde | O que diz |
|---|---|
| Campo de imagem (capa, logo, galeria, patrocinador) | formatos aceitos + o aviso do WebP |
| Depois do envio | **"Imagem enviada e guardada em WebP (620 KB — 74% menor)."** |
| Foto do palestrante (organização) | "Foto enviada e guardada em WebP (…) Salve o palestrante para publicá-la." |
| Foto do palestrante (portal) | "Foto validada e guardada em WebP (…) Clique em 'Salvar perfil' para publicá-la." |
| Acervo | formato gravado por imagem (`WebP`, `PNG`, `JPEG`, `AVIF`) |
| Ficha do palestrante na organização | "Foto publicada pela organização (o palestrante pode trocá-la ou removê-la no portal)." |
| Portal, quando a foto é da organização | a nota com as duas saídas + botão **Remover foto** |

A economia só é anunciada quando existe: `webpSavingsLabel` devolve `null` quando o
WebP saiu maior que o original (acontece em imagem minúscula), e aí a frase certa é
nenhuma.

---

## 4. ADRs

### ADR-248 — Toda imagem enviada é gravada em WebP, no servidor, por política por finalidade

**Contexto.** As imagens entravam em PNG, JPEG, WebP ou AVIF e ficavam no acervo no
formato que o cliente mandou. Numa instituição com muitos eventos isso significa o
mesmo pixel ocupando duas ou três vezes mais espaço do que precisa, e a quota de
armazenamento do plano medindo esse desperdício.

**Decisão.** A confirmação do upload (`confirmAssetUpload`) **reconverte** o objeto
para WebP antes de registrar. A política (`WEBP_POLICY`) define, por finalidade, o modo
de codificação (com perda para foto, sem perda para logotipo) e o teto do maior lado
(nulo = não redimensiona).

**Justificativa.** Converter no navegador deixaria a garantia com quem envia; guardar os
dois objetos anularia a economia. A política como DADO permite que a próxima finalidade
declare o que precisa em uma linha, e a catraca de teste impede que ela esqueça de
declarar.

**Consequências.** O tipo gravado passa a ser sempre `image/webp` (o acervo mostra o
formato quando o dado é anterior à fase). A conversão custa CPU do processo web — uma
imagem de até 5 MB por requisição, com teto de pixels. Imagem que não decodifica é
recusada.

### ADR-249 — A conversão é a validação de conteúdo: o que não decodifica é recusado, e o original é apagado

**Contexto.** A URL pré-assinada trava chave, tamanho e validade — **não o conteúdo**. A
primeira validação olha os bytes que o CLIENTE DECLARA. A confirmação conferia tamanho,
checksum e o `Content-Type` gravado no objeto (que é o que a assinatura mandou). Ou
seja: quem tinha a URL podia gravar outra coisa ali, e o objeto era servido
publicamente pelo bucket com o tipo assinado.

**Decisão.** Depois de conferir integridade e tipo, o serviço **lê o objeto, decodifica
e reencoda**. Falha de decodificação é recusa (`INVALID_INPUT`) com o objeto apagado. O
objeto enviado é apagado também no caminho de sucesso, depois de o WebP estar gravado.

**Justificativa.** É a única checagem do sistema que olha o conteúdo de verdade. E é a
razão pela qual a recusa é a resposta certa: aceitar um arquivo que não decodifica é
publicar na página pública algo que o navegador de quem visita pode interpretar de
qualquer maneira.

**Consequências.** Um arquivo de imagem malformado — que o navegador perdoa e desenha —
passa a ser recusado com mensagem útil ("o conteúdo do arquivo não pôde ser lido como
imagem"). Foi o que aconteceu com o fixture da própria suíte (§5, defeito 1). A remoção
do original é best-effort: se falhar, o log diz, e sobra um objeto órfão no bucket — não
um vínculo quebrado.

### ADR-250 — Imagem animada é RECUSADA (não achatada) e a bomba de pixels é recusada ANTES de decodificar

**Contexto.** O decodificador entrega o primeiro quadro por padrão. O limite por BYTES
não protege contra bomba de descompressão: um arquivo de dezenas de bytes pode declarar
8.000 × 6.000 e pedir centenas de megabytes ao ser aberto.

**Decisão.** Duas guardas antes de alocar memória: (a) imagem animada é recusada com o
motivo escrito, checando **o bit de animação do contêiner** (`VP8X` do WebP) além da
contagem de quadros; (b) o cabeçalho é lido sem limite de pixels, o número de pixels é
conferido contra `MAX_SOURCE_PIXELS` (40 MP) e só então a codificação roda com o limite
ligado.

**Justificativa.** Achatar em silêncio transformaria um WebP animado que funcionava
ontem num quadro parado hoje — degradação sem aviso. E medir é barato (só o cabeçalho);
medir ANTES permite recusar dizendo o tamanho, em vez de estourar um erro genérico do
libvips. A checagem por BYTES do contêiner cobre o caso em que o decodificador não conta
os quadros.

**Consequências.** Um WebP animado deixa de ser aceito (era aceito e servido animado
antes da fase). O teto de 40 MP é acima de qualquer câmera de celular comum e cabe na
memória do processo.

### ADR-251 — A arte de fundo do certificado fica FORA do padrão WebP

**Contexto.** O editor visual do certificado (FASE 40) aceita uma arte de fundo que é
embutida no PDF como XObject `/Filter /DCTDecode` — ou seja, **os bytes do JPEG entram
no documento como estão**, sem recomprimir (ADR-216). A fase também recusa CMYK e JPEG
progressivo, e mede a resolução mínima em dpi.

**Decisão.** A arte continua JPEG. Nenhuma conversão toca nela, e o caminho de upload
dela (FormData → serviço do modelo) continua separado da esteira de imagens do evento.

**Justificativa.** **PDF não embute WebP.** Converter a arte quebraria a emissão do
certificado — o oposto do que o padrão veio fazer. Além disso a arte é insumo de
documento oficial impresso: reencodar com perda mudaria a cor da instituição no papel,
que é exatamente o que a regra de CMYK recusa evitar.

**Consequências.** O acervo tem duas famílias de imagem com regras diferentes, e o
documento diz por quê. A regra vale para tudo o que é GERADO pelo servidor (QR do
estande, folha de crachá, PDFs): não são uploads, e nenhum deles passa pelo WebP.

### ADR-252 — A organização publica a foto de quem não tem conta, com declaração na trilha e origem em coluna

**Contexto.** Até esta fase a ÚNICA forma de um palestrante ter foto era ele assumir o
perfil e enviá-la pelo portal. Quem nunca faz cadastro — o caso comum de quem vem de
fora — ficava sem foto, e a organização **não tinha como resolver**: o formulário de
cadastro não tinha o campo e a action nem lia `avatarUrl`.

**Decisão.** O formulário da organização (criação **e** edição) ganha o campo da foto,
reusando a esteira `SPEAKER_AVATAR` com o portão de `speaker:manage`. A foto nova exige
a declaração de autorização, exigida **pelo serviço**, e a declaração entra na trilha
como fato próprio. A coluna `SpeakerAvatarSource` registra quem enviou, e o portal avisa
quando não foi a pessoa — com as duas saídas (trocar ou remover) disponíveis.

**Justificativa.** A plataforma não verifica consentimento; ela registra quem declarou.
A coluna é o que torna o aviso possível, e o aviso é o que torna o consentimento
revisável por quem é o titular do dado (LGPD). Exigir a caixa no SERVIÇO, e não na tela,
é o que a faz valer para qualquer caminho de escrita.

**Consequências.** A ficha do palestrante passou a ser editável (não existia), e a
exclusão da foto existe nos dois lados. Com a caixa desmarcada, publicar foto nova é
recusado com o motivo. O modelo de dados ganhou uma coluna e um enum — 1 migração.

### ADR-253 — Foto ausente PRESERVA; foto vazia APAGA

**Contexto.** `saveSpeakerProfile` gravava `avatarUrl: input.avatarUrl?.trim() || null`.
O formulário de edição da organização não mandava o campo — então **corrigir um nome
apagava a foto** que o palestrante subira no portal, sem aviso e sem desfazer. No
sentido oposto, o portal preservava em qualquer caso (inclusive no campo vazio), e
assim **não havia como REMOVER uma foto publicada** — só trocá-la por outra.

**Decisão.** `undefined` (campo ausente) **preserva**; `null`/`''` (campo vazio)
**apaga**. O mesmo contrato nos dois serviços, e a interface de remoção existe nos dois
formulários.

**Justificativa.** São duas intenções diferentes e ambas reais: um formulário que não
traz o campo não tem o que decidir; quem clicou em "Remover foto" manda o campo vazio de
propósito. É a **terceira vez** que esta armadilha aparece no projeto — `taxId` do
patrocinador (FASE 17) e o campo de contatos do perfil público (FASE 45) — e a lição
está estabilizada: **campo que a tela não manda não pode ser decidido por omissão**.

**Consequências.** A action do portal deixou de usar `|| undefined` (que transformava
"remover" em "não mexer"). A origem acompanha a decisão: URL igual mantém a origem,
URL nova pelo portal é `SPEAKER`, URL nova pela organização é `ORGANIZATION`, e sem foto
a origem é nula.

---

## 5. Lições aprendidas — defeitos REAIS encontrados

### 5.1 De produto (4)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Editar o **nome** de um palestrante apagava a **foto** dele | `saveSpeakerProfile` gravava `avatarUrl: input.avatarUrl ?? null`, e o formulário da organização não mandava o campo | `undefined` preserva, `''` apaga (ADR-253), com teste de integração trancando o caso |
| 2 | Criar o palestrante **já com a foto** registrava a declaração de autorização em lugar nenhum | a declaração só tinha sido adicionada à trilha do ramo de UPDATE; o perfil novo grava CREATE | a declaração (e a foto) entram nos dois ramos da trilha; achado pelo teste da trilha |
| 3 | Um HTML enviado como `image/png` era **aceito e servido publicamente** | a confirmação confiava no `Content-Type` assinado; o conteúdo nunca era decodificado | a decodificação obrigatória da ADR-249 fecha a porta; teste de integração reproduz o ataque (bytes de PNG declarados, HTML enviado) |
| 4 | O botão "Remover foto" do portal **não removia** | a action usava `(formData.get('avatarUrl') as string) \|\| undefined`, e `''` virava "não mexer" | a action passa o valor como veio; o serviço decide (ausente preserva, vazio apaga) |

> O defeito 4 foi encontrado ao **ligar a interface de remoção** — o serviço já estava
> correto e testado; o caminho da Server Action não estava. É a razão de a §8 registrar
> que a remoção pelo portal é coberta no serviço, e não ponta a ponta.

### 5.2 De teste (2)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 5 | A conversão recusava o PNG de todos os fixtures E2E | o PNG 1×1 usado desde a FASE 17 tem o **CRC do `IDAT` errado** (calculado `5f2c8f77`, gravado `abce3689`). O navegador perdoa e desenha; o libpng recusa | fixture substituído por um PNG 8×8 válido em 6 arquivos, com a nota do motivo no lugar do comentário antigo |
| 6 | A asserção "a imagem virou WebP" passou **enquanto a conversão falhava** | a mensagem de ERRO termina em "Envie PNG, JPEG, WebP ou AVIF" — e `/WebP/i` casava com ela | asserção endurecida para `/guardada em WebP/i`, que só a mensagem de sucesso tem |

> A lição 6 é a **mesma família** da lição de `getByLabel` da FASE 45: asserção por
> substring casa com o texto errado. Texto de sucesso e texto de erro nunca devem
> compartilhar a palavra que a asserção procura.

### 5.3 Verificação (2 achados)

* `npm run db:migrate` (`prisma migrate dev`) **travou sem saída por dez minutos** e
  precisou ser interrompido: o comando é interativo. O caminho não interativo é
  `prisma migrate deploy` (ou o `db:migrate:deploy` do projeto). A migração tinha sido
  aplicada antes do travamento — conferido em `migrate status` e na contagem da tabela
  `_prisma_migrations`.
* O documento da FASE 45 registra "40 migrations found" na evidência; a árvore já tinha
  **41** naquele momento (39 antes da F45, +2 da F45). O número desta fase é medido da
  árvore: **42** pastas e 42 linhas aplicadas em `_prisma_migrations`.

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 104 arquivos · 2328 testes passando
npm run build ..................... ✓ Compiled successfully
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npx prisma migrate status ......... 42 migrations found · Database schema is up to date!
npm run db:seed ................... ✓ (o seed não publica foto: sem depender de bucket)
docker compose --profile app up -d --build web worker
                                   ✓ imagem reconstruída com o `sharp`
docker compose exec web node -e "require('sharp')"
                                   → sharp 0.35.4 · vips 8.18.6 (binário musl do Alpine)
npm run test:e2e .................. 155 passed
npx playwright test tests/e2e/speaker-photo.spec.ts
                                   → 3 passed · a organização publica a foto de quem não
                                     tem conta; corrigir o nome preserva; remover tira
                                     da vitrine; sem declaração é recusado
```

### 6.1 O que os testes unitários provam (15)

1. todo alvo de imagem tem política de WebP — inclusive os que vierem depois (catraca);
2. os tetos: foto do palestrante 512, capa 1920, galeria 2560; logotipo **sem** teto;
3. a chave troca só a extensão, e é idempotente;
4. a economia só é anunciada quando existe;
5. o rótulo do formato distingue WebP/PNG/JPEG/AVIF (e não mente no acervo antigo);
6. o PNG enviado vira WebP — pela assinatura do arquivo, não pelo tipo declarado;
7. a foto acima do teto é reduzida **preservando a proporção** (3000×2000 → 1920×1280);
8. a foto do palestrante cabe em 512 px (1200×1600 → 384×512);
9. **nunca amplia** (200×150 continua 200×150);
10. a transparência sobrevive;
11. o logotipo vai **sem perda** e ainda fica menor que o PNG;
12. a orientação do EXIF é assentada e os metadados **não** vão junto;
13. conteúdo que não é imagem é recusado (a única checagem que decodifica);
14. imagem **animada** é recusada em vez de achatada;
15. a **bomba de pixels** (8.000 × 6.000 declarados em 120 bytes) é recusada pelo
    cabeçalho, sem alocar memória.

### 6.2 O que os testes de integração provam (13)

**Armazenamento (5).** O PNG enviado vira `.webp` no bucket e o **objeto original não
existe mais**; o acervo guarda `image/webp` com o tamanho real e a quota mede o que foi
gravado; a capa do evento aponta para o WebP e a trilha guarda a troca; o arquivo que
não é imagem é recusado **na confirmação** (com os bytes de PNG declarados pelo cliente)
e nada sobra no bucket; dois envios do mesmo arquivo produzem o mesmo objeto (o
reaproveitamento por checksum continua valendo depois da conversão).

**Foto do palestrante (8).** Sem a declaração, a foto não é publicada; com ela, o perfil
nasce `ORGANIZATION`; a declaração fica na trilha (CREATE **e** UPDATE) com o ator da
sessão; editar o nome sem mandar a foto **preserva** a foto e a origem; a foto vazia
apaga as duas; a tela da organização recebe a origem; o palestrante que assume o perfil
e troca a foto passa a `SPEAKER` (e o não-dono recebe `FORBIDDEN`); e quando ele remove,
a origem também sai.

---

## 7. Comandos operacionais

```bash
# A fase não tem rotina própria: a conversão acontece no upload.
# O que se confere depois de um envio:

# O objeto que está no bucket (a chave final termina em .webp)
docker compose exec minio sh -c 'ls -la /data/eventflow-assets/tenants/*/eventos/*/assets/*/ | head'

# O acervo com o formato e o tamanho GRAVADOS
# /t/<slug>/administracao/eventos/<eventId>/pagina/midia

# A trilha da foto enviada pela organização
psql "$DATABASE_URL" -c "SELECT \"entityId\", changes, \"createdAt\" FROM audit_logs WHERE \"entityType\" = 'speakerProfile' ORDER BY \"createdAt\" DESC LIMIT 5"

# Reprocessar as migrações (não interativo — `prisma migrate dev` trava sem TTY)
npm run db:migrate:deploy
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Declaradas nesta fase

| Código | Dívida |
|---|---|
| **E65** | A conversão vale do próximo envio em diante: **o acervo anterior à FASE 46 não é reconvertido**. Não há CLI de reprocessamento, e uma imagem antiga continua PNG/JPEG no bucket (o acervo mostra o formato, então a tela não mente). Reprocessar exigiria reapontar as referências em capa, logotipo, patrocinador, conteúdo de blocos e foto de palestrante. |
| **E66** | A declaração de autorização da foto é uma **caixa de seleção**, não uma prova: a plataforma registra quem declarou e quando, mas não guarda o documento nem o canal pelo qual o consentimento veio. |

### 8.2 Pontos de atenção

* **Custo de CPU no processo web.** A conversão roda na Server Action de confirmação.
  O teto por finalidade (5 MB na capa) e o teto de pixels (40 MP) limitam o estrago, mas
  a fase **não mediu** tempo de conversão sob carga — um envio em massa (galeria com
  dezenas de imagens) é sequencial no navegador e merece medição se virar incômodo.
* **O seed continua sem imagens.** Ele nunca escreveu binário no bucket (nem capa, nem
  logotipo), então a foto do palestrante da demonstração não existe — a vitrine do demo
  mostra as iniciais. Levar a foto para o seed exigiria gerar e gravar bytes no bucket,
  o que foge do "seed executa os serviços reais".
* **Migração de imagem não é idempotente por natureza.** O `checksum` do acervo é o do
  WebP gravado: dois arquivos DIFERENTES podem virar o mesmo WebP (raro, mas possível em
  imagens chapadas) e o segundo é reaproveitado. É o comportamento desejado (economia),
  e está documentado aqui para não ser lido como defeito.
* **A remoção da foto pelo portal é coberta no SERVIÇO**, não ponta a ponta no
  navegador: o E2E exercita a remoção pelo lado da organização. O caminho da action do
  portal (campo vazio = remover) tem teste de integração do serviço e a correção da
  §5.1(4).
* **`tests/**` continua fora do `typecheck`** (armadilha registrada na FASE 45): os
  arquivos de teste novos foram conferidos rodando, não pelo compilador.

---

## 9. Checklist de aceite

* [x] Toda imagem enviada é **gravada em WebP** (capa, logotipo, patrocinador, galeria,
      foto do palestrante) — sem depender do cliente.
* [x] A conversão acontece **no servidor**, na confirmação do upload.
* [x] O arquivo ORIGINAL é **apagado** depois da conversão.
* [x] O teto de dimensão **nunca amplia** e respeita a proporção.
* [x] Logotipo é gravado **sem perda**; foto, com perda calibrada.
* [x] A orientação do EXIF é assentada e os **metadados (data/local) não são publicados**.
* [x] Imagem animada é **recusada com o motivo**, e não achatada.
* [x] Arquivo que não decodifica é **recusado**, e o objeto é removido do bucket.
* [x] A tela mostra o formato final e a **economia** obtida.
* [x] O acervo mostra o **formato gravado** de cada imagem.
* [x] A arte do certificado continua **JPEG** (PDF não embute WebP) — com o porquê
      documentado.
* [x] A organização **publica a foto de quem não tem conta**, com declaração de
      autorização exigida pelo serviço.
* [x] A declaração fica na **trilha**, com o ator da sessão.
* [x] A origem da foto é **coluna**, e o portal avisa quando não foi a pessoa que enviou.
* [x] O palestrante pode **trocar ou remover** a foto que a organização publicou.
* [x] Editar a ficha (nome, papel, bio, foto, visibilidade) é possível pela organização.
* [x] Corrigir o nome **não apaga** a foto; o campo vazio **apaga**.
* [x] Foto nova sem declaração é **recusada** com mensagem útil.
* [x] Nenhuma permissão nova (66) e nenhuma tabela nova (55 sob RLS).
* [x] Suíte verde: **2328 testes + 155 E2E**, com a imagem reconstruída.
* [x] Documentação e README atualizados; dívidas **E65** e **E66** declaradas.
