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

## Ao publicar uma mudança

**Incremente `VERSAO` no topo do `sw.js`.** O service worker guarda os arquivos
do app como um snapshot único e coerente: ou o cache inteiro é da versão
antiga, ou é inteiro da nova. Trocar o número é o que dispara o download do
snapshot novo nos aparelhos já instalados.

Se esquecer, existe uma rede de segurança: o service worker compara o
`index.html` publicado com o que está em cache e rebaixa tudo se forem
diferentes. Mas ela não cobre uma publicação que mexa só nos `.js` — por isso o
número.

Nos dois casos a versão nova só entra na **abertura seguinte** do app: o
snapshot é baixado para um cache de espera e aplicado no começo da próxima
navegação, antes de qualquer arquivo ser servido. Uma página que já está
carregando nunca vê o cache mudar debaixo dela — é isso que evita o
`index.html` de uma versão com módulos de outra ("o app bugou depois da
atualização"). Quem quiser a versão nova na hora: fecha o app e abre de novo.

**Nunca apague "todos os caches menos o meu".** Este app e o
[leitor de PGN](https://github.com/BrendaVittoria/leitor-pgn-acessivel) moram no
mesmo endereço (`brendavittoria.github.io`, pastas diferentes), e o
armazenamento de caches é compartilhado por endereço, não por pasta: cada um
enxerga e pode apagar o cache do outro. Filtre sempre pelo prefixo
`relogio-xadrez-`.

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | As quatro telas (recuperação, sala de espera, jogo, resultado) e os diálogos |
| `js/app.js` | Orquestração: telas, formulário de setup, preferências, recuperação, PGN |
| `js/jogo.js` | Estado central da partida: chess.js + relógio + comandos + persistência |
| `js/parser.js` | Parser tolerante de lances (roques, `ed5`, `e8q`, `ndf3`, `rfc8`, `n1f3`, `e2e4`, ambiguidade `b`/`B`) |
| `js/comandos.js` | Tabela única `SPECIAL_COMMANDS` (t, p, r, m, back, note, modo, hold, go, draw, resign, ?) |
| `js/relogio.js` | Relógio Fischer com alarmes, pausa e snapshots para `back` |
| `js/tabuleiro.js` | Tabuleiro acessível (setas, Enter, Esc, casas foneticamente nomeadas) |
| `js/fala.js` | Lances e casas em português falado (anna/bella/cesar/…) |
| `js/anunciador.js` | Região `aria-live` única + sons de `sounds/` e bipes de reserva (Web Audio) |
| `js/pgn.js` | Geração do PGN, download e Web Share |
| `js/armazenamento.js` | localStorage: preferências, presets promovidos, tema, recuperação, backup |
| `js/temas.js` | Temas de cores do tabuleiro (inclui alto contraste para baixa visão) |

Extras além da espec: histórico local das últimas 50 partidas (sala de
espera → "Histórico de partidas"), e Wake Lock para a tela não apagar
durante a partida (silenciosamente ignorada onde não há suporte).
| `vendor/chess.js` | chess.js 1.4.0 vendorado (funciona offline) |
| `icons/pecas/*.svg` | Peças SVG (conjunto Cburnett, de Colin M. L. Burnett, via Wikimedia Commons, licença CC BY-SA 3.0 / GFDL) |
| `sw.js` | Service worker: cache do app shell para uso offline |

