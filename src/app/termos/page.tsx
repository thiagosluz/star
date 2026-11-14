import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, BookOpenCheck, Scale, ShieldAlert } from 'lucide-react';

import { PublicLegalLinks } from '@/components/privacy/public-legal-links';
import { PLATFORM_NAV_GROUP } from '@/components/shell/tenant-nav';
import { ThemeChoice } from '@/components/theme/theme-choice';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import { KovenoMark } from '@/components/ui/brand-mark';
import { TERMS_VERSION } from '@/domain/privacy/privacy-consent-rules';

export const metadata: Metadata = {
  title: 'Termos de Uso',
  description:
    'Termos e condições gerais de uso da plataforma Koveno para instituições organizadoras, autores, pareceristas e participantes.',
};

export const dynamic = 'force-dynamic';

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
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

      <main id="conteudo-principal" className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-6">
        <PageHeader
          eyebrow={PLATFORM_NAV_GROUP}
          title="Termos de Uso"
          description="Estes termos regem a utilização da plataforma Koveno por instituições organizadoras de eventos, membros de equipe, pareceristas, palestrantes e participantes."
          breadcrumbs={[{ label: 'Início', href: '/' }, { label: 'Termos de uso' }]}
          badge={
            <Badge tone="primary" data-testid="terms-version">
              Versão {TERMS_VERSION}
            </Badge>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="size-4 text-primary" aria-hidden />
              1. Papéis e responsabilidades
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              • <strong className="text-foreground">Plataforma Koveno (Operadora):</strong> provê a
              infraestrutura multi-tenant isolada por Row-Level Security, autenticação única global,
              emissão e validação pública de certificados, trilhas auditáveis e ferramentas de
              submissão e credenciamento.
            </p>
            <p>
              • <strong className="text-foreground">Instituição Organizadora (Controladora):</strong>{' '}
              responde pela programação, critérios de inscrição, confirmação de vagas, editais de
              chamadas, avaliação por pares, comunicações segmentadas e cumprimento das regras do
              evento perante seus participantes.
            </p>
            <p>
              • <strong className="text-foreground">Titular / Participante / Autor:</strong> é
              responsável pela veracidade dos dados declarados, integridade das obras submetidas e
              guarda de suas credenciais de acesso (incluindo segundo fator e códigos de
              recuperação).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenCheck className="size-4 text-primary" aria-hidden />
              2. Integridade acadêmica, certificados e sorteios
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              • Avaliações por pares em modo cego ou duplamente cego devem respeitar conflitos de
              interesse declarados e confidencialidade dos manuscritos.
            </p>
            <p>
              • Certificados emitidos pela plataforma recebem código único verificável e assinatura
              SHA-256 em <Link href="/validar/exemplo" className="underline underline-offset-4 hover:text-foreground">/validar</Link>. A
              instituição emissora pode revogar um certificado caso apure erro material ou fraude,
              registrando o fato em trilha auditável.
            </p>
            <p>
              • Sorteios realizados em eventos utilizam algoritmo determinístico verificável (semente
              comprometida e revelada na apuração), permitindo auditoria pública posterior.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-primary" aria-hidden />
              3. Encerramento de conta e privacidade
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              O titular pode encerrar a própria conta a qualquer momento em{' '}
              <Link href="/conta#encerrar-conta" className="underline underline-offset-4 hover:text-foreground">
                Minha conta
              </Link>
              , observada a transferência prévia de titularidade caso seja o único proprietário
              ativo de uma instituição. O tratamento de dados pessoais e cookies segue o inventário
              publicado em{' '}
              <Link href="/privacidade" className="underline underline-offset-4 hover:text-foreground">
                /privacidade
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t border-border bg-card py-8 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <PublicLegalLinks />
          <ThemeChoice variant="public" />
        </div>
      </footer>
    </div>
  );
}
