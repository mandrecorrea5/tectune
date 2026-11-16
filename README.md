# Tectune

**https://tectune.com.br**: cadastro de setlists e cifras em **grade de compasso** (estilo Moises), com PDF pronto para imprimir.

- **Setlists**: nome do show, data, local, observações e compassos por linha (4, 6 ou 8)
- **Biblioteca de músicas**: cada cifra fica salva uma vez no banco e pode entrar em várias setlists
- **Editor com prévia ao vivo**, transposição de tom (±½) e salvamento automático
- **Tamanho por música**: 100% a 50%, ou **Auto** (escolhe o maior tamanho que cabe em 1 folha); a prévia mostra quantas folhas a música ocupa
- **PDF**: da música aberta ou do show completo (capa com a ordem das músicas + uma página por música)
- **Play com rolagem automática** (web e app): contagem de 1 compasso, compasso atual destacado com barra de progresso,
  compassos tocados apagados e rolagem no andamento do `bpm:` (seguindo `x2`, ritornelos e casas 1/2).
  Clique num compasso para começar dali; `−`/`+` ajustam o andamento (clique no valor volta a 100%).
  **⛶ Palco** deixa só a grade em tela cheia. Atalhos: **espaço** tocar/pausar, **← →** (ou PageUp/PageDown,
  como os pedais Bluetooth) música anterior/próxima, **Esc** sai do palco.
  Em 6/8, 9/8 e 12/8 o BPM conta a semínima pontuada (♩.).

- **Editor visual**: toque no compasso e no acorde (a barra embaixo sugere os acordes do tom e os já usados),
  ou digite o acorde e aperte Enter para pôr e avançar (espaço divide o compasso). Repetição, casas, anotação e
  letra ficam no painel do compasso. O modo **Código** mostra o mesmo texto de sempre: os dois editam a mesma cifra.
  ⌘Z desfaz; ← → andam pelos compassos; Delete apaga.
- **Link do show (sem cadastro)**: o admin cria um link (com QR code) e manda pelo WhatsApp. Quem abre escolhe o
  instrumento e o nome, vê as cifras e acompanha o ao vivo. Só leitura. O link pode ser trocado ou desligado.
- **Curva de energia**: o BPM de cada música na ordem do show, para montar a sequência
- **Contas e bandas**: cadastro e login, convites, admins editam e membros acompanham
- **Show ao vivo**: quem conduz dá o play e todos os aparelhos (inclusive quem entrou pelo link) seguem no mesmo
  compasso; o palco abre sozinho em quem está seguindo (visão acordes ou letra)

Stack: Node.js 22 + Express, PostgreSQL 16, front-end em HTML/JS puro (jsPDF incluído localmente)
e app mobile em React Native (Expo).

## Estrutura do projeto (monorepo)

```
apps/web/         sistema web + API (Express, Postgres) — roda no Docker
apps/mobile/      app do celular (Expo) — veja apps/mobile/README.md
packages/core/    núcleo compartilhado: parser da cifra, compasso, validação, transposição, roteiro de reprodução
docker-compose.yml
```

Testes do núcleo: `cd packages/core && npm test`. Testes da sincronização (com a API rodando): `cd apps/web && BASE_URL=http://localhost:3000 npm test`.

## Produção

Passo a passo completo (Cloudflare, VPS, GitHub Actions, backups) em **[DEPLOY.md](DEPLOY.md)**.

## Subir com Docker (desenvolvimento)

Pré-requisito: Docker Desktop (ou Docker Engine + plugin Compose).

```bash
docker compose up -d --build
```

Abra **http://localhost:3000**. Na primeira vez a aplicação cria as tabelas (em desenvolvimento, também uma música de exemplo).

Comandos úteis:

```bash
docker compose logs -f app      # ver os logs da aplicação
docker compose down             # parar (os dados continuam salvos)
docker compose down -v          # parar e APAGAR o banco
```

Para mudar a porta ou a senha do banco, copie `.env.example` para `.env` e edite antes de subir.

### Backup do banco

```bash
docker compose exec db pg_dump -U cifras cifras > backup.sql
# restaurar:
docker compose exec -T db psql -U cifras cifras < backup.sql
```

## Rodar sem Docker (desenvolvimento)

Com um PostgreSQL local:

```bash
cd apps/web
npm install
DATABASE_URL=postgres://cifras:cifras@localhost:5432/cifras npm run dev
```

## Como escrever a cifra

```
título: Minha música
artista: Banda
tom: G
bpm: 76
compasso: 4/4
capo: 2
obs: observação geral da música

[Refrão] x2
> observação da seção
|: G | D/F# | Em7 | C D :| x2
| G | % | 1. C / / D | 2. C |
| D "breque" | N.C. | _ |
```

| Escrita | Significado |
|---|---|
| `| G | D |` | cada `|` separa um compasso |
| `compasso: 6/8` | define quantos tempos cabem no bloco (4/4 = 4, 3/4 = 3, 6/8 = 6) |
| `| C G |` | dois acordes: o compasso é dividido igualmente |
| `| C / / G |` | `/` = mais um tempo do acorde anterior |
| `| C D E F |` | um acorde por tempo (em 4/4) |
| `%` | repete o compasso anterior |
| `|: ... :| x3` | ritornelo, com nº de vezes |
| `1.` / `2.` | casa 1 / casa 2 |
| `"texto"` | anotação em cima do compasso |
| `-` ou `pausa` | sinal de pausa naquele tempo (`| - |` = compasso inteiro) |
| `_` / `N.C.` | compasso vazio / sem acorde |

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | status da aplicação e do banco |
| GET | `/api/setlists` | lista as setlists (com nº de músicas) |
| POST | `/api/setlists` | cria `{ name, event_date?, venue?, notes?, cols? }` |
| GET | `/api/setlists/:id` | setlist com as músicas na ordem |
| PATCH | `/api/setlists/:id` | altera campos da setlist |
| DELETE | `/api/setlists/:id` | exclui a setlist (as músicas continuam na biblioteca) |
| PUT | `/api/setlists/:id/songs` | define a ordem completa `{ songIds: [...] }` |
| GET | `/api/songs?q=` | biblioteca, com busca por título/artista |
| POST | `/api/songs` | cria `{ content }` |
| GET/PUT/DELETE | `/api/songs/:id` | lê, atualiza `{ content }` / `{ font_scale }` ou apaga a música |
| POST | `/api/setlists/:id/share` | cria o link do show (ou devolve o atual); `{ reset: true }` troca por um novo |
| DELETE | `/api/setlists/:id/share` | desliga o link (quem estava pelo link sai do ao vivo) |
| GET | `/api/public/shows/:token` | show pelo link, sem conta (só leitura) |
| GET | `/s/:token` | página do show pelo link |
| GET | `/api/sync` | tudo de uma vez (setlists com a ordem + músicas) |
| POST | `/api/sync` | sincronização do app offline-first: `{ since, changes: { songs, setlists, deletions } }` → o que mudou no servidor |

**Validação:** mais acordes/tempos do que a fórmula de compasso permite é **erro** (compasso em vermelho, com a linha indicada no editor). Divisões ambíguas (ex.: 3 acordes em 4/4 sem `/`) geram **aviso**.

Título, artista, tom e BPM são extraídos automaticamente do cabeçalho da cifra.
