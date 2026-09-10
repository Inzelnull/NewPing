# NewPing (Pingツール) 🌐⚡

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg?logo=tauri)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021-orange.svg?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.2-purple.svg?logo=vite)](https://vitejs.dev/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6.svg?logo=windows)](https://microsoft.com/windows)

**NewPing** は、ネットワーク機器（サーバー、ルーター、DNS、PC等）の死活監視および応答品質（RTT・パケットロス率）をリアルタイムかつ直感的に監視できる、軽量・高速なデスクトップ向けネットワーク監視アプリケーションです。

---

## 📥 ダウンロード (ダウンロードしてすぐ使えます)

環境に合わせて以下のいずれかをダウンロードしてご利用ください：

| 配布形式 | ダウンロードリンク | ファイルサイズ | 特徴 |
| :--- | :--- | :--- | :--- |
| **スタンドアロン実行ファイル** | [📥 **NewPing.exe をダウンロード**](https://github.com/Inzelnull/NewPing/raw/main/src-tauri/target/release/NewPing.exe) | 約 10 MB | インストール不要。ダウンロード後そのまま起動できるポータブル版 |
| **NSIS インストーラー** | [📥 **Pingツール_0.1.0_x64-setup.exe をダウンロード**](https://github.com/Inzelnull/NewPing/raw/main/src-tauri/target/release/bundle/nsis/Ping%E3%83%84%E3%83%BC%E3%83%AB_0.1.0_x64-setup.exe) | 約 2.4 MB | スタートメニューやデスクトップにショートカットを作成するセットアップ版 |

> [!TIP]
> - 初回起動時に Windows SmartScreen の警告が表示された場合は、「詳細情報」→「実行」をクリックしてください。
> - 監視対象リストは実行ファイルと同じフォルダに `ping-list.config` として自動保存されます。

---

## ✨ 主な特長

- 🚀 **超軽量＆高速動作**: Tauri v2 + Rust による最小限のメモリ・CPUリソース消費と即時起動。
- 🎯 **高精度 ICMP Ping**: Windows標準の `IcmpSendEcho` API を直接呼び出し、管理者権限不要でミリ秒単位の高精度な往復遅延時間（RTT）を計測。
- 📊 **直感的なストリーム可視化**: 監視結果を「〇 (青/正常)」と「× (赤/不通)」のタイムライン形式で最新順に常時ストリーム表示。
- 🚨 **不通検知アラート**: 監視対象のタイムアウトや不通を検知した際にポップアップで即座に通知。
- 📈 **詳細統計 & CSVエクスポート**: パケットロス率、平均/最小/最大RTTをリアルタイムに自動集計。Excel対応（BOM付きUTF-8）のCSVファイルとしてエクスポート可能。
- 🧭 **Traceroute（経路追跡）**: 対象ホストへのネットワーク経路と各ホップの応答速度を調査可能。
- 🎨 **ダーク / ライトテーマ対応**: システム環境や好みに応じてワンクリックで外観を切り替え可能。
- 📌 **システムトレイ常駐**: 最小化時やバックグラウンドでの継続監視に対応。

---

## 🖥️ 画面・機能紹介

| タブ / 画面 | 機能説明 |
| :--- | :--- |
| **Ping結果** | 登録された全監視対象のPing結果をリアルタイムにストリーム表示。クリックで対象の統計情報を即座に参照可能。 |
| **Ping対象設定** | 監視対象（IPアドレスまたはホスト名＋表示ラベル）の追加・編集・削除、および `ping-list.config` ファイルの保存・再読み込み。 |
| **Ping設定** | 送信間隔（秒）、タイムアウト（ms）、データサイズ（Byte）、アラート通知の有効/無効、テーマ切替（ダーク/ライト）などを設定。 |
| **Ping統計** | 全対象の送信回数、成功/失敗数、パケットロス率、最小/最大/平均RTTの集計一覧。CSV保存機能付き。 |
| **Traceroute** | 指定したホストへの経路追跡をサブウィンドウで実行し、各ルーターのホップ情報を表示。 |
| **マルチディスプレイ対応** | デュアルディスプレイ環境等で、実行ファイルやフォルダが存在するディスプレイを自動検知して中央に起動。 |

---

## 🛠️ 技術スタック

| 区分 | 技術・ライブラリ | 用途 |
| :--- | :--- | :--- |
| **デスクトップ基盤** | **Tauri v2** (`@tauri-apps/api`, `@tauri-apps/cli`) | デスクトップアプリ基盤、ウィンドウ・トレイ制御、IPC |
| **バックエンド** | **Rust** (2021 Edition) | 非同期Pingループ処理、ファイルI/O、トレイ管理、マルチモニター検出 |
| **Pingエンジン** | `windows-sys` (`IcmpSendEcho`, `Win32_UI_WindowsAndMessaging`) | WindowsネイティブICMP API & ウィンドウ配置制御 |
| **非同期ランタイム** | `tokio`, `parking_lot` | マルチスレッド非同期処理、スレッドセーフな状態管理 |
| **フロントエンド** | **TypeScript, HTML5, Vanilla CSS** | UI構造、モダンUIデザイン、リアクティブ状態管理 |
| **アイコン・フォント** | **Lucide Icons**, Google Fonts (JetBrains Mono / Plus Jakarta Sans) | 高視認性のタイポグラフィとUIアイコン |
| **ビルドツール** | **Vite** | 高速フロントエンドバンドラ・開発環境 |

---

## 📋 動作要件

- **OS**: Windows 10 / Windows 11 (64-bit)
- **WebView2**: Windows標準搭載（通常はプリインストール済み）

---

## 🚀 開発環境のセットアップとビルド

### 1. 前提条件のインストール
- [Node.js](https://nodejs.org/) (v18 以上推奨)
- [Rust](https://www.rust-lang.org/tools/install) (最新の stable ツールチェーン)
- [C++ Build Tools (Visual Studio)](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### 2. リポジトリのクローンと依存関係のインストール
```bash
git clone <repository-url>
cd NewPing
npm install
```

### 3. 開発モードでの起動
```bash
npm run tauri dev
```
Hot Module Replacement (HMR) が有効な状態でデスクトップアプリが起動します。

### 4. 本番用バイナリのビルド
```bash
npm run tauri build
```

### 📦 生成される実行ファイルとインストーラーのパス

ビルド完了後、以下のパスに実行ファイルおよびインストーラーが生成されます（クリックしてダウンロードも可能です）：

| 種別 | ダウンロードリンク | ファイルパス | 説明 |
| :--- | :--- | :--- | :--- |
| **スタンドアロン実行ファイル** | [📥 **NewPing.exe**](https://github.com/Inzelnull/NewPing/raw/main/src-tauri/target/release/NewPing.exe) | `src-tauri/target/release/NewPing.exe` | インストール不要で単体起動できるポータブル実行バイナリ |
| **NSIS インストーラー** | [📥 **Pingツール_0.1.0_x64-setup.exe**](https://github.com/Inzelnull/NewPing/raw/main/src-tauri/target/release/bundle/nsis/Ping%E3%83%84%E3%83%BC%E3%83%AB_0.1.0_x64-setup.exe) | `src-tauri/target/release/bundle/nsis/Pingツール_0.1.0_x64-setup.exe` | スタートメニューやデスクトップショートカットを作成するセットアッププログラム |


---

## ⚙️ 設定ファイル仕様 (`ping-list.config`)

監視対象ホストはアプリケーション実行ディレクトリ（または作業ディレクトリ）直下の `ping-list.config` に保存されます。

### フォーマット
```text
<IPアドレスまたはホスト名> <表示名（任意）>
```

### 記述例
```text
8.8.8.8 Google DNS
1.1.1.1 Cloudflare DNS
127.0.0.1 ローカルホスト
192.168.1.1 ルーター
```
- 空行は無視されます。
- 表示名が省略された場合は、IPアドレス/ホスト名が表示名として使用されます。

---

## 📄 ドキュメント・関連ファイル

- [アプリケーション詳細仕様書 (SPECIFICATION.md)](./SPECIFICATION.md)
- [ライセンス監査 (LICENSE_AUDIT.md)](./LICENSE_AUDIT.md)
- [サードパーティライブラリ一覧 (THIRD_PARTY_LIBRARIES.md)](./THIRD_PARTY_LIBRARIES.md)

---

## 📜 ライセンス

本プロジェクトはプライベート/内部利用向けに設計されています。使用しているサードパーティライブラリのライセンス詳細については [THIRD_PARTY_LIBRARIES.md](./THIRD_PARTY_LIBRARIES.md) をご参照ください。
