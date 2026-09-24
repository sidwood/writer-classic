use objc2::AnyThread;
use objc2_foundation::{NSData, NSString};
use std::{fs, path::Path};

pub fn decode(bytes: &[u8], encoding: usize) -> Result<String, String> {
    if encoding == 4 {
        return String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string());
    }
    NSString::initWithData_encoding(NSString::alloc(), &NSData::with_bytes(bytes), encoding)
        .map(|s| s.to_string())
        .ok_or("The file cannot be decoded using that encoding".into())
}
#[tauri::command]
pub fn read_encoded(path: String, encoding: usize) -> Result<String, String> {
    decode(&fs::read(path).map_err(|e| e.to_string())?, encoding)
}
#[tauri::command]
pub fn write_encoded(
    path: String,
    text: String,
    expected: Option<String>,
    encoding: usize,
) -> Result<(), String> {
    if let Some(expected) = expected {
        if read_encoded(path.clone(), encoding)? != expected {
            return Err(
                "The file changed outside Writer Classic. Use Save As to keep both copies.".into(),
            );
        }
    }
    let value = NSString::from_str(&text);
    let data = value
        .dataUsingEncoding_allowLossyConversion(encoding, false)
        .ok_or("This encoding cannot represent the document. Save as UTF-8 instead.")?;
    super::atomic_write(Path::new(&path), &data.to_vec())
}
#[derive(serde::Deserialize, serde::Serialize)]
pub struct Selection {
    paths: Vec<String>,
    encoding: usize,
}
#[tauri::command]
pub fn choose_text_files(directory: Option<String>) -> Result<Option<Selection>, String> {
    let _main = objc2::MainThreadMarker::new().ok_or("Open panel requires main thread")?;
    unsafe extern "C" {
        fn classic_open_documents(directory: *const std::ffi::c_char) -> *mut std::ffi::c_char;
        fn free(p: *mut std::ffi::c_void);
    }
    let directory = directory.and_then(|path| std::ffi::CString::new(path).ok());
    let pointer = unsafe {
        classic_open_documents(
            directory
                .as_ref()
                .map(|path| path.as_ptr())
                .unwrap_or(std::ptr::null()),
        )
    };
    if pointer.is_null() {
        return Ok(None);
    }
    let result = serde_json::from_slice(unsafe { std::ffi::CStr::from_ptr(pointer) }.to_bytes())
        .map_err(|e| e.to_string());
    unsafe {
        free(pointer.cast());
    }
    result.map(Some)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn alternate_encodings_round_trip_without_loss() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("text.txt").to_string_lossy().to_string();
        fs::write(&p, [0x63, 0x61, 0x66, 0xe9]).unwrap();
        assert!(super::super::read_text(p.clone()).is_err());
        assert_eq!(read_encoded(p.clone(), 12).unwrap(), "café");
        write_encoded(p.clone(), "café!".into(), Some("café".into()), 12).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"caf\xe9!");
        assert!(write_encoded(p.clone(), "漢".into(), Some("café!".into()), 12).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"caf\xe9!");
        fs::write(&p, [0x41, 0, 0xa9, 0x03]).unwrap();
        assert_eq!(read_encoded(p.clone(), 0x94000100).unwrap(), "AΩ");
        write_encoded(p.clone(), "ΩA".into(), Some("AΩ".into()), 0x94000100).unwrap();
        assert_eq!(fs::read(p).unwrap(), [0xa9, 0x03, 0x41, 0]);
    }
}
