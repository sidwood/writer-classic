use std::{collections::HashSet, sync::Mutex};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct QuitState(pub Mutex<Option<HashSet<String>>>);

#[tauri::command]
pub fn request_quit(app: tauri::AppHandle, state: tauri::State<QuitState>) -> Result<(), String> {
    let labels: HashSet<String> = app
        .webview_windows()
        .keys()
        .filter(|label| !label.starts_with("preview-"))
        .cloned()
        .collect();
    if labels.is_empty() {
        app.exit(0);
        return Ok(());
    }
    *state.0.lock().map_err(|e| e.to_string())? = Some(labels.clone());
    for label in labels {
        app.emit_to(label, "quit-request", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_ready(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<QuitState>,
    ready: bool,
) -> Result<(), String> {
    let mut pending = state.0.lock().map_err(|e| e.to_string())?;
    if !ready {
        *pending = None;
        return Ok(());
    }
    if let Some(labels) = pending.as_mut() {
        labels.remove(window.label());
        if labels.is_empty() {
            app.exit(0);
        }
    }
    Ok(())
}
