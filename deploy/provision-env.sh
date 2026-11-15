#!/bin/sh
# Cria o .env de produção na VPS (uma vez), com senha do banco forte gerada aqui.
#   cd /srv/apps/tectune && sh deploy/provision-env.sh
# Não sobrescreve um .env existente.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env já existe; nada a fazer."; exit 0; fi
cp .env.production.example .env
pw=$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40)
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pw/" .env
chmod 600 .env
mkdir -p backups
echo ".env criado (senha do banco gerada). Revise com: nano .env"
