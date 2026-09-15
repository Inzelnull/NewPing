# NewPing 使用サードパーティ（標準外）ライブラリ一覧

本アプリケーション（NewPing）の開発・実行にあたって使用しているライブラリの一覧です。
**マルウェア感染・サプライチェーンリスク対策として、個人管理のクレートを完全排除し、Microsoft公式・公的財団（The Commons Conservancy）・Rust標準エコシステムのみで構成**しています。

---

## 1. バックエンド（Rust / Cargo）

| ライブラリ名 (Crate) | 管理主体 / 開発元 | 用途・役割 | ライセンス |
| :--- | :--- | :--- | :--- |
| **windows-sys** (v0.59) | **Microsoft公式** (`microsoft/windows-rs`) | Windows Win32 APIバインディング（ICMP Echo高速送信 `IcmpSendEcho`、Win32ネイティブ文字コード変換 `MultiByteToWideChar`、ウィンドウ制御） | MIT / Apache-2.0 |
| **tauri** (v2.x) | **The Commons Conservancy** (公的オープンソース財団) | デスクトップGUIフレームワーク（WebView2管理、IPC通信、システムトレイ、アセット配信） | MIT / Apache-2.0 |
| **tauri-build** (v2.x) | **The Commons Conservancy** (公的オープンソース財団) | Tauriアプリケーションのビルド時コード生成およびスキーマ検証 | MIT / Apache-2.0 |
| **tokio** (v1.x) | **Tokio Contributors** (AWS, Microsoft等のコンソーシアム) | 非同期ランタイム（Traceroute外部プロセスの非同期実行、ストリーム読み込み、タイマー制御） | MIT |
| **serde** / **serde_json** (v1.0) | **Rustエコシステム標準** (dtolnay 他) | 設定ファイル（JSON）およびIPC通信データのシリアライズ／デシリアライズ | MIT / Apache-2.0 |

> **【削除・標準化されたクレート】**:
> - `parking_lot` ➡️ **完全排除**（Rust標準ライブラリ `std::sync::Mutex` に移行）
> - `encoding_rs` ➡️ **完全排除**（Microsoft公式 Win32 API `MultiByteToWideChar` によるネイティブ変換に移行）
> - `tauri-plugin-log` / `log` ➡️ **完全排除**（不要な依存の削除）

---

## 2. フロントエンド（TypeScript / Node.js / npm）

| パッケージ名 | 管理主体 / 開発元 | 用途・役割 | 区分 | ライセンス |
| :--- | :--- | :--- | :--- | :--- |
| **@tauri-apps/api** (v2.x) | **The Commons Conservancy** | フロントエンドからTauri IPC（`invoke`、イベント `listen` 等）を呼び出すクライアントSDK | Runtime | MIT / Apache-2.0 |
| **typescript** | **Microsoft公式** | TypeScript言語コンパイラおよび型チェッカー | Dev | Apache-2.0 |
| **@tauri-apps/cli** (v2.x) | **The Commons Conservancy** | アプリケーションのビルド・インストーラー（NSIS）生成を行うCLIツール | Dev | MIT / Apache-2.0 |
| **vite** (v8.x) / **esbuild** | VoidZero / Evan Wallace | 高速ビルドツールおよびローカル開発用サーバー（ビルド成果物には含まれない） | Dev | MIT |

> **【削除されたパッケージ】**:
> - `lucide` ➡️ **完全排除**（SVGはすべてHTML内にインライン実装されているため削除）

---

## 3. フォントおよび外部リソース

- **外部Webフォント CDN (`fonts.googleapis.com`) への通信依存を完全撤廃**。
- Windows OS標準の高品質フォント（`Segoe UI`, `Yu Gothic UI`, `Meiryo`, `BIZ UDPGothic`, `Consolas` 等）を優先するCSSフォントスタックを採用。
- 完全オフライン・ネットワーク遮断環境でもフォント描画・UI崩れなく100%美しく動作します。
