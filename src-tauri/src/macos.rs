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
    let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(&icon))
        .ok_or("Could not load the Markdown document icon")?;
    image.setSize(NSSize::new(16.0, 16.0));
    let pointer = window.ns_window().map_err(|e| e.to_string())?;
    // Tauri retains this NSWindow; Cocoa access is restricted to its main thread.
    let native = unsafe { &*(pointer as *const NSWindow) };
    let represented = path
        .map(|path| url(Path::new(&path)))
        .or_else(|| NSURL::URLWithString(&NSString::from_str("writer-classic:Untitled.md")));
    native.setRepresentedURL(represented.as_deref());
    native.setTitle(&NSString::from_str(&title));
    native.setTitleVisibility(NSWindowTitleVisibility::Visible);
    native.setDocumentEdited(edited);
    if let Some(proxy) = native.standardWindowButton(NSWindowButton::DocumentIconButton) {
        proxy.setImage(Some(&image));
    }
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
}
