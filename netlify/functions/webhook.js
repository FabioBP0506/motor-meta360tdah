// netlify/functions/webhook.js
// Recebe POST do formulario, processa com logica do Motor META360TDAH
// e envia resultado para o Make (que grava na Google Sheets)

const MAKE_WEBHOOK_URL = 'https://hook.us2.make.com/3b05wkwmvac3m3jf19vrjter30eggd5n';

// --- parsePayload -----------------------------------------------------------

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

// --- PILARES ----------------------------------------------------------------

const PILARES = {
    F_MEDICACAO: { nome: 'Clinico-Medicamentoso', campos: ['med_01','med_02','med_03','med_04','med_05'] },
    F_CASA:      { nome: 'Familiar-Domiciliar',   campos: ['cas_01','cas_02','cas_03','cas_04','cas_05'] },
    F_ESCOLA:    { nome: 'Escolar',               campos: ['esc_01','esc_02','esc_03','esc_04','esc_05'] },
    F_SOCIAL:    { nome: 'Social-Relacional',     campos: ['soc_01','soc_02','soc_03','soc_04','soc_05'] },
    F_AUTONOMIA: { nome: 'Autonomia-Executiva',   campos: ['aut_01','aut_02','aut_03','aut_04','aut_05'] },
};

// --- processarLogica --------------------------------------------------------

function processarLogica(dados) {
    let pilarKey = dados.id_formulario || '';
    if (!pilarKey && dados._subject) {
          const sub = dados._subject.toLowerCase();
          if (sub.includes('medic'))      pilarKey = 'F_MEDICACAO';
          else if (sub.includes('casa'))  pilarKey = 'F_CASA';
          else if (sub.includes('escol')) pilarKey = 'F_ESCOLA';
          else if (sub.includes('social')) pilarKey = 'F_SOCIAL';
          else if (sub.includes('auto'))  pilarKey = 'F_AUTONOMIA';
    }

  const pilar = PILARES[pilarKey];
    if (!pilar) return null;

  const itens = pilar.campos.map((c, idx) => ({
        id: idx + 1,
        nota: parseInt(dados[c] || '0', 10),
  }));
    const soma = itens.reduce((s, i) => s + i.nota, 0);

  let nivel, nivelLabel;
    if      (soma <= 5)  { nivel = 0; nivelLabel = 'Nivel 0 - Sem indicadores'; }
    else if (soma <= 10) { nivel = 1; nivelLabel = 'Nivel 1 - Suporte universal'; }
    else if (soma <= 15) { nivel = 2; nivelLabel = 'Nivel 2 - Suporte preventivo-focal'; }
    else if (soma <= 20) { nivel = 3; nivelLabel = 'Nivel 3 - Suporte intensivo'; }
    else                 { nivel = 4; nivelLabel = 'Nivel 4 - Intervencao critica'; }

  const altos     = itens.filter(i => i.nota >= 4).map(i => 'M' + i.id);
    const moderados = itens.filter(i => i.nota === 3).map(i => 'M' + i.id);
    const chave = altos.length > 0 ? altos.join(',') : moderados.join(',');

  const prefixo = pilarKey === 'F_MEDICACAO' ? 'PM' :
                      pilarKey === 'F_CASA'      ? 'PC' :
                      pilarKey === 'F_ESCOLA'    ? 'PE' :
                      pilarKey === 'F_SOCIAL'    ? 'PS' : 'PA';

  const padrao = chave ? prefixo + chave.replace(/M/g,'').replace(/,/g,'') : prefixo + '00';

  const itensAltos     = altos.length > 0 ? altos.join(', ') : '-';
    const itensModerados = moderados.length > 0 ? moderados.join(', ') : '-';

  return {
        id_formulario:           pilarKey,
        pilar:                   pilar.nome,
        nome_crianca:            dados.nome_crianca || '',
        responsavel:             dados.responsavel || '',
        idade:                   dados.idade || '',
        periodo:                 dados.periodo_observado || dados.periodo || '',
        usa_medicacao:           dados.usa_medicacao || '',
        resultado_pontuacao:     soma + '/25',
        resultado_nivel:         nivelLabel,
        resultado_interpretacao: padrao,
        resultado_conduta:       dados.conduta || '',
        resultado_reavaliacao:   dados.reavaliacao || '',
        alertas_resumo:          dados.alertas_resumo || '',
        itens_altos:             itensAltos,
        itens_moderados:         itensModerados,
  };
}

// --- Handler principal ------------------------------------------------------

export async function handler(event) {
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, body: 'Method Not Allowed' };
    }

  try {
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
                dados = parsePayload(body);
        }

      const resultado = processarLogica(dados);

      if (!resultado) {
              return {
                        statusCode: 200,
                        body: JSON.stringify({ ok: false, error: 'Pilar nao identificado' }),
              };
      }

      // Enviar para o Make webhook (Make grava na Google Sheets)
      const makeResp = await fetch(MAKE_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resultado),
      });

      if (!makeResp.ok) {
              const errText = await makeResp.text();
              throw new Error('Make webhook error: ' + makeResp.status + ' ' + errText);
      }

      return {
              statusCode: 200,
              body: JSON.stringify({
                        ok: true,
                        padrao: resultado.resultado_interpretacao,
                        soma: resultado.resultado_pontuacao,
              }),
      };

  } catch (err) {
        console.error('Webhook error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
