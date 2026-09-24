use objc2_app_kit::{NSApplication, NSSpellChecker};
use objc2_foundation::{
    NSFileManager, NSFileManagerItemReplacementOptions, NSFileVersion, NSFileVersionAddingOptions,
    NSRange, NSString, NSURL,
};
use serde::Serialize;
use std::path::Path;

fn url(path: &Path) -> objc2::rc::Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

pub fn replace_file(path: &Path, temporary: &Path) -> Result<(), String> {
    NSFileManager::defaultManager()
        .replaceItemAtURL_withItemAtURL_backupItemName_options_resultingItemURL_error(
            &url(path),
            &url(temporary),
            None,
            NSFileManagerItemReplacementOptions::empty(),
            None,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browse_native_versions(window: tauri::Window, path: String) -> Result<(), String> {
    use tauri::Emitter;
    let _main = objc2::MainThreadMarker::new().ok_or("Versions require the main thread")?;
    extern "C" fn finished(context: *mut std::ffi::c_void) {
        let window = unsafe { Box::from_raw(context as *mut tauri::Window) };
        let _ = window.emit_to(
            tauri::EventTarget::webview_window(window.label()),
            "versions-finished",
            (),
        );
    }
    unsafe extern "C" {
        fn classic_browse_versions(
            window: *mut std::ffi::c_void,
            path: *const std::ffi::c_char,
            finished: extern "C" fn(*mut std::ffi::c_void),
            context: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_char;
        fn free(pointer: *mut std::ffi::c_void);
    }
    let pointer = window.ns_window().map_err(|e| e.to_string())?;
    let path = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
    let context = Box::into_raw(Box::new(window)).cast();
    let error = unsafe { classic_browse_versions(pointer, path.as_ptr(), finished, context) };
    if error.is_null() {
        Ok(())
    } else {
        let message = unsafe { std::ffi::CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned();
        unsafe {
            free(error.cast());
            drop(Box::from_raw(context as *mut tauri::Window));
        }
        Err(message)
    }
}
#[derive(Serialize)]
pub struct Version {
    pub path: String,
    pub timestamp: f64,
    pub text: String,
}

#[tauri::command]
pub fn list_versions(path: String) -> Result<Vec<Version>, String> {
    let versions = NSFileVersion::otherVersionsOfItemAtURL(&url(Path::new(&path)));
    let mut result = Vec::new();
    if let Some(versions) = versions {
        for version in &versions {
            if let Some(path) = version.URL().path() {
                let path = path.to_string();
                result.push(Version {
                    text: std::fs::read_to_string(&path).map_err(|e| e.to_string())?,
                    path,
                    timestamp: version
                        .modificationDate()
                        .map(|date| date.timeIntervalSince1970())
                        .unwrap_or(0.0),
                });
            }
        }
    }
    result.sort_by(|a, b| b.timestamp.total_cmp(&a.timestamp));
    Ok(result)
}

#[tauri::command]
pub fn save_version(path: String) -> Result<(), String> {
    let item = url(Path::new(&path));
    NSFileVersion::addVersionOfItemAtURL_withContentsOfURL_options_error(
        &item,
        &item,
        NSFileVersionAddingOptions::empty(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_version(path: String, version_path: Option<String>) -> Result<(), String> {
    let item = url(Path::new(&path));
    if let Some(target) = version_path {
        if let Some(versions) = NSFileVersion::otherVersionsOfItemAtURL(&item) {
            for version in &versions {
                if version
                    .URL()
                    .path()
                    .is_some_and(|p| p.to_string() == target)
                {
                    return version.removeAndReturnError().map_err(|e| e.to_string());
                }
            }
        }
        Err("That version no longer exists".into())
    } else {
        NSFileVersion::removeOtherVersionsOfItemAtURL_error(&item).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn move_document(path: String, destination: String) -> Result<(), String> {
    NSFileManager::defaultManager()
        .moveItemAtURL_toURL_error(&url(Path::new(&path)), &url(Path::new(&destination)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn complete_word(text: String, from: usize, to: usize) -> Vec<String> {
    if to < from || to > text.encode_utf16().count() {
        return Vec::new();
    }
    NSSpellChecker::sharedSpellChecker()
        .completionsForPartialWordRange_inString_language_inSpellDocumentWithTag(
            NSRange::new(from, to - from),
            &NSString::from_str(&text),
            None,
            0,
        )
        .map(|values| values.iter().map(|s| s.to_string()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn icloud_status() -> Result<String, String> {
    NSFileManager::defaultManager().URLForUbiquityContainerIdentifier(None)
        .and_then(|url| url.path()).map(|p| p.to_string())
        .ok_or("No iCloud ubiquity container is available. An Apple Developer signing identity and iCloud container entitlement are required. Files in iCloud Drive can still be opened and saved through the system dialogs.".into())
}

pub fn within_icloud(root: &Path, destination: &Path) -> bool {
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    let Some(parent) = destination.parent() else {
        return false;
    };
    std::fs::canonicalize(parent).is_ok_and(|parent| parent == root || parent.starts_with(&root))
}

#[tauri::command]
pub fn icloud_documents() -> Result<String, String> {
    let path = std::path::PathBuf::from(icloud_status()?).join("Documents");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_icloud() -> Result<Vec<String>, String> {
    let root = std::path::PathBuf::from(icloud_documents()?);
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            files.push(entry.path().to_string_lossy().into_owned());
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn move_to_icloud(path: String, destination: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(icloud_documents()?);
    if !within_icloud(&root, Path::new(&destination)) {
        return Err("Choose a destination in the iCloud document container".into());
    }
    NSFileManager::defaultManager()
        .setUbiquitous_itemAtURL_destinationURL_error(
            true,
            &url(Path::new(&path)),
            &url(Path::new(&destination)),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn text_service(service: String) -> Result<(), String> {
    use objc2::{sel, MainThreadMarker};
    let selector = match service.as_str() {
        "spelling-panel" => sel!(showGuessPanel:),
        "check-spelling" => sel!(checkSpelling:),
        "spellcheck" => sel!(toggleContinuousSpellChecking:),
        "grammar" => sel!(toggleGrammarChecking:),
        "correction" => sel!(toggleAutomaticSpellingCorrection:),
        "substitutions" => sel!(orderFrontSubstitutionsPanel:),
        "smart-quotes" => sel!(toggleAutomaticQuoteSubstitution:),
        "smart-dashes" => sel!(toggleAutomaticDashSubstitution:),
        "replacement" => sel!(toggleAutomaticTextReplacement:),
        "dictionary" => sel!(lookUpInDictionary:),
        _ => return Err("Unknown text service".into()),
    };
    let main = MainThreadMarker::new().ok_or("Text services require the main thread")?;
    // The fixed selectors are Cocoa responder actions with one object parameter;
    // nil target routes the action to the editor's current first responder.
    if unsafe { NSApplication::sharedApplication(main).sendAction_to_from(selector, None, None) } {
        Ok(())
    } else {
        Err("The active editor does not provide this macOS text service.".into())
    }
}

#[tauri::command]
pub fn set_document_header(
    window: tauri::Window,
    title: String,
    path: Option<String>,
    edited: bool,
    icon: Vec<u8>,
) -> Result<(), String> {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSImage, NSWindow, NSWindowButton, NSWindowTitleVisibility};
    use objc2_foundation::{NSData, NSSize};
    let _main = MainThreadMarker::new().ok_or("Document title updates require the main thread")?;
    let bundled;
    let bytes = if icon.is_empty() {
        bundled = include_bytes!("../../brand/markdown-document-icon.png").to_vec();
        bundled.as_slice()
    } else {
        icon.as_slice()
    };
    let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes))
        .ok_or("Could not load the Markdown document icon")?;
    image.setSize(NSSize::new(16.0, 16.0));
    let pointer = window.ns_window().map_err(|e| e.to_string())?;
    // Tauri retains this NSWindow; Cocoa access is restricted to its main thread.
    let native = unsafe { &*(pointer as *const NSWindow) };
    let represented = path
        .map(|path| url(Path::new(&path)))
        .or_else(|| Some(url(Path::new("/Untitled.md"))));
    native.setRepresentedURL(represented.as_deref());
    native.setTitle(&NSString::from_str(&title));
    native.setTitleVisibility(NSWindowTitleVisibility::Visible);
    native.setDocumentEdited(edited);
    if let Some(proxy) = native.standardWindowButton(NSWindowButton::DocumentIconButton) {
        proxy.setImage(Some(&image));
    }
    unsafe extern "C" {
        fn classic_center_title(window: *mut std::ffi::c_void);
    }
    unsafe {
        classic_center_title(pointer);
    }
    Ok(())
}

#[tauri::command]
pub fn open_help() -> Result<(), String> {
    unsafe extern "C" {
        fn classic_open_help() -> *mut std::ffi::c_char;
        fn free(pointer: *mut std::ffi::c_void);
    }
    let error = unsafe { classic_open_help() };
    if error.is_null() {
        Ok(())
    } else {
        let message = unsafe { std::ffi::CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned();
        unsafe { free(error.cast()) }
        Err(message)
    }
}

#[tauri::command]
pub fn detect_data(
    text: String,
    links: bool,
    data: bool,
) -> Result<Vec<serde_json::Value>, String> {
    let text = std::ffi::CString::new(text).map_err(|e| e.to_string())?;
    unsafe extern "C" {
        fn classic_detect_data(
            text: *const std::ffi::c_char,
            links: i32,
            data: i32,
        ) -> *mut std::ffi::c_char;
        fn free(pointer: *mut std::ffi::c_void);
    }
    let raw = unsafe { classic_detect_data(text.as_ptr(), i32::from(links), i32::from(data)) };
    if raw.is_null() {
        return Ok(Vec::new());
    }
    let json = unsafe { std::ffi::CStr::from_ptr(raw) }
        .to_string_lossy()
        .into_owned();
    unsafe { free(raw.cast()) }
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn script_note_document(
    window: tauri::Window,
    title: String,
    path: String,
    text: String,
) -> Result<(), String> {
    let label = std::ffi::CString::new(window.label()).map_err(|e| e.to_string())?;
    let title = std::ffi::CString::new(title).map_err(|e| e.to_string())?;
    let path = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
    let text = std::ffi::CString::new(text).map_err(|e| e.to_string())?;
    let pointer = window.ns_window().map_err(|e| e.to_string())?;
    unsafe extern "C" {
        fn classic_note_document(
            label: *const std::ffi::c_char,
            title: *const std::ffi::c_char,
            path: *const std::ffi::c_char,
            text: *const std::ffi::c_char,
            window: *mut std::ffi::c_void,
        );
    }
    unsafe {
        classic_note_document(
            label.as_ptr(),
            title.as_ptr(),
            path.as_ptr(),
            text.as_ptr(),
            pointer,
        );
    }
    Ok(())
}

#[tauri::command]
pub fn script_forget_document(window: tauri::Window) -> Result<(), String> {
    let label = std::ffi::CString::new(window.label()).map_err(|e| e.to_string())?;
    unsafe extern "C" {
        fn classic_forget_document(label: *const std::ffi::c_char);
    }
    unsafe { classic_forget_document(label.as_ptr()) }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn icloud_container_probe() {
        println!("iCloud container: {:?}", icloud_status());
    }
    #[test]
    fn native_versions_survive_atomic_replacement_and_can_be_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("versions.md").to_string_lossy().to_string();
        super::super::write_text(path.clone(), "first".into(), None).unwrap();
        save_version(path.clone()).unwrap();
        super::super::write_text(path.clone(), "second".into(), Some("first".into())).unwrap();
        let versions = list_versions(path.clone()).unwrap();
        assert_eq!(versions[0].text, "first");
        remove_version(path.clone(), Some(versions[0].path.clone())).unwrap();
        assert!(list_versions(path).unwrap().is_empty());
    }
    #[test]
    fn move_preserves_text_and_does_not_overwrite_destination() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.md").to_string_lossy().to_string();
        let to = dir.path().join("b.md").to_string_lossy().to_string();
        std::fs::write(&from, "unchanged").unwrap();
        std::fs::write(&to, "other").unwrap();
        assert!(move_document(from.clone(), to.clone()).is_err());
        std::fs::remove_file(&to).unwrap();
        move_document(from.clone(), to.clone()).unwrap();
        assert!(!Path::new(&from).exists());
        assert_eq!(std::fs::read_to_string(to).unwrap(), "unchanged");
    }
    #[test]
    fn icloud_destination_must_stay_inside_the_container() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Documents");
        std::fs::create_dir(&root).unwrap();
        assert!(within_icloud(&root, &root.join("notes.md")));
        assert!(!within_icloud(
            &root,
            dir.path().join("outside.md").as_path()
        ));
    }
    #[test]
    fn bundled_document_icon_matches_the_handed_off_png() {
        let bundled = include_bytes!("../../brand/markdown-document-icon.png");
        let disk = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../brand/markdown-document-icon.png"
        ))
        .unwrap();
        assert_eq!(bundled, disk.as_slice());
        assert!(bundled.starts_with(b"\x89PNG"));
    }
    #[test]
    fn native_title_is_centered_at_860_and_1280_and_after_resize() {
        let source = concat!(env!("CARGO_MANIFEST_DIR"), "/src/classic-native.m");
        let icon = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../brand/markdown-document-icon.png"
        );
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("title-geometry");
        let compile = std::process::Command::new("clang")
            .args([
                "-fobjc-arc",
                "-framework",
                "Cocoa",
                "-DCLASSIC_TITLE_GEOMETRY_MAIN",
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
        let measured = std::process::Command::new(&binary)
            .arg(icon)
            .output()
            .unwrap();
        assert!(
            measured.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&measured.stdout),
            String::from_utf8_lossy(&measured.stderr)
        );
        let report = String::from_utf8_lossy(&measured.stdout);
        assert!(report.contains("width=860.0"), "{report}");
        assert!(report.contains("width=1280.0"), "{report}");
        assert!(report.contains("resize "), "{report}");
    }
}
