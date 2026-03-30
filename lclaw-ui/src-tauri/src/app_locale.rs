//! UI locale mirrored from the webview (`zh` | `en`) for native UI (tray, dialogs, errors).

use std::sync::RwLock;

static LOCALE: RwLock<String> = RwLock::new(String::new());

/// Normalize to `zh` or `en`.
pub fn set_locale(code: &str) {
    let mut g = LOCALE.write().unwrap();
    *g = if code.eq_ignore_ascii_case("en") {
        "en".into()
    } else {
        "zh".into()
    };
}

pub fn current_locale() -> String {
    let g = LOCALE.read().unwrap();
    if g.is_empty() {
        "zh".into()
    } else {
        g.clone()
    }
}

pub fn is_en() -> bool {
    current_locale() == "en"
}

/// Before first `set_locale` from the webview, guess from env (Windows may omit LANG).
pub fn init_default_from_env() {
    let mut g = LOCALE.write().unwrap();
    if !g.is_empty() {
        return;
    }
    let lang = std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default()
        .to_lowercase();
    *g = if lang.contains("zh") {
        "zh".into()
    } else {
        "en".into()
    };
}
