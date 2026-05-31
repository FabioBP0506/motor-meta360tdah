# META360TDAH — Automação Formspree → Make → Google Sheets

## Arquitetura

```
Família preenche formulário
        ↓
   Formspree recebe
        ↓
  Make (Webhook) captura
        ↓
  HTTP POST → /api/motor (Netlify Function)
        ↓
  Motor processa + retorna JSON
        ↓
  Google Sheets — nova linha na aba "META360TDAH - Resultados"
```

---

## PASSO 1 — Subir os arquivos no GitHub

Adicione os novos arquivos ao repositório `motor-meta360tdah`:

```
motor-meta360tdah/
├── index.html                        ← já existia
├── netlify.toml                      ← ATUALIZADO
├── make-blueprint.json               ← NOVO (não vai pro GitHub, só para importar)
└── netlify/
    └── functions/
        └── motor.js                  ← NOVO (serverless function)
```

No GitHub, clique em **Add file → Upload files** e suba:
- `netlify.toml` (substituindo o anterior)
- A pasta `netlify/functions/motor.js` — crie a pasta clicando em
  "Add file → Create new file", digite o caminho
  `netlify/functions/motor.js` e cole o conteúdo

O Netlify detecta o push e faz redeploy automático em ~1 minuto.

**Verificar se a function subiu:**
Acesse: `https://SEU-SITE.netlify.app/.netlify/functions/motor`
Deve retornar: `{"erro":"Método não permitido. Use POST."}`
Se aparecer isso = function funcionando.

---

## PASSO 2 — Configurar o Make

### 2a — Importar o blueprint

1. Acesse `make.com` → **Scenarios** → botão **⋯** → **Import Blueprint**
2. Selecione o arquivo `make-blueprint.json`
3. O cenário aparece com 3 módulos: Webhook → HTTP → Google Sheets

### 2b — Configurar o Webhook (Módulo 1)

1. Clique no módulo **Custom WebHook**
2. Clique em **Add** → nomeie: `META360TDAH Formspree`
3. Clique em **Save** — o Make gera uma URL de webhook:
   `https://hook.eu1.make.com/XXXXXXXXXXXXXXXXXXX`
4. **Copie essa URL** — vai usar no Formspree

### 2c — Configurar a URL do Motor (Módulo 2)

1. Clique no módulo **HTTP**
2. No campo **URL**, substitua:
   ```
   https://SEU-SITE.netlify.app/api/motor
   ```
   pela URL real do seu site, ex:
   ```
   https://motor-meta360tdah.netlify.app/api/motor
   ```
3. **Body**: deixe como `{{toJSON(1)}}` — envia todos os campos do Formspree como JSON

### 2d — Configurar o Google Sheets (Módulo 3)

1. Clique no módulo **Google Sheets**
2. Em **Spreadsheet**, selecione `META360TDAH - Resultados`
3. Em **Sheet**, selecione a aba correta
4. O mapeamento de colunas já está preenchido — confira se os
   nomes das colunas batem com os da sua planilha

   **Colunas esperadas na planilha (linha 1 — cabeçalho):**
   ```
   Data | Criança | Responsável | Idade | Período | Usa Medicação |
   Pilar | Pontuação | Nível | Padrão | Itens Altos | Itens Moderados |
   Alertas | Alerta Ativo | Escalonamento Clínico | Leitura Interna |
   Primeiro Movimento | Blocos Indicados | Prazo Reavaliação | Devolutiva
   ```

5. Clique em **OK** → **Save**

---

## PASSO 3 — Conectar o Formspree ao Make

1. Acesse `formspree.io` → seu formulário (ex: F-Medicação)
2. Vá em **Integrations** (ou **Plugins**) → **Webhooks**
3. Cole a URL do webhook do Make:
   `https://hook.eu1.make.com/XXXXXXXXXXXXXXXXXXX`
4. Repita para **cada formulário** (F-Casa, F-Medicação, F-Escola, F-Social, F-Autonomia)
   — todos apontam para o mesmo webhook, o motor identifica o pilar automaticamente

---

## PASSO 4 — Testar

1. No Make, clique em **Run once** no cenário
2. Preencha qualquer formulário com dados de teste
3. Envie — o Formspree dispara o webhook
4. No Make, você vê os dados passando pelos 3 módulos em tempo real
5. Abra a planilha — a linha nova deve aparecer com todos os campos preenchidos

**Se o módulo HTTP retornar erro 404:**
→ A function ainda não fez deploy. Aguarde 1 min e teste novamente.

**Se o Google Sheets reclamar de coluna não encontrada:**
→ Verifique se a linha 1 da planilha tem exatamente os cabeçalhos listados acima.

---

## PASSO 5 — Ativar o cenário

Após o teste funcionar, ative o cenário clicando no toggle **OFF → ON**.
A partir daí, cada formulário enviado gera uma linha nova na planilha automaticamente.

---

## Endpoint da API (para referência)

```
POST https://SEU-SITE.netlify.app/api/motor
Content-Type: application/json

Body: payload JSON do Formspree
```

**Resposta de exemplo:**
```json
{
  "nome_crianca": "João",
  "pilar": "Clínico-Medicamentoso",
  "pontuacao_total": "6/25",
  "nivel_label": "Nível 1 — Manutenção ativa",
  "codigo_padrao": "PM00",
  "primeiro_movimento": "Manter vigilância estruturada...",
  "escalonamento_clinico": "NÃO",
  "devolutiva": "RASCUNHO DE DEVOLUTIVA..."
}
```
