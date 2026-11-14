import type { MetadataRoute } from 'next';

import { listPublicSitemapEntries } from '@/lib/proceedings/indexing-service';
import { publicBaseUrl } from '@/lib/public-url';
import { logger } from '@/lib/observability/logger';
import { errorMessage } from '@/lib/db/prisma-errors';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    return await listPublicSitemapEntries();
  } catch (error) {
    logger.warn(`[sitemap] falha ao montar URLs públicas: ${errorMessage(error)}`);
    return [{ url: publicBaseUrl(), lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
  }
}
