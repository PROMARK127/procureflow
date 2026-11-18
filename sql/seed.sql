INSERT INTO users(name,department,role) VALUES ('佐藤 葵','IT企画部','buyer'),('鈴木 健','IT企画部','approver'),('高橋 凛','購買部','manager'),('田中 誠','東都IT商事','supplier'),('伊藤 優','経理部','accounting') ON CONFLICT(name) DO NOTHING;
INSERT INTO suppliers(name,user_id) VALUES ('東都IT商事',(SELECT id FROM users WHERE role='supplier')),('みらいオフィス機器',null),('北辰ネットワーク',null) ON CONFLICT(name) DO NOTHING;
INSERT INTO catalog_items(name,price) VALUES ('ノートPC',148000),('モニター',28000),('キーボード',8500),('マウス',4200),('ネットワークスイッチ',62000) ON CONFLICT(name) DO NOTHING;
DO $$
DECLARE b integer; a integer; p integer; s integer; s2 integer; c integer; r integer; q integer; o integer; st text;
BEGIN
SELECT id INTO b FROM users WHERE role='buyer';
SELECT id INTO a FROM users WHERE role='approver';
SELECT id INTO p FROM users WHERE role='accounting';
SELECT id INTO s FROM suppliers WHERE name='東都IT商事';
SELECT id INTO s2 FROM suppliers WHERE name='みらいオフィス機器';
SELECT id INTO c FROM catalog_items WHERE name='モニター';
FOREACH st IN ARRAY ARRAY['pending','returned','approved','ordered','received','paid'] LOOP
  IF EXISTS(SELECT 1 FROM purchase_requests WHERE reason='初期デモ '||st) THEN CONTINUE; END IF;
  INSERT INTO purchase_requests(buyer_id,department,reason,total,status) VALUES(b,'IT企画部','初期デモ '||st,28000,st) RETURNING id INTO r;
  INSERT INTO purchase_request_items VALUES(r,c,1,28000);
  INSERT INTO approval_steps VALUES(r,1,1,'approver',CASE st WHEN 'pending' THEN null WHEN 'returned' THEN 'return' ELSE 'approve' END,CASE WHEN st<>'pending' THEN a END,CASE WHEN st='returned' THEN '用途の詳細を追記してください' END,CASE WHEN st<>'pending' THEN now() END);
  INSERT INTO audit_logs(request_id,actor_id,action) VALUES(r,b,'request');
  IF st<>'pending' THEN INSERT INTO audit_logs(request_id,actor_id,action) VALUES(r,a,CASE WHEN st='returned' THEN 'return' ELSE 'approve' END); END IF;
  IF st IN ('ordered','received','paid') THEN
    INSERT INTO quotations(request_id,supplier_id,amount,decision,selection_reason) VALUES(r,s,27000,'selected','価格') RETURNING id INTO q;
    INSERT INTO quotations(request_id,supplier_id,amount,decision) VALUES(r,s2,28000,'declined');
    INSERT INTO purchase_orders(request_id,quote_id,supplier_id,amount,quantity,buyer_id,status) VALUES(r,q,s,27000,1,b,CASE WHEN st='ordered' THEN 'issued' ELSE st END) RETURNING id INTO o;
    INSERT INTO audit_logs(request_id,actor_id,action) VALUES(r,b,'order');
    IF st IN ('received','paid') THEN
      INSERT INTO receipts(order_id,actor_id,quantity,result) VALUES(o,b,1,'complete');
      INSERT INTO audit_logs(request_id,actor_id,action) VALUES(r,b,'receive');
    END IF;
    IF st='paid' THEN
      INSERT INTO invoices(order_id,amount,invoice_date,status,paid_at) VALUES(o,27000,current_date,'paid',now());
      INSERT INTO audit_logs(request_id,actor_id,action) VALUES(r,p,'invoice'),(r,p,'pay');
    END IF;
  END IF;
END LOOP;
END $$;