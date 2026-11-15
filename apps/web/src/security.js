// Proteções para rodar em produção (atrás do Caddy + Cloudflare).
'use strict';

const PROD = process.env.NODE_ENV === 'production';

/** Cabeçalhos de segurança para todas as respostas. */
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!req.path.startsWith('/api/')) {
    // tudo é servido daqui mesmo: scripts, estilos, fontes e o PDF (blob:)
    res.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-src 'self' blob:",
      "object-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
  }
  next();
}

/**
 * CORS da API. O app mobile nativo não precisa de CORS; a versão web do app (outra origem) sim.
 * CORS_ORIGINS="https://a.com,https://b.com" restringe; vazio ou "*" libera (a API usa token, não cookie).
 */
function cors() {
  const list = String(process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const any = !list.length || list.includes('*');
  return (req, res, next) => {
    const origin = req.get('origin');
    if (any) res.set('Access-Control-Allow-Origin', '*');
    else if (origin && list.includes(origin)) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Band');
    res.set('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

/** Limite de requisições por IP numa janela de tempo (memória do processo). */
function rateLimit({ windowMs, max, message = 'Muitas requisições. Espere um pouco e tente de novo.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, Math.min(windowMs, 60_000)).unref();
  return (req, res, next) => {
    const key = req.ip || 'x';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start > windowMs) { h = { start: now, n: 0 }; hits.set(key, h); }
    h.n++;
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/** Log de acesso enxuto (uma linha por requisição da API), só em produção. */
function accessLog(req, res, next) {
  if (!PROD || !req.path.startsWith('/api/') || req.path === '/api/health') return next();
  const t = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
}

module.exports = { PROD, securityHeaders, cors, rateLimit, accessLog };
