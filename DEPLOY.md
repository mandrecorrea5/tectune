# Tectune em produção

Roda na **VPS compartilhada** (`187.41.102.127`, alias `vps-prd`), junto com felpma, elama, ranking e ndovu, no mesmo modelo deles:

```
visitante ──HTTPS──▶ ingress-caddy (80/443, Let's Encrypt automático, stack "ingress")
                         └─ network `ingress` ──▶ tectune-app:3000 ──▶ tectune-postgres
                                                  tectune-backup (pg_dump diário) ──▶ /srv/apps/tectune/backups
```

- **DNS na Cloudflare em nuvem cinza (DNS only)**: o ingress emite o certificado via HTTP-01; com a nuvem laranja a emissão falha.
- Nenhuma porta do Tectune é publicada no host; o roteamento fica em `deploy/caddy/tectune.caddy`.
- Deploy: push na `main` → CI (testes + build da imagem) → `ssh deploy@vps "deploy <sha>"` → `deploy/remote-deploy.sh`
  (backup antes, sobe, espera healthy, recarrega o Caddy e volta sozinho para a versão anterior se falhar).

## 1. Cloudflare (DNS)

Domínio `tectune.com.br` na Cloudflare (nameservers do Registro.br apontando para ela). Em **DNS → Records**:

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| A | `tectune.com.br` | `187.41.102.127` | **DNS only (nuvem cinza)** |
| A | `www` | `187.41.102.127` | **DNS only (nuvem cinza)** |

## 2. Primeira instalação na VPS (uma vez)

```bash
ssh vps-prd          # ou: ssh deploy@187.41.102.127
```

**2.1 Acesso da VPS ao repositório (deploy key, só leitura).** Como o usuário `deploy`:

```bash
ssh-keygen -t ed25519 -C "vps-tectune" -f ~/.ssh/github_tectune -N ""
cat ~/.ssh/github_tectune.pub
cat >> ~/.ssh/config <<'CFG'
Host github-tectune
  HostName github.com
  IdentityFile ~/.ssh/github_tectune
  IdentitiesOnly yes
CFG
```

No GitHub: **tectune → Settings → Deploy keys → Add deploy key**, cole a chave pública (sem *write access*). Depois:

```bash
git clone git@github-tectune:mandrecorrea5/tectune.git /srv/apps/tectune
cd /srv/apps/tectune
sh deploy/provision-env.sh            # cria o .env com senha do banco forte (fica só na VPS)
```

**2.2 Comando de deploy travado** (como root):

```bash
sudo install -m 755 -o root -g root /srv/apps/tectune/deploy/remote-deploy.sh /usr/local/bin/tectune-deploy
```

**2.3 Primeira subida** (como `deploy`):

```bash
cd /srv/apps/tectune
SSH_ORIGINAL_COMMAND="deploy $(git rev-parse HEAD)" tectune-deploy
curl -sI https://tectune.com.br | head -1      # HTTP/2 200
```

## 3. Deploy automático pelo GitHub Actions

1. Gere uma chave só para o CI (no seu Mac):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-tectune" -f ~/.ssh/tectune_actions -N ""
   ```
2. Na VPS, autorize essa chave **travada no comando de deploy** (uma linha em `~deploy/.ssh/authorized_keys`):
   ```
   restrict,command="/usr/local/bin/tectune-deploy" ssh-ed25519 AAAA...(conteúdo de tectune_actions.pub) github-actions-tectune
   ```
3. No GitHub: **tectune → Settings → Secrets and variables → Actions**:
   | Secret | Valor |
   |---|---|
   | `VPS_HOST` | `187.41.102.127` |
   | `VPS_USER` | `deploy` |
   | `VPS_SSH_KEY` | conteúdo de `~/.ssh/tectune_actions` (chave **privada**) |
   | `VPS_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 187.41.102.127` |

   (Os mesmos nomes do felpma: `VPS_HOST`, `VPS_USER` e `VPS_KNOWN_HOSTS` podem ter o mesmo valor de lá.)

Sem `VPS_SSH_KEY` o job de deploy só avisa e é pulado. Re-publicar sem commit novo: **Actions → CI → Run workflow**.

## 4. Dia a dia (na VPS, em /srv/apps/tectune)

```bash
C="docker compose -f docker-compose.prod.yml"
$C ps
$C logs -f app
docker logs -f ingress-caddy 2>&1 | grep tectune      # certificado e proxy

# contas
$C exec app node src/cli.js users
$C exec app node src/cli.js stats
$C exec app node src/cli.js reset-password email@x.com   # gera senha nova e desconecta os aparelhos

# backups (todo dia às BACKUP_HOUR, guarda BACKUP_KEEP_DAYS dias; e antes de todo deploy)
bash scripts/backup.sh agora
bash scripts/backup.sh listar
bash scripts/backup.sh restaurar backups/tectune_AAAA-MM-DD_HHMM.dump
```

Os backups ficam na própria VPS: copie para fora de vez em quando (`rsync -av vps-prd:/srv/apps/tectune/backups/ ~/Backups/tectune/`)
ou siga o mesmo caminho de backup offsite do elama.

## 5. App mobile

Builds de produção já apontam para `https://tectune.com.br` (`apps/mobile/app.json` → `extra.apiUrl`; `eas.json`).

```bash
cd apps/mobile
npm i -g eas-cli && eas login && eas init
eas build --profile preview --platform android    # APK para testar
eas build --profile production --platform all     # lojas
```

Identificadores: `br.com.tectune.app`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Certificado não sai / erro de TLS | Registro DNS em nuvem laranja → mude para cinza; veja `docker logs ingress-caddy` |
| 502 | `tectune-app` parado ou fora da network `ingress` (`docker network inspect ingress`) |
| Show ao vivo não conecta | Veja os logs do app; o WebSocket passa pelo mesmo proxy (`/api/live`) |
| 429 no login | Limite anti-abuso: 30 tentativas por 15 min por IP |
