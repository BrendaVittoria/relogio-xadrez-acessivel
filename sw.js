// Service worker: cache do app shell na instalação, para uso 100% offline.
// Estratégia "stale-while-revalidate": responde na hora com o cache e renova
// em segundo plano — mudanças publicadas aparecem na recarga seguinte, sem
// precisar mudar o número da versão (o número só força uma reinstalação
// completa, se algum dia for necessário).

const CACHE = 'relogio-xadrez-v2';

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

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' ignora o cache HTTP do navegador — garante que uma
      // versão nova do app instala os arquivos realmente novos do servidor
      .then((cache) => cache.addAll(ARQUIVOS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((chave) => chave !== CACHE).map((chave) => caches.delete(chave)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET' || !requisicao.url.startsWith(self.location.origin)) return;

  // navegações são sempre servidas pelo shell (./index.html)
  const chave = requisicao.mode === 'navigate' ? './index.html' : requisicao;

  const renovar = caches.open(CACHE).then(async (cache) => {
    try {
      // um request de navegação não pode ser refeito com opções (TypeError);
      // para navegações, o shell é buscado pelo caminho — sem isso, o
      // index.html nunca se renovaria pela rede
      const daRede = requisicao.mode === 'navigate'
        ? await fetch('./index.html', { cache: 'no-cache' })
        : await fetch(requisicao, { cache: 'no-cache' });
      if (daRede && daRede.ok) await cache.put(chave, daRede.clone());
      return daRede;
    } catch {
      return null; // offline: fica com o que está no cache
    }
  });

  evento.respondWith(
    caches.match(chave).then((emCache) => emCache || renovar.then((r) => r || Response.error())),
  );
  evento.waitUntil(renovar);
});
