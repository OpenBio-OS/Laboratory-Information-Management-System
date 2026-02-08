//! OpenBio WASM Engine
//! 
//! WebAssembly module for single-cell data analysis and visualization.
//! Runs in Web Worker for non-blocking computation with SharedArrayBuffer.

mod matrix;
mod gating;
mod stats;
mod utils;

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// Re-export modules
pub use matrix::{MatrixData, parse_mtx};
pub use gating::{Point, Polygon, point_in_polygon, gate_cells};
pub use stats::{mann_whitney_u, differential_expression};

/// Initialize the WASM module (call once on load)
#[wasm_bindgen(start)]
pub fn init() {
    // Set up panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Cell data structure for visualization
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cell {
    pub x: f32,
    pub y: f32,
    pub cluster: u32,
    pub selected: bool,
}

/// Main WASM Engine - manages data and computation
#[wasm_bindgen]
pub struct WasmEngine {
    matrix: Option<MatrixData>,
    cells: Vec<Cell>,
    selection_mask: Vec<bool>,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create new engine instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        utils::set_panic_hook();
        Self {
            matrix: None,
            cells: Vec::new(),
            selection_mask: Vec::new(),
        }
    }

    /// Load matrix data from bytes (zero-copy via SharedArrayBuffer)
    /// This is called from Web Worker with data streamed from Rust backend
    pub fn load_matrix(&mut self, data: &[u8]) -> Result<(), JsValue> {
        self.matrix = Some(parse_mtx(data)?);
        self.cells = Vec::new(); // Will be populated during UMAP calculation
        Ok(())
    }

    /// Get matrix dimensions
    pub fn get_dimensions(&self) -> Result<String, JsValue> {
        if let Some(matrix) = &self.matrix {
            Ok(format!("{}x{}", matrix.n_cells, matrix.n_genes))
        } else {
            Err(JsValue::from_str("No matrix loaded"))
        }
    }

    /// Set cell coordinates (from UMAP/t-SNE calculation)
    pub fn set_coordinates(&mut self, coords: &[f32]) -> Result<(), JsValue> {
        if coords.len() % 2 != 0 {
            return Err(JsValue::from_str("Coordinates must be pairs (x, y)"));
        }

        self.cells.clear();
        for chunk in coords.chunks_exact(2) {
            self.cells.push(Cell {
                x: chunk[0],
                y: chunk[1],
                cluster: 0,
                selected: false,
            });
        }

        self.selection_mask = vec![false; self.cells.len()];
        Ok(())
    }

    /// Feature A: Gating - apply lasso selection
    pub fn apply_gate(&mut self, polygon: Vec<f32>) -> Result<usize, JsValue> {
        if polygon.len() % 2 != 0 {
            return Err(JsValue::from_str("Polygon must be pairs (x, y)"));
        }

        let poly_points: Vec<Point> = polygon
            .chunks_exact(2)
            .map(|chunk| Point {
                x: chunk[0],
                y: chunk[1],
            })
            .collect();

        let poly = Polygon::new(poly_points);
        let mut count = 0;

        for (i, cell) in self.cells.iter_mut().enumerate() {
            let point = Point { x: cell.x, y: cell.y };
            let inside = point_in_polygon(&point, &poly);
            self.selection_mask[i] = inside;
            cell.selected = inside;
            if inside {
                count += 1;
            }
        }

        Ok(count)
    }

    /// Feature B: Differential expression on selected cells
    pub fn analyze_selection(&self) -> Result<String, JsValue> {
        if self.matrix.is_none() {
            return Err(JsValue::from_str("No matrix loaded"));
        }

        // Get indices of selected cells
        let selected: Vec<usize> = self
            .selection_mask
            .iter()
            .enumerate()
            .filter(|(_, &selected)| selected)
            .map(|(i, _)| i)
            .collect();

        if selected.is_empty() {
            return Err(JsValue::from_str("No cells selected"));
        }

        // Run differential expression analysis
        // TODO: Implement actual statistics
        
        Ok(format!("{} cells selected", selected.len()))
    }

    /// Get cell data for rendering (returns JSON)
    pub fn get_cells_json(&self) -> String {
        serde_json::to_string(&self.cells).unwrap_or_default()
    }

    /// Get selection mask as array
    pub fn get_selection_mask(&self) -> Vec<u8> {
        self.selection_mask
            .iter()
            .map(|&b| if b { 1 } else { 0 })
            .collect()
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

