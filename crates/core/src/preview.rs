use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const PREVIEW_BYTE_CAP: usize = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChangeRow {
    pub label: String,
    pub path: String,
}

#[derive(Debug)]
pub enum Confined {
    Inside(PathBuf),
    Outside,
    Missing,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub kind: String,
    pub text: Option<String>,
    pub truncated: bool,
    pub error: Option<String>,
    pub mtime_ms: Option<u64>,
}

pub fn parse_porcelain(bytes: &[u8]) -> Vec<ChangeRow> {
    let text = String::from_utf8_lossy(bytes);
    let parts: Vec<&str> = text.split('\0').filter(|part| !part.is_empty()).collect();
    let mut rows = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let record = parts[index];
        if record.len() < 3 {
            index += 1;
            continue;
        }
        let x = record.as_bytes()[0];
        let y = record.as_bytes()[1];
        let path = record[3..].to_string();
        let renamed = x == b'R' || y == b'R';
        let copied = x == b'C' || y == b'C';
        let (label, path) = if renamed || copied {
            index += 1;
            let next = parts.get(index).copied().unwrap_or("").to_string();
            if renamed { ("renamed", next) } else { ("added", next) }
        } else if x == b'D' || y == b'D' {
            ("deleted", path)
        } else if x == b'A' || y == b'A' || x == b'?' || y == b'?' {
            ("added", path)
        } else {
            ("modified", path)
        };
        rows.push(ChangeRow { label: label.to_string(), path });
        index += 1;
    }
    rows
}

pub fn confine(folder: &Path, raw: &str) -> Confined {
    let Ok(folder) = folder.canonicalize() else {
        return Confined::Outside;
    };
    let joined = if Path::new(raw).is_absolute() { PathBuf::from(raw) } else { folder.join(raw) };
    match joined.canonicalize() {
        Err(_) => Confined::Missing,
        Ok(path) if path == folder || path.starts_with(&folder) => {
            if path.is_dir() { Confined::Directory } else { Confined::Inside(path) }
        }
        Ok(_) => Confined::Outside,
    }
}

pub fn preview_file(folder: &Path, raw: &str) -> PreviewFile {
    let path = match confine(folder, raw) {
        Confined::Inside(path) => path,
        Confined::Outside => return empty("outside"),
        Confined::Missing => return empty("missing"),
        Confined::Directory => return empty("directory"),
    };
    let mtime_ms = modified_ms(&path);
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) => return errored(error.to_string()),
    };
    let mut bytes = Vec::new();
    if let Err(error) = file.take(PREVIEW_BYTE_CAP as u64 + 1).read_to_end(&mut bytes) {
        return errored(error.to_string());
    }
    let truncated = bytes.len() > PREVIEW_BYTE_CAP;
    if truncated {
        bytes.truncate(PREVIEW_BYTE_CAP);
    }
    if bytes.contains(&0) {
        return PreviewFile { kind: "binary".into(), text: None, truncated: false, error: None, mtime_ms };
    }
    let kind = if path.extension().and_then(|ext| ext.to_str()) == Some("md") { "markdown" } else { "text" };
    PreviewFile {
        kind: kind.into(),
        text: Some(String::from_utf8_lossy(&bytes).into_owned()),
        truncated,
        error: None,
        mtime_ms,
    }
}

fn empty(kind: &str) -> PreviewFile {
    PreviewFile { kind: kind.into(), text: None, truncated: false, error: None, mtime_ms: None }
}

fn errored(message: String) -> PreviewFile {
    PreviewFile { kind: "error".into(), text: None, truncated: false, error: Some(message), mtime_ms: None }
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = path.metadata().ok()?.modified().ok()?;
    u64::try_from(modified.duration_since(UNIX_EPOCH).ok()?.as_millis()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn row(label: &str, path: &str) -> ChangeRow {
        ChangeRow { label: label.to_string(), path: path.to_string() }
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lowai-preview-{name}-{stamp}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn porcelain_labels_and_rename_keep_the_new_path() {
        let bytes = b" M src/a.ts\0?? notes/food.md\0D  gone.md\0R  from.ts\0to.ts\0";
        let rows = parse_porcelain(bytes);
        assert_eq!(rows[0], row("modified", "src/a.ts"));
        assert_eq!(rows[1], row("added", "notes/food.md"));
        assert_eq!(rows[2], row("deleted", "gone.md"));
        assert_eq!(rows[3], row("renamed", "to.ts"));
        assert_eq!(rows.len(), 4);
    }

    #[test]
    fn confine_rejects_parent_and_outside_symlink() {
        let root = scratch("confine");
        let folder = root.join("session");
        fs::create_dir_all(folder.join("inner")).unwrap();
        let outside = root.join("outside.txt");
        fs::write(&outside, "nope").unwrap();
        symlink(&outside, folder.join("inner/link")).unwrap();
        assert!(matches!(confine(&folder, "../outside.txt"), Confined::Outside));
        assert!(matches!(confine(&folder, "inner/link"), Confined::Outside));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn preview_file_classifies_bytes() {
        let folder = scratch("bytes");
        fs::write(folder.join("hello.rs"), "fn main() {}").unwrap();
        fs::write(folder.join("note.md"), "# Soup").unwrap();
        fs::write(folder.join("bin.dat"), [b'a', 0, b'b']).unwrap();
        fs::create_dir(folder.join("subdir")).unwrap();
        let big = vec![b'a'; PREVIEW_BYTE_CAP + 10];
        fs::write(folder.join("big.txt"), &big).unwrap();
        assert_eq!(preview_file(&folder, "hello.rs").kind, "text");
        let big_file = preview_file(&folder, "big.txt");
        assert_eq!(big_file.kind, "text");
        assert!(big_file.truncated);
        assert_eq!(big_file.text.unwrap().len(), PREVIEW_BYTE_CAP);
        assert_eq!(preview_file(&folder, "bin.dat").kind, "binary");
        assert!(preview_file(&folder, "bin.dat").text.is_none());
        assert_eq!(preview_file(&folder, "subdir").kind, "directory");
        assert_eq!(preview_file(&folder, "missing.md").kind, "missing");
        assert_eq!(preview_file(&folder, "note.md").kind, "markdown");
        let _ = fs::remove_dir_all(&folder);
    }
}
