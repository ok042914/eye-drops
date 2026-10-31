# Eye Drops

iPhone・Mac向けの目薬在庫管理PWA。Next.js / TypeScript / Tailwind / Supabase。

- 初期設定ウィザード、未開封在庫、1本ごとの開封・使い切り・廃棄・訂正。
- 過去履歴、処方・受取、棚卸し、通院予定、使用期間・在庫不足・処方本数の目安。
- 通院・目安画面に今後6か月の開封予定一覧。直近実績を重く扱い、次回・次々回診察日と予備日数で処方希望本数を試算。
- Lens Stockと同じ登録済みメールのOTP、クラウド保存、revision・操作IDによる競合／二重登録対策。
- パスキーの登録・ログイン処理は実装済み。共有設定と実機確認待ちのため現在は無効。

本番URL：https://eye-drops-six.vercel.app
接続設定・現在の制約は [docs/production.md](docs/production.md) を参照。

## ローカル

Node.js 24。`.env.example`を参考に専用環境変数を設定（秘密情報をコミットしない）。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run build
npm run dev
```

環境変数がない場合は明示的なメモリ内試作モード。本番で使う保存先ではない。

## DB

本番適用済みSQLは `supabase/sql/eye_stock_v1_invoker.sql`。
新規eye_stockの11テーブル・RLS・INVOKER関数のみを使用し、共有ロール所属や既存アプリを変更しない。
eye_stockをData APIの公開スキーマに追加しない。業務エラーはPT409/PT422、定期ポーリング・自動書込み再試行なし。
旧 `eye_stock_v1.sql` と `security_isolated.sql` は専用ロール案の履歴資料。実行しない。
過去のフェーズ資料は実装前の状態を記載しているため、現在の本番構成とは異なる。
