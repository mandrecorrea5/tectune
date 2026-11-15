#!/usr/bin/env bash
# Atualiza e sobe o Tectune na VPS. Rodar dentro da pasta do projeto (ex.: /opt/tectune).
#   bash scripts/deploy.sh            # puxa a main do git e sobe
#   bash scripts/deploy.sh --no-pull  # sobe o que já está na pasta
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ "${1:-}" != "--no-pull" ] && [ -d .git ]; then
  echo "==> git pull"
  git fetch --quiet origin main && git reset --hard origin/main
fi

# .env com senha forte na primeira vez
if [ ! -f .env ]; then
  echo "==> criando .env (senha do banco gerada agora)"
  cp .env.production.example .env
  pw=$(openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40)
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pw/" .env
  chmod 600 .env
fi
grep -q '^POSTGRES_PASSWORD=TROQUE' .env && { echo "troque POSTGRES_PASSWORD no .env" >&2; exit 1; }

if [ ! -s deploy/certs/origin.pem ] || [ ! -s deploy/certs/origin.key ]; then
  echo "faltam deploy/certs/origin.pem e origin.key (Origin Certificate da Cloudflare). Veja DEPLOY.md" >&2
  exit 1
fi
chmod 600 deploy/certs/origin.key 2>/dev/null || true

echo "==> faixas de IP da Cloudflare"
bash scripts/cloudflare-ips.sh || echo "   (mantendo a lista anterior)"
mkdir -p backups

echo "==> build e subida"
$COMPOSE build --pull app
$COMPOSE up -d --remove-orphans

echo "==> aguardando a aplicação responder"
for i in $(seq 1 30); do
  if $COMPOSE exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "   ok"; $COMPOSE ps; docker image prune -f >/dev/null; exit 0
  fi
  sleep 2
done
echo "a aplicação não respondeu; últimos logs:" >&2
$COMPOSE logs --tail 80 app >&2
exit 1
