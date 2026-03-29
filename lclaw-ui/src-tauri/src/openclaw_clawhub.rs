use base64::Engine;
use serde_json::Value;
use std::io::Read;
use std::thread;
use std::time::Duration;
use url::Url;

const DEFAULT_REGISTRY: &str = "https://clawhub.ai";
const REQUEST_TIMEOUT_SECS: u64 = 15;
const RATE_LIMIT_MAX_RETRIES_JSON: usize = 3;
const RATE_LIMIT_MAX_RETRIES_BINARY: usize = 6;
const RATE_LIMIT_WAIT_CAP_SECS: u64 = 120;

fn registry_base_url(registry: Option<&str>) -> String {
    let raw = registry
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_REGISTRY);
    raw.trim_end_matches('/').to_string()
}

fn api_url(
    registry: Option<&str>,
    path: &str,
    params: &[(&str, String)],
) -> Result<String, String> {
    let base = format!("{}/", registry_base_url(registry));
    let mut url = Url::parse(&base).map_err(|e| format!("无效的 ClawHub Registry：{e}"))?;
    url.set_path(path.trim_start_matches('/'));
    {
        let mut q = url.query_pairs_mut();
        for (k, v) in params {
            q.append_pair(k, v);
        }
    }
    Ok(url.into())
}

fn assert_safe_slug(slug: &str) -> Result<String, String> {
    let s = slug.trim();
    if s.is_empty() || s.contains('/') || s.contains('\\') || s.contains("..") {
        return Err(format!("无效的 skill slug: {slug}"));
    }
    Ok(s.to_string())
}

fn assert_safe_package_name(name: &str) -> Result<String, String> {
    let s = name.trim();
    if s.is_empty() || s.contains("..") {
        return Err(format!("无效的包名: {name}"));
    }
    Ok(s.to_string())
}

fn encode_path_component(v: &str) -> String {
    url::form_urlencoded::byte_serialize(v.as_bytes()).collect()
}

fn parse_retry_after_seconds(resp: &ureq::Response) -> Option<u64> {
    let raw = resp.header("Retry-After")?.trim();
    if let Ok(n) = raw.parse::<u64>() {
        return Some(n.min(RATE_LIMIT_WAIT_CAP_SECS).max(1));
    }
    None
}

fn parse_rate_limit_reset_seconds(resp: &ureq::Response) -> Option<u64> {
    for key in ["Ratelimit-Reset", "X-Ratelimit-Reset"] {
        let raw = match resp.header(key) {
            Some(v) => v.trim(),
            None => continue,
        };
        let Ok(n) = raw.parse::<u64>() else {
            continue;
        };
        if n > 1_000_000_000 {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let wait = n.saturating_sub(now);
            if wait > 0 {
                return Some(wait.min(RATE_LIMIT_WAIT_CAP_SECS));
            }
            continue;
        }
        if n > 0 {
            return Some(n.min(RATE_LIMIT_WAIT_CAP_SECS));
        }
    }
    None
}

fn compute_429_wait_seconds(resp: &ureq::Response, kind: &str) -> u64 {
    let mut sec = parse_retry_after_seconds(resp)
        .unwrap_or(0)
        .max(parse_rate_limit_reset_seconds(resp).unwrap_or(0));
    if sec < 1 {
        sec = if kind == "binary" { 32 } else { 8 };
    }
    if kind == "binary" && sec < 20 {
        sec = 32;
    }
    sec.min(RATE_LIMIT_WAIT_CAP_SECS)
}

fn build_get_request(url: &str, token: Option<&str>) -> ureq::Request {
    let mut req = ureq::get(url)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .set("Accept", "application/json")
        .set("User-Agent", "DidClaw Desktop");
    if let Some(t) = token.map(str::trim).filter(|s| !s.is_empty()) {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    req
}

fn body_snippet(resp: ureq::Response) -> String {
    let mut body = String::new();
    let _ = resp.into_reader().take(4096).read_to_string(&mut body);
    let body = body.trim();
    if body.is_empty() {
        String::new()
    } else if body.len() > 280 {
        format!("{}…", &body[..280])
    } else {
        body.to_string()
    }
}

fn fetch_json_value(url: &str, token: Option<&str>) -> Result<Value, String> {
    for attempt in 0..=RATE_LIMIT_MAX_RETRIES_JSON {
        match build_get_request(url, token).call() {
            Ok(resp) => {
                return resp
                    .into_json::<Value>()
                    .map_err(|e| format!("解析 ClawHub JSON 失败：{e}"));
            }
            Err(ureq::Error::Status(429, resp)) if attempt < RATE_LIMIT_MAX_RETRIES_JSON => {
                let wait = compute_429_wait_seconds(&resp, "json");
                let _ = body_snippet(resp);
                thread::sleep(Duration::from_secs(wait));
            }
            Err(ureq::Error::Status(code, resp)) => {
                let snippet = body_snippet(resp);
                if snippet.is_empty() {
                    return Err(format!("ClawHub HTTP {code}"));
                }
                return Err(format!("ClawHub HTTP {code}: {snippet}"));
            }
            Err(e) => return Err(format!("请求 ClawHub 失败：{e}")),
        }
    }
    Err("ClawHub 请求失败".into())
}

fn fetch_binary_base64(url: &str, token: Option<&str>) -> Result<String, String> {
    for attempt in 0..=RATE_LIMIT_MAX_RETRIES_BINARY {
        match build_get_request(url, token).call() {
            Ok(resp) => {
                let mut bytes = Vec::new();
                resp.into_reader()
                    .read_to_end(&mut bytes)
                    .map_err(|e| format!("读取 ClawHub 下载内容失败：{e}"))?;
                return Ok(base64::engine::general_purpose::STANDARD.encode(bytes));
            }
            Err(ureq::Error::Status(429, resp)) if attempt < RATE_LIMIT_MAX_RETRIES_BINARY => {
                let wait = compute_429_wait_seconds(&resp, "binary");
                let _ = body_snippet(resp);
                thread::sleep(Duration::from_secs(wait));
            }
            Err(ureq::Error::Status(code, resp)) => {
                let snippet = body_snippet(resp);
                if snippet.is_empty() {
                    return Err(format!("ClawHub HTTP {code}"));
                }
                return Err(format!("ClawHub HTTP {code}: {snippet}"));
            }
            Err(e) => return Err(format!("下载 ClawHub 技能失败：{e}")),
        }
    }
    Err("ClawHub 下载失败".into())
}

pub fn clawhub_packages_search_service(
    query: &str,
    limit: Option<u32>,
    family: Option<&str>,
    channel: Option<&str>,
    token: Option<&str>,
    registry: Option<&str>,
) -> Result<Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(serde_json::json!({ "results": [] }));
    }
    let mut params = vec![
        ("q", q.to_string()),
        ("limit", limit.unwrap_or(30).clamp(1, 100).to_string()),
    ];
    if let Some(v) = family.map(str::trim).filter(|s| !s.is_empty()) {
        params.push(("family", v.to_string()));
    }
    if let Some(v) = channel.map(str::trim).filter(|s| !s.is_empty()) {
        params.push(("channel", v.to_string()));
    }
    let url = api_url(registry, "/api/v1/packages/search", &params)?;
    fetch_json_value(&url, token)
}

pub fn clawhub_package_detail_service(
    name: &str,
    token: Option<&str>,
    registry: Option<&str>,
) -> Result<Value, String> {
    let name = assert_safe_package_name(name)?;
    let url = api_url(
        registry,
        &format!("/api/v1/packages/{}", encode_path_component(&name)),
        &[],
    )?;
    fetch_json_value(&url, token)
}

pub fn clawhub_skill_detail_service(
    slug: &str,
    token: Option<&str>,
    registry: Option<&str>,
) -> Result<Value, String> {
    let slug = assert_safe_slug(slug)?;
    let url = api_url(
        registry,
        &format!("/api/v1/skills/{}", encode_path_component(&slug)),
        &[],
    )?;
    fetch_json_value(&url, token)
}

pub fn clawhub_download_skill_zip_service(
    slug: &str,
    version: Option<&str>,
    token: Option<&str>,
    registry: Option<&str>,
) -> Result<String, String> {
    let slug = assert_safe_slug(slug)?;
    let mut params = vec![("slug", slug)];
    if let Some(v) = version.map(str::trim).filter(|s| !s.is_empty()) {
        params.push(("version", v.to_string()));
    }
    let url = api_url(registry, "/api/v1/download", &params)?;
    fetch_binary_base64(&url, token)
}
