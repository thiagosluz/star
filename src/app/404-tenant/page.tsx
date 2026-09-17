import Link from 'next/link';

/**
 * Página exibida quando o host pede uma instituição que não existe, está
 * suspensa ou não é operável. O Proxy reescreve para cá.
 *
 * Deliberadamente genérica: não confirmamos se o slug existe mas está suspenso
 * ou se não existe, para não vazar a existência de instituições privadas.
 */
export const metadata = { title: 'Instituição não encontrada' };

export default function TenantNotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Erro 404</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Instituição não encontrada
        </h1>
        <p className="max-w-md text-muted-foreground">
          O endereço acessado não corresponde a nenhuma instituição ativa na
          plataforma. Verifique o link ou procure a página correta do evento.
        </p>
      </div>

      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        Ir para a página inicial
      </Link>
    </main>
  );
}
