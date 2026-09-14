// ############################################################################
// # FTS5 availability probe
// #
// # Answers one question for the native index design: does the SQLite that
// # tauri-plugin-sql bundles ship with FTS5 compiled in? The plugin wraps sqlx,
// # so probing sqlx against an in-memory database exercises the very same
// # libsqlite3-sys build the app will run against. A green run means the
// # `.documinter/index.sqlite` cache can lean on an FTS5 virtual table; a red
// # run means we fall back to LIKE / in-memory search.
// ############################################################################

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

#[tokio::test]
async fn fts5_is_available() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");

    // Creating the virtual table is itself the first half of the proof: an
    // FTS5-less build errors here with "no such module: fts5".
    sqlx::query("CREATE VIRTUAL TABLE probe USING fts5(content)")
        .execute(&pool)
        .await
        .expect("create fts5 virtual table");

    sqlx::query("INSERT INTO probe(content) VALUES ('documinter native binder search')")
        .execute(&pool)
        .await
        .expect("insert into fts5 table");

    // The MATCH query is the second half: it exercises the FTS5 tokenizer and
    // query pipeline, not just table creation.
    let row = sqlx::query("SELECT count(*) AS hits FROM probe WHERE probe MATCH 'binder'")
        .fetch_one(&pool)
        .await
        .expect("run fts5 MATCH query");

    let hits: i64 = row.get("hits");
    assert_eq!(hits, 1, "expected the MATCH query to find the inserted row");
}
