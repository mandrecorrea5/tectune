# Tectune em produção

```
visitante ──HTTPS──▶ Cloudflare ──HTTPS (Origin Certificate)──▶ VPS: Caddy :443 ──▶ app :3000 ──▶ Postgres
                                                                       └── backup diário (pg_dump) ──▶ /opt/tectune/backups
```

- **Cloudflare**: DNS, HTTPS público, cache e proteção. Só ela fala com a VPS: quem tentar o IP direto é derrubado pelo Caddy.
- **Caddy**: HTTPS entre a Cloudflare e a VPS, compressão, redireciona `www` e `http` para `https://tectune.com.br`.
- **app**: Node + Express (API, site e WebSocket do show ao vivo). Não fica exposto para fora.
- **db**: PostgreSQL 16, também só na rede interna do Docker.
- **backup**: `pg_dump` todo dia (padrão 4h), guarda 14 dias em `backups/`.

Tempo total na primeira vez: uns 30 minutos.

---

## 1. Cloudflare

1. **Adicionar o site**: em dash.cloudflare.com → *Add a site* → `tectune.com.br` → plano Free.
2. **Nameservers**: a Cloudflare mostra 2 nameservers. No **Registro.br** → seu domínio → *DNS* → *Alterar servidores DNS* → cole os dois.
   A propagação leva de minutos a algumas horas. A Cloudflare manda um e-mail quando o domínio estiver ativo.
3. **DNS** (*DNS → Records*), com a **nuvem laranja (Proxied) ligada** nos dois:
   | Tipo | Nome | Conteúdo |
   |---|---|---|
   | A | `tectune.com.br` (ou `@`) | IP da VPS |
   | A | `www` | IP da VPS |

   Se a VPS tiver IPv6, crie também os registros `AAAA` com o mesmo nome.
4. **SSL/TLS → Overview**: modo **Full (strict)**.
5. **SSL/TLS → Origin Server → Create Certificate**: deixe *RSA (2048)*, hostnames `tectune.com.br` e `*.tectune.com.br`,
   validade 15 anos → *Create*. Copie os dois textos que aparecem:
   - **Origin Certificate** → vai virar `origin.pem`
   - **Private key** → vai virar `origin.key` (**só aparece agora**; guarde num lugar seguro)
6. **SSL/TLS → Edge Certificates**: ligue **Always Use HTTPS** e **Automatic HTTPS Rewrites**. *Minimum TLS Version*: 1.2.
7. **Network**: confira que **WebSockets** está ligado (é o show ao vivo).
8. (Opcional) **Security → Bots**: *Bot Fight Mode* ligado.

> Cache: a Cloudflare só faz cache de arquivos estáticos por padrão; a API nunca é cacheada. Não crie regra de "Cache Everything".

## 2. VPS (Ubuntu 22.04/24.04 ou Debian 12)

A preparação instala Docker, firewall (só 22/80/443), fail2ban e atualizações automáticas de segurança, e cria o
usuário `deploy`. Do seu Mac, dentro da pasta do projeto:

```bash
scp scripts/vps-setup.sh root@IP-DA-VPS:/root/
ssh root@IP-DA-VPS "bash /root/vps-setup.sh"
```

Depois autorize sua chave SSH também no usuário `deploy` (para entrar sem ser root):

```bash
ssh root@IP-DA-VPS "cat ~/.ssh/authorized_keys >> /home/deploy/.ssh/authorized_keys"
ssh deploy@IP-DA-VPS
```

## 3. Acesso da VPS ao repositório (deploy key, só leitura)

O repositório é privado, então a VPS precisa de uma chave própria:

```bash
# conectado como deploy
ssh-keygen -t ed25519 -C "tectune-vps" -f ~/.ssh/github_tectune -N ""
cat ~/.ssh/github_tectune.pub
printf 'Host github.com\n  IdentityFile ~/.ssh/github_tectune\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```

No GitHub: repositório **tectune → Settings → Deploy keys → Add deploy key**, cole a chave pública, **sem** marcar *Allow write access*.

```bash
git clone git@github.com:mandrecorrea5/tectune.git /opt/tectune
```

## 4. Certificado e primeira subida

Ainda como `deploy`, crie os dois arquivos com o que você copiou da Cloudflare (passo 1.5):

```bash
cd /opt/tectune
nano deploy/certs/origin.pem    # cole o Origin Certificate
nano deploy/certs/origin.key    # cole a Private key
chmod 600 deploy/certs/origin.key

bash scripts/deploy.sh --no-pull
```

O `deploy.sh` cria o `.env` com uma **senha do banco forte gerada na hora** (fica só na VPS), baixa as faixas de IP da
Cloudflare, faz o build, sobe tudo e espera a aplicação responder. Abra **https://tectune.com.br**: é só criar a conta.

> Confira o `.env` (`nano .env`) se quiser mudar a hora do backup, os dias guardados etc. Depois: `bash scripts/deploy.sh --no-pull`.

## 5. Deploy automático pelo GitHub (opcional, recomendado)

A cada push na `main`, o GitHub Actions roda os testes (**CI**) e, se passar, o **Deploy** entra na VPS por SSH e roda o `deploy.sh`.

1. Na sua máquina, gere uma chave só para o Actions e autorize na VPS:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-tectune" -f ~/.ssh/tectune_actions -N ""
   ssh-copy-id -i ~/.ssh/tectune_actions.pub deploy@IP-DA-VPS
   ```
2. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**:
   - `VPS_HOST` = IP da VPS
   - `VPS_USER` = `deploy`
   - `VPS_SSH_KEY` = conteúdo de `~/.ssh/tectune_actions` (a chave **privada**)
   - `VPS_PORT` (só se o SSH não for na 22)
3. **Settings → Environments → New environment** `producao`. Se quiser aprovar cada deploy manualmente, marque *Required reviewers*.

Sem esses secrets o Deploy simplesmente é pulado; o CI continua rodando.
Deploy manual: aba **Actions → Deploy → Run workflow**, ou na VPS `cd /opt/tectune && bash scripts/deploy.sh`.

## 6. Dia a dia

```bash
cd /opt/tectune
C="docker compose -f docker-compose.prod.yml"

$C ps                                  # o que está rodando
$C logs -f app                         # logs da aplicação
$C logs -f caddy                       # acessos e HTTPS
$C restart app                         # reiniciar só a aplicação

# contas
$C exec app node src/cli.js users                         # lista as contas
$C exec app node src/cli.js stats                         # números gerais
$C exec app node src/cli.js reset-password email@x.com    # gera senha nova (e desconecta os aparelhos)

# backups (todo dia às BACKUP_HOUR, guardando BACKUP_KEEP_DAYS dias)
bash scripts/backup.sh agora
bash scripts/backup.sh listar
bash scripts/backup.sh restaurar backups/tectune_AAAA-MM-DD_HHMM.dump
```

**Leve os backups para fora da VPS.** Se a VPS morrer, os backups vão junto. O mínimo é copiar de vez em quando para o seu Mac:

```bash
rsync -av deploy@IP-DA-VPS:/opt/tectune/backups/ ~/Backups/tectune/
```

Melhor ainda: ative os snapshots automáticos do provedor da VPS, ou configure `rclone` para um bucket (Cloudflare R2, Backblaze B2).

## 7. App mobile

Builds de produção já apontam para `https://tectune.com.br` (`apps/mobile/app.json` → `extra.apiUrl`; `eas.json` define `EXPO_PUBLIC_API_URL`).
Em desenvolvimento (`npx expo start`) o app continua procurando o servidor no seu computador.

```bash
cd apps/mobile
npm i -g eas-cli && eas login
eas init                                        # liga o projeto à sua conta Expo
eas build --profile preview --platform android  # APK para instalar direto e testar
eas build --profile production --platform all   # lojas (precisa conta Apple Developer / Google Play)
```

Identificadores: `br.com.tectune.app` (iOS e Android).

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Erro **526** da Cloudflare | Certificado de origem ausente ou errado em `deploy/certs/` → confira e `docker compose -f docker-compose.prod.yml restart caddy` |
| Erro **521/522** | VPS fora do ar ou firewall bloqueando 443 (`ufw status`), ou o caddy parado (`$C ps`) |
| Erro **525** | Modo SSL da Cloudflare não está em *Full (strict)*, ou o certificado não cobre o domínio |
| Acessar pelo IP da VPS não abre nada | Esperado: só a Cloudflare tem acesso |
| Show ao vivo não conecta | *Network → WebSockets* desligado na Cloudflare |
| Muitas tentativas de login (429) | Limite anti-abuso: 30 tentativas a cada 15 min por IP. Espere ou reinicie o app |
