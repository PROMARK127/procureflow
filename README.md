# ProcureFlow

購買申請から支払管理までを追跡する日本語デモ。

1. Node.js 22以上で `npm ci` を実行。
2. `.env.example` を `.env.local` にコピーし、Neon PostgreSQLの接続URLと管理用PINを設定。
3. `npm run migrate` でスキーマとデモデータを登録。
4. `npm run dev` で起動。

公開はGitHubリポジトリをVercelへ接続し、Neon連携と環境変数をProductionに設定して行う。接続変数として `DATABASE_URL` または `POSTGRES_URL` を使用する。マイグレーションは直接接続用変数があれば優先する。PINは十分な長さのランダム文字列を使用し、管理用に保管する。

検証は `npm run typecheck`、`npm test`、`npm run build`。テスト用の埋め込みPostgreSQLはテストプロセス内でのみ使用する。設計・運用資料は `docs/` を参照。