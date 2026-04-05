#![windows_subsystem = "windows"]

use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const IDLE_TIMEOUT_SECS: u64 = 120;
const POLL_INTERVAL_MS: u64 = 100;
const MAX_HEADER_BYTES: usize = 1024 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024;
const API_TOKEN_HEADER: &str = "x-claudebuddy-token";
static NEXT_UNIQUE_ID: AtomicU64 = AtomicU64::new(1);

const INDEX_HTML: &[u8] = include_bytes!("../../../app/index.html");
const APP_JS: &[u8] = include_bytes!("../../../app/app.js");
const MESSAGES_JS: &[u8] = include_bytes!("../../../app/messages.js");
const SEARCH_WORKER_JS: &[u8] = include_bytes!("../../../app/search-worker.js");
const STYLES_CSS: &[u8] = include_bytes!("../../../app/styles.css");
const BUDDY_ART_JS: &[u8] = include_bytes!("../../../app/shared/buddy-art.js");
const BUDDY_CORE_JS: &[u8] = include_bytes!("../../../app/shared/buddy-core.js");
const SEARCH_PLAN_JS: &[u8] = include_bytes!("../../../app/shared/search-plan.js");

fn main() {
    if let Err(error) = run() {
        let log_path = app_base_dir().join("portable-error.log");
        let _ = fs::write(&log_path, format!("{}\n{}\n", iso_timestamp(), error));
        show_error(&format!(
            "Portable failed to start.\n\nSee:\n{}",
            log_path.display()
        ));
    }
}

fn run() -> Result<(), String> {
    let assets = Arc::new(EmbeddedAssets::new());
    let port = match configured_port() {
        Some(port) => port,
        None => find_available_port()?,
    };
    let base_url = format!("http://127.0.0.1:{port}");
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let config_store = Arc::new(ConfigStore::new());
    let session = Arc::new(SessionState::new(&base_url));
    let last_activity = Arc::new(AtomicU64::new(now_unix_secs()));

    if !should_skip_browser() {
        let launch_url = base_url.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(350));
            let _ = open_browser(&launch_url);
        });
    }

    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                last_activity.store(now_unix_secs(), Ordering::Relaxed);
                let assets = Arc::clone(&assets);
                let config_store = Arc::clone(&config_store);
                let session = Arc::clone(&session);
                let last_activity = Arc::clone(&last_activity);
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, assets, config_store, session, last_activity) {
                        let _ = error;
                    }
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if now_unix_secs().saturating_sub(last_activity.load(Ordering::Relaxed)) > IDLE_TIMEOUT_SECS {
                    break;
                }
                thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(())
}

fn handle_connection(
    mut stream: TcpStream,
    assets: Arc<EmbeddedAssets>,
    config_store: Arc<ConfigStore>,
    session: Arc<SessionState>,
    last_activity: Arc<AtomicU64>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;

    let request = read_request(&mut stream)?;
    last_activity.store(now_unix_secs(), Ordering::Relaxed);
    let path = request.path.split('?').next().unwrap_or("/");

    let response = match (request.method.as_str(), path) {
        ("GET", "/api/health") => json_response(
            200,
            &json!({
                "ok": true,
                "portable": true
            }),
        ),
        ("GET", "/api/ping") => match validate_api_request(&request, &session, false) {
            Ok(()) => Response::empty(204),
            Err(response) => response,
        },
        ("GET", "/api/config/status") => match validate_api_request(&request, &session, false) {
            Ok(()) => json_response(200, &config_store.get_status()),
            Err(response) => response,
        },
        ("POST", "/api/apply") => match validate_api_request(&request, &session, true) {
            Ok(()) => match config_store.apply_user_id(&request.body) {
                Ok(result) => json_response(200, &json!({ "ok": true, "result": result })),
                Err(error) => json_response(400, &json!({ "ok": false, "error": error })),
            },
            Err(response) => response,
        },
        ("GET", "/") | ("GET", "/index.html") => Response::ok(
            "text/html; charset=utf-8",
            assets.render_index_html(&session),
        ),
        _ => match assets.get(path) {
            Some((content_type, body)) => Response::ok(content_type, body.to_vec()),
            None => Response::text(404, "Not Found"),
        },
    };

    write_response(&mut stream, response)?;
    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut buffer = Vec::with_capacity(8192);
    let mut chunk = [0_u8; 4096];
    let header_end;

    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Unexpected end of stream.".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("Request headers too large.".to_string());
        }
    }

    let headers_raw = &buffer[..header_end];
    let headers_text = String::from_utf8_lossy(headers_raw);
    let mut lines = headers_text.split("\r\n");
    let request_line = lines.next().ok_or_else(|| "Missing request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "Missing request method.".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "Missing request path.".to_string())?
        .to_string();

    let mut headers = HashMap::new();
    let mut content_length = 0_usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let normalized_name = name.trim().to_ascii_lowercase();
            let normalized_value = value.trim().to_string();
            if normalized_name == "content-length" {
                content_length = normalized_value
                    .parse::<usize>()
                    .map_err(|_| "Invalid Content-Length.".to_string())?;
            }
            headers.insert(normalized_name, normalized_value);
        }
    }

    if content_length > MAX_BODY_BYTES {
        return Err("Request body too large.".to_string());
    }

    let body_start = header_end + 4;
    let mut body = buffer[body_start..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Unexpected end of request body.".to_string());
        }
        body.extend_from_slice(&chunk[..read]);
        if body.len() > MAX_BODY_BYTES {
            return Err("Request body too large.".to_string());
        }
    }
    body.truncate(content_length);

    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn validate_api_request(
    request: &Request,
    session: &SessionState,
    require_json: bool,
) -> Result<(), Response> {
    let token = request.header(API_TOKEN_HEADER);
    if token != Some(session.api_token.as_str()) {
        return Err(json_response(403, &json!({ "ok": false, "error": "Invalid session token." })));
    }

    if let Some(origin) = request.header("origin")
        && origin != session.origin
    {
        return Err(json_response(403, &json!({ "ok": false, "error": "Invalid request origin." })));
    }

    if require_json {
        let content_type = request
            .header("content-type")
            .map(|value| value.split(';').next().unwrap_or("").trim().to_ascii_lowercase());
        if content_type.as_deref() != Some("application/json") {
            return Err(json_response(
                400,
                &json!({ "ok": false, "error": "Content-Type must be application/json." }),
            ));
        }
    }

    Ok(())
}

fn write_response(stream: &mut TcpStream, response: Response) -> Result<(), String> {
    let status_text = match response.status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "OK",
    };

    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        response.status,
        status_text,
        response.body.len()
    );

    if let Some(content_type) = response.content_type {
        head.push_str(&format!("Content-Type: {content_type}\r\n"));
    }

    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(&response.body))
        .map_err(|error| error.to_string())
}

fn json_response(status: u16, value: &Value) -> Response {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    Response {
        status,
        content_type: Some("application/json; charset=utf-8"),
        body,
    }
}

fn configured_port() -> Option<u16> {
    env::var("BUDDY_PORTABLE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn find_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    drop(listener);
    Ok(port)
}

fn should_skip_browser() -> bool {
    env::var("BUDDY_PORTABLE_NO_BROWSER")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn open_browser(url: &str) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn app_base_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| {
            let drive = env::var_os("HOMEDRIVE")?;
            let path = env::var_os("HOMEPATH")?;
            let mut combined = PathBuf::from(drive);
            combined.push(path);
            Some(combined)
        })
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
}

fn iso_timestamp() -> String {
    format!("{}", now_unix_secs())
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn show_error(message: &str) {
    let title = to_wide("Claude Buddy Local Portable");
    let body = to_wide(message);
    unsafe {
        MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), 0x10);
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(
        h_wnd: *mut std::ffi::c_void,
        lp_text: *const u16,
        lp_caption: *const u16,
        u_type: u32,
    ) -> i32;
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }
}

struct Response {
    status: u16,
    content_type: Option<&'static str>,
    body: Vec<u8>,
}

impl Response {
    fn ok(content_type: &'static str, body: Vec<u8>) -> Self {
        Self {
            status: 200,
            content_type: Some(content_type),
            body,
        }
    }

    fn text(status: u16, body: &str) -> Self {
        Self {
            status,
            content_type: Some("text/plain; charset=utf-8"),
            body: body.as_bytes().to_vec(),
        }
    }

    fn empty(status: u16) -> Self {
        Self {
            status,
            content_type: None,
            body: Vec::new(),
        }
    }
}

struct EmbeddedAssets;

impl EmbeddedAssets {
    fn new() -> Self {
        Self
    }

    fn get(&self, raw_path: &str) -> Option<(&'static str, &'static [u8])> {
        let path = normalize_asset_path(raw_path)?;
        match path.as_str() {
            "index.html" => Some(("text/html; charset=utf-8", INDEX_HTML)),
            "app.js" => Some(("application/javascript; charset=utf-8", APP_JS)),
            "messages.js" => Some(("application/javascript; charset=utf-8", MESSAGES_JS)),
            "search-worker.js" => Some(("application/javascript; charset=utf-8", SEARCH_WORKER_JS)),
            "styles.css" => Some(("text/css; charset=utf-8", STYLES_CSS)),
            "shared/buddy-art.js" => Some(("application/javascript; charset=utf-8", BUDDY_ART_JS)),
            "shared/buddy-core.js" => Some(("application/javascript; charset=utf-8", BUDDY_CORE_JS)),
            "shared/search-plan.js" => Some(("application/javascript; charset=utf-8", SEARCH_PLAN_JS)),
            _ => None,
        }
    }

    fn render_index_html(&self, session: &SessionState) -> Vec<u8> {
        let html = String::from_utf8_lossy(INDEX_HTML);
        let token = serde_json::to_string(&session.api_token).unwrap_or_else(|_| "\"\"".to_string());
        let bootstrap = format!("<script>window.__CLAUDE_BUDDY_API_TOKEN__={token};</script>");

        if let Some(index) = html.find("</head>") {
            let mut rendered = String::with_capacity(html.len() + bootstrap.len());
            rendered.push_str(&html[..index]);
            rendered.push_str(&bootstrap);
            rendered.push_str(&html[index..]);
            return rendered.into_bytes();
        }

        format!("{bootstrap}{html}").into_bytes()
    }
}

fn normalize_asset_path(raw_path: &str) -> Option<String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return Some("index.html".to_string());
    }

    let normalized = trimmed.trim_start_matches('/');
    if normalized.is_empty() {
        return Some("index.html".to_string());
    }

    let path = normalized.replace('\\', "/");
    if path.split('/').any(|segment| segment == ".." || segment.is_empty()) {
        return None;
    }

    Some(path)
}

struct SessionState {
    api_token: String,
    origin: String,
}

impl SessionState {
    fn new(base_url: &str) -> Self {
        Self {
            api_token: format!("buddy-token-{}", unique_suffix()),
            origin: base_url.to_string(),
        }
    }
}

struct ConfigStore {
    apply_lock: Mutex<()>,
}

impl ConfigStore {
    fn new() -> Self {
        Self {
            apply_lock: Mutex::new(()),
        }
    }

    fn get_status(&self) -> Value {
        let config_path = get_claude_config_path();

        match read_config_object(&config_path) {
            Ok(parsed) => json!({
                "configPath": config_path.display().to_string(),
                "exists": true,
                "parseError": Value::Null,
                "hasUserId": parsed.get("userID").and_then(Value::as_str).map(|value| !value.trim().is_empty()).unwrap_or(false),
                "hasCompanion": parsed.get("companion").is_some(),
                "hasOAuthAccount": matches!(parsed.get("oauthAccount"), Some(Value::Object(_))),
                "hasAccountUuid": parsed
                    .get("oauthAccount")
                    .and_then(Value::as_object)
                    .and_then(|oauth| oauth.get("accountUuid"))
                    .is_some(),
                "currentUserId": parsed.get("userID").and_then(Value::as_str),
            }),
            Err(ConfigReadError::Missing) => json!({
                "configPath": config_path.display().to_string(),
                "exists": false,
                "parseError": Value::Null,
                "hasUserId": false,
                "hasCompanion": false,
                "hasOAuthAccount": false,
                "hasAccountUuid": false,
                "currentUserId": Value::Null,
            }),
            Err(ConfigReadError::Invalid(error)) => json!({
                "configPath": config_path.display().to_string(),
                "exists": true,
                "parseError": error,
                "hasUserId": false,
                "hasCompanion": false,
                "hasOAuthAccount": false,
                "hasAccountUuid": false,
                "currentUserId": Value::Null,
            }),
        }
    }

    fn apply_user_id(&self, body: &[u8]) -> Result<Value, String> {
        let _guard = self.apply_lock.lock().map_err(|_| "Apply lock poisoned.".to_string())?;
        let request: Value = serde_json::from_slice(body).map_err(|error| error.to_string())?;
        let user_id = request
            .get("userId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "userId is required.".to_string())?;
        let backup = request.get("backup").and_then(Value::as_bool).unwrap_or(true);
        let remove_companion = request
            .get("removeCompanion")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let remove_account_uuid = request
            .get("removeAccountUuid")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        let config_path = get_claude_config_path();
        let mut config = match read_config_object(&config_path) {
            Ok(parsed) => parsed,
            Err(ConfigReadError::Missing) => Map::new(),
            Err(ConfigReadError::Invalid(error)) => return Err(error),
        };

        let mut backup_path = None;
        if backup && config_path.exists() {
            let backup_name = format!("{}.buddy-backup-{}", config_path.display(), unique_suffix());
            fs::copy(&config_path, &backup_name).map_err(|error| error.to_string())?;
            backup_path = Some(backup_name);
        }

        config.insert("userID".to_string(), Value::String(user_id.to_string()));

        if remove_companion {
            config.remove("companion");
        }

        if remove_account_uuid {
            if let Some(Value::Object(oauth)) = config.get_mut("oauthAccount") {
                oauth.remove("accountUuid");
                if oauth.is_empty() {
                    config.remove("oauthAccount");
                }
            }
        }

        if let Some(parent) = config_path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let temp_path = config_path.with_extension(format!("json.tmp-{}", unique_suffix()));
        let replacement_path = config_path.with_extension(format!("json.replace-{}", unique_suffix()));

        let payload = format!(
            "{}\n",
            serde_json::to_string_pretty(&Value::Object(config.clone())).map_err(|error| error.to_string())?
        );
        fs::write(&temp_path, payload.as_bytes()).map_err(|error| error.to_string())?;

        if let Err(error) = fs::rename(&temp_path, &config_path) {
            if error.kind() != std::io::ErrorKind::AlreadyExists
                && error.kind() != std::io::ErrorKind::PermissionDenied
            {
                let _ = fs::remove_file(&temp_path);
                return Err(error.to_string());
            }

            replace_existing_file(&config_path, &temp_path, &replacement_path)?;
        }

        Ok(json!({
            "configPath": config_path.display().to_string(),
            "backupPath": backup_path,
            "userId": user_id,
            "removedCompanion": remove_companion,
            "removedAccountUuid": remove_account_uuid,
        }))
    }
}

fn get_claude_config_path() -> PathBuf {
    env::var_os("CLAUDE_CONFIG_PATH")
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".claude.json")))
        .unwrap_or_else(|| PathBuf::from(".claude.json"))
}

enum ConfigReadError {
    Missing,
    Invalid(String),
}

fn read_config_object(path: &Path) -> Result<Map<String, Value>, ConfigReadError> {
    let raw = fs::read(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ConfigReadError::Missing
        } else {
            ConfigReadError::Invalid(error.to_string())
        }
    })?;

    let normalized = strip_utf8_bom(raw);
    if normalized.trim().is_empty() {
        return Ok(Map::new());
    }

    let parsed: Value = serde_json::from_str(&normalized)
        .map_err(|error| ConfigReadError::Invalid(error.to_string()))?;
    match parsed {
        Value::Object(map) => Ok(map),
        _ => Err(ConfigReadError::Invalid(
            "Claude config root must be a JSON object.".to_string(),
        )),
    }
}

fn strip_utf8_bom(raw: Vec<u8>) -> String {
    let bytes = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &raw[3..]
    } else {
        &raw[..]
    };
    String::from_utf8_lossy(bytes).into_owned()
}

fn replace_existing_file(config_path: &Path, temp_path: &Path, replacement_path: &Path) -> Result<(), String> {
    let original_existed = config_path.exists();

    if original_existed {
        fs::rename(config_path, replacement_path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = fs::rename(temp_path, config_path) {
        if original_existed && !config_path.exists() && replacement_path.exists() {
            let _ = fs::rename(replacement_path, config_path);
        }
        let _ = fs::remove_file(temp_path);
        return Err(error.to_string());
    }

    let _ = fs::remove_file(replacement_path);
    let _ = fs::remove_file(temp_path);
    Ok(())
}

fn unique_suffix() -> String {
    let counter = NEXT_UNIQUE_ID.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", std::process::id(), now_unix_millis(), counter)
}

fn now_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
