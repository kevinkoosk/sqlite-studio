use rusqlite::{types::ValueRef, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub current_path: Mutex<Option<String>>,
}

#[derive(Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub columns: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct TableData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

fn sanitize_ident(ident: &str) -> Result<String, String> {
    if ident.is_empty() || ident.contains('\0') {
        return Err("Identifier cannot be empty or contain null bytes".into());
    }
    Ok(format!("\"{}\"", ident.replace('"', "\"\"")))
}

#[tauri::command]
fn open_database(path: String, state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| e.to_string())?;
        
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    // Explicitly drop statement to release borrow before moving conn
    drop(stmt);

    *state.conn.lock().unwrap() = Some(conn);
    *state.current_path.lock().unwrap() = Some(path);

    Ok(tables)
}

#[tauri::command]
fn get_tables(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database connection open")?;
    
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| e.to_string())?;
        
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(tables)
}

#[tauri::command]
fn get_table_data(table_name: String, state: State<'_, DbState>) -> Result<TableData, String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database connection open")?;

    let safe_table = sanitize_ident(&table_name)?;

    let mut pragma_stmt = conn
        .prepare(&format!("PRAGMA table_info({})", safe_table))
        .map_err(|e| e.to_string())?;

    let column_names: Vec<String> = pragma_stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    drop(pragma_stmt);

    let mut select_cols = vec!["rowid".to_string()];
    select_cols.extend(column_names.iter().cloned());

    let quoted_cols = select_cols
        .iter()
        .map(|c| sanitize_ident(c))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");

    let query = format!("SELECT {} FROM {}", quoted_cols, safe_table);
    let mut query_stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    
    let col_count = select_cols.len();
    let rows_iter = query_stmt
        .query_map([], |row| {
            let mut row_vals = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val = match row.get_ref(i)? {
                    ValueRef::Null => serde_json::Value::Null,
                    ValueRef::Integer(v) => serde_json::json!(v),
                    ValueRef::Real(v) => serde_json::json!(v),
                    ValueRef::Text(v) => {
                        let s = std::str::from_utf8(v).unwrap_or("");
                        serde_json::json!(s)
                    }
                    ValueRef::Blob(v) => serde_json::json!(format!("<BLOB {}B>", v.len())),
                };
                row_vals.push(val);
            }
            Ok(row_vals)
        })
        .map_err(|e| e.to_string())?;

    let mut rows = Vec::new();
    for r in rows_iter {
        rows.push(r.map_err(|e| e.to_string())?);
    }

    Ok(TableData {
        columns: select_cols,
        rows,
    })
}

#[tauri::command]
fn create_table(table_name: String, columns_def: String, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    let safe_table = sanitize_ident(&table_name)?;
    let query = format!("CREATE TABLE {} ({})", safe_table, columns_def);
    conn.execute(&query, []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn drop_table(table_name: String, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    let safe_table = sanitize_ident(&table_name)?;
    let query = format!("DROP TABLE IF EXISTS {}", safe_table);
    conn.execute(&query, []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn copy_table(source_table: String, new_table: String, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    let safe_src = sanitize_ident(&source_table)?;
    let safe_dst = sanitize_ident(&new_table)?;
    let query = format!("CREATE TABLE {} AS SELECT * FROM {}", safe_dst, safe_src);
    conn.execute(&query, []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_column(table_name: String, column_name: String, column_type: String, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    let safe_table = sanitize_ident(&table_name)?;
    let safe_col = sanitize_ident(&column_name)?;
    let query = format!("ALTER TABLE {} ADD COLUMN {} {}", safe_table, safe_col, column_type);
    conn.execute(&query, []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_cell(table_name: String, rowid: i64, column_name: String, new_value: String, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    let safe_table = sanitize_ident(&table_name)?;
    let safe_col = sanitize_ident(&column_name)?;
    let query = format!("UPDATE {} SET {} = ? WHERE rowid = ?", safe_table, safe_col);
    conn.execute(&query, rusqlite::params![new_value, rowid]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_rows(table_name: String, rowids: Vec<i64>, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    if rowids.is_empty() {
        return Ok(());
    }

    let safe_table = sanitize_ident(&table_name)?;
    let placeholders = vec!["?"; rowids.len()].join(",");
    let query = format!("DELETE FROM {} WHERE rowid IN ({})", safe_table, placeholders);
    
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = rowids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    stmt.execute(&params[..]).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn insert_row(table_name: String, columns: Vec<String>, values: Vec<String>, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database open")?;
    
    let safe_table = sanitize_ident(&table_name)?;
    let safe_cols = columns
        .iter()
        .map(|c| sanitize_ident(c))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let placeholders = vec!["?"; values.len()].join(", ");
    
    let query = format!("INSERT INTO {} ({}) VALUES ({})", safe_table, safe_cols, placeholders);
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    stmt.execute(&params[..]).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState {
            conn: Mutex::new(None),
            current_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            open_database,
            get_tables,
            get_table_data,
            create_table,
            drop_table,
            copy_table,
            add_column,
            update_cell,
            delete_rows,
            insert_row
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
