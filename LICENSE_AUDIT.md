# オープンソース・ライセンス監査証跡報告書 (License Audit Report)

**対象プロジェクト**: NewPing  
**監査実施日**: 2026年9月10日  
**監査対象**: リポジトリ内全依存パッケージ（Node.js/npm、Rust/Cargo）、外部Webフォント、アセットファイル  
**総合判定**: **合格（問題なし / License Clear）**  
GitHub等のパブリック／プライベートリポジトリへのアップロード、およびビルド済みバイナリ（インストーラー含む）の配布において、著作権・ライセンス上の法令違反や感染性（強力なコピーレフト条項によるコード開示義務）の懸念はありません。

---

## 1. 監査概要とサマリー

本プロジェクトが直接的または間接的（推移的依存）に使用している全ライブラリのライセンスを機械的および手動で精査しました。

| カテゴリ | 検出件数 | 主なライセンス種別 | 判定・リスク |
| :--- | :--- | :--- | :--- |
| **Rust / Cargo クレート** | 288クレート | MIT, Apache-2.0, BSD-3-Clause, ISC, Zlib, Unlicense, MPL-2.0 | **問題なし** (GPL/AGPLなし) |
| **Node.js / npm パッケージ** | 24パッケージ | MIT, Apache-2.0, ISC, BSD-3-Clause, MPL-2.0 | **問題なし** (GPL/AGPLなし) |
| **Webフォント (Google Fonts)** | 3フォント | SIL Open Font License 1.1 (OFL) | **問題なし** (商用・再配布可) |
| **アイコン・UIアセット** | - | 自作 / Tauriデフォルト / Lucide (ISC) | **問題なし** |

---

## 2. ライセンス区分別の詳細評価

### ① 寛容型ライセンス（Permissive Licenses） - 98%以上
* **対象**: MIT, Apache-2.0, BSD-3-Clause, ISC, 0BSD, Zlib, CC0-1.0, Unlicense
* **評価**: 商用利用、改変、再配布、非公開利用が自由に認められています。
* **主なライブラリ**:
  - Tauri (`MIT OR Apache-2.0`)
  - Tokio (`MIT`)
  - Serde (`MIT OR Apache-2.0`)
  - Windows-sys (`MIT OR Apache-2.0`)
  - Vite (`MIT`), TypeScript (`Apache-2.0`), Lucide (`ISC`), esbuild (`MIT`)

### ② ファイル単位弱コピーレフト（Weak Copyleft） - 該当あり（安全）
* **MPL-2.0 (Mozilla Public License 2.0)**:
  - **Node.js**: `lightningcss` (CSSビルドツールとして利用)
  - **Rust**: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`
  - **法的評価**:
    MPL-2.0は「該当ライブラリ自体のソースコードファイルを直接改変した場合にのみ、そのファイルの改変部分を開示する」ライセンスです。本プロジェクトはこれらを外部ライブラリとして改変せずリンク利用しているため、**プロジェクト全体のソースコード開示義務は発生しません**（MPL-2.0 第3.3条「Larger Works」条項に合致）。

* **マルチライセンス (MIT OR Apache-2.0 OR LGPL-2.1-or-later)**:
  - **Rust**: `r-efi`
  - **法的評価**: 選択的ライセンスのため、`MIT` または `Apache-2.0` を適用可能であり、LGPLの制約は受けません。

### ③ 強力なコピーレフト（Strong Copyleft / GPL・AGPL） - **検出ゼロ (0件)**
* **GPL v2 / GPL v3 / AGPL**: 一切含まれていません。
* **評価**: 本プロジェクト独自のソースコードの強制開示義務やリポジトリ全体へのライセンス波及リスクは存在しません。

---

## 3. アセット・フォントのライセンス確認

| アセット名 | 配布元 / 形式 | ライセンス | 適合性確認 |
| :--- | :--- | :--- | :--- |
| **JetBrains Mono** | Google Fonts (CDN) | SIL Open Font License 1.1 | 商用・Web配信・埋め込み利用可 |
| **Plus Jakarta Sans** | Google Fonts (CDN) | SIL Open Font License 1.1 | 商用・Web配信・埋め込み利用可 |
| **Noto Sans JP** | Google Fonts (CDN) | SIL Open Font License 1.1 | 商用・Web配信・埋め込み利用可 |
| **Lucide Icons** | npm / lucide | ISC License | 商用利用・埋め込み自由 |

---

## 4. 実行ファイル・インストーラー（バイナリ配布）に関する確認

Git管理対象に含めた実行ファイル (`NewPing.exe`) およびインストーラー (`Pingツール_0.1.0_x64-setup.exe`) について：

1. **静的リンク / ビルド成果物**:
   - 含まれる全ライブラリのライセンス条件にバイナリ配布の禁止条項はありません。
2. **著作権表示・ライセンス表記**:
   - MIT / Apache-2.0 / BSD / ISC 等の条件を満たすため、本リポジトリ内に `THIRD_PARTY_LIBRARIES.md` または本証跡書を同梱・掲載することで、ライセンス告知義務（Notice要件）を充足しています。

---

## 5. 結論

本リポジトリ（ソースコード、設定ファイル、Webアセット、ビルド済みバイナリおよびインストーラー）は、**知的財産権および各種オープンソースライセンスに適合しており、GitHub等への公開・アップロードに問題はありません。**

---
*監査実施コマンド証跡:*
* `npx license-checker --json`
* `cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml`
