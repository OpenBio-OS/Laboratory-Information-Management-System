// Tauri commands for Insight module - file streaming and data loading

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ExperimentFiles {
    matrix_path: String,
    coords_path: String,
}

#[derive(Debug, Serialize)]
pub struct FileChunk {
    chunk: Vec<u8>,
    complete: bool,
}

/// Get file paths for an experiment's analysis outputs
#[tauri::command]
pub async fn get_experiment_files(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<ExperimentFiles, String> {
    // Query database for experiment's DigitalAssets
    // Look for files like matrix.mtx and coordinates.csv
    
    // TODO: Implement database query
    // For now, return placeholder paths
    
    Ok(ExperimentFiles {
        matrix_path: format!("/data/experiments/{}/matrix.mtx", experiment_id),
        coords_path: format!("/data/experiments/{}/coordinates.csv", experiment_id),
    })
}

/// Stream a file in chunks using memory mapping
/// This avoids loading the entire 50GB file into RAM
#[tauri::command]
pub async fn stream_file_chunk(
    path: String,
    offset: usize,
    chunk_size: usize,
) -> Result<FileChunk, String> {
    use memmap2::Mmap;
    use std::fs::File;

    // Open file with memory mapping
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };

    // Check if we've reached the end
    if offset >= mmap.len() {
        return Ok(FileChunk {
            chunk: Vec::new(),
            complete: true,
        });
    }

    // Calculate actual chunk size (may be smaller at end of file)
    let end = (offset + chunk_size).min(mmap.len());
    let chunk = mmap[offset..end].to_vec();
    let complete = end >= mmap.len();

    Ok(FileChunk { chunk, complete })
}

/// Load coordinates file (CSV with x,y columns)
#[tauri::command]
pub async fn load_coordinates(path: String) -> Result<Vec<f32>, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let file = File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut coords = Vec::new();

    for line in reader.lines().skip(1) {
        // Skip header
        let line = line.map_err(|e| e.to_string())?;
        let parts: Vec<&str> = line.split(',').collect();

        if parts.len() >= 2 {
            let x: f32 = parts[0].parse().map_err(|e| format!("Parse error: {}", e))?;
            let y: f32 = parts[1].parse().map_err(|e| format!("Parse error: {}", e))?;
            coords.push(x);
            coords.push(y);
        }
    }

    Ok(coords)
}

/// Get metadata for an experiment (used in tooltips)
#[tauri::command]
pub async fn get_experiment_metadata(
    experiment_id: String,
    state: State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    // Query database for experiment details, samples, equipment, etc.
    // Return JSON with all relevant context
    
    // TODO: Implement database query
    
    Ok(serde_json::json!({
        "experiment_id": experiment_id,
        "name": "Experiment 505",
        "samples": ["P-405"],
        "equipment": "Sequencer-1",
        "notes": "Used extra reagent"
    }))
}
