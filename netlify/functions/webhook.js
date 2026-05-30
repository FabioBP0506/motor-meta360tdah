// netlify/functions/webhook.js
// Recebe POST do Formspree, processa com logica do Motor META360TDAH
// e grava resultado na Google Sheets

const SHEET_ID = process.env.SHEET_ID;
const SA_JSON  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

// ─── JWT / Google Auth ────────────────────────────────────────────────────────
async function getAccessToken() {
  const sa = JSON.parse(SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = b64(header) + '.' + b64(payload);

  // Assinar com RSA-SHA256 usando a chave privada da service account
  const crypto = await import('node:crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = signingInput + '.' + signature;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ─── parsePayload ─────────────────────────────────────────────────────────────
function parsePayload(txt) {
  const obj = {};
  const raw = txt.replace(/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}.*[\n\r]+/, '').trim();
  if (raw.indexOf('* ') !== -1) {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    let key = null;
    for (const line of lines) {
      if (line.startsWith('* ')) {
        key = line.slice(2).trim().replace(/-/g, '_');
      } else if (key) {
        obj[key] = line;
        key = null;
      }
    }
  } else {
    const blocos = raw.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);
    let startIdx = 0;
    for (let s = 0; s < blocos.length; s++) {
      if (/^[a-z_][a-z0-9_]*$/.test(blocos[s])) { startIdx = s; break; }
    }
    for (let i = startIdx; i < blocos.length - 1; i += 2) {
      const ch = blocos[i].trim().replace(/-/g, '_');
      const vl = blocos[i + 1].trim();
      if (ch && vl && /^[a-z_][a-z0-9_]*$/.test(ch)) obj[ch] = vl;
    }
    if (Object.keys(obj).length === 0 && blocos.length >= 2) {
      for (let i = 0; i < blocos.length - 1; i += 2) {
        const ch = blocos[i].trim().replace(/-/g, '_');
        const vl = blocos[i + 1].trim();
        if (ch && vl && !ch.includes(' ')) obj[ch] = vl;
      }
    }
  }
  return obj;
}

// ─── PILARES ─────────────────────────────────────────────────────────────────
const PILARES = {
  F_MEDICACAO: { nome: 'Clinico-Medicamentoso', campos: ['med_01','med_02','med_03','med_04','med_05'] },
  F_CASA:      { nome: 'Familiar-Domiciliar',   campos: ['cas_01','cas_02','cas_03','cas_04','cas_05'] },
  F_ESCOLA:    { nome: 'Escolar',               campos: ['esc_01','esc_02','esc_03','esc_04','esc_05'] },
  F_SOCIAL:    { nome: 'Social-Relacional',     campos: ['soc_01','soc_02','soc_03','soc_04','soc_05'] },
  F_AUTONOMIA: { nome: 'Autonomia-Executiva',   campos: ['aut_01','aut_02','aut_03','aut_04','aut_05'] },
};

// ─── processarLogica ──────────────────────────────────────────────────────────
function processarLogica(dados) {
  // Identificar pilar
  let pilarKey = dados.id_formulario || '';
  if (!pilarKey && dados._subject) {
    const sub = dados._subject.toLowerCase();
    if (sub.includes('medic'))     pilarKey = 'F_MEDICACAO';
    else if (sub.includes('casa')) pilarKey = 'F_CASA';
    else if (sub.includes('escol')) pilarKey = 'F_ESCOLA';
    else if (sub.includes('social')) pilarKey = 'F_SOCIAL';
    else if (sub.includes('auto'))  pilarKey = 'F_AUTONOMIA';
  }
  const pilar = PILARES[pilarKey];
  if (!pilar) return null;

  // Calcular soma
  const itens = pilar.campos.map((c, idx) => ({
    id: idx + 1,
    nota: parseInt(dados[c] || '0', 10),
  }));
  const soma = itens.reduce((s, i) => s + i.nota, 0);

  // Nivel
  let nivel, nivelLabel;
  if      (soma <= 5)  { nivel = 0; nivelLabel = 'Nivel 0 - Sem indicadores'; }
  else if (soma <= 10) { nivel = 1; nivelLabel = 'Nivel 1 - Suporte universal'; }
  else if (soma <= 15) { nivel = 2; nivelLabel = 'Nivel 2 - Suporte preventivo-focal'; }
  else if (soma <= 20) { nivel = 3; nivelLabel = 'Nivel 3 - Suporte intensivo'; }
  else                 { nivel = 4; nivelLabel = 'Nivel 4 - Intervencao critica'; }

  // Chave de combinacao
  const altos     = itens.filter(i => i.nota >= 4).map(i => 'M' + i.id);
  const moderados = itens.filter(i => i.nota === 3).map(i => 'M' + i.id);
  const chave = altos.length > 0 ? altos.join(',') : moderados.join(',');
  const prefixo = pilarKey === 'F_MEDICACAO' ? 'PM' :
                  pilarKey === 'F_CASA'      ? 'PC' :
                  pilarKey === 'F_ESCOLA'    ? 'PE' :
                  pilarKey === 'F_SOCIAL'    ? 'PS' : 'PA';
  const padrao = chave ? prefixo + chave.replace(/M/g,'').replace(/,/g,'') : prefixo + '00';

  return {
    pilarKey,
    pilarNome: pilar.nome,
    nomeCrianca: dados.nome_crianca || '',
    responsavel: dados.responsavel || '',
    idade: dados.idade || '',
    periodo: dados.periodo_observado || '',
    soma,
    nivel,
    nivelLabel,
    padrao,
    itens,
    alertas: dados.alertas_resumo || '',
    usaMedicacao: dados.usa_medicacao || '',
    mudancaRecente: dados.mudanca_recente || '',
    geradoEm: new Date().toLocaleDateString('pt-BR'),
  };
}

// ─── Gravar no Sheets ─────────────────────────────────────────────────────────
async function appendToSheet(token, resultado) {
  const row = [
    resultado.geradoEm,
    resultado.pilarNome,
    resultado.nomeCrianca,
    resultado.responsavel,
    resultado.idade,
    resultado.periodo,
    resultado.soma + '/25',
    resultado.nivelLabel,
    resultado.padrao,
    resultado.alertas,
    resultado.usaMedicacao,
    resultado.mudancaRecente,
  ];
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });
  const data = await resp.json();
  if (resp.status !== 200) throw new Error('Sheets error: ' + JSON.stringify(data));
  return data;
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    // Formspree envia JSON ou form-encoded
    let body = event.body || '';
    if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf-8');

    let dados = {};
    const ct = (event.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json')) {
      dados = JSON.parse(body);
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body);
      params.forEach((v, k) => { dados[k] = v; });
    } else {
      // Tentar como texto (formato e-mail)
      dados = parsePayload(body);
    }

    const resultado = processarLogica(dados);
    if (!resultado) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'Pilar nao identificado' }) };
    }

    const token = await getAccessToken();
    await appendToSheet(token, resultado);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, padrao: resultado.padrao, soma: resultado.soma }),
    };
  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
