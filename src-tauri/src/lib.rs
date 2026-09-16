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

// ####################
// # DIALOG FILE I/O
// ####################
// Read / write a file at a user-picked dialog path. That path is outside the granted Binder scope, so it
// uses std::fs (ungated) rather than the scoped fs plugin: the user drove the native dialog, so the access
// is consented, the same trust model as create_binder_directory.

// Write a text export to the chosen path.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
  std::fs::write(&path, contents).map_err(|error| error.to_string())
}

// Write binary bytes (the gzip Tin) to the chosen path.
#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
  std::fs::write(&path, bytes).map_err(|error| error.to_string())
}

// Read a UTF-8 file at the chosen path (JSON / Markdown import).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|error| error.to_string())
}

// Read raw bytes at the chosen path (the gzip Tin, decompressed on the frontend).
#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&path).map_err(|error| error.to_string())
}

// ####################
// # DIRECT-TO-FILE PDF
// ####################
// Render the frontend's paged print HTML to a real A4 PDF at a chosen path with no OS print dialog. The
// HTML lands in a temp file that a HIDDEN webview loads, so its own engine lays out the pages; then
// WebView2's PrintToPdf writes them to the target. Windows-only: PrintToPdf lives on ICoreWebView2_7, a
// WebView2 interface. Off Windows the command errors so the frontend prints through the browser instead.

// A monotone stamp for the temp file name + hidden window label, so two concurrent renders never collide.
#[cfg(windows)]
fn pdf_render_stamp() -> u128 {
  use std::sync::atomic::{AtomicU64, Ordering};
  use std::time::{SystemTime, UNIX_EPOCH};
  static COUNTER: AtomicU64 = AtomicU64::new(0);
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|elapsed| elapsed.as_nanos())
    .unwrap_or(0);
  nanos.wrapping_add(COUNTER.fetch_add(1, Ordering::Relaxed) as u128)
}

// Drive the loaded webview's WebView2 to write the PDF. Runs on the thread that owns the webview (inside
// with_webview), where COM calls are legal. PrintToPdf is asynchronous: its completion handler fires later
// on this same thread, so `done` carries the outcome back to the awaiting command.
#[cfg(windows)]
unsafe fn render_webview_to_pdf(
  platform: tauri::webview::PlatformWebview,
  path: &str,
  landscape: bool,
  done: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
  use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
  };
  use webview2_com::PrintToPdfCompletedHandler;
  use windows::core::{Interface, PCWSTR};

  // The controller yields the CoreWebView2; ICoreWebView2_7 carries PrintToPdf and Environment6 mints a
  // print settings object. Both reach their interface through a QueryInterface cast.
  let core = platform
    .controller()
    .CoreWebView2()
    .map_err(|error| error.to_string())?;
  let printer: ICoreWebView2_7 = core.cast().map_err(|error| error.to_string())?;
  let environment: ICoreWebView2Environment6 = platform
    .environment()
    .cast()
    .map_err(|error| error.to_string())?;

  // A4 in inches, zero margins (the HTML owns them), backgrounds on so accent / callout fills print.
  // Orientation follows the document format.
  let settings = environment
    .CreatePrintSettings()
    .map_err(|error| error.to_string())?;
  let orientation = if landscape {
    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
  } else {
    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
  };
  settings
    .SetOrientation(orientation)
    .map_err(|error| error.to_string())?;
  settings.SetPageWidth(8.27).map_err(|error| error.to_string())?;
  settings.SetPageHeight(11.69).map_err(|error| error.to_string())?;
  settings.SetMarginTop(0.0).map_err(|error| error.to_string())?;
  settings.SetMarginBottom(0.0).map_err(|error| error.to_string())?;
  settings.SetMarginLeft(0.0).map_err(|error| error.to_string())?;
  settings.SetMarginRight(0.0).map_err(|error| error.to_string())?;
  settings
    .SetShouldPrintBackgrounds(true)
    .map_err(|error| error.to_string())?;

  // A null-terminated wide path for the LPCWSTR argument, kept alive across the call. The handler maps
  // its HRESULT + success flag onto the channel.
  let target: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
  let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, is_successful| {
    match result {
      Ok(()) if is_successful => {
        let _ = done.send(Ok(()));
      }
      Ok(()) => {
        let _ = done.send(Err("pdf-print-unsuccessful".to_string()));
      }
      Err(error) => {
        let _ = done.send(Err(error.to_string()));
      }
    }
    Ok(())
  }));

  printer
    .PrintToPdf(PCWSTR(target.as_ptr()), &settings, &handler)
    .map_err(|error| error.to_string())?;
  Ok(())
}

// Windows: stage the HTML, load it in a hidden window, wait for the load, then render to the chosen path.
#[cfg(windows)]
#[tauri::command]
async fn print_html_to_pdf(
  app: tauri::AppHandle,
  html: String,
  path: String,
  landscape: bool,
) -> Result<(), String> {
  use std::sync::mpsc;
  use std::sync::{Arc, Mutex};
  use std::time::Duration;
  use tauri::webview::PageLoadEvent;
  use tauri::{WebviewUrl, WebviewWindowBuilder};

  // Stage the HTML as a temp file the hidden webview loads over file://. std::fs (ungated) writes it,
  // matching the dialog-path trust model above.
  let stamp = pdf_render_stamp();
  let temp_path = std::env::temp_dir().join(format!("documinter-print-{stamp}.html"));
  std::fs::write(&temp_path, html).map_err(|error| error.to_string())?;
  let file_url =
    tauri::Url::from_file_path(&temp_path).map_err(|_| "pdf-bad-temp-path".to_string())?;

  // A hidden A4-sized window pointed at the staged file. on_page_load signals load completion; its Sender
  // sits behind a Mutex so the closure meets the hook's Fn + Sync bound.
  let (load_tx, load_rx) = mpsc::channel::<()>();
  let load_tx = Arc::new(Mutex::new(load_tx));
  let window = WebviewWindowBuilder::new(&app, format!("pdf-render-{stamp}"), WebviewUrl::External(file_url))
    .visible(false)
    .inner_size(816.0, 1056.0)
    .on_page_load(move |_window, payload| {
      if payload.event() == PageLoadEvent::Finished {
        if let Ok(sender) = load_tx.lock() {
          let _ = sender.send(());
        }
      }
    })
    .build()
    .map_err(|error| error.to_string())?;

  // Wait for the load before printing, or the PDF comes out blank. Bounded so a load that never fires
  // cannot wedge the command. The short settle covers late webfont / image decode the load event misses.
  let _ = load_rx.recv_timeout(Duration::from_secs(15));
  std::thread::sleep(Duration::from_millis(400));

  // Reach the webview on its own thread and print. The completion handler fires there later; the channel
  // carries its result back, bounded so a handler that never fires still returns.
  let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
  let render_path = path.clone();
  let dispatch = window.with_webview(move |platform| {
    let outcome = unsafe { render_webview_to_pdf(platform, &render_path, landscape, done_tx.clone()) };
    if let Err(error) = outcome {
      let _ = done_tx.send(Err(error));
    }
  });

  let result = match dispatch {
    Ok(()) => done_rx
      .recv_timeout(Duration::from_secs(60))
      .unwrap_or_else(|_| Err("pdf-print-timeout".to_string())),
    Err(error) => Err(error.to_string()),
  };

  // Best-effort teardown whether the render succeeded or failed.
  let _ = window.close();
  let _ = std::fs::remove_file(&temp_path);
  result
}

// Off Windows there is no PrintToPdf; error out so the frontend falls back to the browser print.
#[cfg(not(windows))]
#[tauri::command]
async fn print_html_to_pdf(
  _app: tauri::AppHandle,
  _html: String,
  _path: String,
  _landscape: bool,
) -> Result<(), String> {
  Err("pdf-unsupported-platform".to_string())
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
    .invoke_handler(tauri::generate_handler![
      allow_binder_directory,
      create_binder_directory,
      set_path_hidden,
      write_text_file,
      write_binary_file,
      read_text_file,
      read_binary_file,
      print_html_to_pdf
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
