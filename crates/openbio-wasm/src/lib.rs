//! OpenBio WASM Engine
//! 
//! WebAssembly module for single-cell data analysis and visualization.
//! Handles matrix parsing, gating, and statistical tests.

use wasm_bindgen::prelude::*;

/// Initialize the WASM module (call once on load)
#[wasm_bindgen(start)]
pub fn init() {
    // Set up panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Parse a Matrix Market (.mtx) file
#[wasm_bindgen]
pub fn parse_mtx(data: &[u8]) -> Result<MatrixData, JsError> {
    // TODO: Implement Matrix Market parser
    // This will parse the sparse matrix format used by single-cell tools
    Ok(MatrixData::default())
}

/// Matrix data structure for JavaScript interop
#[wasm_bindgen]
#[derive(Default)]
pub struct MatrixData {
    rows: usize,
    cols: usize,
    nnz: usize, // number of non-zero entries
}

#[wasm_bindgen]
impl MatrixData {
    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.rows
    }

    #[wasm_bindgen(getter)]
    pub fn cols(&self) -> usize {
        self.cols
    }

    #[wasm_bindgen(getter)]
    pub fn nnz(&self) -> usize {
        self.nnz
    }
}

/// Check if a point is inside a polygon (for gating)
#[wasm_bindgen]
pub fn point_in_polygon(x: f64, y: f64, polygon_x: &[f64], polygon_y: &[f64]) -> bool {
    if polygon_x.len() != polygon_y.len() || polygon_x.len() < 3 {
        return false;
    }

    let n = polygon_x.len();
    let mut inside = false;
    let mut j = n - 1;

    for i in 0..n {
        let xi = polygon_x[i];
        let yi = polygon_y[i];
        let xj = polygon_x[j];
        let yj = polygon_y[j];

        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }

    inside
}

/// Perform a two-sample t-test
#[wasm_bindgen]
pub fn t_test(sample1: &[f64], sample2: &[f64]) -> TTestResult {
    let mean1 = mean(sample1);
    let mean2 = mean(sample2);
    let var1 = variance(sample1, mean1);
    let var2 = variance(sample2, mean2);
    let n1 = sample1.len() as f64;
    let n2 = sample2.len() as f64;

    let se = ((var1 / n1) + (var2 / n2)).sqrt();
    let t_stat = if se > 0.0 { (mean1 - mean2) / se } else { 0.0 };

    TTestResult {
        t_statistic: t_stat,
        mean_diff: mean1 - mean2,
    }
}

#[wasm_bindgen]
pub struct TTestResult {
    t_statistic: f64,
    mean_diff: f64,
}

#[wasm_bindgen]
impl TTestResult {
    #[wasm_bindgen(getter)]
    pub fn t_statistic(&self) -> f64 {
        self.t_statistic
    }

    #[wasm_bindgen(getter)]
    pub fn mean_diff(&self) -> f64 {
        self.mean_diff
    }
}

fn mean(data: &[f64]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    data.iter().sum::<f64>() / data.len() as f64
}

fn variance(data: &[f64], mean: f64) -> f64 {
    if data.len() < 2 {
        return 0.0;
    }
    let sum_sq: f64 = data.iter().map(|&x| (x - mean).powi(2)).sum();
    sum_sq / (data.len() - 1) as f64
}
