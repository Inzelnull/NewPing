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
pub fn ping_resolved_ip(ipv4: Ipv4Addr, timeout_ms: u32, packet_size: u32) -> (bool, Option<u32>) {
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
            return (false, None);
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
                return (true, Some(reply.RoundTripTime));
            }
        }

        (false, None)
    }
}

/// 非Windows環境向けのモック実装（テスト・ビルド用）
#[cfg(not(windows))]
pub fn ping_resolved_ip(_ipv4: Ipv4Addr, _timeout_ms: u32, _packet_size: u32) -> (bool, Option<u32>) {
    (true, Some(10))
}

/// IP文字列またはホスト名を受け取ってPingを送信するエントリーポイント（後方互換性および単体呼び出し用）
#[allow(dead_code)]
pub fn ping_host(target_ip: &str, timeout_ms: u32, packet_size: u32) -> (bool, Option<u32>) {
    if let Some(ipv4) = resolve_target_ipv4(target_ip) {
        ping_resolved_ip(ipv4, timeout_ms, packet_size)
    } else {
        (false, None)
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
        let (success, rtt) = ping_host("127.0.0.1", 1000, 32);
        assert!(success, "Localhost ping with 32B payload should succeed");
        assert!(rtt.is_some());
    }

    #[test]
    fn test_ping_localhost_custom_size_df() {
        let (success, rtt) = ping_host("127.0.0.1", 1000, 1472);
        assert!(success, "Localhost ping with 1472B payload and DF should succeed");
        assert!(rtt.is_some());
    }

    #[test]
    fn test_ping_invalid_ip() {
        let (success, _) = ping_host("999.999.999.999", 500, 32);
        assert!(!success, "Invalid IP ping should fail");
    }
}

