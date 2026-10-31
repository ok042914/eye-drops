# Eye Drops MVP

共有Supabaseにeye_drops_v1_private_invokerを適用。11テーブル、RLS、18個のINVOKER関数（公開5）。専用ロール作成・共有所属変更・Auth設定変更なし。
旧eye_stock_v1.sqlは専用ロール案の未適用資料であり、今後実行しない。
Lens Stockに登録済みの本人Auth UUIDへ、Eye Dropsのプロフィールを管理接続で追加済み。ログインはLens Stockと同じメールOTP（shouldCreateUser:false）。Authユーザー・確認済みフラグ・Lens Stockデータ・共有認証設定は変更しない。Eyeの既存RLSが本人UUIDを検査する。旧専用アドレスのOTP自己登録ポリシーは既存構成として残るが、クライアントの専用メールハッシュ制限は撤去した。
パスキーのクライアント処理は実装したが、共有設定変更の承認・RP設定・iPhone/Macで登録/ログイン/復旧の確認まで有効表示にしない。
在庫データはメモリとクラウドのみ。端末に保持するのは専用キーのAuthセッション。書込みは自動再試行せず、結果不明時は同一操作IDで明示確認・再送。
RPCはプロフィール行ロック・revision・操作ID・台帳照合で保護。非公開eye_stockをData APIの公開スキーマへ追加しない。
初期設定・在庫・開封・履歴・通院・予測は既存の純粋計算を継続利用。既存アプリは変更なし。
GitHub：https://github.com/ok042914/eye-drops 。CLIの認証失効・外向き名前解決制限のため、接続済みGitHub連携のGit Data APIでソースをコミットしてmainへ反映する。Vercelは既存eye-dropsプロジェクトを継続利用。

本番URL：https://eye-drops-six.vercel.app
確認：既存関数・テーブルACL・共有所属のハッシュ一致、11テーブルRLS/FORCE、匿名読取り/RPC拒否、subなし認証ロールの不可視性/PT401を実DBで確認。OTPの受信・実ユーザー在庫操作・端末間同期は本人ログイン後の確認待ち。
停止用の現行SQL候補はsupabase/operations/stop_eye_stock_invoker.sql。実行には別途承認が必要。
旧撤回SQLは未適用の専用ロール案向けなので現行環境で実行しない。
54テスト・型チェック・本番ビルド成功。CPU%は未取得。初回ログイン・パスキーは未完了として扱う。

## 2026-10-31 再開時の検証

- 読取り中と保存中の操作を排他化し、同期の古い結果が保存後の表示を上書きする競合を防止。保存成功後の再取得に失敗した場合は追加操作を止め、明示更新で復旧する。
- `supabase/tests/mvp_rollback.sql`を共有DBで実行して成功。既存Auth UUIDを一時的なEyeプロフィール参照に使い、Authテーブルへの書込み・共有設定変更・DDLなし。初期登録、同一ID再送、古いrevision拒否、開封、使用終了、処方、後日受取、取消、棚卸し、負在庫拒否と失敗時原子性、履歴、操作結果、snapshot、別UUIDの隔離を確認。試験用Eyeデータは例外サブトランザクションで全ロールバックし、残存なしを検査。
- これは署名済みJWTによるHTTP経由の本人ログインの検証ではない。メール受信・OTP入力・実端末操作・端末間同期は引き続き未確認。
- 現行本番のトップページと `/api/health` がHTTP 200。Auth到達、Email有効、Eyeスキーマ非公開を確認。直近30分のVercel error/fatalログ該当なし。
- 共有Supabaseの11テーブルのRLS/FORCEと、公開5関数がSECURITY INVOKERであることを再確認。Eyeプロフィール0件の状態で開始し、既存ユーザーの業務データは変更していない。

## Lens Stockとログインを統一

- `supabase/operations/enroll_lens_account.sql`を適用。確認済みLensアカウントが一つだけであることを検査し、その既存UUIDのEyeプロフィールだけを追加。Lens StockとAuthへの書込み、既存Eyeデータの置換、RLSの緩和は行っていない。
- 既存アカウントへメールコードを送信し、別フォームで検証する。60秒以内の再送を抑止。コード再送・メール変更が可能。専用メールのハッシュ照合と自動新規登録を廃止。`NEXT_PUBLIC_EYE_EMAIL_HASH`は不要（既存Vercelの値は未使用）。セッション保存キーとローカルログアウトはEye専用を維持。
- authenticatedロールとLensの本人UUIDで、Eyeのenrollとsnapshotの呼出し成功を確認。実際のメール受信とOTP入力は本人の次回ログインで確認する。

## メール送信上限の診断

認証ログで2026-10-31 10:47 UTCのOTP要求が429 / over_email_send_rate_limitで拒否されたことを確認。標準送信元からの直近の送信成功も記録されており、共有プロジェクトのメール送信枠を消費している。アドレスや接続を一律に疑う表示を修正し、共有上限・一般的な429・送信先制限を区別する。クライアントの60秒再送抑止はプロジェクトの時間あたり上限を解除しない。追加の試験メール送信や自動再試行は行わない。

送信枠の回復を待つことが当面の対処。恒久対応はカスタムSMTP（https://supabase.com/docs/guides/auth/auth-smtp）などの共有Auth設定変更になるため、接続情報・既存アプリへの影響を確認したうえで別途実施する。今回、共有設定には変更なし。

## アカウント共通の予備日数

Eye専用マイグレーションeye_stock_account_reserve_daysを適用。Eyeプロフィールにreserve_days（初期14、0〜90）を追加し、既存snapshot/mutate経由で保存・同期する。詳細は[opening-plan.md](opening-plan.md)を参照。既存在庫、開封履歴、Auth設定、Lens Stockの設定・権限は変更なし。
