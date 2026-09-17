import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CalendarDays, Award, Sparkles, FileCheck2 } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * Landing page da PLATAFORMA (domínio raiz).
 *
 * Quando o host identifica uma instituição, o Proxy reescreve para
 * `/t/<slug>`, então esta página só é servida no domínio raiz ou em `localhost`.
 */
export default async function PlatformHomePage() {
  const context = await getRequestContext();

  // Usuário autenticado com contexto definido: vai direto para o painel.
  if (context?.activeTenant) {
    redirect(tenantPath(context.activeTenant.tenantSlug, '/dashboard'));
  }

  // Autenticado mas sem vínculo ativo: escolhe uma instituição.
  if (context?.user) {
    redirect('/selecionar-instituicao');
  }

  const features = [
    {
      icon: FileCheck2,
      title: 'Submissão e avaliação por pares',
      description:
        'Chamada de trabalhos por trilha, versão cega, rubricas ponderadas e detecção automática de conflito de interesse.',
    },
    {
      icon: CalendarDays,
      title: 'Eventos, atividades e inscrições',
      description:
        'Controle de lotação, salas, horários e listas de espera, com página pública modular por instituição.',
    },
    {
      icon: Sparkles,
      title: 'Gamificação e cards colecionáveis',
      description:
        'Engine de XP com missões, níveis de prestígio e cartas distribuídas por check-in, aprovação e avaliação.',
    },
    {
      icon: Award,
      title: 'Certificação automática',
      description:
        'Emissão assíncrona com carga horária real cumprida, assinatura digital e validação pública por QR Code.',
    },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-16 px-6 py-20">
      <header className="space-y-6 text-center">
        <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          Plataforma multi-instituição
        </span>

        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Toda a jornada do evento em um só lugar
        </h1>

        <p className="mx-auto max-w-2xl text-pretty text-lg text-muted-foreground">
          Da chamada de trabalhos ao certificado assinado: gestão de eventos
          acadêmicos, corporativos e comunitários com isolamento total entre
          instituições.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Entrar
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-accent"
          >
            Criar conta
          </Link>
        </div>
      </header>

      <section className="grid gap-6 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, description }) => (
          <article
            key={title}
            className="rounded-lg border border-border bg-card p-6 text-card-foreground"
          >
            <Icon className="mb-4 size-5 text-primary" aria-hidden />
            <h2 className="mb-2 font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </article>
        ))}
      </section>

      <footer className="text-center text-xs text-muted-foreground">
        <p>
          Cada instituição acessa pelo próprio endereço
          (<span className="code-data">instituicao.{process.env.ROOT_DOMAIN ?? 'lvh.me'}</span>)
          ou por <span className="code-data">/t/&lt;instituicao&gt;</span>.
        </p>
      </footer>
    </main>
  );
}
