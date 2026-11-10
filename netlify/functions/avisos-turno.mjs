// Avisos no celular (Web Push) quando o relatório de cada turno chega:
//   T01 (fim 14:00), T02 (fim 22:00), T03 (fim 06:00) e o fechamento do dia anterior (junto com o T03).
// Roda a cada 10 minutos no Netlify. Só avisa quando a produção do turno já está no banco (vinda do robô ou
// importada à mão) e o robô gravou depois do fim do turno; cada aviso sai uma vez só (registro em dashboard_config/avisos).
// Variáveis no Netlify: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:alguem@empresa.com).
import webpush from 'web-push';

// Variáveis do Netlify: nas funções novas ficam em Netlify.env; process.env fica como reserva
export const env = (k) => { try { const v = globalThis.Netlify && globalThis.Netlify.env && globalThis.Netlify.env.get(k); if (v) return v; } catch (e) { /* */ } return process.env[k]; };

export const config = { schedule: '*/10 * * * *' };

const PROJECT = 'producao-252be';
const API_KEY = 'AIzaSyCmzrUb5z4ux5B62WfzOD8fd9z-kpqcJqc'; // a mesma chave pública do app
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TZ_OFFSET_H = -3; // America/Recife (sem horário de verão)
const TURNOS = ['1', '2', '3'];
// UGBs da Montagem (mesmo mapa do app)
const UGB_MONTAGEM = { 3: 'Montagem 01', 5: 'Montagem 01', 1: 'Montagem 02', 2: 'Montagem 02', 11: 'Montagem 02', 12: 'Montagem 03', 14: 'Montagem 03', 4: 'Montagem 04', 13: 'Montagem 04', 6: 'Montagem 05', 8: 'Montagem 05', 9: 'Montagem 06', 10: 'Montagem 06' };
export const ugbDaLinha = (l) => UGB_MONTAGEM[Number(String(l).replace(/\D/g, ''))] || 'Sem UGB';
const FIM = { '1': 14, '2': 22, '3': 6 }; // hora local em que o turno termina

// ---------- Firestore (REST) ----------
const val = (v) => {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  if ('timestampValue' in v) return v.timestampValue;
  return null;
};
export async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore ${path}: ${r.status}`);
  const j = await r.json();
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, x]) => [k, val(x)]));
}
export async function listDocs(col) {
  const out = []; let tok = '';
  do {
    const r = await fetch(`${BASE}/${col}?key=${API_KEY}&pageSize=100${tok ? `&pageToken=${tok}` : ''}`);
    if (!r.ok) throw new Error(`Firestore ${col}: ${r.status}`);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, val(x)])) }));
    tok = j.nextPageToken || '';
  } while (tok);
  return out;
}
async function setDoc(path, fields) {
  const enc = (x) => typeof x === 'string' ? { stringValue: x } : typeof x === 'number' ? { doubleValue: x } : { stringValue: JSON.stringify(x) };
  await fetch(`${BASE}/${path}?key=${API_KEY}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, enc(x)])) }) });
}
export const delDoc = (path) => fetch(`${BASE}/${path}?key=${API_KEY}`, { method: 'DELETE' });

// Mesmo formato compacto do app (meses grandes)
export function unpackRows(txt) {
  if (!txt) return [];
  const o = JSON.parse(txt);
  if (Array.isArray(o)) return o;
  const { f = [], k = [], r = [] } = o;
  return r.map(a => { const d = {}; f.forEach((c, i) => { const x = a[i]; if (x === null || x === undefined) return; d[c] = Array.isArray(x) ? x[0] : k[x]; }); return d; });
}

// ---------- Datas no horário local ----------
export const agoraLocal = () => new Date(Date.now() + TZ_OFFSET_H * 3600e3); // campos UTC = hora local
export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDias = (ds, n) => ymd(new Date(Date.parse(ds + 'T12:00:00Z') + n * 86400e3));
export const ddmm = (ds) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`;
export const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
export const signed = (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

// ---------- Metas: mesma regra do app (aba Metas, metas por mês, calendário, turnos da linha) ----------
export function metasDe(cfg) {
  const J = (k, def) => { try { return cfg && cfg[k] ? JSON.parse(cfg[k]) : def; } catch (e) { return def; } };
  const metas = J('metas', {}), metasLinha = J('metasLinha', {}), metasMesLinha = J('metasMesLinha', {}), metaHist = J('metaHist', {}), dayPlan = J('dayPlan', {}), turnosLinha = J('turnosLinha', {});
  const reportFor = (month) => { const ms = Object.keys(metas).filter(m => metas[m] && Object.keys(metas[m]).length).sort(); if (!ms.length) return {}; return metas[ms.filter(m => m <= month).pop() || ms[0]]; };
  const metaMesOf = (line, month) => { let v; Object.keys(metasMesLinha).sort().forEach(m => { if (m <= month && metasMesLinha[m] && metasMesLinha[m][line] > 0) v = metasMesLinha[m][line]; }); return v; };
  const getLineMeta = (line, month) => { const v = metaMesOf(line, month) ?? metasLinha[line] ?? reportFor(month)[line]; return v > 0 ? v : null; };
  const activeTurnosOf = (line, ds) => { const h = turnosLinha[line]; if (!h || !h.length) return TURNOS; let cur = TURNOS; h.forEach(e => { if (e.desde <= ds) cur = e.turnos; }); return cur; };
  const metaOn = (line, ds) => { let v; (metaHist[line] || []).forEach(e => { if (e.desde <= ds) v = e.meta; }); return v > 0 ? v : getLineMeta(line, ds.slice(0, 7)); };
  const turnoMeta = (line, ds, t) => { const p = (dayPlan[line] || {})[ds]; if (p && p[t] !== undefined && p[t] !== null && p[t] !== '') return +p[t] || 0;
    const base = metaOn(line, ds); return base && activeTurnosOf(line, ds).includes(String(t)) ? base / 3 : 0; };
  return { turnoMeta };
}

// Produção da Montagem num dia, por linha e turno (sem duplicados: vale a planilha mais recente de cada dia/linha/turno)
export function producaoDoDia(rows, ds, fileNames) {
  const pos = new Map((fileNames || []).map((n, i) => [n, i]));
  const doDia = rows.filter(d => d && d.date === ds && /^montagem$/i.test(d.area || '') && /^LIM\d+$/.test(d.maquina || '') && Number(d.prod) > 0);
  const best = new Map();
  doDia.forEach(d => { const k = `${d.maquina}|${d.turno}`, p = pos.has(d.sourceFile) ? pos.get(d.sourceFile) : -1; const b = best.get(k); if (!b || p > b.p) best.set(k, { p, f: d.sourceFile }); });
  const seen = new Set(), por = {};
  doDia.forEach(d => {
    const k = `${d.maquina}|${d.turno}`; if (best.get(k).f !== d.sourceFile) return;
    const u = `${k}|${d.modelo}|${d.prod}`; if (seen.has(u)) return; seen.add(u);
    (por[d.maquina] = por[d.maquina] || {})[String(d.turno)] = (por[d.maquina]?.[String(d.turno)] || 0) + Number(d.prod);
  });
  return por; // { LIM01: { '1': 900, '2': 850 } }
}

// Resumo de um turno (ou do dia inteiro com turnos = ['1','2','3'])
export function resumo(por, ds, turnos, M) {
  const linhas = [...new Set([...Object.keys(por)])].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
  let prod = 0, prodComMeta = 0, meta = 0; const porLinha = [];
  linhas.forEach(l => {
    const p = turnos.reduce((s, t) => s + (por[l]?.[t] || 0), 0);
    const m = turnos.reduce((s, t) => s + M.turnoMeta(l, ds, t), 0);
    prod += p; if (m) { meta += m; prodComMeta += p; porLinha.push({ l, p, m }); }
  });
  const pct = meta ? prodComMeta / meta * 100 : null;
  const abaixo = porLinha.filter(x => x.p < x.m).sort((a, b) => (a.p - a.m) - (b.p - b.m));
  return { prod, meta, pct, naMeta: porLinha.length - abaixo.length, comMeta: porLinha.length, abaixo };
}
export const linhaAbaixo = (r) => r.abaixo.length ? `Abaixo: ${r.abaixo.slice(0, 4).map(x => `${x.l} ${signed(x.p - x.m)}`).join(' · ')}${r.abaixo.length > 4 ? ` +${r.abaixo.length - 4}` : ''}` : 'Todas as linhas na meta 👏';

// Monta os avisos de um dia: turnos pedidos e, se 'dia' estiver em tipos, o fechamento
export function montarAvisos(rows, ds, cfg, tipos, prefixo = '', ugb = 'Todas') {
  const M = metasDe(cfg), porTudo = producaoDoDia(rows, ds, Array.isArray(cfg.fileNames) ? cfg.fileNames : []);
  const por = ugb === 'Todas' ? porTudo : Object.fromEntries(Object.entries(porTudo).filter(([l]) => ugbDaLinha(l) === ugb));
  if (ugb !== 'Todas') prefixo += ugb.replace('Montagem ', 'M') + ' · ';
  const out = [];
  tipos.filter(t => t !== 'dia').forEach(t => {
    if (!Object.values(por).some(x => x[t] > 0)) return;
    const r = resumo(por, ds, [t], M), ok = r.pct !== null && r.pct >= 100;
    out.push({ key: `${ds}|T${t}`, title: `${prefixo}${ok ? '✅' : '🔻'} T0${t} · ${ddmm(ds)}: ${fmt(r.prod)} peças${r.pct !== null ? ` (${Math.round(r.pct)}%)` : ''}`,
      body: `${r.comMeta ? `${r.naMeta} de ${r.comMeta} linhas na meta · ` : ''}${linhaAbaixo(r)}`, url: `./?tab=bomdia&dia=${ds}&turno=${t}` });
  });
  if (tipos.includes('dia') && Object.keys(por).length) {
    const d = resumo(por, ds, TURNOS, M), okd = d.pct !== null && d.pct >= 100;
    const porT = TURNOS.map(t => `T0${t} ${fmt(Object.values(por).reduce((s, x) => s + (x[t] || 0), 0))}`).join(' · ');
    out.push({ key: `${ds}|DIA`, title: `${prefixo}${okd ? '✅' : '🔻'} Fechamento ${ddmm(ds)}: ${fmt(d.prod)} peças${d.pct !== null ? ` (${Math.round(d.pct)}%)` : ''}`,
      body: `${porT}${d.meta ? ` · saldo ${signed(d.prod - d.meta)}` : ''}\n${d.comMeta ? `${d.naMeta} de ${d.comMeta} linhas na meta · ` : ''}${linhaAbaixo(d)}`, url: `./?tab=bomdia&dia=${ds}` });
  }
  return out;
}
export async function lerProducao(meses) {
  let rows = [];
  for (const m of meses) { const d = await getDoc(`dashboard_raw_data/${m}`); if (d && d.data) rows = rows.concat(unpackRows(d.data)); }
  return rows;
}
export function configurarVapid() {
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return false;
  webpush.setVapidDetails((env('VAPID_SUBJECT') || 'mailto:avisos@example.com').replace(/\s|<|>/g, ''), pub, priv);
  return true;
}
// Preferências de cada aparelho (escolhidas no sino): UGB e quais avisos recebe
export const prefsDe = (s) => { let p = {}; try { p = JSON.parse(s.prefs || '{}'); } catch (e) { p = {}; }
  return { ugb: p.ugb || 'Todas', t1: p.t1 !== false, t2: p.t2 !== false, t3: p.t3 !== false, dia: p.dia !== false }; };
const querAviso = (p, key) => key.endsWith('|DIA') ? p.dia : p['t' + key.slice(-1)];
// Envia os avisos dos eventos [{ ds, tipos }] para cada aparelho, já filtrados pela UGB e pelos avisos que ele escolheu
export async function enviar(eventos, rows, cfg, { prefixo = '', ignorarTipos = false } = {}) {
  const subs = await listDocs('dashboard_push');
  const cache = {}, chaves = new Set();
  const avisosDa = (ugb) => cache[ugb] || (cache[ugb] = eventos.flatMap(e => montarAvisos(rows, e.ds, cfg, e.tipos, prefixo, ugb)));
  let ok = 0, removidos = 0;
  for (const s of subs) {
    let sub; try { sub = JSON.parse(s.sub); } catch (e) { continue; }
    const p = prefsDe(s);
    for (const a of avisosDa(p.ugb)) {
      chaves.add(a.key);
      if (!ignorarTipos && !querAviso(p, a.key)) continue;
      try { await webpush.sendNotification(sub, JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: `${a.key}|${p.ugb}` }), { TTL: 6 * 3600 }); ok++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await delDoc(`dashboard_push/${s.id}`); removidos++; break; } else console.log('push', e.statusCode, e.body); }
    }
  }
  // Chaves dos avisos que existem (mesmo sem aparelhos), para o registro
  eventos.forEach(e => montarAvisos(rows, e.ds, cfg, e.tipos).forEach(a => chaves.add(a.key)));
  return { ok, removidos, aparelhos: subs.length, chaves: [...chaves], exemplo: avisosDa('Todas') };
}

export default async () => {
  if (!configurarVapid()) { console.log('VAPID não configurado'); return new Response('sem VAPID'); }

  const agora = agoraLocal(), hoje = ymd(agora), h = agora.getUTCHours() + agora.getUTCMinutes() / 60;
  // Turnos que já terminaram e ainda podem ser avisados (até 6 h depois do fim)
  const pendentes = [];
  if (h >= FIM['1'] && h < FIM['1'] + 6) pendentes.push({ t: '1', ds: hoje, fim: `${hoje}T14:00` });
  if (h >= FIM['2'] || h < 4) { const ds = h >= FIM['2'] ? hoje : addDias(hoje, -1); pendentes.push({ t: '2', ds, fim: `${ds}T22:00` }); }
  if (h >= FIM['3'] && h < FIM['3'] + 6) { const ds = addDias(hoje, -1); pendentes.push({ t: '3', ds, fim: `${hoje}T06:00` }); }
  if (!pendentes.length) return new Response('fora do horário');

  const log = (await getDoc('dashboard_config/avisos')) || {};
  let enviados = {}; try { enviados = JSON.parse(log.enviados || '{}'); } catch (e) { enviados = {}; }
  const falta = pendentes.filter(p => !enviados[`${p.ds}|T${p.t}`]);
  if (!falta.length) return new Response('já avisado');

  // Os dados chegaram depois do fim do turno? (hora da última gravação do robô, ou da última planilha importada no app)
  const robo = (await getDoc('dashboard_config/robo')) || {};
  const cfg = (await getDoc('dashboard_config/settings')) || {};
  let ultimaProd = ''; try { ultimaProd = JSON.parse(cfg.ultimaProducao || '{}').at || ''; } catch (e) { /* */ }
  const chegada = [robo.at, ultimaProd].filter(Boolean).map(s => new Date(Date.parse(s) + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 16)).sort().pop() || '';
  const prontos = falta.filter(p => chegada >= p.fim);
  if (!prontos.length) return new Response('aguardando dados');

  const rows = await lerProducao([...new Set(prontos.map(p => p.ds.slice(0, 7)))]);
  const eventos = prontos.map(p => ({ ds: p.ds, tipos: p.t === '3' ? ['3', 'dia'] : [p.t] }));
  if (!eventos.some(e => montarAvisos(rows, e.ds, cfg, e.tipos).length)) return new Response('sem produção do turno ainda');
  const res = await enviar(eventos, rows, cfg);
  res.chaves.forEach(k => { enviados[k] = new Date().toISOString(); });
  // guarda só os últimos 60 registros
  const keep = Object.fromEntries(Object.entries(enviados).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 60));
  await setDoc('dashboard_config/avisos', { enviados: JSON.stringify(keep) });
  return new Response(`avisos: ${res.chaves.join(', ')} · entregas ${res.ok} · removidos ${res.removidos}`);
};
