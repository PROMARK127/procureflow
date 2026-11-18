import type { PoolClient } from 'pg';
export class Problem extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function rule(ok: unknown, message: string, code = 'BUSINESS_RULE'): asserts ok {
  if (!ok) throw new Problem(code, message, code === 'BUSINESS_RULE' ? 409 : 400);
}
function number(input: unknown, min = 1) {
  rule(typeof input === 'number' && Number.isInteger(input) && input >= min && input <= 2147483647, '入力した数値を確認してください', 'VALIDATION');
  return input;
}
function note(input: unknown, required = false) {
  const text = typeof input === 'string' ? input.trim() : '';
  rule(text.length <= 1000 && (!required || text.length > 0), 'コメント・理由は1〜1000文字で入力してください', 'VALIDATION');
  return text;
}
export async function mutate(db: Pick<PoolClient,'query'>, input: Record<string,unknown>) {
  const query = (sql: string, values: unknown[] = []) => db.query(sql, values);
  const one = async (sql: string, values: unknown[]) => (await query(sql,values)).rows[0];
  const actor = await one('SELECT * FROM users WHERE id=$1',[number(input.actor)]);
  rule(actor,'担当者を確認してください','MASTER_DATA');
  const action = input.action;
  const requireRole = (role: string) => rule(actor.role === role, 'この操作に必要な担当者へ切り替えてください');
  let id = action === 'request' ? 0 : number(input.id);
  const request = id ? await one('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE',[id]) : null;
  if (id) rule(request,'申請が見つかりません','VALIDATION');
  const owns = () => { requireRole('buyer'); rule(request.buyer_id === actor.id,'自分の申請のみ操作できます'); };
  switch (action) {
    case 'request':
    case 'resubmit': {
      requireRole('buyer');
      const quantity = number(input.quantity);
      const item = await one('SELECT * FROM catalog_items WHERE id=$1 AND active',[number(input.item)]);
      rule(item,'この商品はカタログで選択できません','MASTER_DATA');
      const total = number(quantity * item.price);
      const reason = note(input.reason,true);
      let round = 1;
      if (action === 'resubmit') {
        owns();
        rule(request.status === 'returned','差戻し中の申請のみ再申請できます');
        round = request.round + 1;
        await query("UPDATE purchase_requests SET total=$2, reason=$3, round=$4,status='pending' WHERE id=$1",[id,total,reason,round]);
        await query('UPDATE purchase_request_items SET item_id=$2,quantity=$3,price=$4 WHERE request_id=$1',[id,item.id,quantity,item.price]);
      } else {
        id = (await one("INSERT INTO purchase_requests(buyer_id,department,reason,total,status) VALUES($1,$2,$3,$4,'pending') RETURNING id",[actor.id,actor.department,reason,total])).id;
        await query('INSERT INTO purchase_request_items VALUES($1,$2,$3,$4)',[id,item.id,quantity,item.price]);
      }
      await query("INSERT INTO approval_steps(request_id,round,step,role) VALUES($1,$2,1,'approver')",[id,round]);
      if (total >= 100000) await query("INSERT INTO approval_steps(request_id,round,step,role) VALUES($1,$2,2,'manager')",[id,round]);
      break;
    }
    case 'approve':
    case 'return':
    case 'reject': {
      rule(request.status === 'pending','承認待ちの申請のみ処理できます');
      const step = await one('SELECT * FROM approval_steps WHERE request_id=$1 AND round=$2 AND decision IS NULL ORDER BY step LIMIT 1',[id,request.round]);
      rule(step && step.role === actor.role && (actor.role !== 'approver' || actor.department === request.department),'現在の承認順序と担当部門を確認してください');
      await query('UPDATE approval_steps SET decision=$4,actor_id=$5,comment=$6,acted_at=now() WHERE request_id=$1 AND round=$2 AND step=$3',[id,request.round,step.step,action,actor.id,note(input.comment,action !== 'approve')]);
      const next = action === 'approve' ? await one('SELECT 1 FROM approval_steps WHERE request_id=$1 AND round=$2 AND decision IS NULL',[id,request.round]) : null;
      await query('UPDATE purchase_requests SET status=$2 WHERE id=$1',[id,action === 'approve' ? (next ? 'pending' : 'approved') : action === 'return' ? 'returned' : 'rejected']);
      break;
    }
    case 'quote': {
      requireRole('manager');
      rule(request.status === 'approved','承認完了後に見積を登録できます');
      const supplier = number(input.supplier);
      rule(await one('SELECT 1 FROM suppliers WHERE id=$1',[supplier]),'仕入先が見つかりません','MASTER_DATA');
      const quotes = (await query('SELECT supplier_id,decision FROM quotations WHERE request_id=$1',[id])).rows;
      rule(quotes.length < 2 && !quotes.some(q => q.supplier_id === supplier || q.decision),'見積は異なる2社まで登録できます');
      await query('INSERT INTO quotations(request_id,supplier_id,amount) VALUES($1,$2,$3)',[id,supplier,number(input.amount)]);
      break;
    }
    case 'select': {
      requireRole('manager');
      rule(request.status === 'approved','承認完了後に採用できます');
      const quote = number(input.quote);
      const quotes = (await query('SELECT id FROM quotations WHERE request_id=$1',[id])).rows;
      rule(quotes.length === 2 && quotes.some(q => q.id === quote),'2社の見積から採用先を選択してください');
      await query("UPDATE quotations SET decision='declined',selection_reason=NULL WHERE request_id=$1",[id]);
      await query("UPDATE quotations SET decision='selected',selection_reason=$3 WHERE request_id=$1 AND id=$2",[id,quote,note(input.reason,true)]);
      break;
    }
    case 'order': {
      owns();
      rule(request.status === 'approved','承認済みかつ未発注の申請のみ発注できます');
      const quote = await one("SELECT * FROM quotations WHERE request_id=$1 AND decision='selected'",[id]);
      rule(quote,'採用見積を決定してください');
      rule(quote.amount <= request.total,'見積が承認額を超えています。新たに申請してください');
      await query('INSERT INTO purchase_orders(request_id,quote_id,supplier_id,amount,quantity,buyer_id) SELECT $1,$2,$3,$4,quantity,$5 FROM purchase_request_items WHERE request_id=$1',[id,quote.id,quote.supplier_id,quote.amount,actor.id]);
      await query("UPDATE purchase_requests SET status='ordered' WHERE id=$1",[id]);
      break;
    }
    case 'confirm':
    case 'receive':
    case 'invoice':
    case 'pay': {
      const order = await one('SELECT o.*,s.user_id FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.request_id=$1',[id]);
      rule(order,'先に発注してください');
      if (action === 'confirm') {
        requireRole('supplier');
        rule(order.user_id === actor.id && order.status === 'issued','担当仕入先の未確認発注のみ確認できます');
        await query("UPDATE purchase_orders SET status='confirmed',confirmed_at=now() WHERE id=$1",[order.id]);
      } else if (action === 'receive') {
        owns();
        rule(request.status === 'ordered','未検収の発注のみ検収できます');
        const quantity = number(input.quantity,0);
        rule(quantity <= order.quantity,'受領数量が発注数量を超えています');
        await query('INSERT INTO receipts(order_id,actor_id,quantity,result) VALUES($1,$2,$3,$4)',[order.id,actor.id,quantity,quantity === order.quantity ? 'complete' : 'short']);
        await query("UPDATE purchase_orders SET status='received' WHERE id=$1",[order.id]);
        await query("UPDATE purchase_requests SET status='received' WHERE id=$1",[id]);
      } else {
        requireRole('accounting');
        const invoice = await one('SELECT * FROM invoices WHERE order_id=$1',[order.id]);
        if (action === 'invoice') {
          rule(!invoice,'請求は登録済みです');
          const date = input.date;
          rule(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date,'請求日を確認してください','VALIDATION');
          await query('INSERT INTO invoices(order_id,amount,invoice_date) VALUES($1,$2,$3)',[order.id,number(input.amount),date]);
        } else {
          rule(invoice && invoice.status === 'unpaid','未払いの請求を登録してください');
          const receipt = await one('SELECT * FROM receipts WHERE order_id=$1',[order.id]);
          rule(receipt,'検収が完了していません');
          rule(receipt.quantity === order.quantity && receipt.result === 'complete','発注数量と検収数量が一致しません');
          rule(invoice.amount === order.amount,'発注金額と請求金額が一致しません');
          await query("UPDATE invoices SET status='paid',paid_at=now() WHERE id=$1",[invoice.id]);
          await query("UPDATE purchase_orders SET status='paid' WHERE id=$1",[order.id]);
          await query("UPDATE purchase_requests SET status='paid' WHERE id=$1",[id]);
        }
      }
      break;
    }
    default: throw new Problem('VALIDATION','操作の指定を確認してください');
  }
  const { pin, ...detail } = input;
  await query('INSERT INTO audit_logs(request_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[id,actor.id,action,JSON.stringify(detail)]);
  return {id};
}