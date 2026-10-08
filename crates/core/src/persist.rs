use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum LoadOutcome {
    Missing,
    Ok(String),
    Corrupt { backup: PathBuf },
    IoError(String),
}

pub fn load_state(path: &Path) -> LoadOutcome {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return LoadOutcome::Missing,
        Err(err) => return LoadOutcome::IoError(err.to_string()),
    };
    match String::from_utf8(bytes) {
        Ok(text) if serde_json::from_str::<serde_json::Value>(&text).is_ok() => LoadOutcome::Ok(text),
        _ => match quarantine(path) {
            Ok(backup) => LoadOutcome::Corrupt { backup },
            Err(err) => LoadOutcome::IoError(err),
        },
    }
}

pub fn save_state(path: &Path, json: &str) -> Result<(), String> {
    if serde_json::from_str::<serde_json::Value>(json).is_err() {
        return Err("refusing to save invalid json".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn quarantine(path: &Path) -> Result<PathBuf, String> {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let backup = path.with_file_name(format!("state.corrupt-{secs}.json"));
    fs::rename(path, &backup).map_err(|e| e.to_string())?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("ai-shell-state-{}", std::process::id()));
        let _ = fs::create_dir_all(&path);
        path
    }

    #[test]
    fn round_trip_and_temp_removed() {
        let path = dir().join("state.json");
        save_state(&path, r#"{"ok":true}"#).unwrap();
        assert!(!path.with_extension("json.tmp").exists());
        match load_state(&path) {
            LoadOutcome::Ok(text) => assert!(text.contains("ok")),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn corrupt_file_is_quarantined() {
        let path = dir().join("bad.json");
        fs::write(&path, b"not json").unwrap();
        match load_state(&path) {
            LoadOutcome::Corrupt { backup } => {
                assert!(backup.exists());
                assert!(!path.exists());
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
