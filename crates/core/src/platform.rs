use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const PATH_START: &str = "___PATH_START___";
const PATH_END: &str = "___PATH_END___";
const BUNDLE_ID: &str = "com.malm.aishell";

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
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support").join(BUNDLE_ID)
    } else {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| home().join(".local/share"));
        base.join(BUNDLE_ID)
    }
}

pub fn allow_navigation(url: &str, dev: bool) -> bool {
    if url.starts_with("tauri://localhost") {
        return true;
    }
    dev && (url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1"))
}

pub fn parse_marked_path(output: &str) -> Option<String> {
    let start = output.rfind(PATH_START)? + PATH_START.len();
    let rest = &output[start..];
    let end = rest.find(PATH_END)?;
    let path = rest[..end].lines().map(str::trim).find(|l| !l.is_empty())?;
    if path.is_empty() { None } else { Some(path.to_string()) }
}

pub fn resolve_grok() -> Result<PathBuf, String> {
    if let Some(path) = login_path() {
        for dir in path.split(':') {
            let candidate = Path::new(dir).join("grok");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    let fallback = home().join(".grok/bin/grok");
    if fallback.is_file() {
        return Ok(fallback);
    }
    Err("could not find `grok` on PATH".into())
}

fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let script = format!("echo {PATH_START}; printf '%s\\n' \"$PATH\"; echo {PATH_END}");
    let mut cmd = Command::new(shell);
    cmd.args(["-ilc", &script]).stdin(std::process::Stdio::null());
    let output = run_with_timeout(cmd, Duration::from_secs(8)).ok()?;
    let text = String::from_utf8_lossy(&output);
    parse_marked_path(&text)
}

fn run_with_timeout(mut cmd: Command, limit: Duration) -> std::io::Result<Vec<u8>> {
    let mut child = cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn()?;
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err(std::io::Error::other("login shell failed"));
            }
            let mut buf = Vec::new();
            if let Some(mut out) = child.stdout.take() {
                use std::io::Read;
                out.read_to_end(&mut buf)?;
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
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"))
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
        assert!(!allow_navigation("https://example.com", false));
        assert!(allow_navigation("http://localhost:1420/", true));
        assert!(!allow_navigation("http://localhost:1420/", false));
    }

    #[test]
    fn tilde_expands_from_home() {
        let home = home();
        assert_eq!(expand_tilde("~/code"), home.join("code"));
        assert_eq!(expand_tilde("/tmp/x"), PathBuf::from("/tmp/x"));
    }
}
