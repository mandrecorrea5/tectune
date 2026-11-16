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

Tudo roda como **root** (a VPS não tem usuário `deploy`).

```bash
ssh root@187.41.102.127
```

**2.1 Acesso da VPS ao repositório (deploy key, só leitura):**

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
git config --global --add safe.directory /srv/apps/tectune
cd /srv/apps/tectune
sh deploy/provision-env.sh            # cria o .env com senha do banco forte (fica só na VPS)
```

**2.2 Comando de deploy travado:**

```bash
install -m 755 -o root -g root /srv/apps/tectune/deploy/remote-deploy.sh /usr/local/bin/tectune-deploy
```

**2.3 Primeira subida:**

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
2. Autorize essa chave na VPS **travada no comando de deploy** (do Mac, sem copiar e colar a chave à mão):
   ```bash
   echo "restrict,command=\"/usr/local/bin/tectune-deploy\" $(cat ~/.ssh/tectune_actions.pub)" | ssh root@187.41.102.127 'cat >> /root/.ssh/authorized_keys'
   # teste: tem que rodar o deploy SEM pedir senha
   ssh -i ~/.ssh/tectune_actions -o IdentitiesOnly=yes root@187.41.102.127 "deploy $(git rev-parse HEAD)"
   ```
   Com o `restrict,command=` essa chave só consegue rodar o deploy do Tectune, mesmo entrando como root.
3. No GitHub: **tectune → Settings → Secrets and variables → Actions**:
   | Secret | Valor |
   |---|---|
   | `VPS_HOST` | `187.41.102.127` |
   | `VPS_USER` | `root` |
   | `VPS_SSH_KEY` | `pbcopy < ~/.ssh/tectune_actions` e cole (chave **privada**, sem `.pub`) |
   | `VPS_KNOWN_HOSTS` | `ssh-keyscan 187.41.102.127 2>/dev/null \| grep -v '^#' \| pbcopy` e cole |

Sem `VPS_SSH_KEY` o job de deploy só avisa e é pulado. Re-publicar sem commit novo: **Actions → CI → Run workflow**.

## 4. E-mail (Resend), igual ao felpma

O Tectune manda três e-mails: **confirmação de cadastro** (a conta só entra depois de clicar no link, que vale
24 horas; dá para pedir outro na tela de login; cadastro nunca confirmado é apagado em 7 dias), **recuperação de senha** ("Esqueci minha senha" na tela de login, link válido por 1 hora,
uso único) e **convite de banda** (para quem já tem conta e também para quem ainda não tem: a pessoa recebe o
link de cadastro e o convite fica esperando por ela). Sem o Resend configurado em produção, **novos cadastros ficam
bloqueados** (não há como confirmar o e-mail), o "Esqueci minha senha" não aparece e convites só funcionam para quem já tem conta.

1. **Resend → Domains → Add domain**: `tectune.com.br` (região: São Paulo, `sa-east-1`, se aparecer a opção).
2. O Resend mostra 3 ou 4 registros DNS. Crie **exatamente** esses na Cloudflare (**DNS → Records**), todos *DNS only*:
   | Tipo | Nome | Conteúdo (copie do Resend) |
   |---|---|---|
   | MX | `send` | `feedback-smtp.<região>.amazonses.com`, prioridade 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | `p=MIGfMA0G...` (a chave DKIM) |
   | TXT | `_dmarc` (recomendado) | `v=DMARC1; p=none;` |

   Não mexa em MX do domínio raiz: o `send` é um subdomínio só para os envios.
3. No Resend, clique em **Verify DNS Records** e espere ficar **Verified** (minutos, às vezes até 1 hora).
4. **Resend → API Keys → Create API Key**: nome `tectune-producao`, permissão **Sending access**, domínio `tectune.com.br`.
   Copie a chave (`re_...`, só aparece uma vez).
5. Na VPS, edite o `.env` e suba de novo:
   ```bash
   cd /srv/apps/tectune && nano .env
   # RESEND_API_KEY=re_...
   # EMAIL_FROM_ADDRESS=nao-responda@tectune.com.br
   # EMAIL_FROM_NAME=Tectune
   # APP_URL=https://tectune.com.br
   docker compose -f docker-compose.prod.yml up -d app
   ```
6. Teste: em https://tectune.com.br clique em **Esqueci minha senha** com o seu e-mail. Erros de envio aparecem em
   `docker compose -f docker-compose.prod.yml logs app | grep email`.

## 5. Dia a dia (na VPS, em /srv/apps/tectune)

```bash
C="docker compose -f docker-compose.prod.yml"
$C ps
$C logs -f app
docker logs -f ingress-caddy 2>&1 | grep tectune      # certificado e proxy

# contas
$C exec app node src/cli.js users
$C exec app node src/cli.js stats
$C exec app node src/cli.js reset-password email@x.com   # gera senha nova e desconecta os aparelhos
$C exec app node src/cli.js verify email@x.com           # confirma o e-mail na mão (se o e-mail não chegou)

# backups (todo dia às BACKUP_HOUR, guarda BACKUP_KEEP_DAYS dias; e antes de todo deploy)
bash scripts/backup.sh agora
bash scripts/backup.sh listar
bash scripts/backup.sh restaurar backups/tectune_AAAA-MM-DD_HHMM.dump
```

Os backups ficam na própria VPS: copie para fora de vez em quando (`rsync -av root@187.41.102.127:/srv/apps/tectune/backups/ ~/Backups/tectune/`)
ou siga o mesmo caminho de backup offsite do elama.

## 6. App mobile

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
| CI: `Host key verification failed` | `VPS_KNOWN_HOSTS` vazio ou errado: gere de novo com o `ssh-keyscan` acima |
| CI: `Permission denied (publickey)` | A linha no `authorized_keys` não é da `tectune_actions`; refaça o passo 3.2 e teste do Mac |
| `detected dubious ownership` no git | `git config --global --add safe.directory /srv/apps/tectune` |
| 429 no login | Limite anti-abuso: 30 tentativas por 15 min por IP |
