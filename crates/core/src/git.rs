use std::path::Path;
use std::process::Command;

/// Branch name from `git branch --show-current`. Empty and detached output is not a branch.
pub fn parse_branch_name(output: &str) -> Option<String> {
    let mut lines = output.split(['\n', '\r']).filter(|line| !line.is_empty());
    let name = lines.next()?.trim();
    if name.is_empty() || lines.next().is_some() || name.chars().any(char::is_control) {
        return None;
    }
    Some(name.to_string())
}

pub fn git_branch(cwd: &Path) -> Option<String> {
    let mut command = Command::new("git");
    crate::platform::hide_console(&mut command);
    let output = command
        .args(["branch", "--show-current"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_branch_name(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parse_branch_name_keeps_one_line() {
        assert_eq!(parse_branch_name("main\n").as_deref(), Some("main"));
        assert_eq!(parse_branch_name("feature/toolbar\n").as_deref(), Some("feature/toolbar"));
        assert_eq!(parse_branch_name(""), None);
        assert_eq!(parse_branch_name("\n"), None);
        assert_eq!(parse_branch_name("a\nb\n"), None);
    }

    #[test]
    fn git_branch_reads_a_repo_and_ignores_other_folders() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lowai-git-{stamp}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(git_branch(&dir), None);
        let init = Command::new("git")
            .args(["init", "-b", "feature"])
            .current_dir(&dir)
            .status()
            .expect("git init");
        assert!(init.success());
        assert_eq!(git_branch(&dir).as_deref(), Some("feature"));
        let _ = fs::remove_dir_all(&dir);
    }
}
