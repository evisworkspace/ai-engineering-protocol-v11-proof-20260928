import { createServer as httpServer } from 'node:http';
import { createStore } from './src/store.js';

export function createApp() {
  const store = createStore();
  return httpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type = 'text/plain') => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    if (req.method === 'POST' && url.pathname === '/reset') { store.reset(); return send(200, JSON.stringify(store.snapshot()), 'application/json'); }
    if (req.method === 'POST' && url.pathname === '/buy') return send(store.buy() ? 200 : 409, JSON.stringify(store.snapshot()), 'application/json');
    if (req.method === 'GET' && url.pathname === '/backup') return send(200, store.backup(), 'application/json');
    if (req.method === 'POST' && url.pathname === '/restore') {
      let body = ''; for await (const chunk of req) body += chunk;
      try { store.restore(body); return send(200, JSON.stringify(store.snapshot()), 'application/json'); }
      catch { return send(400, 'backup inválido'); }
    }
    if (req.method === 'GET' && url.pathname === '/admin') return send(403, 'Acesso negado');
    if (req.method === 'GET' && url.pathname === '/cashier') return send(200, `<main><h1>Caixa</h1><span data-testid="sales">${store.snapshot().sales}</span><script>document.querySelector('[data-testid=sales]').textContent='0';</script></main>`, 'text/html');
    if (req.method === 'GET' && url.pathname === '/') return send(200, `<!doctype html><html><body><button data-testid="buy">Comprar</button><span data-testid="stock">${store.snapshot().stock}</span><script>document.querySelector('[data-testid=buy]').onclick = async () => { const r = await fetch('/buy', { method: 'POST' }); const s = await r.json(); document.querySelector('[data-testid=stock]').textContent = s.stock; };</script></body></html>`, 'text/html');
    return send(404, 'Não encontrado');
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createApp().listen(Number(process.env.PORT || 4173), '127.0.0.1');
}
