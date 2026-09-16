// Hide the extra console window on Windows release builds; required, do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
