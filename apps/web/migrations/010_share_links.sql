-- Link do show: quem tem o link vê o repertório do show e acompanha o ao vivo, sem precisar de conta.
-- Só leitura. O admin cria, troca ou desliga o link quando quiser.
ALTER TABLE setlists ADD COLUMN share_token text;
ALTER TABLE setlists ADD COLUMN share_created_at timestamptz;
CREATE UNIQUE INDEX setlists_share_token_idx ON setlists (share_token) WHERE share_token IS NOT NULL;
