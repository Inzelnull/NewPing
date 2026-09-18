//! ==============================================================================
//! Pingツール (NewPing) - ICMP Ping エンジンモジュール (pinger.rs)
//! ==============================================================================
//! 
//! 本モジュールは、Windowsネイティブの IpHelper ICMP API (`IcmpCreateFile`, `IcmpSendEcho`, `IcmpCloseHandle`)
//! を呼び出して、指定されたIPアドレスに対して直接ICMP Echo Requestを送信し、
//! 往復遅延時間(RTT)と成否をミリ秒単位で高精度に計測します。
//!
//! 主な機能:
//! - パケットサイズ（ペイロード長: 32〜10000バイト）の動的指定
//! - 分割不可フラグ（Don't Fragment: DF）の付与によるMTU経路検証
//! - タイムアウト値の指定
//! - ホスト名/IPアドレスのIPv4名前解決

use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};

/// Ping対象ターゲット情報
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PingTarget {
    /// ターゲットの一意識別子 (UUIDまたはIPベース)
    pub id: String,
    /// 監視対象のIPアドレスまたはホスト名
    pub ip: String,
    /// 表示用の日本語名称（例: "Google DNS", "本社ルーター"）
    pub name: String,
}

/// 1回のPing実行結果データ
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PingResult {
    /// 対象ターゲットID
    pub id: String,
    /// 対象IPアドレス
    pub ip: String,
    /// 疎通成功フラグ（true: 応答あり / false: 不通・タイムアウト）
    pub success: bool,
    /// 往復遅延時間(RTT) ミリ秒（成功時のみ設定）
    pub rtt_ms: Option<u32>,
    /// 実行完了時のUNIXエポックタイムスタンプ(ミリ秒)
    pub timestamp: u64,
    /// 送信時に使用したパケットサイズ(バイト)
    pub packet_size: u32,
    /// 連続NGによる自動パケット縮小処理中フラグ
    pub is_adjusting: bool,
    /// macOS TCC制限回避のためのTracerouteフォールバック計測フラグ
    pub is_fallback: bool,
}

/// ターゲット文字列（IPアドレスまたはホスト名）からIPv4アドレスを解決する関数
pub fn resolve_target_ipv4(target_ip: &str) -> Option<Ipv4Addr> {
    let trimmed = target_ip.trim();
    if let Ok(ip) = trimmed.parse::<Ipv4Addr>() {
        return Some(ip);
    }
    if let Ok(mut addrs) = format!("{}:80", trimmed).to_socket_addrs() {
        if let Some(addr) = addrs.find_map(|a| match a.ip() {
            IpAddr::V4(v4) => Some(v4),
            _ => None,
        }) {
            return Some(addr);
        }
    }
    None
}

/// ペイロードバッファを生成するヘルパー関数（32〜10000バイト）
#[cfg(windows)]
#[inline]
fn generate_payload(size: usize) -> Vec<u8> {
    let clamped_size = size.clamp(32, 10000);
    let mut send_data = vec![0u8; clamped_size];
    let pattern = b"AntigravityNewPingPayloadData123";
    let pattern_len = pattern.len();
    let mut offset = 0;
    while offset + pattern_len <= clamped_size {
        send_data[offset..offset + pattern_len].copy_from_slice(pattern);
        offset += pattern_len;
    }
    if offset < clamped_size {
        send_data[offset..].copy_from_slice(&pattern[..clamped_size - offset]);
    }
    send_data
}

/// 解決済みIPv4アドレスに対してWindowsネイティブの IcmpSendEcho API でPingを送信する
#[cfg(windows)]
pub fn ping_resolved_ip(ipv4: Ipv4Addr, timeout_ms: u32, packet_size: u32) -> (bool, Option<u32>, bool) {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION,
    };

    unsafe {
        // ICMP 送信用ハンドルを開く
        let handle = IcmpCreateFile();
        if handle == INVALID_HANDLE_VALUE {
            return (false, None, false);
        }

        let octets = ipv4.octets();
        // ネットワークバイトオーダーのIPv4アドレスを32ビット値に変換
        let ip_val = u32::from_ne_bytes(octets);

        // 要求されたパケットサイズのペイロードバッファを生成
        let send_data = generate_payload(packet_size as usize);

        // IPオプション設定: IP_FLAG_DF (0x02) により「パケット分割不可 (Don't Fragment)」を設定
        let ip_options = IP_OPTION_INFORMATION {
            Ttl: 128,
            Tos: 0,
            Flags: 0x02, // IP_FLAG_DF (Don't Fragment)
            OptionsSize: 0,
            OptionsData: std::ptr::null_mut(),
        };

        // 応答用バッファ領域を確保 (ICMP_ECHO_REPLY構造体 + ペイロード長 + 予備ヘッダ領域)
        let reply_size = size_of::<ICMP_ECHO_REPLY>() + send_data.len() + 8;
        let mut reply_buffer: Vec<u8> = vec![0u8; reply_size];

        // Windows IpHelper の IcmpSendEcho を呼び出してPingを送信
        let reply_count = IcmpSendEcho(
            handle,
            ip_val,
            send_data.as_ptr() as *const c_void,
            send_data.len() as u16,
            &ip_options as *const IP_OPTION_INFORMATION,
            reply_buffer.as_mut_ptr() as *mut c_void,
            reply_size as u32,
            timeout_ms,
        );

        // ICMPハンドルをクローズしてリソース解放
        IcmpCloseHandle(handle);

        // 応答が受信できたか検証
        if reply_count > 0 {
            let reply = &*(reply_buffer.as_ptr() as *const ICMP_ECHO_REPLY);
            // Status == 0 (IP_SUCCESS) であれば疎通成功
            if reply.Status == 0 {
                return (true, Some(reply.RoundTripTime), false);
            }
        }

        (false, None, false)
    }
}

/// macOS環境向け: OS標準の `/sbin/ping` (BSD ping) を用いてPingを実行
#[cfg(target_os = "macos")]
pub fn ping_resolved_ip(ipv4: Ipv4Addr, timeout_ms: u32, packet_size: u32) -> (bool, Option<u32>, bool) {
    use std::process::Command;

    let ip_str = ipv4.to_string();
    let packet_size_str = packet_size.clamp(32, 10000).to_string();
    let timeout_str = timeout_ms.to_string();

    // macOS BSD ping オプション:
    // -c 1: 1パケット送信
    // -n: DNS逆引き（ホスト名検索）を行わずIP数値のみ表示（遅延防止）
    // -W <timeout_ms>: 応答待ちタイムアウト (ミリ秒)
    // -s <packet_size>: データペイロードサイズ (バイト)
    // -D: Don't Fragment (DF) ビット付与
    let output = Command::new("/sbin/ping")
        .args([
            "-c", "1",
            "-n",
            "-W", &timeout_str,
            "-s", &packet_size_str,
            "-D",
            &ip_str,
        ])
        .output();

    let (mut success, mut rtt) = match output {
        Ok(out) => {
            let stdout_str = String::from_utf8_lossy(&out.stdout);
            let stderr_str = String::from_utf8_lossy(&out.stderr);
            let combined = format!("{}\n{}", stdout_str, stderr_str);
            parse_bsd_ping_output(&combined)
        }
        Err(_) => (false, None),
    };

    let mut is_fallback = false;

    // macOS Sequoia Local Network Privacy (TCC) 回避用フェイルセーフ:
    // プライベートIP(LAN)宛てで /sbin/ping が遮断・パケットロスとなった場合、
    // SUID root 権限を持つ /usr/sbin/traceroute (1ホップ・単一プローブ) でフォールバック計測を実行
    if !success && (ipv4.is_private() || ipv4.is_link_local()) {
        let timeout_secs = ((timeout_ms + 999) / 1000).clamp(1, 5).to_string();
        let tr_output = Command::new("/usr/sbin/traceroute")
            .args([
                "-n",
                "-q", "1",
                "-m", "1",
                "-w", &timeout_secs,
                &ip_str,
            ])
            .output();

        if let Ok(out) = tr_output {
            let tr_stdout = String::from_utf8_lossy(&out.stdout);
            let (tr_ok, tr_rtt) = parse_traceroute_one_hop(&tr_stdout, &ip_str);
            if tr_ok {
                success = true;
                rtt = tr_rtt;
                is_fallback = true;
            }
        }
    }

    (success, rtt, is_fallback)
}

/// 1ホップの traceroute 出力から対象IPの疎通成否とRTT(ms)を取得
pub fn parse_traceroute_one_hop(output: &str, target_ip: &str) -> (bool, Option<u32>) {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("1 ") || trimmed.starts_with("1\t") {
            if trimmed.contains(target_ip) && trimmed.contains("ms") {
                if let Some(ms_pos) = trimmed.find("ms") {
                    let before_ms = trimmed[..ms_pos].trim();
                    if let Some(val_str) = before_ms.split_whitespace().last() {
                        if let Ok(val) = val_str.parse::<f64>() {
                            return (true, Some(val.round() as u32));
                        }
                    }
                }
                return (true, Some(1));
            }
        }
    }
    (false, None)
}

/// BSD系 (macOS) ping コマンドの標準出力を解析して成否とRTT(ms)を取得
#[allow(dead_code)]
pub fn parse_bsd_ping_output(output: &str) -> (bool, Option<u32>) {
    let mut received_ok = false;
    let mut parsed_rtt: Option<u32> = None;

    for line in output.lines() {
        let lower = line.to_lowercase();
        // "1 packets received" または "1 received"
        if lower.contains("1 packets received") || lower.contains("1 received") {
            received_ok = true;
        }

        // "time=0.123 ms" または "time=12 ms"
        if let Some(pos) = lower.find("time=") {
            let after = &lower[pos + 5..];
            let num_part: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(val) = num_part.parse::<f64>() {
                received_ok = true;
                parsed_rtt = Some(val.round() as u32);
            }
        }

        // "round-trip min/avg/max/stddev = 0.082/0.082/0.082/0.000 ms"
        if lower.contains("min/avg/max") {
            if let Some(eq_pos) = line.find('=') {
                let metrics = &line[eq_pos + 1..].trim();
                let parts: Vec<&str> = metrics.split('/').collect();
                if parts.len() >= 2 {
                    if let Ok(avg_val) = parts[1].trim().parse::<f64>() {
                        received_ok = true;
                        if parsed_rtt.is_none() {
                            parsed_rtt = Some(avg_val.round() as u32);
                        }
                    }
                }
            }
        }
    }

    if received_ok {
        (true, parsed_rtt.or(Some(0)))
    } else {
        (false, None)
    }
}

/// WindowsおよびmacOS以外のUNIX環境向けのモック/フォールバック実装
#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn ping_resolved_ip(_ipv4: Ipv4Addr, _timeout_ms: u32, _packet_size: u32) -> (bool, Option<u32>, bool) {
    (true, Some(10), false)
}

/// IP文字列またはホスト名を受け取ってPingを送信するエントリーポイント（後方互換性および単体呼び出し用）
#[allow(dead_code)]
pub fn ping_host(target_ip: &str, timeout_ms: u32, packet_size: u32) -> (bool, Option<u32>, bool) {
    if let Some(ipv4) = resolve_target_ipv4(target_ip) {
        ping_resolved_ip(ipv4, timeout_ms, packet_size)
    } else {
        (false, None, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_target_ipv4() {
        assert_eq!(resolve_target_ipv4("127.0.0.1"), Some(Ipv4Addr::new(127, 0, 0, 1)));
        assert_eq!(resolve_target_ipv4("999.999.999.999"), None);
    }

    #[test]
    fn test_ping_localhost_default_size() {
        let (success, rtt, _) = ping_host("127.0.0.1", 1000, 32);
        assert!(success, "Localhost ping with 32B payload should succeed");
        assert!(rtt.is_some());
    }

    #[test]
    fn test_ping_localhost_custom_size_df() {
        let (success, rtt, _) = ping_host("127.0.0.1", 1000, 1472);
        assert!(success, "Localhost ping with 1472B payload and DF should succeed");
        assert!(rtt.is_some());
    }

    #[test]
    fn test_ping_invalid_ip() {
        let (success, _, _) = ping_host("999.999.999.999", 500, 32);
        assert!(!success, "Invalid IP ping should fail");
    }

    #[test]
    fn test_parse_bsd_ping_output_success() {
        let sample_output = r#"
PING 127.0.0.1 (127.0.0.1): 32 data bytes
40 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.082 ms

--- 127.0.0.1 ping statistics ---
1 packets transmitted, 1 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 0.082/0.082/0.082/0.000 ms
"#;
        let (success, rtt) = parse_bsd_ping_output(sample_output);
        assert!(success);
        assert_eq!(rtt, Some(0)); // 0.082ms rounds to 0ms
    }

    #[test]
    fn test_parse_bsd_ping_output_normal_rtt() {
        let sample_output = r#"
PING 8.8.8.8 (8.8.8.8): 32 data bytes
40 bytes from 8.8.8.8: icmp_seq=0 ttl=116 time=14.320 ms

--- 8.8.8.8 ping statistics ---
1 packets transmitted, 1 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 14.320/14.320/14.320/0.000 ms
"#;
        let (success, rtt) = parse_bsd_ping_output(sample_output);
        assert!(success);
        assert_eq!(rtt, Some(14));
    }

    #[test]
    fn test_parse_bsd_ping_output_timeout() {
        let sample_output = r#"
PING 192.0.2.1 (192.0.2.1): 32 data bytes
Request timeout for icmp_seq 0

--- 192.0.2.1 ping statistics ---
1 packets transmitted, 0 packets received, 100.0% packet loss
"#;
        let (success, rtt) = parse_bsd_ping_output(sample_output);
        assert!(!success);
        assert_eq!(rtt, None);
    }
}

