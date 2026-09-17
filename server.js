const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.PAGBANK_TOKEN;
const HTML = path.join(__dirname, 'snake_store.html');

function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body='';
    req.on('data', chunk => { body += chunk; if(body.length > 1000000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

async function createPix(req, res) {
  if (!TOKEN) return json(res, 500, {error:'PAGBANK_TOKEN não configurado no servidor.'});
  let body;
  try { body = await readBody(req); } catch { return json(res,400,{error:'JSON inválido.'}); }
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!name || !email || !items.length) return json(res,400,{error:'Nome, e-mail e itens são obrigatórios.'});

  const safeItems = items.map((x,i) => ({
    reference_id: String(x.reference_id || `snake-${i+1}`),
    name: String(x.name || 'Produto Snake').slice(0,100),
    quantity: 1,
    unit_amount: Math.round(Number(x.unit_amount || 0))
  }));
  if (safeItems.some(x => !Number.isFinite(x.unit_amount) || x.unit_amount <= 0)) return json(res,400,{error:'Valor de produto inválido.'});

  const expires = new Date(Date.now() + 30*60*1000).toISOString();
  const payload = {
    reference_id: `SNAKE-${Date.now()}`,
    customer: { name: name.slice(0,100), email: email.slice(0,100) },
    items: safeItems,
    charges: [{
      reference_id: `SNAKE-PIX-${Date.now()}`,
      description: 'Compra Snake Bypass',
      amount: { value: safeItems.reduce((sum,x)=>sum+x.unit_amount,0), currency:'BRL' },
      payment_method: { type:'PIX', pix:{ expiration_date: expires } }
    }]
  };

  try {
    const r = await fetch('https://sandbox.api.pagseguro.com/orders', {
      method:'POST',
      headers:{'Authorization':`Bearer ${TOKEN}`,'Accept':'application/json','Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) return json(res,r.status,{error:data?.message || 'PagBank recusou a criação do pedido.', details:data});
    const charge = data?.charges?.[0];
    const qr = charge?.qr_code;
    const links = charge?.links || [];
    const png = links.find(x=>x.rel==='QRCODE.PNG')?.href;
    const text = qr?.text;
    if (!png || !text) return json(res,502,{error:'PagBank criou o pedido, mas não retornou o QR Code esperado.', details:data});
    return json(res,200,{order_id:data.id, status:charge.status, qr_code_image:png, pix_copy_paste:text});
  } catch (e) {
    return json(res,502,{error:'Falha ao conectar ao PagBank Sandbox.', details:String(e.message || e)});
  }
}

const server = http.createServer((req,res)=>{
  if(req.method==='POST' && req.url==='/api/create-pix') return createPix(req,res);
  if(req.method==='GET' && req.url==='/api/health') return json(res,200,{ok:true,sandbox:true});
  if(req.method==='GET' && (req.url==='/' || req.url==='/snake_store.html')) {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    return fs.createReadStream(HTML).pipe(res);
  }
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');
});

server.listen(PORT,()=>console.log(`Snake Store rodando em http://localhost:${PORT}`));
