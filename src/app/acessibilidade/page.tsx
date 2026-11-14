import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Keyboard, MonitorSmartphone } from 'lucide-react';

import { PublicLegalLinks } from '@/components/privacy/public-legal-links';
import { PLATFORM_NAV_GROUP } from '@/components/shell/tenant-nav';
import { ThemeChoice } from '@/components/theme/theme-choice';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import { KovenoMark } from '@/components/ui/brand-mark';
import { ACCESSIBILITY_STATEMENT_VERSION } from '@/domain/privacy/privacy-consent-rules';

export const metadata: Metadata = {
  title: 'Acessibilidade',
  description:
    'Declaração de acessibilidade digital da plataforma Koveno (WCAG 2.1 AA e eMAG), recursos suportados e relato de barreiras.',
};

export const dynamic = 'force-dynamic';

export default function AcessibilidadePage() {
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
          title="Declaração de Acessibilidade"
          description="A plataforma Koveno é projetada e testada continuamente para atender às diretrizes WCAG 2.1 nível AA e às recomendações do eMAG (Modelo de Acessibilidade em Governo Eletrônico)."
          breadcrumbs={[{ label: 'Início', href: '/' }, { label: 'Acessibilidade' }]}
          badge={
            <Badge tone="primary" data-testid="accessibility-version">
              Declaração {ACCESSIBILITY_STATEMENT_VERSION}
            </Badge>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-primary" aria-hidden />
              Recursos verificados em produção
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              • <strong className="text-foreground">Melhoria progressiva (funciona sem JavaScript):</strong>{' '}
              seleção de tema, recolhimento da barra lateral e gestão de consentimento de cookies
              operam via formulários HTML padrão e Server Actions, preservando o HTML correto na
              primeira resposta do servidor.
            </p>
            <p>
              • <strong className="text-foreground">Contraste em modo claro e escuro:</strong> todos
              os papéis de superfície e texto são auditados automaticamente por portão{' '}
              <code>axe-core</code> nos fluxos críticos, sem isenções de contraste.
            </p>
            <p>
              • <strong className="text-foreground">Apoio específico ao participante:</strong> o
              formulário de inscrição disponibiliza campo dedicado para necessidades de
              acessibilidade (Libras, rampa, legendagem, restrições alimentares) repassado à
              organização do evento.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Keyboard className="size-4 text-primary" aria-hidden />
              Teclado, leitores de tela e alternativas físicas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              • <strong className="text-foreground">Navegação estrutural:</strong> uso de marcos
              semânticos (<code>&lt;header&gt;</code>, <code>&lt;nav&gt;</code>,{' '}
              <code>&lt;main&gt;</code>, <code>&lt;aside&gt;</code>, <code>&lt;footer&gt;</code>),
              atalho para pular diretamente ao conteúdo principal e diálogos modais acessíveis com
              foco gerenciado.
            </p>
            <p>
              • <strong className="text-foreground">Credenciamento multimodal:</strong> a leitura de
              crachás oferece suporte simultâneo a câmera, leitor de código de barras USB (modo
              teclado) e digitação assistida por código curto.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorSmartphone className="size-4 text-primary" aria-hidden />
              Canal para relato de barreiras
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              Encontrou alguma barreira de navegação, rótulo pouco claro ou dificuldade com leitor de
              tela? As instituições podem acionar o canal institucional em{' '}
              <Link href="/para-instituicoes#contato" className="underline underline-offset-4 hover:text-foreground">
                /para-instituicoes
              </Link>
              , indicando a URL da tela e a tecnologia assistiva utilizada.
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
