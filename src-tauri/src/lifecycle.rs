use std::{collections::HashSet, sync::Mutex};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct QuitTracker {
    pending: Option<HashSet<String>>,
}

impl QuitTracker {
    /// Starts one quit. Preview windows are not documents. A second request does
    /// not emit again, so a duplicate acknowledgement cannot cancel the first.
    pub fn begin<I, S>(&mut self, labels: I) -> Vec<String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        if self.pending.is_some() {
            return Vec::new();
        }
        let labels: HashSet<String> = labels
            .into_iter()
            .map(Into::into)
            .filter(|label| !label.starts_with("preview-"))
            .collect();
        let emit: Vec<String> = labels.iter().cloned().collect();
        self.pending = if labels.is_empty() {
            None
        } else {
            Some(labels)
        };
        emit
    }

    pub fn pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Returns true only when every document has acknowledged this quit.
    pub fn acknowledge(&mut self, label: &str, ready: bool) -> bool {
        if !ready {
            self.pending = None;
            return false;
        }
        let Some(labels) = self.pending.as_mut() else {
            return false;
        };
        labels.remove(label);
        if labels.is_empty() {
            self.pending = None;
            return true;
        }
        false
    }
}

pub struct QuitState(pub Mutex<QuitTracker>);

impl Default for QuitState {
    fn default() -> Self {
        Self(Mutex::new(QuitTracker::default()))
    }
}

#[tauri::command]
pub fn request_quit(app: tauri::AppHandle, state: tauri::State<QuitState>) -> Result<(), String> {
    let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    let mut tracker = state.0.lock().map_err(|e| e.to_string())?;
    if tracker.pending() {
        return Ok(());
    }
    let emit = tracker.begin(labels);
    let exit = emit.is_empty();
    drop(tracker);
    if exit {
        app.exit(0);
        return Ok(());
    }
    for label in emit {
        app.emit_to(
            tauri::EventTarget::webview_window(label),
            "quit-request",
            (),
        )
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
    let mut tracker = state.0.lock().map_err(|e| e.to_string())?;
    if tracker.acknowledge(window.label(), ready) {
        drop(tracker);
        app.exit(0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_quit_acks_each_document_once_and_ignores_previews() {
        let mut quit = QuitTracker::default();
        let mut emit = quit.begin(["main", "preview-main", "document-2"]);
        emit.sort();
        assert_eq!(emit, ["document-2", "main"]);
        assert!(
            quit.begin(["main"]).is_empty(),
            "a second quit must not re-emit"
        );
        assert!(!quit.acknowledge("main", true));
        assert!(!quit.acknowledge("main", true));
        assert!(quit.acknowledge("document-2", true));
        assert!(!quit.pending());
    }

    #[test]
    fn declined_ack_cancels_without_exiting_and_allows_another_quit() {
        let mut quit = QuitTracker::default();
        quit.begin(["main", "other"]);
        assert!(!quit.acknowledge("main", false));
        assert!(!quit.pending());
        assert_eq!(quit.begin(["other"]).len(), 1);
    }
}
