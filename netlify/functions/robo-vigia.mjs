// Vigia do robô de importação (Google Apps Script). Roda de hora em hora no Netlify.
// Avisa no celular UMA vez quando aparece um problema e UMA vez quando ele se resolve (registro em dashboard_config/vigia).
// Problemas:
//   parado      — o robô não registra verificação há mais de 2 h (gatilho desligado, autorização expirada, erro fatal)
//   sem_import  — o robô roda, mas não importa planilha nova há mais de 30 h (e-mails do Sequor pararam de chegar ou falham)
import webpush from 'web-push';
import { configurarVapid, getDoc, setDoc, listDocs, delDoc } from './avisos-turno.mjs';

export const config = { schedule: '17 * * * *' };

const H = 3600e3;
const LIMITE_PARADO = 2 * H, LIMITE_IMPORT = 30 * H;
const quando = (iso) => { const d = new Date(Date.parse(iso) - 3 * H); return `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)} às ${d.toISOString().slice(11, 16)}`; };

export function diagnostico(robo, agora = Date.now()) {
  const check = robo && robo.check ? Date.parse(robo.check) : 0, at = robo && robo.at ? Date.parse(robo.at) : 0;
  const problemas = [];
  if (!check || agora - check > LIMITE_PARADO)
    problemas.push({ id: 'parado', titulo: 'Robô do painel parado', texto: check ? `A última verificação foi em ${quando(robo.check)}. O gatilho do Apps Script pode ter sido desligado ou a autorização expirou.` : 'O robô nunca registrou uma verificação.' });
  else if (!at || agora - at > LIMITE_IMPORT)
    problemas.push({ id: 'sem_import', titulo: 'Robô sem planilhas novas', texto: at ? `Nada novo importado desde ${quando(robo.at)}. Os e-mails do Sequor podem ter parado de chegar.` : 'O robô ainda não importou nenhuma planilha.' });
  return problemas;
}

async function avisar(titulo, corpo) {
  const subs = await listDocs('dashboard_push');
  let ok = 0;
  for (const s of subs) {
    let sub; try { sub = JSON.parse(s.sub); } catch (e) { continue; }
    try { await webpush.sendNotification(sub, JSON.stringify({ title: titulo, body: corpo, url: './?tab=audit', tag: 'robo-vigia' }), { TTL: 12 * 3600, urgency: 'high' }); ok++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await delDoc(`dashboard_push/${s.id}`); else console.log('push', e.statusCode, e.body); }
  }
  return ok;
}

export default async () => {
  const robo = (await getDoc('dashboard_config/robo')) || {};
  const atual = diagnostico(robo);
  const reg = (await getDoc('dashboard_config/vigia')) || {};
  let abertos = {}; try { abertos = JSON.parse(reg.abertos || '{}'); } catch (e) { abertos = {}; }
  const podeAvisar = configurarVapid();
  const log = [];
  // Problema novo: um aviso só
  for (const p of atual) {
    if (abertos[p.id]) continue;
    abertos[p.id] = { desde: new Date().toISOString(), texto: p.texto };
    if (podeAvisar) log.push(`novo ${p.id}: ${await avisar('⚠ ' + p.titulo, p.texto)} aparelhos`);
  }
  // Problema resolvido: um aviso só
  for (const id of Object.keys(abertos)) {
    if (atual.some(p => p.id === id)) continue;
    delete abertos[id];
    if (podeAvisar) log.push(`resolvido ${id}: ${await avisar('✓ Robô do painel normalizado', 'O robô voltou a importar as planilhas normalmente.')} aparelhos`);
  }
  await setDoc('dashboard_config/vigia', { abertos, verificado: new Date().toISOString() });
  return new Response(log.join('\n') || 'sem mudança');
};
