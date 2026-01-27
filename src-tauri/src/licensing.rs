// src-tauri/src/licensing.rs
//! Instance-based license validation for Hub and Enterprise modes
//! No user accounts - just license keys tied to servers

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
    pub key: String,
    pub tier: String, // "hub" or "enterprise"
    pub expires_at: String,
    pub organization_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationRequest {
    pub license_key: String,
    pub server_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResponse {
    pub valid: bool,
    pub tier: Option<String>,
    pub expires_at: Option<String>,
    pub organization_name: Option<String>,
    pub reason: Option<String>,
}

pub struct LicenseValidator {
    validation_endpoint: String,
}

impl LicenseValidator {
    pub fn new() -> Self {
        Self {
            validation_endpoint: "https://your-vercel-app.vercel.app/api/license/validate"
                .to_string(),
        }
    }

    /// Validate license with backend (requires internet)
    pub async fn validate_online(
        &self,
        key: &str,
        server_id: Option<String>,
    ) -> Result<License, String> {
        let client = reqwest::Client::new();
        let response = client
            .post(&self.validation_endpoint)
            .json(&ValidationRequest {
                license_key: key.to_string(),
                server_id,
            })
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        if response.status().is_success() {
            let validation: ValidationResponse = response
                .json()
                .await
                .map_err(|e| format!("Invalid response: {}", e))?;

            if !validation.valid {
                return Err(validation
                    .reason
                    .unwrap_or_else(|| "License invalid".to_string()));
            }

            Ok(License {
                key: key.to_string(),
                tier: validation.tier.unwrap_or_default(),
                expires_at: validation.expires_at.unwrap_or_default(),
                organization_name: validation.organization_name,
            })
        } else {
            Err("Failed to validate license".to_string())
        }
    }

    /// Offline validation (grace period after last online check)
    pub fn validate_offline(&self, cached_license: &License) -> Result<(), String> {
        let expires = chrono::DateTime::parse_from_rfc3339(&cached_license.expires_at)
            .map_err(|_| "Invalid expiration date format".to_string())?;

        let now = chrono::Utc::now();
        let expires_utc = expires.with_timezone(&chrono::Utc);

        // 30-day grace period for offline use
        let grace_period = chrono::Duration::days(30);
        if now > expires_utc + grace_period {
            return Err(
                "License expired and requires online validation".to_string(),
            );
        }

        Ok(())
    }

    /// Start trial (generates offline license for 14 days)
    pub async fn start_trial(&self, email: &str, tier: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let response = client
            .post(&self.validation_endpoint.replace("/validate", "/purchase"))
            .json(&serde_json::json!({
                "action": "start-trial",
                "email": email,
                "tier": tier
            }))
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        if response.status().is_success() {
            let data: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Invalid response: {}", e))?;

            data["trial_license"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "No trial license generated".to_string())
        } else {
            Err("Failed to start trial".to_string())
        }
    }
}

/// Generate unique server identifier (machine fingerprint)
pub fn generate_server_id() -> String {
    use std::process::Command;

    // macOS
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("ioreg")
            .args(&["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            if let Ok(s) = String::from_utf8(output.stdout) {
                if let Some(line) = s.lines().find(|l| l.contains("IOPlatformUUID")) {
                    if let Some(uuid) = line.split('"').nth(3) {
                        return uuid.to_string();
                    }
                }
            }
        }
    }

    // Linux
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("cat").arg("/etc/machine-id").output() {
            if let Ok(id) = String::from_utf8(output.stdout) {
                return id.trim().to_string();
            }
        }
    }

    // Windows
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("wmic")
            .args(&["csproduct", "get", "uuid"])
            .output()
        {
            if let Ok(id) = String::from_utf8(output.stdout) {
                return id.split('\n').nth(1).unwrap_or("unknown").trim().to_string();
            }
        }
    }

    // Fallback
    "unknown".to_string()
}

/// Check if a deployment mode requires a license
pub fn requires_license(mode: &crate::DeploymentMode) -> bool {
    matches!(
        mode,
        crate::DeploymentMode::Hub | crate::DeploymentMode::Enterprise
    )
}
