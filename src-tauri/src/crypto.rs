//! At-rest protection for local data files (chat history, code index).
//!
//! On Windows the payloads are sealed with DPAPI in user scope, so the files
//! under `%LOCALAPPDATA%\aigit` can only be decrypted by the same Windows
//! account. Other platforms store the files as plaintext — PRIVACY.md
//! documents this. Sealed payloads carry a magic prefix so existing
//! plaintext files keep loading and are re-sealed on the next save.

use crate::error::{AppError, AppResult};

/// Marks a payload as DPAPI-sealed. Plaintext data (legacy files) never
/// starts with these bytes because valid JSON/embedding payloads start
/// differently.
const SEALED_MAGIC: &[u8] = b"AIGITDPAPI1";

/// Encrypt `plaintext` for at-rest storage. Returns the input unchanged on
/// platforms without a supported protector.
pub fn encrypt_at_rest(plaintext: &[u8]) -> Vec<u8> {
    #[cfg(windows)]
    {
        match dpapi::protect(plaintext) {
            Ok(sealed) => {
                let mut out = Vec::with_capacity(SEALED_MAGIC.len() + sealed.len());
                out.extend_from_slice(SEALED_MAGIC);
                out.extend_from_slice(&sealed);
                out
            }
            // DPAPI should never fail for user-scoped blobs; fall back to
            // plaintext rather than losing user data.
            Err(error) => {
                log::warn!("[aigit] DPAPI protect failed, storing plaintext: {error}");
                plaintext.to_vec()
            }
        }
    }
    #[cfg(not(windows))]
    {
        plaintext.to_vec()
    }
}

/// Decrypt a payload produced by [`encrypt_at_rest`]. Unsealed data (legacy
/// plaintext files) passes through unchanged so the first load migrates it.
pub fn decrypt_at_rest(payload: &[u8]) -> AppResult<Vec<u8>> {
    if !payload.starts_with(SEALED_MAGIC) {
        return Ok(payload.to_vec());
    }
    #[cfg(windows)]
    {
        dpapi::unprotect(&payload[SEALED_MAGIC.len()..]).map_err(|error| {
            AppError::Config(format!(
                "Cannot decrypt local data (was it created by another Windows account?): {error}"
            ))
        })
    }
    #[cfg(not(windows))]
    {
        // Sealed payloads cannot exist on platforms that never seal them.
        Err(AppError::Config(
            "Sealed local data is not supported on this platform".into(),
        ))
    }
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: plaintext.len() as u32,
                pbData: plaintext.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok = CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err("CryptProtectData failed".into());
            }
            let sealed = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as HLOCAL);
            Ok(sealed)
        }
    }

    pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: sealed.len() as u32,
                pbData: sealed.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok = CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err("CryptUnprotectData failed".into());
            }
            let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as HLOCAL);
            Ok(plain)
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip_and_legacy_passthrough() {
        let secret = b"chat history payload".to_vec();
        let sealed = encrypt_at_rest(&secret);
        assert!(sealed.starts_with(SEALED_MAGIC));
        assert_eq!(decrypt_at_rest(&sealed).expect("unseal"), secret);

        // Legacy plaintext files pass through untouched.
        assert_eq!(decrypt_at_rest(&secret).expect("passthrough"), secret);
    }
}
