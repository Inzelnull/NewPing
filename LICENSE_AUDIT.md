# オープンソース・ライセンス監査証跡報告書 (License Audit Report)

**対象プロジェクト**: NewPing  
**監査実施日**: 2026年9月18日（macOSマルチプラットフォーム対応・Sequoia対策・Windows最適化ビルド反映後）  
**監査対象**: リポジトリ内全依存パッケージ（Node.js/npm、Rust/Cargo）、フォント、アセットファイル  
**総合判定**: **合格（問題なし / License Clear & Minimal Supply-Chain Risk）**  
個人管理サードパーティライブラリおよび外部CDN通信の完全排除を徹底し、サプライチェーン攻撃耐性を最大化。macOS対応（`/sbin/ping`, `/usr/sbin/traceroute` 利用）においても新たな外部クレート・パッケージの導入はゼロ件であり、GitHub等のパブリック／プライベートリポジトリへのアップロード、およびビルド済みバイナリ（Windows / macOS）の配布において、著作権・ライセンス上の法令違反や感染性の懸念はありません。

---

## 1. 監査概要とサマリー

本プロジェクトが使用している全ライブラリのライセンスを精査しました。

| カテゴリ | 構成概要 | 主なライセンス種別 | 判定・リスク |
| :--- | :--- | :--- | :--- |
| **Rust / Cargo クレート** | **Microsoft公式** (`windows-sys`), **Tauri公式** (`tauri`), **Tokio**, **Serde** のみ（個人クレート完全排除。macOS対応もOS標準・Rust標準のみで外部クレート追加ゼロ） | MIT, Apache-2.0 | **問題なし** (GPL/AGPLなし) |
| **Node.js / npm パッケージ** | **Microsoft公式** (`typescript`), **Tauri公式** (`@tauri-apps`), **Vite** のみ（Lucide排除） | MIT, Apache-2.0 | **問題なし** (GPL/AGPLなし) |
| **フォント / 外部リソース** | OSネイティブフォント（Win: Segoe UI, Meiryo 等 / Mac: SF Pro, Hiragino Sans 等。完全オフライン対応、外部CDN通信ゼロ） | OS標準 | **問題なし** (外部通信リスクゼロ) |
| **アイコン・UIアセット** | 自作・インラインSVG | パブリックドメイン / 自作 | **問題なし** |

---

## 2. ライセンス区分別の詳細評価

### ① 寛容型ライセンス（Permissive Licenses） - 100%
* **対象**: MIT, Apache-2.0, BSD-3-Clause
* **評価**: 商用利用、改変、再配布、非公開利用が自由に認められています。
* **主なライブラリ**:
  - Windows-sys (`MIT OR Apache-2.0` - Microsoft公式)
  - Tauri (`MIT OR Apache-2.0` - The Commons Conservancy)
  - Tokio (`MIT`)
  - Serde (`MIT OR Apache-2.0`)
  - TypeScript (`Apache-2.0` - Microsoft公式)
  - Vite / esbuild (`MIT`)

### ② 強力なコピーレフト（Strong Copyleft / GPL・AGPL） - **検出ゼロ (0件)**
* **GPL v2 / GPL v3 / AGPL**: 一切含まれていません。
* **評価**: 本プロジェクト独自のソースコードの強制開示義務やリポジトリ全体へのライセンス波及リスクは存在しません。

---

## 3. 結論

本リポジトリ（ソースコード、設定ファイル、Webアセット、Windows/macOS向けビルド済みバイナリ）は、**知的財産権および各種オープンソースライセンスに適合しており、かつサードパーティ依存によるマルウェア・サプライチェーンリスクが極限まで低減されています。**
