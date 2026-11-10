// Teste dos avisos: abra /api/aviso-teste no navegador. Manda a todos os aparelhos com o sino ativado
// o fechamento do último dia com produção (ou de ?dia=AAAA-MM-DD) e os turnos desse dia, marcados como TESTE.
// Não mexe no registro dos avisos automáticos.
import { env, configurarVapid, getDoc, lerProducao, montarAvisos, enviar, agoraLocal, ymd, addDias, producaoDoDia } from './avisos-turno.mjs';

export const config = { path: '/api/aviso-teste' };

export default async (req) => {
  if (!configurarVapid()) {
    const falta = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter(k => !env(k));
    return new Response(`As variáveis VAPID não chegaram a esta função. Faltando: ${falta.join(', ')}.\nDiagnóstico: contexto=${env('CONTEXT') || '?'} · site=${env('SITE_NAME') || env('URL') || '?'} · VAPID vistas=${Object.keys(process.env).filter(k => /VAPID/i.test(k)).join(', ') || 'nenhuma'}.\nConfira o valor de Production de cada uma e publique de novo (Deploys → Trigger deploy → Clear cache and deploy site).`,
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const pedido = new URL(req.url).searchParams.get('dia');
  const cfg = (await getDoc('dashboard_config/settings')) || {};
  const fileNames = Array.isArray(cfg.fileNames) ? cfg.fileNames : [];
  // Dia pedido, ou o último dia antes de hoje que teve produção (procura até 10 dias para trás)
  let dia = /^\d{4}-\d{2}-\d{2}$/.test(pedido || '') ? pedido : null, rows = [];
  const hoje = ymd(agoraLocal());
  const tentativas = dia ? [dia] : Array.from({ length: 10 }, (_, i) => addDias(hoje, -(i + 1)));
  for (const ds of tentativas) {
    rows = await lerProducao([ds.slice(0, 7)]);
    if (Object.keys(producaoDoDia(rows, ds, fileNames)).length) { dia = ds; break; }
    dia = null;
  }
  if (!dia) return new Response('Não achei produção da Montagem nos últimos dias.', { status: 404 });
  const res = await enviar([{ ds: dia, tipos: ['dia'] }], rows, cfg, { prefixo: 'TESTE · ', ignorarTipos: true });
  const avisos = res.exemplo;
  const txt = `Teste enviado (${dia}) para ${res.aparelhos} aparelho(s): ${res.ok} entregue(s)${res.removidos ? `, ${res.removidos} inscrição(ões) vencida(s) removida(s)` : ''}.\n\n` + avisos.map(a => `${a.title}\n${a.body}`).join('\n\n');
  return new Response(res.aparelhos ? txt : 'Nenhum aparelho com o sino ativado ainda. Ative no celular (sino no topo do Painel) e abra este endereço de novo.\n\n' + txt,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
