# フェーズ2 検証記録

2026-10-31。Eye Drops専用ディレクトリのみを作成・変更。本番Supabase、Lens Stock、BOX、Vercel、GitHubには変更なし。

## 成功

- `npm test`：41件成功（在庫・日付・予測・処方目安36件、Service Workerの非キャッシュ1件、React画面描画4件）。
- `npm run typecheck`：成功。
- `NEXT_TELEMETRY_DISABLED=1 npm run build`：最終コードで成功。全7ページの静的生成完了、終了コード0。
- 本番ビルドでホーム、manifest、180/192/512pxのPNGアイコンルートを生成。
- 独立したGitリポジトリを初期化。GitHubへの作成・pushなし。
- JSXレビュー：ラベル、ダイアログのフォーカス管理、ダイアログ内エラー、二重送信抑止、期限未設定、予測の目安表示、非表示時の定期通信がないことを確認。

## 依存パッケージ

依存導入の事前承認を取得して `npm install --ignore-scripts --cache .npm-cache --no-audit --no-fund` を実行したが、registry.npmjs.orgの名前解決がENOTFOUNDで失敗し、再試行中のプロセスを中断。
既存Lens Stockのnode_modulesを読み取り、Eye Dropsへ独立コピー（共有シンボリックリンクではない）。元の依存やソースを変更していない。
`npm install --offline --package-lock-only --ignore-scripts --cache .npm-cache --no-audit --no-fund --fetch-retries=0` でEye Dropsのlockfileを生成。
Next.jsの別プラットフォーム向けSWCメタデータは、既存lockfileから同じバージョンのエントリを追加。
新規のネット接続ありクリーンインストールの成功とは区別する。

## 実施できなかった検証

開発サーバー起動の事前承認を取得し `NEXT_TELEMETRY_DISABLED=1 npm run dev` を試したが、`listen EPERM 127.0.0.1:3102` で起動失敗。待受プロセスは残っていない。
そのため、HTTP経由のブラウザ操作、スクリーンショット、iPhone/Mac実機、ホーム画面追加、ダイアログ操作・キーボード操作の実機確認は未実施。
Reactの静的描画テストは、ブラウザでのクリック・ハイドレーション検証の代わりではない。

## 未実装の境界

- Supabase接続・専用DB・RLS・RPC・DBトランザクション。
- メールOTP、パスキー、登録・復旧、ログアウト、複数端末クラウド同期。
- 実DBのユーザー隔離・同時接続・PostgRESTのPT409応答。
- データの永続保存（現在はメモリのみ。再読込・終了で消去）。
- 通院記録の編集・削除、使用終了履歴の訂正、切替履歴の一括取消、部分受取への追加入庫。
- GitHubリポジトリ作成、Vercelプロジェクト・公開。

受取誤記録は取消＋再登録で訂正する。負在庫になる取消は拒否する。
本番への接続や設定変更は、後続フェーズの別承認が必要。
