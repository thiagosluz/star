import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Cookie, FileText, Lock, ShieldCheck, Trash2 } from 'lucide-react';

import { saveCookieConsentAction } from '@/app/actions/privacy-actions';
import { PublicLegalLinks } from '@/components/privacy/public-legal-links';
import { PLATFORM_NAV_GROUP } from '@/components/shell/tenant-nav';
import { ThemeChoice } from '@/components/theme/theme-choice';
import { Badge, Card, CardContent, CardHeader, CardTitle, FormStatusButton, PageHeader, buttonClasses } from '@/components/ui';
import { KovenoMark } from '@/components/ui/brand-mark';
import {
  COOKIE_INVENTORY,
  DATA_PROCESSING_INVENTORY,
  PRIVACY_INVENTORY_EFFECTIVE_DATE,
  PRIVACY_INVENTORY_VERSION,
} from '@/domain/privacy/privacy-consent-rules';
import {
  readCookieConsentReceipt,
  readVisitorCookieConsent,
} from '@/lib/privacy/cookie-consent-service';

export const metadata: Metadata = {
  title: 'Privacidade e Inventário de Cookies',
  description:
    'Inventário versionado de dados pessoais e cookies da plataforma Koveno, registro de consentimento e autonomia do titular.',
};

export const dynamic = 'force-dynamic';

export default async function PrivacidadePage() {
  const consent = await readVisitorCookieConsent();
  const receipt = await readCookieConsentReceipt(consent?.token);

  const essentialCookies = COOKIE_INVENTORY.filter((item) => item.category === 'ESSENTIAL');
  const preferenceCookies = COOKIE_INVENTORY.filter((item) => item.category === 'PREFERENCE');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-foreground">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <KovenoMark className="size-4" />
            </span>
            <span>Koveno</span>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Voltar ao início
          </Link>
        </div>
      </header>

      <main id="conteudo-principal" className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:px-6">
        <PageHeader
          eyebrow={PLATFORM_NAV_GROUP}
          title="Privacidade, Inventário de Dados e Cookies"
          description="Esta página publica a versão vigente do inventário de tratamento de dados e cookies da plataforma Koveno, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018). Separação honesta: preferências cosméticas não são tratadas como cookies essenciais."
          breadcrumbs={[{ label: 'Início', href: '/' }, { label: 'Privacidade e cookies' }]}
          badge={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary" data-testid="privacy-inventory-version">
                Inventário {PRIVACY_INVENTORY_VERSION}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Vigência desde {PRIVACY_INVENTORY_EFFECTIVE_DATE}
              </span>
            </div>
          }
        />

        {/* ── Controle real de escolha de cookies (funciona sem JavaScript) ────── */}
        <Card id="cookies" data-testid="privacy-cookie-controls">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cookie className="size-5 text-primary" aria-hidden />
              Suas preferências de cookies neste navegador
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm space-y-2">
              <p className="font-medium text-foreground" data-testid="privacy-consent-status">
                Estado atual:{' '}
                {consent === null
                  ? 'Nenhuma decisão registrada ainda nesta versão.'
                  : consent.preferencesAllowed
                    ? 'Essenciais + Preferências aceitos (tema e barra lateral ativos).'
                    : 'Apenas essenciais aceitos (cookies de tema e barra lateral bloqueados e apagados).'}
              </p>

              {receipt ? (
                <p className="text-xs text-muted-foreground" data-testid="privacy-consent-receipt">
                  Registro na plataforma: recibo <code>{receipt.id}</code> · versão{' '}
                  <code>{receipt.policyVersion}</code> · gravado em{' '}
                  {receipt.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                  {receipt.ipAddressMasked ? ` · sub-rede ${receipt.ipAddressMasked}` : ''}.
                </p>
              ) : null}
            </div>

            <form action={saveCookieConsentAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="source" value="privacidade" />
              <FormStatusButton
                name="choice"
                value="ESSENTIAL_ONLY"
                showSpinner
                pendingContent="Aplicando…"
                className={buttonClasses({
                  variant: consent?.preferencesAllowed === false ? 'primary' : 'outline',
                  size: 'sm',
                })}
                data-testid="privacy-choose-essential"
              >
                Usar apenas essenciais
              </FormStatusButton>
              <FormStatusButton
                name="choice"
                value="ALL"
                showSpinner
                pendingContent="Aplicando…"
                className={buttonClasses({
                  variant: consent?.preferencesAllowed === true ? 'primary' : 'outline',
                  size: 'sm',
                })}
                data-testid="privacy-choose-all"
              >
                Aceitar essenciais e preferências
              </FormStatusButton>
            </form>
          </CardContent>
        </Card>

        {/* ── Inventário de Cookies ──────────────────────────────────────────── */}
        <section className="grid gap-6 md:grid-cols-2" aria-label="Inventário de cookies">
          <Card data-testid="inventory-essential-cookies">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="size-4 text-primary" aria-hidden />
                Cookies essenciais (sempre ativos)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Estritamente necessários para autenticação, isolamento entre instituições e
                segurança em dois fatores.
              </p>
              <ul className="space-y-3">
                {essentialCookies.map((item) => (
                  <li key={item.name} className="rounded-lg border border-border p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{item.title}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.name}</code>
                    </div>
                    <p className="text-muted-foreground">{item.purpose}</p>
                    <p className="text-xs text-muted-foreground">Retenção: {item.retention}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="inventory-preference-cookies">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-primary" aria-hidden />
                Cookies de preferência (escolha real)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Servem apenas ao conforto visual e layout. Se você recusar, são imediatamente
                apagados e não voltam a ser gravados.
              </p>
              <ul className="space-y-3">
                {preferenceCookies.map((item) => (
                  <li key={item.name} className="rounded-lg border border-border p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{item.title}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.name}</code>
                    </div>
                    <p className="text-muted-foreground">{item.purpose}</p>
                    <p className="text-xs text-muted-foreground">Retenção: {item.retention}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* ── Inventário de Tratamento de Dados Pessoais ─────────────────────── */}
        <Card data-testid="privacy-data-inventory">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-5 text-primary" aria-hidden />
              Inventário versionado de tratamento de dados ({PRIVACY_INVENTORY_VERSION})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Escopo</th>
                  <th className="py-2 pr-3 font-medium">Categoria</th>
                  <th className="py-2 pr-3 font-medium">Dados tratados</th>
                  <th className="py-2 pr-3 font-medium">Base legal e finalidade</th>
                  <th className="py-2 font-medium">Retenção</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {DATA_PROCESSING_INVENTORY.map((row) => (
                  <tr key={row.category} className="align-top">
                    <td className="py-3 pr-3 font-medium text-foreground">{row.scope}</td>
                    <td className="py-3 pr-3 font-medium text-foreground">{row.category}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{row.dataPoints}</td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      <span className="block text-foreground">{row.purpose}</span>
                      <span className="mt-1 block">{row.legalBasis}</span>
                    </td>
                    <td className="py-3 text-muted-foreground">{row.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* ── Autonomia do Titular e Garantias Técnicas ──────────────────────── */}
        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-primary" aria-hidden />
                Garantias técnicas de minimização
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                • <strong className="text-foreground">IP mascarado na trilha persistente:</strong>{' '}
                endereços IP registrados em auditoria (<code>audit_logs</code>,{' '}
                <code>identity_audit_logs</code>) e em recibos de consentimento são truncados para
                prefixo de sub-rede (<code>/24</code> em IPv4 e <code>/48</code> em IPv6) antes da
                gravação no banco.
              </p>
              <p>
                • <strong className="text-foreground">Snapshot versionado na inscrição:</strong>{' '}
                cada inscrição registra a versão e o texto exato do termo aceito pelo titular no
                momento do envio.
              </p>
              <p>
                • <strong className="text-foreground">Isolamento multi-tenant real:</strong> cada
                instituição é isolada via PostgreSQL Row-Level Security (RLS) com{' '}
                <code>FORCE ROW LEVEL SECURITY</code>.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trash2 className="size-4 text-primary" aria-hidden />
                Direitos do titular e exclusão de conta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                Você pode consultar seu histórico de segurança, revogar dispositivos conectados,
                apagar respostas pessoais de formulários em <em>Minhas inscrições</em> e{' '}
                <strong className="text-foreground">encerrar a própria conta diretamente</strong>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/conta#encerrar-conta"
                  className={buttonClasses({ variant: 'outline', size: 'sm' })}
                >
                  Ir para encerramento da conta (/conta)
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border bg-card py-8 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <PublicLegalLinks />
          <ThemeChoice variant="public" />
        </div>
      </footer>
    </div>
  );
}
