//! OpenBio WASM Engine
//!
//! WebAssembly module for single-cell data analysis and visualization.
//! Runs in Web Worker for non-blocking computation with SharedArrayBuffer.

mod gating;
mod matrix;
mod stats;
mod utils;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// Re-export modules
pub use gating::{gate_cells, point_in_polygon, Point, Polygon};
pub use matrix::{parse_mtx, parse_pca_csv, MatrixData, PcaPoint};
pub use stats::{differential_expression, mann_whitney_u};

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
    selection_ptr: *mut u8, // Pointer to SharedArrayBuffer selection mask
    coords_ptr: *mut u8,    // Pointer to SharedArrayBuffer coordinates
    pca_points: Vec<PcaPoint>,
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
            selection_ptr: std::ptr::null_mut(),
            coords_ptr: std::ptr::null_mut(),
            pca_points: Vec::new(),
        }
    }

    /// Load matrix data from bytes
    pub fn load_matrix(&mut self, data: &[u8]) -> Result<(), JsValue> {
        self.matrix = Some(parse_mtx(data)?);
        self.cells = Vec::new();
        Ok(())
    }

    /// Initialize access to SharedArrayBuffer from JavaScript
    pub fn init_shared_buffer(&mut self, ptr: *mut u8, size: usize) -> Result<(), JsValue> {
        let data = unsafe { std::slice::from_raw_parts(ptr, size) };
        self.matrix = Some(parse_mtx(data)?);
        self.cells = Vec::new();
        Ok(())
    }

    /// Set pointer to coordinates buffer (SharedArrayBuffer)
    pub fn set_coords_buffer(&mut self, ptr: *mut u8) {
        self.coords_ptr = ptr;
    }

    /// Set pointer to selection buffer (SharedArrayBuffer)
    pub fn set_selection_buffer(&mut self, ptr: *mut u8) {
        self.selection_ptr = ptr;
    }

    /// Set cell coordinates (from UMAP/t-SNE calculation)
    pub fn set_coordinates(&mut self, coords: &[f32]) -> Result<(), JsValue> {
        if coords.len() % 2 != 0 {
            return Err(JsValue::from_str("Coordinates must be pairs (x, y)"));
        }

        let n_cells = coords.len() / 2;
        self.cells.clear();
        self.cells.reserve(n_cells);

        // Find min/max for normalization
        let mut min_x = f32::MAX;
        let mut max_x = f32::MIN;
        let mut min_y = f32::MAX;
        let mut max_y = f32::MIN;

        for chunk in coords.chunks_exact(2) {
            let x = chunk[0];
            let y = chunk[1];
            if x < min_x {
                min_x = x;
            }
            if x > max_x {
                max_x = x;
            }
            if y < min_y {
                min_y = y;
            }
            if y > max_y {
                max_y = y;
            }
        }

        let range_x = max_x - min_x;
        let range_y = max_y - min_y;

        for (i, chunk) in coords.chunks_exact(2).enumerate() {
            // Normalize to [-1, 1]
            let x = if range_x > 0.0 {
                ((chunk[0] - min_x) / range_x) * 2.0 - 1.0
            } else {
                0.0
            };
            let y = if range_y > 0.0 {
                ((chunk[1] - min_y) / range_y) * 2.0 - 1.0
            } else {
                0.0
            };

            self.cells.push(Cell {
                x,
                y,
                cluster: 0,
                selected: false,
            });

            // Also write to shared coords buffer if available
            if !self.coords_ptr.is_null() {
                unsafe {
                    *(self.coords_ptr.add(i * 8) as *mut f32) = x;
                    *(self.coords_ptr.add(i * 8 + 4) as *mut f32) = y;
                }
            }

            // Also write to shared selection buffer if available
            if !self.selection_ptr.is_null() {
                unsafe {
                    *(self.selection_ptr.add(i * 4) as *mut f32) = 0.0;
                }
            }
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
            let point = Point {
                x: cell.x,
                y: cell.y,
            };
            let inside = point_in_polygon(&point, &poly);
            self.selection_mask[i] = inside;
            cell.selected = inside;

            // Also write to shared selection buffer if available
            if !self.selection_ptr.is_null() {
                unsafe {
                    // Use f32 for compatibility with WebGL vertex attribute
                    *(self.selection_ptr.add(i * 4) as *mut f32) = if inside { 1.0 } else { 0.0 };
                }
            }

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

    /// Load PCA data from CSV/TSV bytes
    pub fn load_pca(&mut self, data: &[u8], delimiter: u8) -> Result<(), JsValue> {
        self.pca_points = parse_pca_csv(data, delimiter)?;

        // Normalize coordinates for WebGL [-1, 1]
        if self.pca_points.is_empty() {
            return Ok(());
        }

        let mut min_x = f32::MAX;
        let mut max_x = f32::MIN;
        let mut min_y = f32::MAX;
        let mut max_y = f32::MIN;

        for p in &self.pca_points {
            if p.x < min_x {
                min_x = p.x;
            }
            if p.x > max_x {
                max_x = p.x;
            }
            if p.y < min_y {
                min_y = p.y;
            }
            if p.y > max_y {
                max_y = p.y;
            }
        }

        let range_x = max_x - min_x;
        let range_y = max_y - min_y;

        // Update internal "cells" (which are used for gating) with PCA points
        self.cells = self
            .pca_points
            .iter()
            .map(|p| {
                let x = if range_x > 1e-6 {
                    ((p.x - min_x) / range_x) * 1.8 - 0.9
                } else {
                    0.0
                };
                let y = if range_y > 1e-6 {
                    ((p.y - min_y) / range_y) * 1.8 - 0.9
                } else {
                    0.0
                };
                Cell {
                    x,
                    y,
                    cluster: 0,
                    selected: false,
                }
            })
            .collect();

        self.selection_mask = vec![false; self.cells.len()];

        // If we have a shared buffer for coordinates, fill it
        if !self.coords_ptr.is_null() {
            for (i, cell) in self.cells.iter().enumerate() {
                unsafe {
                    *(self.coords_ptr.add(i * 8) as *mut f32) = cell.x;
                    *(self.coords_ptr.add(i * 8 + 4) as *mut f32) = cell.y;
                }
            }
        }

        Ok(())
    }

    /// Get PCA points as JSON
    pub fn get_pca_json(&self) -> String {
        serde_json::to_string(&self.pca_points).unwrap_or_default()
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}
