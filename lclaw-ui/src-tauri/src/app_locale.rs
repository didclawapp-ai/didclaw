//! UI locale mirrored from the webview (`zh` | `en`) for native UI (tray, dialogs, errors).

use std::sync::RwLock;

static LOCALE: RwLock<String> = RwLock::new(String::new());

fn normalize_locale_tag(raw: &str) -> String {
    if raw.trim().to_ascii_lowercase().starts_with("zh") {
        "zh".into()
    } else {
        "en".into()
    }
}

/// Normalize to `zh` or `en`.
pub fn set_locale(code: &str) {
    let mut g = LOCALE.write().unwrap();
    *g = normalize_locale_tag(code);
}

pub fn current_locale() -> String {
    let g = LOCALE.read().unwrap();
    if g.is_empty() {
        "en".into()
    } else {
        g.clone()
    }
}

pub fn is_en() -> bool {
    current_locale() == "en"
}

/// Before first `set_locale` from the webview, guess from the OS locale.
pub fn init_default_from_env() {
    let mut g = LOCALE.write().unwrap();
    if !g.is_empty() {
        return;
    }
    let lang = sys_locale::get_locale()
        .or_else(|| std::env::var("LANG").ok())
        .or_else(|| std::env::var("LC_ALL").ok())
        .unwrap_or_default();
    *g = normalize_locale_tag(&lang);
}
