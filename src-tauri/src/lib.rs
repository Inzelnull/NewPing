//! ==============================================================================
//! Pingツール (NewPing) - バックエンドコアモジュール (lib.rs)
//! ==============================================================================
//! 
//! 本モジュールは、Tauri v2 によるデスクトップアプリケーションのコアバックエンドです。
//! 以下の機能を提供・管理します:
//! 
//! 1. 設定ファイル管理 (`ping-list.config`, `ping-parameters.conf`)
//! 2. 結果保存先フォルダの自動解決・作成・選択・エクスプローラー連携
//! 3. 非同期並行 ICMP Ping ループの管理（ディレイ、タイムアウト、パケット自動縮小等）
//! 4. Ping統計データのCSVファイル保存
//! 5. システムトレイ常駐、最小化/復元、点滅アニメーション
//! 6. Tracerouteウィンドウの生成および一括Tracerouteの呼び出し

mod pinger;
mod traceroute;

use parking_lot::Mutex;
use pinger::{ping_host, PingResult, PingTarget};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tokio::sync::watch;
use traceroute::{
    save_traceroute_file, start_batch_traceroute, start_traceroute, stop_batch_traceroute,
    stop_traceroute, TracerouteManager,
};

/// 監視対象リスト設定ファイル名
const CONFIG_FILE_NAME: &str = "ping-list.config";
/// パラメータ設定ファイル名
const PARAMETERS_CONFIG_FILE_NAME: &str = "ping-parameters.conf";

/// アプリケーション共有状態
struct AppState {
    /// Ping監視が現在実行中かどうかを示すアトミックフラグ
    is_running: Arc<AtomicBool>,
    /// 実行中のPing非同期ループを停止するための通知チャネル送信側
    stop_tx: Mutex<Option<watch::Sender<bool>>>,
}

/// アプリケーションの基準ディレクトリ（実行ファイル所在フォルダまたはカレントディレクトリ）を取得
pub fn get_app_base_dir() -> PathBuf {
    if let Ok(mut exe_dir) = std::env::current_exe() {
        exe_dir.pop();
        if let Ok(curr_dir) = std::env::current_dir() {
            // 開発時の target/debug 実行時はプロジェクトルート(curr_dir)を優先
            if exe_dir.to_string_lossy().contains("target") {
                return curr_dir;
            }
        }
        return exe_dir;
    }
    if let Ok(curr_dir) = std::env::current_dir() {
        return curr_dir;
    }
    PathBuf::from(".")
}

/// 指定された保存先フォルダパスを解決（相対パスならツール配下、絶対パスならそのまま、未指定なら 'result'）
pub fn resolve_save_dir(custom_dir: Option<&str>) -> PathBuf {
    let base_dir = get_app_base_dir();
    match custom_dir {
        Some(d) if !d.trim().is_empty() => {
            let path = PathBuf::from(d.trim());
            if path.is_absolute() {
                path
            } else {
                base_dir.join(path)
            }
        }
        _ => base_dir.join("result"),
    }
}

/// ping-list.config のファイルパスを取得
fn get_config_path() -> PathBuf {
    let base_dir = get_app_base_dir();
    let path = base_dir.join(CONFIG_FILE_NAME);
    if path.exists() {
        return path;
    }
    PathBuf::from(CONFIG_FILE_NAME)
}

/// ping-list.config の内容を読み込む
#[tauri::command]
fn load_config() -> Result<String, String> {
    let path = get_config_path();
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))
    } else {
        Ok(String::new())
    }
}

/// ping-list.config が存在するかチェック
#[tauri::command]
fn config_exists() -> bool {
    get_config_path().exists()
}

/// ping-list.config を保存
#[tauri::command]
fn save_config(content: String) -> Result<(), String> {
    let path = get_config_path();
    fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
}

/// ping-parameters.conf のファイルパスを取得
fn get_parameters_config_path() -> PathBuf {
    let base_dir = get_app_base_dir();
    let path = base_dir.join(PARAMETERS_CONFIG_FILE_NAME);
    if path.exists() {
        return path;
    }
    PathBuf::from(PARAMETERS_CONFIG_FILE_NAME)
}

/// ping-parameters.conf の内容を読み込む
#[tauri::command]
fn load_parameters_config() -> Result<String, String> {
    let path = get_parameters_config_path();
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("Failed to read parameters config: {}", e))
    } else {
        Ok(String::new())
    }
}

/// ping-parameters.conf が存在するかチェック
#[tauri::command]
fn parameters_config_exists() -> bool {
    get_parameters_config_path().exists()
}

/// ping-parameters.conf を保存
#[tauri::command]
fn save_parameters_config(content: String) -> Result<(), String> {
    let path = get_parameters_config_path();
    fs::write(&path, content).map_err(|e| format!("Failed to write parameters config: {}", e))
}

// ------------------------------------------------------------------------------
// システムトレイアイコン・状態管理
// ------------------------------------------------------------------------------
const TRAY_ID: &str = "main-tray";
const TRAY_TOOLTIP_IDLE: &str = "Pingツール - 停止中 (待機中)";
const TRAY_TOOLTIP_RUNNING: &str = "Pingツール - 実行中 (Ping監視中)";

/// 停止中（アイドル時）のグレートレイアイコン画像
fn get_tray_idle_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-idle.png")).expect("idle icon")
}

/// 実行中アニメーション用の緑色トレイアイコン画像
fn get_tray_running_green_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-running-green.png")).expect("running green icon")
}

/// 実行中アニメーション用の赤色トレイアイコン画像
fn get_tray_running_red_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-running-red.png")).expect("running red icon")
}

/// システムトレイアイコンおよびツールチップの表示状態を更新
fn update_tray_state(app_handle: &tauri::AppHandle, running: bool) {
    if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
        if running {
            let _ = tray.set_icon(Some(get_tray_running_green_icon()));
            let _ = tray.set_tooltip(Some(TRAY_TOOLTIP_RUNNING));
        } else {
            let _ = tray.set_icon(Some(get_tray_idle_icon()));
            let _ = tray.set_tooltip(Some(TRAY_TOOLTIP_IDLE));
        }
    }
}

/// Ping監視が現在実行中かどうかを確認するコマンド
#[tauri::command]
fn is_pinging(state: State<'_, AppState>) -> bool {
    state.is_running.load(Ordering::SeqCst)
}

/// Ping監視を停止するコマンド
#[tauri::command]
async fn stop_ping(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // 停止チャネルへ通知を送信してループを終了させる
    if let Some(tx) = state.stop_tx.lock().take() {
        let _ = tx.send(true);
    }
    state.is_running.store(false, Ordering::SeqCst);
    update_tray_state(&app_handle, false);
    Ok(())
}

/// Ping監視を開始するコマンド
/// 
/// 指定されたターゲットリスト、間隔、タイムアウト、ディレイ、パケットサイズ等のパラメータに基づいて
/// 非同期Pingワーカータスクを起動し、定期的に結果をフロントエンドへ `ping-result` イベントで送信します。
#[tauri::command]
async fn start_ping(
    targets: Vec<PingTarget>,
    interval_ms: Option<u64>,
    timeout_ms: Option<u32>,
    delay_ms: Option<u64>,
    packet_size: Option<u32>,
    auto_decrease_size: Option<bool>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 既に実行中のPingタスクがあれば停止通知を送る
    if let Some(tx) = state.stop_tx.lock().take() {
        let _ = tx.send(true);
    }

    if targets.is_empty() {
        state.is_running.store(false, Ordering::SeqCst);
        update_tray_state(&app_handle, false);
        return Err("No targets configured".into());
    }

    // 停止シグナル用の watch チャネルを生成
    let (stop_tx, mut stop_rx) = watch::channel(false);
    *state.stop_tx.lock() = Some(stop_tx);
    state.is_running.store(true, Ordering::SeqCst);
    update_tray_state(&app_handle, true);

    // トレイアイコン点滅タスク（実行中は緑と赤を600ms間隔で交互に切り替え）
    let tray_app_handle = app_handle.clone();
    let mut tray_stop_rx = stop_rx.clone();
    tokio::spawn(async move {
        let mut show_green = true;
        let mut blink_interval = tokio::time::interval(tokio::time::Duration::from_millis(600));
        blink_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = tray_stop_rx.changed() => {
                    if *tray_stop_rx.borrow() {
                        break;
                    }
                }
                _ = blink_interval.tick() => {
                    if let Some(tray) = tray_app_handle.tray_by_id(TRAY_ID) {
                        let icon = if show_green {
                            get_tray_running_green_icon()
                        } else {
                            get_tray_running_red_icon()
                        };
                        let _ = tray.set_icon(Some(icon));
                        let _ = tray.set_tooltip(Some(TRAY_TOOLTIP_RUNNING));
                        show_green = !show_green;
                    }
                }
            }
        }

        // 停止時はグレートレイアイコンに戻す
        if let Some(tray) = tray_app_handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_icon(Some(get_tray_idle_icon()));
            let _ = tray.set_tooltip(Some(TRAY_TOOLTIP_IDLE));
        }
    });

    let is_running_clone = state.is_running.clone();
    let app_handle_clone = app_handle.clone();
    let interval_val = interval_ms.unwrap_or(1000).max(100);
    let timeout_val = timeout_ms.unwrap_or(1000).max(50);
    let delay_val = delay_ms.unwrap_or(50).min(1000);
    let initial_packet_size = packet_size.unwrap_or(32).clamp(32, 10000);
    let auto_decrease = auto_decrease_size.unwrap_or(false);

    // メインのPing実行ループタスク
    tokio::spawn(async move {
        let mut current_packet_size = initial_packet_size;
        let mut all_ok_reached = false;
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(interval_val));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // ターゲットごとの連続NG回数カウント
        let mut consecutive_ng_counts: Vec<u32> = vec![0; targets.len()];

        loop {
            tokio::select! {
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    let round_packet_size = current_packet_size;
                    let round_is_adjusting = auto_decrease && !all_ok_reached;
                    let mut handles = Vec::with_capacity(targets.len());

                    // 全監視対象へPingを非同期並行送信
                    for (idx, target) in targets.iter().enumerate() {
                        let t_id = target.id.clone();
                        let t_ip = target.ip.clone();
                        let ip_for_res = target.ip.clone();
                        let app_h = app_handle.clone();
                        let mut task_stop_rx = stop_rx.clone();
                        let target_delay = if delay_val > 0 { idx as u64 * delay_val } else { 0 };

                        let handle = tokio::spawn(async move {
                            // 設定されたディレイ（時間差）だけ待機
                            if target_delay > 0 {
                                tokio::select! {
                                    _ = task_stop_rx.changed() => {
                                        if *task_stop_rx.borrow() {
                                            return (idx, false);
                                        }
                                    }
                                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(target_delay)) => {}
                                }
                            }

                            if *task_stop_rx.borrow() {
                                return (idx, false);
                            }

                            // ブロッキングICMP API呼び出しをワーカースレッドで実行
                            let (success, rtt_ms) = tokio::task::spawn_blocking(move || {
                                ping_host(&t_ip, timeout_val, round_packet_size)
                            })
                            .await
                            .unwrap_or((false, None));

                            if !*task_stop_rx.borrow() {
                                let now_ts = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64;

                                let result = PingResult {
                                    id: t_id,
                                    ip: ip_for_res,
                                    success,
                                    rtt_ms,
                                    timestamp: now_ts,
                                    packet_size: round_packet_size,
                                    is_adjusting: round_is_adjusting,
                                };
                                // フロントエンドへ結果を通知
                                let _ = app_h.emit("ping-result", result);
                            }

                            (idx, success)
                        });
                        handles.push(handle);
                    }

                    // この回の全ターゲットPing完了を待機して連続NG状態を集計
                    let mut round_has_ng = false;
                    for handle in handles {
                        if let Ok((idx, success)) = handle.await {
                            if success {
                                consecutive_ng_counts[idx] = 0;
                            } else {
                                consecutive_ng_counts[idx] += 1;
                                round_has_ng = true;
                            }
                        }
                    }

                    if *stop_rx.borrow() {
                        break;
                    }

                    if !round_has_ng {
                        all_ok_reached = true;
                    } else if auto_decrease && current_packet_size > 32 {
                        // いずれかの対象で3回以上連続NGが発生した場合、パケットサイズを1バイトずつ縮小
                        let any_three_consecutive_ng = consecutive_ng_counts.iter().any(|&c| c >= 3);
                        if any_three_consecutive_ng {
                            current_packet_size = current_packet_size.saturating_sub(1).max(32);
                            let _ = app_handle.emit("packet-size-changed", current_packet_size);
                        }
                    }
                }
            }
        }
        is_running_clone.store(false, Ordering::SeqCst);
        update_tray_state(&app_handle_clone, false);
    });

    Ok(())
}

/// デフォルトの結果保存先フォルダパスを取得するコマンド
#[tauri::command]
fn get_default_save_dir() -> Result<String, String> {
    Ok(resolve_save_dir(None).to_string_lossy().to_string())
}

/// Ping統計CSVファイルを指定保存先フォルダへ書き込むコマンド（フォルダがなければ自動作成）
#[tauri::command]
fn save_stats_file(filename: String, content: String, save_dir: Option<String>) -> Result<String, String> {
    let target_dir = resolve_save_dir(save_dir.as_deref());
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("保存先フォルダの作成に失敗しました ({}): {}", target_dir.display(), e))?;
    }
    let save_path = target_dir.join(&filename);
    fs::write(&save_path, content.as_bytes()).map_err(|e| format!("ファイル保存に失敗しました: {}", e))?;
    Ok(save_path.to_string_lossy().to_string())
}

/// Windowsネイティブのフォルダ選択ダイアログを開き、ユーザーが選択したフォルダパスを返すコマンド
#[tauri::command]
async fn select_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let initial_dir = match default_path {
            Some(d) if !d.trim().is_empty() => resolve_save_dir(Some(&d)).to_string_lossy().to_string(),
            _ => resolve_save_dir(None).to_string_lossy().to_string(),
        };

        #[cfg(target_os = "windows")]
        {
            let script = format!(
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; \
                 $f = New-Object System.Windows.Forms.FolderBrowserDialog; \
                 $f.Description = '結果保存先フォルダを選択してください'; \
                 $f.SelectedPath = '{}'; \
                 $f.ShowNewFolderButton = $true; \
                 if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
                     Write-Output $f.SelectedPath \
                 }}",
                initial_dir.replace('\'', "''")
            );

            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output()
                .map_err(|e| format!("フォルダ選択ダイアログの起動に失敗しました: {}", e))?;

            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if path_str.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(path_str))
                }
            } else {
                let err_str = String::from_utf8_lossy(&output.stderr);
                Err(format!("フォルダ選択に失敗しました: {}", err_str))
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(None)
        }
    })
    .await
    .unwrap_or_else(|e| Err(format!("タスクエラー: {}", e)))
}

/// 指定フォルダ（またはツール配下の保存フォルダ）をOS標準のエクスプローラーで開くコマンド
#[tauri::command]
fn open_folder(path: Option<String>) -> Result<(), String> {
    let target_dir = resolve_save_dir(path.as_deref());
    if !target_dir.exists() {
        let _ = fs::create_dir_all(&target_dir);
    }
    let path_to_open = if target_dir.exists() {
        target_dir
    } else {
        get_app_base_dir()
    };

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(path_to_open)
            .spawn()
            .map_err(|e| format!("エクスプローラーの起動に失敗しました: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("open")
            .arg(path_to_open)
            .spawn()
            .map_err(|e| format!("フォルダを開くのに失敗しました: {}", e))?;
    }
    Ok(())
}

/// アプリケーションを完全終了するコマンド
#[tauri::command]
fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// URLエンコードヘルパー関数（Webviewクエリパラメータ生成用）
fn url_encode(input: &str) -> String {
    let mut result = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", b));
            }
        }
    }
    result
}

/// 個別ターゲット用のTracerouteサブウィンドウを新規作成・表示するコマンド
#[tauri::command]
async fn open_traceroute_window(
    target_id: String,
    target_ip: String,
    target_name: String,
    timeout_secs: Option<u64>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let sanitized_id = target_id.replace(|c: char| !c.is_alphanumeric() && c != '-', "_");
    let window_label = format!("tr-{}", sanitized_id);

    // 既にウィンドウが開いていればフォーカスを当てる
    if let Some(existing) = app_handle.get_webview_window(&window_label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let timeout_val = timeout_secs.unwrap_or(60).clamp(10, 300);
    let query = format!(
        "id={}&ip={}&name={}&timeout={}",
        url_encode(&target_id),
        url_encode(&target_ip),
        url_encode(&target_name),
        timeout_val
    );
    let url = format!("traceroute.html?{}", query);

    let title = format!("Traceroute - {} ({})", target_name, target_ip);
    let _window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(&title)
    .inner_size(760.0, 600.0)
    .min_inner_size(500.0, 400.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| format!("Tracerouteウィンドウの作成に失敗しました: {}", e))?;

    Ok(())
}

/// 指定ウィンドウを閉じるコマンド
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| format!("ウィンドウを閉じるのに失敗しました: {}", e))
}

/// Tauri アプリケーション初期化・メインループ実行エントリ関数
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        is_running: Arc::new(AtomicBool::new(false)),
        stop_tx: Mutex::new(None),
    };

    tauri::Builder::default()
        .manage(app_state)
        .manage(Arc::new(TracerouteManager::new()))
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            // システムトレイメニューの構築
            let show_i = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
            let start_ping_i = MenuItem::with_id(app, "tray_start_ping", "Ping監視開始", true, None::<&str>)?;
            let stop_ping_i = MenuItem::with_id(app, "tray_stop_ping", "Ping監視停止", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &start_ping_i, &stop_ping_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(get_tray_idle_icon())
                .tooltip(TRAY_TOOLTIP_IDLE)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_start_ping" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-start-ping", ());
                        }
                    }
                    "tray_stop_ping" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-stop-ping", ());
                        }
                    }
                    "quit" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("request-close", ());
                        } else {
                            app.exit(0);
                        }
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            let is_minimized = window.is_minimized().unwrap_or(false);
                            if is_visible && !is_minimized {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // メインウィンドウのイベントハンドリング（最小化時はトレイ格納、閉じる時は確認ダイアログ要求）
            if let Some(window) = app.get_webview_window("main") {
                let w_clone = window.clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = w_clone.emit("request-close", ());
                        }
                        tauri::WindowEvent::Resized(_) => {
                            if let Ok(true) = w_clone.is_minimized() {
                                let _ = w_clone.hide();
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            config_exists,
            save_config,
            load_parameters_config,
            parameters_config_exists,
            save_parameters_config,
            get_default_save_dir,
            save_stats_file,
            select_folder,
            open_folder,
            start_ping,
            stop_ping,
            is_pinging,
            exit_app,
            close_window,
            open_traceroute_window,
            start_traceroute,
            stop_traceroute,
            start_batch_traceroute,
            stop_batch_traceroute,
            save_traceroute_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
