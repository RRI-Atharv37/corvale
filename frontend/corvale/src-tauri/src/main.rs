// Prevents an extra console window on Windows release builds without disabling it in debug.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    corvale_lib::run();
}
