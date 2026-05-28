use std::env;

pub const REDOU_MODEL_PROVIDER_ENV: &str = "REDOU_MODEL_PROVIDER";
pub const REDOU_MODEL_BASE_URL_ENV: &str = "REDOU_MODEL_BASE_URL";
pub const REDOU_MODEL_API_KEY_ENV: &str = "REDOU_MODEL_API_KEY";
pub const REDOU_MODEL_NAME_ENV: &str = "REDOU_MODEL_NAME";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedouModelEnv {
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedouModelEnvError {
    pub missing: Vec<&'static str>,
}

impl RedouModelEnv {
    pub fn from_process_env() -> Self {
        Self {
            provider: read_env(REDOU_MODEL_PROVIDER_ENV),
            base_url: read_env(REDOU_MODEL_BASE_URL_ENV),
            api_key: read_env(REDOU_MODEL_API_KEY_ENV),
            model_name: read_env(REDOU_MODEL_NAME_ENV),
        }
    }

    pub fn missing_keys(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if self.provider.is_none() {
            missing.push(REDOU_MODEL_PROVIDER_ENV);
        }
        if self.base_url.is_none() {
            missing.push(REDOU_MODEL_BASE_URL_ENV);
        }
        if self.api_key.is_none() {
            missing.push(REDOU_MODEL_API_KEY_ENV);
        }
        if self.model_name.is_none() {
            missing.push(REDOU_MODEL_NAME_ENV);
        }
        missing
    }

    pub fn require_complete(&self) -> Result<(), RedouModelEnvError> {
        let missing = self.missing_keys();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(RedouModelEnvError { missing })
        }
    }
}

fn read_env(key: &str) -> Option<String> {
    env::var(key).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}
