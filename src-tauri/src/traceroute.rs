//! ==============================================================================
//! Pingツール (NewPing) - Traceroute 実行＆一括管理モジュール (traceroute.rs)
//! ==============================================================================
//! 
//! 本モジュールは、指定ホストへのTraceroute（経路探索）の個別実行および
//! 全監視対象への非同期並行一括Traceroute実行・進捗イベント通知・結果ファイル保存を提供します。
//! 
//! 主な機能:
//! - 個別Tracerouteプロセスの非同期実行とリアルタイム行単位ストリーミング (`traceroute-line`)
//! - 全対象への並行一括Traceroute実行と進捗通知 (`batch-traceroute-progress`)
//! - タイムアウトおよびユーザーキャンセル制御
//! - 探索結果レポートテキストの自動生成および指定保存先フォルダへの保存 (`save_traceroute_file`)
//! - Windows (`tracert`) / 非Windows (`traceroute`) のマルチプラットフォーム対応
//! - Shift_JIS / UTF-8 の文字コード自動判別デコード

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use parking_lot::Mutex;
use tauri::Emitter;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use crate::pinger::PingTarget;

/// 個別Traceroute実行時の1行ログイベント
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TracerouteLineEvent {
    /// 対象ターゲットID
    pub target_id: String,
    /// 取得したログ出力行
    pub line: String,
    /// 受信UNIXタイムスタンプ(ミリ秒)
    pub timestamp: u64,
}

/// 個別Traceroute完了イベント
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TracerouteFinishEvent {
    /// 対象ターゲットID
    pub target_id: String,
    /// 完了状態（true: 正常完了 / false: 中断・エラー・タイムアウト）
    pub success: bool,
    /// 完了UNIXタイムスタンプ(ミリ秒)
    pub end_time: u64,
    /// 完了メッセージ概要
    pub summary: String,
}

/// 一括Tracerouteの進捗通知イベント
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BatchTracerouteProgressEvent {
    /// 完了済みターゲット数
    pub completed_count: usize,
    /// 監視対象の全ターゲット数
    pub total_count: usize,
    /// 直前に完了したターゲット名称
    pub target_name: String,
    /// 直前に完了したターゲットIP
    pub target_ip: String,
    /// そのターゲットの成否
    pub success: bool,
}

/// 一括Tracerouteの最終集計結果データ
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BatchTracerouteResult {
    /// 開始UNIXタイムスタンプ(ミリ秒)
    pub start_time: u64,
    /// 終了UNIXタイムスタンプ(ミリ秒)
    pub end_time: u64,
    /// 総所要時間(秒)
    pub duration_sec: f64,
    /// 対象総数
    pub total_targets: usize,
    /// 成功件数
    pub success_count: usize,
    /// 失敗/タイムアウト件数
    pub failed_count: usize,
    /// 保存された結果レポートファイルの絶対パス
    pub file_path: String,
    /// 保存されたファイル名
    pub filename: String,
}

/// 実行中のTracerouteタスク管理およびキャンセルマネージャー
pub struct TracerouteManager {
    /// 個別Tracerouteタスクの停止シグナル送信チャネルマップ
    tasks: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    /// 一括Tracerouteタスク全体の停止シグナル送信チャネル
    batch_cancel: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

impl TracerouteManager {
    /// 新規マネージャーインスタンスを生成
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            batch_cancel: Mutex::new(None),
        }
    }

    /// 指定ターゲットIDの個別Tracerouteを中止
    pub fn cancel(&self, target_id: &str) {
        if let Some(tx) = self.tasks.lock().remove(target_id) {
            let _ = tx.send(());
        }
    }

    /// 実行中の一括Traceroute全体を中止
    pub fn cancel_batch(&self) {
        if let Some(tx) = self.batch_cancel.lock().take() {
            let _ = tx.send(true);
        }
    }
}

/// 現在時刻のUNIXエポックミリ秒を取得
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// プロセス標準出力を UTF-8 または Shift_JIS (CP932) としてデコード
fn decode_bytes(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        s.to_string()
    } else {
        let (cow, _, _) = encoding_rs::SHIFT_JIS.decode(bytes);
        cow.into_owned()
    }
}

/// 個別ターゲットへのTracerouteを開始するコマンド
#[tauri::command]
pub async fn start_traceroute(
    target_id: String,
    target_ip: String,
    timeout_secs: Option<u64>,
    app_handle: tauri::AppHandle,
    mgr: tauri::State<'_, Arc<TracerouteManager>>,
) -> Result<u64, String> {
    // 既に実行中のタスクがあればキャンセル
    mgr.cancel(&target_id);

    let start_time = now_millis();
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
    mgr.tasks.lock().insert(target_id.clone(), stop_tx);

    let t_id = target_id.clone();
    let t_ip = target_ip.trim().to_string();
    let app_h = app_handle.clone();
    let mgr_clone = mgr.inner().clone();
    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(60).clamp(10, 300));

    tokio::spawn(async move {
        #[cfg(windows)]
        let mut cmd = {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = Command::new("tracert");
            c.args(&["-d", "-h", "30", "-w", "2000", &t_ip]);
            c.creation_flags(CREATE_NO_WINDOW);
            c
        };

        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("traceroute");
            c.args(&["-n", "-m", "30", "-w", "2", &t_ip]);
            c
        };

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_h.emit(
                    "traceroute-finish",
                    TracerouteFinishEvent {
                        target_id: t_id.clone(),
                        success: false,
                        end_time: now_millis(),
                        summary: format!("Tracerouteプロセスの起動に失敗しました: {}", e),
                    },
                );
                mgr_clone.tasks.lock().remove(&t_id);
                return;
            }
        };

        let stdout = child.stdout.take();
        let timeout_sleep = tokio::time::sleep(timeout_duration);
        tokio::pin!(timeout_sleep);

        let mut hit_timeout = false;
        let mut user_stopped = false;

        if let Some(stdout) = stdout {
            let mut reader = tokio::io::BufReader::new(stdout);
            let mut raw_buf = Vec::new();

            loop {
                raw_buf.clear();
                tokio::select! {
                    _ = &mut stop_rx => {
                        let _ = child.kill().await;
                        user_stopped = true;
                        break;
                    }
                    _ = &mut timeout_sleep => {
                        let _ = child.kill().await;
                        hit_timeout = true;
                        break;
                    }
                    res = reader.read_until(b'\n', &mut raw_buf) => {
                        match res {
                            Ok(0) => break, // EOF
                            Ok(_) => {
                                let line_str = decode_bytes(&raw_buf);
                                let trimmed = line_str.trim_end_matches(&['\r', '\n'][..]).to_string();
                                if !trimmed.is_empty() {
                                    let _ = app_h.emit(
                                        "traceroute-line",
                                        TracerouteLineEvent {
                                            target_id: t_id.clone(),
                                            line: trimmed,
                                            timestamp: now_millis(),
                                        },
                                    );
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }

        let _ = child.wait().await;
        mgr_clone.tasks.lock().remove(&t_id);

        let (success, summary) = if user_stopped {
            (false, "ユーザーによって中断されました".to_string())
        } else if hit_timeout {
            let _ = app_h.emit(
                "traceroute-line",
                TracerouteLineEvent {
                    target_id: t_id.clone(),
                    line: format!("※ 設定されたタイムアウト時間（{}秒）を超過したため終了しました", timeout_duration.as_secs()),
                    timestamp: now_millis(),
                },
            );
            (false, format!("タイムアウト（{}秒）により終了", timeout_duration.as_secs()))
        } else {
            (true, "Tracerouteが完了しました".to_string())
        };

        let _ = app_h.emit(
            "traceroute-finish",
            TracerouteFinishEvent {
                target_id: t_id,
                success,
                end_time: now_millis(),
                summary,
            },
        );
    });

    Ok(start_time)
}

/// 指定ターゲットの個別Tracerouteを中止するコマンド
#[tauri::command]
pub fn stop_traceroute(
    target_id: String,
    mgr: tauri::State<'_, Arc<TracerouteManager>>,
) -> Result<(), String> {
    mgr.cancel(&target_id);
    Ok(())
}

/// 実行中の一括Tracerouteを中止するコマンド
#[tauri::command]
pub fn stop_batch_traceroute(
    mgr: tauri::State<'_, Arc<TracerouteManager>>,
) -> Result<(), String> {
    mgr.cancel_batch();
    Ok(())
}

/// 一括Traceroute内の単一ターゲット出力データ
struct SingleTargetOutput {
    target: PingTarget,
    start_time: u64,
    end_time: u64,
    success: bool,
    lines: Vec<String>,
    status_summary: String,
}

/// 全監視対象へ並行してTracerouteを一括実行し、結果を1つのテキストファイルにまとめて保存するコマンド
#[tauri::command]
pub async fn start_batch_traceroute(
    targets: Vec<PingTarget>,
    timeout_secs: Option<u64>,
    save_dir: Option<String>,
    app_handle: tauri::AppHandle,
    mgr: tauri::State<'_, Arc<TracerouteManager>>,
) -> Result<BatchTracerouteResult, String> {
    if targets.is_empty() {
        return Err("Traceroute対象が設定されていません".into());
    }

    // 既に実行中のバッチがあればキャンセル
    mgr.cancel_batch();

    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    *mgr.batch_cancel.lock() = Some(stop_tx);

    let batch_start_time = now_millis();
    let timeout_sec = timeout_secs.unwrap_or(60).clamp(10, 300);
    let total_count = targets.len();

    let completed_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let mut handles = Vec::with_capacity(targets.len());

    // 各ターゲットに対して非同期タスクを生成して並行実行
    for target in targets.iter() {
        let t = target.clone();
        let mut t_stop_rx = stop_rx.clone();
        let app_h = app_handle.clone();
        let counter = completed_counter.clone();

        let handle = tokio::spawn(async move {
            let t_start = now_millis();
            let t_ip = t.ip.trim().to_string();

            #[cfg(windows)]
            let mut cmd = {
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let mut c = Command::new("tracert");
                // -d: 名前解決なし, -h 30: 最大30ホップ, -w 2000: タイムアウト2000ms
                c.args(&["-d", "-h", "30", "-w", "2000", &t_ip]);
                c.creation_flags(CREATE_NO_WINDOW);
                c
            };

            #[cfg(not(windows))]
            let mut cmd = {
                let mut c = Command::new("traceroute");
                c.args(&["-n", "-m", "30", "-w", "2", &t_ip]);
                c
            };

            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            let mut lines = Vec::new();
            let success;
            let status_summary;

            match cmd.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take();
                    let timeout_sleep = tokio::time::sleep(Duration::from_secs(timeout_sec));
                    tokio::pin!(timeout_sleep);

                    let mut hit_timeout = false;
                    let mut user_stopped = false;

                    if let Some(stdout) = stdout {
                        let mut reader = tokio::io::BufReader::new(stdout);
                        let mut raw_buf = Vec::new();

                        loop {
                            raw_buf.clear();
                            tokio::select! {
                                _ = t_stop_rx.changed() => {
                                    if *t_stop_rx.borrow() {
                                        let _ = child.kill().await;
                                        user_stopped = true;
                                        break;
                                    }
                                }
                                _ = &mut timeout_sleep => {
                                    let _ = child.kill().await;
                                    hit_timeout = true;
                                    break;
                                }
                                res = reader.read_until(b'\n', &mut raw_buf) => {
                                    match res {
                                        Ok(0) => break, // EOF
                                        Ok(_) => {
                                            let line_str = decode_bytes(&raw_buf);
                                            let trimmed = line_str.trim_end_matches(&['\r', '\n'][..]).to_string();
                                            if !trimmed.is_empty() {
                                                lines.push(trimmed);
                                            }
                                        }
                                        Err(_) => break,
                                    }
                                }
                            }
                        }
                    }

                    let _ = child.wait().await;

                    if user_stopped {
                        success = false;
                        status_summary = "ユーザー中断".to_string();
                        lines.push("※ ユーザーによって一括Tracerouteが中断されました".to_string());
                    } else if hit_timeout {
                        success = false;
                        status_summary = format!("タイムアウト ({}秒)", timeout_sec);
                        lines.push(format!("※ 設定タイムアウト時間（{}秒）を超過したため強制終了しました", timeout_sec));
                    } else {
                        success = true;
                        status_summary = "完了 (正常)".to_string();
                    }
                }
                Err(e) => {
                    success = false;
                    status_summary = format!("起動失敗: {}", e);
                    lines.push(format!("※ プロセス起動失敗: {}", e));
                }
            }

            let t_end = now_millis();
            let c_done = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

            // 1件完了するごとに進捗イベントをフロントエンドへ発火
            let _ = app_h.emit(
                "batch-traceroute-progress",
                BatchTracerouteProgressEvent {
                    completed_count: c_done,
                    total_count,
                    target_name: t.name.clone(),
                    target_ip: t.ip.clone(),
                    success,
                },
            );

            SingleTargetOutput {
                target: t,
                start_time: t_start,
                end_time: t_end,
                success,
                lines,
                status_summary,
            }
        });

        handles.push(handle);
    }

    // Ping対象リストの元の登録順序を維持して結果を収集
    let mut outputs: Vec<SingleTargetOutput> = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(output) = handle.await {
            outputs.push(output);
        }
    }

    let batch_end_time = now_millis();
    let duration_sec = ((batch_end_time - batch_start_time) as f64) / 1000.0;
    let success_count = outputs.iter().filter(|o| o.success).count();
    let failed_count = outputs.len() - success_count;

    // 統合レポートテキストを構築
    let start_date_str = format_timestamp(batch_start_time);
    let end_date_str = format_timestamp(batch_end_time);

    let mut report = Vec::new();
    report.push("================================================================================".to_string());
    report.push("                  NewPing Traceroute 一括実行レポート (並行実行)".to_string());
    report.push("================================================================================".to_string());
    report.push(format!("一括実行開始時刻:   {}", start_date_str));
    report.push(format!("全対象完了時刻:     {}", end_date_str));
    report.push(format!("総所要時間:         {:.1} 秒", duration_sec));
    report.push(format!("Tracerouteタイムアウト: {} 秒", timeout_sec));
    report.push(format!("監視対象総数:       {} 件 (成功: {} 件 / 中断・タイムアウト: {} 件)", total_count, success_count, failed_count));
    report.push("================================================================================".to_string());
    report.push("".to_string());

    for (idx, out) in outputs.iter().enumerate() {
        let t_start_str = format_timestamp(out.start_time);
        let t_end_str = format_timestamp(out.end_time);
        let t_dur_sec = ((out.end_time.saturating_sub(out.start_time)) as f64) / 1000.0;

        report.push(format!("--------------------------------------------------------------------------------"));
        report.push(format!("[No.{}] 対象: {} ({})", idx + 1, out.target.name, out.target.ip));
        report.push(format!("状態: {} | 開始: {} | 完了: {} | 所要時間: {:.1}秒", out.status_summary, t_start_str, t_end_str, t_dur_sec));
        report.push(format!("--------------------------------------------------------------------------------"));
        if out.lines.is_empty() {
            report.push("(出力ログなし)".to_string());
        } else {
            for line in &out.lines {
                report.push(line.clone());
            }
        }
        report.push("".to_string());
    }

    report.push("================================================================================".to_string());
    report.push("                        一括 Traceroute 完了".to_string());
    report.push("================================================================================".to_string());

    let report_content = report.join("\r\n");

    // 出力ファイル名を生成して保存（指定保存先フォルダへ書き込み、なければフォルダ自動作成）
    let filename = format!("traceroute_batch_{}.txt", format_timestamp_filename(batch_start_time));
    let file_path = save_traceroute_file(filename.clone(), report_content, save_dir)?;

    Ok(BatchTracerouteResult {
        start_time: batch_start_time,
        end_time: batch_end_time,
        duration_sec,
        total_targets: total_count,
        success_count,
        failed_count,
        file_path,
        filename,
    })
}

/// タイムスタンプ(ミリ秒)を表示用日時文字列 (YYYY-MM-DD HH:MM:SS) にフォーマット
fn format_timestamp(millis: u64) -> String {
    let secs = millis / 1000;
    chrono_offset(secs)
}

/// タイムスタンプ(ミリ秒)をファイル名用文字列 (YYYYMMDDHHMMSS) にフォーマット
fn format_timestamp_filename(millis: u64) -> String {
    let secs = millis / 1000;
    let dt = chrono_offset(secs);
    dt.replace(['-', ':', ' '], "")
}

/// エポック秒から日付・時刻文字列を生成
fn chrono_offset(secs: u64) -> String {
    let s = secs as i64;
    let days = s / 86400;
    let rem = s % 86400;
    let hours = rem / 3600;
    let rem2 = rem % 3600;
    let minutes = rem2 / 60;
    let seconds = rem2 % 60;

    let (year, month, day) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", year, month, day, hours, minutes, seconds)
}

/// 経過日数から年月日(Y, M, D)を算出するアルゴリズム
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z / 146097 } else { (z - 146096) / 146097 };
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let final_y = if m <= 2 { y + 1 } else { y };
    (final_y as i32, m, d)
}

/// Traceroute実行結果ファイルを指定保存先フォルダへ書き込むコマンド（フォルダがなければ自動作成）
#[tauri::command]
pub fn save_traceroute_file(filename: String, content: String, save_dir: Option<String>) -> Result<String, String> {
    let target_dir = crate::resolve_save_dir(save_dir.as_deref());
    if !target_dir.exists() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("保存先フォルダの作成に失敗しました ({}): {}", target_dir.display(), e))?;
    }
    let save_path = target_dir.join(&filename);
    std::fs::write(&save_path, content.as_bytes())
        .map_err(|e| format!("ファイル保存に失敗しました: {}", e))?;
    Ok(save_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_timestamp() {
        let ts = 1700000000000; // 2023-11-14 22:13:20 UTC
        let formatted = format_timestamp(ts);
        assert_eq!(formatted, "2023-11-14 22:13:20");
    }

    #[test]
    fn test_format_timestamp_filename() {
        let ts = 1700000000000;
        let formatted = format_timestamp_filename(ts);
        assert_eq!(formatted, "20231114221320");
    }

    #[test]
    fn test_traceroute_manager_cancel() {
        let mgr = TracerouteManager::new();
        mgr.cancel("non-existent");
        mgr.cancel_batch();
    }
}
