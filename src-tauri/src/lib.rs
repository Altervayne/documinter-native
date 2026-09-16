use tauri_plugin_fs::FsExt;

// ####################
// # BINDER FOLDER GRANT
// ####################
// Grant a user-picked Binder folder to the fs scope at runtime; persisted-scope restores it next launch.

// Grant an EXISTING folder (open + launch-restore). Grant only, never creates, so a deleted Binder is
// not resurrected: the frontend's exists check then falls back to the Welcome screen.
#[tauri::command]
async fn allow_binder_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
  app
    .fs_scope()
    .allow_directory(&path, true)
    .map_err(|error| error.to_string())
}

// Create a NEW Binder folder then grant it (create only). std::fs is not gated by the fs capability
// scope, so creating the folder + its parents here avoids the chicken-and-egg where the scoped mkdir
// would need the not-yet-granted (and not-yet-existing) path already in scope.
#[tauri::command]
async fn create_binder_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
  std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  app
    .fs_scope()
    .allow_directory(&path, true)
    .map_err(|error| error.to_string())
}

// ####################
// # HIDE THE CACHE FOLDER
// ####################
// The `.documinter/` cache is dot-prefixed, which hides it on macOS / Linux, but Windows Explorer shows
// dot-folders. This sets the Windows hidden attribute (via attrib, no extra crate, no console flash). A
// no-op off Windows. Called after the cache folder is created; setting it again is harmless.
#[tauri::command]
fn set_path_hidden(path: String) -> Result<(), String> {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let windows_path = path.replace('/', "\\");
    std::process::Command::new("attrib")
      .args(["+h", &windows_path])
      .creation_flags(CREATE_NO_WINDOW)
      .output()
      .map_err(|error| error.to_string())?;
  }
  #[cfg(not(windows))]
  {
    let _ = path;
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Opens external links in the OS default handler instead of the webview.
    .plugin(tauri_plugin_opener::init())
    // Filesystem access for the Binder folder, with the native change watcher.
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    // SQLite for the rebuildable `.documinter/index.sqlite` search cache.
    .plugin(tauri_plugin_sql::Builder::default().build())
    // Persists the runtime-granted Binder-folder scope across restarts.
    .plugin(tauri_plugin_persisted_scope::init())
    .invoke_handler(tauri::generate_handler![allow_binder_directory, create_binder_directory, set_path_hidden])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
