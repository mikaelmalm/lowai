use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

const PATH_START: &str = "___PATH_START___";
const PATH_END: &str = "___PATH_END___";
const BUNDLE_ID: &str = "com.malm.lowai";

pub fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return home();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return home().join(rest);
    }
    PathBuf::from(path)
}

pub fn state_dir() -> PathBuf {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let xdg = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
    state_dir_for(host_os(), &home(), appdata.as_deref(), xdg.as_deref())
}

pub fn state_dir_for(os: &str, home: &Path, appdata: Option<&Path>, xdg_data_home: Option<&Path>) -> PathBuf {
    match os {
        "macos" => home.join("Library/Application Support").join(BUNDLE_ID),
        "windows" => appdata
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(&home.join("AppData").join("Roaming"))
            .join(BUNDLE_ID),
        _ => {
            let base = xdg_data_home
                .filter(|path| !path.as_os_str().is_empty())
                .map(Path::to_path_buf)
                .unwrap_or_else(|| home.join(".local/share"));
            base.join(BUNDLE_ID)
        }
    }
}

pub fn allow_navigation(url: &str, dev: bool) -> bool {
    // macOS and Linux serve the release build as tauri://localhost.
    // Windows and Android serve it as http://tauri.localhost or https://tauri.localhost.
    if app_origin(url) {
        return true;
    }
    dev && (url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1"))
}

fn app_origin(url: &str) -> bool {
    const PREFIXES: [&str; 3] = [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ];
    PREFIXES.iter().any(|prefix| {
        let Some(rest) = url.strip_prefix(prefix) else {
            return false;
        };
        rest.is_empty() || matches!(rest.as_bytes().first(), Some(b'/' | b'?' | b'#' | b':'))
    })
}

pub fn parse_marked_path(output: &str) -> Option<String> {
    marked_body(output).and_then(|body| body.lines().map(str::trim).find(|line| !line.is_empty()).map(str::to_string))
}

pub fn parse_marked_lines(output: &str) -> Option<String> {
    let body = marked_body(output)?;
    let joined = body
        .split(|ch: char| ch == '\n' || ch == '\r')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(";");
    if joined.is_empty() { None } else { Some(joined) }
}

fn marked_body(output: &str) -> Option<&str> {
    let start = output.rfind(PATH_START)? + PATH_START.len();
    let rest = &output[start..];
    let end = rest.find(PATH_END)?;
    Some(&rest[..end])
}

pub fn host_os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

pub fn find_on_path(os: &str, path: &str, name: &str, is_file: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let delimiter = if os == "windows" { ';' } else { ':' };
    for dir in path.split(delimiter) {
        if dir.is_empty() {
            continue;
        }
        for file in cli_file_names(os, name) {
            let candidate = Path::new(dir).join(&file);
            if is_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn cli_file_names(os: &str, name: &str) -> Vec<String> {
    if os != "windows" {
        return vec![name.to_string()];
    }
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".exe") || lower.ends_with(".cmd") || lower.ends_with(".bat") {
        vec![name.to_string()]
    } else {
        vec![format!("{name}.exe"), format!("{name}.cmd"), name.to_string()]
    }
}

pub fn grok_fallbacks(home: &Path) -> [PathBuf; 2] {
    [home.join(".grok/bin/grok"), home.join(".grok/bin/grok.exe")]
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CliBin {
    Native(PathBuf),
    Wsl(String),
}

pub struct CliSpawn {
    pub program: PathBuf,
    pub args_prefix: Vec<String>,
    pub current_dir: Option<PathBuf>,
}

pub fn windows_to_wsl(path: &Path) -> Option<String> {
    let text = strip_verbatim(&path.to_string_lossy().replace('/', "\\"));
    let lower = text.to_ascii_lowercase();
    for prefix in ["\\\\wsl$\\", "\\\\wsl.localhost\\"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let rest = &text[text.len() - rest.len()..];
            let (_distro, linux) = rest.split_once('\\')?;
            if linux.is_empty() {
                return None;
            }
            return Some(format!("/{}", linux.replace('\\', "/")));
        }
    }
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        let letter = (bytes[0] as char).to_ascii_lowercase();
        let rest = if bytes.len() > 2 && (bytes[2] == b'\\' || bytes[2] == b'/') {
            text[3..].replace('\\', "/")
        } else if bytes.len() == 2 {
            String::new()
        } else {
            return None;
        };
        if rest.is_empty() {
            return Some(format!("/mnt/{letter}"));
        }
        return Some(format!("/mnt/{letter}/{rest}"));
    }
    if text.starts_with('/') || (text.starts_with('\\') && !text.starts_with("\\\\")) {
        let slash = text.replace('\\', "/");
        if slash.starts_with('/') {
            return Some(slash);
        }
    }
    None
}

#[cfg(any(windows, test))]
pub fn parse_wsl_bins(output: &str) -> Vec<(String, String)> {
    let marker = "___WSL_START___";
    let Some(start_at) = output.rfind(marker) else { return Vec::new() };
    let rest = &output[start_at + marker.len()..];
    let Some(end) = rest.find("___WSL_END___") else { return Vec::new() };
    let mut found = Vec::new();
    for line in rest[..end].lines() {
        let Some((name, path)) = line.trim().split_once('\t') else { continue };
        let path = path.trim();
        if path.starts_with('/') {
            found.push((name.trim().to_string(), path.to_string()));
        }
    }
    found
}

pub fn cli_workdir(bin: &CliBin, cwd: &Path) -> PathBuf {
    match bin {
        CliBin::Native(_) => cwd.to_path_buf(),
        CliBin::Wsl(_) => windows_to_wsl(cwd).map(PathBuf::from).unwrap_or_else(|| cwd.to_path_buf()),
    }
}

pub fn cli_spawn(bin: &CliBin, cwd: &Path) -> CliSpawn {
    match bin {
        CliBin::Native(path) => CliSpawn {
            program: path.clone(),
            args_prefix: Vec::new(),
            current_dir: Some(cwd.to_path_buf()),
        },
        CliBin::Wsl(linux_bin) => CliSpawn {
            program: PathBuf::from("wsl.exe"),
            args_prefix: vec!["--cd".into(), cwd.display().to_string(), "--".into(), linux_bin.clone()],
            current_dir: None,
        },
    }
}

pub fn listed_agents(present: impl Fn(&str) -> bool) -> Vec<&'static str> {
    ["grok", "agy", "claude"].into_iter().filter(|name| present(name)).collect()
}

pub fn resolve_cli(name: &str) -> Result<CliBin, String> {
    if let Some(path) = login_path() {
        if let Some(found) = find_on_path(host_os(), &path, name, |candidate| candidate.is_file()) {
            return Ok(CliBin::Native(found));
        }
    }
    if name == "grok" {
        for fallback in grok_fallbacks(&home()) {
            if fallback.is_file() {
                return Ok(CliBin::Native(fallback));
            }
        }
    }
    if let Some(linux_bin) = wsl_bins().get(name) {
        return Ok(CliBin::Wsl(linux_bin.clone()));
    }
    Err(format!("could not find `{name}` on PATH"))
}

pub fn available_agents() -> Vec<String> {
    listed_agents(|name| resolve_cli(name).is_ok()).into_iter().map(str::to_string).collect()
}

pub fn resolve_grok() -> Result<CliBin, String> {
    resolve_cli("grok")
}

fn wsl_bins() -> HashMap<String, String> {
    #[cfg(windows)]
    {
        static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();
        return CACHE.get_or_init(probe_wsl).clone();
    }
    #[cfg(not(windows))]
    {
        HashMap::new()
    }
}

#[cfg(windows)]
fn probe_wsl() -> HashMap<String, String> {
    let script = r#"
if [ -n "$SHELL" ] && [ -x "$SHELL" ]; then
  exec "$SHELL" -ilc 'printf "%s\n" ___WSL_START___; for name in grok agy claude; do found=$(command -v "$name" 2>/dev/null || true); if [ "$name" = grok ] && [ ! -x "$found" ] && [ -x "$HOME/.grok/bin/grok" ]; then found="$HOME/.grok/bin/grok"; fi; printf "%s\t%s\n" "$name" "$found"; done; printf "%s\n" ___WSL_END___'
fi
printf "%s\n" ___WSL_START___
for name in grok agy claude; do
  found=$(command -v "$name" 2>/dev/null || true)
  if [ "$name" = grok ] && [ ! -x "$found" ] && [ -x "$HOME/.grok/bin/grok" ]; then found="$HOME/.grok/bin/grok"; fi
  printf "%s\t%s\n" "$name" "$found"
done
printf "%s\n" ___WSL_END___
"#;
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-e", "sh", "-c", script]).stdin(std::process::Stdio::null());
    // A login profile often exits non-zero after the probe has already printed.
    let Ok(output) = capture(cmd, Duration::from_secs(15), true) else {
        return HashMap::new();
    };
    let text = String::from_utf8_lossy(&output);
    parse_wsl_bins(&text).into_iter().collect()
}

fn login_path() -> Option<String> {
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE.get_or_init(read_login_path).clone()
}

fn read_login_path() -> Option<String> {
    #[cfg(windows)]
    {
        return windows_path().or_else(|| std::env::var("PATH").ok().filter(|path| !path.is_empty()));
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let script = format!("echo {PATH_START}; printf '%s\\n' \"$PATH\"; echo {PATH_END}");
        let mut cmd = Command::new(shell);
        cmd.args(["-ilc", &script]).stdin(std::process::Stdio::null());
        let output = run_with_timeout(cmd, Duration::from_secs(8)).ok()?;
        let text = String::from_utf8_lossy(&output);
        parse_marked_lines(&text)
    }
}

fn strip_verbatim(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("\\\\?\\unc\\") {
        return format!("\\\\{}", &text[text.len() - rest.len()..]);
    }
    if let Some(rest) = lower.strip_prefix("\\\\?\\") {
        return text[text.len() - rest.len()..].to_string();
    }
    text.to_string()
}

#[cfg(windows)]
fn windows_path() -> Option<String> {
    let script = format!(
        "Write-Output '{PATH_START}'; Write-Output ([Environment]::GetEnvironmentVariable('Path','User')); Write-Output ([Environment]::GetEnvironmentVariable('Path','Machine')); Write-Output '{PATH_END}'"
    );
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]).stdin(std::process::Stdio::null());
    let output = run_with_timeout(cmd, Duration::from_secs(8)).ok()?;
    let text = String::from_utf8_lossy(&output);
    parse_marked_lines(&text)
}

fn run_with_timeout(cmd: Command, limit: Duration) -> std::io::Result<Vec<u8>> {
    capture(cmd, limit, false)
}

fn capture(mut cmd: Command, limit: Duration, keep_failure: bool) -> std::io::Result<Vec<u8>> {
    let mut child = cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn()?;
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            let mut buf = Vec::new();
            if let Some(mut out) = child.stdout.take() {
                use std::io::Read;
                out.read_to_end(&mut buf)?;
            }
            if !status.success() && !keep_failure {
                return Err(std::io::Error::other("login shell failed"));
            }
            return Ok(buf);
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            return Err(std::io::Error::other("login shell timed out"));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marked_path_ignores_shell_noise() {
        let output = "welcome\n___PATH_START___\n/usr/bin:/home/me/.grok/bin\n___PATH_END___\nbye\n";
        assert_eq!(
            parse_marked_path(output).as_deref(),
            Some("/usr/bin:/home/me/.grok/bin")
        );
    }

    #[test]
    fn navigation_allows_the_app_origin() {
        assert!(allow_navigation("tauri://localhost/", false));
        assert!(allow_navigation("http://tauri.localhost/", false));
        assert!(allow_navigation("https://tauri.localhost/index.html", false));
        assert!(allow_navigation("http://tauri.localhost:80/", false));
        assert!(!allow_navigation("http://tauri.localhost.evil/", false));
        assert!(!allow_navigation("https://example.com", false));
        assert!(allow_navigation("http://localhost:1420/", true));
        assert!(!allow_navigation("http://localhost:1420/", false));
    }

    #[test]
    fn listed_agents_keep_order_and_can_be_empty() {
        assert_eq!(listed_agents(|name| name != "claude"), vec!["grok", "agy"]);
        assert!(listed_agents(|_| false).is_empty());
    }

    #[test]
    fn windows_path_joins_user_and_machine_lines() {
        let output = "noise\n___PATH_START___\r\nC:\\Users\\me\\bin\r\nC:\\Windows\r\n___PATH_END___\n";
        assert_eq!(
            parse_marked_lines(output).as_deref(),
            Some("C:\\Users\\me\\bin;C:\\Windows")
        );
    }

    #[test]
    fn find_on_path_uses_semicolons_and_exe_names() {
        let root = std::env::temp_dir().join(format!("aishell-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("bin")).unwrap();
        std::fs::write(root.join("bin/agy"), b"").unwrap();
        std::fs::write(root.join("bin/grok.exe"), b"").unwrap();
        let unix = find_on_path("linux", &format!("{}:/missing", root.join("bin").display()), "agy", |path| path.is_file());
        assert_eq!(unix, Some(root.join("bin/agy")));
        let windows = find_on_path("windows", &format!("{};C:\\missing", root.join("bin").display()), "grok", |path| path.is_file());
        assert_eq!(windows, Some(root.join("bin/grok.exe")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn state_dirs_follow_the_platform() {
        let home = Path::new("/home/me");
        assert_eq!(
            state_dir_for("linux", home, None, None),
            PathBuf::from("/home/me/.local/share/com.malm.lowai")
        );
        assert_eq!(
            state_dir_for("macos", home, None, None),
            PathBuf::from("/home/me/Library/Application Support/com.malm.lowai")
        );
        assert_eq!(
            state_dir_for("windows", home, Some(Path::new("C:/Users/me/AppData/Roaming")), None),
            PathBuf::from("C:/Users/me/AppData/Roaming/com.malm.lowai")
        );
    }

    #[test]
    fn wsl_paths_cover_drives_and_unc() {
        assert_eq!(windows_to_wsl(Path::new("C:\\work\\app")).as_deref(), Some("/mnt/c/work/app"));
        assert_eq!(windows_to_wsl(Path::new("D:/Tools")).as_deref(), Some("/mnt/d/Tools"));
        assert_eq!(
            windows_to_wsl(Path::new("\\\\wsl$\\Ubuntu\\home\\malm\\code")).as_deref(),
            Some("/home/malm/code")
        );
        assert_eq!(
            windows_to_wsl(Path::new("//wsl.localhost/Ubuntu/home/malm")).as_deref(),
            Some("/home/malm")
        );
        assert!(windows_to_wsl(Path::new("work")).is_none());
        assert_eq!(
            windows_to_wsl(Path::new(r"\\?\C:\Program Files\lowai.exe")).as_deref(),
            Some("/mnt/c/Program Files/lowai.exe")
        );
        assert_eq!(
            windows_to_wsl(Path::new(r"\\?\UNC\wsl$\Ubuntu\home\malm\code")).as_deref(),
            Some("/home/malm/code")
        );
    }

    #[test]
    fn wsl_probe_keeps_absolute_bins_only() {
        let output = "noise\n___WSL_START___\ngrok\t/home/malm/.grok/bin/grok\nagy\talias\nclaude\t\n___WSL_END___\n";
        assert_eq!(
            parse_wsl_bins(output),
            vec![("grok".into(), "/home/malm/.grok/bin/grok".into())]
        );
    }

    #[test]
    fn wsl_spawn_uses_wsl_exe_and_the_linux_cwd() {
        let bin = CliBin::Wsl("/home/malm/.local/bin/agy".into());
        let cwd = cli_workdir(&bin, Path::new("C:\\work\\app"));
        assert_eq!(cwd, PathBuf::from("/mnt/c/work/app"));
        let spawn = cli_spawn(&bin, &cwd);
        assert_eq!(spawn.program, PathBuf::from("wsl.exe"));
        assert_eq!(
            spawn.args_prefix,
            vec!["--cd", "/mnt/c/work/app", "--", "/home/malm/.local/bin/agy"]
        );
        assert!(spawn.current_dir.is_none());
        let native = cli_spawn(&CliBin::Native(PathBuf::from("C:\\grok.exe")), Path::new("C:\\work"));
        assert_eq!(native.program, PathBuf::from("C:\\grok.exe"));
        assert!(native.args_prefix.is_empty());
        assert_eq!(native.current_dir.as_deref(), Some(Path::new("C:\\work")));
    }

    #[test]
    fn tilde_expands_from_home() {
        let home = home();
        assert_eq!(expand_tilde("~/code"), home.join("code"));
        assert_eq!(expand_tilde("/tmp/x"), PathBuf::from("/tmp/x"));
    }
}
