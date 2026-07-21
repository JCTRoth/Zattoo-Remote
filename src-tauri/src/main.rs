//! Zattoo Remote — Binary entry point
//!
//! Prevent additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zattoo_remote_lib::run();
}
