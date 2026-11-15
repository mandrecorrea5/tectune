# Tectune — app mobile (Expo / React Native)

App **offline-first** para usar no palco e no dia a dia: cadastro completo de setlists e músicas
direto no celular, guardado num banco **SQLite** no aparelho, sincronizado com o sistema web quando
houver conexão. Tem **modo palco** com play, contagem, compasso atual destacado e rolagem automática
pelo BPM, editor com validação de tempos e PDF.

## Rodar no celular (Expo Go)

Requer **Node.js 22.13 ou mais novo** (o projeto fixa `22.23.4` em `.tool-versions`, na raiz):

```bash
asdf plugin add nodejs   # se ainda não tiver
asdf install             # na raiz do projeto: instala a versão do .tool-versions
node -v                  # deve mostrar v22.23.4
```

1. Instale o app **Expo Go** no celular (App Store / Google Play).
2. No Mac, com o sistema web rodando (`docker compose up -d` na raiz do projeto):

   ```bash
   cd apps/mobile
   npm install
   npx expo start
   ```

3. Leia o QR code com a câmera (iPhone) ou com o Expo Go (Android). Celular e Mac na mesma rede Wi-Fi.
4. Em desenvolvimento o app já detecta o endereço do Mac (o mesmo IP do `npx expo start`, porta 3000).
   Se precisar mudar, toque em **⚙︎ Servidor**. **Não use `localhost`**: no celular/emulador ele aponta
   para o próprio aparelho (o app troca automaticamente). No emulador Android o atalho para o Mac é
   `http://10.0.2.2:3000`; no celular, `http://IP-DO-MAC:3000` (Ajustes do Sistema → Wi-Fi → Detalhes).

> Também roda no navegador: `npx expo start --web` (útil para testar no computador).

## Como funciona

- **Offline-first**: tudo é gravado primeiro no SQLite do celular — criar/editar/excluir setlists,
  criar/editar/excluir músicas, adicionar da biblioteca, reordenar. Funciona sem internet.
- **Sincronização** (ao abrir o app, puxando a lista para baixo, em ⚙︎ ou alguns segundos depois de cada
  alteração): envia o que foi feito no celular e recebe o que mudou no computador. Cada aparelho cria
  registros com id próprio, então criar offline nos dois lugares não conflita. Se a **mesma** música ou
  setlist for alterada nos dois lugares, vale a alteração mais recente. Exclusões também sincronizam.
- **Servidor**: o app procura sozinho (IP do computador que roda o Expo, `10.0.2.2` no emulador Android,
  `localhost` no simulador iOS). Em ⚙︎ Servidor, "Conectar / procurar servidor" mostra o resultado de cada endereço.
- **Modo palco** (toque numa música ou em *Apresentar show*):
  - ▶ faz a contagem de 1 compasso e começa a tocar; o compasso atual fica destacado com uma barra de progresso,
    os compassos que já foram tocados ficam apagados e a tela rola sozinha.
  - O roteiro segue as repetições: `[Refrão] x2`, ritornelos `|: :| x3` e casas `1.` / `2.`.
  - Toque num compasso para começar (ou pular) dali. `−`/`+` ajustam o andamento (50%–125%; toque longo volta a 100%).
  - `A−`/`A+` aumentam ou diminuem a grade. ⏮ ⏭ trocam de música. A tela fica sempre acesa.
- **BPM**: vem do `bpm:` da cifra. Em compassos compostos (6/8, 9/8, 12/8) o BPM é da semínima pontuada (♩.);
  nos demais, da figura do denominador (♩ em x/4, ♪ em x/8). Sem BPM, usa 90.
- **PDF**: *Ver PDF* abre a visualização nativa (imprimir/salvar); *Enviar* gera o arquivo e abre o compartilhamento.

## Estrutura

```
src/app/            telas (Expo Router)
  index.js          setlists
  setlist-form.js   criar/editar/excluir setlist
  setlist/[id].js   músicas da setlist (tocar, organizar, adicionar)
  library.js        biblioteca de músicas (buscar, criar, excluir, escolher para o show)
  stage.js          modo palco
  edit/[id].js      editar cifra
  settings.js       servidor e sincronização
src/components/     grade (Sheet), acordes (Chord), botões
src/lib/            db.js (SQLite), store.js (estado + sincronização), server.js (busca do servidor), API, PDF
```

O parser, a validação de tempos e o roteiro de reprodução vêm de `packages/core` (compartilhado com o web).

## Publicar nas lojas

Use o EAS (`npx eas-cli@latest build`). Para produção, o servidor precisa estar acessível pela internet
com HTTPS (o iOS bloqueia HTTP comum em apps publicados).
