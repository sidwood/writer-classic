#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::{Emitter, Manager};
mod encoding;
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

fn vim_preference(app: &tauri::AppHandle) -> bool {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|p| fs::read_to_string(p.join("vim.json")).ok())
        .and_then(|text| serde_json::from_str::<bool>(&text).ok())
        .unwrap_or(true)
}
#[tauri::command]
fn set_vim_checked(app: tauri::AppHandle, checked: bool) -> Result<(), String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    atomic_write(&directory.join("vim.json"), checked.to_string().as_bytes())?;
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

fn substitution_flags(app: &tauri::AppHandle) -> std::collections::HashMap<String, bool> {
    let mut flags = std::collections::HashMap::from([
        ("smart-copy-paste".to_string(), true),
        ("smart-links".to_string(), true),
        ("data-detection".to_string(), true),
    ]);
    let Ok(directory) = app.path().app_config_dir() else {
        return flags;
    };
    if let Some(saved) = fs::read_to_string(directory.join("substitutions.json"))
        .ok()
        .and_then(|text| {
            serde_json::from_str::<std::collections::HashMap<String, bool>>(&text).ok()
        })
    {
        flags.extend(saved);
    }
    flags
}

fn set_checked(item: &tauri::menu::MenuItemKind<tauri::Wry>, id: &str, checked: bool) -> bool {
    if item.id().as_ref() == id {
        if let Some(item) = item.as_check_menuitem() {
            return item.set_checked(checked).is_ok();
        }
    }
    item.as_submenu()
        .and_then(|menu| menu.items().ok())
        .is_some_and(|items| items.iter().any(|child| set_checked(child, id, checked)))
}

#[tauri::command]
fn set_menu_checked(app: tauri::AppHandle, id: String, checked: bool) -> Result<(), String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let mut flags = substitution_flags(&app);
    flags.insert(id.clone(), checked);
    atomic_write(
        &directory.join("substitutions.json"),
        serde_json::to_string(&flags)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )?;
    let menu = app.menu().ok_or("Application menu is unavailable")?;
    if menu
        .items()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|item| set_checked(item, &id, checked))
    {
        Ok(())
    } else {
        Err(format!("{id} menu item is unavailable"))
    }
}

#[tauri::command]
fn set_menu_text(app: tauri::AppHandle, id: String, text: String) -> Result<(), String> {
    let menu = app.menu().ok_or("Application menu is unavailable")?;
    for item in menu.items().map_err(|e| e.to_string())? {
        if let Some(item) = item.as_submenu().and_then(|menu| menu.get(&id)) {
            if let Some(item) = item.as_menuitem() {
                return item.set_text(text).map_err(|e| e.to_string());
            }
        }
    }
    Err(format!("{id} menu item is unavailable"))
}

/// Close All reaches document windows only; previews are not documents.
fn document_labels<'a>(labels: &[&'a str]) -> Vec<&'a str> {
    labels
        .iter()
        .copied()
        .filter(|label| !label.starts_with("preview-"))
        .collect()
}

/// Each document runs its own Close, so unsaved changes still ask Save, Don't Save, or Cancel.
#[tauri::command]
fn close_all_documents(app: tauri::AppHandle) {
    let windows = app.webview_windows();
    let labels: Vec<&str> = windows.keys().map(String::as_str).collect();
    for label in document_labels(&labels) {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(label),
            "menu-action",
            "close",
        );
    }
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

static TITLE_APP: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

extern "C" fn title_menu_action(window: *mut std::ffi::c_void, command: *const std::ffi::c_char) {
    let Some(app) = TITLE_APP.lock().ok().and_then(|guard| guard.clone()) else {
        return;
    };
    let Ok(command) = (unsafe { std::ffi::CStr::from_ptr(command) }).to_str() else {
        return;
    };
    let windows = app.webview_windows();
    if let Some(target) = windows
        .values()
        .find(|candidate| candidate.ns_window().ok() == Some(window))
    {
        let _ = target.emit_to(
            tauri::EventTarget::webview_window(target.label()),
            "menu-action",
            command,
        );
    }
}

fn install_title_menu(app: &tauri::AppHandle) {
    if let Ok(mut guard) = TITLE_APP.lock() {
        *guard = Some(app.clone());
    }
    unsafe extern "C" {
        fn classic_set_menu_action(
            handler: extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char),
        );
    }
    unsafe { classic_set_menu_action(title_menu_action) }
}

static SCRIPT_APP: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

extern "C" fn script_open_file(path: *const std::ffi::c_char) {
    let Some(app) = SCRIPT_APP.lock().ok().and_then(|guard| guard.clone()) else {
        return;
    };
    let path = unsafe { std::ffi::CStr::from_ptr(path) }
        .to_string_lossy()
        .into_owned();
    let _ = open_window(&app, Some(Path::new(&path)));
}

extern "C" fn script_set_text(label: *const std::ffi::c_char, text: *const std::ffi::c_char) {
    let Some(app) = SCRIPT_APP.lock().ok().and_then(|guard| guard.clone()) else {
        return;
    };
    let label = unsafe { std::ffi::CStr::from_ptr(label) }
        .to_string_lossy()
        .into_owned();
    let text = unsafe { std::ffi::CStr::from_ptr(text) }
        .to_string_lossy()
        .into_owned();
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.emit_to(
            tauri::EventTarget::webview_window(&label),
            "script-set-text",
            text,
        );
    }
}

fn install_scripting(app: &tauri::AppHandle) {
    if let Ok(mut guard) = SCRIPT_APP.lock() {
        *guard = Some(app.clone());
    }
    unsafe extern "C" {
        fn classic_install_scripting(
            open_file: extern "C" fn(*const std::ffi::c_char),
            set_text: extern "C" fn(*const std::ffi::c_char, *const std::ffi::c_char),
        );
    }
    unsafe { classic_install_scripting(script_open_file, script_set_text) }
}

#[derive(Debug, PartialEq, Eq)]
enum MenuRoute<'a> {
    QuitAll,
    Help,
    RestoreVim,
    CloseAll,
    CloseWindow(&'a str),
    Document(&'a str),
    Drop,
}

/// The key window owns a menu command. AppKit can clear it while a menu is open,
/// so the main window is next, then the frontmost visible document window.
fn menu_focus<'a>(
    key: Option<&'a str>,
    main: Option<&'a str>,
    front: Option<&'a str>,
) -> Option<&'a str> {
    key.or(main).or(front)
}

fn menu_route<'a>(command: &str, focused: Option<&'a str>, labels: &[&'a str]) -> MenuRoute<'a> {
    if command == "quit" {
        return MenuRoute::QuitAll;
    }
    if command == "help" {
        return MenuRoute::Help;
    }
    if command == "close-all" {
        return MenuRoute::CloseAll;
    }
    let Some(focused) = focused else {
        return if command == "vim" {
            MenuRoute::RestoreVim
        } else {
            MenuRoute::Drop
        };
    };
    if focused.starts_with("preview-") && command == "close" {
        return MenuRoute::CloseWindow(focused);
    }
    if let Some(owner) = focused.strip_prefix("preview-") {
        if !labels.contains(&owner) {
            return if command == "vim" {
                MenuRoute::RestoreVim
            } else {
                MenuRoute::Drop
            };
        }
        return MenuRoute::Document(owner);
    }
    if labels.contains(&focused) {
        MenuRoute::Document(focused)
    } else if command == "vim" {
        MenuRoute::RestoreVim
    } else {
        MenuRoute::Drop
    }
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
    application.append(&PredefinedMenuItem::show_all(app, Some("Show All"))?)?;
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
        ("close-all", "Close All", "CmdOrCtrl+Alt+W"),
        ("save", "Save", "CmdOrCtrl+S"),
        ("save-as", "Save As…", "CmdOrCtrl+Alt+Shift+S"),
        ("import", "Import…", "CmdOrCtrl+Shift+I"),
        ("export", "Export…", "CmdOrCtrl+Shift+E"),
        ("print", "Print", "CmdOrCtrl+P"),
        ("print-formatted", "Print Formatted…", "CmdOrCtrl+Alt+P"),
    ] {
        file.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    file.append(&Submenu::with_id(app, "recent", "Open Recent", true)?)?;
    for (id, text) in [
        ("rename", "Rename…"),
        ("move", "Move To…"),
        ("revert", "Last Saved"),
        ("versions", "Browse All Versions…"),
        ("previous-save", "Previous Save"),
        ("last-opened", "Last Opened"),
    ] {
        file.append(&MenuItem::with_id(app, id, text, true, None::<&str>)?)?;
    }
    let icloud = Submenu::with_id(app, "icloud", "iCloud", true)?;
    for (id, text) in [
        ("icloud-browse", "Browse iCloud…"),
        ("icloud-open", "Open from iCloud…"),
        ("icloud-save", "Save to iCloud…"),
        ("icloud-move", "Move to iCloud"),
    ] {
        icloud.append(&MenuItem::with_id(app, id, text, true, None::<&str>)?)?;
    }
    file.append(&icloud)?;
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
    edit.append(&MenuItem::with_id(
        app,
        "delete",
        "Delete",
        true,
        None::<&str>,
    )?)?;
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
    // Option-Command-Left/Right move by sentence in the webview shortcut map;
    // an accelerator here would move the caret twice.
    for (id, text) in [
        ("next-sentence", "Next Sentence"),
        ("previous-sentence", "Previous Sentence"),
    ] {
        edit.append(&MenuItem::with_id(app, id, text, true, None::<&str>)?)?;
    }
    let spelling = Submenu::new(app, "Spelling and Grammar", true)?;
    // Command-: is Shift-Command-; on the keyboard.
    for (id, title, key) in [
        (
            "spelling-panel",
            "Show Spelling and Grammar",
            Some("CmdOrCtrl+Shift+;"),
        ),
        ("check-spelling", "Check Document Now", Some("CmdOrCtrl+;")),
        ("spellcheck", "Check Spelling While Typing", None),
        ("grammar", "Check Grammar With Spelling", None),
        ("correction", "Correct Spelling Automatically", None),
    ] {
        spelling.append(&MenuItem::with_id(
            app,
            format!("service-{id}"),
            title,
            true,
            key,
        )?)?;
    }
    edit.append(&spelling)?;
    let substitutions = Submenu::with_id(app, "substitutions", "Substitutions", true)?;
    let flags = substitution_flags(app.handle());
    substitutions.append(&MenuItem::with_id(
        app,
        "service-substitutions",
        "Show Substitutions",
        true,
        None::<&str>,
    )?)?;
    substitutions.append(&CheckMenuItem::with_id(
        app,
        "smart-copy-paste",
        "Smart Copy/Paste",
        true,
        *flags.get("smart-copy-paste").unwrap_or(&true),
        None::<&str>,
    )?)?;
    for (id, title) in [
        ("smart-quotes", "Smart Quotes"),
        ("smart-dashes", "Smart Dashes"),
    ] {
        substitutions.append(&MenuItem::with_id(
            app,
            format!("service-{id}"),
            title,
            true,
            None::<&str>,
        )?)?;
    }
    substitutions.append(&CheckMenuItem::with_id(
        app,
        "smart-links",
        "Smart Links",
        true,
        *flags.get("smart-links").unwrap_or(&true),
        None::<&str>,
    )?)?;
    substitutions.append(&CheckMenuItem::with_id(
        app,
        "data-detection",
        "Data Detection",
        true,
        *flags.get("data-detection").unwrap_or(&true),
        None::<&str>,
    )?)?;
    substitutions.append(&MenuItem::with_id(
        app,
        "service-replacement",
        "Text Replacement",
        true,
        None::<&str>,
    )?)?;
    edit.append(&substitutions)?;
    edit.append(&CheckMenuItem::with_id(
        app,
        "vim",
        "Vim Mode",
        true,
        vim_preference(app.handle()),
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
        ("focus", "Enter Focus Mode", "CmdOrCtrl+D"),
        ("preview", "Show Preview", "CmdOrCtrl+R"),
        ("format-bar", "Hide Format Bar", "CmdOrCtrl+Alt+T"),
        ("fullscreen", "Full Screen", "Ctrl+Super+F"),
    ] {
        view.append(&MenuItem::with_id(app, id, text, true, Some(key))?)?;
    }
    view.append(&CheckMenuItem::with_id(
        app,
        "dark",
        "Dark Mode",
        true,
        false,
        Some("CmdOrCtrl+Alt+D"),
    )?)?;
    root.append(&view)?;
    let window = Submenu::new(app, "Window", true)?;
    window.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window.append(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)?;
    window.append(&PredefinedMenuItem::separator(app)?)?;
    window.append(&PredefinedMenuItem::bring_all_to_front(
        app,
        Some("Bring All to Front"),
    )?)?;
    root.append(&window)?;
    let help = Submenu::new(app, "Help", true)?;
    help.append(&MenuItem::with_id(
        app,
        "help",
        "Writer Classic Help",
        true,
        None::<&str>,
    )?)?;
    root.append(&help)?;
    app.set_menu(root)?;
    app.on_menu_event(|app, event| {
        let command = event.id().as_ref();
        let windows = app.webview_windows();
        let labels: Vec<String> = windows.keys().cloned().collect();
        let label_refs: Vec<&str> = labels.iter().map(String::as_str).collect();
        let key = windows
            .values()
            .find(|window| window.is_focused().unwrap_or(false))
            .map(|window| window.label().to_string());
        let main = windows
            .values()
            .find(|window| macos::is_main_window(window))
            .map(|window| window.label().to_string());
        let front = windows
            .values()
            .filter(|window| !window.label().starts_with("preview-"))
            .filter_map(|window| {
                macos::front_order(window).map(|order| (order, window.label().to_string()))
            })
            .min()
            .map(|(_, label)| label);
        let focused = menu_focus(key.as_deref(), main.as_deref(), front.as_deref());
        match menu_route(command, focused, &label_refs) {
            MenuRoute::QuitAll => {
                let _ = lifecycle::request_quit(app.clone(), app.state());
            }
            MenuRoute::Help => {
                let _ = macos::open_help();
            }
            MenuRoute::RestoreVim => {
                let _ = set_vim_checked(app.clone(), vim_preference(app));
            }
            MenuRoute::CloseAll => close_all_documents(app.clone()),
            MenuRoute::CloseWindow(label) => {
                if let Some(window) = windows.get(label) {
                    let _ = window.close();
                }
            }
            MenuRoute::Document(label) => {
                if let Some(window) = windows.get(label) {
                    let _ = window.emit_to(
                        tauri::EventTarget::webview_window(label),
                        "menu-action",
                        command,
                    );
                }
            }
            MenuRoute::Drop => {}
        }
    });
    Ok(())
}

fn document_title(path: Option<&Path>) -> String {
    path.and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Untitled")
        .to_string()
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
        .visible(false)
        .title(document_title(path))
        .inner_size(860.0, 640.0)
        .min_inner_size(560.0, 320.0)
        .build()?;
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Started {
                return;
            }
            let window = webview.window();
            if window.label().starts_with("preview-") {
                return;
            }
            // Stay hidden. The document webview shows itself only after it sets the centered header.
            let title = window.title().unwrap_or_else(|_| "Untitled".into());
            let _ = macos::set_document_header(
                window,
                title,
                None,
                false,
                include_bytes!("../../brand/markdown-document-icon.png").to_vec(),
            );
        })
        .manage(lifecycle::QuitState::default())
        .invoke_handler(tauri::generate_handler![
            encoding::read_encoded,
            encoding::write_encoded,
            encoding::choose_text_files,
            read_text,
            read_bytes,
            write_text,
            write_bytes,
            classic_font,
            set_vim_checked,
            set_menu_checked,
            set_menu_text,
            close_all_documents,
            set_recent_files,
            lifecycle::request_quit,
            lifecycle::quit_ready,
            macos::browse_native_versions,
            macos::text_service,
            macos::set_document_header,
            macos::focus_editor_window,
            macos::prepare_print,
            macos::list_versions,
            macos::save_version,
            macos::remove_version,
            macos::move_document,
            macos::complete_word,
            macos::icloud_documents,
            macos::list_icloud,
            macos::move_to_icloud,
            macos::icloud_status,
            macos::open_help,
            macos::detect_data,
            macos::open_detected_url,
            macos::script_note_document,
            macos::script_forget_document
        ])
        .setup(|app| {
            macos::set_display_name("Writer Classic");
            install_title_menu(app.handle());
            install_scripting(app.handle());
            menu(app)?;
            if let Some(directory) = std::env::var_os("WRITER_CLASSIC_NATIVE_SELFTEST") {
                let directory = std::ffi::CString::new(directory.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())?;
                unsafe extern "C" {
                    fn classic_native_selftest(directory: *const std::ffi::c_char);
                }
                unsafe { classic_native_selftest(directory.as_ptr()) }
            }
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
    #[test]
    fn menu_commands_fall_back_to_main_then_front_document_window() {
        assert_eq!(
            menu_focus(Some("document-2"), Some("main"), Some("main")),
            Some("document-2")
        );
        assert_eq!(
            menu_focus(None, Some("main"), Some("document-2")),
            Some("main")
        );
        assert_eq!(
            menu_focus(None, None, Some("document-2")),
            Some("document-2")
        );
        assert_eq!(menu_focus(None, None, None), None);
        let labels = ["main"];
        assert_eq!(
            menu_route("dark", menu_focus(None, None, Some("main")), &labels),
            MenuRoute::Document("main")
        );
        assert_eq!(
            menu_route("dark", menu_focus(None, None, None), &labels),
            MenuRoute::Drop
        );
    }
    #[test]
    fn menu_commands_stay_on_one_document_and_quit_ignores_preview_focus() {
        let labels = ["main", "document-2", "preview-main"];
        assert_eq!(
            menu_route("quit", Some("preview-main"), &labels),
            MenuRoute::QuitAll
        );
        assert_eq!(
            menu_route("bold", Some("preview-main"), &labels),
            MenuRoute::Document("main")
        );
        assert_eq!(
            menu_route("close", Some("document-2"), &labels),
            MenuRoute::Document("document-2")
        );
        assert_eq!(
            menu_route("close", Some("preview-main"), &labels),
            MenuRoute::CloseWindow("preview-main")
        );
        assert_eq!(
            menu_route("close", Some("preview-missing"), &labels),
            MenuRoute::CloseWindow("preview-missing")
        );
        assert_eq!(menu_route("bold", None, &labels), MenuRoute::Drop);
        assert_eq!(menu_route("vim", None, &labels), MenuRoute::RestoreVim);
        assert_eq!(
            menu_route("vim", Some("preview-missing"), &labels),
            MenuRoute::RestoreVim
        );
        assert_eq!(
            menu_route("bold", Some("preview-missing"), &labels),
            MenuRoute::Drop
        );
    }
    #[test]
    fn close_all_reaches_every_document_but_no_preview() {
        let labels = ["main", "document-2", "preview-main", "preview-gone"];
        for focused in [None, Some("preview-main"), Some("document-2")] {
            assert_eq!(
                menu_route("close-all", focused, &labels),
                MenuRoute::CloseAll
            );
        }
        assert_eq!(document_labels(&labels), vec!["main", "document-2"]);
    }
    #[test]
    fn menu_declares_classic_commands_and_dynamic_view_titles() {
        let menu = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs")).unwrap();
        for item in [
            "PredefinedMenuItem::show_all(app, Some(\"Show All\"))",
            "(\"close-all\", \"Close All\", \"CmdOrCtrl+Alt+W\")",
            "(\"next-sentence\", \"Next Sentence\")",
            "(\"previous-sentence\", \"Previous Sentence\")",
            "Some(\"CmdOrCtrl+Shift+;\")",
            "Some(\"CmdOrCtrl+;\")",
            "(\"focus\", \"Enter Focus Mode\", \"CmdOrCtrl+D\")",
            "(\"preview\", \"Show Preview\", \"CmdOrCtrl+R\")",
            "(\"format-bar\", \"Hide Format Bar\", \"CmdOrCtrl+Alt+T\")",
        ] {
            assert!(menu.contains(item), "{item}");
        }
    }
    #[test]
    fn document_window_title_uses_the_file_name() {
        assert_eq!(document_title(None), "Untitled");
        assert_eq!(document_title(Some(Path::new("/tmp/Notes.md"))), "Notes.md");
    }
    #[test]
    fn markdown_association_declares_the_icon_and_classic_extensions() {
        let plist = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Info.plist")).unwrap();
        assert!(plist.contains("<key>UTTypeIconFile</key><string>markdown-document-icon</string>"));
        assert!(plist.contains("com.sidwood.writer-classic.markdown"));
        assert!(!plist.contains("<key>CFBundleTypeName</key><string>Markdown</string>\n      <key>NSDocumentClass</key><string>ClassicHistoryDocument</string>\n      <key>CFBundleTypeRole</key><string>Editor</string>\n      <key>CFBundleTypeIconFile</key><string>markdown-document-icon.icns</string>\n      <key>LSHandlerRank</key>"));
        for ext in [
            "mdml", "mdown", "mdtext", "mdtxt", "mdwn", "mkd", "mkdn", "mmd",
        ] {
            assert!(plist.contains(&format!("<string>{ext}</string>")), "{ext}");
        }
    }
    #[test]
    fn help_does_not_need_a_focused_document() {
        assert_eq!(menu_route("help", None, &["main"]), MenuRoute::Help);
        assert_eq!(
            menu_route("delete", Some("main"), &["main"]),
            MenuRoute::Document("main")
        );
    }
    #[test]
    fn help_book_and_applescript_are_declared() {
        let root = env!("CARGO_MANIFEST_DIR");
        let plist = fs::read_to_string(format!("{root}/Info.plist")).unwrap();
        assert!(plist.contains("<key>NSAppleScriptEnabled</key><true/>"));
        assert!(plist.contains("<string>WriterClassic.sdef</string>"));
        assert!(plist.contains("<string>WriterClassicHelp</string>"));
        assert!(plist.contains("com.sidwood.writer-classic.help"));
        let sdef = fs::read_to_string(format!("{root}/WriterClassic.sdef")).unwrap();
        assert!(sdef.contains("name=\"front document\""));
        assert!(sdef.contains("ClassicOpenCommand"));
        assert!(sdef.contains("name=\"text\""));
        let menu = fs::read_to_string(format!("{root}/src/main.rs")).unwrap();
        for item in [
            "Bring All to Front",
            "Delete",
            "Smart Copy/Paste",
            "Smart Links",
            "Data Detection",
            "Writer Classic Help",
        ] {
            assert!(menu.contains(item), "{item}");
        }
    }
    #[test]
    fn detected_urls_are_handed_to_the_workspace() {
        let source = concat!(env!("CARGO_MANIFEST_DIR"), "/src/classic-scripting.m");
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("open-url");
        let compile = std::process::Command::new("clang")
            .args([
                "-fobjc-arc",
                "-framework",
                "Cocoa",
                "-DCLASSIC_OPEN_URL_MAIN",
                "-x",
                "objective-c",
                source,
                "-o",
            ])
            .arg(&binary)
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "{}",
            String::from_utf8_lossy(&compile.stderr)
        );
        let ran = std::process::Command::new(&binary).output().unwrap();
        let stdout = String::from_utf8_lossy(&ran.stdout);
        assert!(
            ran.status.success(),
            "{stdout}\n{}",
            String::from_utf8_lossy(&ran.stderr)
        );
        assert!(stdout.contains("https://example.com/notes"), "{stdout}");
        assert!(stdout.contains("tel:+14155550134"), "{stdout}");
        assert!(stdout.contains("maps.apple.com"), "{stdout}");
    }
    fn objc_check(define: &str) {
        let source = concat!(env!("CARGO_MANIFEST_DIR"), "/src/classic-scripting.m");
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("check");
        let compile = std::process::Command::new("clang")
            .args([
                "-fobjc-arc",
                "-framework",
                "Cocoa",
                define,
                "-x",
                "objective-c",
                source,
                "-o",
            ])
            .arg(&binary)
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "{}",
            String::from_utf8_lossy(&compile.stderr)
        );
        let ran = std::process::Command::new(&binary).output().unwrap();
        assert!(
            ran.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&ran.stdout),
            String::from_utf8_lossy(&ran.stderr)
        );
    }
    #[test]
    fn applescript_gets_sets_and_opens_the_front_document() {
        objc_check("-DCLASSIC_SCRIPT_SELFTEST");
    }
    #[test]
    fn bring_all_to_front_keeps_every_window_visible_in_order() {
        objc_check("-DCLASSIC_ARRANGE_MAIN");
    }
    #[test]
    fn quicklook_generator_and_help_book_produce_previews() {
        let status = std::process::Command::new("python3")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../scripts/build-macos-extras.py"
            ))
            .arg("--check")
            .status()
            .unwrap();
        assert!(status.success());
    }
}
