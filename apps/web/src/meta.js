// Extrai o cabeçalho (título, artista, tom, bpm) do texto da cifra,
// para listar e buscar músicas sem precisar ler o conteúdo inteiro.
const KEYS = {
  titulo: 'title', title: 'title', musica: 'title',
  artista: 'artist', banda: 'artist', autor: 'artist',
  tom: 'song_key', key: 'song_key',
  bpm: 'bpm', andamento: 'bpm',
};
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function extractMeta(content) {
  const meta = { title: null, artist: null, song_key: null, bpm: null };
  for (const raw of String(content || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) break; // cabeçalho termina na primeira seção
    const m = line.match(/^([A-Za-zÀ-ÿçÇ]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = KEYS[norm(m[1])];
    const v = m[2].trim();
    if (k && v && !meta[k]) meta[k] = v.slice(0, 200);
  }
  if (!meta.title) meta.title = 'Sem título';
  return meta;
}

module.exports = { extractMeta };
