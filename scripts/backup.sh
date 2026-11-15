#!/usr/bin/env bash
# Backups do banco na VPS.
#   bash scripts/backup.sh agora                 # faz um backup agora (em ./backups)
#   bash scripts/backup.sh listar                # lista os backups
#   bash scripts/backup.sh restaurar <arquivo>   # RESTAURA um backup (substitui os dados atuais!)
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"
set -a; . ./.env; set +a

case "${1:-}" in
  agora)   $COMPOSE exec -T backup sh /backup.sh agora ;;
  listar)  ls -lh "${BACKUP_DIR:-./backups}" ;;
  restaurar)
    f="${2:?informe o arquivo .dump}"
    [ -f "$f" ] || { echo "arquivo não encontrado: $f" >&2; exit 1; }
    read -r -p "Isso SUBSTITUI os dados atuais por $f. Digite RESTAURAR para continuar: " ok
    [ "$ok" = "RESTAURAR" ] || { echo "cancelado"; exit 1; }
    echo "==> backup de segurança antes de restaurar"; $COMPOSE exec -T backup sh /backup.sh agora
    $COMPOSE stop app
    $COMPOSE exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$f"
    $COMPOSE start app
    echo "restaurado." ;;
  *) sed -n '2,5p' "$0"; exit 1 ;;
esac
