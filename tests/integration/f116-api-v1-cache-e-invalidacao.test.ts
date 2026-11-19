import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '@/lib/db/admin-client';
import { createEventApiKey } from '@/lib/api/event-api-key-service';
import { createEventApiRouteHandlers } from '@/lib/api/event-api-route-handlers';
import {
  getOrSetDirectPublicCache,
  invalidatePublicCertificateCache,
  invalidatePublicEventCache,
} from '@/lib/cache/public-read-cache';
import { certificateCacheKey, shouldCacheCertificateVerdict } from '@/domain/cache/public-cache-rules';

const RUN_ID = randomUUID().slice(0, 8);

describe('FASE 116 — Cache real em Redis para API v1 e validação de certificado', () => {
  const tenantId = randomUUID();
  const tenantSlug = `f116-cache-${RUN_ID}`;
  const eventId = randomUUID();
  const eventSlug = `evento-f116-${RUN_ID}`;
  let apiKey = '';

  beforeAll(async () => {
    await adminPrisma.tenant.create({
      data: {
        id: tenantId,
        slug: tenantSlug,
        name: `Instituição Cache F116 ${RUN_ID}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
      },
    });

    const startsAt = new Date(Date.now() + 86_400_000);
    const endsAt = new Date(Date.now() + 3 * 86_400_000);
    await adminPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: eventSlug,
          title: `Congresso Original F116 ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt,
          timezone: 'America/Bahia',
        },
      });
    });

    const created = await createEventApiKey({ tenantId, eventId });
    if (!created.ok) throw new Error(created.message);
    apiKey = created.chave;
  });

  afterAll(async () => {
    await adminPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.event.deleteMany({ where: { tenantId } });
    });
    await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('API v1 serve 200 → 304 via Redis real e invalida em O(1) após alteração do título', async () => {
    const handlers = createEventApiRouteHandlers('evento', {
      forceCache: true,
      rateLimit: { consume: async () => ({ allowed: true, retryAfter: null }) },
    });

    const ctx = { params: Promise.resolve({ tenantSlug, eventSlug }) };
    const req1 = new Request(`http://localhost:3000/api/v1/t/${tenantSlug}/eventos/${eventSlug}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const res1 = await handlers.GET(req1, ctx);
    expect(res1.status).toBe(200);
    const etag1 = res1.headers.get('etag');
    expect(etag1).toBeTruthy();
    const body1 = (await res1.json()) as { data: { title: string } };
    expect(body1.data.title).toBe(`Congresso Original F116 ${RUN_ID}`);

    // 2ª chamada com If-None-Match acerta o cache em Redis e responde 304 sem corpo
    const req2 = new Request(`http://localhost:3000/api/v1/t/${tenantSlug}/eventos/${eventSlug}`, {
      headers: { authorization: `Bearer ${apiKey}`, 'if-none-match': etag1! },
    });
    const res2 = await handlers.GET(req2, ctx);
    expect(res2.status).toBe(304);
    expect(await res2.text()).toBe('');

    // Atualiza o título no banco e invalida a versão do tenant no Redis
    const updatedTitle = `Congresso Atualizado F116 ${RUN_ID}`;
    await adminPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.event.update({ where: { id: eventId }, data: { title: updatedTitle } });
    });
    await invalidatePublicEventCache({ tenantId, eventSlug, force: true });

    // Com o ETag antigo, agora volta 200 com o título novo e ETag novo
    const req3 = new Request(`http://localhost:3000/api/v1/t/${tenantSlug}/eventos/${eventSlug}`, {
      headers: { authorization: `Bearer ${apiKey}`, 'if-none-match': etag1! },
    });
    const res3 = await handlers.GET(req3, ctx);
    expect(res3.status).toBe(200);
    const etag3 = res3.headers.get('etag');
    expect(etag3).not.toBe(etag1);
    const body3 = (await res3.json()) as { data: { title: string } };
    expect(body3.data.title).toBe(updatedTitle);
  });

  it('cache de certificado em Redis real nunca guarda NOT_FOUND e expurga na revogação', async () => {
    const missingCode = `CERT-NAOEXISTE-${RUN_ID.toUpperCase()}`;
    let missingCalls = 0;
    const m1 = await getOrSetDirectPublicCache({
      key: certificateCacheKey(missingCode),
      ttlSeconds: 60,
      force: true,
      shouldCache: (v) => shouldCacheCertificateVerdict(v.status),
      loader: async () => {
        missingCalls++;
        return { status: 'NOT_FOUND' };
      },
    });
    const m2 = await getOrSetDirectPublicCache({
      key: certificateCacheKey(missingCode),
      ttlSeconds: 60,
      force: true,
      shouldCache: (v) => shouldCacheCertificateVerdict(v.status),
      loader: async () => {
        missingCalls++;
        return { status: 'NOT_FOUND' };
      },
    });
    expect(m1.hit).toBe(false);
    expect(m2.hit).toBe(false);
    expect(missingCalls).toBe(2);

    const validCode = `CERT-VALIDO-${RUN_ID.toUpperCase()}`;
    let validCalls = 0;
    const v1 = await getOrSetDirectPublicCache({
      key: certificateCacheKey(validCode),
      ttlSeconds: 60,
      force: true,
      shouldCache: (v) => shouldCacheCertificateVerdict(v.status),
      loader: async () => {
        validCalls++;
        return { status: 'VALID' };
      },
    });
    const v2 = await getOrSetDirectPublicCache({
      key: certificateCacheKey(validCode),
      ttlSeconds: 60,
      force: true,
      shouldCache: (v) => shouldCacheCertificateVerdict(v.status),
      loader: async () => {
        validCalls++;
        return { status: 'VALID' };
      },
    });
    expect(v1.hit).toBe(false);
    expect(v2.hit).toBe(true);
    expect(validCalls).toBe(1);

    await invalidatePublicCertificateCache(validCode, { force: true });
    const v3 = await getOrSetDirectPublicCache({
      key: certificateCacheKey(validCode),
      ttlSeconds: 60,
      force: true,
      shouldCache: (v) => shouldCacheCertificateVerdict(v.status),
      loader: async () => {
        validCalls++;
        return { status: 'REVOKED' };
      },
    });
    expect(v3.hit).toBe(false);
    expect(v3.value.status).toBe('REVOKED');
    expect(validCalls).toBe(2);
    await invalidatePublicCertificateCache(validCode, { force: true });
  });
});
