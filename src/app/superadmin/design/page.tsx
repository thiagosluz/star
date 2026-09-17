import type { Metadata } from 'next';
import { Award, Inbox, Sparkles, Users } from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Progress,
  RarityBadge,
  Select,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrapper,
  Textarea,
} from '@/components/ui';
import { requirePlatformPermission } from '@/lib/platform/guard';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GUIA DE ESTILO VIVO — `/superadmin/design` (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PARA QUE ESTA TELA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Documento de design envelhece; tela de referência, não. Aqui a identidade é
 *  renderizada pelo MESMO código que o produto usa — se um token mudar, esta
 *  página muda junto, e a divergência entre "o que está documentado" e "o que o
 *  sistema faz" desaparece por construção.
 *
 *  Serve a três usos:
 *    1. conferir a identidade (paleta, tipografia, elevação, estados);
 *    2. copiar o uso correto de um componente (o código-fonte desta página é um
 *       exemplo vivo de cada primitivo);
 *    3. revisar mudança: um ajuste de token aparece aqui antes de aparecer em 40
 *       telas.
 *
 *  Fica sob `/superadmin` de propósito: é material interno, e a guarda da FASE 9
 *  já responde 404 para quem não governa a plataforma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: 'Guia de estilo',
  robots: { index: false, follow: false },
};

/** Amostras da paleta crua — os valores exatos do `docs/DESIGN.md`. */
const SURFACES = [
  ['surface', '#f9f9ff', 'Canvas da página'],
  ['surface-low', '#f1f3ff', 'Agrupamento (nível 1)'],
  ['surface-container', '#ebedfa', 'Bloco intermediário'],
  ['surface-high', '#e5e8f4', 'Hover/realce'],
  ['surface-highest', '#dfe2ee', 'Separador forte'],
  ['card', '#ffffff', 'Cartão elevado (nível 2)'],
] as const;

const BRAND = [
  ['primary', '#4f46e5', 'Ação principal'],
  ['primary-hover', '#4338ca', 'Hover da ação'],
  ['brand', '#3525cd', 'Texto de marca'],
  ['primary-soft', '≈#e2dfff', 'Fundo suave'],
  ['secondary-strong', '#00668a', 'Telemetria/sessão'],
  ['tertiary-strong', '#005338', 'Confirmação institucional'],
] as const;

const STATES = [
  ['success', '#10b981', '#059669', 'Confirmado, verificado, aprovado'],
  ['warning', '#f59e0b', '#d97706', 'Espera, em análise, rascunho'],
  ['danger', '#ef4444', '#dc2626', 'Recusado, bloqueado, expirado'],
  ['info', '#40c2fd', '#004d6a', 'Informação neutra'],
] as const;

const TYPE_SCALE = [
  ['text-display', 'Display', 'font-display text-display'],
  ['text-display-sm', 'Indicador', 'font-display text-display-sm'],
  ['text-title-lg', 'Título de página', 'font-display text-title-lg'],
  ['text-title', 'Título de seção', 'font-display text-title'],
  ['text-body-lg', 'Corpo grande', 'text-body-lg'],
  ['text-sm', 'Corpo', 'text-sm'],
  ['label-caps', 'Metadado', 'label-caps'],
  ['code-data', 'Dado técnico', 'code-data'],
] as const;

function Swatch({
  name,
  value,
  usage,
  text = '#0f172a',
}: {
  name: string;
  value: string;
  usage: string;
  text?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div
        className="flex h-16 items-end p-2"
        style={{ backgroundColor: value, color: text }}
      >
        <span className="code-data text-xs">{value}</span>
      </div>
      <div className="space-y-0.5 border-t border-border bg-card px-2 py-1.5">
        <p className="code-data text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">{usage}</p>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="space-y-4" data-testid={testId}>
      <div className="space-y-1">
        <h2 className="font-display text-title-lg text-foreground">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function DesignCatalogPage() {
  await requirePlatformPermission();

  return (
    <div className="space-y-12" data-testid="design-catalog">
      <PageHeader
        title="Guia de estilo"
        breadcrumbs={[{ label: 'Plataforma', href: '/superadmin/metricas' }, { label: 'Guia de estilo' }]}
        description="A identidade do EventFlow renderizada pelo próprio código do produto. Um módulo novo copia daqui — e o teste de guarda impede cor ou tamanho fora de token."
        badge={<Badge tone="primary">FASE 11A</Badge>}
      />

      <Section
        title="Superfícies e elevação"
        description="Quatro degraus: canvas, agrupamento, cartão e sobreposição. Sombra indica que algo está acima do canvas — cartão dentro de cartão se resolve com tonalidade, não com mais sombra."
        testId="design-surfaces"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map(([name, value, usage]) => (
            <Swatch key={name} name={name} value={value} usage={usage} />
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-low p-5">
            <p className="label-caps">Nível 1</p>
            <p className="mt-1 text-sm">Agrupamento estático</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <p className="label-caps">Nível 2</p>
            <p className="mt-1 text-sm">Cartão elevado (padrão)</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 shadow-modal">
            <p className="label-caps">Nível 3</p>
            <p className="mt-1 text-sm">Modal, gaveta</p>
          </div>
        </div>
      </Section>

      <Section
        title="Marca e ações"
        description="A cor de ação é única. Dois botões preenchidos na mesma tela disputam a atenção e destroem a hierarquia — por isso existe um primário e o resto é contorno, fantasma ou texto."
        testId="design-brand"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND.map(([name, value, usage]) => (
            <Swatch key={name} name={name} value={value} usage={usage} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button>Ação principal</Button>
          <Button variant="secondary">Secundária</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="destructive">Destrutiva</Button>
          <Button variant="link">Texto</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Pequeno</Button>
          <Button size="md">Médio</Button>
          <Button size="lg">Grande</Button>
          <Button size="icon" aria-label="Ícone">
            <Sparkles className="size-4" aria-hidden />
          </Button>
          <Button disabled>Indisponível</Button>
        </div>
      </Section>

      <Section
        title="Estados e status"
        description="Chip responde 'em que estado isto está' e sempre traz rótulo escrito — cor sozinha não informa quem não a distingue. Alerta responde 'o que você precisa saber agora' e ocupa a largura do bloco."
        testId="design-states"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATES.map(([name, fill, strong, usage]) => (
            <div key={name} className="space-y-2 rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ backgroundColor: fill }} />
                <span className="code-data text-foreground">{name}</span>
              </div>
              <p className="code-data text-xs text-muted-foreground">
                {fill} · {strong}
              </p>
              <p className="text-xs text-muted-foreground">{usage}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone="success" withDot>
            Confirmada
          </Badge>
          <Badge tone="warning" withDot>
            Em análise
          </Badge>
          <Badge tone="danger" withDot>
            Recusada
          </Badge>
          <Badge tone="info" withDot>
            Em andamento
          </Badge>
          <Badge tone="neutral">Rascunho</Badge>
          <Badge tone="primary">Ativa</Badge>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Alert tone="info" title="Inscrições abrem em 3 dias">
            Quem se inscreveu recebe a confirmação por e-mail quando a janela abrir.
          </Alert>
          <Alert tone="warning" title="Parecer pendente">
            Restam 2 avaliações para fechar a trilha de Tecnologia Educacional.
          </Alert>
          <Alert tone="danger" title="Acesso bloqueado">
            Seu acesso a esta instituição está bloqueado. Fale com a organização.
          </Alert>
          <Alert tone="success" title="Certificado emitido">
            O documento está assinado e pode ser validado pelo QR Code.
          </Alert>
        </div>
      </Section>

      <Section
        title="Tipografia"
        description="Plus Jakarta Sans para títulos (autoridade editorial) e Inter para tudo operacional. Metadado é sempre caixa alta em cinza médio; número técnico é sempre tabular."
        testId="design-typography"
      >
        <Card>
          <CardContent className="divide-y divide-border">
            {TYPE_SCALE.map(([token, label, className]) => (
              <div key={token} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-4 first:pt-0 last:pb-0">
                <span className="code-data w-40 shrink-0 text-muted-foreground">{token}</span>
                <span className={`${className} min-w-0 text-foreground`}>{label}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Indicadores"
        description="O valor carrega a cor; o cartão permanece neutro. Colorir o bloco inteiro transforma um número em alarme e o painel inteiro em ruído."
        testId="design-metrics"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Inscrições"
            value={1284}
            hint="+18% desde ontem"
            icon={<Users className="size-4" aria-hidden />}
            tone="primary"
          />
          <StatCard
            label="Certificados"
            value={312}
            hint="Emitidos e assinados"
            icon={<Award className="size-4" aria-hidden />}
            tone="success"
          />
          <StatCard
            label="Pareceres pendentes"
            value={7}
            hint="Prazo em 2 dias"
            icon={<Inbox className="size-4" aria-hidden />}
            tone="warning"
          />
          <StatCard label="Ocupação média" value="76%" hint="Das atividades" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4">
              <Progress value={184} max={240} label="Vagas preenchidas" />
              <Progress value={7} max={7} label="Trilhas publicadas" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4">
              <Avatar name="Ana Beatriz Souza" size="lg" />
              <Avatar name="Bruno Carvalho" />
              <Avatar name="Carla" size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Ana Beatriz Souza</p>
                <p className="label-caps">ADMIN · PROFESSIONAL</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        title="Raridade (gamificação)"
        description="Gradiente é reservado a conquista. Um selo de raridade com a linguagem de status operacional borraria a fronteira entre 'estado do sistema' e 'mérito do participante'."
        testId="design-rarity"
      >
        <div className="flex flex-wrap items-center gap-4">
          <RarityBadge rarity="COMMON" />
          <RarityBadge rarity="RARE" />
          <RarityBadge rarity="EPIC" />
          <RarityBadge rarity="LEGENDARY" />
          <RarityBadge rarity="MYTHIC" />
        </div>
      </Section>

      <Section
        title="Tabela"
        description="Cabeçalho em caixa alta sobre superfície baixa, linha de 52px, hairline entre linhas e algarismos tabulares nas colunas numéricas — sem isso a coluna não é comparável de cima a baixo."
        testId="design-table"
      >
        <Card className="overflow-hidden">
          <TableWrapper>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Participante</TH>
                  <TH>Atividade</TH>
                  <TH className="text-right">Minutos</TH>
                  <TH>Situação</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD>Ana Beatriz Souza</TD>
                  <TD className="text-muted-foreground">Minicurso de Rust</TD>
                  <TD numeric>240</TD>
                  <TD>
                    <Badge tone="success" withDot>
                      Presente
                    </Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Bruno Carvalho</TD>
                  <TD className="text-muted-foreground">Mesa-redonda: inclusão digital</TD>
                  <TD numeric>90</TD>
                  <TD>
                    <Badge tone="warning" withDot>
                      Parcial
                    </Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Diego Matos</TD>
                  <TD className="text-muted-foreground">Workshop de avaliação por pares</TD>
                  <TD numeric>0</TD>
                  <TD>
                    <Badge tone="neutral">Não credenciado</Badge>
                  </TD>
                </TR>
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      </Section>

      <Section
        title="Formulário"
        description="Campo de 44px com foco imediato (borda da marca + anel). Rótulo, dica e erro vêm do mesmo `name`, então o vínculo de acessibilidade não depende de disciplina."
        testId="design-form"
      >
        <Card>
          <CardHeader>
            <CardTitle>Dados da atividade</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="catalog-title" label="Título" hint="Aparece na programação pública." required>
              <Input id="catalog-title" name="catalog-title" placeholder="Mesa-redonda: inclusão digital" />
            </Field>
            <Field name="catalog-type" label="Tipo">
              <Select id="catalog-type" name="catalog-type" defaultValue="ROUND_TABLE">
                <option value="LECTURE">Palestra</option>
                <option value="ROUND_TABLE">Mesa-redonda</option>
                <option value="MINI_COURSE">Minicurso</option>
              </Select>
            </Field>
            <Field
              name="catalog-slug"
              label="Identificador"
              error="Este identificador é reservado pela plataforma."
              className="sm:col-span-2"
            >
              <Input
                id="catalog-slug"
                name="catalog-slug"
                defaultValue="api"
                aria-invalid
                aria-describedby="catalog-slug-error"
              />
            </Field>
            <Field name="catalog-notes" label="Observações" className="sm:col-span-2">
              <Textarea id="catalog-notes" name="catalog-notes" placeholder="Material necessário…" />
            </Field>
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Vazio e carregando"
        description="Vazio é estado legítimo, não erro: explica o que apareceria ali e oferece a ação que preenche a tela."
        testId="design-empty"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState
            icon={Inbox}
            title="Nenhuma submissão ainda"
            description="Quando a chamada de trabalhos abrir, os envios aparecem aqui para avaliação."
            action={<Button size="sm">Configurar chamada</Button>}
          />
          <Card>
            <CardContent className="space-y-3">
              <div className="h-4 w-1/3 animate-pulse rounded-sm bg-surface-high" />
              <div className="h-3 w-2/3 animate-pulse rounded-sm bg-surface-high" />
              <div className="h-24 w-full animate-pulse rounded-md bg-surface-high" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        title="Como usar em um módulo novo"
        description="O passo a passo completo está em docs/design-system.md. O resumo: importe de @/components/ui, use tokens, e se faltar algo, acrescente um primitivo ao sistema em vez de escrever a classe solta na tela."
        testId="design-howto"
      >
        <Card>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p className="code-data text-foreground">import {'{ PageHeader, Card, Button }'} from &apos;@/components/ui&apos;;</p>
            <p>
              Toda tela começa por <span className="code-data text-foreground">PageHeader</span>, agrupa
              conteúdo em <span className="code-data text-foreground">Card</span> e usa{' '}
              <span className="code-data text-foreground">Button</span> para ação. Lista usa{' '}
              <span className="code-data text-foreground">Table</span>; vazio usa{' '}
              <span className="code-data text-foreground">EmptyState</span>; retorno ao usuário usa{' '}
              <span className="code-data text-foreground">Alert</span>.
            </p>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
