'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Formulários do painel de plataforma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE TODOS OS CAMPOS SÃO CONTROLADOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 RESETA o formulário depois que uma Server Action termina. Em um
 *  formulário de provisionamento — sete campos, vários opcionais — isso significa
 *  perder tudo o que foi digitado quando a validação recusa por um motivo só (um
 *  slug reservado, por exemplo). O usuário redigitaria a instituição inteira.
 *
 *  Manter os campos controlados deixa o que foi digitado na tela e permite
 *  corrigir apenas o que a mensagem apontou. O mesmo vale para o motivo da
 *  suspensão, que é texto livre e longo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Ban, CheckCircle2, Loader2, Plus, ShieldCheck, UserPlus } from 'lucide-react';

import {
  grantSuperAdminAction,
  provisionTenantAction,
  revokeSuperAdminAction,
  setTenantStatusAction,
  updateTenantProfileAction,
  type PlatformActionState,
} from '@/app/actions/platform-actions';
import { TENANT_PLANS, PLAN_DEFINITIONS, type TenantPlan } from '@/domain/platform/platform-rules';

const INITIAL: PlatformActionState | null = null;

function Feedback({ state, testId }: { state: PlatformActionState | null; testId: string }) {
  if (!state) return null;

  return (
    <div
      data-testid={testId}
      data-ok={state.ok ? 'true' : 'false'}
      role="status"
      className={`mt-4 rounded-lg border p-3 text-sm ${
        state.ok
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      }`}
    >
      <p className="font-medium">{state.message}</p>
      {state.details && state.details.length > 0 ? (
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          {state.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Submit({
  label,
  pendingLabel,
  testId,
  icon,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  testId: string;
  icon: React.ReactNode;
  variant?: 'primary' | 'outline' | 'danger';
}) {
  const { pending } = useFormStatus();

  const styles = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border hover:bg-muted',
    danger: 'bg-destructive text-white hover:opacity-90',
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${styles}`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {pending ? pendingLabel : label}
    </button>
  );
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
const labelClass = 'block text-xs font-medium text-muted-foreground';

// ───────────────────────────────────────────────────────────────────────────────
//  Provisionamento
// ───────────────────────────────────────────────────────────────────────────────
export function ProvisionTenantForm() {
  const [state, action] = useActionState(provisionTenantAction, INITIAL);

  const [values, setValues] = useState({
    name: '',
    slug: '',
    plan: 'FREE' as TenantPlan,
    ownerEmail: '',
    customDomain: '',
    description: '',
    maxEvents: '',
    maxMembers: '',
    isPublic: true,
  });

  function update<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const plan = PLAN_DEFINITIONS[values.plan];

  return (
    <section className="rounded-xl border border-border bg-card p-6" data-testid="provision-section">
      <header className="flex items-center gap-2">
        <Plus className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">Nova instituição</h2>
      </header>
      <p className="mt-1 text-xs text-muted-foreground">
        A instituição nasce ativa e com um proprietário (OWNER) já vinculado. O dono precisa ter
        conta na plataforma — a identidade é única por pessoa.
      </p>

      <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2" data-testid="provision-form">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="name">
            Nome da instituição
          </label>
          <input
            id="name"
            name="name"
            required
            minLength={3}
            maxLength={160}
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
            data-testid="provision-name"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="slug">
            Identificador (slug)
          </label>
          <input
            id="slug"
            name="slug"
            required
            maxLength={63}
            placeholder="ufba"
            value={values.slug}
            onChange={(event) => update('slug', event.target.value)}
            data-testid="provision-slug"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Vira o endereço: /t/{values.slug || 'identificador'}. Nomes de sistema são reservados.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="plan">
            Plano
          </label>
          <select
            id="plan"
            name="plan"
            value={values.plan}
            onChange={(event) => update('plan', event.target.value as TenantPlan)}
            data-testid="provision-plan"
            className={inputClass}
          >
            {TENANT_PLANS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Quotas do plano: {plan.maxEvents ?? 'ilimitados'} eventos ·{' '}
            {plan.maxMembers ?? 'ilimitados'} membros
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="ownerEmail">
            E-mail do proprietário
          </label>
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            required
            value={values.ownerEmail}
            onChange={(event) => update('ownerEmail', event.target.value)}
            data-testid="provision-owner-email"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="customDomain">
            Domínio personalizado (opcional)
          </label>
          <input
            id="customDomain"
            name="customDomain"
            placeholder="eventos.instituicao.br"
            value={values.customDomain}
            onChange={(event) => update('customDomain', event.target.value)}
            data-testid="provision-domain"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="maxEvents">
            Quota de eventos (vazio = do plano)
          </label>
          <input
            id="maxEvents"
            name="maxEvents"
            type="number"
            min={0}
            value={values.maxEvents}
            onChange={(event) => update('maxEvents', event.target.value)}
            data-testid="provision-max-events"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="maxMembers">
            Quota de membros (vazio = do plano)
          </label>
          <input
            id="maxMembers"
            name="maxMembers"
            type="number"
            min={0}
            value={values.maxMembers}
            onChange={(event) => update('maxMembers', event.target.value)}
            data-testid="provision-max-members"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="description">
            Apresentação pública (opcional)
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={600}
            value={values.description}
            onChange={(event) => update('description', event.target.value)}
            data-testid="provision-description"
            className={inputClass}
          />
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="isPublic"
            checked={values.isPublic}
            onChange={(event) => update('isPublic', event.target.checked)}
            data-testid="provision-is-public"
            className="size-4 rounded border-border"
          />
          Exibir esta instituição no diretório público
        </label>

        <div className="sm:col-span-2">
          <Submit
            label="Provisionar instituição"
            pendingLabel="Provisionando…"
            testId="provision-submit"
            icon={<Plus className="size-4" aria-hidden />}
          />
        </div>
      </form>

      <Feedback state={state} testId="provision-feedback" />

      {state?.ok && state.data?.slug ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Endereço público: <span className="font-mono">/t/{String(state.data.slug)}</span>
        </p>
      ) : null}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ciclo de vida
// ───────────────────────────────────────────────────────────────────────────────
export function TenantStatusForm({
  tenantId,
  status,
}: {
  tenantId: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}) {
  const [state, action] = useActionState(setTenantStatusAction, INITIAL);
  const [reason, setReason] = useState('');

  const suspended = status === 'SUSPENDED';

  return (
    <section className="rounded-xl border border-border bg-card p-6" data-testid="tenant-status-section">
      <header className="flex items-center gap-2">
        {suspended ? (
          <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <Ban className="size-4 text-muted-foreground" aria-hidden />
        )}
        <h2 className="text-base font-semibold text-foreground">
          {suspended ? 'Reativar instituição' : 'Suspender instituição'}
        </h2>
      </header>

      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {suspended
          ? 'A reativação devolve o acesso imediatamente e a instituição volta à vitrine pública.'
          : 'A suspensão corta o acesso na requisição seguinte — vitrine e painel — e exige uma justificativa que o dono vai ler na tela de bloqueio.'}
      </p>

      <form action={action} className="mt-4 space-y-3" data-testid="tenant-status-form">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="status" value={suspended ? 'ACTIVE' : 'SUSPENDED'} />

        {suspended ? null : (
          <div>
            <label className={labelClass} htmlFor="reason">
              Motivo (mínimo de 8 caracteres)
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={400}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: pendência financeira do plano PROFESSIONAL em aberto desde 01/09."
              data-testid="suspend-reason"
              className={inputClass}
            />
          </div>
        )}

        <Submit
          label={suspended ? 'Reativar' : 'Suspender'}
          pendingLabel="Aplicando…"
          testId={suspended ? 'reactivate-submit' : 'suspend-submit'}
          variant={suspended ? 'primary' : 'danger'}
          icon={suspended ? <CheckCircle2 className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
        />
      </form>

      <Feedback state={state} testId="tenant-status-feedback" />
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil público
// ───────────────────────────────────────────────────────────────────────────────
export function TenantProfileForm({
  tenantId,
  description,
  logoUrl,
  websiteUrl,
  isPublic,
}: {
  tenantId: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isPublic: boolean;
}) {
  const [state, action] = useActionState(updateTenantProfileAction, INITIAL);
  const [values, setValues] = useState({
    description: description ?? '',
    logoUrl: logoUrl ?? '',
    websiteUrl: websiteUrl ?? '',
    isPublic,
  });

  return (
    <section className="rounded-xl border border-border bg-card p-6" data-testid="tenant-profile-section">
      <h2 className="text-base font-semibold text-foreground">Perfil público</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        O que aparece no diretório. As URLs precisam ser absolutas e usar http ou https.
      </p>

      <form action={action} className="mt-4 space-y-4" data-testid="tenant-profile-form">
        <input type="hidden" name="tenantId" value={tenantId} />

        <div>
          <label className={labelClass} htmlFor="profile-description">
            Apresentação
          </label>
          <textarea
            id="profile-description"
            name="description"
            rows={3}
            maxLength={600}
            value={values.description}
            onChange={(event) => setValues((c) => ({ ...c, description: event.target.value }))}
            data-testid="profile-description"
            className={inputClass}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="profile-logo">
              Logotipo (URL)
            </label>
            <input
              id="profile-logo"
              name="logoUrl"
              value={values.logoUrl}
              onChange={(event) => setValues((c) => ({ ...c, logoUrl: event.target.value }))}
              data-testid="profile-logo"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="profile-website">
              Site institucional (URL)
            </label>
            <input
              id="profile-website"
              name="websiteUrl"
              value={values.websiteUrl}
              onChange={(event) => setValues((c) => ({ ...c, websiteUrl: event.target.value }))}
              data-testid="profile-website"
              className={inputClass}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isPublic"
            checked={values.isPublic}
            onChange={(event) => setValues((c) => ({ ...c, isPublic: event.target.checked }))}
            data-testid="profile-is-public"
            className="size-4 rounded border-border"
          />
          Exibir no diretório público
        </label>

        <Submit
          label="Salvar perfil"
          pendingLabel="Salvando…"
          testId="profile-submit"
          icon={<ShieldCheck className="size-4" aria-hidden />}
        />
      </form>

      <Feedback state={state} testId="tenant-profile-feedback" />
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  SuperAdmins
// ───────────────────────────────────────────────────────────────────────────────
export function SuperAdminGrantForm() {
  const [state, action] = useActionState(grantSuperAdminAction, INITIAL);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <header className="flex items-center gap-2">
        <UserPlus className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">Conceder governança</h2>
      </header>
      <p className="mt-1 text-xs text-muted-foreground">
        SuperAdmin enxerga o painel de plataforma: provisiona, suspende e reativa instituições. Não
        é administrador das instituições — o papel de plataforma não dá acesso ao conteúdo delas.
      </p>

      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="grant-superadmin-form">
        <div>
          <label className={labelClass} htmlFor="grant-email">
            E-mail da pessoa
          </label>
          <input
            id="grant-email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="grant-email"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="grant-reason">
            Justificativa (opcional)
          </label>
          <input
            id="grant-reason"
            name="reason"
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="grant-reason"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <Submit
            label="Conceder SuperAdmin"
            pendingLabel="Concedendo…"
            testId="grant-submit"
            icon={<UserPlus className="size-4" aria-hidden />}
          />
        </div>
      </form>

      <Feedback state={state} testId="grant-feedback" />
    </section>
  );
}

export function RevokeSuperAdminButton({ userId }: { userId: string }) {
  const [state, action] = useActionState(revokeSuperAdminAction, INITIAL);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <Submit
        label="Revogar"
        pendingLabel="Revogando…"
        testId={`revoke-superadmin-${userId}`}
        variant="outline"
        icon={<Ban className="size-4" aria-hidden />}
      />
      {state && !state.ok ? (
        <span className="max-w-[16rem] text-right text-[11px] text-destructive">{state.message}</span>
      ) : null}
    </form>
  );
}
