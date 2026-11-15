import { Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { chordParts, isRest, REST_PTS } from '@tectune/core';
import { C } from '../lib/theme';

// proporções das partes do acorde em relação ao tamanho base
const REL = { root: 1, acc: 0.58, mi: 0.8, q: 0.55, bs: 0.72 };
const CHAR_W = 0.62; // largura média de um caractere em negrito (fração do tamanho da fonte)

/** Largura estimada do acorde no tamanho `size` (para encolher quando não cabe). */
export function tokenWidth(tok, size) {
  if (tok === '%' || tok === '/' || tok === '.' || tok === '_') return 0;
  if (isRest(tok)) return size * 0.5;
  const parts = chordParts(tok);
  if (!parts) return tok.length * size * 0.55 * CHAR_W;
  return parts.reduce((w, p) => w + p.s.length * size * REL[p.k] * CHAR_W, 0);
}

const pts = REST_PTS.map(p => p.join(',')).join(' ');
export function RestIcon({ size, color = C.ink }) {
  const h = size * 1.15;
  return (
    <Svg width={(h * 12) / 28} height={h} viewBox="0 0 12 28">
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function Chord({ tok, size, color = C.ink }) {
  if (tok === '_') return null;
  if (tok === '%') return <Text style={{ fontSize: size * 1.05, fontWeight: '700', color: '#A8A29E' }}>%</Text>;
  if (tok === '/' || tok === '.') return <Text style={{ fontSize: size * 0.95, color: '#B5AEA5' }}>/</Text>;
  if (isRest(tok)) return <RestIcon size={size} color={color} />;
  const parts = chordParts(tok);
  if (!parts) return <Text numberOfLines={1} style={{ fontSize: size * 0.55, fontWeight: '700', color }}>{tok}</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      {parts.map((p, i) => {
        const fs = size * REL[p.k];
        const sup = p.k === 'acc' || p.k === 'q';
        return (
          <Text
            key={i}
            style={{
              fontSize: fs,
              lineHeight: sup ? fs * 1.05 : size * 1.12,
              fontWeight: p.k === 'q' || p.k === 'bs' ? '700' : '800',
              color,
              alignSelf: sup ? 'flex-start' : 'flex-end',
              marginTop: sup ? size * 0.04 : 0,
              letterSpacing: -0.2,
            }}
          >
            {p.s}
          </Text>
        );
      })}
    </View>
  );
}
