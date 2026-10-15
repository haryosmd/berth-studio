//! Decides whether SQL only reads, so it may run on a read replica, or may change something,
//! so it must run on the primary. When in doubt the answer is "write": sending a write to a
//! replica fails, while sending a read to the primary only costs a little load.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Read,
    Write,
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Classification {
    pub kind: Kind,
    pub statements: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteMode {
    /// Reads go to a read endpoint when the profile has one.
    #[default]
    Auto,
    /// Pinned by the user.
    Write,
    /// Pinned by the user.
    Read,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RouteOptions {
    pub mode: RouteMode,
    pub has_read: bool,
    /// The profile has read endpoints only, so nothing may run on write.
    pub no_write_endpoint: bool,
    pub in_transaction: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Route {
    pub role: crate::Role,
    pub kind: Kind,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warn: Option<String>,
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Removes comments and the contents of string literals, quoted identifiers and dollar-quoted
/// bodies, so keywords inside them never influence routing.
pub fn strip(sql: &str) -> String {
    let s: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    let at = |k: usize| s.get(k).copied();
    while i < s.len() {
        let (c, d) = (s[i], at(i + 1));
        if c == '-' && d == Some('-') {
            while i < s.len() && s[i] != '\n' {
                i += 1;
            }
            out.push(' ');
            continue;
        }
        if c == '/' && d == Some('*') {
            let mut depth = 1;
            i += 2;
            while i < s.len() && depth > 0 {
                if s[i] == '/' && at(i + 1) == Some('*') {
                    depth += 1;
                    i += 2;
                } else if s[i] == '*' && at(i + 1) == Some('/') {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            out.push(' ');
            continue;
        }
        if c == '\'' {
            // E'...' strings allow backslash escapes.
            let mut tail = out.chars().rev();
            let escapes = matches!(tail.next(), Some('e' | 'E')) && !tail.next().is_some_and(is_word);
            i += 1;
            while i < s.len() {
                if escapes && s[i] == '\\' {
                    i += 2;
                    continue;
                }
                if s[i] == '\'' && at(i + 1) == Some('\'') {
                    i += 2;
                    continue;
                }
                if s[i] == '\'' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push_str("''");
            continue;
        }
        if c == '"' {
            i += 1;
            while i < s.len() {
                if s[i] == '"' && at(i + 1) == Some('"') {
                    i += 2;
                    continue;
                }
                if s[i] == '"' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push_str(" ident ");
            continue;
        }
        if c == '$' && !out.chars().last().is_some_and(is_word) {
            // $$ or $tag$, where a tag starts with a letter or underscore.
            let mut j = i + 1;
            if at(j).is_some_and(|x| x.is_ascii_alphabetic() || x == '_') {
                while at(j).is_some_and(is_word) {
                    j += 1;
                }
            }
            if at(j) == Some('$') {
                let tag: Vec<char> = s[i..=j].to_vec();
                let body = j + 1;
                let end = (body..=s.len().saturating_sub(tag.len())).find(|&k| s[k..k + tag.len()] == tag[..]);
                i = end.map_or(s.len(), |e| e + tag.len());
                out.push_str("''");
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Upper-cased words and parentheses, the way the prototype tokenises.
fn tokens(stmt: &str) -> Vec<String> {
    let up = stmt.to_ascii_uppercase();
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in up.chars() {
        let starts = c.is_ascii_uppercase() || c == '_';
        let continues = starts || c.is_ascii_digit() || c == '$';
        if !cur.is_empty() && continues {
            cur.push(c);
            continue;
        }
        if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        if starts {
            cur.push(c);
        } else if c == '(' || c == ')' {
            out.push(c.to_string());
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

const WRITE_FNS: [&str; 20] = [
    "NEXTVAL",
    "SETVAL",
    "SET_CONFIG",
    "PG_ADVISORY_LOCK",
    "PG_ADVISORY_XACT_LOCK",
    "PG_TRY_ADVISORY_LOCK",
    "PG_TRY_ADVISORY_XACT_LOCK",
    "PG_ADVISORY_LOCK_SHARED",
    "PG_NOTIFY",
    "LO_IMPORT",
    "LO_EXPORT",
    "LO_UNLINK",
    "LO_CREATE",
    "PG_TERMINATE_BACKEND",
    "PG_CANCEL_BACKEND",
    "TXID_CURRENT",
    "PG_CURRENT_XACT_ID",
    "PG_RELOAD_CONF",
    "PG_SWITCH_WAL",
    "PG_CREATE_RESTORE_POINT",
];
const DML: [&str; 4] = ["INSERT", "UPDATE", "DELETE", "MERGE"];
const READ_STARTS: [&str; 4] = ["SELECT", "WITH", "TABLE", "VALUES"];
const EXPLAINABLE: [&str; 11] =
    ["SELECT", "WITH", "TABLE", "VALUES", "INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "EXECUTE", "DECLARE"];

fn verdict(kind: Kind, reason: impl Into<String>) -> (Kind, String) {
    (kind, reason.into())
}

fn classify_statement(stmt: &str) -> Option<(Kind, String)> {
    let t = tokens(stmt);
    let w: Vec<&str> = t.iter().map(String::as_str).filter(|x| *x != "(" && *x != ")").collect();
    let first = *w.first()?;
    if first == "SHOW" {
        return Some(verdict(Kind::Read, "SHOW only reads settings."));
    }
    if first == "EXPLAIN" {
        let analyze = w.contains(&"ANALYZE") || w.contains(&"ANALYSE");
        let start = (1..w.len()).find(|&j| EXPLAINABLE.contains(&w[j]) && w[j - 1] != "FOR");
        let inner = start.map(|j| {
            let ti = t.iter().position(|x| x == w[j]).unwrap_or(0);
            classify_words(&w[j..], &t[ti..])
        });
        if let (true, Some((Kind::Write, why))) = (analyze, &inner) {
            return Some(verdict(Kind::Write, format!("EXPLAIN ANALYZE runs the statement. {why}")));
        }
        return Some(verdict(
            Kind::Read,
            if analyze { "EXPLAIN ANALYZE of a read-only statement." } else { "EXPLAIN without ANALYZE does not run the statement." },
        ));
    }
    Some(classify_words(&w, &t))
}

fn classify_words(w: &[&str], t: &[String]) -> (Kind, String) {
    let first = w[0];
    if !READ_STARTS.contains(&first) {
        return verdict(Kind::Write, format!("{first} changes data or session state."));
    }
    for j in 0..w.len().saturating_sub(1) {
        let (a, b, c) = (w[j], w[j + 1], w.get(j + 2).copied());
        if a == "FOR" && (b == "UPDATE" || b == "SHARE" || (b == "NO" && c == Some("KEY")) || (b == "KEY" && c == Some("SHARE"))) {
            return verdict(Kind::Write, "SELECT … FOR UPDATE or FOR SHARE takes row locks on the primary.");
        }
    }
    if let Some(dml) = w.iter().find(|x| DML.contains(x)) {
        return verdict(Kind::Write, format!("The statement contains {dml}."));
    }
    if first == "SELECT" && w.contains(&"INTO") {
        return verdict(Kind::Write, "SELECT INTO creates a table.");
    }
    for j in 0..t.len().saturating_sub(1) {
        if t[j + 1] == "(" && WRITE_FNS.contains(&t[j].as_str()) {
            return verdict(Kind::Write, format!("{}() changes state on the server.", t[j].to_ascii_lowercase()));
        }
    }
    verdict(Kind::Read, "Read-only statement.")
}

pub fn classify(sql: &str) -> Classification {
    let stripped = strip(sql);
    let results: Vec<(Kind, String)> =
        stripped.split(';').map(str::trim).filter(|x| !x.is_empty()).filter_map(classify_statement).collect();
    if results.is_empty() {
        return Classification { kind: Kind::Empty, statements: 0, reason: "Nothing to run.".into() };
    }
    let write = results.iter().find(|r| r.0 == Kind::Write);
    let (kind, reason) = write.unwrap_or(&results[0]).clone();
    Classification { kind, statements: results.len(), reason }
}

pub fn route(sql: &str, opts: RouteOptions) -> Route {
    use crate::Role::{Read, Write};
    let c = classify(sql);
    let r = |role, reason: &str| Route { role, kind: c.kind, reason: reason.to_string(), warn: None };
    if opts.no_write_endpoint {
        return Route {
            warn: (c.kind == Kind::Write).then(|| format!("{} This profile has no write endpoint, so it can only read.", c.reason)),
            ..r(Read, "This profile has no write endpoint, so everything runs on read.")
        };
    }
    match opts.mode {
        RouteMode::Write => r(Write, "Pinned to the write endpoint."),
        RouteMode::Read if !opts.has_read => r(Write, "This profile has no read endpoint, so it runs on write."),
        RouteMode::Read => Route {
            warn: (c.kind == Kind::Write).then(|| format!("{} The read endpoint is read-only and will reject it.", c.reason)),
            ..r(Read, "Pinned to the read endpoint.")
        },
        RouteMode::Auto => {
            if c.kind == Kind::Empty {
                r(Write, &c.reason)
            } else if !opts.has_read {
                r(Write, "This profile has no read endpoint, so it runs on write.")
            } else if opts.in_transaction {
                r(Write, "Inside a transaction, every statement stays on write.")
            } else if c.kind == Kind::Write {
                r(Write, &c.reason)
            } else {
                r(Read, "Read-only statement, routed to the read endpoint.")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Role;

    fn kind(sql: &str) -> Kind {
        classify(sql).kind
    }

    #[test]
    fn plain_reads_go_to_read() {
        for sql in [
            "SELECT 1",
            "select * from users where id = $1",
            "TABLE users",
            "VALUES (1), (2)",
            "SHOW search_path",
            "WITH a AS (SELECT 1) SELECT * FROM a",
            "SELECT update_count, nextval_total FROM stats",
            "EXPLAIN SELECT * FROM t",
            "EXPLAIN UPDATE users SET x = 1",
            "EXPLAIN ANALYZE SELECT * FROM t",
        ] {
            assert_eq!(kind(sql), Kind::Read, "{sql}");
        }
    }

    #[test]
    fn writes_locks_ddl_and_session_commands_go_to_write() {
        for sql in [
            "INSERT INTO t VALUES (1)",
            "update users set plan = $1",
            "DELETE FROM t",
            "MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE",
            "TRUNCATE t",
            "CREATE TABLE x (id int)",
            "ALTER TABLE x ADD c int",
            "DROP TABLE x",
            "BEGIN",
            "SET statement_timeout = 0",
            "VACUUM",
            "SELECT * FROM t FOR UPDATE",
            "SELECT * FROM t FOR NO KEY UPDATE",
            "SELECT * FROM t FOR SHARE",
            "SELECT * FROM t FOR KEY SHARE",
            "SELECT * INTO backup FROM t",
            "SELECT nextval('users_id_seq')",
            "SELECT pg_advisory_lock(42)",
            "SELECT set_config('x', 'y', false)",
            "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
            "EXPLAIN ANALYZE UPDATE t SET x = 1",
            "EXPLAIN (ANALYZE, BUFFERS) DELETE FROM t",
            "COPY t FROM STDIN",
            "CALL refresh_all()",
            "DO $$ BEGIN END $$",
        ] {
            assert_eq!(kind(sql), Kind::Write, "{sql}");
        }
    }

    #[test]
    fn keywords_inside_strings_identifiers_and_comments_never_count() {
        for sql in [
            "SELECT 'DELETE FROM users'",
            "SELECT 'it''s; DROP TABLE x'",
            "SELECT E'it\\'s; DELETE FROM x'",
            "SELECT $$ UPDATE t SET x = 1 $$",
            "SELECT $body$ DROP TABLE t; $body$",
            "SELECT \"update\" FROM t",
            "-- DELETE FROM t\nSELECT 1",
            "/* outer /* nested */ DROP TABLE t */ SELECT 1",
        ] {
            assert_eq!(kind(sql), Kind::Read, "{sql}");
        }
    }

    #[test]
    fn a_script_with_any_write_is_a_write_and_empty_is_empty() {
        let c = classify("SELECT 1; DELETE FROM t;");
        assert_eq!((c.kind, c.statements), (Kind::Write, 2));
        assert_eq!(kind("  ;  -- only a comment\n"), Kind::Empty);
        assert_eq!(kind(""), Kind::Empty);
    }

    #[test]
    fn strip_keeps_code_and_blanks_out_literals() {
        let s = strip("SELECT 'a;b' -- c\n, 1");
        assert_eq!(s.split_whitespace().collect::<Vec<_>>().join(" "), "SELECT '' , 1");
        assert_eq!(strip("SELECT 1 /* unterminated").trim(), "SELECT 1");
        assert_eq!(strip("SELECT $x$ never closed").trim(), "SELECT ''");
        assert_eq!(strip("SELECT a$1, 'é'").trim(), "SELECT a$1, ''");
    }

    #[test]
    fn route_uses_read_only_when_it_is_safe() {
        let o = |has_read, in_transaction| RouteOptions { mode: RouteMode::Auto, has_read, in_transaction, no_write_endpoint: false };
        assert_eq!(route("SELECT 1", o(true, false)).role, Role::Read);
        assert_eq!(route("SELECT 1", o(false, false)).role, Role::Write);
        assert_eq!(route("SELECT 1", o(true, true)).role, Role::Write);
        let w = route("UPDATE t SET x = 1", o(true, false));
        assert_eq!(w.role, Role::Write);
        assert!(w.reason.contains("UPDATE"));
        assert_eq!(route("", o(true, false)).role, Role::Write);
    }

    #[test]
    fn route_honours_a_pinned_endpoint_and_warns_about_writes_pinned_to_read() {
        let pin = |mode, has_read| RouteOptions { mode, has_read, in_transaction: false, no_write_endpoint: false };
        assert_eq!(route("SELECT 1", pin(RouteMode::Write, true)).role, Role::Write);
        let r = route("DELETE FROM t", pin(RouteMode::Read, true));
        assert_eq!(r.role, Role::Read);
        assert!(r.warn.unwrap().contains("will reject it"));
        assert_eq!(route("SELECT 1", pin(RouteMode::Read, false)).role, Role::Write);
    }

    #[test]
    fn a_profile_without_a_write_endpoint_only_reads() {
        let ro = |mode| RouteOptions { mode, has_read: true, in_transaction: false, no_write_endpoint: true };
        for mode in [RouteMode::Auto, RouteMode::Write, RouteMode::Read] {
            let r = route("SELECT 1", ro(mode));
            assert_eq!((r.role, r.warn.is_none()), (Role::Read, true));
            let w = route("DELETE FROM t", ro(mode));
            assert_eq!(w.role, Role::Read);
            assert!(w.warn.unwrap().contains("can only read"));
        }
    }
}
