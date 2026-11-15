// Mesma paleta do sistema web
export const C = {
  bg: '#ECE8E1',
  panel: '#F8F6F2',
  paper: '#FFFFFF',
  ink: '#1C1917',
  muted: '#78716C',
  line: '#DCD5CA',
  cell: '#F7F5F1',
  cellLine: '#D6CFC4',
  accent: '#C2410C',
  accentSoft: '#FDEEE6',
  ok: '#15803D',
  danger: '#DC2626',
  warn: '#E9A23B',
  tickOff: '#E4DDD3',
  tickOn: '#A39B92',
};

export function fmtDate(d) {
  if (!d) return '';
  const [Y, M, D] = String(d).slice(0, 10).split('-');
  return `${D}/${M}/${Y}`;
}
