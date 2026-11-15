-- Permite fonte menor na folha: de 30% a 100% (antes 50%). 0 continua = automático.
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_font_scale_check;
ALTER TABLE songs ADD CONSTRAINT songs_font_scale_check CHECK (font_scale = 0 OR font_scale BETWEEN 30 AND 100);
