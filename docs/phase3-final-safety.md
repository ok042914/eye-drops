# 最終安全確認（2026-10-31）

判定：**修正が必要。本番適用不可（保留）**。
SQL候補の全文を確認し、本番にはSELECTだけを実行した。CREATE/ALTER/DROP/GRANT/REVOKE/INSERT/UPDATE/DELETE、OTP送信、接続終了、設定変更は実行していない。

## 1. 対象と依存

候補の変更対象は新規eye_stockスキーマ、その11テーブル・RLS・索引・内部関数、新規専用ロール、public.eye_stock_*の4関数だけ。
Lens Stock、BOX、その他既存アプリの定義・ACL・データを変更する文はない。auth.usersへの参照FKは新しいEyeテーブル側の定義で、authテーブルをALTERしない。
ただしFK作成中は参照先auth.usersにもロックが必要となり、認証処理との短い競合はあり得る。DDLは既存イベントトリガー経由でPostgRESTのスキーマキャッシュ再読込を通知する。共用環境への影響0は保証できない。
本番に有効な汎用DDLイベントトリガー2個を読み取り確認したところ、処理はpgrstへのreload schema通知。拡張作成用の他のトリガーは今回のCREATE EXTENSIONなしの候補には対応しない。
既存デフォルトACLは変更しない。public関数の初期権限は同一トランザクション内で閉じ直す。

## 2. 専用ロール方式の判定

本番の読み取り結果：PostgreSQL 17.6、接続のcurrent_user=session_user=postgres、rolsuper=false、rolcreaterole=true、rolbypassrls=true、createrole_self_grantは空。スキーマ作成・public関数作成権限はある。
eye_stockスキーマ・eye_stock_executor・public.eye_stock_*は未作成。

PostgreSQL 17の仕様では、非SUPERUSERのCREATEROLEによるロール作成時、作成者へのADMIN所属が自動追加される。createrole_self_grantの空文字はこのADMIN所属を抑止しない。追加のSET/INHERITを自動付与しない設定である。
ALTER FUNCTION OWNERは所有者であることに加え、新所有者へSET ROLEできることと、その新所有者に対象スキーマCREATE権限があることを要求する。ALTER OWNERそのものが不足する所属を自動で補うわけではない。
したがって現候補は、postgresの所属を変えない要件に抵触する上、標準PGの権限規則ではSET不足で所有権移譲も失敗する。Supabase拡張による特例を実験で保証してはいない。特例があっても共有所属の不変を推測で保証しない。
Supabaseは利用者にSUPERUSERを提供しないため、supabase_adminとして実行する回避策を利用可能とは扱わない。

ローカル候補に、非SUPERUSERなら最初のDDLより前にEYE_ROLE_DESIGN_REAPPROVAL_REQUIREDで中断するガードを追加した。現在の実行主体では必ずこの条件に該当する。ガードの削除だけで進めてはいけない。
末尾にも、新ロールの所属が一切ないこと、アプリ用ロールのテーブル・列権限なし、RLS/FORCE、実装関数4個の所有者を確認するガードを追加した。失敗時は一括ロールバックする。

選択肢：
- 専用ロールを維持するなら、新しいEyeロールに限って管理者postgresへのADMIN/SET所属（INHERIT=false）を認める限定例外を別途設計・承認する。authenticated/anon/authenticatorへの所属は認めない。今回はこの変更案の実行SQLを追加していない。
- 所属変更を厳密に禁止するなら専用ロール方式は採用しない。SECURITY INVOKERとRLS中心の構成へ再設計し、Eyeテーブルへの必要権限とAPI境界を再レビューする必要がある。
- postgres所有のSECURITY DEFINERへ単純に戻すのは、BYPASSRLSのため非推奨。FORCE RLSでもBYPASSRLSは阻止できない。

方式自体は最小権限化に有益だが、**現在の制約のまま採用してよいとは判定しない**。

参考：[PGロール属性](https://www.postgresql.org/docs/17/role-attributes.html)、[createrole_self_grant](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)、[ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html)、[SupabaseのSUPERUSER制限](https://supabase.com/docs/guides/database/postgres/roles-superuser)。

## 3. SECURITY DEFINER・RLS

設計上、専用ロールはNOLOGIN/NOBYPASSRLS・テーブル非所有者、内部のsnapshot/mutate/operation_status/historyだけ所有する。全関数のsearch_pathは空、テーブル参照はスキーマ修飾。publicの4入口はINVOKER。
全11テーブルはENABLE/FORCE RLS、専用ロール向けUSING/WITH CHECKでJWT sub=user_idを検査。require_userでenabled許可リストも検査する。
認証はPostgRESTが検証するrequest.jwt.claimsからsubを取得する。未信頼者に直接SQL接続やSET ROLE能力を渡すと、claimsの模擬設定が可能になるため、この境界は必須。
内部補助関数のPUBLIC EXECUTEは撤回し、アプリは公開・非公開入口4個だけ実行可能。直接テーブル権限は付与しない。スキーマUSAGEとデータ参照権限は別物。
本番のLensスキーマはauthenticatedのみUSAGE、Lens公開RPC3個にPUBLIC EXECUTEはなく、アプリの通常テーブルにPUBLIC権限は見つからなかった。
ただしpublicの他アプリ用SECURITY DEFINER関数4個（admin_check_pass/admin_delete_shop/admin_insert_shop/admin_update_shop）はPUBLIC EXECUTEを持つ。新ロールにもPUBLIC経由の実行能力があるため、「専用ロールが他アプリの関数を一切実行できない」とは保証できない。関数内部の認可は今回未調査・未実行。他アプリの権限変更はしていない。Eye候補からこれらを呼ぶコードはない。

## 4. エラー・待ち時間・二重更新

PTxyzは公式仕様でHTTP状態を指定できるためPT409/PT422は仕様上対応する。現プロジェクトのPostgRESTバージョン番号は今回取得できず、実際のHTTP応答・内部再試行の非発生は未検証。
[公式エラー仕様](https://docs.postgrest.org/en/stable/references/errors.html#custom-errors)。
候補は業務上の40001/40P01なし、DB内部再試行ループ・周期処理なし。予期しない本物のデッドロック等まで起きない保証ではない。
操作IDの完全JSONB照合をrevision検査より前に行い、同一ユーザーのプロフィール行をロックして残高・台帳・監査を一括更新する。エラー時は操作記録も戻る。
修正案ではmutateの関数ローカルlock_timeoutを1秒にし、lock_not_availableをPT409/EYE_BUSYへ変換する。再試行は自動実施しない。DDL用のlock_timeout=2秒だけではRPC実行時の待ち時間制御にならないための追加。
本番authenticator/authenticatedのstatement_timeout=8秒、authenticatorのlock_timeout=8秒を読み取り確認した。ただし実際のAPI経路での適用・HTTPタイムアウトとの関係は要検証。関数内SET statement_timeoutで確実にリクエスト全体を制限できるとは扱わない。
EYE_BUSYとrevision競合は将来の同期アダプターで表示を区別する必要がある。現在のtransport.tsはPT409を一律「別端末で更新」と表示するため、このまま本番接続しない。

## 5. 用意した実DBテストSQL（未実行）

`supabase/tests/security_isolated.sql`は、本番以外の既存環境で使うための候補。
DB名eye_drops_security_test、セッションのeye_drops.isolated_tests=approved、SUPERUSERの3条件で誤実行を防ぐ。これは本番で実験してよいガードではない。
有効な架空ユーザーA/Bについて全11テーブルに少なくとも1行ずつある隔離フィクスチャが事前に必要。実ユーザー・本番データは使わない。フィクスチャ作成や環境構築は今回していない。

- 11テーブルのRLS/FORCE、実行ロールが非所有者であること。
- anon/authenticatedの直接SELECT拒否22通り、テーブル・列の書込み権限なし。
- 実行ロールでもsubなしは0行、AのsubならAだけ見えてBは不可（11テーブル）。
- UPDATE権限のあるuser_id列は、他所有者への変更をWITH CHECKが拒否。
- anonのRPC拒否、subなしPT401、許可外UUIDのPT403。
- 全体ROLLBACK。ロール所属・GRANT変更なし。

RLSの不可視行は通常0行であり、必ず403になるわけではない。
SQLでのSET ROLE/claims模擬はJWT署名検証・API公開設定の検証にはならない。後日HTTP経由で不正JWT、匿名、他ユーザーのボトルID、直接テーブル、PT409/422、同時操作2接続、切断後の同一ID再送も別途確認が必要。

## 6. 現在の負荷（取得できた事実）

2026-10-31 11:11〜11:12 JSTの読み取り観測：
- 組織契約Freeを読み取り確認。プロジェクトACTIVE_HEALTHY、DBサイズ17,738,899 bytes（約17.7MB/16.9MiB）。Dashboardのディスク使用量・WAL全体と同義ではない。
- 接続数8/最大60。観測終了時の他のactiveクエリ0、idle in transaction 0、累積deadlock 0。
- DBロールバック691,413,004回。02:11:14.780〜02:12:37.480 UTCの82.700秒で増加0（0回/秒）。
- 問題のauthenticated set_configは691,413,306回。02:11:16.160〜02:12:37.480 UTCの81.320秒で増加0（0回/秒）、累積実行時間も変化なし。anon/service_role分も変化なし。
- DB統計開始2026-04-26、SQL統計開始2026-05-03で異なる。累積6.9億回は現在の実行速度ではない。
- CPU%そのものは利用可能なツールから未取得。短い観測だけで恒常的な正常化は保証しない。CPU Dashboardの直近1時間・3時間を利用者が確認する必要がある。

参照できたログからPostgREST版番号は取得できなかった。Authやリクエストログの秘密値・メール本文は出力していない。

## 7. OTP・アカウント

利用者が指定したメールアドレスは既存の確認済みAuthユーザー1件に一致し、Lens Stockプロフィールにも紐づいていることをSELECTで確認した。UUIDや他ユーザーのメールは表示しない。
そのアドレスでEyeへログインすると同じUUIDになるため、専用UUID方針には利用不可。別アドレスまたはエイリアスを選ぶ必要がある。Gmailの別表記でもSupabase側の実際の識別を確認し、既存ユーザーを変更・削除しない。
今回はOTP送信をしておらず、受信可否は未確認。新規UUIDの作成、メール確認済み扱いへの変更もしていない。
接続ツールにAuth/SMTP設定の読み取り機能がないため、有効Email設定、SMTP、テンプレート、送信制限、Site URL/RedirectはDashboardで確認が必要。
標準SMTPは組織メンバー宛のみ・現行2通/時という公式制限がある。アドレスのエイリアスが自動的に許可されるとは限らない。受信のためだけに管理権限を追加しない。[公式SMTP制約](https://supabase.com/docs/guides/auth/auth-smtp)。
入力型OTPにはテンプレートがTokenを含む必要がある。リンクだけなら現在のテンプレートのままでOTP入力が使えると判断しない。共有テンプレートやSMTPは今回変更不可。

## 8. 利用者が本番適用前に確認すること

1. 専用ロールの限定的な所属変更を許容して再設計するか、所属変更なしの構成へ戻すか。
2. Lensと異なる専用アドレス。新規ユーザー登録は別承認で、既存Lensユーザーには手を加えない。
3. Supabase Dashboard → Authentication → Sign In/ProvidersのEmail有効状態、Email/SMTP・Rate Limits、Email TemplatesのToken有無、URL Configuration。秘密値は共有せず、有効/無効・必要部分だけ確認する。
4. Integrations → Data API → Settingsの公開スキーマ（UI名は版による）。eye_stockは公開しない方針。DBカタログからは実効設定を確定できなかった。
5. Database/ReportsのCPU直近1時間・3時間、Storage/UsageのDB容量。現在CPUの継続低下を確認する。
6. 制限に合う既存の本番外PG環境の有無。新規プロジェクト・Dockerを使わない条件では、使える環境がなければ実動作検証は保留。

## 9. 適用失敗・停止・Lensへの影響確認

現在の実行主体なら新しい事前ガードでCREATE ROLE前に中断。その他の失敗条件はPGバージョン、名前衝突、権限不足、構文不備、DDLロック2秒／文30秒、末尾の所属・RLS・ACL検査。すべて一括トランザクションを戻す。
方式確定後の最終SQLは再レビュー・別承認を必須とする。今回のBLOCKED候補を本番へ流さない。
将来異常があればEye操作停止 → 別承認で `stop_eye_stock.sql` の公開／非公開RPCだけ権限撤回 → CPU・Δcalls/秒・Δrollback/秒を確認。実行済み接続の強制終了は別承認で対象を特定する。共有再起動・無差別切断なし。
データが入った後は停止・保持して前進修正。データなしの専用領域だけ撤回SQLが使えるが、実行主体の所有権・DROP権限も実DB検証が必要。BOX・LensへのDROPなし。
`compare_readonly.sql`で既存定義・ACL・RLS・共有所属等を前後比較し、Lensのメールログインと表示を利用者が確認する。他アプリも変更を伴わない閲覧で確認する。想定外差分やLensエラーで停止する。

## 10. ローカル検証結果

`npm run check:sql`：11テーブル、16関数、76文、字句・構造上の指摘0。
`npm test`：53件成功。`npm run typecheck`：成功。
静的検査はPG/PLpgSQLパーサーではなく、実DB検証の代わりにならない。隔離テストSQLの本体は未実行。インストール・開発サーバー起動・外部公開・課金なし。
