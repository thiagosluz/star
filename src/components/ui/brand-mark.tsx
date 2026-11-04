import { cn } from '@/lib/utils/cn';

/**
 * Nome canônico da plataforma.
 *
 * Mantido em constante única para que cabeçalhos públicos, casca autenticada,
 * metadados e rodapés não espalhem literais divergentes.
 */
export const PLATFORM_BRAND_NAME = 'Koveno';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SÍMBOLO OFICIAL DA MARCA KOVENO — "CONVERGÊNCIA"
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ANATOMIA E REGRAS DO DESIGN.MD
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • Pilar vertical esquerdo: a Instituição (base multi-tenant isolada por RLS).
 *  • Braços diagonais do "K": as duas trilhas (Ciência e Operação) convergindo.
 *  • Nó central (losango 45°): o ponto de encontro e validação (QR / assinatura).
 *
 *  O componente é Server Component puro e não usa hexadecimal literal (preso pela
 *  catraca `tests/unit/design-system-guard.test.ts`): o corpo herda `currentColor`
 *  e o nó central consome `--ef-secondary-container` no claro e `--ef-tertiary`
 *  no escuro (ou o contorno de espaço negativo quando `mono={true}` para impressão
 *  P&B 1-bit em PDF/ZPL).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function KovenoMark({
  className = 'size-5',
  mono = false,
}: {
  className?: string;
  /** Variante monocromática 1-bit para impressão P&B (certificados PDF e crachás ZPL). */
  mono?: boolean;
}) {
  if (mono) {
    return (
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={cn('shrink-0', className)}
      >
        <rect x="6" y="5" width="5.5" height="22" rx="1.8" fill="currentColor" />
        <path
          d="M15.5 14.2L23.2 6.2C24.1 5.2 25.8 5.9 25.8 7.3V11.2L19.8 17.2L15.5 14.2Z"
          fill="currentColor"
        />
        <path
          d="M15.5 17.8L19.8 14.8L25.8 20.8V24.7C25.8 26.1 24.1 26.8 23.2 25.8L15.5 17.8Z"
          fill="currentColor"
        />
        <rect
          x="13.2"
          y="13.6"
          width="4.8"
          height="4.8"
          rx="0.8"
          transform="rotate(45 15.6 16)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {/* Pilar esquerdo: Instituição / Base */}
      <rect x="6" y="5" width="5.5" height="22" rx="2" fill="currentColor" />
      {/* Braço superior: Ciência / Chamada */}
      <path
        d="M14.5 15.5L23.2 6.2C24.1 5.2 25.8 5.9 25.8 7.3V11C25.8 11.6 25.5 12.2 25.1 12.6L19.2 18.5L14.5 15.5Z"
        fill="currentColor"
      />
      {/* Braço inferior: Operação / Certificado */}
      <path
        d="M14.5 16.5L19.2 13.5L25.1 19.4C25.5 19.8 25.8 20.4 25.8 21V24.7C25.8 26.1 24.1 26.8 23.2 25.8L14.5 16.5Z"
        fill="currentColor"
        fillOpacity="0.82"
      />
      {/* Nó central de convergência / QR */}
      <rect
        x="13.2"
        y="13.6"
        width="4.8"
        height="4.8"
        rx="1"
        transform="rotate(45 15.6 16)"
        className="fill-[var(--ef-secondary-container)] dark:fill-[var(--ef-tertiary)]"
      />
    </svg>
  );
}

