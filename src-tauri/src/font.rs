//! Classic 2.1.6 ships its Nitti Pro faces encrypted. It decrypts each file in
//! memory before CTFontManagerRegisterGraphicsFont: the 12 fragments below are
//! reordered and joined with "-", the passphrase is hashed with SHA-256, and the
//! file is AES-256-CBC decrypted with a zero IV and PKCS7 padding (see the font
//! loader at 0x1000165b9 and the CCCryptor helper at 0x100038305). The clone
//! repeats that in memory only; the plaintext is never written to disk.

const FRAGMENTS: [&str; 12] = [
    "plov", "oad", "vamch", "ush", "ob", "hen", "civ", "vit", "juts", "yuj", "boshk", "i",
];

#[link(name = "System")]
unsafe extern "C" {
    fn CC_SHA256(data: *const u8, len: u32, md: *mut u8) -> *mut u8;
    #[allow(clippy::too_many_arguments)]
    fn CCCrypt(
        op: u32,
        alg: u32,
        options: u32,
        key: *const u8,
        key_length: usize,
        iv: *const u8,
        data_in: *const u8,
        data_in_length: usize,
        data_out: *mut u8,
        data_out_available: usize,
        data_out_moved: *mut usize,
    ) -> i32;
}

const DECRYPT: u32 = 1;
const AES: u32 = 0;
const PKCS7: u32 = 1;

/// Returns the OpenType bytes of an installed Classic font file.
pub fn decrypt(cipher: &[u8]) -> Result<Vec<u8>, String> {
    let passphrase = FRAGMENTS.join("-");
    let mut key = [0u8; 32];
    unsafe {
        CC_SHA256(
            passphrase.as_ptr(),
            passphrase.len() as u32,
            key.as_mut_ptr(),
        )
    };
    let iv = [0u8; 16];
    let mut out = vec![0u8; cipher.len() + 16];
    let mut moved = 0usize;
    let status = unsafe {
        CCCrypt(
            DECRYPT,
            AES,
            PKCS7,
            key.as_ptr(),
            key.len(),
            iv.as_ptr(),
            cipher.as_ptr(),
            cipher.len(),
            out.as_mut_ptr(),
            out.len(),
            &mut moved,
        )
    };
    if status != 0 {
        return Err(format!("Classic font did not decrypt ({status})"));
    }
    out.truncate(moved);
    if !is_font(&out) {
        return Err("Classic font decrypted to something that is not a font".into());
    }
    Ok(out)
}

/// OpenType CFF (OTTO) or TrueType (0x00010000, true) header.
pub fn is_font(bytes: &[u8]) -> bool {
    matches!(
        bytes.get(..4),
        Some(b"OTTO") | Some(b"true") | Some([0, 1, 0, 0])
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_classic_faces_decrypt_to_opentype_in_memory() {
        let dir =
            std::path::Path::new("/Applications/iA Writer Classic.app/Contents/Resources/Fonts");
        if !dir.exists() {
            eprintln!("iA Writer Classic is not installed; skipping");
            return;
        }
        for name in ["NittiPro-Medium", "NittiPro-Bold", "NittiPro-MediumItalic"] {
            let cipher = std::fs::read(dir.join(format!("{name}.otf"))).unwrap();
            assert!(!is_font(&cipher), "{name} is stored encrypted");
            let plain = decrypt(&cipher).unwrap();
            assert_eq!(&plain[..4], b"OTTO", "{name}");
        }
    }

    #[test]
    fn bytes_that_are_not_ciphertext_are_rejected() {
        assert!(decrypt(b"not a font at all").is_err());
    }
}
