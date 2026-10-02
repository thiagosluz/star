# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.ts >> telas públicas >> o diretório público de instituições não tem violação crítica
- Location: tests\e2e\accessibility.spec.ts:457:3

# Error details

```
Error: Acessibilidade em diretório de instituições (/organizacoes): 1 violação(ões) de impacto crítico/sério

  ✗ color-contrast (serious) — Elements must meet minimum color contrast ratio thresholds
    o que corrigir: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
    elementos (1):
      #ef-aparencia
        <<span id="ef-aparencia" class="text-xs font-medium text-muted">Aparência:</span>>
    regra: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=playwright


expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "color-contrast",
+ ]
```

# Test source

```ts
  178 |     }));
  179 | 
  180 |     /**
  181 |      * A isenção olha para o ELEMENTO e seus ANCESTRAIS no navegador, e não para o HTML
  182 |      * do próprio nó: quem falha é o `<p>` interno, e a cor vem de um invólucro com o
  183 |      * token (`text-warning-strong`) — o HTML do nó não traz a classe, e casar por texto
  184 |      * deixaria a isenção sem efeito (foi o primeiro erro desta varredura).
  185 |      */
  186 |     const restantes = isencao
  187 |       ? (
  188 |           await Promise.all(
  189 |             nodes.map(async (node) => {
  190 |               const seletor = node.alvo.split(' >>> ').pop() ?? node.alvo;
  191 |               const herdado = await page
  192 |                 .evaluate(
  193 |                   (dados) => {
  194 |                     try {
  195 |                       const elemento = document.querySelector(dados.seletor);
  196 |                       return Boolean(elemento?.closest('.' + dados.classe));
  197 |                     } catch {
  198 |                       return false;
  199 |                     }
  200 |                   },
  201 |                   { seletor, classe: isencao.classeAncestral },
  202 |                 )
  203 |                 .catch(() => false);
  204 | 
  205 |               return herdado ? null : node;
  206 |             }),
  207 |           )
  208 |         ).filter((node): node is NodeResumo => node !== null)
  209 |       : nodes;
  210 | 
  211 |     isentos += nodes.length - restantes.length;
  212 | 
  213 |     if (restantes.length === 0) continue;
  214 | 
  215 |     reprovadas.push({
  216 |       id: violacao.id,
  217 |       impacto: violacao.impact ?? 'desconhecido',
  218 |       ajuda: violacao.help,
  219 |       descricao: violacao.description,
  220 |       url: violacao.helpUrl,
  221 |       nodes: restantes,
  222 |     });
  223 |   }
  224 | 
  225 |   if (isentos > 0) {
  226 |     /**
  227 |      * O aviso fica no log de propósito: quem for corrigir a paleta precisa saber que a
  228 |      * isenção AINDA está sendo usada (e onde).
  229 |      */
  230 |     console.log(
  231 |       `[a11y] ${tela}: ${isentos} nó(s) isento(s) — dívida do token de aviso (ver ISENCOES)`,
  232 |     );
  233 |   }
  234 | 
  235 |   /**
  236 |    * ─────────────────────────────────────────────────────────────────────────────
  237 |    *  E O LANDMARK: EXATAMENTE UM `<main>` POR TELA (ADR-290 · FASE 60)
  238 |    * ─────────────────────────────────────────────────────────────────────────────
  239 |    *  A FASE 52 tirou o `<main>` da casca e o devolveu às páginas — e **16 páginas
  240 |    *  ficaram sem NENHUM** (a dívida I2). O `axe` não reprova landmark ausente (é boa
  241 |    *  prática, e não critério do AA), então sem esta linha a varredura ficaria VERDE
  242 |    *  numa tela sem landmark nenhum.
  243 |    *
  244 |    *  A pergunta é feita ao DOM, e nos DOIS sentidos: ZERO pega a página que não tem o
  245 |    *  seu `<main>`; DOIS pega a casca voltando a ser landmark — o defeito original
  246 |    *  (achado H5), que não pode renascer em silêncio.
  247 |    *
  248 |    *  Vem ANTES do retorno antecipado de propósito: dentro do caminho de falha, a
  249 |    *  catraca só rodaria em tela já reprovada.
  250 |    */
  251 |   await expect
  252 |     .soft(page.locator('main'), `Landmarks <main> em ${tela}: esperado exatamente 1`)
  253 |     .toHaveCount(1);
  254 | 
  255 |   if (reprovadas.length === 0) return { isentos };
  256 | 
  257 |   const detalhe = reprovadas
  258 |     .map((violacao) => {
  259 |       const alvos = violacao.nodes
  260 |         .map((node) => `      ${node.alvo}\n        <${node.html.slice(0, 180)}>`)
  261 |         .join('\n');
  262 | 
  263 |       return [
  264 |         `  ✗ ${violacao.id} (${violacao.impacto}) — ${violacao.ajuda}`,
  265 |         `    o que corrigir: ${violacao.descricao}`,
  266 |         `    elementos (${violacao.nodes.length}):`,
  267 |         alvos,
  268 |         `    regra: ${violacao.url}`,
  269 |       ].join('\n');
  270 |     })
  271 |     .join('\n\n');
  272 | 
  273 |   expect
  274 |     .soft(
  275 |       reprovadas.map((violacao) => violacao.id),
  276 |       `Acessibilidade em ${tela}: ${reprovadas.length} violação(ões) de impacto crítico/sério\n\n${detalhe}\n`,
  277 |     )
> 278 |     .toEqual([]);
      |      ^ Error: Acessibilidade em diretório de instituições (/organizacoes): 1 violação(ões) de impacto crítico/sério
  279 | 
  280 |   return { isentos };
  281 | }
  282 | 
  283 | // ───────────────────────────────────────────────────────────────────────────────
  284 | //  Fixture: uma instituição com uma pessoa da equipe (a tela autenticada precisa de
  285 | //  vínculo E papel — vínculo sem papel não chega ao painel; lição da FASE 25).
  286 | // ───────────────────────────────────────────────────────────────────────────────
  287 | let tenantSlug: string;
  288 | let adminEmail: string;
  289 | /** O evento do quadro de demandas (FASE 57) e a pessoa que o administra. */
  290 | let eventId: string;
  291 | /** A conta de PLATAFORMA: a fila de denúncias só abre para SuperAdmin (FASE 56 · E62). */
  292 | let superEmail: string;
  293 | 
  294 | async function signUpVia(
  295 |   api: import('@playwright/test').APIRequestContext,
  296 |   name: string,
  297 | ): Promise<{ id: string; email: string }> {
  298 |   const email = `a11y.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;
  299 | 
  300 |   const response = await api.post('/api/auth/sign-up/email', {
  301 |     headers: { origin: 'http://localhost:3000' },
  302 |     data: { name, email, password: PASSWORD },
  303 |   });
  304 | 
  305 |   if (!response.ok()) {
  306 |     throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  307 |   }
  308 | 
  309 |   const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  310 | 
  311 |   return { id: user.id, email };
  312 | }
  313 | 
  314 | async function signInAs(page: Page, email: string): Promise<void> {
  315 |   await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
  316 | 
  317 |   const response = await page.request.post('/api/auth/sign-in/email', {
  318 |     headers: { origin: 'http://localhost:3000' },
  319 |     data: { email, password: PASSWORD },
  320 |   });
  321 | 
  322 |   if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
  323 | }
  324 | 
  325 | test.beforeAll(async ({ playwright, baseURL }) => {
  326 |   const api = await playwright.request.newContext({ baseURL });
  327 | 
  328 |   try {
  329 |     const tenant = await createTenant({
  330 |       label: TENANT_LABEL,
  331 |       name: `Instituição Acessível ${RUN_ID}`,
  332 |     });
  333 | 
  334 |     tenantSlug = tenant.slug;
  335 | 
  336 |     const admin = await signUpVia(api, 'Administradora Acessível');
  337 |     adminEmail = admin.email;
  338 | 
  339 |     await linkUser({ userId: admin.id, tenantId: tenant.id, kind: 'MEMBER' });
  340 |     await grantRole({ userId: admin.id, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });
  341 | 
  342 |     /**
  343 |      * ─────────────────────────────────────────────────────────────────────────────
  344 |      *  AS TELAS DA FASE 56 E DA FASE 57 ENTRAM NO PORTÃO
  345 |      * ─────────────────────────────────────────────────────────────────────────────
  346 |      *  O quadro de demandas foi varrido na FASE 50 como UMA tela (o Kanban). Ele passou
  347 |      *  a ter três vistas (FASE 57), e cada uma desenha o que a outra não desenha — eixo,
  348 |      *  barra, célula de mês. A fila de denúncias (FASE 56) tem o formulário de decisão,
  349 |      *  que é onde rótulo ausente e contraste ruim aparecem.
  350 |      *
  351 |      *  As fixtures são criadas aqui para a varredura encontrar a tela COM conteúdo: uma
  352 |      *  fila vazia e um Gantt sem barra não provam nada sobre o que a tela mostra.
  353 |      */
  354 |     const event = await createEvent({
  355 |       tenantId: tenant.id,
  356 |       slug: `acessivel-${RUN_ID}`,
  357 |       title: `Evento Acessível ${RUN_ID}`,
  358 |       status: 'REGISTRATION_OPEN',
  359 |       capacity: 100,
  360 |     });
  361 | 
  362 |     eventId = event.id;
  363 | 
  364 |     const hoje = new Date();
  365 |     const demandaBase = {
  366 |       tenantId: tenant.id,
  367 |       eventId: event.id,
  368 |       actorId: admin.id,
  369 |     };
  370 | 
  371 |     /** Uma barra que ATRAVESSA o período e vence no mês corrente. */
  372 |     await createDemand({
  373 |       ...demandaBase,
  374 |       title: 'Confirmar os crachás da portaria',
  375 |       priority: 'HIGH',
  376 |       startAt: new Date(hoje.getTime() - 2 * 86_400_000),
  377 |       dueAt: hoje,
  378 |     });
```