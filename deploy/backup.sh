#!/bin/sh
# Backup diário do banco (pg_dump formato custom), roda dentro do serviço "backup".
# Guarda em /backups (pasta ./backups na VPS) e apaga os mais velhos que BACKUP_KEEP_DAYS.
set -u
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-4}"

dump() {
  ts=$(date +%Y-%m-%d_%H%M)
  f="/backups/tectune_$ts.dump"
  if pg_dump -Fc -f "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "[backup] ok: $f ($(du -h "$f" | cut -f1))"
    find /backups -name 'tectune_*.dump' -mtime +"$KEEP" -print -delete | sed 's/^/[backup] removido: /'
  else
    rm -f "$f.tmp"; echo "[backup] FALHOU"
  fi
}

[ "${1:-}" = "agora" ] && { dump; exit 0; }

echo "[backup] ativo: todo dia às ${HOUR}h, guardando ${KEEP} dias"
# primeiro backup logo ao subir, se não houver nenhum de hoje
ls /backups/tectune_$(date +%Y-%m-%d)_*.dump >/dev/null 2>&1 || dump
last=$(date +%Y-%m-%d)
while true; do
  sleep 600
  today=$(date +%Y-%m-%d)
  if [ "$today" != "$last" ] && [ "$(date +%H | sed 's/^0//')" -ge "$HOUR" ]; then
    dump; last=$today
  fi
done
