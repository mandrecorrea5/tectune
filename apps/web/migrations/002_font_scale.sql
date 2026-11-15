-- Tamanho da cifra na folha, por música.
-- 0 = automático (maior tamanho que cabe em 1 folha); 50 a 100 = porcentagem fixa.
ALTER TABLE songs
  ADD COLUMN font_scale smallint NOT NULL DEFAULT 100
  CHECK (font_scale = 0 OR font_scale BETWEEN 50 AND 100);
