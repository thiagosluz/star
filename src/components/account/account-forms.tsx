'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Monitor,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';

import { Alert, Button, ConfirmDialog, Field, Input } from '@/components/ui';
import { uploadAssetFile } from '@/components/admin/asset-upload';
import type { AccountActionState } from '@/app/actions/account-actions';
import {
  BACKUP_CODE_AMOUNT,
  PASSWORD_MIN_LENGTH,
  formatBackupCode,
  passwordHint,
} from '@/domain/account/account-rules';
import {
  IMAGE_INPUT_LABEL,
  MAX_IMAGE_BYTES,
  USER_AVATAR_TARGET,
  WEBP_STORAGE_NOTICE,
  formatBytes,
  webpSavingsLabel,
} from '@/domain/events/image-rules';
import type { AccountSession } from '@/domain/account/account-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ÁREA DE CONTA — formulários (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES FORMULÁRIOS NÃO FAZEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não guardam estado de segurança próprio: senha, código e token vão para o servidor
 *  e quem decide é a biblioteca de autenticação. A tela só MOSTRA o que voltou —
 *  inclusive os códigos de recuperação, que aparecem uma única vez porque o servidor
 *  guarda o hash deles.
 *
 *  A exceção é a normalização dos códigos digitados (espaço, hífen, caixa), que é
 *  feita no domínio e vale para os dois lados: quem digita do papel não deve ser
 *  recusado por causa de um espaço.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

type Action = (
  prev: AccountActionState | null,
  formData: FormData,
) => Promise<AccountActionState>;

function Feedback({ state, testId }: { state: AccountActionState | null; testId: string }) {
  if (!state) return null;

  const tone = state.ok ? 'success' : 'danger';

  return (
    <Alert tone={tone} data-testid={`${testId}-${state.ok ? 'ok' : 'error'}`}>
      <span>{state.message ?? (state.ok ? 'Pronto.' : 'Não foi possível concluir.')}</span>
      {state.details && state.details.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs">
          {state.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {state.code === 'SESSION_NOT_FRESH' ? (
        <span className="mt-2 block text-xs">
          <a className="underline underline-offset-4" href="/login?redirectTo=%2Fconta">
            Entrar novamente
          </a>{' '}
          e voltar para cá.
        </span>
      ) : null}
    </Alert>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Nome
// ───────────────────────────────────────────────────────────────────────────────
export function AccountProfileForm({
  currentName,
  action,
}: {
  currentName: string;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3" data-testid="account-profile-form">
      <Field
        name="account-name"
        label="Nome"
        hint="É o nome que aparece no seu perfil público, nos cartões de equipe e no certificado."
      >
        <Input
          id="account-name"
          name="name"
          defaultValue={currentName}
          required
          minLength={3}
          maxLength={160}
          autoComplete="name"
          data-testid="account-name"
        />
      </Field>

      <Feedback state={state} testId="account-profile-feedback" />

      <Button type="submit" disabled={pending} data-testid="save-account-profile">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Salvar nome
      </Button>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  E-mail
// ───────────────────────────────────────────────────────────────────────────────
export function AccountEmailForm({
  currentEmail,
  emailVerified,
  action,
}: {
  currentEmail: string;
  emailVerified: boolean;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3" data-testid="account-email-form">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">E-mail da conta</p>
        <p className="text-sm text-muted-foreground" data-testid="account-current-email">
          {currentEmail}
          {emailVerified ? (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-success-strong">
              <CheckCircle2 className="size-3" aria-hidden />
              confirmado
            </span>
          ) : (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="size-3" aria-hidden />
              ainda não confirmado
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          name="account-new-email"
          label="Novo e-mail"
          hint="Mandamos um link de confirmação para o endereço novo. Ele só passa a valer depois do clique."
        >
          <Input
            id="account-new-email"
            name="email"
            type="email"
            maxLength={255}
            autoComplete="email"
            data-testid="account-new-email"
          />
        </Field>

        <Field
          name="account-email-password"
          label="Sua senha atual"
          hint="Confirma que é você pedindo — é este endereço que recebe a redefinição de senha."
        >
          <Input
            id="account-email-password"
            name="password"
            type="password"
            maxLength={128}
            autoComplete="current-password"
            data-testid="account-email-password"
          />
        </Field>
      </div>

      <Feedback state={state} testId="account-email-feedback" />

      <Button type="submit" variant="outline" disabled={pending} data-testid="request-email-change">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Trocar e-mail
      </Button>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Foto
// ───────────────────────────────────────────────────────────────────────────────
export function AccountAvatarField({
  currentUrl,
  name,
  requestAction,
  confirmAction,
  removeAction,
}: {
  currentUrl: string | null;
  name: string;
  requestAction: Action;
  confirmAction: Action;
  removeAction: () => Promise<AccountActionState>;
}) {
  const [url, setUrl] = useState(currentUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: 'success' | 'danger' } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const maxBytes = MAX_IMAGE_BYTES[USER_AVATAR_TARGET];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setFeedback(null);

    const result = await uploadAssetFile({
      file,
      target: USER_AVATAR_TARGET,
      requestUploadAction: requestAction,
      confirmUploadAction: confirmAction,
    });

    setBusy(false);

    if (!result.ok) {
      setFeedback({ message: result.message, tone: 'danger' });
      return;
    }

    setUrl(result.url);

    const savings = webpSavingsLabel(result.sourceBytes, result.sizeBytes);
    setFeedback({
      message: `Foto atualizada e guardada em WebP (${formatBytes(result.sizeBytes)}${
        savings ? ` — ${savings}` : ''
      }).`,
      tone: 'success',
    });

    router.refresh();
  }

  async function handleRemove() {
    setBusy(true);
    setFeedback(null);

    const result = await removeAction();

    setBusy(false);

    if (!result.ok) {
      setFeedback({ message: result.message ?? 'Não foi possível remover.', tone: 'danger' });
      return;
    }

    setUrl('');
    setFeedback({ message: 'Foto removida da sua conta.', tone: 'success' });
    router.refresh();
  }

  return (
    <div className="space-y-3" data-testid="account-avatar-field">
      <div className="flex flex-wrap items-center gap-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- host do storage é dinâmico
          <img
            src={url}
            alt="Sua foto atual"
            width={72}
            height={72}
            className="size-18 rounded-full object-cover"
            data-testid="account-avatar-preview"
          />
        ) : (
          <span
            className="flex size-18 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
            data-testid="account-avatar-initials"
          >
            {initials || 'sem foto'}
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            data-testid="account-avatar-upload"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
            {url ? 'Trocar foto' : 'Enviar foto'}
          </Button>

          {url ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
              data-testid="account-avatar-remove"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remover
            </Button>
          ) : null}
        </div>

        <div className="min-w-52 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {IMAGE_INPUT_LABEL} · até {formatBytes(maxBytes)}
          </p>
          <p className="text-xs text-muted-foreground">{WEBP_STORAGE_NOTICE}</p>
        </div>
      </div>

      {/*
        O aviso de que a foto é pública não é rodapé: é a informação que a pessoa
        precisa para decidir. A matriz de visibilidade do perfil público decide se ela
        APARECE na página; a imagem em si fica no bucket público, e é honesto dizer.
      */}
      <p className="text-xs text-muted-foreground">
        A foto fica guardada para aparecer no seu perfil público e nos cartões de equipe. Quem
        decide se ela aparece na página é o campo <strong>Foto</strong> do seu perfil público —
        removê-la aqui tira o arquivo do servidor.
      </p>

      <input
        ref={fileRef}
        type="file"
        aria-label="Sua foto"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="sr-only"
        onChange={handleFile}
      />

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title="Remover a sua foto?"
        description="A imagem sai da sua conta e do servidor. O perfil público e os cartões de equipe passam a mostrar as iniciais."
        confirmLabel="Remover foto"
        testId="account-avatar-remove-dialog"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void handleRemove();
        }}
      />

      {feedback ? (
        <p
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
          data-testid="account-avatar-feedback"
          className={`flex items-start gap-1.5 text-xs ${
            feedback.tone === 'danger' ? 'text-destructive' : 'text-success-strong'
          }`}
        >
          {feedback.tone === 'danger' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Senha
// ───────────────────────────────────────────────────────────────────────────────
export function AccountPasswordForm({
  hasPassword,
  changeAction,
  setAction,
}: {
  hasPassword: boolean;
  changeAction: Action;
  setAction: Action;
}) {
  const [state, formAction, pending] = useActionState(hasPassword ? changeAction : setAction, null);

  return (
    <form action={formAction} className="space-y-3" data-testid="account-password-form">
      {hasPassword ? (
        <Field name="account-current-password" label="Senha atual">
          <Input
            id="account-current-password"
            name="currentPassword"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            data-testid="account-current-password"
          />
        </Field>
      ) : (
        /*
          Contas criadas por convite (e as do seed) não têm senha: elas entram por
          código de convite. Pedir "senha atual" aqui daria "senha incorreta" para
          sempre, e a pessoa não teria como entender por quê.
        */
        <Alert tone="info" data-testid="account-no-password">
          Sua conta ainda não tem senha — você entrou por convite. Defina uma agora para poder
          entrar com e-mail e senha.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="account-new-password" label="Senha nova" hint={passwordHint()}>
          <Input
            id="account-new-password"
            name="newPassword"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={128}
            autoComplete="new-password"
            data-testid="account-new-password"
          />
        </Field>

        <Field name="account-confirm-password" label="Repita a senha nova">
          <Input
            id="account-confirm-password"
            name="confirmation"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={128}
            autoComplete="new-password"
            data-testid="account-confirm-password"
          />
        </Field>
      </div>

      <Feedback state={state} testId="account-password-feedback" />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="save-account-password">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          {hasPassword ? 'Trocar senha' : 'Criar senha'}
        </Button>

        <a
          href="/esqueci-senha"
          className="text-xs text-muted-foreground underline underline-offset-4"
          data-testid="account-forgot-password"
        >
          Esqueci a minha senha
        </a>
      </div>

      {hasPassword ? (
        <p className="text-xs text-muted-foreground">
          Ao trocar a senha, as outras sessões abertas são encerradas — esta continua ativa.
        </p>
      ) : null}
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Segundo fator
// ───────────────────────────────────────────────────────────────────────────────
export function AccountTwoFactorPanel({
  enabled,
  hasPassword,
  startAction,
  confirmAction,
  disableAction,
  regenerateAction,
}: {
  enabled: boolean;
  hasPassword: boolean;
  startAction: Action;
  confirmAction: Action;
  disableAction: Action;
  regenerateAction: Action;
}) {
  const [startState, startFormAction, starting] = useActionState(startAction, null);
  const [confirmState, confirmFormAction, confirming] = useActionState(confirmAction, null);
  const [disableState, disableFormAction, disabling] = useActionState(disableAction, null);
  const [regenerateState, regenerateFormAction, regenerating] = useActionState(
    regenerateAction,
    null,
  );

  const setup = startState?.ok ? (startState.data ?? null) : null;
  const backupCodes = Array.isArray(setup?.backupCodes) ? (setup?.backupCodes as string[]) : [];
  const regenerated = Array.isArray(regenerateState?.data?.backupCodes)
    ? (regenerateState?.data?.backupCodes as string[])
    : [];

  if (!hasPassword) {
    return (
      <Alert tone="info" data-testid="two-factor-needs-password">
        Para ligar o segundo fator, defina uma senha primeiro (acima). O aplicativo autenticador é
        um segundo passo depois da senha — não um substituto dela.
      </Alert>
    );
  }

  if (!enabled && !setup) {
    return (
      <form action={startFormAction} className="space-y-3" data-testid="two-factor-start-form">
        <p className="text-sm text-muted-foreground">
          Com o segundo fator ligado, entrar passa a exigir também um número de seis dígitos gerado
          no seu celular. É a proteção que vale mesmo se a sua senha vazar.
        </p>

        <Field name="two-factor-password" label="Confirme a sua senha">
          <Input
            id="two-factor-password"
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            data-testid="two-factor-password"
          />
        </Field>

        <Feedback state={startState} testId="two-factor-start-feedback" />

        <Button type="submit" disabled={starting} data-testid="two-factor-start">
          {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
          Configurar aplicativo autenticador
        </Button>
      </form>
    );
  }

  if (!enabled && setup) {
    return (
      <div className="space-y-4" data-testid="two-factor-setup">
        <div className="flex flex-wrap items-start gap-4">
          {typeof setup.qrDataUrl === 'string' ? (
            // eslint-disable-next-line @next/next/no-img-element -- QR gerado no servidor (data URL)
            <img
              src={setup.qrDataUrl}
              alt="QR code para configurar o aplicativo autenticador"
              width={160}
              height={160}
              className="size-40 rounded-md border border-border bg-surface-low p-2"
              data-testid="two-factor-qr"
            />
          ) : null}

          <div className="min-w-52 space-y-1.5 text-sm">
            <p className="font-medium">1. Escaneie o código</p>
            <p className="text-xs text-muted-foreground">
              Abra o aplicativo autenticador (Google Authenticator, Authy, 1Password…) e leia o QR.
              Se preferir digitar, a chave é:
            </p>
            <code
              className="block rounded bg-surface-low px-2 py-1 text-xs break-all"
              data-testid="two-factor-manual-key"
            >
              {typeof setup.manualKey === 'string' ? setup.manualKey : '—'}
            </code>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">2. Guarde os códigos de recuperação</p>
          <p className="text-xs text-muted-foreground">
            Eles aparecem <strong>uma única vez</strong>. Cada um entra no lugar do código do
            aplicativo — é o caminho de volta se você perder o celular.
          </p>
          <ul
            className="grid grid-cols-2 gap-1 rounded-md border border-border bg-surface-low p-3 font-mono text-xs sm:grid-cols-3"
            data-testid="two-factor-backup-codes"
          >
            {backupCodes.map((code) => (
              <li key={code} data-testid="two-factor-backup-code">
                {formatBackupCode(code)}
              </li>
            ))}
          </ul>
        </div>

        <form action={confirmFormAction} className="space-y-3" data-testid="two-factor-confirm-form">
          <p className="text-sm font-medium">3. Confirme com o número do aplicativo</p>

          <Field
            name="two-factor-code"
            label="Código de seis dígitos"
            hint="Enquanto o código não for confirmado, o segundo fator NÃO está ativo."
          >
            <Input
              id="two-factor-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              className="max-w-40 font-mono"
              data-testid="two-factor-code"
            />
          </Field>

          <Feedback state={confirmState} testId="two-factor-confirm-feedback" />

          <Button type="submit" disabled={confirming} data-testid="two-factor-confirm">
            {confirming ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Ativar segundo fator
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="two-factor-enabled">
      <p className="flex items-center gap-2 text-sm text-success-strong" data-testid="two-factor-status">
        <ShieldCheck className="size-4" aria-hidden />
        Segundo fator ativo nesta conta.
      </p>

      <form action={regenerateFormAction} className="space-y-3" data-testid="two-factor-regenerate-form">
        <Field
          name="two-factor-regen-password"
          label="Gerar códigos de recuperação novos"
          hint={`Os ${BACKUP_CODE_AMOUNT} códigos atuais deixam de funcionar assim que os novos forem gerados.`}
        >
          <Input
            id="two-factor-regen-password"
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            data-testid="two-factor-regenerate-password"
          />
        </Field>

        <Feedback state={regenerateState} testId="two-factor-regenerate-feedback" />

        <Button type="submit" variant="outline" disabled={regenerating} data-testid="two-factor-regenerate">
          {regenerating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Gerar códigos novos
        </Button>

        {regenerated.length > 0 ? (
          <ul
            className="grid grid-cols-2 gap-1 rounded-md border border-border bg-surface-low p-3 font-mono text-xs sm:grid-cols-3"
            data-testid="two-factor-new-backup-codes"
          >
            {regenerated.map((code) => (
              <li key={code}>{formatBackupCode(code)}</li>
            ))}
          </ul>
        ) : null}
      </form>

      <form action={disableFormAction} className="space-y-3 border-t border-border pt-4" data-testid="two-factor-disable-form">
        <Field
          name="two-factor-disable-password"
          label="Desligar o segundo fator"
          hint="A conta volta a entrar só com a senha. Confirme com a sua senha."
        >
          <Input
            id="two-factor-disable-password"
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            data-testid="two-factor-disable-password"
          />
        </Field>

        <Feedback state={disableState} testId="two-factor-disable-feedback" />

        <Button type="submit" variant="outline" disabled={disabling} data-testid="two-factor-disable">
          {disabling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Desligar segundo fator
        </Button>
      </form>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Sessões
// ───────────────────────────────────────────────────────────────────────────────
export function AccountSessionsList({
  sessions,
  revokeAction,
  revokeOthersAction,
}: {
  sessions: readonly AccountSession[];
  revokeAction: Action;
  revokeOthersAction: () => Promise<AccountActionState>;
}) {
  const [state, setState] = useState<AccountActionState | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const router = useRouter();

  const others = sessions.filter((session) => !session.isCurrent);

  async function revoke(token: string) {
    setBusyToken(token);
    setState(null);

    const formData = new FormData();
    formData.set('token', token);
    const result = await revokeAction(null, formData);

    setBusyToken(null);
    setState(result);

    if (result.ok) router.refresh();
  }

  async function revokeOthers() {
    setBusyToken('others');
    setState(null);

    const result = await revokeOthersAction();

    setBusyToken(null);
    setState(result);

    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-3" data-testid="account-sessions">
      <ul className="space-y-2">
        {sessions.map((session) => (
          <li
            key={session.token}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            data-testid="account-session"
            data-current={String(session.isCurrent)}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-2 text-sm">
                <Monitor className="size-3.5 text-muted-foreground" aria-hidden />
                {session.browser} · {session.device}
                {session.isCurrent ? (
                  <span className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-brand">
                    este dispositivo
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Último uso em {formatMoment(session.lastUsedAt)}
                {session.ipAddress ? ` · ${session.ipAddress}` : ''}
              </p>
            </div>

            {session.isCurrent ? (
              <span className="text-xs text-muted-foreground">
                Para sair deste dispositivo, use “Sair da conta”.
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyToken !== null}
                onClick={() => revoke(session.token)}
                data-testid="account-session-revoke"
              >
                {busyToken === session.token ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>

      {others.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busyToken !== null}
          onClick={revokeOthers}
          data-testid="account-sessions-revoke-others"
        >
          {busyToken === 'others' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Encerrar as {others.length} outras sessões
        </Button>
      ) : null}

      <Feedback state={state} testId="account-sessions-feedback" />
    </div>
  );
}

/** Data legível no fuso do navegador — a tela fala com quem está do outro lado. */
function formatMoment(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
