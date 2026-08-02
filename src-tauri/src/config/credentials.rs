use crate::error::{AppError, AppResult};

#[cfg(windows)]
const SERVICE_NAME: &str = "aigit";
const PROVIDERS: [&str; 5] = [
    "openai",
    "claude",
    "deepseek",
    "embedding_openai",
    "github_pat",
];

pub trait CredentialStore {
    fn is_available(&self) -> bool {
        true
    }
    fn get(&self, provider: &str) -> AppResult<Option<String>>;
    fn set(&self, provider: &str, secret: &str) -> AppResult<()>;
    fn delete(&self, provider: &str) -> AppResult<()>;
}

pub struct SystemCredentialStore;

impl CredentialStore for SystemCredentialStore {
    fn is_available(&self) -> bool {
        platform::is_available()
    }

    fn get(&self, provider: &str) -> AppResult<Option<String>> {
        validate_provider(provider)?;
        platform::get(provider)
    }

    fn set(&self, provider: &str, secret: &str) -> AppResult<()> {
        validate_provider(provider)?;
        if secret.trim().is_empty() {
            return Err(AppError::Credential(
                "API key must not be empty; use delete_api_key to remove it".to_string(),
            ));
        }
        platform::set(provider, secret)
    }

    fn delete(&self, provider: &str) -> AppResult<()> {
        validate_provider(provider)?;
        platform::delete(provider)
    }
}

fn validate_provider(provider: &str) -> AppResult<()> {
    if PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err(AppError::Credential(format!(
            "Unsupported credential provider: {provider}"
        )))
    }
}

#[cfg(windows)]
mod platform {
    use super::{AppError, AppResult, SERVICE_NAME};
    use keyring::{Entry, Error};

    fn entry(provider: &str) -> AppResult<Entry> {
        Entry::new(SERVICE_NAME, provider)
            .map_err(|error| AppError::Credential(format!("Cannot access system keyring: {error}")))
    }

    pub fn is_available() -> bool {
        true
    }

    pub fn get(provider: &str) -> AppResult<Option<String>> {
        match entry(provider)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Credential(format!(
                "Cannot read {provider} credential: {error}"
            ))),
        }
    }

    pub fn set(provider: &str, secret: &str) -> AppResult<()> {
        entry(provider)?.set_password(secret).map_err(|error| {
            AppError::Credential(format!("Cannot store {provider} credential: {error}"))
        })
    }

    pub fn delete(provider: &str) -> AppResult<()> {
        match entry(provider)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::Credential(format!(
                "Cannot delete {provider} credential: {error}"
            ))),
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{AppError, AppResult};

    pub fn is_available() -> bool {
        false
    }

    pub fn get(_provider: &str) -> AppResult<Option<String>> {
        Ok(None)
    }

    pub fn set(_provider: &str, _secret: &str) -> AppResult<()> {
        Err(AppError::Credential(
            "Secure credential storage is unavailable on this platform".to_string(),
        ))
    }

    pub fn delete(_provider: &str) -> AppResult<()> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    pub struct MemoryCredentialStore {
        values: Mutex<HashMap<String, String>>,
        fail_set: bool,
        available: bool,
    }

    impl Default for MemoryCredentialStore {
        fn default() -> Self {
            Self {
                values: Mutex::new(HashMap::new()),
                fail_set: false,
                available: true,
            }
        }
    }
    impl MemoryCredentialStore {
        pub fn failing() -> Self {
            Self {
                values: Mutex::new(HashMap::new()),
                fail_set: true,
                available: true,
            }
        }

        pub fn unavailable() -> Self {
            Self {
                values: Mutex::new(HashMap::new()),
                fail_set: false,
                available: false,
            }
        }
    }

    impl CredentialStore for MemoryCredentialStore {
        fn is_available(&self) -> bool {
            self.available
        }

        fn get(&self, provider: &str) -> AppResult<Option<String>> {
            Ok(self
                .values
                .lock()
                .expect("credential lock")
                .get(provider)
                .cloned())
        }

        fn set(&self, provider: &str, secret: &str) -> AppResult<()> {
            if self.fail_set {
                return Err(AppError::Credential("injected write failure".into()));
            }
            self.values
                .lock()
                .expect("credential lock")
                .insert(provider.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, provider: &str) -> AppResult<()> {
            self.values
                .lock()
                .expect("credential lock")
                .remove(provider);
            Ok(())
        }
    }
}
