// Pipeline Environment Management - Micromamba + Nextflow bootstrapping

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

/// Global lock to prevent concurrent bootstrap attempts
static SETUP_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineEnvironment {
    pub env_path: PathBuf,
    pub micromamba_path: PathBuf,
    pub nextflow_path: PathBuf,
    pub java_home: PathBuf,
    pub is_initialized: bool,
    pub nextflow_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub stage: String,
    pub message: String,
    pub progress: f32,
}

/// Get the path to the bundled platform-specific micromamba binary
fn get_bundled_micromamba_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let binary_name = if cfg!(target_os = "windows") {
        "micromamba-win-64.exe"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "micromamba-osx-arm64"
        } else {
            "micromamba-osx-64"
        }
    } else {
        "micromamba-linux-64"
    };

    let micromamba_path = resource_path.join("bin").join(binary_name);

    if !micromamba_path.exists() {
        return Err(format!(
            "Bundled micromamba binary not found at {:?}. Run scripts/download-micromamba.sh before building.",
            micromamba_path
        ));
    }

    Ok(micromamba_path)
}

/// Get the path where micromamba will be copied and used
pub fn get_micromamba_binary_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let env_path = get_env_path(app_handle)?;
    let binary_name = if cfg!(target_os = "windows") {
        "micromamba.exe"
    } else {
        "micromamba"
    };
    Ok(env_path.join("bin").join(binary_name))
}

/// Get the pipeline environment base directory
pub fn get_env_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let home = app_handle
        .path()
        .home_dir()
        .map_err(|e| format!("Failed to get home dir: {}", e))?;

    Ok(home.join(".openbio-pipelines"))
}

/// The actual conda env prefix where packages live
fn get_conda_env_prefix(env_path: &PathBuf) -> PathBuf {
    env_path
        .join("micromamba")
        .join("envs")
        .join("openbio-pipelines")
}

/// The config file that records a successful setup
fn get_config_path(env_path: &PathBuf) -> PathBuf {
    env_path.join("env_config.json")
}

/// Check if the pipeline environment is already initialized.
/// Checks the saved config file AND verifies BOTH nextflow AND java binaries exist.
pub fn check_environment_initialized(app_handle: &AppHandle) -> Result<bool, String> {
    let env_path = get_env_path(app_handle)?;
    let config_path = get_config_path(&env_path);

    println!("[pipeline_env] check_environment_initialized");
    println!("[pipeline_env]   env_path: {:?}", env_path);
    println!("[pipeline_env]   config_path: {:?}", config_path);
    println!(
        "[pipeline_env]   config_path exists: {}",
        config_path.exists()
    );

    if !config_path.exists() {
        println!("[pipeline_env]   -> NOT initialized (no config file)");
        return Ok(false);
    }

    let contents = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(e) => {
            println!(
                "[pipeline_env]   -> NOT initialized (can't read config: {})",
                e
            );
            return Ok(false);
        }
    };

    let config: PipelineEnvironment = match serde_json::from_str(&contents) {
        Ok(c) => c,
        Err(e) => {
            println!("[pipeline_env]   -> NOT initialized (bad JSON: {})", e);
            return Ok(false);
        }
    };

    if !config.is_initialized {
        println!("[pipeline_env]   -> NOT initialized (is_initialized=false)");
        return Ok(false);
    }

    // Check nextflow exists
    let nf_exists = config.nextflow_path.exists();
    println!("[pipeline_env]   nextflow_path: {:?}", config.nextflow_path);
    println!("[pipeline_env]   nextflow exists: {}", nf_exists);

    if !nf_exists {
        println!("[pipeline_env]   -> NOT initialized (nextflow missing)");
        return Ok(false);
    }

    // Check java exists (critical - nextflow won't work without it)
    // On macOS ARM64, openjdk is at lib/jvm/bin/java, and java_home points to lib/jvm
    let java_bin = if cfg!(windows) { "java.exe" } else { "java" };
    let java_path = config.java_home.join("bin").join(java_bin);
    let java_exists = java_path.exists();
    println!("[pipeline_env]   java_path: {:?}", java_path);
    println!("[pipeline_env]   java exists: {}", java_exists);

    if !java_exists {
        println!("[pipeline_env]   -> NOT initialized (java missing - need re-setup)");
        // Delete the config file to force re-setup
        let _ = fs::remove_file(&config_path);
        return Ok(false);
    }

    // Check micromamba binary itself exists (the one we use to run)
    let micromamba_path = get_micromamba_binary_path(app_handle)?;
    println!("[pipeline_env]   micromamba_path: {:?}", micromamba_path);
    println!(
        "[pipeline_env]   micromamba exists: {}",
        micromamba_path.exists()
    );

    if !micromamba_path.exists() {
        println!("[pipeline_env]   -> NOT initialized (micromamba binary missing)");
        let _ = fs::remove_file(&config_path);
        return Ok(false);
    }

    println!("[pipeline_env]   -> initialized: true");
    Ok(true)
}

/// Check if a setup is currently running
pub fn is_setup_in_progress() -> bool {
    SETUP_IN_PROGRESS.load(Ordering::SeqCst)
}

/// Bootstrap the pipeline environment using micromamba.
/// Uses an atomic lock to prevent concurrent calls.
pub async fn bootstrap_environment<F>(
    app_handle: &AppHandle,
    progress_callback: F,
) -> Result<PipelineEnvironment, String>
where
    F: Fn(SetupProgress) + Send + 'static,
{
    // Prevent concurrent setup attempts
    println!("[pipeline_env] bootstrap_environment called");
    println!(
        "[pipeline_env]   SETUP_IN_PROGRESS was: {}",
        SETUP_IN_PROGRESS.load(Ordering::SeqCst)
    );
    if SETUP_IN_PROGRESS
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        println!("[pipeline_env]   -> BLOCKED: another setup is already running");
        return Err("__ALREADY_IN_PROGRESS__".to_string());
    }
    println!("[pipeline_env]   -> Lock acquired, starting bootstrap");

    let result = do_bootstrap(app_handle, &progress_callback).await;
    SETUP_IN_PROGRESS.store(false, Ordering::SeqCst);
    println!(
        "[pipeline_env]   -> Bootstrap finished, lock released. Result: {}",
        if result.is_ok() { "OK" } else { "ERR" }
    );
    if let Err(ref e) = result {
        println!("[pipeline_env]   -> Error: {}", e);
    }
    result
}

async fn do_bootstrap<F>(
    app_handle: &AppHandle,
    progress_callback: &F,
) -> Result<PipelineEnvironment, String>
where
    F: Fn(SetupProgress) + Send + 'static,
{
    println!("[pipeline_env] do_bootstrap: preparing env directory...");
    let env_path = get_env_path(app_handle)?;
    println!("[pipeline_env]   env_path: {:?}", env_path);

    fs::create_dir_all(env_path.join("bin"))
        .map_err(|e| format!("Failed to create env bin directory: {}", e))?;

    let bundled_micromamba = get_bundled_micromamba_path(app_handle)?;
    let micromamba_path = get_micromamba_binary_path(app_handle)?;

    println!(
        "[pipeline_env]   copying micromamba from {:?} to {:?}",
        bundled_micromamba, micromamba_path
    );
    fs::copy(&bundled_micromamba, &micromamba_path)
        .map_err(|e| format!("Failed to copy micromamba: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&micromamba_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&micromamba_path, perms);
        }
    }

    let root_prefix = env_path.join("micromamba");
    let env_prefix = get_conda_env_prefix(&env_path);
    println!("[pipeline_env]   root_prefix: {:?}", root_prefix);
    println!("[pipeline_env]   env_prefix: {:?}", env_prefix);
    println!(
        "[pipeline_env]   env_prefix exists: {}",
        env_prefix.exists()
    );

    progress_callback(SetupProgress {
        stage: "init".to_string(),
        message: "Setting up package manager...".to_string(),
        progress: 0.05,
    });
    println!("[pipeline_env]   emitted progress: init 0.05");

    fs::create_dir_all(&root_prefix)
        .map_err(|e| format!("Failed to create micromamba root: {}", e))?;

    if env_prefix.exists() {
        let nextflow_bin = if cfg!(windows) {
            "nextflow.exe"
        } else {
            "nextflow"
        };
        let java_bin = if cfg!(windows) { "java.exe" } else { "java" };

        let has_nextflow = env_prefix.join("bin").join(nextflow_bin).exists();
        // On macOS ARM64, openjdk installs to lib/jvm/bin/java
        let has_java = env_prefix
            .join("lib")
            .join("jvm")
            .join("bin")
            .join(java_bin)
            .exists();
        let has_conda_meta = env_prefix.join("conda-meta").exists();

        println!(
            "[pipeline_env]   has_conda_meta: {}, has_nextflow: {}, has_java: {}",
            has_conda_meta, has_nextflow, has_java
        );

        // Only consider complete if BOTH nextflow AND java exist
        if has_conda_meta && has_nextflow && has_java {
            println!("[pipeline_env]   -> env already complete, finalizing");
            return finalize_environment(
                app_handle,
                &env_prefix,
                &micromamba_path,
                progress_callback,
            );
        }

        println!("[pipeline_env]   -> env incomplete/corrupted, removing...");
        progress_callback(SetupProgress {
            stage: "cleanup".to_string(),
            message: "Removing incomplete previous installation...".to_string(),
            progress: 0.1,
        });

        if let Err(e) = fs::remove_dir_all(&env_prefix) {
            println!(
                "[pipeline_env]   -> remove_dir_all failed: {}, retrying in 2s...",
                e
            );
            std::thread::sleep(std::time::Duration::from_secs(2));
            fs::remove_dir_all(&env_prefix).map_err(|e2| {
                format!(
                    "Cannot clean up previous installation (tried twice).\nPath: {}\nError: {}",
                    env_prefix.display(),
                    e2
                )
            })?;
        }
        println!("[pipeline_env]   -> cleanup done");
    }

    progress_callback(SetupProgress {
        stage: "install".to_string(),
        message: "Installing Java and Nextflow (2-5 minutes)...".to_string(),
        progress: 0.2,
    });
    println!("[pipeline_env]   emitted progress: install 0.2");

    let cmd_args = [
        "create",
        "-y",
        "-p",
        env_prefix.to_str().unwrap(),
        "-c",
        "conda-forge",
        "-c",
        "bioconda",
        "openjdk=17",
        "nextflow",
    ];
    println!(
        "[pipeline_env]   running: {:?} {:?}",
        micromamba_path, cmd_args
    );
    println!("[pipeline_env]   MAMBA_ROOT_PREFIX={:?}", root_prefix);
    println!("[pipeline_env]   (this will block until micromamba finishes...)");

    let mut child = Command::new(&micromamba_path)
        .args(&cmd_args)
        .env("MAMBA_ROOT_PREFIX", &root_prefix)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn micromamba: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);

    // Process output in real-time to update UI
    let mut current_progress = 0.2;
    for line in reader.lines().flatten() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Log to terminal for debugging
        println!("[micromamba] {}", line);

        // Simple heuristic for progress increments (cap at 0.85)
        if current_progress < 0.85 {
            current_progress += 0.005; // Tiny steps per line
        }

        // Emit progress with the current line as message
        progress_callback(SetupProgress {
            stage: "install".to_string(),
            message: line.to_string(),
            progress: current_progress,
        });
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for micromamba: {}", e))?;

    println!("[pipeline_env]   micromamba exited with status: {}", status);

    if !status.success() {
        // We don't have the full stderr easily since we didn't capture it as a string,
        // but it should be in the terminal logs
        let _ = fs::remove_dir_all(&env_prefix);
        return Err("Installation failed. Check terminal logs for details.".to_string());
    }

    println!("[pipeline_env]   micromamba succeeded, finalizing...");
    finalize_environment(app_handle, &env_prefix, &micromamba_path, progress_callback)
}

/// Verify the installation and persist the config file
fn finalize_environment<F>(
    app_handle: &AppHandle,
    env_prefix: &PathBuf,
    micromamba_path: &PathBuf,
    progress_callback: &F,
) -> Result<PipelineEnvironment, String>
where
    F: Fn(SetupProgress) + Send + 'static,
{
    println!("[pipeline_env] finalize_environment");
    progress_callback(SetupProgress {
        stage: "verify".to_string(),
        message: "Verifying installation...".to_string(),
        progress: 0.9,
    });

    let nextflow_bin = if cfg!(windows) {
        "nextflow.exe"
    } else {
        "nextflow"
    };
    let nextflow_path = env_prefix.join("bin").join(nextflow_bin);
    // On macOS ARM64, openjdk conda-forge installs to lib/jvm
    let java_home = env_prefix.join("lib").join("jvm");

    println!("[pipeline_env]   nextflow_path: {:?}", nextflow_path);
    println!(
        "[pipeline_env]   nextflow exists: {}",
        nextflow_path.exists()
    );

    if !nextflow_path.exists() {
        println!("[pipeline_env]   -> FAIL: nextflow binary not found after install!");
        // List what IS in the bin directory
        if let Ok(entries) = fs::read_dir(env_prefix.join("bin")) {
            println!("[pipeline_env]   contents of bin/:");
            for entry in entries.flatten() {
                println!("[pipeline_env]     {}", entry.file_name().to_string_lossy());
            }
        }
        let _ = fs::remove_dir_all(env_prefix);
        return Err(
            "Installation completed but Nextflow binary not found. Please try again.".to_string(),
        );
    }

    // Get Nextflow version (best effort — don't fail if this doesn't work)
    let nextflow_version = Command::new(&nextflow_path)
        .arg("-version")
        .env("JAVA_HOME", &java_home)
        .output()
        .ok()
        .and_then(|out| {
            String::from_utf8(out.stdout)
                .ok()
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        });

    let env = PipelineEnvironment {
        env_path: env_prefix.clone(),
        micromamba_path: micromamba_path.clone(),
        nextflow_path,
        java_home,
        is_initialized: true,
        nextflow_version,
    };

    // Save config — this is what check_environment_initialized reads
    println!("[pipeline_env]   saving config...");
    save_environment_config(app_handle, &env)?;
    println!("[pipeline_env]   config saved OK");

    progress_callback(SetupProgress {
        stage: "complete".to_string(),
        message: "Pipeline environment ready!".to_string(),
        progress: 1.0,
    });
    println!("[pipeline_env]   -> DONE! Environment ready.");

    Ok(env)
}

/// Check if Docker is available and the daemon is running
pub fn check_docker_available() -> Result<bool, String> {
    match Command::new("docker")
        .arg("ps")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(out) => Ok(out.status.success()),
        Err(_) => Ok(false),
    }
}

/// Get Docker version if available
pub fn get_docker_version() -> Option<String> {
    Command::new("docker")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.lines().next().map(|l| l.to_string()))
}

/// Load saved environment configuration
pub fn load_environment_config(
    app_handle: &AppHandle,
) -> Result<Option<PipelineEnvironment>, String> {
    let env_path = get_env_path(app_handle)?;
    let config_path = get_config_path(&env_path);

    if !config_path.exists() {
        return Ok(None);
    }

    let contents =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;

    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

/// Save environment configuration
pub fn save_environment_config(
    app_handle: &AppHandle,
    config: &PipelineEnvironment,
) -> Result<(), String> {
    let env_path = get_env_path(app_handle)?;
    fs::create_dir_all(&env_path).map_err(|e| format!("Failed to create env directory: {}", e))?;

    let config_path = get_config_path(&env_path);
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}
