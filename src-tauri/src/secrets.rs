//! Current-user DPAPI storage compatible with ConvertFrom-SecureString hex.
//! Runtime never starts a shell and never retains a decrypted-key cache.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, Debug)]
pub enum SecretName {
    PitchApi,
    KinoClient,
    KinoTokens,
}
impl SecretName {
    pub fn file_stem(self) -> &'static str {
        match self {
            Self::PitchApi => "pitchapi",
            Self::KinoClient => "kinoclient",
            Self::KinoTokens => "kino",
        }
    }
}
#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("Хранилище секретов доступно только в Windows.")]
    Unsupported,
    #[error("Секрет не найден.")]
    NotFound,
    #[error("Сохранённый секрет не удалось прочитать или расшифровать.")]
    Unreadable,
    #[error("Не удалось сохранить секрет.")]
    WriteFailed,
}
impl SecretError {
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

pub fn secrets_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("AppData").join("Local"))
        })
        .map(|p| p.join("SportsDesk").join("secrets"))
}
pub fn secret_path(name: SecretName) -> Option<PathBuf> {
    secrets_dir().map(|d| d.join(format!("{}.dpapi", name.file_stem())))
}
pub fn secret_exists(name: SecretName) -> bool {
    secret_path(name).is_some_and(|p| p.is_file())
}

fn decode_hex(raw: &str) -> Result<Vec<u8>, SecretError> {
    let hex = raw
        .trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .rfind(|s| !s.is_empty())
        .ok_or(SecretError::Unreadable)?;
    if hex.is_empty()
        || hex.len() > 65_536
        || !hex.len().is_multiple_of(2)
        || !hex.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(SecretError::Unreadable);
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| SecretError::Unreadable))
        .collect()
}
fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(windows)]
mod dpapi {
    use super::SecretError;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    struct LocalBlob(CRYPT_INTEGER_BLOB);
    impl LocalBlob {
        fn bytes(&self) -> &[u8] {
            if self.0.cbData == 0 || self.0.pbData.is_null() {
                return &[];
            }
            // DPAPI owns this allocation until LocalFree in Drop.
            unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize) }
        }
    }
    impl Drop for LocalBlob {
        fn drop(&mut self) {
            if !self.0.pbData.is_null() {
                unsafe {
                    for i in 0..self.0.cbData as usize {
                        std::ptr::write_volatile(self.0.pbData.add(i), 0);
                    }
                    let _ = LocalFree(HLOCAL(self.0.pbData.cast()));
                }
            }
        }
    }
    pub fn unprotect(bytes: &[u8]) -> Result<String, SecretError> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr().cast_mut(),
        };
        let mut output = LocalBlob(CRYPT_INTEGER_BLOB::default());
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        }
        .map_err(|_| SecretError::Unreadable)?;
        let bytes = output.bytes();
        if bytes.is_empty() || !bytes.len().is_multiple_of(2) {
            return Err(SecretError::Unreadable);
        }
        let mut units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        let value = String::from_utf16(&units).map_err(|_| SecretError::Unreadable);
        for unit in &mut units {
            unsafe {
                std::ptr::write_volatile(unit, 0);
            }
        }
        let value = value?.trim_end_matches(['\r', '\n']).to_owned();
        if value.is_empty() {
            Err(SecretError::Unreadable)
        } else {
            Ok(value)
        }
    }
    pub fn protect(value: &str) -> Result<Vec<u8>, SecretError> {
        if value.is_empty() {
            return Err(SecretError::WriteFailed);
        }
        let mut bytes: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_mut_ptr(),
        };
        let mut output = LocalBlob(CRYPT_INTEGER_BLOB::default());
        let result = unsafe {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        };
        for byte in &mut bytes {
            unsafe {
                std::ptr::write_volatile(byte, 0);
            }
        }
        result.map_err(|_| SecretError::WriteFailed)?;
        Ok(output.bytes().to_vec())
    }
}

fn read_secret_at(path: &Path) -> Result<String, SecretError> {
    let raw = std::fs::read_to_string(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            SecretError::NotFound
        } else {
            SecretError::Unreadable
        }
    })?;
    let bytes = decode_hex(&raw)?;
    #[cfg(windows)]
    {
        dpapi::unprotect(&bytes)
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err(SecretError::Unsupported)
    }
}
pub fn read_secret(name: SecretName) -> Result<String, SecretError> {
    read_secret_at(&secret_path(name).ok_or(SecretError::Unsupported)?)
}
fn write_secret_at(path: &Path, value: &str) -> Result<(), SecretError> {
    #[cfg(windows)]
    let bytes = dpapi::protect(value)?;
    #[cfg(not(windows))]
    let bytes: Vec<u8> = {
        let _ = value;
        return Err(SecretError::Unsupported);
    };
    if bytes.is_empty() || bytes.len() > 32_768 {
        return Err(SecretError::WriteFailed);
    }
    let parent = path.parent().ok_or(SecretError::WriteFailed)?;
    std::fs::create_dir_all(parent).map_err(|_| SecretError::WriteFailed)?;
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let temp = parent.join(format!(
        ".secret-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        std::fs::write(&temp, encode_hex(&bytes)).map_err(|_| SecretError::WriteFailed)?;
        std::fs::rename(&temp, path).map_err(|_| SecretError::WriteFailed)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
pub fn write_secret(name: SecretName, value: &str) -> Result<(), SecretError> {
    write_secret_at(&secret_path(name).ok_or(SecretError::Unsupported)?, value)
}
pub fn delete_secret(name: SecretName) -> Result<(), SecretError> {
    match secret_path(name) {
        Some(p) if p.exists() => std::fs::remove_file(p).map_err(|_| SecretError::WriteFailed),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_ciphertext_and_preserves_bom_compatibility() {
        assert_eq!(decode_hex("\u{feff}\r\n00aB\n").unwrap(), vec![0, 171]);
        for bad in ["", "xyz", "abc", "你好"] {
            assert!(decode_hex(bad).is_err());
        }
    }
    #[test]
    #[cfg(windows)]
    fn native_dpapi_roundtrip_rotation_unicode_and_corruption() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("test-secrets-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.dpapi");
        write_secret_at(&path, "unit-test-first").unwrap();
        assert_eq!(read_secret_at(&path).unwrap(), "unit-test-first");
        write_secret_at(&path, "unit-test-ключ-⚽").unwrap();
        assert_eq!(read_secret_at(&path).unwrap(), "unit-test-ключ-⚽");
        let mut bytes = decode_hex(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        std::fs::write(&path, encode_hex(&bytes)).unwrap();
        assert!(matches!(
            read_secret_at(&path),
            Err(SecretError::Unreadable)
        ));
        std::fs::write(&path, "not a DPAPI payload").unwrap();
        assert!(matches!(
            read_secret_at(&path),
            Err(SecretError::Unreadable)
        ));
        std::fs::remove_file(&path).unwrap();
        assert!(matches!(read_secret_at(&path), Err(SecretError::NotFound)));
        assert!(matches!(read_secret_at(&dir), Err(SecretError::Unreadable)));
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    #[cfg(windows)]
    fn reads_existing_powershell_format_without_migration() {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        let mut child = Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command", "$env:PSModulePath = Join-Path $PSHOME 'Modules'; [Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $v = [Console]::In.ReadToEnd(); ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)"])
            .creation_flags(0x08000000).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all("compatibility-test-ключ".as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "PowerShell compatibility helper failed"
        );
        let bytes = decode_hex(std::str::from_utf8(&out.stdout).unwrap()).unwrap();
        assert_eq!(dpapi::unprotect(&bytes).unwrap(), "compatibility-test-ключ");
    }
}
