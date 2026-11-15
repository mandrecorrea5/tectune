#!/usr/bin/env bash
# /usr/local/bin/tectune-deploy — comando forçado do deploy via GitHub Actions.
#
# Instalação (na VPS, como root, uma vez — e de novo sempre que este arquivo mudar):
#   install -m 755 -o root -g root /srv/apps/tectune/deploy/remote-deploy.sh /usr/local/bin/tectune-deploy
#
# A chave do CI entra como usuário `deploy` (o mesmo dos outros sites da VPS),
# em ~deploy/.ssh/authorized_keys, travada neste script:
#   restrict,command="/usr/local/bin/tectune-deploy" ssh-ed25519 AAAA... github-actions-tectune
#
# Uso (feito pelo workflow):        ssh deploy@host "deploy <sha-completo>"
# Uso manual, logado na VPS:        SSH_ORIGINAL_COMMAND="deploy $(git -C /srv/apps/tectune rev-parse origin/main)" tectune-deploy
#
# O script:
#   1. valida o argumento (nada além de "deploy <sha>" é aceito);
#   2. trava contra deploys concorrentes;
#   3. faz um backup antes de subir código novo (as migrations rodam no start);
#   4. posiciona o repositório no SHA pedido, sobe a stack e espera o app ficar healthy;
#   5. instala o snippet do Caddy e recarrega o ingress;
#   6. em falha, volta para o SHA anterior.

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/apps/tectune}"
LOCK_FILE="${LOCK_FILE:-/var/lock/tectune-deploy.lock}"
STATE_FILE="$APP_DIR/.deploy-state"
APP_CONTAINER="${APP_CONTAINER:-tectune-app}"
BACKUP_CONTAINER="${BACKUP_CONTAINER:-tectune-backup}"

log() { printf '%s [tectune-deploy] %s\n' "$(date -u +%FT%TZ)" "$*"; }

COMMAND="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$COMMAND" =~ ^deploy[[:space:]]+([0-9a-f]{7,40})$ ]]; then
  log "comando recusado: '${COMMAND}'"
  exit 2
fi
SHA="${BASH_REMATCH[1]}"

cd "$APP_DIR" || { log "diretório inexistente: $APP_DIR"; exit 3; }
[ -f .env ] || { log "falta o .env — rode: sh deploy/provision-env.sh"; exit 3; }

exec 9>"$LOCK_FILE"
flock -n 9 || { log "já existe um deploy em andamento"; exit 4; }

COMPOSE=(docker compose -f docker-compose.prod.yml)

wait_healthy() {
  local status
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || echo missing)"
    case "$status" in
      healthy) return 0 ;;
      exited | dead) return 1 ;;
    esac
    sleep 5
  done
  return 1
}

publish() {
  docker network inspect ingress >/dev/null 2>&1 || docker network create ingress >/dev/null
  mkdir -p backups
  "${COMPOSE[@]}" up -d --build --remove-orphans
}

PREVIOUS="$(cat "$STATE_FILE" 2>/dev/null || git rev-parse HEAD)"
log "deploy $SHA (anterior: ${PREVIOUS:0:12})"

if ! git fetch --quiet origin main || ! git reset --hard --quiet "$SHA"; then
  log "falha ao posicionar o repositório em $SHA"
  exit 5
fi
log "código em $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# nenhum deploy começa sem um backup novo
if docker inspect --format '{{.State.Running}}' "$BACKUP_CONTAINER" 2>/dev/null | grep -q true; then
  log "backup pré-deploy"
  if ! docker exec "$BACKUP_CONTAINER" sh /backup.sh agora; then
    log "FALHA no backup pré-deploy; deploy abortado para não arriscar dados"
    exit 8
  fi
else
  log "container de backup parado — primeiro deploy, sem backup prévio"
fi

publish

if wait_healthy; then
  # app de pé antes do proxy apontar pra ele (senão o primeiro pedido pega 502)
  sh deploy/reload-caddy.sh
  printf '%s\n' "$SHA" >"$STATE_FILE"
  docker image prune -f >/dev/null 2>&1 || true
  log "ok — app healthy e caddy recarregado"
  exit 0
fi

log "FALHA: app não ficou healthy; logs abaixo"
"${COMPOSE[@]}" logs --tail 60 app 2>&1 | sed 's/^/    /' || true

if [[ "$PREVIOUS" != "$SHA" ]]; then
  log "rollback para ${PREVIOUS:0:12}"
  git reset --hard --quiet "$PREVIOUS"
  publish
  wait_healthy && log "rollback ok" || log "rollback também não ficou healthy"
fi

exit 1
