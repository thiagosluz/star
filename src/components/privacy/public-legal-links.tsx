import Link from 'next/link';

/**
 * Links institucionais compartilhados no rodapé das superfícies públicas
 * (Privacidade, Termos de Uso e Acessibilidade — FASE 110).
 */
export function PublicLegalLinks() {
  return (
    <nav aria-label="Documentos institucionais" className="flex flex-wrap items-center justify-center gap-5 text-xs">
      <Link href="/privacidade" className="hover:text-foreground transition">
        Privacidade e cookies
      </Link>
      <Link href="/termos" className="hover:text-foreground transition">
        Termos de uso
      </Link>
      <Link href="/acessibilidade" className="hover:text-foreground transition">
        Acessibilidade
      </Link>
    </nav>
  );
}
