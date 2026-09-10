# Pingツール (NewPing) アプリケーション仕様書

本書は、デスクトップ向けネットワーク監視アプリケーション「**Pingツール (NewPing)**」の機能、アーキテクチャ、画面設計、内部処理仕様を定義した仕様書です。

---

## 目次
1. [システム概要](#1-システム概要)
2. [システム構成・技術スタック](#2-システム構成技術スタック)
3. [システムアーキテクチャ](#3-システムアーキテクチャ)
4. [機能要件一覧](#4-機能要件一覧)
5. [画面設計およびUI/UX仕様](#5-画面設計およびuiux仕様)
   - 5.1 [共通ヘッダー・ナビゲーション](#51-共通ヘッダーナビゲーション)
   - 5.2 [Ping結果画面（監視モニター）](#52-ping結果画面監視モニター)
   - 5.3 [Ping対象設定画面](#53-ping対象設定画面)
   - 5.4 [Ping設定画面（オプション・テーマ）](#54-ping設定画面オプションテーマ)
   - 5.5 [Ping統計画面](#55-ping統計画面)
   - 5.6 [共通モーダル・通知](#56-共通モーダル通知)
6. [データ構造・設定仕様](#6-データ構造設定仕様)
   - 6.1 [設定ファイル仕様 (ping-list.config)](#61-設定ファイル仕様-ping-listconfig)
   - 6.2 [統計データ構造とCSVエクスポート仕様](#62-統計データ構造とcsvエクスポート仕様)
   - 6.3 [LocalStorage 保存キー](#63-localstorage-保存キー)
7. [バックエンド (Rust/Tauri) 仕様](#7-バックエンド-rusttauri-仕様)
   - 7.1 [ICMP Ping 実装仕様](#71-icmp-ping-実装仕様)
   - 7.2 [IPCコマンド (Invoke API) 一覧](#72-ipcコマンド-invoke-api-一覧)
   - 7.3 [イベント通知仕様](#73-イベント通知仕様)
8. [ウィンドウおよびトレイ動作仕様](#8-ウィンドウおよびトレイ動作仕様)

---

## 1. システム概要

### 1.1 目的
ネットワーク機器（サーバー、ルーター、DNS、PC等）の死活監視および応答品質（RTT、パケットロス率）をリアルタイムに視覚的・直感的に監視するためのデスクトップアプリケーション。

### 1.2 主な特長
- **超軽量＆高速動作**: Tauri v2 + Rust による最小限のリソース消費と高速起動。
- **高精度 ICMP Ping**: Windows標準の `IcmpSendEcho` API を直接呼び出し、高精度な往復遅延時間(RTT)をミリ秒単位で計測。
- **直感的なストリーム可視化**: 監視結果を「〇(青/正常)」と「×(赤/不通)」のタイムライン形式で最新順に常時表示。
- **不通検知アラート**: Ping失敗（タイムアウト）が発生した機器を即座にポップアップ検知。
- **詳細統計とCSV保存**: パケットロス率、平均/最小/最大RTTをリアルタイム自動集計し、Excel対応のCSV形式で保存可能。
- **トレイ常駐 & テーマ切替**: システムトレイへの最小化格納、ダークモード/ホワイトモードの切替に対応。

---

## 2. システム構成・技術スタック

| 区分 | 技術・ライブラリ | 用途 / 補足 |
| :--- | :--- | :--- |
| **デスクトップ基盤** | **Tauri v2** (`@tauri-apps/cli` ^2.11, `@tauri-apps/api` ^2.11) | デスクトップアプリ基盤、ウィンドウ制御、IPC通信 |
| **バックエンド** | **Rust** (Edition 2021) | ネイティブICMP Ping実行、ファイルI/O、トレイ管理 |
| **Pingエンジン** | `windows-sys` (IpHelper: `IcmpSendEcho`) | WindowsネイティブICMP API呼び出し |
| **非同期ランタイム** | `tokio`, `parking_lot` | 非同期ループ、スレッドセーフなステート管理 |
| **フロントエンド** | **HTML5 / Vanilla CSS / TypeScript** | UI構造、モダンデザイン、ステート管理 |
| **ビルドツール** | **Vite** ^8.2 | 高速フロントエンドビルド・開発サーバー |
| **フォント** | JetBrains Mono, Plus Jakarta Sans, Noto Sans JP | Google Fonts による視認性の高いUIタイポグラフィ |

---

## 3. システムアーキテクチャ

```mermaid
graph TD
    subgraph Frontend [WebView2 (Frontend)]
        UI[UI View / Tabs]
        State[App State & Stats Manager]
        Storage[(LocalStorage)]
    end

    subgraph IPC [Tauri IPC Bridge]
        Invokes[Invoke Commands]
        Events[Event Listener: ping-result, request-close]
    end

    subgraph Backend [Rust Backend]
        TauriCore[Tauri App State & Tray Handler]
        PingLoop[Tokio Async Ping Worker Loop]
        ICMP[Windows IcmpSendEcho API]
        FileIO[Config & CSV File I/O]
    end

    UI -->|操作イベント| State
    State -->|start_ping / stop_ping| Invokes
    State -->|save_config / load_config| Invokes
    State -->|save_stats_file / exit_app| Invokes
    State <-->|設定・テーマ永続化| Storage

    Invokes --> TauriCore
    TauriCore --> PingLoop
    PingLoop -->|各ターゲット並行実行| ICMP
    PingLoop -->|結果送信 emit| Events
    Events -->|ping-result| State
    State -->|リアルタイム描画更新| UI
    TauriCore --> FileIO
```

---

## 4. 機能要件一覧

| 機能ID | 機能名 | 機能概要 |
| :--- | :--- | :--- |
| **F-01** | Ping一括監視 | 登録された全対象に対して指定周期・指定ディレイでPingを実行（ディレイ0ms時は同時実行、1ms以上時は上から順にディレイ実行） |
| **F-02** | タイムラインストリーム表示 | 最新結果を右端に追加し、過去履歴（最大100件）を横スクロール表示 |
| **F-03** | 不通(NG)即時通知ポップアップ | Ping失敗が発生している機器を右下に常時リストアップ表示 |
| **F-04** | 履歴クリア | 画面上の応答履歴・ステータス表示を初期化 |
| **F-05** | 対象設定編集 & プレビュー | テキスト形式で対象を編集、即時バリデーション＆件数プレビュー表示 |
| **F-06** | 設定ファイル連携 | `ping-list.config` の起動時自動読込、保存、手動再読込 |
| **F-07** | 周期・タイムアウト・ディレイ・パケットサイズ調整 | 実行間隔（1〜10秒）、実行ディレイ（0〜1000ms、初期値50ms）、パケットサイズ（32〜10000バイト、スライダー32〜1472、初期値32B、送信サイズ+28B表示、分割不可DFフラグ付与）、タイムアウト（500〜5000ms）を自由に調整 |
| **F-08** | カラーテーマ切替 | ホワイトモード / ダークモードの切替とローカル保存 |
| **F-09** | 統計集計 | 送信数、成功数、失敗数、ロス率、平均/最小/最大RTTをリアルタイム算出 |
| **F-10** | CSVレポート保存 | 集計統計データをUTF-8 BOM付きCSVファイルとして保存/ダウンロード |
| **F-11** | システムトレイ常駐 | ウィンドウ最小化時にトレイへ格納、左クリックでの表示/非表示切替 |
| **F-12** | 終了確認ダイアログ | 誤操作防止のため、閉じるボタンおよびトレイ終了時に確認ダイアログを表示 |

---

## 5. 画面設計およびUI/UX仕様

### 5.1 共通ヘッダー・ナビゲーション
- **ロゴエリア**: アプリケーション名（`Pingツール`）とパルスアイコン。
- **タブナビゲーション**:
  - `Ping結果` (`#tab-btn-results`)
  - `Ping対象設定` (`#tab-btn-settings`)
  - `Ping設定` (`#tab-btn-options`)
  - `Ping統計` (`#tab-btn-stats`)
- **グローバルステータスバッジ**:
  - 停止時: 灰色「停止中」
  - 実行中: 青色パルス「監視中 (X秒毎)」

### 5.2 Ping結果画面（監視モニター）
- **ヘッダー操作部**:
  - `履歴クリア`: 表示履歴および集計をリセット（確認モーダル表示）。
  - `Ping開始 / Ping停止`: 監視の開始・停止を切り替えるプライマリボタン。
- **結果テーブル**:
  | 列名 | 内容 |
  | :--- | :--- |
  | **Ping対象** | 日本語名称およびIPアドレス |
  | **最新状態** | 最新RTT（例: `12 ms`）または `Timeout` / `待機中` |
  | **実行回数** | 当該ターゲットの総Ping試行回数 |
  | **応答履歴** | 〇(青) / ×(赤) のタイムラインバッジ。ホバーで日時と応答時間のツールチップ表示。マウスホイールでの横スクロール対応。 |
- **不通検知フローティングポップアップ (右下)**:
  - 1件以上NGが存在する場合に自動表示。
  - 対象の名称・IP・「不通 (NG)」バッジをリアルタイム表示。全て復旧すると自動非表示。

### 5.3 Ping対象設定画面
- **エディタカード**: `ping-list.config` を直接編集できるテキストエリア。
- **サイドバー**:
  - 記入ヒント（`[IPアドレス] [名称]` 形式の案内）。
  - リアルタイムパースプレビュー（認識されたターゲット一覧と件数）。
- **操作ボタン**: `設定を保存`、`再読込`（破棄確認モーダル付き）。

### 5.4 Ping設定画面（オプション・テーマ・保存先）
- **Ping実行間隔**:
  - 範囲: 1秒 〜 10秒（スライダー & 数値入力 & クイック選択プリセット）。
- **Ping実行ディレイ**:
  - 範囲: 0ms 〜 1000ms（スライダー & 数値入力 & クイック選択プリセット、初期値: 50ms）。
  - 0ms 設定時は全対象へ同時にPing発行。1ms以上設定時はリスト上から順にディレイ分ずらしてPingを発行。
- **Pingパケットサイズ (ペイロード)**:
  - 範囲: 32バイト 〜 10000バイト（初期値: 32バイト）。
  - スライダー範囲: 32バイト 〜 1472バイト。
  - 手動数値入力範囲: 32バイト 〜 10000バイト。
  - 送信データサイズ表示: パケットサイズ＋28バイト（IPヘッダ20B＋ICMPヘッダ8B）の実際の送信Wire Sizeをリアルタイム表示。
  - 分割不可（Don't Fragment / DF）フラグを付与してPingを発行。
  - **パケットサイズ自動縮小オプション**: 「NG発生時にOKになるまでパケットサイズを1ずつ自動縮小」スイッチ。有効時、いずれかの監視対象でPingがNG（タイムアウト等）となった場合、全対象がPing OKになるまで毎回のPing送信サイクルごとにパケットサイズを1バイトずつ減らしながら送信（下限: 32B）。全対象がOKになった場合は減算を停止しそのサイズを維持。
- **タイムアウト値**:
  - 範囲: 500ms 〜 5000ms（スライダー & 数値入力 & クイック選択プリセット）。
- **Tracerouteタイムアウト時間**:
  - 範囲: 10秒 〜 300秒（スライダー & 数値入力 & クイック選択プリセット、初期値: 60秒）。
- **応答履歴の表示件数**:
  - 範囲: 50件 〜 1000件（スライダー & 数値入力 & クイック選択プリセット、初期値: 100件）。
- **結果保存先フォルダ**:
  - Traceroute実行結果（個別・一括）およびPing統計結果（CSV）の保存先パス。
  - 初期値: `result`（Pingツール配下の `result` フォルダ）。
  - 保存時に指定フォルダが存在しない場合は、バックエンド側で自動的にフォルダを作成してから保存。
  - 「フォルダ参照」ボタンによるWindowsネイティブダイアログ選択、および「フォルダを開く」ボタンによるエクスプローラー直接起動に対応。
- **バリデーション**:
  - タイムアウト値が実行間隔を超える場合、ディレイ値やパケットサイズが範囲外の場合は警告アラートを表示し、開始をガード。
- **カラーテーマ**:
  - `ホワイトモード` / `ダークモード` のラジオカード選択。
- **操作ボタン**: `初期値に戻す` (1秒 / 50msディレイ / 32B / 自動縮小OFF / 1000ms / Traceroute60秒 / 履歴100件 / 保存先result)、`設定を保存`。

### 5.5 Ping統計画面
- **サマリーカード（4項目）**:
  1. 監視対象数
  2. 総送信パケット数
  3. 総成功パケット数 (緑色強調)
  4. 全体パケットロス率 (ロス発生時は赤色強調)
- **統計詳細テーブル**:
  - 状態（正常/不通/待機）、日本語名称、IPアドレス、送信数、成功数、失敗数、ロス率(%)、最新RTT、平均RTT、最小RTT、最大RTT。
- **操作ボタン**: `統計リセット`、`統計保存 (CSV)`（設定された保存先フォルダへ出力）。

### 5.6 共通モーダル・通知
- **確認モーダル (`#confirm-modal`)**:
  - 履歴クリア、設定再読込、統計リセット、アプリ終了時に表示。
  - キーボード操作（Escapeでキャンセル、Enter/確認ボタンで実行）および外側クリックで閉じる挙動に対応。
- **トースト通知 (`#toast-container`)**:
  - 操作完了時（保存成功、設定読込、エラー発生等）に画面右上にフェードイン・フェードアウト通知。保存先パスも明示。

---

## 6. データ構造・設定仕様

### 6.1 設定ファイル仕様 (`ping-list.config`)
- **配置場所**: 実行ファイルと同階層（またはカレントディレクトリ）
- **文字コード**: UTF-8
- **記法ルール**:
  - 1行に1ターゲットを定義: `<IPアドレスまたはホスト名><空白またはタブ><表示名称>`
  - 空白行および `#` や `//` で始まる行はコメントとして無視。
- **例**:
  ```text
  8.8.8.8 Google DNS
  1.1.1.1 Cloudflare DNS
  127.0.0.1 ローカルホスト
  192.168.1.1 ルーター
  ```

### 6.2 パラメータ設定ファイル仕様 (`ping-parameters.conf`)
- **配置場所**: 実行ファイルと同階層（またはカレントディレクトリ）
- **文字コード**: UTF-8
- **記法ルール**:
  - `キー=値` 形式（1行に1パラメータ）
  - `#` や `;` で始まる行および空白行はコメントとして無視
  - Ping設定画面の「設定を保存」ボタン押下時に保存（既に存在する場合は上書き確認ポップアップを表示）
  - 起動時に同ファイルが存在する場合は優先読込して各設定項目に反映
- **保存項目**:
  - `interval_sec`: Ping実行間隔 (1〜10秒)
  - `delay_ms`: Ping実行ディレイ (0〜1000ms)
  - `packet_size`: Pingパケットサイズ (32〜10000バイト)
  - `auto_decrease_size`: 3回連続NG時にパケットサイズ自動縮小 (true/false)
  - `timeout_ms`: Pingタイムアウト値 (500〜5000ms)
  - `traceroute_timeout_sec`: Tracerouteタイムアウト時間 (10〜300秒)
  - `max_stream_items`: 応答履歴の表示件数 (50〜1000件)
  - `save_dir`: 結果保存先フォルダ (初期値: `result`)
  - `theme`: カラーテーマ (`light` または `dark`)
- **例**:
  ```ini
  # Pingツール パラメータ設定ファイル (ping-parameters.conf)
  interval_sec=1
  delay_ms=50
  packet_size=32
  auto_decrease_size=false
  timeout_ms=1000
  traceroute_timeout_sec=60
  max_stream_items=100
  save_dir=result
  theme=light
  ```

### 6.3 統計データ構造とCSVエクスポート仕様
- **ファイル名**: `ping_stats_YYYYMMDD_HHMMSS.csv`
- **保存先**: 設定された保存先フォルダ（初期値: `result` フォルダ、存在しない場合は自動作成）
- **エンコーディング**: UTF-8（Excel文字化け防止用 **UTF-8 BOM** `\uFEFF` 付与）
- **出力フォーマット**:
  ```csv
  # Ping統計結果レポート
  # 出力日時: 2026-09-01 15:30:00
  # 監視対象数: 4, 総送信数: 120, 総成功数: 118, 総失敗数: 2, 全体ロス率: 1.7%

  状態,日本語名称,IPアドレス,送信数,成功数,失敗数,ロス率(%),最新RTT(ms),平均RTT(ms),最小RTT(ms),最大RTT(ms)
  正常,Google DNS,8.8.8.8,30,30,0,0.0%,14,15,12,22
  正常,Cloudflare DNS,1.1.1.1,30,30,0,0.0%,11,12,10,18
  正常,ローカルホスト,127.0.0.1,30,30,0,0.0%,0,0,0,1
  不通,ルーター,192.168.1.1,30,28,2,6.7%,NG,2,1,5
  ```

### 6.4 LocalStorage 保存キー
| キー名 | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `app_theme` | `string` | `"light"` | カラーテーマ (`"light"` または `"dark"`) |
| `ping_interval_sec` | `number` | `1` | Ping実行間隔（秒） |
| `ping_delay_ms` | `number` | `50` | Ping実行ディレイ（ms、0で同時実行） |
| `ping_packet_size` | `number` | `32` | Pingパケットサイズ（バイト、32〜10000） |
| `ping_auto_decrease_size` | `boolean` | `false` | Ping NG時のパケットサイズ自動縮小オプション |
| `ping_timeout_ms` | `number` | `1000` | Ping応答タイムアウト（ms） |
| `ping_traceroute_timeout_sec` | `number` | `60` | Tracerouteタイムアウト時間（秒、10〜300） |
| `ping_max_stream_items` | `number` | `100` | 応答履歴の表示件数（50〜1000） |
| `ping_save_dir` | `string` | `"result"` | 結果保存先フォルダパス（相対パス/絶対パス） |

---

## 7. バックエンド (Rust/Tauri) 仕様

### 7.1 ICMP Ping 実装仕様 (`pinger.rs`)
- **Windows環境 (`cfg(windows)`)**:
  - `windows_sys::Win32::NetworkManagement::IpHelper` の `IcmpCreateFile`, `IcmpSendEcho`, `IcmpCloseHandle` を使用。
  - IPv4アドレスおよびホスト名解決に対応。
  - 送信ペイロード: 指定サイズ（32〜10000バイト）のASCIIパターン列を動的生成。
  - `IP_OPTION_INFORMATION` の `Flags` に `0x02` (`IP_FLAG_DF`: Don't Fragment) を設定し、パケット分割不可フラグを付与。
  - レスポンスの `Status == 0` (IP_SUCCESS) の場合に `RoundTripTime` を取得し成功と判定。
- **その他OS (`cfg(not(windows))`)**:
  - 開発/クロスプラットフォーム用モックハンドラ。

### 7.2 IPCコマンド (Invoke API) 一覧

| コマンド名 | 引数 | 戻り値 | 概要 |
| :--- | :--- | :--- | :--- |
| `load_config` | なし | `Result<String, String>` | `ping-list.config` の内容を読み出す |
| `config_exists` | なし | `bool` | `ping-list.config` の存在有無を確認 |
| `save_config` | `content: String` | `Result<(), String>` | `ping-list.config` に設定を書き込む |
| `load_parameters_config` | なし | `Result<String, String>` | `ping-parameters.conf` の内容を読み出す |
| `parameters_config_exists` | なし | `bool` | `ping-parameters.conf` の存在有無を確認 |
| `save_parameters_config` | `content: String` | `Result<(), String>` | `ping-parameters.conf` に設定を書き込む |
| `start_ping` | `targets: Vec<PingTarget>`, `interval_ms: Option<u64>`, `timeout_ms: Option<u32>`, `delay_ms: Option<u64>`, `packet_size: Option<u32>`, `auto_decrease_size: Option<bool>` | `Result<(), String>` | バックグラウンドで非同期Pingループを開始（ディレイ実行・パケットサイズ・DFフラグ・NG時自動縮小対応） |
| `stop_ping` | なし | `Result<(), String>` | 実行中のPingループを停止 |
| `is_pinging` | なし | `bool` | 現在Ping監視中かどうかを返却 |
| `start_batch_traceroute` | `targets: Vec<PingTarget>`, `timeout_secs: Option<u64>`, `save_dir: Option<String>` | `Result<BatchTracerouteResult, String>` | 全対象へTracerouteを並行実行し結果を指定フォルダに1ファイル保存 |
| `stop_batch_traceroute` | なし | `Result<(), String>` | Traceroute一括実行を中止 |
| `save_stats_file` | `filename: String`, `content: String`, `save_dir: Option<String>` | `Result<String, String>` | 統計CSVを指定フォルダ（なければ自動作成）に保存 |
| `save_traceroute_file` | `filename: String`, `content: String`, `save_dir: Option<String>` | `Result<String, String>` | 個別Traceroute結果を指定フォルダ（なければ自動作成）に保存 |
| `select_folder` | `default_path: Option<String>` | `Result<Option<String>, String>` | Windowsネイティブのフォルダ選択ダイアログを表示 |
| `open_folder` | `path: String` | `Result<(), String>` | 指定フォルダをOS標準のエクスプローラーで開く |
| `get_default_save_dir` | なし | `Result<String, String>` | デフォルトの保存先フォルダ絶対パスを取得 |
| `open_traceroute_window` | `target_id: String`, `target_ip: String`, `target_name: String`, `timeout_secs: Option<u64>` | `Result<(), String>` | 個別Tracerouteウィンドウを起動 |
| `start_traceroute` | `target_id: String`, `target_ip: String`, `timeout_secs: Option<u64>` | `Result<(), String>` | 個別Tracerouteプロセスを開始 |
| `stop_traceroute` | `target_id: String` | `Result<(), String>` | 個別Tracerouteプロセスを強制終了 |
| `exit_app` | なし | `()` | アプリケーションを正常終了 |

### 7.3 イベント通知仕様

| イベント名 | 送信元 | ペイロード | 概要 |
| :--- | :--- | :--- | :--- |
| `ping-result` | Rustバックエンド | `PingResult` (`{ id, ip, success, rtt_ms, timestamp, packet_size }`) | 各ターゲットのPing完了ごとにフロントエンドへプッシュ配信 |
| `packet-size-changed` | Rustバックエンド | `u32` (新パケットサイズ) | NG検知によりパケットサイズが減衰した際にフロントエンドへ通知 |
| `request-close` | Rust (トレイ/ウィンドウ) | `()` | ウィンドウの「×」ボタン押下時またはトレイの「終了」選択時に発火し、確認ダイアログの表示を要求 |

---

## 8. ウィンドウおよびトレイ動作仕様

- **初期ウィンドウサイズ**: 幅 1000px × 高さ 680px（最小: 720px × 480px、リサイズ可能、画面中央配置）。
- **最小化動作**:
  - ウィンドウ最小化イベント検知時、ウィンドウを非表示（Hide）にしシステムトレイに格納。
- **トレイアイコン操作**:
  - **左クリック**: ウィンドウの表示（前面復帰）/ 非表示のトグル切り替え。
  - **右クリックメニュー**:
    - `表示`: ウィンドウをフォアグラウンドに表示。
    - `終了`: 終了確認ダイアログを呼び出し、ユーザー確認後にアプリ終了。
- **閉じるボタン (X) 動作**:
  - イベントを `prevent_close` でインターセプトし、フロントエンドの終了確認ダイアログを表示。
