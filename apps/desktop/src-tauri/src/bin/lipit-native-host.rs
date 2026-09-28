fn main() {
    if let Err(error) = lipit_desktop_lib::native_messaging::run_stdio_host() {
        write_error_log(&error.to_string());
    }
}

fn write_error_log(message: &str) {
    let Some(base) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let directory = std::path::PathBuf::from(base)
        .join("Lipit Capture")
        .join("NativeMessaging");
    if std::fs::create_dir_all(&directory).is_ok() {
        let _ = std::fs::write(directory.join("last-error.log"), message);
    }
}
