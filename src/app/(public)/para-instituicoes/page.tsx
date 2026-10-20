import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Building2,
  ShieldCheck,
  FileCheck2,
  Award,
  Sparkles,
  QrCode,
  ArrowRight,
  CheckCircle2,
  Layers,
  Users,
  Compass,
  HardDrive,
} from 'lucide-react';

import { ThemeChoice } from '@/components/theme/theme-choice';
import { InstitutionLeadForm } from '@/components/platform/lead-form';

export const metadata: Metadata = {
  title: 'Para Instituições · EventFlow SaaS',
  description:
    'Infraestrutura completa de eventos acadêmicos, corporativos e comunitários: submissão de trabalhos com revisão por pares, gamificação, certificação e segurança multi-tenant.',
};

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'lvh.me';

export default function ParaInstituicoesPage() {
  const differentials = [
    {
      icon: ShieldCheck,
      title: 'Isolamento Real de Dados (RLS)',
      description:
        'Cada instituição opera sob isolamento estrito via PostgreSQL Row-Level Security. Nenhum vazamento de inscrições, trabalhos, pareceres ou dados financeiros.',
    },
    {
      icon: FileCheck2,
      title: 'Submissão e Avaliação por Pares',
      description:
        'Chamadas de trabalho com versão cega, rubricas de critérios ponderados configuráveis, verificação automática de conflito de interesse e controle de rodadas.',
    },
    {
      icon: Award,
      title: 'Certificação Digital com QR Code',
      description:
        'Emissão assíncrona em lote calculando a carga horária real presenciada, com página pública de validação criptográfica imediata e layout personalizado.',
    },
    {
      icon: QrCode,
      title: 'Credenciamento & Crachás Térmicos',
      description:
        'Emissão de crachás em folha A4 e suporte a impressoras térmicas ZPL. Leitura rápida na portaria e registro de sessões de presença por atividade.',
    },
    {
      icon: Sparkles,
      title: 'Gamificação Nativa com Cartas Colecionáveis',
      description:
        'Aumente o engajamento do público com pontos de experiência (XP), missões de networking e cartas digitais colecionáveis com efeitos holográficos.',
    },
    {
      icon: Building2,
      title: 'Página Pública & Subdomínio Próprio',
      description:
        'Sua vitrine institucional dedicada sob subdomínio próprio (ex: suauniversidade.eventflow.com.br), paleta de cores personalizada e editor de blocos.',
    },
  ];

  const plans = [
    {
      name: 'Gratuito (Free)',
      description: 'Ideal para comunidades abertas e experimentos institucionais.',
      events: '1 evento ativo',
      members: 'Até 3 membros na equipe',
      storage: '500 MB de armazenamento',
      features: [
        'Inscrições públicas ilimitadas',
        'Crachá digital no celular',
        'Validação pública por QR Code',
        'Subdomínio compartilhado',
      ],
      highlight: false,
    },
    {
      name: 'Starter',
      description: 'Para departamentos universitários e simpósios regionais.',
      events: 'Até 5 eventos ativos',
      members: 'Até 10 membros na equipe',
      storage: '5 GB de armazenamento',
      features: [
        'Tudo do plano Gratuito',
        'Submissão por pares com pareceristas',
        'Emissão de crachás térmicos ZPL',
        'Gamificação básica e cartas',
      ],
      highlight: false,
    },
    {
      name: 'Profissional',
      description: 'Para congressos anuais, faculdades e grandes conferências.',
      events: 'Até 20 eventos ativos',
      members: 'Até 30 membros na equipe',
      storage: '25 GB de armazenamento',
      features: [
        'Tudo do plano Starter',
        'Editor avançado de rubricas e cegueira',
        'Relatórios gerenciais e exportação CSV',
        'Disparo de comunicados em massa',
      ],
      highlight: true,
    },
    {
      name: 'Enterprise / Redes',
      description: 'Para reitorias, federações e grandes corporações multinacionais.',
      events: 'Eventos ilimitados',
      members: 'Equipe ilimitada',
      storage: 'Armazenamento sob demanda',
      features: [
        'Tudo do plano Profissional',
        'Suporte dedicado com SLA',
        'Integrações via Webhook / API',
        'Auditoria estendida e compliance',
      ],
      highlight: false,
    },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="para-instituicoes-page">
      {/* ─── NAVEGAÇÃO SUPERIOR ─────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card/70 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-lg text-foreground hover:opacity-90">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-sm shadow-xs">
                EF
              </span>
              <span>EventFlow</span>
            </Link>

            <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
              <Link
                href="/eventos"
                className="text-muted-foreground transition hover:text-foreground inline-flex items-center gap-1.5"
              >
                <Compass className="size-4" aria-hidden />
                Explorar Eventos
              </Link>
              <Link
                href="/para-instituicoes"
                className="text-foreground transition font-semibold inline-flex items-center gap-1.5"
              >
                <Building2 className="size-4" aria-hidden />
                Para Instituições
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-medium text-muted-foreground transition hover:text-foreground hover:bg-muted"
            >
              Entrar
            </Link>
            <Link
              href="#contato"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs sm:text-sm font-medium text-primary-foreground shadow-xs transition hover:opacity-90"
            >
              Falar com especialista
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      {/* ─── HERO INSTITUCIONAL ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border py-16 sm:py-24 bg-radial from-primary/5 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3.5 py-1 text-xs font-medium text-muted-foreground">
            <Building2 className="size-3.5 text-primary" aria-hidden />
            Solução SaaS para Universidades, Congressos e Empresas
          </div>

          <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground">
            A infraestrutura definitiva para os eventos da sua organização
          </h1>

          <p className="mx-auto max-w-2xl text-pretty text-base sm:text-lg text-muted-foreground">
            Centralize inscrições, submissões por pares, credenciamento na portaria e emissão de certificados
            com governança corporativa e isolamento absoluto de dados.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href="#contato"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-xs transition hover:opacity-90"
            >
              Solicitar demonstração institucional
              <ArrowRight className="size-4" aria-hidden />
            </a>
            <a
              href="#diferenciais"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-muted"
            >
              Conhecer diferenciais
            </a>
          </div>
        </div>
      </section>

      {/* ─── 5 DIFERENCIAIS TÉCNICOS ────────────────────────────────────────── */}
      <section id="diferenciais" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 space-y-12" data-testid="differentials-section">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Diferenciais de Engenharia
          </span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Construído para atender os comitês mais exigentes
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground">
            Elimine planilhas manuais e sistemas fragmentados com uma plataforma que combina rigor acadêmico e usabilidade de ponta.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {differentials.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              className="rounded-xl border border-border bg-card p-6 space-y-3 transition hover:border-primary/50"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─── APRESENTAÇÃO DE PLANOS & QUOTAS ─────────────────────────────────── */}
      <section className="border-t border-border bg-muted/40 py-16 sm:py-20" data-testid="plans-section">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Planos & Capacidade
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Cresça conforme as demandas da sua instituição
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Quotas claras de eventos simultâneos, membros de equipe e armazenamento para PDFs e submissões.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`flex flex-col justify-between rounded-xl border p-6 bg-card transition ${
                  plan.highlight
                    ? 'border-primary ring-2 ring-primary/20 shadow-md relative'
                    : 'border-border'
                }`}
              >
                <div className="space-y-4">
                  {plan.highlight ? (
                    <span className="inline-flex rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                      Mais Popular
                    </span>
                  ) : null}

                  <div>
                    <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                  </div>

                  <div className="space-y-1.5 py-2 border-y border-border/70 text-xs">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Layers className="size-3.5 text-primary shrink-0" />
                      <span>{plan.events}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Users className="size-3.5 text-primary shrink-0" />
                      <span>{plan.members}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <HardDrive className="size-3.5 text-primary shrink-0" />
                      <span>{plan.storage}</span>
                    </div>
                  </div>

                  <ul className="space-y-2 text-xs text-muted-foreground">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="size-3.5 text-success shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <a
                    href="#contato"
                    className={`inline-flex w-full items-center justify-center rounded-lg py-2 text-xs font-semibold transition ${
                      plan.highlight
                        ? 'bg-primary text-primary-foreground hover:opacity-90'
                        : 'border border-border hover:bg-muted text-foreground'
                    }`}
                  >
                    Contratar plano
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FORMULÁRIO DE CONTATO (LEAD) ────────────────────────────────────── */}
      <section id="contato" className="mx-auto max-w-4xl px-4 py-16 sm:py-24 sm:px-6" data-testid="lead-capture-section">
        <InstitutionLeadForm />
      </section>

      {/* ─── RODAPÉ DA PLATAFORMA ────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card py-12 text-xs text-muted-foreground">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
            <div className="space-y-1">
              <div className="flex items-center justify-center sm:justify-start gap-2 font-bold text-sm text-foreground">
                <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground font-black text-xs">
                  EF
                </span>
                <span>EventFlow SaaS</span>
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                Plataforma de governança, submissão e certificação digital para organizações de todo o Brasil.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-xs">
              <Link href="/eventos" className="hover:text-foreground transition">
                Explorar Eventos
              </Link>
              <Link href="/eventos?aba=instituicoes" className="hover:text-foreground transition">
                Diretório de Instituições
              </Link>
              <Link href="/para-instituicoes" className="hover:text-foreground transition font-semibold text-foreground">
                Para Instituições
              </Link>
              <Link href="/login" className="hover:text-foreground transition">
                Área do Participante
              </Link>
            </div>
          </div>

          <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <p>
              Ambiente em nuvem com conformidade, auditoria e isolamento por inquilino (<span className="code-data">instituicao.{ROOT_DOMAIN}</span>).
            </p>

            <ThemeChoice variant="public" />
          </div>
        </div>
      </footer>
    </main>
  );
}
