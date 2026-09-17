'use client';

import { useEffect } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Boundary global de erro
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O Next.js 16 gera um `/_global-error` interno quando o projeto não fornece um.
 *  Na versão 16.3.5 esse componente interno falha na etapa de PRERENDER:
 *
 *      TypeError: Cannot read properties of null (reading 'useContext')
 *
 *  e o `next build` aborta. O bug se manifesta inclusive em projetos que não
 *  usam nenhum Context — é o próprio componente interno que chama um hook fora
 *  de um provider válido.
 *
 *  Fornecer este arquivo resolve por dois motivos: (a) o Next deixa de gerar o
 *  interno, e (b) ganhamos uma tela de erro de verdade, com recuperação — o que
 *  é desejável em produção de qualquer forma.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  RESTRIÇÃO IMPORTANTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `global-error.tsx` substitui o LAYOUT RAIZ quando um erro escapa de tudo, e
 *  por isso precisa renderizar `<html>` e `<body>` por conta própria. Também não
 *  pode depender do CSS global do app (que pode não ter sido carregado), então
 *  os estilos aqui são INLINE.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Em produção, este é o ponto de integração com observabilidade
    // (Sentry, OpenTelemetry). O `digest` correlaciona com o log do servidor.
    console.error('[global-error]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#ffffff',
          color: '#171717',
        }}
      >
        <main
          style={{
            maxWidth: '32rem',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '0.875rem', opacity: 0.6, margin: 0 }}>
            Erro inesperado
          </p>

          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              margin: '0.5rem 0 0.75rem',
            }}
          >
            Algo deu errado
          </h1>

          <p style={{ fontSize: '0.95rem', opacity: 0.75, margin: '0 0 1.5rem' }}>
            Não foi possível carregar esta página. O problema foi registrado e a
            equipe responsável poderá investigá-lo.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#ffffff',
              background: '#3b5bdb',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Tentar novamente
          </button>

          {error.digest ? (
            <p
              style={{
                marginTop: '1.5rem',
                fontSize: '0.75rem',
                opacity: 0.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              Referência: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
