// Teste dos avisos: abra /api/aviso-teste no navegador. Manda a todos os aparelhos com o sino ativado
// o fechamento do último dia com produção (ou de ?dia=AAAA-MM-DD) e os turnos desse dia, marcados como TESTE.
// Não mexe no registro dos avisos automáticos.
import { configurarVapid, getDoc, lerProducao, montarAvisos, enviar, agoraLocal, ymd, addDias, producaoDoDia } from './avisos-turno.mjs';

export const config = { path: '/api/aviso-teste' };

export default async (req) => {
  if (!configurarVapid()) return new Response('As variáveis VAPID não estão configuradas no Netlify.', { status: 500 });
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
  const avisos = montarAvisos(rows, dia, cfg, ['dia'], 'TESTE · ');
  const res = await enviar(avisos);
  const txt = `Teste enviado (${dia}) para ${res.aparelhos} aparelho(s): ${res.ok} entregue(s)${res.removidos ? `, ${res.removidos} inscrição(ões) vencida(s) removida(s)` : ''}.\n\n` + avisos.map(a => `${a.title}\n${a.body}`).join('\n\n');
  return new Response(res.aparelhos ? txt : 'Nenhum aparelho com o sino ativado ainda. Ative no celular (sino no topo do Painel) e abra este endereço de novo.\n\n' + txt,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
