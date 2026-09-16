// #############################
// # FTS5 availability probe
// #############################
// Does the SQLite that tauri-plugin-sql bundles ship FTS5? The plugin wraps sqlx, so probing sqlx
// against an in-memory database exercises the same libsqlite3-sys build the app runs against. Green
// means the `.documinter/index.sqlite` cache can use an FTS5 virtual table.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

#[tokio::test]
async fn fts5_is_available() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");

    // An FTS5-less build errors here with "no such module: fts5".
    sqlx::query("CREATE VIRTUAL TABLE probe USING fts5(content)")
        .execute(&pool)
        .await
        .expect("create fts5 virtual table");

    sqlx::query("INSERT INTO probe(content) VALUES ('documinter native binder search')")
        .execute(&pool)
        .await
        .expect("insert into fts5 table");

    // MATCH exercises the tokenizer and query pipeline, not just table creation.
    let row = sqlx::query("SELECT count(*) AS hits FROM probe WHERE probe MATCH 'binder'")
        .fetch_one(&pool)
        .await
        .expect("run fts5 MATCH query");

    let hits: i64 = row.get("hits");
    assert_eq!(hits, 1, "expected the MATCH query to find the inserted row");
}
