#!/usr/bin/env bash
# Prepara uma VPS Ubuntu/Debian nova para rodar o Tectune. Rodar como root, UMA vez:
#   curl -fsSL https://raw.githubusercontent.com/... (ou copie o arquivo) | bash
# ou, depois de clonar o repositório:  sudo bash scripts/vps-setup.sh
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/tectune}
DEPLOY_USER=${DEPLOY_USER:-deploy}

echo "==> atualizando pacotes"
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades

echo "==> Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

echo "==> usuário $DEPLOY_USER (deploy pelo GitHub Actions)"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
mkdir -p "/home/$DEPLOY_USER/.ssh" && chmod 700 "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys" && chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"

echo "==> firewall: só SSH, HTTP e HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> atualizações de segurança automáticas e fail2ban (SSH)"
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

echo "==> pasta da aplicação: $APP_DIR"
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

cat <<MSG

Pronto. Próximos passos (veja DEPLOY.md):
  1. Como $DEPLOY_USER, clone o repositório em $APP_DIR
  2. Coloque o Origin Certificate da Cloudflare em $APP_DIR/deploy/certs/ (origin.pem e origin.key)
  3. cd $APP_DIR && bash scripts/deploy.sh
MSG
