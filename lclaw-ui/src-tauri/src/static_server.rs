//! 生产环境在 127.0.0.1 提供 dist 静态资源，与 `electron/static-server.ts` 行为对齐，避免 Gateway WebSocket Origin 拒绝。

use axum::Router;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use tauri::path::PathResolver;
use tauri::Runtime;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

const DEFAULT_BASE_PORT: u16 = 34127;
const PORT_ATTEMPTS: u16 = 40;

fn parse_static_port() -> u16 {
    std::env::var("LCLAW_UI_STATIC_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&p| p >= 1)
        .unwrap_or(DEFAULT_BASE_PORT)
}

/// 打包后资源目录中定位含 `index.html` 的根目录（与 Tauri 打入的 `frontendDist` 布局一致）。
pub fn resolve_bundle_dist<R: Runtime>(resolver: &PathResolver<R>) -> Result<PathBuf, String> {
    if let Ok(rd) = resolver.resource_dir() {
        if rd.join("index.html").is_file() {
            return Ok(rd);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join("dist");
            if cand.join("index.html").is_file() {
                return Ok(cand);
            }
        }
    }
    Err("找不到前端资源目录（index.html）".into())
}

fn not_found_to_index(dist: &Path) -> ServeFile {
    let index = dist.join("index.html");
    ServeFile::new(index)
}

pub async fn start_server(dist: PathBuf, tx: Sender<Result<u16, String>>) {
    let base = parse_static_port();
    let index_path = dist.join("index.html");
    if !index_path.is_file() {
        let _ = tx.send(Err(format!(
            "静态根目录缺少 index.html: {}",
            dist.display()
        )));
        return;
    }

    for p in base..base.saturating_add(PORT_ATTEMPTS) {
        match TcpListener::bind(("127.0.0.1", p)).await {
            Ok(listener) => {
                if tx.send(Ok(p)).is_err() {
                    return;
                }
                let dir_service =
                    ServeDir::new(&dist).not_found_service(not_found_to_index(&dist));
                let app = Router::new().fallback_service(dir_service);
                if let Err(e) = axum::serve(listener, app).await {
                    log::error!("本地静态服务退出: {e}");
                }
                return;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(e) => {
                let _ = tx.send(Err(e.to_string()));
                return;
            }
        }
    }
    let _ = tx.send(Err("无可用端口启动本地静态服务".into()));
}
