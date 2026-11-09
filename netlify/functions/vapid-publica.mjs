// Entrega ao app a chave pública VAPID guardada nas variáveis do Netlify (a privada nunca sai do servidor)
export default async () => new Response(JSON.stringify({ chave: (globalThis.Netlify && Netlify.env.get('VAPID_PUBLIC_KEY')) || process.env.VAPID_PUBLIC_KEY || '' }), {
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
});
export const config = { path: '/api/vapid-publica' };
