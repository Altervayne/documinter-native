#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Opens external links in the OS default handler instead of the webview.
    .plugin(tauri_plugin_opener::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
