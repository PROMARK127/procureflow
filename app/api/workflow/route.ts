import { timingSafeEqual, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { mutate, Problem } from '../../../lib/workflow';
export const dynamic = 'force-dynamic';

let database: Pool | undefined;
function pool() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error('Missing database connection');
  return database ??= new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 6000 });
}
function failure(error: unknown) {
  if (error instanceof Problem) return Response.json({code:error.code,message:error.message},{status:error.status});
  console.error('ProcureFlow DB operation failed', { code: (error as {code?: string})?.code });
  return Response.json({code:'SYSTEM_ERROR',message:'データベースへの接続または処理に失敗しました'},{status:503});
}
export async function GET() {
  try {
    const db = pool();
    const [users,catalog,suppliers,requests,steps,quotes,audit] = await Promise.all([
      db.query('SELECT id,name,department,role FROM users ORDER BY id'),
      db.query('SELECT * FROM catalog_items ORDER BY id'),
      db.query('SELECT id,name FROM suppliers ORDER BY id'),
      db.query('SELECT t.*, i.item_id, o.created_at AS ordered_at, x.received_at, f.invoice_date, f.paid_at FROM transactions t JOIN purchase_request_items i ON i.request_id=t.id LEFT JOIN purchase_orders o ON o.id=t.order_id LEFT JOIN receipts x ON x.order_id=o.id LEFT JOIN invoices f ON f.order_id=o.id ORDER BY t.id DESC'),
      db.query('SELECT a.*, u.name AS actor FROM approval_steps a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.round,a.step'),
      db.query('SELECT q.*,s.name AS supplier FROM quotations q JOIN suppliers s ON q.supplier_id=s.id ORDER BY q.id'),
      db.query('SELECT a.id,a.request_id,a.action,a.created_at,u.name AS actor FROM audit_logs a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC')
    ]);
    return Response.json({users:users.rows,catalog:catalog.rows,suppliers:suppliers.rows,requests:requests.rows,steps:steps.rows,quotes:quotes.rows,audit:audit.rows});
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Problem('VALIDATION','入力形式を確認してください');
    const secret = process.env.DEMO_PIN;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!secret || typeof input.pin !== 'string' || !timingSafeEqual(digest(input.pin),digest(secret))) {
      throw new Problem('VALIDATION','更新PINを確認してください',403);
    }
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      const result = await mutate(client,input);
      await client.query('COMMIT');
      return Response.json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  } catch (error) { return failure(error); }
}