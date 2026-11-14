import type { MetadataRoute } from 'next';

import { publicBaseUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = publicBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: [
          '/superadmin',
          '/entrar',
          '/cadastro',
          '/esqueci-senha',
          '/redefinir-senha',
          '/convite',
          '/api/auth',
          '/t/*/administracao',
          '/t/*/submissoes',
          '/t/*/comite',
          '/t/*/minhas-inscricoes',
          '/t/*/meu-cracha',
          '/t/*/minhas-mensagens',
          '/t/*/meus-certificados',
          '/t/*/perfil',
          '/t/*/credenciamento',
          '/t/*/demandas',
          '/t/*/participantes',
          '/t/*/panorama',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
