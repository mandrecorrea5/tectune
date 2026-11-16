-- Confirmação de e-mail no cadastro: a conta só entra depois de clicar no link.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
-- contas que já existiam continuam entrando normalmente
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE email_verifications (
  token_hash text PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id);
