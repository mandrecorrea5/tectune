-- Folha do setlist (capa do PDF do show): tamanho e visualização, por setlist.
-- cover_scale: 0 = automático (maior tamanho que cabe em 1 folha); 40 a 100 = porcentagem.
-- cover_layout: detalhada (título + artista) | compacta (uma linha por música) | colunas (compacta em 2 colunas)
ALTER TABLE setlists ADD COLUMN cover_scale smallint NOT NULL DEFAULT 0
  CHECK (cover_scale = 0 OR cover_scale BETWEEN 40 AND 100);
ALTER TABLE setlists ADD COLUMN cover_layout text NOT NULL DEFAULT 'detalhada'
  CHECK (cover_layout IN ('detalhada', 'compacta', 'colunas'));
