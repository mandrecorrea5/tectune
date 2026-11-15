-- Folha do setlist: letra de 40% a 160% (antes até 100%) e o que mostrar (tom, BPM, artista…).
ALTER TABLE setlists DROP CONSTRAINT IF EXISTS setlists_cover_scale_check;
ALTER TABLE setlists ADD CONSTRAINT setlists_cover_scale_check CHECK (cover_scale = 0 OR cover_scale BETWEEN 40 AND 160);
ALTER TABLE setlists ADD COLUMN IF NOT EXISTS cover_opts jsonb NOT NULL DEFAULT '{}'::jsonb;
