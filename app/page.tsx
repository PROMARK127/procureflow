'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

type User = {id:number; name:string; department:string; role:string};
type Item = {id:number; name:string; price:number; active:boolean};
type Supplier = {id:number; name:string};
type Transaction = {id:number; buyer_id:number; buyer:string; department:string; item:string; item_id:number; quantity:number; price:number; total:number; status:string; reason:string; round:number; order_id:number|null; order_status:string|null; order_amount:number|null; order_quantity:number|null; received_quantity:number|null; supplier:string|null; supplier_user_id:number|null; invoice_id:number|null; invoice_amount:number|null; payment_status:string|null; created_at:string; ordered_at:string|null; confirmed_at:string|null; received_at:string|null; invoice_date:string|null; paid_at:string|null};
type Step = {request_id:number; round:number; step:number; role:string; decision:string|null; actor:string|null; comment:string|null; acted_at:string|null};
type Quote = {id:number; request_id:number; supplier:string; supplier_id:number; amount:number; decision:string|null; selection_reason:string|null; quoted_at:string};
type Audit = {id:string; request_id:number; action:string; actor:string; created_at:string};
type Data = {users:User[]; catalog:Item[]; suppliers:Supplier[]; requests:Transaction[]; steps:Step[]; quotes:Quote[]; audit:Audit[]};
const screens = ['ダッシュボード','商品カタログ','購入申請','承認管理','見積・発注管理','検収・支払管理','申請・取引履歴','取引追跡・問い合わせ確認'];
const roles:Record<string,string> = {buyer:'購入者',approver:'承認者',manager:'購買責任者',supplier:'サプライヤー',accounting:'経理担当'};
const states:Record<string,string> = {pending:'承認待ち',returned:'差戻し',rejected:'却下',approved:'承認済み',ordered:'発注済み',received:'検収済み',paid:'支払完了'};
const actions:Record<string,string> = {request:'申請',resubmit:'再申請',approve:'承認',return:'差戻し',reject:'却下',quote:'見積登録',select:'採用決定',order:'発注',confirm:'発注確認',receive:'検収',invoice:'請求登録',pay:'支払完了'};
const currency = (amount:number|null) => amount === null ? '—' : new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(amount);
const code = (prefix:string,id:number) => prefix+'-'+String(id).padStart(5,'0');
const when = (date:string|null) => date ? (date.length === 10 ? date : new Intl.DateTimeFormat('ja-JP',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tokyo'}).format(new Date(date))) : '—';
const numeric = new Set(['item','quantity','supplier','amount','quote']);
function Field({name,label,children}:{name:string;label:string;children:ReactNode}) {
  return <label>{label}{children}</label>;
}
export default function Home() {
  const [data,setData] = useState<Data|null>(null);
  const [user,setUser] = useState(0);
  const [screen,setScreen] = useState(0);
  const [selected,setSelected] = useState<number|null>(null);
  const [search,setSearch] = useState('');
  const [lookup,setLookup] = useState('');
  const [pin,setPin] = useState('');
  const [item,setItem] = useState<number|null>(null);
  const [message,setMessage] = useState<{text:string;error:boolean}|null>(null);
  const [busy,setBusy] = useState(false);
  const actor = data?.users.find(entry => entry.id === user) ?? data?.users[0];
  const role = actor?.role;
  const rows = data?.requests.filter(row => role !== 'supplier' || row.supplier_user_id === actor?.id) ?? [];
  const current = rows.find(row => row.id === selected);
  const steps = data?.steps.filter(step => step.request_id === selected) ?? [];
  const quotes = data?.quotes.filter(quote => quote.request_id === selected) ?? [];
  const chosen = quotes.find(quote => quote.decision === 'selected');
  const nextStep = current?.status === 'pending' ? steps.find(step => step.round === current.round && !step.decision) : undefined;
  async function refresh() {
    const response = await fetch('/api/workflow',{cache:'no-store'});
    const body = await response.json();
    if (!response.ok) throw new Error(body.code+' · '+body.message);
    setData(body);
  }
  useEffect(() => { refresh().catch(error => setMessage({text:error.message,error:true})); }, []);
  function navigate(index:number) {
    setScreen(index);
    setSelected(null);
    setMessage(null);
  }
  async function submit(event:FormEvent<HTMLFormElement>,action:string,id?:number) {
    event.preventDefault();
    if (!actor || busy) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    action = submitter?.value || action;
    const input = Object.fromEntries(Array.from(new FormData(event.currentTarget)).map(([key,value]) => [key,numeric.has(key) ? Number(value) : value]));
    setBusy(true);
    try {
      const response = await fetch('/api/workflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,pin,action,id,actor:actor.id})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.code+' · '+body.message);
      setSelected(body.id);
      setMessage({text:actions[action]+'を記録しました',error:false});
      try { await refresh(); } catch { setMessage({text:'更新は保存されました。画面の再読み込みに失敗しました。再取得してください。',error:true}); }
    } catch (error) { setMessage({text:error instanceof Error ? error.message : '処理に失敗しました',error:true}); }
    finally { setBusy(false); }
  }
  function editor(action:string, children?:ReactNode, id?:number) {
    return <form className="editor" key={action+'-'+id} onSubmit={event => submit(event,action,id)}>{children}<button className="primary" disabled={busy}>{actions[action]}</button></form>;
  }
  function application(row?:Transaction) {
    return editor(row ? 'resubmit' : 'request',<>
      <Field name="item" label="商品"><select name="item" required defaultValue={row?.item_id ?? item ?? ''}><option value="" disabled>商品を選択</option>{data?.catalog.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name} / {currency(c.price)}</option>)}</select></Field>
      <Field name="quantity" label="数量"><input name="quantity" type="number" required min="1" defaultValue={row?.quantity ?? 1}/></Field>
      <Field name="reason" label="申請理由"><textarea name="reason" required maxLength={1000} defaultValue={row?.reason}/></Field>
    </>,row?.id);
  }
  function table(entries:Transaction[]) {
    return entries.length ? <div className="scroll"><table><thead><tr><th>申請番号</th><th>商品</th><th>申請者</th><th>申請額</th><th>発注番号</th><th>状態</th></tr></thead><tbody>{entries.map(row => <tr key={row.id}><td><button className="link" onClick={() => setSelected(row.id)}>{code('PR',row.id)}</button></td><td>{row.item} × {row.quantity}</td><td>{row.buyer}</td><td>{currency(row.total)}</td><td>{row.order_id ? code('PO',row.order_id) : '—'}</td><td><span className={'status '+row.status}>{states[row.status]}</span></td></tr>)}</tbody></table></div> : <p className="muted">該当する取引はありません。</p>;
  }
  const waiting = rows.filter(row => row.status === 'pending' && data?.steps.find(s => s.request_id === row.id && s.round === row.round && !s.decision)?.role === role);
  const spending = rows.reduce((sum,row) => sum + (row.order_amount ?? 0),0);
  const history = data?.audit.filter(log => log.request_id === selected) ?? [];
  const diagnosis = !current ? [] : [
    current.status === 'pending' && '承認待ちです。現在の担当は '+(roles[nextStep?.role ?? ''] ?? '要確認')+' です。',
    current.status === 'returned' && '差戻しコメントを確認し、申請を修正してください。',
    current.status === 'rejected' && '却下済みのため発注できません。',
    current.status === 'approved' && (!chosen ? '発注には見積採用が必要です。' : chosen.amount > current.total ? '見積額が承認額を超過しています。新規申請が必要です。' : '発注できます。'),
    current.order_id && current.received_quantity === null && '検収が未登録です。',
    current.received_quantity !== null && current.received_quantity !== current.order_quantity && '発注数量と検収数量が一致しません。',
    current.order_id && !current.invoice_id && '請求が未登録です。',
    current.invoice_id && current.invoice_amount !== current.order_amount && '発注金額と請求金額が一致しません。',
    current.payment_status === 'paid' && '支払完了が記録されています。'
  ].filter(Boolean);
  return <div className="shell">
    <aside><div className="brand"><span>PF</span><div>ProcureFlow<small>購買管理システム</small></div></div><nav>{screens.map((label,index) => <button key={label} className={screen === index ? 'active' : ''} onClick={() => navigate(index)}>{label}</button>)}</nav><div className="org">東都テクノロジー株式会社</div></aside>
    <main><header><div><p>購買管理</p><h1>{screens[screen]}</h1></div><div className="identity"><Field name="user" label="デモ担当者"><select name="user" value={actor?.id ?? ''} onChange={event => {setUser(+event.target.value);setSelected(null);}}>{data?.users.map(entry => <option key={entry.id} value={entry.id}>{roles[entry.role]} · {entry.name}</option>)}</select></Field><Field name="pin" label="更新PIN"><input id="pin" type="password" autoComplete="off" value={pin} onChange={event => setPin(event.target.value)}/></Field></div></header>
    {message && <div role={message.error ? 'alert' : 'status'} className={message.error ? 'notice error' : 'notice'}>{message.text}</div>}
    {!data && <section><p>{message ? 'データを取得できませんでした。' : 'データを取得しています…'}</p>{message && <button onClick={() => refresh().then(() => setMessage(null)).catch(error => setMessage({text:error.message,error:true}))}>再取得</button>}</section>}
    {data && <>
      {screen === 0 && <><div className="metrics">{[['取引件数',rows.length],['承認待ち',rows.filter(r=>r.status==='pending').length],['支払完了',rows.filter(r=>r.status==='paid').length],['発注総額',currency(spending)]].map(([label,value]) => <section key={label}><p>{label}</p><strong>{value}</strong></section>)}</div><section><h2>最近の取引</h2>{table(rows.slice(0,8))}</section></>}
      {screen === 1 && <section><Field name="search" label="商品名で検索"><input name="search" value={search} onChange={event => setSearch(event.target.value)}/></Field><div className="catalog">{data.catalog.filter(c => c.name.includes(search)).map(c => <article key={c.id}><h2>{c.name}</h2><p>{currency(c.price)}</p>{c.active && role === 'buyer' ? <button onClick={() => {setItem(c.id);navigate(2);}}>申請に追加</button> : !c.active ? <p>選択不可 · MASTER_DATA</p> : null}</article>)}</div></section>}
      {screen === 2 && <section><h2>新規購入申請</h2>{role === 'buyer' ? application() : <p>購入者へ切り替えると申請できます。</p>}</section>}
      {screen === 3 && <section><h2>担当の承認待ち</h2>{table(waiting)}<h2>申請一覧</h2>{table(rows)}</section>}
      {screen === 4 && <section><h2>{role === 'supplier' ? '担当仕入先への発注' : '見積・発注対象'}</h2>{table(rows.filter(r => r.status === 'approved' || r.order_id))}</section>}
      {screen === 5 && <section><h2>発注済みの取引</h2>{table(rows.filter(r=>r.order_id))}</section>}
      {screen === 6 && <section><h2>全取引</h2>{table(rows)}</section>}
      {screen === 7 && <section><form className="editor" onSubmit={event => {event.preventDefault();const input=lookup.trim().toUpperCase();const match=/^(PR|PO)-?(\d+)$/.exec(input);const found=match && rows.find(r => (match[1]==='PR' ? r.id : r.order_id) === +match[2]);setSelected(found ? found.id : null);setMessage(found ? null : {text:'VALIDATION · 該当する申請番号または発注番号がありません',error:true});}}><Field name="lookup" label="申請番号または発注番号"><input name="lookup" placeholder="PR-00001 / PO-00001" required value={lookup} onChange={event=>setLookup(event.target.value)}/></Field><button className="primary">検索</button></form></section>}
      {current && <section className="detail"><div className="section-head"><h2>{code('PR',current.id)} · {current.item}</h2><button onClick={() => setSelected(null)}>閉じる</button></div>
      <dl><div><dt>状態</dt><dd>{states[current.status]}</dd></div><div><dt>申請者</dt><dd>{current.buyer} / {current.department}</dd></div><div><dt>申請日</dt><dd>{when(current.created_at)}</dd></div><div><dt>申請金額</dt><dd>{currency(current.total)}（{currency(current.price)} × {current.quantity}）</dd></div><div><dt>申請理由</dt><dd>{current.reason}</dd></div></dl>
      {current.order_id && <dl><div><dt>発注番号・仕入先</dt><dd>{code('PO',current.order_id)} / {current.supplier}</dd></div><div><dt>発注額・数量</dt><dd>{currency(current.order_amount)} / {current.order_quantity}個</dd></div><div><dt>発注・確認日時</dt><dd>{when(current.ordered_at)} / {when(current.confirmed_at)}</dd></div><div><dt>検収</dt><dd>{current.received_quantity === null ? '未登録' : current.received_quantity+'個 · '+when(current.received_at)}</dd></div><div><dt>請求・支払</dt><dd>{currency(current.invoice_amount)} / {when(current.invoice_date)} / {current.payment_status === 'paid' ? '支払済み '+when(current.paid_at) : '未払い'}</dd></div></dl>}
      <h3>承認経路・履歴</h3><ul>{steps.map(step => <li key={step.round+'-'+step.step}>第{step.round}回 / {step.step}段階 · {roles[step.role]} · {step.decision ? actions[step.decision]+' '+step.actor+' '+when(step.acted_at) : current.status === 'pending' && step.round === current.round ? '未処理' : '処理終了'} {step.comment}</li>)}</ul>
      {quotes.length > 0 && <><h3>見積比較</h3><ul>{quotes.map(q => <li key={q.id}>{q.supplier} · {currency(q.amount)} · {when(q.quoted_at)} · {q.decision === 'selected' ? '採用 '+q.selection_reason : q.decision === 'declined' ? '不採用' : '未決定'}</li>)}</ul></>}
      {diagnosis.length > 0 && <><h3>現在の処理状況</h3><ul>{diagnosis.map(issue => <li key={String(issue)}>{issue}</li>)}</ul></>}
      {role === 'buyer' && current.buyer_id === actor?.id && current.status === 'returned' && application(current)}
      {nextStep?.role === role && <form className="editor" onSubmit={event => submit(event,'approve',current.id)}><Field name="comment" label="コメント（差戻し・却下は必須）"><textarea name="comment" maxLength={1000}/></Field><div className="buttons">{['approve','return','reject'].map(action => <button className={action==='approve' ? 'primary' : ''} key={action} value={action} disabled={busy}>{actions[action]}</button>)}</div></form>}
      {current.status === 'approved' && role === 'manager' && quotes.length < 2 && editor('quote',<><Field name="supplier" label="仕入先"><select name="supplier" required>{data.suppliers.filter(s=>!quotes.some(q=>q.supplier_id===s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field name="amount" label="見積額（円）"><input required min="1" name="amount" type="number"/></Field></>,current.id)}
      {current.status === 'approved' && role === 'manager' && quotes.length === 2 && editor('select',<><Field name="quote" label="採用見積"><select name="quote" defaultValue={chosen?.id}>{quotes.map(q => <option key={q.id} value={q.id}>{q.supplier} · {currency(q.amount)}</option>)}</select></Field><Field name="reason" label="採用理由"><input required name="reason" maxLength={1000}/></Field></>,current.id)}
      {current.status === 'approved' && role === 'buyer' && current.buyer_id === actor?.id && chosen && chosen.amount <= current.total && editor('order',null,current.id)}
      {role === 'supplier' && current.order_status === 'issued' && editor('confirm',null,current.id)}
      {role === 'buyer' && current.buyer_id === actor?.id && current.status === 'ordered' && editor('receive',<Field name="quantity" label="受領数量"><input required type="number" name="quantity" min="0" max={current.quantity} defaultValue={current.quantity}/></Field>,current.id)}
      {role === 'accounting' && current.order_id && !current.invoice_id && editor('invoice',<><Field name="amount" label="請求金額（円）"><input required type="number" name="amount" min="1" defaultValue={current.order_amount ?? undefined}/></Field><Field name="date" label="請求日"><input type="date" required name="date"/></Field></>,current.id)}
      {role === 'accounting' && current.invoice_id && current.payment_status !== 'paid' && editor('pay',null,current.id)}
      <h3>操作履歴</h3><ol className="timeline">{history.map(log => <li key={log.id}>{when(log.created_at)} · {actions[log.action] || log.action} · {log.actor}</li>)}</ol></section>}
    </>}
    <footer>デモ担当者の切替は学習用です。更新には管理用PINが必要です。</footer>
    </main>
  </div>;
}