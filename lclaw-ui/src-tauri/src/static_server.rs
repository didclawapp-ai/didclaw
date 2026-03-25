//! 生产环境在 127.0.0.1 提供 dist 静态资源，与 `electron/static-server.ts` 行为对齐，避免 Gateway WebSocket Origin 拒绝。

use axum::Router;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use tauri::path::{BaseDirectory, PathResolver};
use tauri::Runtime;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

/// 须与 `capabilities/default.json` 里 `remote.urls` 中的端口一致，否则页面无 IPC（空白）。
const DEFAULT_BASE_PORT: u16 = 34127;

fn parse_static_port() -> u16 {
    std::env::var("DIDCLAW_STATIC_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&p| p >= 1)
        .unwrap_or(DEFAULT_BASE_PORT)
}

/// 打包后资源目录中定位含 `index.html` 的根目录。
///
/// - `build.frontendDist` 的页面不会自动以「可预测的同目录 dist」释放；需 `bundle.resources` 带上前端目录。
/// - **数组写法** `["../dist/"]`：Tauri 会把 `../` 映射为资源目录下的 `_up_/`，即 **`$RESOURCE/_up_/dist/index.html`**（见官方 *Embedding Additional Files*）。
/// - **映射写法** `{"../dist/": "dist/"}`：安装后为 **`$RESOURCE/dist/index.html`**（推荐，与路径解析一致）。
/// 此处优先用 [`PathResolver::resolve`]（与打包规则一致），再扫描常见目录兜底。
pub fn resolve_bundle_dist<R: Runtime>(resolver: &PathResolver<R>) -> Result<PathBuf, String> {
    for rel in ["dist/index.html", "../dist/index.html"] {
        match resolver.resolve(rel, BaseDirectory::Resource) {
            Ok(p) => {
                crate::launch_log::line(&format!(
                    "resolve: PathResolver {rel} => {}",
                    p.display()
                ));
                if p.is_file() {
                    if let Some(parent) = p.parent() {
                        return Ok(parent.to_path_buf());
                    }
                }
            }
            Err(e) => {
                crate::launch_log::line(&format!("resolve: PathResolver {rel} 失败: {e}"));
            }
        }
    }

    let mut bases: Vec<PathBuf> = Vec::new();
    match resolver.resource_dir() {
        Ok(rd) => {
            crate::launch_log::line(&format!("resolve: resource_dir = {}", rd.display()));
            bases.push(rd.clone());
            bases.push(rd.join("dist"));
            // 数组形式 bundle.resources 含 `../dist/` 时的实际落点
            bases.push(rd.join("_up_").join("dist"));
            bases.push(rd.join("resources"));
            bases.push(rd.join("resources").join("dist"));
        }
        Err(e) => {
            crate::launch_log::line(&format!("resolve: resource_dir 不可用: {e}"));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            crate::launch_log::line(&format!("resolve: exe 目录 = {}", dir.display()));
            bases.push(dir.to_path_buf());
            bases.push(dir.join("dist"));
            bases.push(dir.join("_up_").join("dist"));
            bases.push(dir.join("resources").join("dist"));
        }
    }
    for b in bases {
        let idx = b.join("index.html");
        let ok = idx.is_file();
        crate::launch_log::line(&format!(
            "resolve: 尝试 {} index.html => {}",
            b.display(),
            if ok { "存在" } else { "无" }
        ));
        if ok {
            return Ok(b);
        }
    }
    crate::launch_log::line("resolve: 所有候选路径均无 index.html");
    Err(
        "找不到前端 index.html。请确认 beforeBuildCommand 已生成 dist，且 bundle.resources 使用 {\"../dist/\": \"dist/\"} 或数组形式（运行时可能在 _up_/dist/）。"
            .into(),
    )
}

fn not_found_to_index(dist: &Path) -> ServeFile {
    let index = dist.join("index.html");
    ServeFile::new(index)
}

pub async fn start_server(dist: PathBuf, tx: Sender<Result<u16, String>>) {
    crate::launch_log::line("static_server: start_server 线程已运行");
    let base = parse_static_port();
    let index_path = dist.join("index.html");
    if !index_path.is_file() {
        let msg = format!("静态根目录缺少 index.html: {}", dist.display());
        crate::launch_log::line(&msg);
        let _ = tx.send(Err(msg));
        return;
    }

    match TcpListener::bind(("127.0.0.1", base)).await {
        Ok(listener) => {
            crate::launch_log::line(&format!("static_server: 绑定 127.0.0.1:{base}"));
            let dir_service = ServeDir::new(&dist).not_found_service(not_found_to_index(&dist));
            let router = Router::new().fallback_service(dir_service);
            let serve_task = tokio::spawn(async move {
                crate::launch_log::line("static_server: axum serve 开始");
                if let Err(e) = axum::serve(listener, router).await {
                    crate::launch_log::line(&format!("本地静态服务退出: {e}"));
                    log::error!("本地静态服务退出: {e}");
                }
            });
            // TcpListener::bind 成功后端口已在 OS 层进入 LISTEN 状态（TCP backlog 可接受初始连接），
            // 无需等待 axum accept 循环预热；移除原 sleep(200ms) 的脆弱时机假设。
            crate::launch_log::line("static_server: 端口已 LISTEN，通知主线程 navigate");
            if tx.send(Ok(base)).is_err() {
                crate::launch_log::line("static_server: 发送端口到主线程失败（通道关闭）");
                serve_task.abort();
                return;
            }
            let _ = serve_task.await;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            let msg = format!(
                "端口 {base} 已被占用（须与 ACL remote.urls 一致，勿换端口扫描）。可结束占用进程或改 DIDCLAW_STATIC_PORT 并同步修改 capabilities/default.json"
            );
            crate::launch_log::line(&msg);
            let _ = tx.send(Err(msg));
        }
        Err(e) => {
            crate::launch_log::line(&format!("static_server: 绑定端口失败: {e}"));
            let _ = tx.send(Err(e.to_string()));
        }
    }
}
