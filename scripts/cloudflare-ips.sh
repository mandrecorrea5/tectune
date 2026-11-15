#!/usr/bin/env bash
# Baixa as faixas de IP da Cloudflare e grava em deploy/cloudflare.env (lido pelo Caddy).
# Com isso o Caddy: 1) confia no IP real do visitante enviado pela Cloudflare;
#                   2) derruba quem tenta acessar a VPS direto pelo IP, sem passar pela Cloudflare.
set -euo pipefail
cd "$(dirname "$0")/.."
v4=$(curl -fsS https://www.cloudflare.com/ips-v4)
v6=$(curl -fsS https://www.cloudflare.com/ips-v6)
ips=$(printf '%s\n%s\n' "$v4" "$v6" | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' | tr '\n' ' ' | sed 's/ $//')
[ -n "$ips" ] || { echo "não consegui baixar as faixas da Cloudflare" >&2; exit 1; }
echo "CF_IPS=$ips" > deploy/cloudflare.env
echo "deploy/cloudflare.env atualizado ($(echo "$ips" | wc -w) faixas)"
