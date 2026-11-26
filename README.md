# グルメマップ | Gourmet Map

あなたの近くに、おいしい発見。（キャッチコピーは暫定案）

よく利用する場所（職場・学校・駅など）を登録し、半径3km以内のお店を少ない操作で探せる、ログイン不要のグルメ検索Webアプリです。日本国内・スマートフォン優先・一般公開の非商用ポートフォリオを想定しています。

> 開発状況：要件定義書 v1.0.0 に基づく実装・検証段階です。API接続・負荷・対応ブラウザの検証、外部サービス規約の確認が完了するまで正式公開しません。

## 1. 主な機能

| 機能 | 内容 | 要件ID |
| --- | --- | --- |
| 地点管理 | 住所・駅名・現在地（GPS）・地図・緯度経度の5種類で登録／編集／削除／切替 | LOC-01〜08 |
| 店舗検索 | 半径3km以内の店舗を、1回の呼び出しで近い順に最大100件取得（重複排除・部分取得の明示） | API-01〜06 |
| 絞り込み | 距離7段階、ジャンル（名称・OR）、設備条件（AND）、店名・読みかな、4種の並び替え、20件ずつ表示 | SR-01〜11 |
| 店舗情報 | カード（10項目）・詳細モーダル（13項目）・外部リンク（2項目）の25項目 | 6章 |
| 地図 | Leaflet + OpenStreetMap、マーカークラスタリング、PCは一覧と同時表示 | MAP-01〜04 |
| 共有 | リンクコピー、Web Share API、LINE、QRコード（店舗URLのみ） | SH-01〜02 |
| プリセット | 地点ごとの前回条件の保存、名前付きプリセットの登録・編集・削除 | PRE-01〜02 |
| お気に入り | 規約確認後に有効化（`FAVORITES_ENABLED` と GAS の機能フラグ） | FAV-01〜02 |
| 設定 | テーマ（ライト／ダーク／システム）、文字サイズ、高コントラスト、動きの低減、自動更新 | UX-07／API-04 |
| データ管理 | JSONバックアップ・復元（追加／上書き・重複検出）、項目別の初期化、全削除 | DATA-01〜06 |
| 運用 | お知らせ・メンテナンス・システムステータス、ヘルスチェック、日次レポート | MON-01〜07 |

## 2. 構成

```
端末（GitHub Pages） → GAS（入力検証・レート制限・キャッシュ） → ホットペッパー／Geoapify
```

| 層 | 技術 |
| --- | --- |
| フロントエンド | HTML / CSS / JavaScript、Tailwind CSS 3.4.17（主）、Bootstrap 5.3.3（モーダル・オフキャンバス・ドロップダウン・トースト）、Google Fonts（Noto Sans JP・Inter）、Font Awesome Free 6.7.2 |
| 地図 | Leaflet 1.9.4、Leaflet.markercluster 1.5.3、OpenStreetMap |
| 共有 | qrcode-generator 1.4.4 |
| サーバー | Google Apps Script（`gas/Code.gs`、`gas/Operations.gs`） |
| 運用 | Googleスプレッドシート（管理者のみ） |
| 端末保存 | LocalStorage（キー：`gourmet-map:v1`） |

### ディレクトリ

```
index.html            画面（SCR-01〜28 をページ・モーダルで実装）
css/tailwind.css      Tailwind の生成物（編集しない）
css/style.css         デザイントークン・Bootstrap／Leaflet の調整
css/accessibility.css フォーカス・文字サイズ・ハイコントラスト・動きの低減
tailwind/input.css    Tailwind の入力（画面部品の定義）
tailwind.config.js    Tailwind の設定（接頭辞 tw-、Preflight 無効）
js/boot.js            表示設定の先行適用（CSP対応のため外部ファイル）
js/config.js          設定値
js/storage.js         LocalStorage（検証・移行・バックアップ）
js/api.js             GAS通信（タイムアウト・再試行）
js/search.js          距離計算・取得・絞り込み・並び替え
js/map.js             地図
js/ui.js              Bootstrap コンポーネントの操作・通知
js/app.js             画面制御
gas/                  サーバー側（GAS）
test/                 自動テスト（Node.js 標準のテストランナー）
```

## 3. 開発手順

npm は使用しません（package.json・node_modules なし）。テストは Node.js 20 以上の標準機能（`node --test`）のみで実行し、CSS は Tailwind のスタンドアロンCLIで生成します。静的解析は CI の構文チェック（`node --check`）と Gitleaks で行い、npm が必要な ESLint・Stylelint・Prettier は採用していません。

### 3.1 CSS の生成（Tailwind スタンドアロンCLI）

1. [Tailwind CSS v3.4.17 のリリース](https://github.com/tailwindlabs/tailwindcss/releases/tag/v3.4.17)から、OSに合ったスタンドアロンCLI（例：`tailwindcss-windows-x64.exe`）をダウンロードし、`tools/` に置きます（`tools/` はGit管理外）。
2. プロジェクト直下で実行します。

```bash
# Windows（PowerShell）
./tools/tailwindcss-windows-x64.exe -c tailwind.config.js -i tailwind/input.css -o css/tailwind.css --minify

# macOS（Apple Silicon）
./tools/tailwindcss-macos-arm64 -c tailwind.config.js -i tailwind/input.css -o css/tailwind.css --minify
```

`index.html`・`js/`・`tailwind/input.css` を変更したら再生成し、`css/tailwind.css` もコミットします。Play CDN は試作時のみ使用し、本番では使用しません。

### 3.2 ローカルでの確認

```bash
python -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

### 3.3 テスト

```bash
node --test "test/*.test.js"
```

- `test/unit.test.js`：距離・徒歩時間・AND/OR・正規化・並び替え・店舗取得（最大100件）・データ検証・バックアップ
- `test/gas.test.js`：GASの入力検証・キャッシュ分割・日次予算・停止フラグ・項目の許可リスト（外部APIは模擬応答）
- `test/test.html`：ブラウザでの簡易確認用

## 4. GAS の設定

1. Apps Script プロジェクトを作成し、`gas/Code.gs`・`gas/Operations.gs`・`gas/appsscript.json` を配置します。
2. 「プロジェクトの設定 → スクリプト プロパティ」に以下を登録します（APIキーをコードやGitHubに書かないでください）。

| キー | 必須 | 内容 |
| --- | --- | --- |
| `HOTPEPPER_API_KEY` | ○ | ホットペッパーWebサービスのAPIキー |
| `GEOAPIFY_API_KEY` | ○ | GeoapifyのAPIキー |
| `SPREADSHEET_ID` | ○ | 管理用スプレッドシート（非公開）のID |
| `ADMIN_EMAIL` |  | 障害・日次レポートの通知先 |
| `FRONTEND_URL` / `WEB_APP_URL` |  | ヘルスチェック対象のURL |
| `BACKUP_FOLDER_ID` |  | 管理データのバックアップ先フォルダ |
| `RATE_LIMIT_PER_MINUTE` |  | 全体の1分あたり受付数（既定 120） |
| `MAX_CONCURRENT` |  | 同時処理数（既定 10） |
| `DAILY_API_LIMIT` |  | 外部API呼出の日次上限（既定 100。再試行・自動更新・お気に入りのID検索も実呼出として計上、日付はJST） |
| `SERVICE_STOPPED` |  | `true` で全機能を停止 |
| `API_ENABLED` |  | 旧版互換。`false` で全機能を停止（未設定なら有効） |
| `FAVORITES_ENABLED` |  | 旧版互換。`true` でお気に入りを有効化（シート「09_機能管理」でも可） |
| `PUBLIC_NOTICE` |  | 旧版互換。お知らせ本文（シート「03_お知らせ」と併用可） |
| `CACHE_ENABLED` / `CACHE_SECONDS` |  | 旧版互換。キャッシュの無効化（`false`）／保持秒数（1〜1800） |

旧版で使っていた `MIN_REQUEST_INTERVAL_MS`・`LAST_REQUEST_MS`・`TEMPORARY_FAILURES`・`CIRCUIT_UNTIL` は使用しません（削除して問題ありません）。

3. エディタで `setupOperations` → `setupTriggers` を一度ずつ実行します。
4. 「デプロイ → 新しいデプロイ → ウェブアプリ」で、**実行ユーザー：自分**、**アクセスできるユーザー：全員**を選んで公開し、URLを `js/config.js` の `GAS_URL` に設定します。コードを更新したときは「デプロイを管理」→ 編集 →「新しいバージョン」で更新します（URLが変わりません）。
5. エディタで `diagnose` を実行すると、設定の有無・停止の原因・本日のAPI呼出数をログで確認できます（APIキーの値は表示しません）。

### トラブルシューティング

| 症状 | 主な原因と対処 |
| --- | --- |
| アプリで「ERR_NETWORK」になるが、ブラウザでGASのURLを開くとJSONが表示される | デプロイの「アクセスできるユーザー」が「全員」になっていません（「Googleアカウントを持つ全員」「自分のみ」では、アプリからの匿名通信にログイン画面が返り、CORSエラーになります）。または `GAS_URL` が別のデプロイを指しています |
| ステータスが `maintenance` になる | `diagnose` の【判定】を確認。`SERVICE_STOPPED` が有効、`API_ENABLED` が無効、シート「09_機能管理」の `service` が無効、シート「04_メンテナンス」に実施中の予定、のいずれかです（設定変更の反映は最大60秒） |
| `ERR_RATE_LIMIT` になる | 本日の外部API呼出が `DAILY_API_LIMIT` に達しています（JSTの日付で翌日にリセット） |
5. 開発用と本番用でGAS・シート・キーを分けてください（SEC-01）。

お気に入りを有効にする場合は、規約確認のうえ `js/config.js` の `FAVORITES_ENABLED` を `true` にし、シート「09_機能管理」の `favorites` を `TRUE` にします。

## 5. セキュリティ・プライバシー

- APIキーは GAS の Script Properties のみで管理し、応答・ログに出力しません。
- GAS は操作名・型・座標・文字数・ページ位置を検証し、任意URLの代理取得や管理操作を公開しません。
- サーバー側で全体レート制限・同時実行制限・日次予算・停止フラグ・サーキットブレーカーを適用します。
- 外部データは `textContent` で描画し、外部リンクは許可ドメイン・HTTPSのみ。外部CSS/JSは版固定・SRI付き。
- 運用ログには日時・匿名の識別番号・エラー分類のみを記録し、座標・住所・検索語は記録しません。
- 登録地点・検索条件は利用者の端末内にのみ保存します（LocalStorage は暗号化されません）。

詳しくは [SECURITY.md](SECURITY.md) を参照してください。

## 6. アクセシビリティ

WCAG 2.2 AA を目標としています（適合を保証するものではありません）。

- キーボード操作、フォーカスの可視化、スキップリンク、モーダルのフォーカス管理と復帰
- 結果件数・エラーの読み上げ通知、装飾アイコンの読み上げ除外
- タッチ対象 44×44px、320px幅でのリフロー、200%拡大への配慮
- ライト／ダーク／システム、文字サイズ3段階、高コントラスト、動きの低減（OS設定も反映）

## 7. 対応環境

| OS | ブラウザ（最新安定版） |
| --- | --- |
| Windows | Chrome / Edge |
| macOS | Safari / Chrome / Edge |
| iOS・iPadOS | Safari / Chrome / Edge |
| Android | Chrome / Edge |

上記は対応目標です。動作確認済みの環境は検証後に別途記載します。

## 8. クレジット

- Powered by [ホットペッパーグルメ Webサービス](https://webservice.recruit.co.jp/)／画像提供：ホットペッパー グルメ
- 地図データ：© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- 住所・駅名検索：[Geoapify](https://www.geoapify.com/)
- ライブラリのライセンスはアプリ内「外部サービス・ライセンス」に記載しています。

## 9. 注意事項

- ホットペッパーグルメAPIで取得できる店舗のうち、登録地点から近い順に最大100件（APIの1回の取得上限）が対象です。2ページ目以降は取得しないため、すべての飲食店を網羅しません。
- 営業時間・定休日・予算などは提供元の掲載内容です。最新情報は店舗公式ページ等でご確認ください。
- 徒歩時間は直線距離（分速80m）から計算した目安です。
- 平均予算はディナーの平均予算で、ランチの予算ではありません。
