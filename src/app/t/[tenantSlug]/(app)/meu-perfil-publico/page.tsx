import Link from 'next/link';
import { ExternalLink, Eye, Globe, ShieldCheck } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  MAX_INTERESTS,
  PROFILE_AUDIENCES,
  PROFILE_AUDIENCE_HINTS,
  PROFILE_AUDIENCE_LABELS,
  PUBLIC_BIO_MAX_LENGTH,
  PUBLIC_HEADLINE_MAX_LENGTH,
  PUBLIC_PROFILE_FIELD_HINTS,
  PUBLIC_PROFILE_FIELD_LABELS,
  PUBLIC_PROFILE_FIELDS,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@/domain/profile/public-profile-rules';
import { getPublicProfileSettings } from '@/lib/profile/public-profile-service';
import {
  AdminForm,
  CheckboxField,
  Field,
  SelectField,
} from '@/components/admin/admin-form';
import { Alert, Card, CardContent, SectionHeading } from '@/components/ui';
import { savePublicProfileAction } from '@/app/actions/public-profile-actions';

export const metadata = { title: 'Meu perfil público' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MEU PERFIL PÚBLICO (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA É UMA SÓ, E ELA RESPONDE TRÊS PERGUNTAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Quem eu sou aqui** — @handle, título, bio, interesses e links;
 *    2. **Quem vê o quê** — um nível por campo, com o texto dizendo exatamente o que
 *       cada nível significa (é a decisão mais delicada da fase, e ela não pode
 *       depender de adivinhação);
 *    3. **Onde isso aparece** — a página da instituição, o diretório de participantes
 *       e os buscadores, cada um com a sua escolha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não dá XP por publicar (consentimento não é pedágio — FASE 42), não preenche
 *  interesse nenhum por dedução, e não decide nada por você: os padrões aparecem
 *  escolhidos, e mudá-los é um clique.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function MyPublicProfilePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, userId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PROFILE_MANAGE_OWN,
  });

  const result = await getPublicProfileSettings({ tenantId, userId });

  if (!result.ok) {
    return (
      <main className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Meu perfil público</h1>
        <Alert tone="danger">{result.message}</Alert>
      </main>
    );
  }

  const { settings } = result;

  return (
    <main className="max-w-4xl space-y-8" data-testid="my-public-profile">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Minha participação</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Globe className="size-6 text-primary" aria-hidden />
          Meu perfil público
        </h1>
        <p className="text-sm text-muted-foreground">
          Um endereço para mostrar a sua participação. O seu <span className="code-data">@handle</span>{' '}
          é o mesmo em todas as instituições, a decisão de quem vê cada campo também é uma só — e a
          página existe em cada instituição onde você participa, com os eventos e o diretório
          daquela casa.
        </p>
      </header>

      {settings.username ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Seu endereço</p>
            <p className="code-data text-sm" data-testid="my-profile-url">
              /t/{tenantSlug}/u/{settings.username}
            </p>
          </div>
          <Link
            href={tenantPath(tenantSlug, `/u/${settings.username}`)}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            data-testid="my-profile-open"
          >
            <Eye className="size-3.5" aria-hidden />
            Ver como os outros veem
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </section>
      ) : (
        <Alert tone="info">
          Você ainda não tem um <span className="code-data">@handle</span>: escolha um abaixo para o
          seu perfil existir.
        </Alert>
      )}

      <AdminForm
        action={savePublicProfileAction}
        submitLabel="Salvar perfil"
        testId="save-public-profile"
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <section className="space-y-3">
          <SectionHeading
            title="Identidade"
            description="Como você aparece no topo da página."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="@handle (o seu endereço)"
              name="username"
              required
              placeholder="ana-souza"
              defaultValue={settings.username ?? ''}
              hint={`${USERNAME_MIN_LENGTH} a ${USERNAME_MAX_LENGTH} caracteres: letras sem acento, números e hífen. Não aparece o seu e-mail.`}
            />
            <Field
              label="Título profissional"
              name="headline"
              placeholder="Pesquisadora em saúde pública"
              defaultValue={settings.headline ?? ''}
              hint={`Até ${PUBLIC_HEADLINE_MAX_LENGTH} caracteres.`}
            />
          </div>

          <Field
            label="Sobre você"
            name="bio"
            placeholder="Um parágrafo curto sobre o que você faz e o que busca nos eventos."
            defaultValue={settings.bio ?? ''}
            hint={`Até ${PUBLIC_BIO_MAX_LENGTH} caracteres.`}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Interesses (separados por vírgula)"
              name="interests"
              placeholder="Rust, educação, saúde pública"
              defaultValue={settings.interests.join(', ')}
              hint={`Até ${MAX_INTERESTS}. Escritos por você — o sistema não deduz interesse do que você assistiu.`}
            />
            <Field
              label="Site pessoal"
              name="siteUrl"
              placeholder="https://..."
              defaultValue={settings.siteUrl ?? ''}
              hint="Precisa começar com http:// ou https://."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="ORCID"
              name="orcidId"
              placeholder="0000-0002-1825-0097"
              defaultValue={settings.orcidId ?? ''}
              hint="Formato 0000-0000-0000-0000. Vira link para o seu registro público."
            />
            <Field
              label="Lattes"
              name="lattesId"
              placeholder="1234567890123456"
              defaultValue={settings.lattesId ?? ''}
              hint="Os 16 dígitos do endereço lattes.cnpq.br. Vazio não mostra nada."
            />
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Quem vê cada coisa"
            description="Cada campo tem o próprio nível — e nada aparece sem a sua escolha."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            {PUBLIC_PROFILE_FIELDS.map((field) => (
              <div key={field} className="space-y-1">
                {/**
                 * O rótulo ganha o prefixo de propósito: sem ele, "Título profissional" e
                 * "Sobre você" apareceriam DUAS vezes na mesma página (o campo de texto e o
                 * nível de visibilidade), e nem quem lê a tela nem o leitor de tela saberiam
                 * qual é qual.
                 */}
                <SelectField
                  label={`Visibilidade: ${PUBLIC_PROFILE_FIELD_LABELS[field]}`}
                  name={`audience_${field}`}
                  options={PROFILE_AUDIENCES.map((audience) => ({
                    value: audience,
                    label: PROFILE_AUDIENCE_LABELS[audience],
                  }))}
                  defaultValue={settings.audiences[field]}
                  hint={PUBLIC_PROFILE_FIELD_HINTS[field]}
                />
                {settings.audiences[field] === 'ATTENDEES_ONLY' ? (
                  <p className="text-xs text-muted-foreground">{PROFILE_AUDIENCE_HINTS.ATTENDEES_ONLY}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Quais eventos mostrar"
            description="A lista de eventos é escolhida um a um — e nunca mostra data, minutos ou atividade interna."
          />

          {settings.eventOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Você ainda não participou de eventos nesta instituição.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="profile-event-choices">
              {settings.eventOptions.map((event) => (
                <li key={event.id}>
                  <CheckboxField
                    label={event.title}
                    name="publicEventIds"
                    value={event.id}
                    defaultChecked={settings.publicEventIds.includes(event.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Onde o perfil aparece"
            description="Ter uma página é diferente de ser encontrado — as duas decisões são suas."
          />

          <div className="space-y-3">
            <CheckboxField
              label="Aparecer no diretório de participantes desta instituição"
              name="listedInDirectory"
              defaultChecked={settings.listedInDirectory}
              hint="Quem é da instituição vê o seu nome na lista de participantes, com link para o perfil."
            />
            <CheckboxField
              label="Permitir que buscadores encontrem o meu perfil"
              name="indexable"
              defaultChecked={settings.indexable}
              hint="Desligado (padrão), a página existe para quem tem o link, mas não aparece no Google."
            />
            <CheckboxField
              label="Mostrar o meu nome completo no resultado público dos sorteios"
              name="publicNameInResults"
              defaultChecked={settings.publicNameInResults}
              hint="Desligado (padrão), o resultado do sorteio mostra o seu nome mascarado (Ana Souza → Ana S.). Ligar vale para todos os eventos e sorteios desta e das outras instituições."
            />
          </div>
        </section>

        <Card>
          <CardContent className="flex items-start gap-2 py-4 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p>
                Publicar o perfil <strong>não dá XP</strong> e não melhora a sua posição: a vitrine é
                sua, e a decisão de aparecer não pode valer pontos — senão quem quer privacidade fica
                em desvantagem no jogo.
              </p>
              <p>
                O <span className="code-data">@handle</span> só pode ser trocado a cada{' '}
                {USERNAME_CHANGE_COOLDOWN_DAYS} dias
                {settings.nextUsernameChangeAt
                  ? ` — a próxima troca libera em ${settings.nextUsernameChangeAt.toLocaleDateString('pt-BR')}`
                  : ''}
                . Ele é o endereço da página: mudar quebra os links já compartilhados.
              </p>
            </div>
          </CardContent>
        </Card>
      </AdminForm>
    </main>
  );
}
