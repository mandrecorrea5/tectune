-- Contas, login e bandas. Cada banda tem seu próprio repertório (músicas e setlists).
-- Admins da banda editam; membros só visualizam, tocam o Show e acompanham o ao vivo.

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL,
  name       text        NOT NULL,
  pass_hash  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

-- sessões de login (guardamos só o hash do token)
CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE bands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE band_members (
  band_id   uuid NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('admin', 'membro')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (band_id, user_id)
);
CREATE INDEX band_members_user_idx ON band_members (user_id);

-- convite para quem já tem conta; a pessoa aceita ou recusa
CREATE TABLE band_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id    uuid NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (band_id, user_id)
);

-- repertório pertence a uma banda (os dados que já existem vão para a 1ª banda criada)
ALTER TABLE songs    ADD COLUMN band_id uuid REFERENCES bands(id) ON DELETE CASCADE;
ALTER TABLE setlists ADD COLUMN band_id uuid REFERENCES bands(id) ON DELETE CASCADE;
ALTER TABLE tombstones ADD COLUMN band_id uuid;
CREATE INDEX songs_band_rev_idx      ON songs (band_id, rev_at);
CREATE INDEX setlists_band_rev_idx   ON setlists (band_id, rev_at);
CREATE INDEX tombstones_band_idx     ON tombstones (band_id, deleted_at);

-- exclusões passam a guardar de qual banda eram (para cada banda só ver as suas)
CREATE OR REPLACE FUNCTION record_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tombstones (entity, id, deleted_at, band_id) VALUES (TG_ARGV[0], OLD.id, clock_timestamp(), OLD.band_id)
  ON CONFLICT (entity, id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at, band_id = EXCLUDED.band_id;
  RETURN NULL;
END $$;
