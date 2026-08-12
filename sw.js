// Service worker: cache do app shell na instalação, para uso 100% offline.
//
// Estratégia "snapshot atômico": o cache guarda sempre um conjunto coerente de
// arquivos, baixados de uma vez só. Ou o cache inteiro é o da versão antiga, ou
// o inteiro é o da nova — nunca uma mistura. Isso importa porque index.html e
// os módulos JS se referenciam entre si: um HTML novo com um JS antigo (ou o
// contrário) quebra o app na abertura, e o cache antigo mantinha a quebra.
//
// A troca do snapshot acontece em duas situações:
//   1. VERSAO muda (reinstalação completa do service worker);
//   2. o index.html publicado ficou diferente do que está em cache — rede de
//      segurança para o caso de a versão não ter sido incrementada.
//
// AO PUBLICAR UMA MUDANÇA: incremente VERSAO abaixo.

const VERSAO = 4;
const PREFIXO = 'relogio-xadrez-';
const CACHE = `${PREFIXO}v${VERSAO}`;

const ARQUIVOS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/jogo.js',
  './js/relogio.js',
  './js/tabuleiro.js',
  './js/parser.js',
  './js/comandos.js',
  './js/fala.js',
  './js/anunciador.js',
  './js/pgn.js',
  './js/armazenamento.js',
  './js/temas.js',
  './vendor/chess.js',
  './sounds/move.mp3',
  './sounds/capture.mp3',
  './sounds/checkmate.mp3',
  './sounds/draw.mp3',
  './sounds/time_warning.mp3',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/pecas/wk.svg',
  './icons/pecas/wq.svg',
  './icons/pecas/wr.svg',
  './icons/pecas/wb.svg',
  './icons/pecas/wn.svg',
  './icons/pecas/wp.svg',
  './icons/pecas/bk.svg',
  './icons/pecas/bq.svg',
  './icons/pecas/br.svg',
  './icons/pecas/bb.svg',
  './icons/pecas/bn.svg',
  './icons/pecas/bp.svg',
];

// no-store ignora o cache HTTP do navegador: garante que o snapshot é o que
// está publicado agora, e não uma cópia guardada pelo próprio navegador
const daRede = (url) => fetch(new Request(url, { cache: 'no-store' }));

// Baixa todos os arquivos e só grava depois que TODOS chegaram inteiros. Se a
// conexão falhar no meio (celular em rede instável), nada é gravado e o cache
// anterior continua valendo — quebrado pela metade, nunca.
async function gravarSnapshot(cache) {
  const respostas = await Promise.all(ARQUIVOS.map(daRede));
  const falhou = respostas.find((resposta) => !resposta || !resposta.ok);
  if (falhou) throw new Error(`arquivo não baixado: ${falhou && falhou.url}`);
  await Promise.all(respostas.map((resposta, i) => cache.put(ARQUIVOS[i], resposta)));
}

// Confere se o index.html publicado mudou em relação ao do cache. É o gatilho
// reserva: se uma publicação esquecer de incrementar VERSAO, o app se conserta
// sozinho na próxima abertura com internet.
let jaConferiu = false;
async function conferirAtualizacao() {
  if (jaConferiu) return;
  jaConferiu = true;
  try {
    const cache = await caches.open(CACHE);
    const emCache = await cache.match('./index.html');
    const publicado = await daRede('./index.html');
    if (!publicado || !publicado.ok) return;
    if (emCache && (await emCache.text()) === (await publicado.clone().text())) return;
    await gravarSnapshot(cache);
  } catch {
    // sem internet ou download incompleto: segue com o snapshot atual
  }
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(gravarSnapshot)
      .then(() => {
        jaConferiu = true; // acabou de baixar tudo; não precisa conferir de novo
        return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        // Só os caches DESTE app, nunca "todos menos o meu". O leitor de PGN
        // mora no mesmo endereço (brendavittoria.github.io, outra pasta) e o
        // armazenamento de caches é compartilhado por endereço, não por pasta:
        // um app enxerga e pode apagar o cache do outro. Apagar tudo que não
        // fosse meu deixava o outro app sem cópia offline a cada publicação —
        // e ele parava de abrir no primeiro momento sem internet boa.
        chaves
          .filter((chave) => chave.startsWith(PREFIXO) && chave !== CACHE)
          .map((chave) => caches.delete(chave)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET' || !requisicao.url.startsWith(self.location.origin)) return;

  // navegações são sempre servidas pelo shell (./index.html)
  const navegacao = requisicao.mode === 'navigate';
  const chave = navegacao ? './index.html' : requisicao;

  evento.respondWith(
    // busca dentro do MEU cache: caches.match() varre todos os caches do
    // endereço, inclusive os do leitor de PGN e versões antigas minhas
    caches.open(CACHE).then((cache) => cache.match(chave)).then(async (emCache) => {
      if (emCache) return emCache;
      // fora do snapshot (arquivo novo, imagem externa ao shell): tenta a rede
      try {
        return await fetch(requisicao);
      } catch {
        return Response.error();
      }
    }),
  );

  // a conferência roda em segundo plano, sem atrasar a resposta ao usuário
  if (navegacao) evento.waitUntil(conferirAtualizacao());
});
