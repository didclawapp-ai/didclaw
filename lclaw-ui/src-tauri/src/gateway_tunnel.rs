//! OpenClaw 网关 WebSocket 由 Rust 连接本机环回。
//! - 握手需 `Origin: https://tauri.localhost`（与 `gateway.controlUi.allowedOrigins` 一致）。
//! - 2026.3+ 在升级阶段校验 token：`?token=` 与/或 `Authorization: Bearer`；仅靠后续 `connect` JSON 会报 `token_missing`。

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::client::IntoClientRequest,
    tungstenite::http::{header, HeaderValue},
    tungstenite::protocol::Message,
};
use tauri::{AppHandle, Emitter, Manager};

pub const EVT: &str = "lclaw-gateway-tunnel";

#[derive(Default)]
pub struct GatewayTunnelSlot {
    pub cmd_tx: Option<mpsc::Sender<TunnelCmd>>,
    pub session_id: u64,
}

pub enum TunnelCmd {
    Send(String),
    Shutdown,
}

fn validate_loopback_ws(ws_url: &str) -> Result<(), String> {
    if crate::openclaw_gateway::parse_gateway_ws_tcp_target(ws_url).is_none() {
        return Err(
            "仅允许连接本机环回 WebSocket（127.0.0.1 / localhost / ::1 的 ws 或 wss）。".into(),
        );
    }
    Ok(())
}

/// 在 WebSocket URL 上附加握手鉴权（若用户未已在查询串中写明）。
fn ws_url_with_handshake_query(
    ws_url: &str,
    token: Option<&str>,
    password: Option<&str>,
) -> Result<String, String> {
    let mut u = url::Url::parse(ws_url.trim()).map_err(|e| format!("无效 WebSocket 地址：{e}"))?;

    let tok = token.map(str::trim).filter(|s| !s.is_empty());
    let pwd = password.map(str::trim).filter(|s| !s.is_empty());

    let has_token_q = u.query_pairs().any(|(k, _)| k == "token");
    let has_password_q = u.query_pairs().any(|(k, _)| k == "password");

    if let Some(t) = tok {
        if !has_token_q {
            u.query_pairs_mut().append_pair("token", t);
        }
    }
    if let Some(p) = pwd {
        if !has_password_q {
            u.query_pairs_mut().append_pair("password", p);
        }
    }

    Ok(u.to_string())
}

pub async fn shutdown_tunnel_slot(slot: &Arc<Mutex<GatewayTunnelSlot>>) {
    let old_tx = {
        let mut g = slot.lock().await;
        g.cmd_tx.take()
    };
    if let Some(tx) = old_tx {
        let _ = tx.send(TunnelCmd::Shutdown).await;
    }
    tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
}

fn emit_evt(app: &AppHandle, v: Value) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit(EVT, v);
    }
}

pub async fn gateway_tunnel_close(slot: Arc<Mutex<GatewayTunnelSlot>>) -> Result<(), String> {
    shutdown_tunnel_slot(&slot).await;
    Ok(())
}

pub async fn gateway_tunnel_open(
    app: AppHandle,
    slot: Arc<Mutex<GatewayTunnelSlot>>,
    ws_url: String,
    token: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    let t = ws_url.trim();
    if t.is_empty() {
        return Err("WebSocket 地址为空".into());
    }
    validate_loopback_ws(t)?;

    shutdown_tunnel_slot(&slot).await;

    let connect_url = ws_url_with_handshake_query(t, token.as_deref(), password.as_deref())?;
    validate_loopback_ws(&connect_url)?;

    let mut request = connect_url
        .into_client_request()
        .map_err(|e| format!("网关 WebSocket 请求构造失败：{e}"))?;
    request.headers_mut().insert(
        header::ORIGIN,
        HeaderValue::from_static("https://tauri.localhost"),
    );

    if let Some(tok) = token.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let bearer = format!("Bearer {tok}");
        if let Ok(hv) = HeaderValue::from_str(&bearer) {
            request.headers_mut().insert(header::AUTHORIZATION, hv);
        }
    }

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("网关 WebSocket 连接失败：{e}"))?;

    let (mut write, mut read) = ws_stream.split();

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<TunnelCmd>(128);

    let my_session = {
        let mut g = slot.lock().await;
        g.session_id = g.session_id.wrapping_add(1);
        let sid = g.session_id;
        g.cmd_tx = Some(cmd_tx.clone());
        sid
    };

    let app2 = app.clone();
    let slot2 = Arc::clone(&slot);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(TunnelCmd::Send(text)) => {
                            if write.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                        Some(TunnelCmd::Shutdown) | None => {
                            let _ = write.send(Message::Close(None)).await;
                            break;
                        }
                    }
                }
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            emit_evt(
                                &app2,
                                json!({ "kind": "text", "data": t.to_string() }),
                            );
                        }
                        Some(Ok(Message::Ping(p))) => {
                            let _ = write.send(Message::Pong(p)).await;
                        }
                        Some(Ok(Message::Pong(_))) => {}
                        Some(Ok(Message::Binary(_))) => {}
                        Some(Ok(Message::Frame(_))) => {}
                        Some(Ok(Message::Close(frame))) => {
                            let code = frame
                                .as_ref()
                                .map(|f| u16::from(f.code))
                                .unwrap_or(1000u16);
                            let reason = frame
                                .map(|f| f.reason.to_string())
                                .unwrap_or_default();
                            emit_evt(
                                &app2,
                                json!({
                                    "kind": "close",
                                    "code": code,
                                    "reason": reason,
                                }),
                            );
                            break;
                        }
                        Some(Err(_)) => {
                            emit_evt(
                                &app2,
                                json!({
                                    "kind": "close",
                                    "code": 1006,
                                    "reason": "websocket error",
                                }),
                            );
                            break;
                        }
                        None => {
                            emit_evt(
                                &app2,
                                json!({ "kind": "close", "code": 1005, "reason": "" }),
                            );
                            break;
                        }
                    }
                }
            }
        }

        let mut g = slot2.lock().await;
        if g.session_id == my_session {
            g.cmd_tx = None;
        }
    });

    Ok(())
}

pub async fn gateway_tunnel_send(
    slot: Arc<Mutex<GatewayTunnelSlot>>,
    text: String,
) -> Result<(), String> {
    let tx = {
        let g = slot.lock().await;
        g.cmd_tx.clone()
    };
    let Some(tx) = tx else {
        return Err("网关隧道未连接".into());
    };
    tx.send(TunnelCmd::Send(text))
        .await
        .map_err(|_| "网关隧道已关闭".to_string())
}
