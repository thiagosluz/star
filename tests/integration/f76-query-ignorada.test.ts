/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A QUERY MALFORMADA NÃO DERRUBA A TELA — E NÃO É ESCONDIDA
 *  (FASE 76 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `administracao/certificados?evento=nao-e-uuid` e
 *  `administracao/certificados/modelos?modelo=nao-e-uuid` respondiam **500**: o texto
 *  ia direto ao Prisma. `pagina/midia?evento=nao-e-uuid` era pior em silêncio — a
 *  consulta era ALARGADA e a tela mostrava o acervo inteiro como se o filtro tivesse
 *  valido.
 *
 *  A resposta certa não é 404 (a lista existe, o filtro é que não): é **200 com o
 *  filtro descartado e o aviso visível**. O aviso vem do domínio, então este teste
 *  compara a frase EXATA — e prova, em cada tela, que o resultado sem filtro aparece
 *  junto com ela.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O TESTE RENDERIZA A PÁGINA, E NÃO O DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O domínio já tem teste unitário. O que o defeito media era a PORTA — a página que
 *  consultava com o texto torto e a tela que não avisava. Então cada caso chama o
 *  componente de servidor de verdade, com banco de verdade, e lê o HTML produzido.
 *  Sessão/guarda são dubladas (não existem fora do Next); leituras, não.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { discardedFilterNotice } from '../../src/domain/validation/query-filter-rules';

const RUN = randomUUID().slice(0, 8);
const TENANT_SLUG = `f76-query-${RUN}`;
const UUID_MALFORMADO = 'nao-e-uuid';

const TITULO_EVENTO_ALVO = `Evento alvo ${RUN}`;
const TITULO_EVENTO_OUTRO = `Evento outro ${RUN}`;
const NOME_CERTIFICADO_ALVO = `Certificado alvo ${RUN}`;
const NOME_CERTIFICADO_OUTRO = `Certificado outro ${RUN}`;
const NOME_MODELO = `Modelo da F76 ${RUN}`;
const ARQUIVO_ALVO = `alvo-${RUN}.webp`;
const ARQUIVO_OUTRO = `outro-${RUN}.webp`;

/** O que a guarda de página devolve — o `tenantId` é o da fixture. */
const guarda = vi.hoisted(() => ({ tenantId: '', userId: '' }));

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: async () => ({
    tenantId: guarda.tenantId,
    tenantName: 'Instituição da F76',
    userId: guarda.userId,
    principal: {
      userId: guarda.userId,
      tenantId: guarda.tenantId,
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'OWNER', scope: 'TENANT' }],
    },
    context: null,
  }),
}));

/** `notFound()` interrompe a renderização — nenhum caso aqui deve chegar a ele. */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  /** O cache do diretório é infraestrutura; aqui o teste quer a função crua. */
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement('a', { href: props.href }, props.children as never),
}));

/** Os painéis de cliente não participam da decisão do filtro (têm cobertura em E2E). */
vi.mock('../../src/components/admin/admin-form', () => ({
  AdminForm: () => null,
  Field: () => null,
}));
vi.mock('../../src/components/admin/inline-action-form', () => ({
  InlineActionForm: () => null,
}));
vi.mock('../../src/components/admin/asset-uploader', () => ({
  AssetUploader: () => null,
}));

/**
 * O editor de modelo é um componente de cliente que carrega estado e prévia. Aqui ele
 * vira uma marca: o que o teste precisa saber é se a página ABRIU o editor para o
 * `?modelo=<uuid>` — e se NÃO abriu para o malformado.
 */
vi.mock('../../src/components/admin/certificate-template-editor', () => ({
  CertificateTemplateEditor: (props: { model: { templateId: string | null; name: string } }) =>
    createElement(
      'div',
      { 'data-testid': 'editor-model' },
      `editor:${props.model.templateId ?? 'novo'}:${props.model.name}`,
    ),
}));

const { default: AdminCertificatesPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/certificados/page'
);
const { default: CertificateTemplatesPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/certificados/modelos/page'
);
const { default: EventMediaLibraryPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/midia/page'
);

let tenantId: string;
let userId: string;
let eventAlvoId: string;
let eventOutroId: string;
let templateId: string;
let assetAlvoId: string;
let assetOutroId: string;

async function renderizar(
  pagina: (props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string | undefined>>;
  }) => Promise<unknown>,
  params: Record<string, string>,
  searchParams: Record<string, string | undefined> = {},
): Promise<string> {
  const elemento = (await pagina({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;

  return renderToStaticMarkup(elemento);
}

beforeAll(async () => {
  tenantId = randomUUID();
  userId = randomUUID();
  eventAlvoId = randomUUID();
  eventOutroId = randomUUID();
  templateId = randomUUID();
  assetAlvoId = randomUUID();
  assetOutroId = randomUUID();

  guarda.tenantId = tenantId;
  guarda.userId = userId;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição da query da F76 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await adminPrisma.user.create({
    data: {
      id: userId,
      name: `Autora da F76 ${RUN}`,
      email: `f76.query.${RUN}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.createMany({
      data: [
        {
          id: eventAlvoId,
          tenantId,
          slug: `evento-alvo-f76-${RUN}`,
          title: TITULO_EVENTO_ALVO,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 86_400_000),
          capacity: null,
          confirmedCount: 0,
        },
        {
          id: eventOutroId,
          tenantId,
          slug: `evento-outro-f76-${RUN}`,
          title: TITULO_EVENTO_OUTRO,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 86_400_000),
          capacity: null,
          confirmedCount: 0,
        },
      ],
    });

    /**
     * DOIS certificados no evento alvo e UM no outro: com o filtro aplicado, só o
     * alvo aparece; sem filtro, os três. É o que separa "filtrou" de "alargou".
     */
    await tx.certificate.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          eventId: eventAlvoId,
          userId,
          kind: 'ATTENDANCE',
          status: 'ISSUED',
          validationCode: `F76A1${RUN}`,
          title: `Certificado do evento alvo ${RUN}`,
          recipientName: `${NOME_CERTIFICADO_ALVO} 1`,
          bodyText: 'Certificamos a participação no evento alvo.',
          workloadMinutes: 120,
        },
        {
          id: randomUUID(),
          tenantId,
          eventId: eventAlvoId,
          userId,
          kind: 'ATTENDANCE',
          status: 'ISSUED',
          validationCode: `F76A2${RUN}`,
          title: `Certificado do evento alvo ${RUN}`,
          recipientName: `${NOME_CERTIFICADO_ALVO} 2`,
          bodyText: 'Certificamos a participação no evento alvo.',
          workloadMinutes: 120,
        },
        {
          id: randomUUID(),
          tenantId,
          eventId: eventOutroId,
          userId,
          kind: 'ATTENDANCE',
          status: 'ISSUED',
          validationCode: `F76B1${RUN}`,
          title: `Certificado do evento outro ${RUN}`,
          recipientName: NOME_CERTIFICADO_OUTRO,
          bodyText: 'Certificamos a participação no evento outro.',
          workloadMinutes: 60,
        },
      ],
    });

    await tx.certificateTemplate.create({
      data: {
        id: templateId,
        tenantId,
        eventId: null,
        kind: null,
        name: NOME_MODELO,
        layout: { page: 'A4_LANDSCAPE', background: null, elements: [] },
      },
    });

    const checksum = randomUUID().replace(/-/g, '').padEnd(64, '0');

    await tx.mediaAsset.createMany({
      data: [
        {
          id: assetAlvoId,
          tenantId,
          eventId: eventAlvoId,
          bucket: 'eventflow-assets',
          objectKey: `tenants/${tenantId}/eventos/${eventAlvoId}/gallery/${ARQUIVO_ALVO}`,
          url: `http://localhost:9000/eventflow-assets/${ARQUIVO_ALVO}`,
          fileName: ARQUIVO_ALVO,
          mimeType: 'image/webp',
          sizeBytes: 2048,
          checksum,
          target: 'GALLERY',
          uploadedById: userId,
        },
        {
          id: assetOutroId,
          tenantId,
          eventId: eventOutroId,
          bucket: 'eventflow-assets',
          objectKey: `tenants/${tenantId}/eventos/${eventOutroId}/gallery/${ARQUIVO_OUTRO}`,
          url: `http://localhost:9000/eventflow-assets/${ARQUIVO_OUTRO}`,
          fileName: ARQUIVO_OUTRO,
          mimeType: 'image/webp',
          sizeBytes: 2048,
          checksum,
          target: 'GALLERY',
          uploadedById: userId,
        },
      ],
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: userId } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('certificados — `?evento=` malformado é 200 com aviso', () => {
  it('descarta o filtro, mostra a lista inteira e anuncia', async () => {
    const html = await renderizar(
      AdminCertificatesPage,
      { tenantSlug: TENANT_SLUG },
      { evento: UUID_MALFORMADO },
    );

    // 200: a página renderizou (nada de NEXT_NOT_FOUND e nada de 500).
    expect(html.length).toBeGreaterThan(0);

    // O aviso é o do DOMÍNIO, com a frase exata.
    expect(html).toContain('data-testid="certificate-filter-notice"');
    expect(html).toContain(discardedFilterNotice('evento'));

    // O filtro foi DESCARTADO: os dois eventos aparecem.
    expect(html).toContain(NOME_CERTIFICADO_ALVO);
    expect(html).toContain(NOME_CERTIFICADO_OUTRO);

    /**
     * E o valor torto NÃO vaza para o lote em ZIP: sem evento válido escolhido, o
     * botão não aparece — a tela mostra a instrução. Sem isto, o filtro descartado
     * continuaria virando uma URL de download inválida.
     */
    expect(html).not.toContain('data-testid="download-certificate-zip"');
    expect(html).toContain('data-testid="zip-hint"');
  });

  it('`?evento=<uuid>` válido continua filtrando (e sem aviso)', async () => {
    const html = await renderizar(
      AdminCertificatesPage,
      { tenantSlug: TENANT_SLUG },
      { evento: eventAlvoId },
    );

    expect(html).toContain(NOME_CERTIFICADO_ALVO);
    expect(html).not.toContain(NOME_CERTIFICADO_OUTRO);
    expect(html).not.toContain('data-testid="certificate-filter-notice"');

    // Com evento válido, o lote em ZIP aparece e aponta para ele.
    expect(html).toContain('data-testid="download-certificate-zip"');
    expect(html).toContain(`evento=${eventAlvoId}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('modelos de certificado — `?modelo=` malformado é 200 com aviso', () => {
  it('não abre editor, mostra a galeria e anuncia o descarte', async () => {
    const html = await renderizar(
      CertificateTemplatesPage,
      { tenantSlug: TENANT_SLUG },
      { modelo: UUID_MALFORMADO },
    );

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('data-testid="template-filter-notice"');
    expect(html).toContain(discardedFilterNotice('modelo'));

    // A galeria continua na tela (o filtro não era a lista, era o editor)...
    expect(html).toContain('data-testid="template-list"');
    expect(html).toContain(NOME_MODELO);

    // ...e o editor NÃO abriu, porque o id não tem forma de id.
    expect(html).not.toContain('data-testid="editor-model"');
  });

  it('`?modelo=<uuid>` válido continua abrindo o editor (e sem aviso)', async () => {
    const html = await renderizar(
      CertificateTemplatesPage,
      { tenantSlug: TENANT_SLUG },
      { modelo: templateId },
    );

    expect(html).toContain('data-testid="editor-model"');
    expect(html).toContain(`editor:${templateId}:${NOME_MODELO}`);
    expect(html).not.toContain('data-testid="template-filter-notice"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('acervo de mídia — o alargamento silencioso virou aviso', () => {
  it('`?evento=` malformado mostra o acervo inteiro E diz que o filtro caiu', async () => {
    const html = await renderizar(
      EventMediaLibraryPage,
      { tenantSlug: TENANT_SLUG, eventId: eventAlvoId },
      { evento: UUID_MALFORMADO },
    );

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('data-testid="media-filter-notice"');
    expect(html).toContain(discardedFilterNotice('evento de origem'));

    /**
     * O ponto do defeito: antes, a lista era a mesma e NADA dizia que o recorte
     * pedido não foi aplicado. Agora a lista é a mesma — e a tela anuncia.
     */
    expect(html).toContain(`data-testid="media-${assetAlvoId}"`);
    expect(html).toContain(`data-testid="media-${assetOutroId}"`);
  });

  it('`?evento=<uuid>` válido continua filtrando (e sem aviso)', async () => {
    const html = await renderizar(
      EventMediaLibraryPage,
      { tenantSlug: TENANT_SLUG, eventId: eventAlvoId },
      { evento: eventAlvoId },
    );

    expect(html).toContain(`data-testid="media-${assetAlvoId}"`);
    expect(html).not.toContain(`data-testid="media-${assetOutroId}"`);
    expect(html).not.toContain('data-testid="media-filter-notice"');
  });

  it('o sentinela `sem-evento` continua sendo filtro, não aviso', async () => {
    /**
     * `sem-evento` não é uuid e é uma escolha legítima do acervo (imagem sem evento).
     * Se o aviso olhasse só "tem forma de uuid?", ele acusaria um descarte que não
     * houve — a tela mentiria sobre si mesma.
     */
    const html = await renderizar(
      EventMediaLibraryPage,
      { tenantSlug: TENANT_SLUG, eventId: eventAlvoId },
      { evento: 'sem-evento' },
    );

    expect(html).not.toContain('data-testid="media-filter-notice"');
    expect(html).not.toContain(`data-testid="media-${assetAlvoId}"`);
    expect(html).not.toContain(`data-testid="media-${assetOutroId}"`);
  });
});
