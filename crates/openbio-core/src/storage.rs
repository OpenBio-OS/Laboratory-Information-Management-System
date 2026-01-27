//! Storage abstraction for OpenBio
//! 
//! Provides a unified interface for file storage across local filesystem and S3.

use std::path::Path;

/// Storage backend trait
#[allow(async_fn_in_trait)]
pub trait StorageBackend: Send + Sync {
    /// Store a file
    async fn put(&self, key: &str, data: &[u8]) -> Result<(), crate::Error>;
    
    /// Retrieve a file
    async fn get(&self, key: &str) -> Result<Vec<u8>, crate::Error>;
    
    /// Delete a file
    async fn delete(&self, key: &str) -> Result<(), crate::Error>;
    
    /// Check if a file exists
    async fn exists(&self, key: &str) -> Result<bool, crate::Error>;
    
    /// Get a presigned URL for direct download (for S3) or file path (for local)
    async fn get_url(&self, key: &str) -> Result<String, crate::Error>;
}

/// Local filesystem storage implementation
pub struct LocalStorage {
    base_path: std::path::PathBuf,
}

impl LocalStorage {
    pub fn new(base_path: impl AsRef<Path>) -> Self {
        Self {
            base_path: base_path.as_ref().to_path_buf(),
        }
    }
}

impl StorageBackend for LocalStorage {
    async fn put(&self, key: &str, data: &[u8]) -> Result<(), crate::Error> {
        let path = self.base_path.join(key);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, data)?;
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>, crate::Error> {
        let path = self.base_path.join(key);
        Ok(std::fs::read(&path)?)
    }

    async fn delete(&self, key: &str) -> Result<(), crate::Error> {
        let path = self.base_path.join(key);
        std::fs::remove_file(&path)?;
        Ok(())
    }

    async fn exists(&self, key: &str) -> Result<bool, crate::Error> {
        let path = self.base_path.join(key);
        Ok(path.exists())
    }

    async fn get_url(&self, key: &str) -> Result<String, crate::Error> {
        let path = self.base_path.join(key);
        Ok(path.to_string_lossy().to_string())
    }
}
