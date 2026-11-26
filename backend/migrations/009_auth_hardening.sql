BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_domain_normalized
    ON public.users ((left(email, strpos(email, '@')) || lower(substr(email, strpos(email, '@') + 1))));
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_nfc
    ON public.users (normalize(username));

CREATE TABLE IF NOT EXISTS public.account_revoked_sessions (
    digest varchar(64) PRIMARY KEY,
    expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_account_revoked_sessions_expires_at
    ON public.account_revoked_sessions (expires_at);
ALTER TABLE public.account_revoked_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.account_auth_attempts (
    digest varchar(64) PRIMARY KEY,
    count integer NOT NULL,
    expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_account_auth_attempts_expires_at
    ON public.account_auth_attempts (expires_at);
ALTER TABLE public.account_auth_attempts ENABLE ROW LEVEL SECURITY;

COMMIT;
