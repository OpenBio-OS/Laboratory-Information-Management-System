// Matrix parsing for Matrix Market (.mtx) format
// Used by single-cell tools like Cell Ranger, Scanpy, Seurat

use std::io::{BufRead, BufReader};
use wasm_bindgen::prelude::*;

/// Sparse matrix in COO (Coordinate) format
#[derive(Debug, Clone)]
pub struct MatrixData {
    pub n_cells: usize,
    pub n_genes: usize,
    pub n_entries: usize,
    pub rows: Vec<usize>, // Cell indices
    pub cols: Vec<usize>, // Gene indices
    pub values: Vec<f32>, // Expression values
}

impl Default for MatrixData {
    fn default() -> Self {
        Self {
            n_cells: 0,
            n_genes: 0,
            n_entries: 0,
            rows: Vec::new(),
            cols: Vec::new(),
            values: Vec::new(),
        }
    }
}

/// Parse Matrix Market format
/// Format: Header lines starting with %, then rows of "row col value"
pub fn parse_mtx(data: &[u8]) -> Result<MatrixData, JsValue> {
    let reader = BufReader::new(data);
    let mut lines = reader.lines();

    // Skip header comments
    let mut n_genes = 0;
    let mut n_cells = 0;
    let mut n_entries = 0;

    for line_result in lines.by_ref() {
        let line = line_result.map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Skip comments
        if line.starts_with('%') {
            continue;
        }

        // First non-comment line is dimensions: genes cells entries
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() == 3 {
            n_genes = parts[0]
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
            n_cells = parts[1]
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
            n_entries = parts[2]
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
            break;
        }
    }

    // Pre-allocate vectors
    let mut rows = Vec::with_capacity(n_entries);
    let mut cols = Vec::with_capacity(n_entries);
    let mut values = Vec::with_capacity(n_entries);

    // Parse data entries
    for line_result in lines {
        let line = line_result.map_err(|e| JsValue::from_str(&e.to_string()))?;
        let parts: Vec<&str> = line.split_whitespace().collect();

        if parts.len() >= 3 {
            let row: usize = parts[0]
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
            let col: usize = parts[1]
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
            let value: f32 = parts[2]
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

            rows.push(row - 1); // Convert to 0-indexed
            cols.push(col - 1);
            values.push(value);
        }
    }

    Ok(MatrixData {
        n_genes,
        n_cells,
        n_entries,
        rows,
        cols,
        values,
    })
}

/// Get expression values for a specific gene across all cells
pub fn get_gene_expression(matrix: &MatrixData, gene_idx: usize) -> Vec<f32> {
    let mut expression = vec![0.0; matrix.n_cells];

    for i in 0..matrix.n_entries {
        if matrix.rows[i] == gene_idx {
            let cell_idx = matrix.cols[i];
            expression[cell_idx] = matrix.values[i];
        }
    }

    expression
}

/// Get expression values for a specific cell across all genes
pub fn get_cell_profile(matrix: &MatrixData, cell_idx: usize) -> Vec<f32> {
    let mut profile = vec![0.0; matrix.n_genes];

    for i in 0..matrix.n_entries {
        if matrix.cols[i] == cell_idx {
            let gene_idx = matrix.rows[i];
            profile[gene_idx] = matrix.values[i];
        }
    }

    profile
}

/// PCA data point
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PcaPoint {
    pub label: String,
    pub x: f32,
    pub y: f32,
}

/// Parse PCA data from CSV/TSV
/// Expected format: header row, then rows with "label,pc1,pc2" or similar
pub fn parse_pca_csv(data: &[u8], delimiter: u8) -> Result<Vec<PcaPoint>, JsValue> {
    let reader = BufReader::new(data);
    let mut points = Vec::new();
    let mut lines = reader.lines();

    // Skip header
    let _header = lines.next();

    for line_result in lines {
        let line = line_result.map_err(|e| JsValue::from_str(&e.to_string()))?;
        let parts: Vec<&str> = line.split(delimiter as char).collect();

        if parts.len() >= 3 {
            let label = parts[0].trim_matches('"').to_string();
            let x: f32 = parts[1]
                .trim()
                .trim_matches('"')
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error in X: {}", e)))?;
            let y: f32 = parts[2]
                .trim()
                .trim_matches('"')
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Parse error in Y: {}", e)))?;

            points.push(PcaPoint { label, x, y });
        }
    }

    Ok(points)
}
