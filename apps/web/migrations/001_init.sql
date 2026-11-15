-- Biblioteca de músicas: cada cifra existe uma vez e pode entrar em várias setlists
CREATE TABLE songs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL DEFAULT 'Sem título',
  artist      text,
  song_key    text,
  bpm         text,
  content     text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX songs_title_idx ON songs (lower(title));

-- Setlists (shows)
CREATE TABLE setlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  event_date  date,
  venue       text,
  notes       text,
  cols        smallint    NOT NULL DEFAULT 4 CHECK (cols IN (4, 6, 8)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Ordem das músicas em cada setlist
CREATE TABLE setlist_songs (
  id          bigserial PRIMARY KEY,
  setlist_id  uuid NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  song_id     uuid NOT NULL REFERENCES songs(id)    ON DELETE CASCADE,
  position    integer NOT NULL
);
CREATE INDEX setlist_songs_setlist_idx ON setlist_songs (setlist_id, position);
CREATE INDEX setlist_songs_song_idx ON setlist_songs (song_id);
