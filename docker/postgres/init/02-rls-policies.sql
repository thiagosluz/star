-- ═══════════════════════════════════════════════════════════════════════════════
--  02-rls-policies.sql — Row-Level Security: a fronteira de isolamento
--
--  ESTE ARQUIVO É A FONTE DA VERDADE DAS POLICIES DE RLS.
--  Ele é idempotente e reaplicável. Depois de QUALQUER migração que crie uma
--  tabela nova com coluna `tenant_id`, adicione a tabela à lista abaixo e rode:
--
--      npm run db:rls
--
--  ─────────────────────────────────────────────────────────────────────────────
--  CONTRATO DE CONTEXTO
--  ─────────────────────────────────────────────────────────────────────────────
--  A aplicação define, NO INÍCIO DE CADA TRANSAÇÃO:
--
--      SET LOCAL app.tenant_id = '<uuid-do-tenant>';
--
--  `SET LOCAL` é desfeito automaticamente no COMMIT/ROLLBACK, então a conexão
--  volta ao pool sem contexto — não há vazamento entre requisições.
--
--  A função `app.current_tenant_id()` lê esse valor. Quando o contexto NÃO está
--  definido (ex.: migrations, seed, jobs de sistema) ela retorna NULL — e como
--  `tenant_id = NULL` nunca é verdadeiro, TODAS as linhas ficam invisíveis.
--  Isso é "fail-closed": esquecer de definir o contexto resulta em zero dados,
--  nunca em dados de outro tenant.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE RLS E NÃO "só lembrar do WHERE tenant_id = ..."
--  ─────────────────────────────────────────────────────────────────────────────
--  Porque um único `findMany()` sem filtro, um JOIN esquecido ou um novo
--  desenvolvedor no time viram um vazamento de dados entre instituições. Com
--  RLS a garantia vive no banco, não na disciplina do código de aplicação.
-- ═══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ═══════════════════════════════════════════════════════════════════════════════
--  0. GUARDA DE ORDENAÇÃO (SQL puro, sem meta-comandos)
-- ═══════════════════════════════════════════════════════════════════════════════
--  Este arquivo é executado em DOIS momentos diferentes:
--
--    (a) No primeiro boot do container PostgreSQL, via
--        /docker-entrypoint-initdb.d. Nesse instante as tabelas AINDA NÃO
--        EXISTEM — o DDL é responsabilidade do Prisma Migrate, que roda depois.
--        Sem esta guarda, o script abortaria (ON_ERROR_STOP) e derrubaria a
--        inicialização do banco.
--
--    (b) Depois de `prisma migrate deploy`, via `npm run db:rls`. É aqui que a
--        RLS é de fato aplicada.
--
--  A guarda é escrita em SQL puro (nada de \if / \quit) porque o script também
--  é executado pelo driver `pg` a partir de prisma/scripts/apply-rls.mjs, que
--  não interpreta meta-comandos do psql. Cada seção abaixo decide sozinha se
--  deve agir, consultando a existência das tabelas via to_regclass().
DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '  [ADIADO] As tabelas ainda nao existem (o DDL vem do Prisma Migrate).';
    RAISE NOTICE '           A RLS NAO foi aplicada nesta etapa.';
    RAISE NOTICE '           Execute agora:  npm run db:migrate && npm run db:rls';
    RAISE NOTICE '';
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
--  1. Função de leitura do contexto
-- ═══════════════════════════════════════════════════════════════════════════════
--  SECURITY INVOKER (padrão) + STABLE: pode ser inlined pelo planner.
--  `true` no segundo argumento de current_setting = missing_ok.
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app_current_tenant_id() IS
  'Retorna o tenant da transacao corrente (app.tenant_id) ou NULL. Base das policies de RLS.';

REVOKE ALL ON FUNCTION app_current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO eventflow_app;

-- ═══════════════════════════════════════════════════════════════════════════════
--  2. Habilitar RLS — parte 1: isolamento por tenant_id
-- ═══════════════════════════════════════════════════════════════════════════════
--  `ENABLE` liga a RLS para roles comuns.
--  `FORCE` estende a RLS ao DONO da tabela (eventflow_admin). Sem FORCE, um bug
--  que fizesse a aplicação conectar como admin passaria por cima de tudo.
--  Superuser continua imune — por isso migrations e seed funcionam.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'user_tenant_profiles',
    'role_assignments',
    'events',
    'rooms',
    'activities',
    'activity_speakers',
    'event_pages',
    'page_blocks',
    'sponsor_tiers',
    'sponsors',
    'registrations',
    'attendances',
    'tracks',
    'submissions',
    'submission_authors',
    'submission_files',
    'review_assignments',
    'reviews',
    'review_conflicts',
    'card_templates',
    'user_cards',
    'user_xp_profiles',
    'xp_transactions',
    'task_definitions',
    'user_task_progress',
    'certificates',
    'audit_logs',
    'reviewer_expertise',
    'reviewer_conflict_declarations'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- Tabelas que ainda não existem são simplesmente puladas: permite rodar este
    -- arquivo no boot do container (antes do Prisma Migrate) sem abortar.
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  RAISE NOTICE '[OK] RLS habilitada/garantida nas tabelas de tenant existentes.';
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
--  3. Policy padrão de isolamento
-- ═══════════════════════════════════════════════════════════════════════════════
--  Uma única policy PERMISSIVE cobrindo todos os comandos via FOR ALL.
--  USING      -> quais linhas EXISTENTES são visíveis (SELECT/UPDATE/DELETE)
--  WITH CHECK -> quais linhas NOVAS são aceitas (INSERT/UPDATE)
--
--  `tenant_id = app_current_tenant_id()`:
--    • contexto definido  -> vê e escreve APENAS o próprio tenant
--    • contexto ausente   -> NULL, nenhuma linha visível, nenhum INSERT aceito
--
--  Tabelas com `tenant_id` anulável (card_templates.event_id, por exemplo) são
--  cobertas porque a coluna tenant_id é NOT NULL em todas, garantido no schema.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'user_tenant_profiles','role_assignments','events','rooms','activities',
    'activity_speakers','event_pages','page_blocks','sponsor_tiers','sponsors',
    'registrations','attendances','tracks','submissions','submission_authors',
    'submission_files','review_assignments','reviews','review_conflicts',
    'card_templates','user_cards','user_xp_profiles','xp_transactions',
    'task_definitions','user_task_progress','certificates','audit_logs',
    'reviewer_expertise','reviewer_conflict_declarations'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO eventflow_app
        USING ("tenantId" = app_current_tenant_id())
        WITH CHECK ("tenantId" = app_current_tenant_id())
    $f$, t);
  END LOOP;
  RAISE NOTICE '[OK] policy tenant_isolation garantida nas tabelas de tenant existentes.';
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
--  4. Isolamento da identidade global (`user` e `session`)
-- ═══════════════════════════════════════════════════════════════════════════════
--  `user` é GLOBAL por decisão de arquitetura (ADR-002): a mesma pessoa pode ser
--  participante na UFBA e palestrante na FIOCRUZ sem duplicar cadastro.
--  Portanto NÃO usamos tenant_id aqui. O que protegemos é outro vetor: uma query
--  sem contexto de tenant não pode varrer a base de pessoas inteira.
--
--  Não aplicamos RLS em `account` nem `verification`: são tabelas operadas
--  exclusivamente pela biblioteca de autenticação, que já as escopa por
--  userId/identifier, e a RLS ali quebraria o fluxo de login (que ocorre,
--  por definição, ANTES de existir um tenant ativo).
DO $$
DECLARE
  t text;
  identity_tables text[] := ARRAY['user', 'session'];
BEGIN
  FOREACH t IN ARRAY identity_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Se as tabelas de identidade ainda não existem (boot do container, antes do
  -- Prisma Migrate), não há policy a criar.
  IF to_regclass('public."user"') IS NULL OR to_regclass('public."session"') IS NULL THEN
    RAISE NOTICE '[ADIADO] Tabelas "user"/"session" ausentes: policies de identidade nao aplicadas.';
    RETURN;
  END IF;

  -- Com contexto de tenant ativo: permite CRUD de identidade (listar membros,
  -- convidar, atualizar perfil). O escopo fino é responsabilidade da aplicação.
  DROP POLICY IF EXISTS identity_with_tenant_context ON public."user";
  CREATE POLICY identity_with_tenant_context ON public."user"
    FOR ALL
    TO eventflow_app
    USING (app_current_tenant_id() IS NOT NULL)
    WITH CHECK (app_current_tenant_id() IS NOT NULL);

  -- Sem contexto: apenas o fluxo de autenticação. Somente SELECT/INSERT/UPDATE
  -- são permitidos (nunca DELETE de pessoas), e a aplicação restringe por
  -- id/email. Isso é o mínimo necessário para login funcionar.
  DROP POLICY IF EXISTS identity_auth_flow ON public."user";
  CREATE POLICY identity_auth_flow ON public."user"
    FOR SELECT
    TO eventflow_app
    USING (app_current_tenant_id() IS NULL);

  DROP POLICY IF EXISTS identity_auth_flow_insert ON public."user";
  CREATE POLICY identity_auth_flow_insert ON public."user"
    FOR INSERT
    TO eventflow_app
    WITH CHECK (app_current_tenant_id() IS NULL);

  DROP POLICY IF EXISTS identity_auth_flow_update ON public."user";
  CREATE POLICY identity_auth_flow_update ON public."user"
    FOR UPDATE
    TO eventflow_app
    USING (app_current_tenant_id() IS NULL)
    WITH CHECK (app_current_tenant_id() IS NULL);

  -- Sessões: só o próprio fluxo de auth. Sem contexto OU com contexto (o
  -- acesso já é mediado pelo token opaco da sessão).
  DROP POLICY IF EXISTS session_access ON public."session";
  CREATE POLICY session_access ON public."session"
    FOR ALL
    TO eventflow_app
    USING (true)
    WITH CHECK (true);

  RAISE NOTICE '[OK] policies de identidade aplicadas em: user, session.';
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
--  5. `tenants` — catálogo de instituições
-- ═══════════════════════════════════════════════════════════════════════════════
--  A tabela `tenants` é lida pelo middleware ANTES de existir contexto de
--  tenant (é justamente o que resolve slug -> id). Por isso a policy permite
--  leitura; a aplicação restringe a UMA linha por slug/domínio e NUNCA expõe a
--  listagem. Escrita é sempre mediada por fluxo administrativo.
DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE NOTICE '[ADIADO] Tabela tenants ausente: policies nao aplicadas.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS tenant_resolution_read ON public.tenants';
  EXECUTE $f$
    CREATE POLICY tenant_resolution_read ON public.tenants
      FOR SELECT
      TO eventflow_app
      USING (true)
  $f$;

  EXECUTE 'DROP POLICY IF EXISTS tenant_self_update ON public.tenants';
  EXECUTE $f$
    CREATE POLICY tenant_self_update ON public.tenants
      FOR UPDATE
      TO eventflow_app
      USING (id = app_current_tenant_id())
      WITH CHECK (id = app_current_tenant_id())
  $f$;

  -- Sem INSERT/DELETE: criação e remoção de instituição são operações de
  -- plataforma (role admin), não do runtime da aplicação.

  RAISE NOTICE '[OK] policies de tenants aplicadas.';
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
--  6. ASSERTIVAS — provamos que a RLS realmente isola
-- ═══════════════════════════════════════════════════════════════════════════════
--  Este bloco falha o provisionamento se qualquer premissa for violada — melhor
--  descobrir agora do que em produção.
DO $$
DECLARE
  v_missing_rls   text;
  v_missing_force text;
  v_no_policy     text;
  v_super         boolean;
  v_bypass        boolean;
BEGIN
  -- 6.1 Toda tabela com a coluna de tenant precisa ter RLS habilitada.
  --     Atenção: o Prisma gera a coluna como "tenantId" (camelCase, entre
  --     aspas). O banco é case-sensitive para identificadores citados.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenantId' AND a.attnum > 0
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF v_missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: tabelas com tenantId SEM RLS habilitada: %', v_missing_rls;
  END IF;

  -- 6.2 RLS habilitada mas sem FORCE deixa o dono da tabela escapar.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing_force
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenantId' AND a.attnum > 0
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity
    AND NOT c.relforcerowsecurity;

  IF v_missing_force IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: RLS sem FORCE ROW LEVEL SECURITY em: %', v_missing_force;
  END IF;

  -- 6.3 RLS habilitada sem nenhuma policy = bloqueio total (fail-closed).
  --     Denuncia tabela nova esquecida de receber a policy.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_no_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);

  IF v_no_policy IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: tabelas com RLS habilitada e NENHUMA policy: %', v_no_policy;
  END IF;

  -- 6.4 A role de runtime precisa existir e ser incapaz de ignorar RLS.
  SELECT rolsuper, rolbypassrls INTO v_super, v_bypass
  FROM pg_roles WHERE rolname = 'eventflow_app';

  IF v_super IS NULL THEN
    RAISE EXCEPTION 'FALHA: role eventflow_app nao existe.';
  END IF;
  IF v_super OR v_bypass THEN
    RAISE EXCEPTION 'FALHA DE SEGURANCA: eventflow_app superuser=% bypassrls=%.', v_super, v_bypass;
  END IF;

  -- 6.5 A função de contexto não pode ter sido sequestrada por search_path.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'app_current_tenant_id' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'FALHA: funcao app_current_tenant_id() ausente.';
  END IF;

  RAISE NOTICE '[OK] RLS verificada: isolamento fail-closed ativo em todas as tabelas de tenant.';
END
$$;
