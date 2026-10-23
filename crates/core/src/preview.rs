use serde::Serialize;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitChanges {
    pub repo: bool,
    pub rows: Vec<ChangeRow>,
}

pub fn git_changes(cwd: &Path) -> GitChanges {
    if !cwd.is_dir() {
        return GitChanges { repo: false, rows: Vec::new() };
    }
    let Ok(output) = Command::new("git").args(["status", "--porcelain", "-z"]).current_dir(cwd).output() else {
        return GitChanges { repo: false, rows: Vec::new() };
    };
    if !output.status.success() {
        return GitChanges { repo: false, rows: Vec::new() };
    }
    GitChanges { repo: true, rows: parse_porcelain(&output.stdout) }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub dir: bool,
}

pub fn list_mention_dir(cwd: &Path, relative: &str) -> Vec<DirEntry> {
    let relative = relative.replace('\\', "/");
    if relative.is_empty() || absolute_mention(&relative) || relative.contains('\0') || !cwd.is_dir() {
        return Vec::new();
    }
    let Ok(read) = fs::read_dir(cwd.join(&relative)) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        entries.push(DirEntry { dir: entry.path().is_dir(), name });
    }
    entries.sort_by(|left, right| right.dir.cmp(&left.dir).then_with(|| left.name.cmp(&right.name)));
    entries
}

fn absolute_mention(relative: &str) -> bool {
    relative.starts_with('/') || relative.starts_with('~') || relative.contains(':')
}

pub fn list_files(cwd: &Path) -> Vec<String> {
    if !cwd.is_dir() {
        return Vec::new();
    }
    if let Some(paths) = git_ls_files(cwd) {
        return paths;
    }
    let mut paths = Vec::new();
    walk_files(cwd, cwd, &mut paths);
    paths.sort();
    paths
}

fn git_ls_files(cwd: &Path) -> Option<Vec<String>> {
    let output = Command::new("git")
        .args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut paths: Vec<String> = text.split('\0').filter(|path| !path.is_empty()).map(|path| path.replace('\\', "/")).collect();
    paths.sort();
    Some(paths)
}

fn walk_files(root: &Path, dir: &Path, paths: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_symlink() && path.is_dir() {
            continue;
        }
        if path.is_dir() {
            walk_files(root, &path, paths);
        } else if path.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                paths.push(relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"));
            }
        }
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

    fn git(dir: &std::path::Path, args: &[&str]) -> bool {
        std::process::Command::new("git").args(args).current_dir(dir).status().map(|status| status.success()).unwrap_or(false)
    }

    #[test]
    fn git_changes_reads_a_repo_and_rejects_a_plain_folder() {
        let root = scratch("git-changes");
        let repo = root.join("repo");
        let plain = root.join("plain");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&plain).unwrap();
        assert!(git(&repo, &["init", "-b", "main"]));
        assert!(git(&repo, &["config", "user.email", "test@example.com"]));
        assert!(git(&repo, &["config", "user.name", "Test"]));
        fs::write(repo.join("food.md"), "a\n").unwrap();
        assert!(git(&repo, &["add", "food.md"]));
        assert!(git(&repo, &["commit", "-m", "add"]));
        fs::write(repo.join("food.md"), "a\nb\n").unwrap();
        let changes = git_changes(&repo);
        assert!(changes.repo);
        assert!(changes.rows.iter().any(|row| row.path.ends_with("food.md") && row.label == "modified"));
        assert!(!git_changes(&plain).repo);
        assert!(git_changes(&plain).rows.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_files_uses_git_and_skips_node_modules_outside_a_repo() {
        let root = scratch("list");
        let repo = root.join("repo");
        let plain = root.join("plain");
        fs::create_dir_all(&repo).unwrap();
        assert!(git(&repo, &["init", "-b", "main"]));
        assert!(git(&repo, &["config", "user.email", "test@example.com"]));
        assert!(git(&repo, &["config", "user.name", "Test"]));
        fs::write(repo.join("a.ts"), "a").unwrap();
        fs::write(repo.join(".gitignore"), "secret.env\n").unwrap();
        assert!(git(&repo, &["add", "a.ts", ".gitignore"]));
        assert!(git(&repo, &["commit", "-m", "add"]));
        fs::write(repo.join("b.ts"), "b").unwrap();
        fs::write(repo.join("secret.env"), "nope").unwrap();
        let listed = list_files(&repo);
        assert!(listed.iter().any(|path| path == "a.ts"));
        assert!(listed.iter().any(|path| path == "b.ts"));
        assert!(!listed.iter().any(|path| path.contains("secret.env")));
        fs::create_dir_all(plain.join("notes")).unwrap();
        fs::create_dir_all(plain.join("node_modules")).unwrap();
        fs::write(plain.join("notes/food.md"), "soup").unwrap();
        fs::write(plain.join("node_modules/x.js"), "x").unwrap();
        let walked = list_files(&plain);
        assert!(walked.iter().any(|path| path == "notes/food.md"));
        assert!(!walked.iter().any(|path| path.contains("node_modules")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_mention_dir_lists_a_parent_and_rejects_absolute() {
        let root = scratch("mention");
        let session = root.join("session");
        fs::create_dir_all(session.join("inner")).unwrap();
        fs::write(root.join("my-file.txt"), "x").unwrap();
        fs::create_dir(root.join("other")).unwrap();
        let listed = list_mention_dir(&session, "..");
        assert!(listed.iter().any(|entry| entry.name == "my-file.txt" && !entry.dir));
        assert!(listed.iter().any(|entry| entry.name == "other" && entry.dir));
        assert!(list_mention_dir(&session, "/etc").is_empty());
        assert!(list_mention_dir(&session, "C:/Windows").is_empty());
        assert!(list_mention_dir(&session, "../missing").is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
