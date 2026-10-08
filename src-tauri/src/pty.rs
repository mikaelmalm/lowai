use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub type Subscriber = Arc<dyn Fn(Vec<u8>) -> bool + Send + Sync>;
pub type ExitHook = Arc<dyn Fn(Option<i32>) + Send + Sync>;

pub fn resolve_shell(shell: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = shell.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(value));
    }
    let os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    fallback_shell(os, |path| Path::new(path).is_file())
}

pub fn fallback_shell(os: &str, exists: impl Fn(&str) -> bool) -> Result<PathBuf, String> {
    let candidates: &[&str] = match os {
        "windows" => return Ok(PathBuf::from("powershell.exe")),
        "macos" => &["/bin/zsh", "/bin/bash"],
        _ => &["/bin/bash", "/bin/zsh"],
    };
    candidates
        .iter()
        .copied()
        .find(|path| exists(path))
        .map(PathBuf::from)
        .ok_or_else(|| "SHELL is unset and no shell was found".into())
}

type MasterSlot = Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>;

struct Live {
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
    master: MasterSlot,
    subscribers: Arc<Mutex<Vec<Subscriber>>>,
    explicit_close: Arc<AtomicBool>,
}

pub struct PtyHost {
    inner: Arc<Mutex<HashMap<String, Live>>>,
}

impl PtyHost {
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn open(&self, id: &str, cwd: &Path, shell: &Path, on_data: Subscriber, on_exit: ExitHook) -> Result<(), String> {
        if !cwd.is_dir() {
            return Err(format!("{} is not a directory", cwd.display()));
        }
        let mut guard = self.inner.lock().map_err(|err| err.to_string())?;
        if let Some(live) = guard.get(id) {
            live.subscribers.lock().map_err(|err| err.to_string())?.push(on_data);
            return Ok(());
        }
        let size = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).map_err(|err| err.to_string())?;
        let mut command = CommandBuilder::new(shell);
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        let mut child = pair.slave.spawn_command(command).map_err(|err| err.to_string())?;
        let killer = child.clone_killer();
        let reader = pair.master.try_clone_reader().map_err(|err| err.to_string())?;
        let writer = pair.master.take_writer().map_err(|err| err.to_string())?;
        let subscribers = Arc::new(Mutex::new(vec![on_data]));
        let explicit_close = Arc::new(AtomicBool::new(false));
        let master: MasterSlot = Arc::new(Mutex::new(Some(pair.master)));
        guard.insert(
            id.to_string(),
            Live {
                writer: Mutex::new(writer),
                killer: Mutex::new(killer),
                master: master.clone(),
                subscribers: subscribers.clone(),
                explicit_close: explicit_close.clone(),
            },
        );
        drop(guard);
        spawn_reader(reader, subscribers);
        let map = self.inner.clone();
        let session_id = id.to_string();
        thread::spawn(move || {
            let status = child.wait().ok();
            let code = status.map(|status| status.exit_code() as i32);
            if explicit_close.load(Ordering::SeqCst) {
                return;
            }
            if let Ok(mut guard) = map.lock() {
                if let Some(live) = guard.remove(&session_id) {
                    if let Ok(mut slot) = live.master.lock() {
                        slot.take();
                    }
                }
            }
            on_exit(code);
        });
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|err| err.to_string())?;
        let live = guard.get(id).ok_or_else(|| format!("no live shell for {id}"))?;
        let mut writer = live.writer.lock().map_err(|err| err.to_string())?;
        writer.write_all(data).map_err(|err| err.to_string())?;
        writer.flush().map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols < 1 || rows < 1 {
            return Err("cols and rows must be at least 1".into());
        }
        let guard = self.inner.lock().map_err(|err| err.to_string())?;
        let live = guard.get(id).ok_or_else(|| format!("no live shell for {id}"))?;
        let slot = live.master.lock().map_err(|err| err.to_string())?;
        let master = slot.as_ref().ok_or_else(|| format!("no live shell for {id}"))?;
        master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|err| err.to_string())
    }

    pub fn close(&self, id: &str) {
        let removed = self.inner.lock().ok().and_then(|mut guard| guard.remove(id));
        if let Some(live) = removed {
            live.explicit_close.store(true, Ordering::SeqCst);
            if let Ok(mut killer) = live.killer.lock() {
                let _ = killer.kill();
            }
            if let Ok(mut slot) = live.master.lock() {
                slot.take();
            }
        }
    }
}

impl Drop for PtyHost {
    fn drop(&mut self) {
        let ids: Vec<String> = self.inner.lock().map(|guard| guard.keys().cloned().collect()).unwrap_or_default();
        for id in ids {
            self.close(&id);
        }
    }
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, subscribers: Arc<Mutex<Vec<Subscriber>>>) {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            let count = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(count) => count,
            };
            let chunk = buf[..count].to_vec();
            let mut list = match subscribers.lock() {
                Ok(list) => list,
                Err(_) => break,
            };
            let chunk_for_subscribers = chunk;
            list.retain(|subscriber| subscriber(chunk_for_subscribers.clone()));
        }
    });
}

#[cfg(test)]
fn wait_for(mut probe: impl FnMut() -> bool) -> bool {
    use std::time::{Duration, Instant};
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if probe() {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::fs;

    fn temp_dir() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("ai-shell-pty-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn collect() -> (Subscriber, Arc<Mutex<Vec<u8>>>) {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let clone = bytes.clone();
        let subscriber: Subscriber = Arc::new(move |chunk| {
            clone.lock().unwrap().extend(chunk);
            true
        });
        (subscriber, bytes)
    }

    #[test]
    fn resolve_shell_uses_an_explicit_path_and_the_platform_default() {
        assert_eq!(resolve_shell(Some("/bin/sh")).unwrap(), PathBuf::from("/bin/sh"));
        let resolved = resolve_shell(None).unwrap();
        if cfg!(windows) {
            assert_eq!(resolved, PathBuf::from("powershell.exe"));
        } else if cfg!(target_os = "macos") {
            assert!(resolved.ends_with("zsh") || resolved.ends_with("bash"));
        } else {
            assert_eq!(resolved, PathBuf::from("/bin/bash"));
        }
        assert_eq!(resolve_shell(Some("")).unwrap(), resolved);
    }

    #[test]
    fn fallback_shell_picks_powershell_zsh_or_bash() {
        let missing = |_: &str| false;
        let present = |_: &str| true;
        assert_eq!(fallback_shell("windows", missing).unwrap(), PathBuf::from("powershell.exe"));
        assert_eq!(fallback_shell("macos", present).unwrap(), PathBuf::from("/bin/zsh"));
        assert_eq!(fallback_shell("linux", present).unwrap(), PathBuf::from("/bin/bash"));
        assert!(fallback_shell("linux", missing).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn echo_round_trip_and_binary_byte() {
        let host = PtyHost::new();
        let dir = temp_dir();
        let (on_data, bytes) = collect();
        host.open("s", &dir, Path::new("/bin/sh"), on_data, Arc::new(|_| {})).unwrap();
        host.write("s", b"printf 'hi\\377\\n'\n").unwrap();
        assert!(wait_for(|| bytes.lock().unwrap().windows(2).any(|pair| pair == b"hi")));
        assert!(bytes.lock().unwrap().contains(&0xff), "{:?}", bytes.lock().unwrap());
        host.close("s");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn second_open_fans_out_on_the_same_shell() {
        let host = PtyHost::new();
        let dir = temp_dir();
        let (first, first_bytes) = collect();
        let (second, second_bytes) = collect();
        host.open("s", &dir, Path::new("/bin/sh"), first, Arc::new(|_| {})).unwrap();
        host.open("s", &dir, Path::new("/bin/sh"), second, Arc::new(|_| {})).unwrap();
        host.write("s", b"printf 'both\\n'\n").unwrap();
        assert!(wait_for(|| first_bytes.lock().unwrap().windows(4).any(|item| item == b"both")));
        assert!(wait_for(|| second_bytes.lock().unwrap().windows(4).any(|item| item == b"both")));
        host.close("s");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn close_is_idempotent_and_write_then_fails() {
        let host = PtyHost::new();
        let dir = temp_dir();
        let (on_data, _) = collect();
        host.open("s", &dir, Path::new("/bin/sh"), on_data, Arc::new(|_| {})).unwrap();
        host.close("s");
        host.close("s");
        assert!(host.write("s", b"printf\n").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn shell_exit_removes_it_and_reports_the_code() {
        let host = PtyHost::new();
        let dir = temp_dir();
        let (on_data, _) = collect();
        let code = Arc::new(Mutex::new(None));
        let slot = code.clone();
        host.open(
            "s",
            &dir,
            Path::new("/bin/sh"),
            on_data,
            Arc::new(move |status| *slot.lock().unwrap() = Some(status)),
        )
        .unwrap();
        host.write("s", b"exit 7\n").unwrap();
        assert!(wait_for(|| code.lock().unwrap().is_some()));
        assert_eq!(*code.lock().unwrap(), Some(Some(7)));
        assert!(host.write("s", b"x").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn missing_directory_leaves_no_shell() {
        let host = PtyHost::new();
        let missing = std::env::temp_dir().join("ai-shell-pty-missing-dir");
        let _ = fs::remove_dir_all(&missing);
        let (on_data, _) = collect();
        let error = host.open("s", &missing, Path::new("/bin/sh"), on_data, Arc::new(|_| {})).unwrap_err();
        assert!(error.contains("not a directory"), "{error}");
        assert!(host.write("s", b"x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn resize_rejects_zero() {
        let host = PtyHost::new();
        let dir = temp_dir();
        let (on_data, _) = collect();
        host.open("s", &dir, Path::new("/bin/sh"), on_data, Arc::new(|_| {})).unwrap();
        assert!(host.resize("s", 0, 24).is_err());
        assert!(host.resize("s", 40, 12).is_ok());
        host.close("s");
        let _ = fs::remove_dir_all(dir);
    }
}
