/**
 * ==============================================================================
 * Pingツール (NewPing) - Traceroute サブウィンドウスクリプト (traceroute-window.ts)
 * ==============================================================================
 * 
 * 本スクリプトは、個別ターゲットに対してTracerouteを実行・監視するための専用ウィンドウを制御します。
 * 
 * 主な処理内容:
 * 1. URLクエリパラメータ（id, ip, name, timeout）の読み込みとヘッダー初期化
 * 2. バックエンド (`start_traceroute`) への探索開始要求とリアルタイムログ受信 (`traceroute-line`)
 * 3. 経過時間タイマー、ホップ数カウント、完了ステータスバッジのリアルタイム更新
 * 4. 結果レポートのクリップボードコピーおよび指定保存先フォルダへのファイル書き出し (`save_traceroute_file`)
 * 5. ウィンドウ終了時のTracerouteプロセス自動中断ハンドリング
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Traceroute ログ行イベントの型定義 */
interface TracerouteLineEvent {
  target_id: string;
  line: string;
  timestamp: number;
}

/** Traceroute 完了イベントの型定義 */
interface TracerouteFinishEvent {
  target_id: string;
  success: boolean;
  end_time: number;
  summary: string;
}

// ------------------------------------------------------------------------------
// DOM 要素参照の取得
// ------------------------------------------------------------------------------
const tracerouteStatusPill = document.getElementById("traceroute-status-pill") as HTMLElement;
const tracerouteStatusText = document.getElementById("traceroute-status-text") as HTMLElement;
const tracerouteTargetName = document.getElementById("traceroute-target-name") as HTMLElement;
const tracerouteTargetIp = document.getElementById("traceroute-target-ip") as HTMLElement;
const tracerouteTimeoutBadge = document.getElementById("traceroute-timeout-badge") as HTMLElement;
const tracerouteStartTime = document.getElementById("traceroute-start-time") as HTMLElement;
const tracerouteEndTime = document.getElementById("traceroute-end-time") as HTMLElement;
const tracerouteDuration = document.getElementById("traceroute-duration") as HTMLElement;
const tracerouteHopCount = document.getElementById("traceroute-hop-count") as HTMLElement;
const terminalStatusInfo = document.getElementById("terminal-status-info") as HTMLElement;
const tracerouteTerminalBody = document.getElementById("traceroute-terminal-body") as HTMLElement;
const tracerouteTerminalCode = document.getElementById("traceroute-terminal-code") as HTMLElement;

const btnStopTraceroute = document.getElementById("btn-stop-traceroute") as HTMLButtonElement;
const btnRerunTraceroute = document.getElementById("btn-rerun-traceroute") as HTMLButtonElement;
const btnCopyTraceroute = document.getElementById("btn-copy-traceroute") as HTMLButtonElement;
const btnSaveTraceroute = document.getElementById("btn-save-traceroute") as HTMLButtonElement;
const btnCloseWindow = document.getElementById("btn-close-window") as HTMLButtonElement;
const toastContainer = document.getElementById("toast-container") as HTMLElement;

// ------------------------------------------------------------------------------
// URLクエリパラメータの解析 (メインウィンドウからの引き継ぎデータ)
// ------------------------------------------------------------------------------
const urlParams = new URLSearchParams(window.location.search);
const targetId = urlParams.get("id") || "";
const targetIp = urlParams.get("ip") || "127.0.0.1";
const targetName = urlParams.get("name") || targetIp;
const timeoutSec = parseInt(urlParams.get("timeout") || "60", 10) || 60;

// ------------------------------------------------------------------------------
// 実行状態管理変数
// ------------------------------------------------------------------------------
let activeStartTime = Date.now();
let activeEndTime: number | null = null;
let timerInterval: number | null = null;
let hopCount = 0;
let isFinished = false;

/**
 * 画面右下にトースト通知を表示する
 */
function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

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

/**
 * テーマ設定（ダーク/ホワイト）をメインウィンドウの設定から引き継いで適用
 */
function initTheme() {
  const savedTheme = localStorage.getItem("app_theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
}

/**
 * Tracerouteの実行を開始し、タイマーおよびUIを初期化する
 */
async function startExecution() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  isFinished = false;
  activeStartTime = Date.now();
  activeEndTime = null;
  hopCount = 0;

  const startStr = new Date(activeStartTime).toLocaleString("ja-JP");
  tracerouteStartTime.textContent = startStr;
  tracerouteEndTime.textContent = "実行中...";
  tracerouteDuration.textContent = "0.0 秒";
  tracerouteHopCount.textContent = "0 ホップ";
  terminalStatusInfo.textContent = "リアルタイム探索中...";

  tracerouteStatusPill.className = "traceroute-status-pill running";
  tracerouteStatusText.textContent = "実行中 (ICMP)";

  btnStopTraceroute.disabled = false;
  btnRerunTraceroute.disabled = true;

  const headerNotice = `=== Traceroute (ICMP) 開始 ===\n対象: ${targetName} (${targetIp})\nプロトコル: ICMP (Echo Request)\nタイムアウト上限: ${timeoutSec} 秒\n開始時刻: ${startStr}\n----------------------------------------------------\n`;
  tracerouteTerminalCode.textContent = headerNotice;

  // 100msごとに経過秒数表示を更新
  timerInterval = window.setInterval(() => {
    if (!activeEndTime) {
      const elapsed = ((Date.now() - activeStartTime) / 1000).toFixed(1);
      tracerouteDuration.textContent = `${elapsed} 秒`;
    }
  }, 100);

  try {
    const startTimeTs = await invoke<number>("start_traceroute", {
      targetId,
      targetIp,
      timeoutSecs: timeoutSec,
    });
    activeStartTime = startTimeTs;
    tracerouteStartTime.textContent = new Date(startTimeTs).toLocaleString("ja-JP");
  } catch (err) {
    console.error("Failed to start traceroute:", err);
    showToast(`開始エラー: ${err}`, "error");
    handleFinished({
      target_id: targetId,
      success: false,
      end_time: Date.now(),
      summary: `開始エラー: ${err}`,
    });
  }
}

/**
 * バックエンドから受信したTracerouteログ1行をターミナルに追記・ホップ数解析
 */
function handleLine(event: TracerouteLineEvent) {
  if (event.target_id !== targetId) return;

  const line = event.line;
  tracerouteTerminalCode.textContent += line + "\n";
  tracerouteTerminalBody.scrollTop = tracerouteTerminalBody.scrollHeight;

  // ホップ番号行（例: "  1   <1 ms   <1 ms   <1 ms  192.168.1.1"）を検出してホップ数を更新
  const hopMatch = line.match(/^\s*(\d+)\s+/);
  if (hopMatch) {
    const num = parseInt(hopMatch[1], 10);
    if (!isNaN(num)) {
      hopCount = Math.max(hopCount, num);
      tracerouteHopCount.textContent = `${hopCount} ホップ`;
    }
  }
}

/**
 * Traceroute完了・中断・タイムアウト時の処理
 */
function handleFinished(event: TracerouteFinishEvent) {
  if (event.target_id !== targetId || isFinished) return;
  isFinished = true;

  activeEndTime = event.end_time;
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const durationSec = ((event.end_time - activeStartTime) / 1000).toFixed(1);
  const endStr = new Date(event.end_time).toLocaleString("ja-JP");
  tracerouteEndTime.textContent = endStr;
  tracerouteDuration.textContent = `${durationSec} 秒`;

  if (event.success) {
    tracerouteStatusPill.className = "traceroute-status-pill success";
    tracerouteStatusText.textContent = "完了 (正常)";
    terminalStatusInfo.textContent = "探索完了";
  } else {
    tracerouteStatusPill.className = "traceroute-status-pill stopped";
    tracerouteStatusText.textContent = event.summary.includes("タイムアウト")
      ? `タイムアウト (${timeoutSec}秒)`
      : "中断 / 終了";
    terminalStatusInfo.textContent = event.summary;
  }

  btnStopTraceroute.disabled = true;
  btnRerunTraceroute.disabled = false;

  const footerNotice = `----------------------------------------------------\n完了時刻: ${endStr} (所要時間: ${durationSec}秒)\n状態: ${event.summary}\n=== Traceroute (ICMP) 完了 ===\n`;
  tracerouteTerminalCode.textContent += footerNotice;
  tracerouteTerminalBody.scrollTop = tracerouteTerminalBody.scrollHeight;
}

/**
 * Traceroute実行ログを整形し、設定された保存先フォルダへファイル書き出しを行う
 */
async function saveResult() {
  const startStr = new Date(activeStartTime).toLocaleString("ja-JP");
  const endStr = activeEndTime
    ? new Date(activeEndTime).toLocaleString("ja-JP")
    : "未完了 (実行中)";
  const durationStr = activeEndTime
    ? `${((activeEndTime - activeStartTime) / 1000).toFixed(1)} 秒`
    : "--";

  const rawLogs = tracerouteTerminalCode.textContent || "";
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `traceroute_${targetIp.replace(/[^0-9a-zA-Z]/g, "_")}_${dateTag}.txt`;

  const report = [
    "================================================================",
    " NewPing Traceroute (ICMP) 実行レポート",
    "================================================================",
    `対象名称:       ${targetName}`,
    `IPアドレス:     ${targetIp}`,
    `プロトコル:     ICMP (Internet Control Message Protocol)`,
    `設定タイムアウト: ${timeoutSec} 秒`,
    `開始時刻:       ${startStr}`,
    `完了時刻:       ${endStr}`,
    `所要時間:       ${durationStr}`,
    `総ホップ数:     ${hopCount} ホップ`,
    "================================================================",
    "【ホップ経路・探索ログ】",
    "----------------------------------------------------------------",
    rawLogs,
    "================================================================",
  ].join("\r\n");

  // メイン設定から保存先フォルダを取得（初期値: result）
  const saveDir = localStorage.getItem("ping_save_dir") || "result";

  try {
    const savedPath = await invoke<string>("save_traceroute_file", {
      filename,
      content: report,
      saveDir,
    });
    showToast(`Traceroute結果を保存しました (${filename})\n保存先: ${savedPath}`, "success");
    console.log("Saved traceroute to:", savedPath);
  } catch (err) {
    console.warn("Tauri file save failed, falling back to download:", err);
    try {
      const blob = new Blob([report], { type: "text/plain;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Traceroute結果をダウンロードしました (${filename})`, "success");
    } catch (e) {
      showToast(`保存失敗: ${err}`, "error");
    }
  }
}

// ------------------------------------------------------------------------------
// イベントリスナー登録
// ------------------------------------------------------------------------------

// 中止ボタン
btnStopTraceroute.addEventListener("click", async () => {
  try {
    await invoke("stop_traceroute", { targetId });
    showToast("Tracerouteを中止しました", "info");
  } catch (err) {
    console.error("Stop error:", err);
  }
});

// 再実行ボタン
btnRerunTraceroute.addEventListener("click", () => {
  startExecution();
});

// ログコピーボタン
btnCopyTraceroute.addEventListener("click", () => {
  const text = tracerouteTerminalCode.textContent || "";
  navigator.clipboard.writeText(text);
  showToast("Tracerouteログをクリップボードにコピーしました", "info");
});

// 結果保存ボタン
btnSaveTraceroute.addEventListener("click", saveResult);

// ウィンドウを閉じるボタン
btnCloseWindow.addEventListener("click", async () => {
  try {
    await invoke("close_window");
  } catch (err) {
    try {
      const win = getCurrentWebviewWindow();
      await win.close();
    } catch (e) {
      console.error("Window close failed:", e);
    }
  }
});

// ウィンドウを閉じる直前に未完了ならプロセスを停止
window.addEventListener("beforeunload", () => {
  if (!isFinished) {
    invoke("stop_traceroute", { targetId }).catch(() => {});
  }
});

/**
 * 初期化関数（DOMContentLoaded時に実行）
 */
async function init() {
  initTheme();

  tracerouteTargetName.textContent = targetName;
  tracerouteTargetIp.textContent = targetIp;
  tracerouteTimeoutBadge.textContent = `タイムアウト: ${timeoutSec}秒`;
  document.title = `Traceroute - ${targetName} (${targetIp})`;

  // バックエンドからの行受信イベントを購読
  await listen<TracerouteLineEvent>("traceroute-line", (event) => {
    handleLine(event.payload);
  });

  // バックエンドからの完了イベントを購読
  await listen<TracerouteFinishEvent>("traceroute-finish", (event) => {
    handleFinished(event.payload);
  });

  // 探索開始
  startExecution();
}

window.addEventListener("DOMContentLoaded", init);

