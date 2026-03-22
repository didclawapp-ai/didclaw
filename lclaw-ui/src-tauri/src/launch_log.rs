//! 生产环境无控制台时，将启动与错误信息追加到固定日志文件，便于排查闪退。

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 日志路径：与安装目录无关，始终可写。
pub fn log_path() -> std::path::PathBuf {
    std::env::temp_dir().join("lclaw-ui-launch.log")
}

/// 安装 panic 钩子并写入会话头；应在 `run()` 最开头调用一次。
pub fn init() {
    let path = log_path();
    let path_s = path.display().to_string();
    line(&format!("======== LCLAW UI 启动 {path_s} ========"));
    if let Ok(exe) = std::env::current_exe() {
        line(&format!("exe: {}", exe.display()));
    }
    line(&format!("cwd: {}", std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_else(|e| e.to_string())));

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("PANIC: {info}");
        line(&msg);
        default_hook(info);
    }));
}

pub fn line(msg: &str) {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let row = format!("[{ts}] {msg}\n");
    let _guard = WRITE_LOCK.lock().ok();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = f.write_all(row.as_bytes());
        let _ = f.flush();
    }
    #[cfg(debug_assertions)]
    eprint!("{row}");
}
