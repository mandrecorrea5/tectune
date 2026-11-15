-- Sincronização bidirecional com o app mobile (offline-first).
-- rev_at: momento (relógio do servidor) da última gravação de cada linha — usado para
--         buscar "o que mudou desde a última sincronização".
-- tombstones: registro das exclusões, para os aparelhos apagarem também.

ALTER TABLE songs    ADD COLUMN rev_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE setlists ADD COLUMN rev_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE INDEX songs_rev_idx    ON songs (rev_at);
CREATE INDEX setlists_rev_idx ON setlists (rev_at);

CREATE FUNCTION touch_rev() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.rev_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER songs_touch_rev    BEFORE INSERT OR UPDATE ON songs    FOR EACH ROW EXECUTE FUNCTION touch_rev();
CREATE TRIGGER setlists_touch_rev BEFORE INSERT OR UPDATE ON setlists FOR EACH ROW EXECUTE FUNCTION touch_rev();

-- mudar a ordem/lista de músicas de uma setlist conta como alteração da setlist
CREATE FUNCTION touch_setlist_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE setlists SET rev_at = clock_timestamp()
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.setlist_id ELSE NEW.setlist_id END;
  RETURN NULL;
END $$;
CREATE TRIGGER setlist_songs_touch AFTER INSERT OR DELETE ON setlist_songs FOR EACH ROW EXECUTE FUNCTION touch_setlist_order();

CREATE TABLE tombstones (
  entity     text        NOT NULL CHECK (entity IN ('song', 'setlist')),
  id         uuid        NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (entity, id)
);
CREATE INDEX tombstones_deleted_idx ON tombstones (deleted_at);

-- toda exclusão (pelo web ou pela sincronização) vira um registro em tombstones
CREATE FUNCTION record_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tombstones (entity, id, deleted_at) VALUES (TG_ARGV[0], OLD.id, clock_timestamp())
  ON CONFLICT (entity, id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at;
  RETURN NULL;
END $$;
CREATE TRIGGER songs_tombstone    AFTER DELETE ON songs    FOR EACH ROW EXECUTE FUNCTION record_tombstone('song');
CREATE TRIGGER setlists_tombstone AFTER DELETE ON setlists FOR EACH ROW EXECUTE FUNCTION record_tombstone('setlist');

-- se um registro com o mesmo id voltar a existir, a exclusão antiga deixa de valer
CREATE FUNCTION clear_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM tombstones WHERE entity = TG_ARGV[0] AND id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER songs_clear_tombstone    AFTER INSERT ON songs    FOR EACH ROW EXECUTE FUNCTION clear_tombstone('song');
CREATE TRIGGER setlists_clear_tombstone AFTER INSERT ON setlists FOR EACH ROW EXECUTE FUNCTION clear_tombstone('setlist');
