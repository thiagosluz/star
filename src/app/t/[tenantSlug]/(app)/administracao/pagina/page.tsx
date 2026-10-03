import Link from 'next/link';
import { Eye, EyeOff, Globe, LayoutTemplate } from 'lucide-react';

import {
  addTenantPageBlockAction,
  confirmTenantPageImageUploadAction,
  deleteTenantPageBlockAction,
  moveTenantPageBlockAction,
  publishTenantPageAction,
  removeTenantPageImageAction,
  requestTenantPageImageUploadAction,
  saveTenantPageSettingsAction,
  unpublishTenantPageAction,
  updateTenantPageBlockAction,
} from '@/app/actions/tenant-page-actions';
import { AdminForm, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { TenantAssetUploader } from '@/components/admin/tenant-asset-uploader';
import { TenantBlockFields } from '@/components/admin/tenant-block-fields';
import { TenantIdentityFields } from '@/components/admin/tenant-identity-fields';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { getTenantContext } from '@/lib/events/event-repository';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { resolveTheme } from '@/domain/events/landing-page';
import {
  TENANT_GROUP_DEFAULT_LIMIT,
  type TenantEventGroupView,
} from '@/domain/tenancy/tenant-event-groups';
import {
  TENANT_BLOCK_DESCRIPTIONS,
  TENANT_BLOCK_LABELS,
  TENANT_MAX_PAGE_BLOCKS,
  TENANT_PAGE_BLOCK_TYPES,
  selectRenderableTenantBlocks,
  type TenantPageBlockType,
} from '@/domain/tenancy/tenant-public-page';
import { tenantBlockRows, tenantPageStatus } from '@/domain/tenancy/tenant-page-editor';
import { buildTenantThemeScope } from '@/domain/tenancy/tenant-page-theme-rules';
import { readThemeMode } from '@/lib/theme/theme-mode-server';
import { getAdminTenantPage } from '@/lib/tenancy/tenant-public-page-view';
import { getPublicTenantPage } from '@/lib/tenancy/tenant-public-page-view';
import type {
  PublicTenantEventCard,
  TenantPublicEventGroups,
  PublicTenantPageView,
} from '@/lib/tenancy/tenant-public-page-view';
import { TenantPublicPage } from '@/components/tenancy/tenant-page';

export const metadata = { title: 'Página pública da instituição' };
export const dynamic = 'force-dynamic';

const BLOCK_OPTIONS = TENANT_PAGE_BLOCK_TYPES.map((type) => ({
  value: type,
  label: TENANT_BLOCK_LABELS[type],
}));

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDITOR DA PÁGINA PÚBLICA DA INSTITUIÇÃO — /t/<slug>/administracao/pagina
 *                                                            (FASE 64 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PRÉVIA É O MESMO COMPONENTE DA PÁGINA PÚBLICA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A lição da FASE 17/23 é explícita: prévia desenhada por outro componente
 *  começa idêntica e termina diferente, e a diferença aparece na hora errada — o
 *  organizador aprova na prévia algo que o site não mostra. Aqui a prévia é
 *  `TenantPublicPage` (fatia 2) com o RASCUNHO no lugar do publicado e o aviso de
 *  prévia ligado (`preview`). Nada é reimplementado: o que muda é qual snapshot
 *  entra por prop.
 *
 *  O read model é montado a partir da leitura PÚBLICA real (`getPublicTenantPage`),
 *  porque os TRÊS GRUPOS de eventos são lidos na renderização (ADR-168): a prévia
 *  mostra os eventos de verdade da instituição, não uma lista de mentira. O que o
 *  rascunho substitui são os campos que ELE governa — título, descrição, capa,
 *  logotipo, tema e blocos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LISTA DE BLOCOS, E NÃO UM "PALCO" DE ARRASTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a mesma decisão do editor do evento (FASE 17): o organizador precisa saber O
 *  QUE está na página, em que ORDEM, e o que falta preencher. Uma lista responde
 *  isso de uma olhada e funciona no teclado; o resultado final ele confere na
 *  prévia logo abaixo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function TenantPageEditor({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PAGE_MANAGE,
  });

  const [identity, page] = await Promise.all([
    getTenantContext(tenantSlug),
    getAdminTenantPage(tenantId),
  ]);

  /**
   * A identidade vem do contexto da instituição (a mesma leitura da página
   * pública). Sem ela não há como montar a página vazia — e `notFound` só seria
   * correto se a instituição não existisse, o que a guarda acima já teria recusado.
   */
  if (!identity) {
    throw new Error('A instituição do contexto não pôde ser lida.');
  }

  /** A primeira vez: a página ainda não existe, e o editor mostra o estado vazio. */
  const draft = page?.draft ?? {
    title: identity.name,
    description: identity.description,
    coverImageUrl: null,
    logoUrl: identity.logoUrl,
    theme: {},
    blocks: [],
  };

  const resolvedTheme = resolveTheme(draft.theme);

  /**
   * A PRÉVIA.
   *
   * `getPublicTenantPage` devolve `null` quando a instituição nunca publicou — e é
   * exatamente aí que a prévia mais importa. Quando isso acontece, o que falta são
   * só os grupos de eventos e a identidade, então eles vêm de uma leitura pública
   * que só precisa do contexto: os eventos são do sistema, não do snapshot.
   */
  const published = await getPublicTenantPage(identity);

  const preview: PublicTenantPageView = {
    pageId: page?.pageId ?? 'rascunho',
    identity: published?.identity ?? {
      tenantId: identity.tenantId,
      slug: identity.slug,
      name: identity.name,
      timezone: identity.timezone,
      logoUrl: identity.logoUrl,
      primaryColor: identity.primaryColor,
      description: identity.description,
    },
    title: draft.title,
    description: draft.description ?? identity.description,
    coverImageUrl: draft.coverImageUrl,
    logoUrl: draft.logoUrl ?? identity.logoUrl,
    theme: resolvedTheme.theme,
    themeIsValid: resolvedTheme.isValid,
    /**
     * O filtro e a ordem são do DOMÍNIO — a MESMA função que a página pública usa
     * (`selectRenderableTenantBlocks`): bloco invisível sai e tipo desconhecido sai.
     */
    blocks: selectRenderableTenantBlocks(draft.blocks),
    events: published?.events ?? gruposVazios(identity.timezone),
    publishedAt: page?.publication.publishedAt ?? null,
  };

  /**
   * O tema da PRÉVIA já sai com o modo do visitante resolvido (o cookie `ef_tema`),
   * e o wrapper da página publica os papéis `--ef-*` desse modo. É o que faz a
   * prévia mostrar o que o visitante verá — e não a paleta do modo que a
   * instituição escolheu no editor.
   */
  const scope = buildTenantThemeScope({
    theme: resolvedTheme.theme,
    visitorMode: await readThemeMode(),
  });

  const status = tenantPageStatus({
    publication: page?.publication ?? {
      state: 'NEVER_PUBLISHED',
      publishedAt: null,
      isUpToDate: false,
    },
    timeZone: identity.timezone,
  });

  const rows = tenantBlockRows(draft.blocks);
  const publicHref = tenantPath(tenantSlug, '/');
  const noAr = status.state !== 'NEVER_PUBLISHED';

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-2">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Administração
          </Link>
        </nav>

        <h1 className="text-2xl font-semibold tracking-tight">Página pública da instituição</h1>

        <p className="text-sm text-muted-foreground" data-testid="tenant-page-status">
          {status.label}
        </p>

        <p className="flex flex-wrap items-center gap-4 text-xs">
          <Link
            href={publicHref}
            target="_blank"
            className="font-medium underline underline-offset-4"
            data-testid="tenant-page-public-link"
          >
            <Globe className="mr-1 inline size-3.5" aria-hidden />
            Ver a página pública →
          </Link>
          <span className="text-muted-foreground">{status.detail}</span>
        </p>
      </header>

      {/* ── Publicação ─────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid="tenant-page-publication">
        <h2 className="text-base font-semibold">Publicação</h2>

        {page ? null : (
          /**
           * ─────────────────────────────────────────────────────────────────────────
           *  A PÁGINA NASCE NO PRIMEIRO "SALVAR" — E A TELA DIZ ISSO
           * ─────────────────────────────────────────────────────────────────────────
           *  Não há um botão de "criar página" separado (decisão da fatia 1): a
           *  primeira gravação do rascunho é o que cria a linha. Sem este aviso, quem
           *  abre o editor pela primeira vez procura o botão que não existe — e o
           *  "acrescentar bloco" recusa com "salve a página uma vez antes", que é
           *  verdade mas chega tarde.
           */
          <p
            className="rounded-md border border-border bg-surface-low p-3 text-sm text-muted-foreground"
            data-testid="tenant-page-not-created"
          >
            Esta instituição ainda não tem página configurada. Preencha o{' '}
            <strong>título</strong> e a <strong>descrição</strong>, escolha a paleta e clique em{' '}
            <strong>Salvar rascunho</strong>: é isso que cria a página. Nada aparece para os
            visitantes antes de você publicar.
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          Salvar grava o <strong>rascunho</strong>: nada muda para os visitantes até você publicar.
        </p>

        <div className="flex flex-wrap items-start gap-3">
          <InlineActionForm
            action={publishTenantPageAction}
            submitLabel={noAr ? 'Republicar' : 'Publicar a página'}
            testId="tenant-page-publish"
            className={page ? undefined : 'hidden'}
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            {/*
              A caixa de identidade é opcional aqui: o formulário abaixo é o "salvar".
              Este botão publica o que ESTÁ GRAVADO — aceitar conteúdo por ele abriria
              a porta para ir ao ar algo que ninguém salvou (fatia 1).
            */}
            <input type="hidden" name="salvarAntes" value="0" />
          </InlineActionForm>

          {noAr ? (
            <InlineActionForm
              action={unpublishTenantPageAction}
              submitLabel="Tirar do ar"
              variant="destructive"
              testId="tenant-page-unpublish"
              confirm={{
                title: 'Tirar a página do ar?',
                description:
                  'A página sai do ar e o endereço da instituição volta a mostrar a lista de eventos dela. O trabalho NÃO se perde: tudo continua salvo no rascunho, e você pode publicar de novo quando quiser.',
                confirmLabel: 'Tirar do ar',
              }}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
            </InlineActionForm>
          ) : null}
        </div>
      </section>

      {/* ── Identidade e aparência ─────────────────────────────────────────── */}
      <details
        className="rounded-xl border border-border bg-card p-5"
        data-testid="tenant-page-settings"
        open
      >
        <summary className="cursor-pointer text-base font-semibold">
          <LayoutTemplate className="mr-2 inline size-4" aria-hidden />
          Identidade e aparência
        </summary>

        <div className="space-y-4 pt-4">
          <AdminForm
            action={saveTenantPageSettingsAction}
            submitLabel="Salvar rascunho"
            testId="tenant-page-save"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />

            <TenantIdentityFields
              title={draft.title}
              description={draft.description ?? ''}
              theme={{
                primaryColor: resolvedTheme.theme.primaryColor ?? '',
                secondaryColor: resolvedTheme.theme.secondaryColor ?? '',
                accentColor: resolvedTheme.theme.accentColor ?? '',
                radius: resolvedTheme.theme.radius,
                fontFamily: resolvedTheme.theme.fontFamily,
                spacing: resolvedTheme.theme.spacing,
                animation: resolvedTheme.theme.animation,
              }}
            />
          </AdminForm>

          {!resolvedTheme.isValid ? (
            <p className="text-xs text-warning-strong" role="alert">
              O tema gravado tem valores fora do contrato e a página está usando o padrão do sistema.
              Salvar a aparência acima corrige isso.
            </p>
          ) : null}
        </div>
      </details>

      {/* ── Capa e logotipo ────────────────────────────────────────────────── */}
      <details
        className="rounded-xl border border-border bg-card p-5"
        data-testid="tenant-page-assets"
        open
      >
        <summary className="cursor-pointer text-base font-semibold">Imagem de capa e logotipo</summary>

        <div className="space-y-4 pt-4">
          <TenantAssetUploader
            tenantSlug={tenantSlug}
            target="TENANT_COVER"
            currentUrl={draft.coverImageUrl}
            requestUploadAction={requestTenantPageImageUploadAction}
            confirmUploadAction={confirmTenantPageImageUploadAction}
          />

          <TenantAssetUploader
            tenantSlug={tenantSlug}
            target="TENANT_LOGO"
            currentUrl={draft.logoUrl}
            requestUploadAction={requestTenantPageImageUploadAction}
            confirmUploadAction={confirmTenantPageImageUploadAction}
          />

          {draft.coverImageUrl || draft.logoUrl ? (
            <div className="flex flex-wrap gap-3">
              {draft.coverImageUrl ? (
                <InlineActionForm
                  action={removeTenantPageImageAction}
                  submitLabel="Remover capa"
                  testId="tenant-page-remove-cover"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="target" value="TENANT_COVER" />
                </InlineActionForm>
              ) : null}

              {draft.logoUrl ? (
                <InlineActionForm
                  action={removeTenantPageImageAction}
                  submitLabel="Remover logotipo"
                  testId="tenant-page-remove-logo"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="target" value="TENANT_LOGO" />
                </InlineActionForm>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            As imagens são convertidas para WebP no servidor (o arquivo enviado é apagado) e entram no
            acervo da instituição, contando na quota do plano.
          </p>
        </div>
      </details>

      {/* ── Blocos ─────────────────────────────────────────────────────────── */}
      <section
        className="space-y-4 rounded-xl border border-border bg-card p-5"
        data-testid="tenant-block-editor"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Blocos ({draft.blocks.length}/{TENANT_MAX_PAGE_BLOCKS})
          </h2>
          <p className="text-xs text-muted-foreground">
            A ordem abaixo é a ordem em que os blocos aparecem na página.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="tenant-empty-blocks">
            Nenhum bloco configurado. A página já mostra a identidade da instituição e os três grupos
            de eventos (em breve, acontecendo agora e edições anteriores) — os blocos são o conteúdo
            que você acrescenta a isso.
          </p>
        ) : (
          <ol className="space-y-3" data-testid="tenant-block-list">
            {rows.map((row) => (
              <li
                key={row.block.id}
                data-testid={`tenant-block-${row.block.id}`}
                data-type={row.block.type}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="code-data text-muted-foreground">{row.position}.</span>
                      {TENANT_BLOCK_LABELS[row.block.type]}
                      {!row.block.isVisible ? (
                        <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                          <EyeOff className="mr-1 inline size-3" aria-hidden />
                          oculto
                        </span>
                      ) : null}
                      {row.semRenderizador ? (
                        <span
                          className="rounded border border-warning/40 px-1.5 py-0.5 text-xs text-warning-strong"
                          data-testid={`tenant-block-pending-${row.block.id}`}
                        >
                          não aparece na página
                        </span>
                      ) : null}
                      {row.vazio ? (
                        <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                          vazio
                        </span>
                      ) : null}
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid={`tenant-block-summary-${row.block.id}`}
                    >
                      {row.summary}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <InlineActionForm
                      action={moveTenantPageBlockAction}
                      submitLabel="Subir"
                      testId={`tenant-move-up-${row.block.id}`}
                      quietSuccess
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="blockId" value={row.block.id} />
                      <input type="hidden" name="direction" value="up" />
                    </InlineActionForm>

                    <InlineActionForm
                      action={moveTenantPageBlockAction}
                      submitLabel="Descer"
                      testId={`tenant-move-down-${row.block.id}`}
                      quietSuccess
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="blockId" value={row.block.id} />
                      <input type="hidden" name="direction" value="down" />
                    </InlineActionForm>

                    <InlineActionForm
                      action={deleteTenantPageBlockAction}
                      submitLabel="Remover"
                      variant="destructive"
                      testId={`tenant-delete-block-${row.block.id}`}
                      confirm={{
                        title: `Remover o bloco “${TENANT_BLOCK_LABELS[row.block.type]}”?`,
                        description:
                          'O bloco sai do RASCUNHO. A página no ar continua como está até você publicar de novo.',
                        confirmLabel: 'Remover bloco',
                      }}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="blockId" value={row.block.id} />
                    </InlineActionForm>
                  </div>
                </div>

                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium">Editar conteúdo</summary>
                  <div className="pt-3">
                    <AdminForm
                      action={updateTenantPageBlockAction}
                      submitLabel="Salvar bloco"
                      testId={`tenant-block-form-${row.block.id}`}
                      compact
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="blockId" value={row.block.id} />
                      <input type="hidden" name="type" value={row.block.type} />

                      <TenantBlockFields
                        type={row.block.type as TenantPageBlockType}
                        content={row.block.content}
                      />

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="isVisible"
                          defaultChecked={row.block.isVisible}
                          className="size-4 accent-primary"
                        />
                        {row.block.isVisible ? (
                          <Eye className="size-3.5 text-muted-foreground" aria-hidden />
                        ) : (
                          <EyeOff className="size-3.5 text-muted-foreground" aria-hidden />
                        )}
                        Visível na página
                      </label>
                    </AdminForm>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Adicionar bloco</h3>
          <AdminForm
            action={addTenantPageBlockAction}
            submitLabel="Adicionar"
            testId="tenant-add-block"
            compact
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <SelectField
              label="Tipo de bloco"
              name="type"
              options={BLOCK_OPTIONS}
              defaultValue="ABOUT"
              hint="O bloco entra no fim da página e é editado logo acima. O que cada tipo mostra está escrito na lista."
            />
          </AdminForm>

          {/**
            * A ORDEM DAS AÇÕES, DITA ANTES DA RECUSA.
            *
            * Acrescentar bloco exige a página criada (é a primeira gravação que cria a
            * linha — decisão da fatia 1). Sem esta linha, quem abre o editor pela
            * primeira vez escolhe o tipo, clica e recebe "salve a página uma vez
            * antes": verdade, mas tarde. Avisar ANTES é o que a tela pode fazer.
            */}
          {page ? null : (
            <p className="text-xs text-muted-foreground" data-testid="tenant-add-block-hint">
              Salve o rascunho primeiro (no formulário de identidade, acima): é a primeira gravação
              que cria a página e libera os blocos.
            </p>
          )}
        </div>
      </section>

      {/* ── Prévia: o MESMO componente da página pública ───────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Eye className="size-4" aria-hidden />
          Prévia
        </h2>

        {/* ── A prévia, e o landmark que ela NÃO traz ────────────────────────── */}
        {/**
          * ───────────────────────────────────────────────────────────────────────────
          *  POR QUE A PRÉVIA PEDE `landmark="none"` (FASE 64 · fatia 5)
          * ───────────────────────────────────────────────────────────────────────────
          *  O `TenantPublicPage` desenha o `<main>` dele — e isso está certo: na página
          *  pública ele É o conteúdo, e é exatamente UM (a casca deixou de ser landmark
          *  na FASE 52). Aqui dentro, porém, o editor já desenhou o `<main>` dele, e a
          *  prévia traria o SEGUNDO: dois landmarks `main` na mesma tela, ou seja, dois
          *  "conteúdo principal" para quem navega por leitor de tela.
          *
          *  A primeira versão resolvia isso com `display: contents` no `<main>` da
          *  prévia, por uma regra de `<style>`. Era um truque: a CAIXA sumia (e com ela
          *  a contagem), mas o nó continuava na árvore de acessibilidade como região
          *  `main` em parte dos leitores, e a estrutura da tela passava a depender de um
          *  seletor global. O conserto pela CAUSA é a prop `landmark`: aqui a prévia não
          *  é o conteúdo principal, ela é um pedaço do formulário — então ela é um
          *  `<div>`, e o `<main>` do editor continua sendo o único.
          *
          *  O que a prévia MOSTRA não mudou em nada: mesmos filhos, mesmas classes,
          *  mesmo `data-testid="tenant-public-page"` (é ele que o E2E usa).
          */}

        <p className="text-sm text-muted-foreground" data-testid="tenant-preview-note">
          Esta é a página como ela está agora no <strong>rascunho</strong>, desenhada pelo MESMO
          componente da página pública. Os grupos de eventos são lidos do sistema neste instante.
        </p>

        {/*
          O escopo do tema: os papéis `--ef-*` da instituição, no modo do VISITANTE.
          O `data-theme-mode` acompanha o modo efetivo, e é ele que governa os
          controles nativos. Nada disto toca o casco (cabeçalho/rodapé), que é da
          plataforma — o wrapper envolve só a PÁGINA.
        */}
        <div
          className="overflow-hidden rounded-lg border border-border"
          style={scope.variables as React.CSSProperties}
          data-theme-mode={scope.mode}
          data-tenant-theme-scope="preview"
        >
          <TenantPublicPage
            page={preview}
            landmark="none"
            preview={{
              publicationLabel: status.publicationLabel,
              editorHref: tenantPath(tenantSlug, '/administracao/pagina'),
            }}
          />
        </div>
      </section>

      {/* ── O que cada tipo de bloco faz ───────────────────────────────────── */}
      <details className="rounded-xl border border-border bg-card p-5" data-testid="tenant-block-guide">
        <summary className="cursor-pointer text-base font-semibold">
          O que cada tipo de bloco mostra
        </summary>

        <dl className="space-y-3 pt-4">
          {TENANT_PAGE_BLOCK_TYPES.map((type) => (
            <div key={type}>
              <dt className="text-sm font-medium">{TENANT_BLOCK_LABELS[type]}</dt>
              <dd className="text-xs text-muted-foreground">{TENANT_BLOCK_DESCRIPTIONS[type]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </main>
  );
}

/**
 * Os três grupos VAZIOS, para a prévia de uma instituição sem evento nenhum.
 *
 * `groupTenantEvents([])` chamado no lugar desta função devolveria exatamente isto
 * — e é por isso que ela é uma linha: não há conta nova aqui, só o vazio que o
 * agrupador produz quando não recebe evento. Chamar o agrupador com a lista vazia
 * não é possível sem uma consulta; a forma é a MESMA que ele devolve.
 */
function gruposVazios(timeZone: string): TenantPublicEventGroups {
  const vazio: TenantEventGroupView<PublicTenantEventCard> = {
    group: 'UPCOMING',
    items: [],
    events: [],
    total: 0,
    hasMore: false,
    limit: TENANT_GROUP_DEFAULT_LIMIT,
  };

  return {
    upcoming: { ...vazio, group: 'UPCOMING' },
    ongoing: { ...vazio, group: 'ONGOING' },
    past: { ...vazio, group: 'PAST' },
    total: 0,
    now: new Date(),
    timeZone,
  };
}
