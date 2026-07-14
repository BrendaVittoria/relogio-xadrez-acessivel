# Relógio de Xadrez Acessível (PWA local)

Aplicativo web instalável (PWA) para arbitragem de partidas de xadrez à
distância entre jogadores com deficiência visual. O árbitro ouve os lances
ditados por telefone/chamada e os registra aqui — digitando em notação
algébrica ou clicando num tabuleiro acessível — enquanto o app controla o
relógio dos dois lados.

**Sem backend.** Tudo roda no navegador; nada sai do aparelho. Ao final da
partida, o PGN pode ser baixado ou compartilhado (WhatsApp, e-mail etc.,
via Web Share API). Implementa a `especificacao_relogio_pwa_local.md`.

## Como rodar localmente

Qualquer servidor estático serve. Por exemplo:

```
python -m http.server 8765
```

e abra `http://localhost:8765`. (Abrir o `index.html` direto do disco não
funciona: módulos ES e service worker exigem HTTP.)

## Como publicar

É um site 100% estático — GitHub Pages resolve: basta publicar a pasta
inteira. O `manifest.webmanifest` e o `sw.js` usam caminhos relativos, então
funciona também em subdiretório (`usuario.github.io/relogio/`).

> O service worker usa *stale-while-revalidate*: cada visita serve o cache e
> renova em segundo plano, então **atualizações aparecem na recarga seguinte
> sem mexer em versão**. O nome do cache em `sw.js` só precisa mudar se um
> dia for necessário forçar uma reinstalação completa.

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | As quatro telas (recuperação, sala de espera, jogo, resultado) e os diálogos |
| `js/app.js` | Orquestração: telas, formulário de setup, preferências, recuperação, PGN |
| `js/jogo.js` | Estado central da partida: chess.js + relógio + comandos + persistência |
| `js/parser.js` | Parser tolerante de lances (roques, `ed5`, `e8q`, `ndf3`, ambiguidade `b`/`B`) |
| `js/comandos.js` | Tabela única `SPECIAL_COMMANDS` (t, p, r, m, back, note, modo, hold, go, draw, resign, ?) |
| `js/relogio.js` | Relógio Fischer com alarmes, pausa e snapshots para `back` |
| `js/tabuleiro.js` | Tabuleiro acessível (setas, Enter, Esc, casas foneticamente nomeadas) |
| `js/fala.js` | Lances e casas em português falado (anna/bella/cesar/…) |
| `js/anunciador.js` | Região `aria-live` única + bipes (Web Audio) |
| `js/pgn.js` | Geração do PGN, download e Web Share |
| `js/armazenamento.js` | localStorage: preferências, presets promovidos, tema, recuperação, backup |
| `js/temas.js` | Temas de cores do tabuleiro (inclui alto contraste para baixa visão) |

Extras além da espec: histórico local das últimas 50 partidas (sala de
espera → "Histórico de partidas"), e Wake Lock para a tela não apagar
durante a partida (silenciosamente ignorada onde não há suporte).
| `vendor/chess.js` | chess.js 1.4.0 vendorado (funciona offline) |
| `icons/pecas/*.svg` | Peças SVG (conjunto Cburnett, de Colin M. L. Burnett, via Wikimedia Commons, licença CC BY-SA 3.0 / GFDL) |
| `sw.js` | Service worker: cache do app shell para uso offline |

## O que ainda não foi verificado (checklist da espec, seção 8)

Testado em desktop (Chromium). Falta validar em dispositivos reais:

- [ ] Instalar ("Adicionar à tela inicial") no Android/Chrome, iOS/Safari e desktop.
- [ ] Modo avião depois da primeira visita (offline).
- [ ] `navigator.share` com arquivo PGN real no Android (WhatsApp/e-mail) e iOS.
- [ ] Checklist completo de acessibilidade com NVDA, VoiceOver e TalkBack.
- [ ] Wake Lock num celular real (aqui o ambiente de teste roda "invisível",
      então a aquisição não pôde ser observada — só o pedido e o fallback).
