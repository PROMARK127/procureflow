import assert from 'node:assert/strict';

const base = process.argv[2];
const pin = process.env.DEMO_PIN;
if (!base || !pin) throw new Error('Usage: node --env-file=.env.local scripts/smoke.mjs <base-url>');
const endpoint = new URL('/api/workflow',base);
const home = await fetch(base);
assert.equal(home.status,200);
assert.match(await home.text(),/ProcureFlow/);

async function read() {
  const response = await fetch(endpoint);
  assert.equal(response.status,200);
  return response.json();
}
const initial = await read();
assert.ok(initial.catalog.length >= 5);
assert.ok(initial.requests.length >= 6);
const users = Object.fromEntries(initial.users.map(user => [user.role,user.id]));
const catalog = Object.fromEntries(initial.catalog.map(item => [item.name,item.id]));
async function change(role,action,fields,expected=200,withPin=true) {
  const response = await fetch(endpoint,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:users[role],action,...fields,...(withPin ? {pin} : {})})
  });
  const result = await response.json();
  assert.equal(response.status,expected,action+': '+(result.message ?? ''));
  return result;
}
const fields = {item:catalog['ノートPC'],quantity:1,reason:'動作確認 '+new Date().toISOString()};
const denied = await change('buyer','request',fields,403,false);
assert.equal(denied.code,'VALIDATION');
const {id} = await change('buyer','request',fields);
const query = async () => (await read()).requests.find(row => row.id === id);
assert.equal((await query()).status,'pending');
await change('manager','approve',{id},409);
await change('approver','approve',{id});
assert.equal((await query()).status,'pending');
await change('manager','return',{id,comment:'検証用の差戻し'});
await change('buyer','resubmit',{id,item:catalog['モニター'],quantity:1,reason:fields.reason});
await change('approver','approve',{id});
assert.equal((await query()).status,'approved');
await change('buyer','order',{id},409);
await change('manager','quote',{id,supplier:initial.suppliers[0].id,amount:27000});
await change('manager','quote',{id,supplier:initial.suppliers[1].id,amount:28000});
const quotes = (await read()).quotes.filter(row => row.request_id === id);
assert.equal(quotes.length,2);
await change('manager','select',{id,quote:quotes[0].id,reason:'比較検証'});

const orders = await Promise.all([1,2].map(() => fetch(endpoint,{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({actor:users.buyer,action:'order',id,pin})
})));
assert.deepEqual(orders.map(result => result.status).sort(),[200,409]);
assert.ok((await query()).order_id);
await change('supplier','confirm',{id});
await change('accounting','invoice',{id,amount:27000,date:new Date().toISOString().slice(0,10)});
await change('accounting','pay',{id},409);
await change('buyer','receive',{id,quantity:1});
await change('accounting','pay',{id});
await change('accounting','pay',{id},409);
const settled = await query();
assert.equal(settled.payment_status,'paid');
assert.equal(settled.invoice_amount,settled.order_amount);
assert.equal(settled.received_quantity,settled.order_quantity);
console.log(JSON.stringify({base,requestId:id,orderId:settled.order_id,status:settled.status,pinGuard:403,concurrentOrder:[200,409]}));