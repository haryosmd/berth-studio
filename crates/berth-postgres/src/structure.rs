//! What a table is made of, read from the catalog: columns with their defaults, indexes,
//! constraints, and the DDL that would create it again. Also the column list of every readable
//! table, which the SQL editor completes from.
//!
//! The table is confirmed with `Session::columns` first, like every other per-table read; after
//! that the queries bind its OID, and the DDL quotes every identifier with `quote_ident`.

use crate::{quote_ident, DbError, Session};
use serde::Serialize;

/// Autocomplete stops listing columns past this many, so a huge catalog stays one quick round trip.
pub const MAX_SCHEMA_COLUMNS: i64 = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructureColumn {
    pub name: String,
    pub type_name: String,
    pub nullable: bool,
    pub default: Option<String>,
    /// `ALWAYS` or `BY DEFAULT` for an identity column.
    pub identity: Option<String>,
    /// The expression and kind of a generated column, such as `(price * qty) STORED`.
    pub generated: Option<String>,
    pub comment: Option<String>,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub method: String,
    pub columns: String,
    /// The full `CREATE INDEX` statement.
    pub definition: String,
    pub primary: bool,
    pub unique: bool,
    /// The constraint the index backs (primary key, unique, exclusion); such an index comes with
    /// its constraint in the DDL instead of a `CREATE INDEX` of its own.
    pub constraint: Option<String>,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Constraint {
    pub name: String,
    /// `primary key`, `unique`, `foreign key`, `check` or `exclusion`.
    pub kind: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub schema: String,
    pub name: String,
    /// `table`, `view`, `materialized view`, `partitioned table` or `foreign table`.
    pub kind: String,
    pub comment: Option<String>,
    pub columns: Vec<StructureColumn>,
    pub indexes: Vec<Index>,
    pub constraints: Vec<Constraint>,
    pub partition_key: Option<String>,
    /// The query of a view or materialized view.
    pub view_definition: Option<String>,
    pub ddl: String,
}

impl Session {
    /// Every column of every table and view the session can read, for completion.
    pub async fn schema_columns(&self) -> Result<Vec<SchemaColumn>, DbError> {
        let rows = self
            .client
            .query(
                "SELECT n.nspname::text, c.relname::text, a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)
                   FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                  WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                    AND n.nspname NOT LIKE 'pg_toast%'
                    AND has_table_privilege(c.oid, 'SELECT')
                  ORDER BY n.nspname, c.relname, a.attnum
                  LIMIT $1",
                &[&MAX_SCHEMA_COLUMNS],
            )
            .await?;
        Ok(rows.iter().map(|r| SchemaColumn { schema: r.get(0), table: r.get(1), column: r.get(2), type_name: r.get(3) }).collect())
    }

    pub async fn structure(&self, schema: &str, table: &str) -> Result<TableStructure, DbError> {
        self.columns(schema, table).await?;
        let rel = self
            .client
            .query_one(
                "SELECT c.oid, c.relkind::text, pg_catalog.obj_description(c.oid, 'pg_class'),
                        CASE WHEN c.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(c.oid) END,
                        CASE WHEN c.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(c.oid, true) END
                   FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = $1 AND c.relname = $2",
                &[&schema, &table],
            )
            .await?;
        let oid: u32 = rel.get(0);
        let kind = match rel.get::<_, String>(1).as_str() {
            "r" => "table",
            "v" => "view",
            "m" => "materialized view",
            "p" => "partitioned table",
            _ => "foreign table",
        };
        let columns = self
            .client
            .query(
                "SELECT a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
                        CASE WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
                        CASE a.attidentity WHEN 'a' THEN 'ALWAYS' WHEN 'd' THEN 'BY DEFAULT' END,
                        CASE WHEN a.attgenerated <> '' THEN '(' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) || ') '
                             || CASE a.attgenerated WHEN 'v' THEN 'VIRTUAL' ELSE 'STORED' END END,
                        pg_catalog.col_description(a.attrelid, a.attnum),
                        COALESCE(a.attnum = ANY (pk.conkey), false)
                   FROM pg_catalog.pg_attribute a
                   LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                   LEFT JOIN pg_catalog.pg_constraint pk ON pk.conrelid = a.attrelid AND pk.contype = 'p'
                  WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
                  ORDER BY a.attnum",
                &[&oid],
            )
            .await?
            .iter()
            .map(|r| StructureColumn {
                name: r.get(0),
                type_name: r.get(1),
                nullable: r.get(2),
                default: r.get(3),
                identity: r.get(4),
                generated: r.get(5),
                comment: r.get(6),
                primary_key: r.get(7),
            })
            .collect();
        let indexes = self
            .client
            .query(
                "SELECT ic.relname::text, am.amname::text,
                        array_to_string(ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, k, true)
                                                FROM generate_series(1, i.indnkeyatts) k), ', '),
                        pg_catalog.pg_get_indexdef(i.indexrelid), i.indisprimary, i.indisunique, con.conname::text,
                        pg_catalog.pg_relation_size(i.indexrelid)
                   FROM pg_catalog.pg_index i
                   JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
                   JOIN pg_catalog.pg_am am ON am.oid = ic.relam
                   LEFT JOIN pg_catalog.pg_constraint con
                          ON con.conindid = i.indexrelid AND con.conrelid = i.indrelid AND con.contype IN ('p', 'u', 'x')
                  WHERE i.indrelid = $1
                  ORDER BY i.indisprimary DESC, ic.relname",
                &[&oid],
            )
            .await?
            .iter()
            .map(|r| Index {
                name: r.get(0),
                method: r.get(1),
                columns: r.get(2),
                definition: r.get(3),
                primary: r.get(4),
                unique: r.get(5),
                constraint: r.get(6),
                size_bytes: r.get(7),
            })
            .collect();
        // NOT NULL is shown on its column; PostgreSQL 18 also lists it here as contype 'n'.
        let constraints = self
            .client
            .query(
                "SELECT conname::text,
                        CASE contype WHEN 'p' THEN 'primary key' WHEN 'u' THEN 'unique' WHEN 'f' THEN 'foreign key'
                                     WHEN 'c' THEN 'check' ELSE 'exclusion' END,
                        pg_catalog.pg_get_constraintdef(oid, true)
                   FROM pg_catalog.pg_constraint
                  WHERE conrelid = $1 AND contype IN ('p', 'u', 'f', 'c', 'x')
                  ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 WHEN 'c' THEN 3 ELSE 4 END, conname",
                &[&oid],
            )
            .await?
            .iter()
            .map(|r| Constraint { name: r.get(0), kind: r.get(1), definition: r.get(2) })
            .collect();
        let mut s = TableStructure {
            schema: schema.to_string(),
            name: table.to_string(),
            kind: kind.to_string(),
            comment: rel.get(2),
            columns,
            indexes,
            constraints,
            partition_key: rel.get(3),
            view_definition: rel.get(4),
            ddl: String::new(),
        };
        s.ddl = build_ddl(&s);
        Ok(s)
    }
}

fn literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// The DDL that creates the relation again: `CREATE TABLE` with its columns and constraints, the
/// indexes that no constraint brings, and the comments. Views get `CREATE [MATERIALIZED] VIEW`.
/// Ownership, grants, triggers, policies and storage options are left out.
pub fn build_ddl(s: &TableStructure) -> String {
    let name = format!("{}.{}", quote_ident(&s.schema), quote_ident(&s.name));
    let mut out =
        format!("-- {} {}.{}, from the catalog. Grants, triggers and storage options are not included.\n", s.kind, s.schema, s.name);
    match s.kind.as_str() {
        "view" | "materialized view" => {
            let query = s.view_definition.as_deref().unwrap_or("").trim().trim_end_matches(';').trim_end();
            let what = if s.kind == "view" { "VIEW" } else { "MATERIALIZED VIEW" };
            out.push_str(&format!("CREATE {what} {name} AS\n{query};\n"));
        }
        _ => {
            let mut lines: Vec<String> = s
                .columns
                .iter()
                .map(|c| {
                    let mut l = format!("    {} {}", quote_ident(&c.name), c.type_name);
                    if let Some(g) = &c.generated {
                        l.push_str(&format!(" GENERATED ALWAYS AS {g}"));
                    } else if let Some(i) = &c.identity {
                        l.push_str(&format!(" GENERATED {i} AS IDENTITY"));
                    } else if let Some(d) = &c.default {
                        l.push_str(&format!(" DEFAULT {d}"));
                    }
                    if !c.nullable {
                        l.push_str(" NOT NULL");
                    }
                    l
                })
                .collect();
            lines.extend(s.constraints.iter().map(|k| format!("    CONSTRAINT {} {}", quote_ident(&k.name), k.definition)));
            let create = if s.kind == "foreign table" { "CREATE FOREIGN TABLE" } else { "CREATE TABLE" };
            out.push_str(&format!("{create} {name} (\n{}\n)", lines.join(",\n")));
            if let Some(p) = &s.partition_key {
                out.push_str(&format!(" PARTITION BY {p}"));
            }
            out.push_str(";\n");
            if s.kind == "foreign table" {
                out.push_str("-- The SERVER and OPTIONS clauses of a foreign table are not shown.\n");
            }
        }
    }
    for i in s.indexes.iter().filter(|i| i.constraint.is_none()) {
        out.push_str(&format!("{};\n", i.definition));
    }
    if let Some(c) = &s.comment {
        let what = if s.kind.contains("view") { s.kind.to_uppercase() } else { "TABLE".into() };
        out.push_str(&format!("COMMENT ON {what} {name} IS {};\n", literal(c)));
    }
    for c in s.columns.iter() {
        if let Some(text) = &c.comment {
            out.push_str(&format!("COMMENT ON COLUMN {name}.{} IS {};\n", quote_ident(&c.name), literal(text)));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str, ty: &str, nullable: bool) -> StructureColumn {
        StructureColumn {
            name: name.into(),
            type_name: ty.into(),
            nullable,
            default: None,
            identity: None,
            generated: None,
            comment: None,
            primary_key: false,
        }
    }

    fn orders() -> TableStructure {
        TableStructure {
            schema: "public".into(),
            name: "orders".into(),
            kind: "partitioned table".into(),
            comment: Some("Every order, one row per checkout".into()),
            columns: vec![
                StructureColumn { identity: Some("ALWAYS".into()), primary_key: true, ..col("id", "bigint", false) },
                col("user_id", "integer", false),
                StructureColumn { default: Some("'new'::text".into()), ..col("status", "text", false) },
                StructureColumn { generated: Some("((qty * price)) STORED".into()), ..col("total", "numeric(12,2)", true) },
                StructureColumn { comment: Some("Bob's \"note\"".into()), ..col("Note", "text", true) },
                StructureColumn { ..col("created_at", "timestamp with time zone", false) },
            ],
            indexes: vec![
                Index {
                    name: "orders_pkey".into(),
                    method: "btree".into(),
                    columns: "id, created_at".into(),
                    definition: "CREATE UNIQUE INDEX orders_pkey ON ONLY public.orders USING btree (id, created_at)".into(),
                    primary: true,
                    unique: true,
                    constraint: Some("orders_pkey".into()),
                    size_bytes: 0,
                },
                Index {
                    name: "orders_status_idx".into(),
                    method: "btree".into(),
                    columns: "status".into(),
                    definition: "CREATE INDEX orders_status_idx ON ONLY public.orders USING btree (status)".into(),
                    primary: false,
                    unique: false,
                    constraint: None,
                    size_bytes: 8192,
                },
            ],
            constraints: vec![
                Constraint { name: "orders_pkey".into(), kind: "primary key".into(), definition: "PRIMARY KEY (id, created_at)".into() },
                Constraint {
                    name: "orders_user_id_fkey".into(),
                    kind: "foreign key".into(),
                    definition: "FOREIGN KEY (user_id) REFERENCES users(id)".into(),
                },
                Constraint { name: "orders_status_check".into(), kind: "check".into(), definition: "CHECK (status <> ''::text)".into() },
            ],
            partition_key: Some("RANGE (created_at)".into()),
            view_definition: None,
            ddl: String::new(),
        }
    }

    #[test]
    fn a_table_comes_back_with_its_columns_constraints_indexes_and_comments() {
        let ddl = build_ddl(&orders());
        let expected = "CREATE TABLE \"public\".\"orders\" (
    \"id\" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    \"user_id\" integer NOT NULL,
    \"status\" text DEFAULT 'new'::text NOT NULL,
    \"total\" numeric(12,2) GENERATED ALWAYS AS ((qty * price)) STORED,
    \"Note\" text,
    \"created_at\" timestamp with time zone NOT NULL,
    CONSTRAINT \"orders_pkey\" PRIMARY KEY (id, created_at),
    CONSTRAINT \"orders_user_id_fkey\" FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT \"orders_status_check\" CHECK (status <> ''::text)
) PARTITION BY RANGE (created_at);
CREATE INDEX orders_status_idx ON ONLY public.orders USING btree (status);
COMMENT ON TABLE \"public\".\"orders\" IS 'Every order, one row per checkout';
COMMENT ON COLUMN \"public\".\"orders\".\"Note\" IS 'Bob''s \"note\"';
";
        assert!(ddl.starts_with("-- partitioned table public.orders, from the catalog."), "{ddl}");
        assert_eq!(ddl.split_once('\n').unwrap().1, expected);
        assert!(!ddl.contains("CREATE UNIQUE INDEX orders_pkey"), "the primary key brings its own index");
    }

    #[test]
    fn views_come_back_as_create_view_with_one_semicolon() {
        let v = TableStructure {
            kind: "materialized view".into(),
            name: "active \"users\"".into(),
            view_definition: Some(" SELECT id\n   FROM users\n  WHERE active;".into()),
            constraints: vec![],
            partition_key: None,
            comment: Some("refreshed nightly".into()),
            columns: vec![col("id", "integer", true)],
            indexes: vec![],
            ..orders()
        };
        let ddl = build_ddl(&v);
        assert!(
            ddl.contains("CREATE MATERIALIZED VIEW \"public\".\"active \"\"users\"\"\" AS\nSELECT id\n   FROM users\n  WHERE active;\n"),
            "{ddl}"
        );
        assert!(ddl.contains("COMMENT ON MATERIALIZED VIEW \"public\".\"active \"\"users\"\"\" IS 'refreshed nightly';"), "{ddl}");
        assert_eq!(ddl.matches(';').count(), 2);
    }
}
