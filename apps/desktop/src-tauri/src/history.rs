//! Query history: every SQL statement that reached a server, in `history.jsonl` beside the
//! workspace file. It is personal, so it never goes in the workspace, and it is readable by the
//! user only. One JSON object per line, appended; past `KEEP` entries (plus some slack, so it is not
//! rewritten on every run) the file is rewritten with the newest `KEEP`, atomically.
//!
//! SQL that mentions a password (`ALTER ROLE … PASSWORD '…'`, `CREATE USER … PASSWORD`) is never
//! recorded, and neither is SQL over `MAX_SQL`, so a history entry can always be reopened whole.

use berth_core::{EnvId, Role};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const KEEP: usize = 5000;
const SLACK: usize = 500;
const MAX_SQL: usize = 64 * 1024;
const MAX_LIST: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Unix time in milliseconds.
    pub at: u64,
    pub conn: String,
    pub env: EnvId,
    pub role: Role,
    pub host: String,
    pub sql: String,
    pub elapsed_ms: u64,
    /// Rows returned, plus rows affected by statements without a result set.
    pub rows: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct History {
    path: PathBuf,
    entries: Vec<Entry>,
}

/// Whether a statement may be written to the history at all.
pub fn recordable(sql: &str) -> bool {
    !sql.trim().is_empty() && sql.len() <= MAX_SQL && !sql.to_ascii_lowercase().contains("password")
}

fn private_file(path: &Path, append: bool) -> std::io::Result<fs::File> {
    let mut opts = fs::OpenOptions::new();
    opts.create(true);
    if append {
        opts.append(true);
    } else {
        opts.write(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

impl History {
    /// Reads the file; a missing file is an empty history and a line that does not parse is skipped.
    pub fn load(path: PathBuf) -> History {
        let entries =
            fs::read_to_string(&path).map(|text| text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()).unwrap_or_default();
        History { path, entries }
    }

    pub fn record(&mut self, entry: Entry) -> Result<(), String> {
        if !recordable(&entry.sql) {
            return Ok(());
        }
        let mut line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut f = private_file(&self.path, true).map_err(|e| format!("{} could not be opened: {e}", self.path.display()))?;
        f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        self.entries.push(entry);
        if self.entries.len() > KEEP + SLACK {
            let drop = self.entries.len() - KEEP;
            self.entries.drain(..drop);
            self.rewrite()?;
        }
        Ok(())
    }

    /// Newest first. `conn` narrows to one connection; `query` matches SQL, connection or host, ignoring case.
    pub fn list(&self, conn: Option<&str>, query: Option<&str>, limit: usize) -> Vec<Entry> {
        let q = query.map(str::trim).filter(|q| !q.is_empty()).map(str::to_lowercase);
        self.entries
            .iter()
            .rev()
            .filter(|e| conn.is_none_or(|c| e.conn == c))
            .filter(|e| {
                q.as_deref().is_none_or(|q| {
                    e.sql.to_lowercase().contains(q) || e.conn.to_lowercase().contains(q) || e.host.to_lowercase().contains(q)
                })
            })
            .take(limit.min(MAX_LIST))
            .cloned()
            .collect()
    }

    /// Forgets one connection's entries, or all of them.
    pub fn clear(&mut self, conn: Option<&str>) -> Result<(), String> {
        self.entries.retain(|e| conn.is_some_and(|c| e.conn != c));
        self.rewrite()
    }

    fn rewrite(&self) -> Result<(), String> {
        let mut text = String::new();
        for e in &self.entries {
            text.push_str(&serde_json::to_string(e).map_err(|e| e.to_string())?);
            text.push('\n');
        }
        let tmp = self.path.with_extension("jsonl.tmp");
        let mut f = private_file(&tmp, false).map_err(|e| format!("{} could not be written: {e}", tmp.display()))?;
        f.write_all(text.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("{} could not be saved: {e}", self.path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(at: u64, conn: &str, sql: &str) -> Entry {
        Entry {
            at,
            conn: conn.into(),
            env: EnvId::new("dev").unwrap(),
            role: Role::Read,
            host: "localhost".into(),
            sql: sql.into(),
            elapsed_ms: 3,
            rows: 1,
            error: None,
        }
    }

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("berth-history-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn appends_lists_newest_first_and_survives_a_bad_line() {
        let d = dir("basic");
        let path = d.join("history.jsonl");
        let mut h = History::load(path.clone());
        h.record(entry(1, "acme-db", "SELECT 1")).unwrap();
        h.record(entry(2, "events-db", "SELECT 2")).unwrap();
        h.record(entry(3, "acme-db", "select * from Users")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"{not json\n").unwrap();

        let h = History::load(path.clone());
        assert_eq!(h.list(None, None, 10).iter().map(|e| e.at).collect::<Vec<_>>(), [3, 2, 1]);
        assert_eq!(h.list(Some("acme-db"), None, 10).len(), 2);
        assert_eq!(h.list(None, Some("USERS"), 10)[0].at, 3);
        assert_eq!(h.list(None, Some("events"), 10)[0].at, 2, "the connection name matches too");
        assert_eq!(h.list(None, None, 1).len(), 1);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn never_records_passwords_or_oversized_sql() {
        let d = dir("secret");
        let mut h = History::load(d.join("history.jsonl"));
        h.record(entry(1, "acme-db", "ALTER ROLE app PASSWORD 'hunter2'")).unwrap();
        h.record(entry(2, "acme-db", "create user x with Password 'y'")).unwrap();
        h.record(entry(3, "acme-db", &"x".repeat(MAX_SQL + 1))).unwrap();
        h.record(entry(4, "acme-db", "   ")).unwrap();
        assert!(h.list(None, None, 10).is_empty());
        assert!(!d.join("history.jsonl").exists());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn keeps_the_newest_entries_and_clears_per_connection() {
        let d = dir("cap");
        let path = d.join("history.jsonl");
        let mut h = History::load(path.clone());
        for i in 0..(KEEP + SLACK + 1) as u64 {
            h.record(entry(i, if i % 2 == 0 { "a" } else { "b" }, "SELECT 1")).unwrap();
        }
        let back = History::load(path.clone());
        assert_eq!(back.entries.len(), KEEP);
        assert_eq!(back.entries[0].at, (SLACK + 1) as u64, "the oldest ones go");
        assert!(!path.with_extension("jsonl.tmp").exists());

        let mut h = back;
        h.clear(Some("a")).unwrap();
        assert!(History::load(path.clone()).entries.iter().all(|e| e.conn == "b"));
        h.clear(None).unwrap();
        assert!(History::load(path).entries.is_empty());
        fs::remove_dir_all(d).unwrap();
    }
}
