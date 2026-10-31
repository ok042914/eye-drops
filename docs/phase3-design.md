> 最終確認で専用ロールの暗黙所属と所有権移譲の問題が判明したため、現候補は適用保留。詳細は [phase3-final-safety.md](phase3-final-safety.md)。

# フェーズ3：SQL候補とコードの照合

2026-10-31。ローカルファイルの準備のみ。本番DBへのSQL実行は読み取りも含めて行っていない。
候補は `supabase/sql/eye_stock_v1.sql`。CLI未導入のため、正式な時刻付きマイグレーションとしては未登録。

## 変更予定オブジェクト

- 新規非公開スキーマ：eye_stock。Data APIの公開スキーマには追加しない。
- 新規専用ロール：eye_stock_executor。NOLOGIN / NOINHERIT / NOBYPASSRLS。既存ロールへの明示的な所属付与なし。
- 11テーブル、各1個の所有者RLSポリシー（ENABLEとFORCE）、明示的な索引20本と主キー・一意制約由来の索引。
- 非公開関数12個：request_uid / int_value / text_value / date_value / uuid_value / require_user / put_settings / move_stock / snapshot / mutate / operation_status / history。
- publicの新規RPC4個：eye_stock_snapshot(bigint)、eye_stock_mutate(text,jsonb,uuid,bigint)、eye_stock_operation_status(uuid)、eye_stock_history(text,integer,date,uuid)。
- スキーマ・新規オブジェクトだけのGRANT/REVOKE。共有ロールの属性・Auth設定・既存オブジェクトのACLは変更しない設計。

| テーブル | Phase 2との対応・役割 |
| --- | --- |
| profiles | Eye専用UUIDの許可リスト、初期設定日、次回受診日、revision |
| medications | 薬剤ID、現在設定版 |
| medication_settings | 名称・容量・回数・並行数・期限根拠の版管理 |
| stock_balances | 未開封残高の非負制約、履歴合計と照合 |
| bottles | 固有UUID、薬剤、開封日、設定版、状態、交換元 |
| stock_movements | 初期残高・開封・受取・取消・棚卸しの増減台帳 |
| prescriptions | 処方日・処方数量・通院との関連 |
| receipts | 実受取日・数量。v1は1処方につき1受取 |
| visits | 受診日・次回予定日・備考 |
| mutation_requests | 操作IDと完全なJSONB入力、完了revision |
| audit_events | 操作種別と日時。訂正も別操作として記録 |

全データにuser_idを持たせ、複合FKで他ユーザー・他薬剤への参照を拒否する。
薬剤設定は上書きせず版を追加する。既存ボトルの期限を遡って変更しない。
プロフィールは管理者による別途承認の登録が必要。アプリ用RPCから任意UUIDを許可リストへ登録できない。
AuthユーザーへのFKはDELETE RESTRICTで、Eyeデータを持つ専用ユーザーの削除を阻止する。他ユーザーの削除には該当行がない。

## トランザクションと操作

本人のプロフィール行をFOR UPDATEでロック → 同一操作IDの内容照合 → revision確認 → 一括更新 → 残高と台帳合計の一致確認 → 操作監査・revision更新。
同じID・内容の再送はrevisionが古くても再適用しない。内容違いはPT409。入力不正はPT422。
40001/40P01を業務エラーに使わず、DBエラー時は全体ロールバック。更新の自動再試行は実装しない。
通信切断時はoperation_statusを照会し、unknownを失敗確定と扱わない。新しい操作IDで再登録しない。

| 操作 | 残高への影響・制約 |
| --- | --- |
| initialize / add_medication | 現在の未開封数を初期台帳へ。使用中・過去開封は減算なし |
| open | 必ず1本・−1。明示した交換元だけ終了。並行本数上限・在庫0を検査 |
| import | 過去開封だけ追加、残高0変化 |
| end | 選択した1本を使い切り／廃棄、未開封数0変化 |
| edit_opening | 日付訂正、増減0。交換関係を伴う日付変更はv1で拒否 |
| cancel_opening | 通常開封のみ＋1、初期／過去は0。終了済み・交換依存がある場合拒否 |
| receipt / receive | 処方だけなら0、実受取だけ加算。初期設定前の受取の再加算を拒否 |
| cancel_receipt | 実受取分を減算、負在庫になる取消は拒否 |
| adjust | 目標在庫との差分を理由付き記録 |
| visit / settings | 在庫増減なし。受診予定・設定版更新 |

ドルモロールは並行数2・個別IDで管理し、朝夜の区別・2本一括開封なし。予測は既存の純粋TypeScript関数を継続使用し、DBが実在庫を予測で変更することはない。
初期履歴は薬剤あたり500件、薬剤20種、入力JSONは128KiB、数量は100000以下とする候補。

## APIと認証境界

public関数はSECURITY INVOKER。非公開の実装4個のみ専用実行ロール所有のSECURITY DEFINER、全関数のsearch_pathは空。
専用ロールはテーブル所有者ではなく、RLSでJWTのsubとuser_idを照合する。匿名・authenticated・service_roleにテーブル直接権限を付与しない。
authenticatedはRPCの入口を実行できるが、enabledプロフィールのないUUIDは拒否する。
JWTのsubはPostgRESTが検証して設定するrequest.jwt.claimsから取得する。共有authスキーマのACL追加を避けるための設計であり、この設定形式との互換性は実DB検証が必要。
アプリから任意のuser_idやJWT claimsを引数として指定できない。未信頼ユーザーへ直接DB接続権限を渡さない。

snapshotはrevisionが同じなら短い応答、変更時も薬剤別の最新履歴・使用中・予測用使い切り履歴に限定。全履歴はキーセットページング、既定30・最大100件。
ローカルのReceipt.idはDBのprescription.idに対応し、実受取IDを別に持つ。snake_case・設定版・ページ結果からローカルモデルへのアダプターは未実装。
SQLファイルの用意だけではクラウド保存は有効にならない。UIは引き続きメモリのみ。
