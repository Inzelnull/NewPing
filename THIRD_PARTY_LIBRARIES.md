# NewPing 使用サードパーティ（標準外）ライブラリ一覧

本アプリケーション（NewPing）の開発・実行にあたって使用している標準外（サードパーティ）ライブラリの一覧です。

---

## 1. バックエンド（Rust / Cargo）

| ライブラリ名 (Crate) | 用途・役割 | ライセンス |
| :--- | :--- | :--- |
| **tauri** (v2.x) | デスクトップGUIフレームワーク（ウィンドウ管理、IPC通信、システムトレイ、アセット配信） | MIT / Apache-2.0 |
| **tauri-build** (v2.x) | Tauriアプリケーションのビルド時コード生成およびスキーマ検証 | MIT / Apache-2.0 |
| **tauri-plugin-log** (v2.x) | バックエンドのログ出力および管理プラグイン | MIT / Apache-2.0 |
| **tokio** (v1.x) | 非同期ランタイム（Traceroute外部プロセスの非同期実行、ストリーム読み込み、タイマー制御） | MIT |
| **serde** / **serde_json** (v1.0) | 設定ファイル（JSON）およびIPC通信データのシリアライズ／デシリアライズ | MIT / Apache-2.0 |
| **windows-sys** (v0.59) | Windows Win32 APIバインディング（IcmpSendEcho 等を用いた高速・直接的なICMP Echo送信） | MIT / Apache-2.0 |
| **encoding_rs** (v0.8) | 文字コード変換（Windows標準 `tracert` コマンドのShift-JIS/CP932出力をUTF-8にデコード） | Apache-2.0 / MIT |
| **parking_lot** (v0.12) | 高性能・軽量な同期プリミティブ（Mutex等によるスレッドセーフな状態管理） | MIT / Apache-2.0 |
| **log** (v0.4) | Rust汎用ロギングファサード | MIT / Apache-2.0 |

---

## 2. フロントエンド（TypeScript / Node.js / npm）

| パッケージ名 | 用途・役割 | 区分 | ライセンス |
| :--- | :--- | :--- | :--- |
| **@tauri-apps/api** (v2.x) | フロントエンドからTauri IPC（`invoke`、イベント `listen` 等）を呼び出す公式クライアントSDK | Runtime | MIT / Apache-2.0 |
| **@tauri-apps/cli** (v2.x) | アプリケーションのビルド・開発・インストーラー（NSIS）生成を行うCLIツール | Dev | MIT / Apache-2.0 |
| **vite** (v8.x) | 高速ビルドツールおよびローカル開発用サーバー | Dev | MIT |
| **typescript** | TypeScript言語コンパイラおよび型チェッカー | Dev | Apache-2.0 |
| **lucide** (v1.x) | UIで使用するSVGアイコンセット | Dev | ISC |
| **esbuild** | 高速JavaScript/TypeScriptトランスパイラ・バンドラー | Dev | MIT |

---

## 3. 外部Webフォント（Google Fonts CDN）

| フォント名 | 用途 | ライセンス |
| :--- | :--- | :--- |
| **JetBrains Mono** | ログ画面、ターミナル風表示、IPアドレス等の等幅フォント表示 | OFL (SIL Open Font License) |
| **Plus Jakarta Sans** | アプリケーション全体の英数字・見出し用サンセリフフォント | OFL (SIL Open Font License) |
| **Noto Sans JP** | 日本語UIテキスト表示用フォント | OFL (SIL Open Font License) |
