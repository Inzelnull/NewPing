/**
 * ==============================================================================
 * Pingツール (NewPing) - メインフロントエンドコントローラー (main.ts)
 * ==============================================================================
 * 
 * 本スクリプトは、Pingツールのメインウィンドウ全体のUI制御、状態管理、および
 * Tauri IPCバックエンドとの通信を統括するコアスクリプトです。
 * 
 * 主な機能:
 * 1. ナビゲーションタブ切替（監視モニター、対象設定、Ping設定、統計情報）
 * 2. Ping監視の開始・停止制御とリアルタイムストリーム描画（直近100件〇/×）
 * 3. 不通検知（NG）フローティングアラートポップアップ
 * 4. 監視対象設定 (`ping-list.config`) のエディタ編集・構文解析・プレビュー・保存
 * 5. パラメータ設定 (`ping-parameters.conf`) のUI連動・検証・保存・初期化
 * 6. 結果保存先フォルダ（Traceroute・Ping統計）の指定、参照ダイアログ、エクスプローラー連携
 * 7. Ping統計情報の自動集計、テーブル描画、およびCSVファイルエクスポート
 * 8. 右クリック個別Tracerouteウィンドウ起動および一括Traceroute並行実行・進捗監視
 * 9. システムトレイイベント連携、カラーテーマ（ダーク/ホワイト）切り替え、各種モーダル
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ------------------------------------------------------------------------------
// 型定義 (Interfaces & Types)
// ------------------------------------------------------------------------------

/** 監視対象ターゲット情報 */
interface PingTarget {
  id: string;
  ip: string;
  name: string;
}

/** 1回のPing実行結果データ */
interface PingResult {
  id: string;
  ip: string;
  success: boolean;
  rtt_ms?: number;
  timestamp: number;
  packet_size?: number;
  is_adjusting?: boolean;
}

/** ターゲットごとの統計集計データ */
interface TargetStats {
  id: string;
  ip: string;
  name: string;
  sent: number;
  success: number;
  failed: number;
  rttSum: number;
  minRtt: number | null;
  maxRtt: number | null;
  latestRtt: number | null;
  latestSuccess: boolean | null;
}

type usize = number;

/** 一括Traceroute進捗イベントデータ */
interface BatchTracerouteProgressEvent {
  completed_count: usize;
  total_count: usize;
  target_name: string;
  target_ip: string;
  success: boolean;
}

/** 一括Traceroute完了結果データ */
interface BatchTracerouteResult {
  start_time: number;
  end_time: number;
  duration_sec: number;
  total_targets: number;
  success_count: number;
  failed_count: number;
  file_path: string;
  filename: string;
}

// ------------------------------------------------------------------------------
// アプリケーション状態変数 (App State)
// ------------------------------------------------------------------------------
let currentTargets: PingTarget[] = [];
let isRunning = false;
let pingIntervalSec: number = 1;
let pingTimeoutMs: number = 1000;
let pingDelayMs: number = 50;
let pingPacketSize: number = 32;
let autoDecreasePacketSize: boolean = false;
let currentRuntimePacketSize: number = 32;
let hasReachedAllOk: boolean = false;
let maxStreamItems: number = 100; // 応答履歴の表示件数 (50〜1000, 初期値: 100)
let tracerouteTimeoutSec: number = 60; // Tracerouteタイムアウト秒数 (10〜300, 初期値: 60)
let pingSaveDir: string = "result"; // 結果保存先フォルダ (初期値: result)
let isBatchTracerouteRunning = false;

/** ターゲットIDをキーとする統計集計マップ */
const statsMap = new Map<string, TargetStats>();
/** 現在NG状態となっているターゲット一覧マップ（不通検知ポップアップ用） */
const activeNgTargets = new Map<string, { id: string; name: string; ip: string }>();

// ------------------------------------------------------------------------------
// DOM要素の取得
// ------------------------------------------------------------------------------
const tabBtns = document.querySelectorAll<HTMLButtonElement>(".nav-tab");
const viewPanels = document.querySelectorAll<HTMLElement>(".view-panel");

const globalStatusPill = document.getElementById("global-status-pill") as HTMLElement;
const globalStatusText = document.getElementById("global-status-text") as HTMLElement;

// Ping結果モニター画面の要素
const resultsPanelDesc = document.getElementById("results-panel-desc") as HTMLElement;
const streamTitleText = document.getElementById("stream-title-text") as HTMLElement;
const btnTogglePing = document.getElementById("btn-toggle-ping") as HTMLButtonElement;
const btnClearHistory = document.getElementById("btn-clear-history") as HTMLButtonElement;
const btnBatchTraceroute = document.getElementById("btn-batch-traceroute") as HTMLButtonElement;
const btnBatchTracerouteText = document.getElementById("btn-batch-traceroute-text") as HTMLElement;
const resultsContainer = document.getElementById("results-container") as HTMLElement;
const resultsTableWrapper = document.getElementById("results-scroll-area") as HTMLElement;
const resultsEmpty = document.getElementById("results-empty") as HTMLElement;
const resultsTbody = document.getElementById("results-tbody") as HTMLTableSectionElement;
const btnGotoSettings = document.getElementById("btn-goto-settings") as HTMLButtonElement;

// 不通検知アラートポップアップの要素
const ngAlertPopup = document.getElementById("ng-alert-popup") as HTMLElement;
const ngAlertCount = document.getElementById("ng-alert-count") as HTMLElement;
const ngAlertList = document.getElementById("ng-alert-list") as HTMLElement;

// 対象設定画面の要素
const configTextarea = document.getElementById("config-textarea") as HTMLTextAreaElement;
const targetCountBadge = document.getElementById("target-count-badge") as HTMLElement;
const previewList = document.getElementById("preview-list") as HTMLElement;
const btnSaveConfig = document.getElementById("btn-save-config") as HTMLButtonElement;
const btnReloadConfig = document.getElementById("btn-reload-config") as HTMLButtonElement;

// Options view elements (Interval, Delay, Packet Size, Timeout, Traceroute Timeout, Stream Count, Theme)
const inputIntervalRange = document.getElementById("input-interval-range") as HTMLInputElement;
const inputIntervalNum = document.getElementById("input-interval-num") as HTMLInputElement;
const intervalDisplayBadge = document.getElementById("interval-display-badge") as HTMLElement;
const inputDelayRange = document.getElementById("input-delay-range") as HTMLInputElement;
const inputDelayNum = document.getElementById("input-delay-num") as HTMLInputElement;
const delayDisplayBadge = document.getElementById("delay-display-badge") as HTMLElement;
const inputPacketSizeRange = document.getElementById("input-packet-size-range") as HTMLInputElement;
const inputPacketSizeNum = document.getElementById("input-packet-size-num") as HTMLInputElement;
const packetSizeDisplayBadge = document.getElementById("packet-size-display-badge") as HTMLElement;
const actualSizeTotal = document.getElementById("actual-size-total") as HTMLElement;
const actualSizePayload = document.getElementById("actual-size-payload") as HTMLElement;
const inputAutoDecreaseSize = document.getElementById("input-auto-decrease-size") as HTMLInputElement;
const autoDecreaseStatusBadge = document.getElementById("auto-decrease-status-badge") as HTMLElement;
const inputTimeoutRange = document.getElementById("input-timeout-range") as HTMLInputElement;
const inputTimeoutNum = document.getElementById("input-timeout-num") as HTMLInputElement;
const timeoutDisplayBadge = document.getElementById("timeout-display-badge") as HTMLElement;
const inputTrTimeoutRange = document.getElementById("input-tr-timeout-range") as HTMLInputElement;
const inputTrTimeoutNum = document.getElementById("input-tr-timeout-num") as HTMLInputElement;
const trTimeoutDisplayBadge = document.getElementById("tr-timeout-display-badge") as HTMLElement;
const inputStreamRange = document.getElementById("input-stream-range") as HTMLInputElement;
const inputStreamNum = document.getElementById("input-stream-num") as HTMLInputElement;
const streamDisplayBadge = document.getElementById("stream-display-badge") as HTMLElement;
const inputSavedirText = document.getElementById("input-savedir-text") as HTMLInputElement;
const savedirDisplayBadge = document.getElementById("savedir-display-badge") as HTMLElement;
const btnSelectSavedir = document.getElementById("btn-select-savedir") as HTMLButtonElement;
const btnOpenSavedir = document.getElementById("btn-open-savedir") as HTMLButtonElement;
const themeDisplayBadge = document.getElementById("theme-display-badge") as HTMLElement;
const btnThemeDark = document.getElementById("btn-theme-dark") as HTMLButtonElement;
const btnThemeLight = document.getElementById("btn-theme-light") as HTMLButtonElement;
const btnResetOptions = document.getElementById("btn-reset-options") as HTMLButtonElement;
const btnSaveOptions = document.getElementById("btn-save-options") as HTMLButtonElement;
const optionsValidationAlert = document.getElementById("options-validation-alert") as HTMLElement;
const optionsValidationMsg = document.getElementById("options-validation-msg") as HTMLElement;
const presetBtns = document.querySelectorAll<HTMLButtonElement>(".btn-preset");

// Stats view elements
const statsTotalTargets = document.getElementById("stats-total-targets") as HTMLElement;
const statsTotalSent = document.getElementById("stats-total-sent") as HTMLElement;
const statsTotalSuccess = document.getElementById("stats-total-success") as HTMLElement;
const statsOverallLoss = document.getElementById("stats-overall-loss") as HTMLElement;
const statsTbody = document.getElementById("stats-tbody") as HTMLTableSectionElement;
const btnSaveStats = document.getElementById("btn-save-stats") as HTMLButtonElement;
const btnResetStats = document.getElementById("btn-reset-stats") as HTMLButtonElement;

// Confirm Modal elements
const confirmModal = document.getElementById("confirm-modal") as HTMLElement;
const confirmModalTitle = document.getElementById("confirm-modal-title") as HTMLElement;
const confirmModalMessage = document.getElementById("confirm-modal-message") as HTMLElement;
const confirmModalIconWrapper = document.getElementById("confirm-modal-icon-wrapper") as HTMLElement;
const confirmModalBtnCancel = document.getElementById("confirm-modal-btn-cancel") as HTMLButtonElement;
const confirmModalBtnConfirm = document.getElementById("confirm-modal-btn-confirm") as HTMLButtonElement;

const toastContainer = document.getElementById("toast-container") as HTMLElement;

// ==========================================
// 汎用確認モーダルダイアログ (Confirmation Dialog Helper)
// ==========================================
interface ConfirmDialogOptions {
  title: string;        // ダイアログのタイトル
  message: string;      // 本文メッセージ（改行可）
  confirmText?: string; // 確定ボタンの文言（デフォルト: "実行する"）
  cancelText?: string;  // キャンセルボタンの文言（デフォルト: "キャンセル"）
  isDanger?: boolean;   // 危険な操作（赤色ボタン）かどうか
}

/**
 * カスタム確認モーダルを表示し、ユーザーの確定(true)またはキャンセル(false)を非同期で返却する関数
 */
function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmModalTitle.textContent = options.title;
    confirmModalMessage.textContent = options.message;
    confirmModalBtnConfirm.textContent = options.confirmText ?? "実行する";
    confirmModalBtnCancel.textContent = options.cancelText ?? "キャンセル";

    // 危険操作と警告操作でアイコン・ボタンスタイルを切り替え
    if (options.isDanger ?? true) {
      confirmModalBtnConfirm.className = "btn btn-primary danger-action";
      confirmModalIconWrapper.className = "modal-icon-wrapper";
    } else {
      confirmModalBtnConfirm.className = "btn btn-primary";
      confirmModalIconWrapper.className = "modal-icon-wrapper warning";
    }

    confirmModal.classList.remove("hidden");
    confirmModalBtnConfirm.focus();

    // イベントリスナーの解除と非表示化
    const cleanup = () => {
      confirmModal.classList.add("hidden");
      confirmModalBtnConfirm.removeEventListener("click", onConfirm);
      confirmModalBtnCancel.removeEventListener("click", onCancel);
      confirmModal.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    // モーダル背景クリックでキャンセル
    const onOverlayClick = (e: MouseEvent) => {
      if (e.target === confirmModal) {
        onCancel();
      }
    };

    // ESCキーでキャンセル
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };

    confirmModalBtnConfirm.addEventListener("click", onConfirm);
    confirmModalBtnCancel.addEventListener("click", onCancel);
    confirmModal.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

// ==========================================
// トースト通知ヘルパー (Toast Notification Helper)
// ==========================================
/**
 * 画面右下に一時的な通知メッセージ（トースト）を表示する関数
 * @param message 表示メッセージ
 * @param type 通知種別 ("success" | "error" | "info")
 */
function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // 一定時間経過後にフェードアウトしてDOMから削除
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    setTimeout(() => {
      if (toastContainer.contains(toast)) {
        toastContainer.removeChild(toast);
      }
    }, 300);
  }, 2800);
}

// ==========================================
// タブ切り替え処理 (Tab Switching)
// ==========================================
/**
 * 指定したタブIDに表示を切り替える関数
 * @param tabId "results" | "settings" | "options" | "stats"
 */
function switchTab(tabId: string) {
  // ナビゲーションタブボタンのアクティブ状態更新
  tabBtns.forEach((btn) => {
    const isTarget = btn.getAttribute("data-tab") === tabId;
    btn.classList.toggle("active", isTarget);
    btn.setAttribute("aria-selected", isTarget ? "true" : "false");
  });

  // メインビューパネルの表示切替
  viewPanels.forEach((panel) => {
    const isTarget = panel.id === `view-${tabId}`;
    panel.classList.toggle("active", isTarget);
  });

  // タブ切り替え時の初期描画・スクロール処理
  if (tabId === "stats") {
    renderStatsTable();
  } else if (tabId === "results") {
    scrollResultsToRight();
  }
}

/**
 * 応答履歴テーブルのスクロール位置を最新（右端）へ移動する関数
 */
function scrollResultsToRight() {
  requestAnimationFrame(() => {
    if (resultsTableWrapper) {
      resultsTableWrapper.scrollLeft = resultsTableWrapper.scrollWidth;
    }
  });
}

// タブボタンのクリックイベント登録
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-tab");
    if (tab) switchTab(tab);
  });
});

// 空状態画面の「ターゲットを設定する」リンク
btnGotoSettings.addEventListener("click", () => {
  switchTab("settings");
});

// ==========================================
// 監視対象リスト解析・プレビュー (Config & Target Parsing)
// ==========================================
/**
 * テキストエリアの文字列からPing監視対象リスト（IPと名称）をパースする関数
 * フォーマット: "IPアドレス 日本語名称" (空白またはタブ区切り)
 * # や // で始まる行はコメント行としてスキップ
 */
function parseConfigText(text: string): PingTarget[] {
  const lines = text.split(/\r?\n/);
  const targets: PingTarget[] = [];
  let index = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    // 最初の空白でIPアドレスと名称を分割
    const match = line.match(/^(\S+)\s+(.+)$/);
    let ip = "";
    let name = "";

    if (match) {
      ip = match[1].trim();
      name = match[2].trim();
    } else {
      ip = line;
      name = line;
    }

    targets.push({
      id: `target-${index++}-${ip}`,
      ip,
      name,
    });
  }

  return targets;
}

/**
 * ターゲット設定入力欄の変更に応じてプレビュー一覧や監視テーブル行を同期・更新する関数
 */
function updateSettingsPreview() {
  const text = configTextarea.value;
  currentTargets = parseConfigText(text);
  targetCountBadge.textContent = `${currentTargets.length} 件登録中`;

  // サイドバーのプレビューリストを更新
  previewList.innerHTML = "";
  if (currentTargets.length === 0) {
    previewList.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 6px;">ターゲットがありません</div>';
  } else {
    currentTargets.forEach((t) => {
      const item = document.createElement("div");
      item.className = "preview-item";
      item.innerHTML = `
        <span class="preview-item-name">${escapeHtml(t.name)}</span>
        <span class="preview-item-ip">${escapeHtml(t.ip)}</span>
      `;
      previewList.appendChild(item);
    });
  }

  // Ping未実行中であれば結果テーブル行構造と統計マップも同期
  if (!isRunning) {
    syncResultsTableStructure();
    initStatsMap();
  }

  // 削除されたターゲットのNGアラートをクリーンアップ
  const validIds = new Set(currentTargets.map((t) => t.id));
  for (const id of activeNgTargets.keys()) {
    if (!validIds.has(id)) {
      activeNgTargets.delete(id);
    }
  }
  renderNgAlertPopup();
}

configTextarea.addEventListener("input", updateSettingsPreview);

// ==========================================
// ターゲット設定ファイルの読み込み・保存 (Config Load & Save)
// ==========================================
/**
 * バックエンドIPCコマンド `load_config` を呼び出し、`ping-list.config` を読み込む
 */
async function loadConfigFile() {
  try {
    const content = await invoke<string>("load_config");
    if (content && content.trim().length > 0) {
      configTextarea.value = content;
    } else {
      // ファイルが存在しない場合のデフォルト候補
      configTextarea.value = "8.8.8.8 Google DNS\n1.1.1.1 Cloudflare DNS\n127.0.0.1 ローカルホスト";
    }
    updateSettingsPreview();
  } catch (err) {
    console.error("Failed to load config:", err);
    showToast(`設定読込失敗: ${err}`, "error");
  }
}

/**
 * ターゲット設定を `ping-list.config` に保存する
 */
async function saveConfigFile() {
  try {
    const exists = await invoke<boolean>("config_exists");
    if (exists) {
      const confirmed = await showConfirmDialog({
        title: "設定ファイルの上書き確認",
        message: "ping-list.config は既に存在します。\n上書きして保存しますか？",
        confirmText: "上書き保存する",
        cancelText: "キャンセル",
        isDanger: true,
      });
      if (!confirmed) return;
    }

    const content = configTextarea.value;
    await invoke("save_config", { content });
    updateSettingsPreview();
    showToast("ping-list.config に設定を保存しました", "success");
  } catch (err) {
    console.error("Failed to save config:", err);
    showToast(`設定保存失敗: ${err}`, "error");
  }
}

btnSaveConfig.addEventListener("click", saveConfigFile);
btnReloadConfig.addEventListener("click", async () => {
  const confirmed = await showConfirmDialog({
    title: "設定再読込の確認",
    message: "設定ファイルから再読込しますか？\n（保存されていない変更内容は破棄されます）",
    confirmText: "再読込する",
    cancelText: "キャンセル",
    isDanger: false,
  });
  if (!confirmed) return;

  await loadConfigFile();
  showToast("設定ファイルを再読込しました", "info");
});

// ==========================================
// Ping応答履歴テーブル管理 (Results View Management)
// ==========================================
/**
 * 監視対象リストに基づいて結果画面のテーブル行（tr）を初期化・同期する関数
 */
function syncResultsTableStructure() {
  if (currentTargets.length === 0) {
    resultsEmpty.classList.remove("hidden");
    resultsContainer.style.display = "none";
    resultsTbody.innerHTML = "";
    return;
  }

  resultsEmpty.classList.add("hidden");
  resultsContainer.style.display = "flex";

  // テーブル行を生成
  resultsTbody.innerHTML = "";
  currentTargets.forEach((t) => {
    const row = document.createElement("tr");
    row.id = `row-${t.id}`;
    row.setAttribute("data-target-id", t.id);
    row.setAttribute("data-target-name", t.name);
    row.setAttribute("data-target-ip", t.ip);
    row.innerHTML = `
      <td class="col-target">
        <div class="target-info">
          <span class="target-name">${escapeHtml(t.name)}</span>
          <span class="target-ip">${escapeHtml(t.ip)}</span>
        </div>
      </td>
      <td class="col-status">
        <span class="badge-status idle" id="status-${t.id}">待機中</span>
      </td>
      <td class="col-count" id="count-${t.id}">
        0
      </td>
      <td class="col-stream">
        <div class="stream-container" id="stream-${t.id}">
          <!-- 左側が過去、右側が最新の応答結果 -->
        </div>
      </td>
    `;
    resultsTbody.appendChild(row);
  });
}

// 応答履歴ストリーム上でマウスホイール操作による横スクロールを有効化
resultsTableWrapper.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    const targetEl = e.target as HTMLElement;
    const isOverStream = targetEl.closest(".col-stream") !== null;
    if (isOverStream && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      resultsTableWrapper.scrollLeft += e.deltaY;
    }
  },
  { passive: false }
);

/**
 * バックエンドから届いた1回分のPing結果イベントを処理し、UIや統計情報を更新する関数
 * @param result 受信したPing結果データ
 */
function handlePingResult(result: PingResult) {
  updateTargetStats(result);

  // 全監視対象が1度でも応答成功したか判定（サイズ自動縮小の調整完了判定に使用）
  if (result.success && !hasReachedAllOk) {
    const allOk = currentTargets.length > 0 && currentTargets.every((t) => {
      const s = statsMap.get(t.id);
      return s && s.latestSuccess === true;
    });
    if (allOk) {
      hasReachedAllOk = true;
      updateResultsPanelDesc();
    }
  }

  const isAdjusting = result.is_adjusting !== undefined
    ? result.is_adjusting
    : (autoDecreasePacketSize && !hasReachedAllOk);

  const streamEl = document.getElementById(`stream-${result.id}`);
  const statusEl = document.getElementById(`status-${result.id}`);
  const countEl = document.getElementById(`count-${result.id}`);

  // 送信回数バッジの更新
  if (countEl) {
    const stats = statsMap.get(result.id);
    countEl.textContent = stats ? stats.sent.toString() : "1";
  }

  // ストリームアイテム（〇 / ×）の生成
  const item = document.createElement("div");
  const timeStr = new Date(result.timestamp).toLocaleTimeString();
  const pktSize = result.packet_size ?? currentRuntimePacketSize ?? pingPacketSize;

  if (result.success) {
    const rtt = result.rtt_ms ?? 0;
    item.className = "stream-item ok";
    item.textContent = "〇";
    item.setAttribute("data-tooltip", `[${timeStr}] 応答: ${rtt}ms (${pktSize}B)`);

    if (statusEl) {
      statusEl.className = "badge-status ok";
      statusEl.textContent = `${rtt} ms`;
    }
  } else {
    if (isAdjusting) {
      item.className = "stream-item ng adjusting";
      item.textContent = "×";
      item.setAttribute("data-tooltip", `[${timeStr}] Timeout (NG・パケット調整中) (${pktSize}B)`);

      if (statusEl) {
        statusEl.className = "badge-status ng adjusting";
        statusEl.textContent = "調整中";
      }
    } else {
      item.className = "stream-item ng";
      item.textContent = "×";
      item.setAttribute("data-tooltip", `[${timeStr}] Timeout (NG) (${pktSize}B)`);

      if (statusEl) {
        statusEl.className = "badge-status ng";
        statusEl.textContent = "Timeout";
      }
    }
  }

  // ストリームコンテナへの追加と上限件数（maxStreamItems）による古い結果の切り詰め
  if (streamEl) {
    streamEl.appendChild(item);

    if (streamEl.children.length > maxStreamItems) {
      while (streamEl.children.length > maxStreamItems) {
        streamEl.removeChild(streamEl.firstChild!);
      }
    }

    // 最新結果（右端）へ自動スクロール
    resultsTableWrapper.scrollLeft = resultsTableWrapper.scrollWidth;
    requestAnimationFrame(() => {
      if (resultsTableWrapper) {
        resultsTableWrapper.scrollLeft = resultsTableWrapper.scrollWidth;
      }
    });
  }

  // NGアラートポップアップの追跡と状態更新
  let ngChanged = false;
  if (!result.success) {
    if (!activeNgTargets.has(result.id)) {
      const target = currentTargets.find((t) => t.id === result.id) || statsMap.get(result.id);
      activeNgTargets.set(result.id, {
        id: result.id,
        name: target ? target.name : result.ip,
        ip: result.ip,
      });
      ngChanged = true;
    }
  } else {
    if (activeNgTargets.has(result.id)) {
      activeNgTargets.delete(result.id);
      ngChanged = true;
    }
  }
  if (ngChanged) {
    renderNgAlertPopup();
  }
}

/**
 * 画面下部のNG不通アラートポップアップの描画を更新する関数
 */
function renderNgAlertPopup() {
  if (activeNgTargets.size === 0) {
    ngAlertPopup.classList.add("hidden");
    ngAlertList.innerHTML = "";
    ngAlertCount.textContent = "0件";
    return;
  }

  ngAlertPopup.classList.remove("hidden");
  ngAlertCount.textContent = `${activeNgTargets.size}件`;

  ngAlertList.innerHTML = "";
  activeNgTargets.forEach((target) => {
    const item = document.createElement("div");
    item.className = "ng-alert-item";
    item.innerHTML = `
      <div class="ng-alert-item-info">
        <span class="ng-alert-item-name">${escapeHtml(target.name)}</span>
        <span class="ng-alert-item-ip">${escapeHtml(target.ip)}</span>
      </div>
      <span class="ng-alert-item-badge">不通 (NG)</span>
    `;
    ngAlertList.appendChild(item);
  });
}

// 履歴クリアボタン
btnClearHistory.addEventListener("click", async () => {
  const confirmed = await showConfirmDialog({
    title: "履歴クリアの確認",
    message: "表示中のPing応答履歴をすべてクリアしますか？",
    confirmText: "クリアする",
    cancelText: "キャンセル",
    isDanger: true,
  });
  if (!confirmed) return;

  activeNgTargets.clear();
  renderNgAlertPopup();

  document.querySelectorAll(".stream-container").forEach((el) => {
    el.innerHTML = "";
  });
  document.querySelectorAll(".col-count").forEach((el) => {
    el.textContent = "0";
  });
  document.querySelectorAll(".badge-status").forEach((el) => {
    el.className = "badge-status idle";
    el.textContent = isRunning ? "監視中" : "待機中";
  });
  initStatsMap();
  showToast("表示履歴をクリアしました", "info");
});

// ==========================================
// 統計集計・管理ロジック (Statistics Logic)
// ==========================================
/**
 * 統計データマップを現在のターゲットリストで初期化・リセットする関数
 */
function initStatsMap() {
  statsMap.clear();
  currentTargets.forEach((t) => {
    statsMap.set(t.id, {
      id: t.id,
      ip: t.ip,
      name: t.name,
      sent: 0,
      success: 0,
      failed: 0,
      rttSum: 0,
      minRtt: null,
      maxRtt: null,
      latestRtt: null,
      latestSuccess: null,
    });
  });
  renderStatsSummary();
}

/**
 * 個別のPing結果を受信した際に統計マップ内の数値をインクリメント・再計算する関数
 */
function updateTargetStats(result: PingResult) {
  let stats = statsMap.get(result.id);
  if (!stats) {
    const target = currentTargets.find((t) => t.id === result.id);
    stats = {
      id: result.id,
      ip: result.ip,
      name: target ? target.name : result.ip,
      sent: 0,
      success: 0,
      failed: 0,
      rttSum: 0,
      minRtt: null,
      maxRtt: null,
      latestRtt: null,
      latestSuccess: null,
    };
    statsMap.set(result.id, stats);
  }

  stats.sent += 1;
  stats.latestSuccess = result.success;

  if (result.success) {
    stats.success += 1;
    const rtt = result.rtt_ms ?? 0;
    stats.latestRtt = rtt;
    stats.rttSum += rtt;
    stats.minRtt = stats.minRtt === null ? rtt : Math.min(stats.minRtt, rtt);
    stats.maxRtt = stats.maxRtt === null ? rtt : Math.max(stats.maxRtt, rtt);
  } else {
    stats.failed += 1;
    stats.latestRtt = null;
  }

  renderStatsSummary();
  const statsPanel = document.getElementById("view-stats");
  if (statsPanel?.classList.contains("active")) {
    renderStatsTable();
  }
}

/**
 * 統計画面上部のサマリーカード（総送信数、総成功数、全体ロス率）を描画更新する関数
 */
function renderStatsSummary() {
  let totalTargets = currentTargets.length;
  let totalSent = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  statsMap.forEach((s) => {
    totalSent += s.sent;
    totalSuccess += s.success;
    totalFailed += s.failed;
  });

  statsTotalTargets.textContent = totalTargets.toString();
  statsTotalSent.textContent = totalSent.toString();
  statsTotalSuccess.textContent = totalSuccess.toString();

  const lossRate = totalSent > 0 ? ((totalFailed / totalSent) * 100).toFixed(1) : "0.0";
  statsOverallLoss.textContent = `${lossRate}%`;
}

/**
 * 統計画面のテーブル（各ターゲットごとの送信数・成功・失敗・ロス率・平均/最小/最大RTT）を描画する関数
 */
function renderStatsTable() {
  statsTbody.innerHTML = "";
  if (statsMap.size === 0) {
    statsTbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:30px;">統計データはありません</td></tr>';
    return;
  }

  statsMap.forEach((s) => {
    const row = document.createElement("tr");
    const lossRate = s.sent > 0 ? ((s.failed / s.sent) * 100).toFixed(1) : "0.0";
    const avgRtt = s.success > 0 ? Math.round(s.rttSum / s.success) : "-";
    const minRtt = s.minRtt !== null ? `${s.minRtt} ms` : "-";
    const maxRtt = s.maxRtt !== null ? `${s.maxRtt} ms` : "-";
    const latestRtt = s.latestRtt !== null ? `${s.latestRtt} ms` : (s.sent > 0 ? "NG" : "-");

    let statusBadge = '<span class="badge-status idle">待機</span>';
    if (s.latestSuccess === true) {
      statusBadge = '<span class="badge-status ok">正常</span>';
    } else if (s.latestSuccess === false) {
      statusBadge = '<span class="badge-status ng">不通</span>';
    }

    row.innerHTML = `
      <td>${statusBadge}</td>
      <td class="cell-name">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.ip)}</td>
      <td>${s.sent}</td>
      <td style="color: var(--ping-ok-text); font-weight:700;">${s.success}</td>
      <td style="color: var(--ping-ng-text); font-weight:700;">${s.failed}</td>
      <td style="font-weight:700; ${parseFloat(lossRate) > 0 ? 'color: var(--ping-ng-text);' : ''}">${lossRate}%</td>
      <td>${latestRtt}</td>
      <td>${avgRtt !== "-" ? avgRtt + " ms" : "-"}</td>
      <td>${minRtt}</td>
      <td>${maxRtt}</td>
    `;
    statsTbody.appendChild(row);
  });
}

/**
 * CSV値のエスケープ処理（カンマ、ダブルクォート、改行を含む場合はダブルクォートで囲む）
 */
function csvEscape(val: string | number): string {
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 統計データからUTF-8 BOM付きCSVテキストを生成する関数
 */
function generateStatsCsv(): string {
  const now = new Date();
  const dateStr =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0") +
    " " +
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0") +
    ":" +
    String(now.getSeconds()).padStart(2, "0");

  let totalSent = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  statsMap.forEach((s) => {
    totalSent += s.sent;
    totalSuccess += s.success;
    totalFailed += s.failed;
  });

  const overallLossRate = totalSent > 0 ? ((totalFailed / totalSent) * 100).toFixed(1) : "0.0";

  const rows: string[] = [];
  rows.push("\uFEFF# Ping統計結果レポート");
  rows.push(`# 出力日時: ${dateStr}`);
  rows.push(
    `# 監視対象数: ${statsMap.size}, 総送信数: ${totalSent}, 総成功数: ${totalSuccess}, 総失敗数: ${totalFailed}, 全体ロス率: ${overallLossRate}%`
  );
  rows.push("");
  rows.push(
    [
      "状態",
      "日本語名称",
      "IPアドレス",
      "送信数",
      "成功数",
      "失敗数",
      "ロス率(%)",
      "最新RTT(ms)",
      "平均RTT(ms)",
      "最小RTT(ms)",
      "最大RTT(ms)",
    ]
      .map(csvEscape)
      .join(",")
  );

  statsMap.forEach((s) => {
    const lossRate = s.sent > 0 ? ((s.failed / s.sent) * 100).toFixed(1) : "0.0";
    const avgRtt = s.success > 0 ? Math.round(s.rttSum / s.success).toString() : "-";
    const minRtt = s.minRtt !== null ? s.minRtt.toString() : "-";
    const maxRtt = s.maxRtt !== null ? s.maxRtt.toString() : "-";
    const latestRtt = s.latestRtt !== null ? s.latestRtt.toString() : s.sent > 0 ? "NG" : "-";

    let status = "待機";
    if (s.latestSuccess === true) {
      status = "正常";
    } else if (s.latestSuccess === false) {
      status = "不通";
    }

    rows.push(
      [
        status,
        s.name,
        s.ip,
        s.sent,
        s.success,
        s.failed,
        lossRate,
        latestRtt,
        avgRtt,
        minRtt,
        maxRtt,
      ]
        .map(csvEscape)
        .join(",")
    );
  });

  return rows.join("\r\n");
}

/**
 * 統計結果をCSVファイルとして保存先フォルダ（デフォルト: result）に保存する関数
 */
async function saveStats() {
  if (statsMap.size === 0) {
    showToast("保存する統計データがありません", "info");
    return;
  }

  let totalSent = 0;
  statsMap.forEach((s) => {
    totalSent += s.sent;
  });

  if (totalSent === 0) {
    showToast("まだPing送信が行われていません", "info");
    return;
  }

  const now = new Date();
  const timestampStr =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const filename = `ping_stats_${timestampStr}.csv`;
  const csvContent = generateStatsCsv();

  try {
    const savedPath = await invoke<string>("save_stats_file", {
      filename,
      content: csvContent,
      saveDir: pingSaveDir,
    });
    showToast(`統計結果を保存しました (${filename})\n保存先: ${savedPath}`, "success");
    console.log("Saved stats to:", savedPath);
  } catch (err) {
    console.warn("Tauri file save failed, falling back to browser download:", err);
    try {
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`統計結果をダウンロードしました (${filename})`, "success");
    } catch (downloadErr) {
      showToast(`保存失敗: ${err}`, "error");
    }
  }
}

btnSaveStats?.addEventListener("click", saveStats);

btnResetStats.addEventListener("click", async () => {
  const confirmed = await showConfirmDialog({
    title: "統計リセットの確認",
    message: "集計されたPing統計データをすべてリセットしますか？\n（この操作は取り消せません）",
    confirmText: "リセットする",
    cancelText: "キャンセル",
    isDanger: true,
  });
  if (!confirmed) return;

  initStatsMap();
  renderStatsTable();
  showToast("統計データをリセットしました", "info");
});

/**
 * 結果画面のヘッダー説明文を、現在の設定（間隔、ディレイ、パケットサイズ、自動縮小状態）に応じて動的に更新する関数
 */
function updateResultsPanelDesc() {
  if (resultsPanelDesc) {
    const delayText = pingDelayMs > 0 ? ` / ディレイ: ${pingDelayMs}ms` : " (同時実行)";
    const effectiveSize = isRunning ? currentRuntimePacketSize : pingPacketSize;
    const totalWireSize = effectiveSize + 28;
    const isAdjusting = autoDecreasePacketSize && isRunning && !hasReachedAllOk;
    const autoDecreaseText = autoDecreasePacketSize
      ? isAdjusting
        ? " <span class=\"legend-orange\">[パケット調整中]</span>"
        : " <span class=\"legend-blue\">[3回連続NG時自動縮小]</span>"
      : "";
    const ngLegend = isAdjusting
      ? "<span class=\"legend-orange\">× 調整中NG</span>"
      : "<span class=\"legend-red\">× NG</span>";
    resultsPanelDesc.innerHTML = `全対象へ${pingIntervalSec}秒間隔${delayText}でPing発行中（サイズ: ${effectiveSize}B [送信: ${totalWireSize}B]${autoDecreaseText} / 直近${maxStreamItems}件 / 右が最新結果: <span class="legend-blue">〇 OK</span> / ${ngLegend}）`;
  }
  if (streamTitleText) {
    const isAdjusting = autoDecreasePacketSize && isRunning && !hasReachedAllOk;
    const ngText = isAdjusting ? "橙: × 調整中NG" : "赤: × NG";
    streamTitleText.textContent = `応答履歴 (直近${maxStreamItems}件 / 青: 〇 OK / ${ngText})`;
  }
}

// ==========================================
// Ping設定バリデーション・永続化ロジック (Ping Options Logic)
// ==========================================
interface OptionsValidationResult {
  valid: boolean;
  message: string;
  field?: "interval" | "delay" | "packetsize" | "timeout" | "trtimeout" | "stream";
}

/**
 * オプション設定入力欄の入力値が有効範囲内にあるかを検証する関数
 */
function validateCurrentOptions(): OptionsValidationResult {
  const intervalStr = inputIntervalNum ? inputIntervalNum.value.trim() : "";
  const delayStr = inputDelayNum ? inputDelayNum.value.trim() : "";
  const packetSizeStr = inputPacketSizeNum ? inputPacketSizeNum.value.trim() : "";
  const timeoutStr = inputTimeoutNum ? inputTimeoutNum.value.trim() : "";
  const trTimeoutStr = inputTrTimeoutNum ? inputTrTimeoutNum.value.trim() : "";
  const streamStr = inputStreamNum ? inputStreamNum.value.trim() : "";

  // 1. 空欄チェック
  if (intervalStr === "") {
    return {
      valid: false,
      message: "Ping実行間隔が空欄です。1秒〜10秒の数値を入力してください。",
      field: "interval",
    };
  }
  if (delayStr === "") {
    return {
      valid: false,
      message: "Ping実行ディレイが空欄です。0ms〜1000msの数値を入力してください。",
      field: "delay",
    };
  }
  if (packetSizeStr === "") {
    return {
      valid: false,
      message: "Pingパケットサイズが空欄です。32バイト〜10000バイトの数値を入力してください。",
      field: "packetsize",
    };
  }
  if (timeoutStr === "") {
    return {
      valid: false,
      message: "Pingタイムアウト値が空欄です。500ms〜5000msの数値を入力してください。",
      field: "timeout",
    };
  }
  if (trTimeoutStr === "") {
    return {
      valid: false,
      message: "Tracerouteタイムアウト時間が空欄です。10秒〜300秒の数値を入力してください。",
      field: "trtimeout",
    };
  }
  if (streamStr === "") {
    return {
      valid: false,
      message: "応答履歴の表示件数が空欄です。50件〜1000件の数値を入力してください。",
      field: "stream",
    };
  }

  const intervalVal = parseInt(intervalStr, 10);
  const delayVal = parseInt(delayStr, 10);
  const packetSizeVal = parseInt(packetSizeStr, 10);
  const timeoutVal = parseInt(timeoutStr, 10);
  const trTimeoutVal = parseInt(trTimeoutStr, 10);
  const streamVal = parseInt(streamStr, 10);

  if (
    isNaN(intervalVal) ||
    isNaN(delayVal) ||
    isNaN(packetSizeVal) ||
    isNaN(timeoutVal) ||
    isNaN(trTimeoutVal) ||
    isNaN(streamVal)
  ) {
    return {
      valid: false,
      message: "設定値に無効な数値が含まれています。正しい数値を入力してください。",
    };
  }

  // 2. 範囲チェック
  if (intervalVal < 1 || intervalVal > 10) {
    return {
      valid: false,
      message: "Ping実行間隔は1秒〜10秒の範囲で設定してください。",
      field: "interval",
    };
  }
  if (delayVal < 0 || delayVal > 1000) {
    return {
      valid: false,
      message: "Ping実行ディレイは0ms〜1000msの範囲で設定してください。",
      field: "delay",
    };
  }
  if (packetSizeVal < 32 || packetSizeVal > 10000) {
    return {
      valid: false,
      message: "Pingパケットサイズは32バイト〜10000バイトの範囲で設定してください。",
      field: "packetsize",
    };
  }
  if (timeoutVal < 500 || timeoutVal > 5000) {
    return {
      valid: false,
      message: "Pingタイムアウト値は500ms〜5000msの範囲で設定してください。",
      field: "timeout",
    };
  }
  if (timeoutVal > intervalVal * 1000) {
    return {
      valid: false,
      message: `Pingタイムアウト値（${timeoutVal}ms）が実行間隔（${intervalVal}秒 = ${intervalVal * 1000}ms）を超えています。タイムアウト値は実行間隔以下に設定してください。`,
      field: "timeout",
    };
  }
  if (trTimeoutVal < 10 || trTimeoutVal > 300) {
    return {
      valid: false,
      message: "Tracerouteタイムアウト時間は10秒〜300秒の範囲で設定してください。",
      field: "trtimeout",
    };
  }
  if (streamVal < 50 || streamVal > 1000) {
    return {
      valid: false,
      message: "応答履歴の表示件数は50件〜1000件の範囲で設定してください。",
      field: "stream",
    };
  }

  return { valid: true, message: "" };
}

interface PingParameters {
  intervalSec?: number;
  delayMs?: number;
  packetSize?: number;
  autoDecreasePacketSize?: boolean;
  timeoutMs?: number;
  tracerouteTimeoutSec?: number;
  maxStreamItems?: number;
  saveDir?: string;
  theme?: AppTheme;
}

/**
 * `ping-parameters.conf` のテキストから設定値をパースする関数
 */
function parseParametersConfig(content: string): PingParameters {
  const params: PingParameters = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const val = trimmed.slice(eqIdx + 1).trim();

    switch (key) {
      case "interval_sec":
      case "interval": {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 1 && num <= 10) params.intervalSec = num;
        break;
      }
      case "delay_ms":
      case "delay": {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 0 && num <= 1000) params.delayMs = num;
        break;
      }
      case "packet_size":
      case "packetsize": {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 32 && num <= 10000) params.packetSize = num;
        break;
      }
      case "auto_decrease_size":
      case "autodecreasesize": {
        params.autoDecreasePacketSize = val.toLowerCase() === "true" || val === "1";
        break;
      }
      case "timeout_ms":
      case "timeout": {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 500 && num <= 5000) params.timeoutMs = num;
        break;
      }
      case "traceroute_timeout_sec":
      case "traceroutetimeout": {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 10 && num <= 300) params.tracerouteTimeoutSec = num;
        break;
      }
      case "max_stream_items":
      case "stream_items":
      case "stream": {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 50 && num <= 1000) params.maxStreamItems = num;
        break;
      }
      case "save_dir":
      case "savedir":
      case "save_path":
      case "savepath": {
        if (val.length > 0) params.saveDir = val;
        break;
      }
      case "theme": {
        if (val.toLowerCase() === "dark" || val.toLowerCase() === "light") {
          params.theme = val.toLowerCase() as AppTheme;
        }
        break;
      }
    }
  }
  return params;
}

/**
 * 現在のメモリ上の設定値から `ping-parameters.conf` 形式のテキストを生成する関数
 */
function serializeParametersConfig(): string {
  const currentTheme = (document.documentElement.getAttribute("data-theme") as AppTheme) || "light";
  return [
    "# Pingツール パラメータ設定ファイル (ping-parameters.conf)",
    "# 各パラメータの数値を編集して保存することができます",
    "",
    `# Ping実行間隔 (秒: 1 - 10)`,
    `interval_sec=${pingIntervalSec}`,
    "",
    `# Ping実行ディレイ (ミリ秒: 0 - 1000, 0で同時実行)`,
    `delay_ms=${pingDelayMs}`,
    "",
    `# Pingパケットサイズ (バイト: 32 - 10000)`,
    `packet_size=${pingPacketSize}`,
    "",
    `# 3回連続NG時にパケットサイズ自動縮小 (true / false)`,
    `auto_decrease_size=${autoDecreasePacketSize}`,
    "",
    `# Pingタイムアウト値 (ミリ秒: 500 - 5000, 実行間隔以下)`,
    `timeout_ms=${pingTimeoutMs}`,
    "",
    `# Tracerouteタイムアウト時間 (秒: 10 - 300)`,
    `traceroute_timeout_sec=${tracerouteTimeoutSec}`,
    "",
    `# 応答履歴の表示件数 (件: 50 - 1000)`,
    `max_stream_items=${maxStreamItems}`,
    "",
    `# Traceroute / Ping統計 結果保存先フォルダ (デフォルト: result)`,
    `save_dir=${pingSaveDir}`,
    "",
    `# カラーテーマ (light / dark)`,
    `theme=${currentTheme}`,
    "",
  ].join("\n");
}

/**
 * `ping-parameters.conf` から設定を読み込み、状態とUIに反映する関数
 */
async function loadParametersConfigFile(): Promise<boolean> {
  try {
    const content = await invoke<string>("load_parameters_config");
    if (content && content.trim().length > 0) {
      const params = parseParametersConfig(content);
      if (params.intervalSec !== undefined) pingIntervalSec = params.intervalSec;
      if (params.delayMs !== undefined) pingDelayMs = params.delayMs;
      if (params.packetSize !== undefined) pingPacketSize = params.packetSize;
      if (params.autoDecreasePacketSize !== undefined) autoDecreasePacketSize = params.autoDecreasePacketSize;
      if (params.timeoutMs !== undefined) pingTimeoutMs = params.timeoutMs;
      if (params.tracerouteTimeoutSec !== undefined) tracerouteTimeoutSec = params.tracerouteTimeoutSec;
      if (params.maxStreamItems !== undefined) maxStreamItems = params.maxStreamItems;
      if (params.saveDir !== undefined && params.saveDir.trim().length > 0) {
        pingSaveDir = params.saveDir.trim();
      }
      if (params.theme !== undefined) {
        setTheme(params.theme, false);
      }

      // タイムアウト値が間隔を超えている場合は補正
      if (pingTimeoutMs > pingIntervalSec * 1000) {
        pingTimeoutMs = pingIntervalSec * 1000;
      }

      updateOptionsUI(true);
      return true;
    }
  } catch (err) {
    console.error("Failed to load parameters config:", err);
  }
  return false;
}

/**
 * LocalStorageから各種設定値を復元する関数
 */
function initPingOptions() {
  const savedIntervalSec = localStorage.getItem("ping_interval_sec");
  const savedIntervalMs = localStorage.getItem("ping_interval_ms");
  const savedTimeout = localStorage.getItem("ping_timeout_ms");
  const savedDelay = localStorage.getItem("ping_delay_ms");
  const savedPacketSize = localStorage.getItem("ping_packet_size");
  const savedTrTimeout = localStorage.getItem("ping_traceroute_timeout_sec");
  const savedStreamItems = localStorage.getItem("ping_max_stream_items");
  const savedSaveDir = localStorage.getItem("ping_save_dir");

  if (savedIntervalSec) {
    const val = parseInt(savedIntervalSec, 10);
    if (!isNaN(val) && val >= 1 && val <= 10) {
      pingIntervalSec = val;
    }
  } else if (savedIntervalMs) {
    const val = parseInt(savedIntervalMs, 10);
    if (!isNaN(val)) {
      pingIntervalSec = Math.max(1, Math.min(10, Math.round(val / 1000)));
    }
  }

  if (savedTimeout) {
    const val = parseInt(savedTimeout, 10);
    if (!isNaN(val) && val >= 500 && val <= 5000) {
      pingTimeoutMs = val;
    }
  }

  if (savedDelay !== null) {
    const val = parseInt(savedDelay, 10);
    if (!isNaN(val) && val >= 0 && val <= 1000) {
      pingDelayMs = val;
    }
  } else {
    pingDelayMs = 50;
  }

  if (savedPacketSize !== null) {
    const val = parseInt(savedPacketSize, 10);
    if (!isNaN(val) && val >= 32 && val <= 10000) {
      pingPacketSize = val;
    }
  } else {
    pingPacketSize = 32;
  }

  const savedAutoDecrease = localStorage.getItem("ping_auto_decrease_size");
  if (savedAutoDecrease !== null) {
    autoDecreasePacketSize = savedAutoDecrease === "true";
  } else {
    autoDecreasePacketSize = false;
  }

  if (savedTrTimeout !== null) {
    const val = parseInt(savedTrTimeout, 10);
    if (!isNaN(val) && val >= 10 && val <= 300) {
      tracerouteTimeoutSec = val;
    }
  } else {
    tracerouteTimeoutSec = 60; // 初期値 60秒
  }

  if (savedStreamItems) {
    const val = parseInt(savedStreamItems, 10);
    if (!isNaN(val) && val >= 50 && val <= 1000) {
      maxStreamItems = val;
    }
  }

  if (savedSaveDir !== null && savedSaveDir.trim().length > 0) {
    pingSaveDir = savedSaveDir.trim();
  } else {
    pingSaveDir = "result";
  }

  // タイムアウト値が間隔を超えている場合は補正
  if (pingTimeoutMs > pingIntervalSec * 1000) {
    pingTimeoutMs = pingIntervalSec * 1000;
  }

  updateOptionsUI(true);
}

/**
 * オプション設定画面の各入力フォーム、バッジ表示、プリセットボタンのアクティブ状態を更新する関数
 * @param forceSyncInputs フォーカス中の入力欄も強制的に最新値で上書きするかどうか
 */
function updateOptionsUI(forceSyncInputs = false) {
  if (!inputIntervalRange || !inputIntervalNum) return;

  // 1. 実行間隔の更新
  inputIntervalRange.value = pingIntervalSec.toString();
  const currentIntervalStr = inputIntervalNum.value.trim();
  if (forceSyncInputs || document.activeElement !== inputIntervalNum) {
    inputIntervalNum.value = pingIntervalSec.toString();
  }
  if (currentIntervalStr === "" && document.activeElement === inputIntervalNum) {
    intervalDisplayBadge.textContent = "未入力 (未設定)";
  } else {
    intervalDisplayBadge.textContent = `${pingIntervalSec} 秒 (${pingIntervalSec * 1000}ms)`;
  }

  // 2. ディレイの更新
  if (inputDelayRange && inputDelayNum && delayDisplayBadge) {
    inputDelayRange.value = pingDelayMs.toString();
    const currentDelayStr = inputDelayNum.value.trim();
    if (forceSyncInputs || document.activeElement !== inputDelayNum) {
      inputDelayNum.value = pingDelayMs.toString();
    }
    if (currentDelayStr === "" && document.activeElement === inputDelayNum) {
      delayDisplayBadge.textContent = "未入力 (未設定)";
    } else {
      delayDisplayBadge.textContent = pingDelayMs === 0 ? "0 ms (同時実行)" : `${pingDelayMs} ms`;
    }
  }

  // 3. パケットサイズの更新
  if (inputPacketSizeRange && inputPacketSizeNum && packetSizeDisplayBadge) {
    const currentPacketStr = inputPacketSizeNum.value.trim();
    if (forceSyncInputs || document.activeElement !== inputPacketSizeNum) {
      inputPacketSizeNum.value = pingPacketSize.toString();
    }
    inputPacketSizeRange.value = Math.min(1472, Math.max(32, pingPacketSize)).toString();

    if (currentPacketStr === "" && document.activeElement === inputPacketSizeNum) {
      packetSizeDisplayBadge.textContent = "未入力 (未設定)";
      if (actualSizeTotal) actualSizeTotal.textContent = "--";
      if (actualSizePayload) actualSizePayload.textContent = "--";
    } else {
      const totalWireSize = pingPacketSize + 28;
      packetSizeDisplayBadge.textContent = `${pingPacketSize} バイト (送信: ${totalWireSize} バイト)`;
      if (actualSizeTotal) actualSizeTotal.textContent = totalWireSize.toString();
      if (actualSizePayload) actualSizePayload.textContent = pingPacketSize.toString();
    }
  }

  // 4. パケットサイズ自動縮小トグルの更新
  if (inputAutoDecreaseSize) {
    inputAutoDecreaseSize.checked = autoDecreasePacketSize;
  }
  if (autoDecreaseStatusBadge) {
    autoDecreaseStatusBadge.textContent = autoDecreasePacketSize ? "有効 (自動縮小)" : "無効";
    autoDecreaseStatusBadge.classList.toggle("active", autoDecreasePacketSize);
  }

  // 5. タイムアウト値の更新
  inputTimeoutRange.value = pingTimeoutMs.toString();
  const currentTimeoutStr = inputTimeoutNum.value.trim();
  if (forceSyncInputs || document.activeElement !== inputTimeoutNum) {
    inputTimeoutNum.value = pingTimeoutMs.toString();
  }
  if (currentTimeoutStr === "" && document.activeElement === inputTimeoutNum) {
    timeoutDisplayBadge.textContent = "未入力 (未設定)";
  } else {
    timeoutDisplayBadge.textContent = `${pingTimeoutMs} ms (${(pingTimeoutMs / 1000).toFixed(1)}秒)`;
  }

  // 6. Tracerouteタイムアウトの更新
  if (inputTrTimeoutRange && inputTrTimeoutNum && trTimeoutDisplayBadge) {
    inputTrTimeoutRange.value = tracerouteTimeoutSec.toString();
    const currentTrStr = inputTrTimeoutNum.value.trim();
    if (forceSyncInputs || document.activeElement !== inputTrTimeoutNum) {
      inputTrTimeoutNum.value = tracerouteTimeoutSec.toString();
    }
    if (currentTrStr === "" && document.activeElement === inputTrTimeoutNum) {
      trTimeoutDisplayBadge.textContent = "未入力 (未設定)";
    } else {
      trTimeoutDisplayBadge.textContent = `${tracerouteTimeoutSec} 秒`;
    }
  }

  // 7. 履歴表示件数の更新
  if (inputStreamRange && inputStreamNum && streamDisplayBadge) {
    inputStreamRange.value = maxStreamItems.toString();
    const currentStreamStr = inputStreamNum.value.trim();
    if (forceSyncInputs || document.activeElement !== inputStreamNum) {
      inputStreamNum.value = maxStreamItems.toString();
    }
    if (currentStreamStr === "" && document.activeElement === inputStreamNum) {
      streamDisplayBadge.textContent = "未入力 (未設定)";
    } else {
      streamDisplayBadge.textContent = `${maxStreamItems} 件 (直近)`;
    }
  }

  // 8. 結果保存先フォルダの更新
  if (inputSavedirText && savedirDisplayBadge) {
    if (forceSyncInputs || document.activeElement !== inputSavedirText) {
      inputSavedirText.value = pingSaveDir;
    }
    const currentSaveDirStr = inputSavedirText.value.trim();
    if (currentSaveDirStr === "" && document.activeElement === inputSavedirText) {
      savedirDisplayBadge.textContent = "未入力 (未設定)";
    } else {
      savedirDisplayBadge.textContent = pingSaveDir === "result" ? "result (初期値)" : pingSaveDir;
      savedirDisplayBadge.title = pingSaveDir;
    }
  }

  // 9. プリセットボタンのアクティブ表示切替
  presetBtns.forEach((btn) => {
    const forField = btn.getAttribute("data-for");
    const val = parseInt(btn.getAttribute("data-val") ?? "0", 10);
    if (forField === "interval") {
      const isEmpty = inputIntervalNum.value.trim() === "" && document.activeElement === inputIntervalNum;
      btn.classList.toggle("active", !isEmpty && val === pingIntervalSec);
    } else if (forField === "delay") {
      const isEmpty = inputDelayNum && inputDelayNum.value.trim() === "" && document.activeElement === inputDelayNum;
      btn.classList.toggle("active", !isEmpty && val === pingDelayMs);
    } else if (forField === "packetsize") {
      const isEmpty = inputPacketSizeNum && inputPacketSizeNum.value.trim() === "" && document.activeElement === inputPacketSizeNum;
      btn.classList.toggle("active", !isEmpty && val === pingPacketSize);
    } else if (forField === "timeout") {
      const isEmpty = inputTimeoutNum.value.trim() === "" && document.activeElement === inputTimeoutNum;
      btn.classList.toggle("active", !isEmpty && val === pingTimeoutMs);
    } else if (forField === "tr-timeout") {
      const isEmpty = inputTrTimeoutNum.value.trim() === "" && document.activeElement === inputTrTimeoutNum;
      btn.classList.toggle("active", !isEmpty && val === tracerouteTimeoutSec);
    } else if (forField === "stream") {
      const isEmpty = inputStreamNum && inputStreamNum.value.trim() === "" && document.activeElement === inputStreamNum;
      btn.classList.toggle("active", !isEmpty && val === maxStreamItems);
    } else if (forField === "savedir") {
      const isDefault = pingSaveDir === "result";
      btn.classList.toggle("active", isDefault);
    }
  });

  // 10. バリデーションエラーメッセージの表示制御
  const validation = validateCurrentOptions();
  if (optionsValidationAlert && optionsValidationMsg) {
    if (!validation.valid) {
      optionsValidationAlert.classList.remove("hidden");
      optionsValidationMsg.textContent = validation.message;
      document.querySelectorAll(".option-card").forEach((card) => card.classList.add("has-error"));
    } else {
      optionsValidationAlert.classList.add("hidden");
      document.querySelectorAll(".option-card").forEach((card) => card.classList.remove("has-error"));
    }
  }

  updateResultsPanelDesc();
}

function setPingInterval(val: number) {
  pingIntervalSec = Math.max(1, Math.min(10, val));
  updateOptionsUI(true);
}

function setPingDelay(val: number) {
  pingDelayMs = Math.max(0, Math.min(1000, val));
  updateOptionsUI(true);
}

function setPacketSize(val: number) {
  pingPacketSize = Math.max(32, Math.min(10000, val));
  updateOptionsUI(true);
}

function setPingTimeout(val: number) {
  pingTimeoutMs = Math.max(500, Math.min(5000, val));
  updateOptionsUI(true);
}

function setTracerouteTimeout(val: number) {
  tracerouteTimeoutSec = Math.max(10, Math.min(300, val));
  updateOptionsUI(true);
}

function setStreamItems(val: number) {
  maxStreamItems = Math.max(50, Math.min(1000, val));
  updateOptionsUI(true);
  document.querySelectorAll(".stream-container").forEach((streamEl) => {
    while (streamEl.children.length > maxStreamItems) {
      streamEl.removeChild(streamEl.firstChild!);
    }
  });
}

// 各種入力欄のイベントリスナー
if (inputIntervalRange && inputIntervalNum) {
  inputIntervalRange.addEventListener("input", () => {
    setPingInterval(parseInt(inputIntervalRange.value, 10));
  });

  inputIntervalNum.addEventListener("input", () => {
    const raw = inputIntervalNum.value.trim();
    if (raw !== "") {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        pingIntervalSec = val;
      }
    }
    updateOptionsUI(false);
  });
}

if (inputDelayRange && inputDelayNum) {
  inputDelayRange.addEventListener("input", () => {
    setPingDelay(parseInt(inputDelayRange.value, 10));
  });

  inputDelayNum.addEventListener("input", () => {
    const raw = inputDelayNum.value.trim();
    if (raw !== "") {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        pingDelayMs = val;
      }
    }
    updateOptionsUI(false);
  });
}

if (inputPacketSizeRange && inputPacketSizeNum) {
  inputPacketSizeRange.addEventListener("input", () => {
    setPacketSize(parseInt(inputPacketSizeRange.value, 10));
  });

  inputPacketSizeNum.addEventListener("input", () => {
    const raw = inputPacketSizeNum.value.trim();
    if (raw !== "") {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        pingPacketSize = val;
      }
    }
    updateOptionsUI(false);
  });
}

if (inputAutoDecreaseSize) {
  inputAutoDecreaseSize.addEventListener("change", () => {
    autoDecreasePacketSize = inputAutoDecreaseSize.checked;
    updateOptionsUI(false);
  });
}

if (inputTimeoutRange && inputTimeoutNum) {
  inputTimeoutRange.addEventListener("input", () => {
    setPingTimeout(parseInt(inputTimeoutRange.value, 10));
  });

  inputTimeoutNum.addEventListener("input", () => {
    const raw = inputTimeoutNum.value.trim();
    if (raw !== "") {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        pingTimeoutMs = val;
      }
    }
    updateOptionsUI(false);
  });
}

if (inputTrTimeoutRange && inputTrTimeoutNum) {
  inputTrTimeoutRange.addEventListener("input", () => {
    setTracerouteTimeout(parseInt(inputTrTimeoutRange.value, 10));
  });

  inputTrTimeoutNum.addEventListener("input", () => {
    const raw = inputTrTimeoutNum.value.trim();
    if (raw !== "") {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        tracerouteTimeoutSec = val;
      }
    }
    updateOptionsUI(false);
  });
}

if (inputStreamRange && inputStreamNum) {
  inputStreamRange.addEventListener("input", () => {
    setStreamItems(parseInt(inputStreamRange.value, 10));
  });

  inputStreamNum.addEventListener("input", () => {
    const raw = inputStreamNum.value.trim();
    if (raw !== "") {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        maxStreamItems = val;
      }
    }
    updateOptionsUI(false);
  });
}

if (inputSavedirText) {
  inputSavedirText.addEventListener("input", () => {
    const raw = inputSavedirText.value.trim();
    pingSaveDir = raw || "result";
    updateOptionsUI(false);
  });
}

// フォルダ選択ダイアログ呼び出し
if (btnSelectSavedir) {
  btnSelectSavedir.addEventListener("click", async () => {
    try {
      const selected = await invoke<string | null>("select_folder", {
        defaultPath: pingSaveDir,
      });
      if (selected) {
        pingSaveDir = selected;
        if (inputSavedirText) {
          inputSavedirText.value = selected;
        }
        updateOptionsUI(true);
        showToast(`保存先フォルダを選択しました: ${selected}`, "info");
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
      showToast(`フォルダ選択エラー: ${err}`, "error");
    }
  });
}

// エクスプローラーで保存先フォルダを開く
if (btnOpenSavedir) {
  btnOpenSavedir.addEventListener("click", async () => {
    try {
      await invoke("open_folder", { path: pingSaveDir });
      showToast(`保存先フォルダを開きました (${pingSaveDir})`, "info");
    } catch (err) {
      console.error("Failed to open folder:", err);
      showToast(`フォルダを開くのに失敗しました: ${err}`, "error");
    }
  });
}

// プリセットボタンのクリック処理
presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const forField = btn.getAttribute("data-for");
    const val = parseInt(btn.getAttribute("data-val") ?? "1", 10);
    if (forField === "interval") {
      setPingInterval(val);
    } else if (forField === "delay") {
      setPingDelay(val);
    } else if (forField === "packetsize") {
      setPacketSize(val);
    } else if (forField === "timeout") {
      setPingTimeout(val);
    } else if (forField === "tr-timeout") {
      setTracerouteTimeout(val);
    } else if (forField === "stream") {
      setStreamItems(val);
    } else if (forField === "savedir") {
      pingSaveDir = "result";
      if (inputSavedirText) inputSavedirText.value = "result";
      updateOptionsUI(true);
    }
  });
});

// 「初期値に戻す」ボタン
if (btnResetOptions) {
  btnResetOptions.addEventListener("click", () => {
    pingIntervalSec = 1;
    pingTimeoutMs = 1000;
    pingDelayMs = 50;
    pingPacketSize = 32;
    autoDecreasePacketSize = false;
    tracerouteTimeoutSec = 60;
    maxStreamItems = 100;
    pingSaveDir = "result";

    localStorage.setItem("ping_interval_sec", "1");
    localStorage.setItem("ping_timeout_ms", "1000");
    localStorage.setItem("ping_delay_ms", "50");
    localStorage.setItem("ping_packet_size", "32");
    localStorage.setItem("ping_auto_decrease_size", "false");
    localStorage.setItem("ping_traceroute_timeout_sec", "60");
    localStorage.setItem("ping_max_stream_items", "100");
    localStorage.setItem("ping_save_dir", "result");

    updateOptionsUI(true);
    showToast("Ping設定を初期値 (間隔1秒 / ディレイ50ms / 32B / 縮小OFF / タイムアウト1000ms / Traceroute60秒 / 履歴100件 / 保存先result) に戻しました", "info");
  });
}

/**
 * 現在の設定内容を `ping-parameters.conf` に保存する関数
 */
async function saveParametersConfigFile() {
  const validation = validateCurrentOptions();
  if (!validation.valid) {
    showToast(validation.message, "error");
    return;
  }

  const intervalVal = parseInt(inputIntervalNum.value.trim(), 10);
  const delayVal = parseInt(inputDelayNum.value.trim(), 10);
  const packetSizeVal = parseInt(inputPacketSizeNum.value.trim(), 10);
  const timeoutVal = parseInt(inputTimeoutNum.value.trim(), 10);
  const trTimeoutVal = parseInt(inputTrTimeoutNum.value.trim(), 10);
  const streamVal = parseInt(inputStreamNum.value.trim(), 10);
  const saveDirVal = inputSavedirText ? inputSavedirText.value.trim() : "result";

  pingIntervalSec = intervalVal;
  pingDelayMs = delayVal;
  pingPacketSize = packetSizeVal;
  pingTimeoutMs = timeoutVal;
  tracerouteTimeoutSec = trTimeoutVal;
  maxStreamItems = streamVal;
  pingSaveDir = saveDirVal || "result";
  if (inputAutoDecreaseSize) {
    autoDecreasePacketSize = inputAutoDecreaseSize.checked;
  }

  try {
    const exists = await invoke<boolean>("parameters_config_exists");
    if (exists) {
      const confirmed = await showConfirmDialog({
        title: "設定ファイルの上書き確認",
        message: "ping-parameters.conf は既に存在します。\n上書きして保存しますか？",
        confirmText: "上書き保存する",
        cancelText: "キャンセル",
        isDanger: true,
      });
      if (!confirmed) return;
    }

    const content = serializeParametersConfig();
    await invoke("save_parameters_config", { content });

    localStorage.setItem("ping_interval_sec", pingIntervalSec.toString());
    localStorage.setItem("ping_timeout_ms", pingTimeoutMs.toString());
    localStorage.setItem("ping_delay_ms", pingDelayMs.toString());
    localStorage.setItem("ping_packet_size", pingPacketSize.toString());
    localStorage.setItem("ping_auto_decrease_size", autoDecreasePacketSize.toString());
    localStorage.setItem("ping_traceroute_timeout_sec", tracerouteTimeoutSec.toString());
    localStorage.setItem("ping_max_stream_items", maxStreamItems.toString());
    localStorage.setItem("ping_save_dir", pingSaveDir);

    updateOptionsUI(true);
    showToast("ping-parameters.conf に設定を保存しました", "success");
  } catch (err) {
    console.error("Failed to save parameters config:", err);
    showToast(`設定保存失敗: ${err}`, "error");
  }
}

if (btnSaveOptions) {
  btnSaveOptions.addEventListener("click", saveParametersConfigFile);
}

// ==========================================
// テーマ切り替え管理 (Dark / Light Mode)
// ==========================================
type AppTheme = "dark" | "light";

/**
 * アプリのカラーテーマ（ダーク/ホワイト）を設定する関数
 * @param theme "dark" | "light"
 * @param save LocalStorageに保存してトーストを表示するかどうか
 */
function setTheme(theme: AppTheme, save = true) {
  document.documentElement.setAttribute("data-theme", theme);

  if (themeDisplayBadge) {
    themeDisplayBadge.textContent = theme === "dark" ? "ダークモード" : "ホワイトモード";
  }

  if (btnThemeDark) {
    btnThemeDark.classList.toggle("active", theme === "dark");
  }
  if (btnThemeLight) {
    btnThemeLight.classList.toggle("active", theme === "light");
  }

  if (save) {
    localStorage.setItem("app_theme", theme);
    showToast(`テーマを「${theme === "dark" ? "ダークモード" : "ホワイトモード"}」に変更しました`, "info");
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem("app_theme") as AppTheme | null;
  setTheme(savedTheme === "dark" ? "dark" : "light", false);
}

if (btnThemeDark) {
  btnThemeDark.addEventListener("click", () => setTheme("dark"));
}

if (btnThemeLight) {
  btnThemeLight.addEventListener("click", () => setTheme("light"));
}

// ==========================================
// Ping開始 / 停止 制御 (Start / Stop Control)
// ==========================================
/**
 * Ping監視の開始・停止をトグル切り替えする関数
 */
async function togglePing() {
  if (isRunning) {
    // 停止処理
    try {
      await invoke("stop_ping");
      setRunningState(false);
      showToast("Ping監視を停止しました", "info");
    } catch (err) {
      showToast(`停止エラー: ${err}`, "error");
    }
  } else {
    // 開始処理
    if (currentTargets.length === 0) {
      showToast("監視対象が設定されていません。設定画面で登録してください。", "error");
      switchTab("settings");
      return;
    }

    const validation = validateCurrentOptions();
    if (!validation.valid) {
      showToast(validation.message, "error");
      switchTab("options");
      return;
    }

    const intervalVal = parseInt(inputIntervalNum.value.trim(), 10);
    const delayVal = parseInt(inputDelayNum.value.trim(), 10);
    const packetSizeVal = parseInt(inputPacketSizeNum.value.trim(), 10);
    const timeoutVal = parseInt(inputTimeoutNum.value.trim(), 10);
    const streamVal = parseInt(inputStreamNum.value.trim(), 10);

    pingIntervalSec = intervalVal;
    pingDelayMs = delayVal;
    pingPacketSize = packetSizeVal;
    currentRuntimePacketSize = pingPacketSize;
    hasReachedAllOk = false;
    pingTimeoutMs = timeoutVal;
    maxStreamItems = streamVal;
    if (inputAutoDecreaseSize) {
      autoDecreasePacketSize = inputAutoDecreaseSize.checked;
    }

    try {
      await invoke("start_ping", {
        targets: currentTargets,
        intervalMs: pingIntervalSec * 1000,
        timeoutMs: pingTimeoutMs,
        delayMs: pingDelayMs,
        packetSize: pingPacketSize,
        autoDecreaseSize: autoDecreasePacketSize,
      });
      setRunningState(true);
      updateResultsPanelDesc();
      const delayMsg = pingDelayMs > 0 ? ` / ディレイ: ${pingDelayMs}ms` : " (同時実行)";
      const totalWireSize = pingPacketSize + 28;
      const autoDecMsg = autoDecreasePacketSize ? " / 3回連続NG時自動縮小: 有効" : "";
      showToast(
        `Ping監視を開始しました（間隔: ${pingIntervalSec}秒${delayMsg} / サイズ: ${pingPacketSize}B [送信: ${totalWireSize}B]${autoDecMsg} / タイムアウト: ${pingTimeoutMs}ms）`,
        "success"
      );
    } catch (err) {
      showToast(`開始エラー: ${err}`, "error");
    }
  }
}

/**
 * 実行中/停止中状態に応じてヘッダーの開始ボタンやステータス表示を切り替える関数
 */
function setRunningState(running: boolean) {
  isRunning = running;
  if (running) {
    btnTogglePing.classList.add("danger-stop");
    btnTogglePing.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16"/>
        <rect x="14" y="4" width="4" height="16"/>
      </svg>
      <span id="btn-toggle-ping-text">Ping停止</span>
    `;
    globalStatusPill.classList.add("running");
    globalStatusText.textContent = `監視中 (${pingIntervalSec}秒毎)`;
  } else {
    btnTogglePing.classList.remove("danger-stop");
    btnTogglePing.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span id="btn-toggle-ping-text">Ping開始</span>
    `;
    globalStatusPill.classList.remove("running");
    globalStatusText.textContent = "停止中";
  }
}

btnTogglePing.addEventListener("click", togglePing);

// ==========================================
// Traceroute 一括実行 (Batch Traceroute)
// ==========================================
let isCancellingBatchTraceroute = false;

/**
 * 全監視対象へのTraceroute並行一括実行を開始/中止する関数
 */
async function startBatchTraceroute() {
  // すでに実行中の場合は中止処理
  if (isBatchTracerouteRunning) {
    if (isCancellingBatchTraceroute) return;
    isCancellingBatchTraceroute = true;
    btnBatchTracerouteText.innerHTML = "中止処理中...<br>お待ちください";
    btnBatchTraceroute.disabled = true;
    try {
      await invoke("stop_batch_traceroute");
      showToast("Traceroute一括実行の中止を要求しました", "info");
    } catch (err) {
      console.error("Failed to cancel batch traceroute:", err);
      showToast(`Traceroute一括実行中止エラー: ${err}`, "error");
    }
    return;
  }

  if (currentTargets.length === 0) {
    showToast("監視対象が設定されていません。設定画面で登録してください。", "error");
    switchTab("settings");
    return;
  }

  isBatchTracerouteRunning = true;
  isCancellingBatchTraceroute = false;
  btnBatchTraceroute.classList.add("running");
  btnBatchTraceroute.disabled = false;
  btnBatchTraceroute.title = "クリックでTraceroute一括実行を中止します";
  btnBatchTracerouteText.innerHTML = `一括実行中 (0/${currentTargets.length})<br>中止する`;

  showToast(
    `全${currentTargets.length}件へのTraceroute一括実行（並行）を開始しました（タイムアウト: ${tracerouteTimeoutSec}秒）`,
    "info"
  );

  try {
    const result = await invoke<BatchTracerouteResult>("start_batch_traceroute", {
      targets: currentTargets,
      timeoutSecs: tracerouteTimeoutSec,
      saveDir: pingSaveDir,
    });

    const succ = result.success_count;
    const total = result.total_targets;
    const dur = result.duration_sec.toFixed(1);
    const saveNotice = `\n保存先: ${result.file_path}`;
    if (succ === total) {
      showToast(
        `Traceroute一括実行が完了しました（${succ}/${total}件成功・所要時間 ${dur}秒 / ${result.filename} 保存完了）${saveNotice}`,
        "success"
      );
    } else {
      showToast(
        `Traceroute一括実行が終了しました（${succ}/${total}件成功・所要時間 ${dur}秒 / ${result.filename} 保存完了）${saveNotice}`,
        "info"
      );
    }
  } catch (err) {
    console.error("Batch traceroute failed:", err);
    showToast(`Traceroute一括実行エラー: ${err}`, "error");
  } finally {
    isBatchTracerouteRunning = false;
    isCancellingBatchTraceroute = false;
    btnBatchTraceroute.classList.remove("running");
    btnBatchTraceroute.disabled = false;
    btnBatchTraceroute.title = "全対象へ並行してTracerouteを実行し1ファイルにまとめて保存";
    btnBatchTracerouteText.innerHTML = "Traceroute<br>一括実行";
  }
}

btnBatchTraceroute.addEventListener("click", startBatchTraceroute);

// ==========================================
// ユーティリティ: HTMLエスケープ (Utility: HTML Escape)
// ==========================================
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// 右クリックコンテキストメニュー・個別Traceroute (Context Menu)
// ==========================================
const contextMenu = document.getElementById("context-menu") as HTMLElement;
const contextMenuName = document.getElementById("context-menu-name") as HTMLElement;
const contextMenuIp = document.getElementById("context-menu-ip") as HTMLElement;
const contextItemTraceroute = document.getElementById("context-item-traceroute") as HTMLButtonElement;
const contextItemCopyIp = document.getElementById("context-item-copy-ip") as HTMLButtonElement;

let contextTarget: PingTarget | null = null;

// テーブル行上で右クリックした際にカスタムコンテキストメニューを表示
resultsTbody.addEventListener("contextmenu", (e: MouseEvent) => {
  const targetEl = e.target as HTMLElement;
  const row = targetEl.closest("tr") as HTMLTableRowElement;
  if (!row) return;

  const targetId = row.getAttribute("data-target-id");
  const target = currentTargets.find((t) => t.id === targetId);
  if (!target) return;

  e.preventDefault();
  contextTarget = target;
  contextMenuName.textContent = target.name;
  contextMenuIp.textContent = target.ip;

  const menuWidth = 240;
  const menuHeight = 120;
  let posX = e.clientX;
  let posY = e.clientY;

  // 画面端からはみ出さないよう位置調整
  if (posX + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }

  contextMenu.style.left = `${posX}px`;
  contextMenu.style.top = `${posY}px`;
  contextMenu.classList.remove("hidden");
});

// 画面クリックでコンテキストメニューを閉じる
document.addEventListener("click", (e) => {
  if (contextMenu && !contextMenu.contains(e.target as Node)) {
    contextMenu.classList.add("hidden");
  }
});

// ESCキーでコンテキストメニューを閉じる
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    contextMenu.classList.add("hidden");
  }
});

// IPアドレスのクリップボードコピー
contextItemCopyIp.addEventListener("click", () => {
  if (contextTarget) {
    navigator.clipboard.writeText(contextTarget.ip);
    showToast(`IPアドレスをコピーしました (${contextTarget.ip})`, "info");
  }
  contextMenu.classList.add("hidden");
});

// 個別Tracerouteウィンドウの起動
contextItemTraceroute.addEventListener("click", async () => {
  if (contextTarget) {
    try {
      await invoke("open_traceroute_window", {
        targetId: contextTarget.id,
        targetIp: contextTarget.ip,
        targetName: contextTarget.name,
        timeoutSecs: tracerouteTimeoutSec,
      });
    } catch (err) {
      console.error("Failed to open traceroute window:", err);
      showToast(`Tracerouteウィンドウ起動エラー: ${err}`, "error");
    }
  }
  contextMenu.classList.add("hidden");
});

// ==========================================
// アプリ終了確認処理 (Window Close / Exit Handling)
// ==========================================
let isExitConfirmOpen = false;

/**
 * ユーザーがウィンドウの×ボタンやトレイからアプリ終了を求めた際の確認ダイアログハンドラ
 */
async function handleRequestClose() {
  if (isExitConfirmOpen) {
    return;
  }
  isExitConfirmOpen = true;
  try {
    const confirmed = await showConfirmDialog({
      title: "終了の確認",
      message: "Pingツールを終了してもよろしいですか？\n（実行中のPing監視も停止します）",
      confirmText: "終了する",
      cancelText: "キャンセル",
      isDanger: true,
    });
    if (confirmed) {
      await invoke("exit_app");
    }
  } catch (err) {
    console.error("Exit handling error:", err);
  } finally {
    isExitConfirmOpen = false;
  }
}

// ==========================================
// アプリケーション初期化 (App Initialization)
// ==========================================
/**
 * DOM読み込み完了時に実行されるメイン初期化関数
 */
async function initApp() {
  // バックエンドからのPing結果イベントの受信設定
  await listen<PingResult>("ping-result", (event) => {
    handlePingResult(event.payload);
  });

  // 動的パケットサイズ変更（自動縮小）イベントの受信設定
  await listen<number>("packet-size-changed", (event) => {
    const newSize = event.payload;
    currentRuntimePacketSize = newSize;
    pingPacketSize = newSize;
    localStorage.setItem("ping_packet_size", pingPacketSize.toString());
    updateOptionsUI(true);
    updateResultsPanelDesc();
  });

  // Traceroute一括実行の進捗イベントの受信設定
  await listen<BatchTracerouteProgressEvent>("batch-traceroute-progress", (event) => {
    if (isBatchTracerouteRunning && !isCancellingBatchTraceroute) {
      const p = event.payload;
      btnBatchTracerouteText.innerHTML = `一括実行中 (${p.completed_count}/${p.total_count})<br>中止する`;
    }
  });

  // タスクトレイメニューからのPing開始/停止イベントの受信設定
  await listen("tray-start-ping", () => {
    if (!isRunning) {
      togglePing();
    }
  });

  await listen("tray-stop-ping", () => {
    if (isRunning) {
      togglePing();
    }
  });

  // ウィンドウクローズ要求イベントの受信設定
  await listen("request-close", () => {
    handleRequestClose();
  });

  // 1. テーマの初期化 (ダーク / ホワイト)
  initTheme();

  // 2. オプション設定の初期化 (間隔、ディレイ、サイズ、タイムアウト、Tracerouteタイムアウト、履歴件数、保存先)
  initPingOptions();

  // 3. パラメータ設定ファイル `ping-parameters.conf` が存在すれば読み込み
  await loadParametersConfigFile();

  // 4. ターゲット設定ファイル `ping-list.config` の読み込み
  await loadConfigFile();

  // 5. バックエンドのPing実行状態を確認
  try {
    const running = await invoke<boolean>("is_pinging");
    setRunningState(running);
  } catch (e) {
    console.error(e);
  }
}

// DOMコンテンツロード時に初期化を実行
window.addEventListener("DOMContentLoaded", () => {
  initApp();
});

