-- E-mail transacional: recuperação de senha e convite para quem ainda não tem conta.

-- link de redefinição de senha (guardamos só o hash do token; vale 1 hora, uso único)
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- convite por e-mail para quem ainda não tem conta: ao se cadastrar com esse e-mail,
-- vira um convite normal (band_invites) que a pessoa aceita ou recusa
CREATE TABLE band_email_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id    uuid        NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX band_email_invites_uniq ON band_email_invites (band_id, lower(email));
CREATE INDEX band_email_invites_email_idx ON band_email_invites (lower(email));
