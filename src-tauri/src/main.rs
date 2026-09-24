#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::Write, path::Path};
use tauri::{Emitter, Manager};
mod lifecycle;
mod macos;

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let resolved = if path.exists() {
        fs::canonicalize(path).map_err(|e| e.to_string())?
    } else {
        path.to_path_buf()
    };
    let path = resolved.as_path();
    let parent = path.parent().ok_or("No parent directory")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|e| e.to_string())?;
    }
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    if path.exists() {
        macos::replace_file(path, temp.path())?;
    } else {
        temp.persist(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_text(path: String, text: String, expected: Option<String>) -> Result<(), String> {
    if let Some(expected) = expected {
        let actual =
            fs::read_to_string(&path).map_err(|e| format!("Cannot verify saved file: {e}"))?;
        if actual != expected {
            return Err(
                "The file changed outside Writer Classic. Use Save As to keep both copies.".into(),
            );
        }
    }
    atomic_write(Path::new(&path), text.as_bytes())
}

#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    atomic_write(Path::new(&path), &bytes)
}

#[tauri::command]
fn classic_font(weight: String) -> Result<Vec<u8>, String> {
    let name = match weight.as_str() {
        "regular" => "NittiPro-Medium",
        "bold" => "NittiPro-Bold",
        "italic" => "NittiPro-MediumItalic",
        _ => return Err("Unknown font face".into()),
    };
    fs::read(format!(
        "/Applications/iA Writer Classic.app/Contents/Resources/Fonts/{name}.otf"
    ))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_vim_checked(app: tauri::AppHandle, checked: bool) -> Result<(), String> {
    let menu = app.menu().ok_or("Application menu is unavailable")?;
    for item in menu.items().map_err(|e| e.to_string())? {
        if let Some(item) = item.as_submenu().and_then(|menu| menu.get("vim")) {
            if let Some(item) = item.as_check_menuitem() {
                return item.set_checked(checked).map_err(|e| e.to_string());
            }
        }
    }
    Err("Vim menu item is unavailable".into())
}

#[tauri::command]
fn set_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    use tauri::menu::MenuItem;
    let menu = app.menu().ok_or("Application menu is unavailable")?;
    let file = menu.get("file").ok_or("File menu is unavailable")?;
    let recent = file
        .as_submenu()
        .and_then(|file| file.get("recent"))
        .ok_or("Recent menu is unavailable")?;
    let submenu = recent.as_submenu().ok_or("Recent menu is unavailable")?;
    for item in submenu.items().map_err(|e| e.to_string())? {
        submenu.remove(&item).map_err(|e| e.to_string())?;
    }
    for (index, path) in paths.iter().enumerate() {
        let name = Path::new(path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        submenu
            .append(
                &MenuItem::with_id(
                    &app,
                    format!("recent-open-{index}"),
                    name,
                    true,
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
    }
    submenu
        .append(
            &MenuItem::with_id(
                &app,
                "recent-clear",
                "Clear Menu",
                !paths.is_empty(),
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let root = Menu::new(app)?;
    let application = Submenu::new(app, "Writer Classic", true)?;
    application.append(&PredefinedMenuItem::about(
        app,
        Some("About Writer Classic"),
        None,
    )?)?;
    application.append(&PredefinedMenuItem::separator(app)?)?;
    application.append(&PredefinedMenuItem::services(app, None)?)?;
    application.append(&PredefinedMenuItem::hide(app, None)?)?;
    application.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    application.append(&MenuItem::with_id(
        app,
        "quit",
        "Quit Writer Classic",
        true,
        Some("CmdOrCtrl+Q"),
    )?)?;
    root.append(&application)?;
    let file = Submenu::with_id(app, "file", "File", true)?;
    for (id, text, key) in [
        ("new", "New", "CmdOrCtrl+N"),
        ("open", "Open…", "CmdOrCtrl+O"),
        ("duplicate", "Duplicate", "CmdOrCtrl+Shift+S"),
        ("close", "Close", "CmdOrCtrl+W"),
        ("save", "Save", "CmdOrCtrl+S"),
        ("save-as", "Save As…", "CmdOrCtrl+Alt+Shift+S"),
        ("import", "Import…", "CmdOrCtrl+Shift+I"),
        ("export", "Export…", "CmdOrCtrl+Shift+E"),
        ("print", "Print Formatted…", "CmdOrCtrl+P"),
    ] {
        file.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    file.append(&Submenu::with_id(app, "recent", "Open Recent", true)?)?;
    for (id, text) in [
        ("rename", "Rename…"),
        ("move", "Move To…"),
        ("revert", "Revert to Saved…"),
        ("versions", "Browse All Versions…"),
        ("icloud", "iCloud…"),
    ] {
        file.append(&MenuItem::with_id(app, id, text, true, None::<&str>)?)?;
    }
    root.append(&file)?;
    let edit = Submenu::new(app, "Edit", true)?;
    for (id, text, key) in [
        ("undo", "Undo", "CmdOrCtrl+Z"),
        ("redo", "Redo", "CmdOrCtrl+Shift+Z"),
    ] {
        edit.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    edit.append(&PredefinedMenuItem::cut(app, None)?)?;
    edit.append(&PredefinedMenuItem::copy(app, None)?)?;
    edit.append(&PredefinedMenuItem::paste(app, None)?)?;
    edit.append(&PredefinedMenuItem::select_all(app, None)?)?;
    for (id, text, key) in [
        ("copy-html", "Copy HTML", "CmdOrCtrl+Alt+C"),
        ("find", "Find…", "CmdOrCtrl+F"),
        ("replace", "Find and Replace…", "CmdOrCtrl+Alt+F"),
        ("find-next", "Find Next", "CmdOrCtrl+G"),
        ("find-previous", "Find Previous", "CmdOrCtrl+Shift+G"),
        ("selection-find", "Use Selection for Find", "CmdOrCtrl+E"),
    ] {
        edit.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    let spelling = Submenu::new(app, "Spelling and Grammar", true)?;
    for (id, title) in [
        ("spelling-panel", "Show Spelling and Grammar"),
        ("check-spelling", "Check Document Now"),
        ("spellcheck", "Check Spelling While Typing"),
        ("grammar", "Check Grammar With Spelling"),
        ("correction", "Correct Spelling Automatically"),
    ] {
        spelling.append(&MenuItem::with_id(
            app,
            format!("service-{id}"),
            title,
            true,
            None::<&str>,
        )?)?;
    }
    edit.append(&spelling)?;
    let substitutions = Submenu::new(app, "Substitutions", true)?;
    for (id, title) in [
        ("substitutions", "Show Substitutions"),
        ("smart-quotes", "Smart Quotes"),
        ("smart-dashes", "Smart Dashes"),
        ("replacement", "Text Replacement"),
    ] {
        substitutions.append(&MenuItem::with_id(
            app,
            format!("service-{id}"),
            title,
            true,
            None::<&str>,
        )?)?;
    }
    edit.append(&substitutions)?;
    edit.append(&CheckMenuItem::with_id(
        app,
        "vim",
        "Vim Mode",
        true,
        true,
        Some("CmdOrCtrl+Alt+V"),
    )?)?;
    root.append(&edit)?;
    let format = Submenu::new(app, "Format", true)?;
    for level in 1..=6 {
        format.append(&MenuItem::with_id(
            app,
            format!("heading-{level}"),
            format!("Heading {level}"),
            true,
            Some(format!("CmdOrCtrl+{level}")),
        )?)?;
    }
    for (id, text, key) in [
        ("body", "Body Text", "CmdOrCtrl+0"),
        ("bold", "Strong", "CmdOrCtrl+B"),
        ("italic", "Emphasis", "CmdOrCtrl+I"),
        ("strike", "Strikethrough", "CmdOrCtrl+-"),
        ("link", "Add Link", "CmdOrCtrl+K"),
        ("unordered", "Unordered Item", "CmdOrCtrl+L"),
        ("ordered", "Ordered Item", "CmdOrCtrl+Shift+L"),
        ("clear", "Clear Styles", "CmdOrCtrl+Alt+Backspace"),
    ] {
        format.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    root.append(&format)?;
    let view = Submenu::new(app, "View", true)?;
    for (id, text, key) in [
        ("focus", "Focus Mode", "CmdOrCtrl+D"),
        ("preview", "Preview", "CmdOrCtrl+R"),
        ("format-bar", "Format Bar", "CmdOrCtrl+Alt+T"),
        ("fullscreen", "Full Screen", "Ctrl+Super+F"),
        ("dark", "Dark Mode", "CmdOrCtrl+Alt+D"),
    ] {
        view.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    root.append(&view)?;
    let window = Submenu::new(app, "Window", true)?;
    window.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window.append(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)?;
    root.append(&window)?;
    app.set_menu(root)?;
    app.on_menu_event(|app, event| {
        if let Some(window) = app
            .webview_windows()
            .values()
            .find(|w| w.is_focused().unwrap_or(false))
        {
            let _ = window.emit("menu-action", event.id().as_ref());
        }
    });
    Ok(())
}

fn open_window(app: &tauri::AppHandle, path: Option<&Path>) -> tauri::Result<()> {
    let (label, address) = if let Some(path) = path {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("open", &path.to_string_lossy())
            .finish();
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        (format!("document-{id}"), format!("index.html?{query}"))
    } else {
        ("main".to_string(), "index.html".to_string())
    };
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(address.into()))
        .title("Untitled")
        .inner_size(860.0, 640.0)
        .min_inner_size(560.0, 320.0)
        .build()?;
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(lifecycle::QuitState::default())
        .invoke_handler(tauri::generate_handler![
            read_text,
            read_bytes,
            write_text,
            write_bytes,
            classic_font,
            set_vim_checked,
            set_recent_files,
            lifecycle::request_quit,
            lifecycle::quit_ready,
            macos::text_service,
            macos::set_document_header,
            macos::list_versions,
            macos::save_version,
            macos::remove_version,
            macos::move_document,
            macos::complete_word,
            macos::icloud_status
        ])
        .setup(|app| {
            menu(app)?;
            let paths: Vec<_> = std::env::args()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .collect();
            if paths.is_empty() {
                open_window(app.handle(), None)?;
            } else {
                for path in paths {
                    open_window(app.handle(), Some(Path::new(&path)))?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not start Writer Classic")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let _ = open_window(app, Some(&path));
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_utf8_round_trip_and_external_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("unusual 猫.md")
            .to_string_lossy()
            .to_string();
        let text = "\u{feff}  café\r\n\r\n猫\t\nrepeat\nrepeat\n".to_string();
        write_text(path.clone(), text.clone(), None).unwrap();
        assert_eq!(read_text(path.clone()).unwrap(), text);
        fs::write(&path, "external").unwrap();
        assert!(write_text(path.clone(), "new".into(), Some(text)).is_err());
        assert_eq!(read_text(path.clone()).unwrap(), "external");
        write_text(path.clone(), "".into(), Some("external".into())).unwrap();
        assert_eq!(read_text(path).unwrap(), "");
    }
    #[test]
    fn failure_does_not_create_a_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing/notes.md");
        assert!(write_text(path.to_string_lossy().to_string(), "text".into(), None).is_err());
        assert!(!path.exists());
    }
    #[test]
    fn saving_through_a_symlink_preserves_the_alias() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let alias = dir.path().join("alias.md");
        fs::write(&target, "before").unwrap();
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        write_text(
            alias.to_string_lossy().to_string(),
            "after".into(),
            Some("before".into()),
        )
        .unwrap();
        assert!(fs::symlink_metadata(&alias)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "after");
    }
}
