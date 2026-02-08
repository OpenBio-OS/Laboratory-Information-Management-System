// Statistical tests for differential expression analysis

use wasm_bindgen::prelude::*;

/// Mann-Whitney U Test (Wilcoxon Rank Sum Test)
/// Non-parametric test for comparing two groups
/// Returns: (U statistic, p-value approximation)
pub fn mann_whitney_u(group1: &[f32], group2: &[f32]) -> (f64, f64) {
    let n1 = group1.len();
    let n2 = group2.len();

    if n1 == 0 || n2 == 0 {
        return (0.0, 1.0);
    }

    // Combine and rank all values
    let mut combined: Vec<(f32, usize)> = Vec::with_capacity(n1 + n2);
    
    for &val in group1 {
        combined.push((val, 0)); // Group 0
    }
    for &val in group2 {
        combined.push((val, 1)); // Group 1
    }

    // Sort by value
    combined.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    // Assign ranks (handle ties by averaging)
    let mut ranks = vec![0.0; combined.len()];
    let mut i = 0;
    while i < combined.len() {
        let mut j = i;
        let current_val = combined[i].0;

        // Find all equal values
        while j < combined.len() && combined[j].0 == current_val {
            j += 1;
        }

        // Average rank for ties
        let avg_rank = ((i + 1) + j) as f64 / 2.0;
        for k in i..j {
            ranks[k] = avg_rank;
        }

        i = j;
    }

    // Sum ranks for group1
    let mut r1 = 0.0;
    for (idx, &(_, group)) in combined.iter().enumerate() {
        if group == 0 {
            r1 += ranks[idx];
        }
    }

    // Calculate U statistic
    let u1 = r1 - (n1 as f64 * (n1 as f64 + 1.0)) / 2.0;
    let u2 = (n1 * n2) as f64 - u1;
    let u = u1.min(u2);

    // Calculate z-score for large samples (normal approximation)
    let mean_u = (n1 * n2) as f64 / 2.0;
    let std_u = ((n1 * n2 * (n1 + n2 + 1)) as f64 / 12.0).sqrt();
    let z = (u - mean_u) / std_u;

    // Approximate p-value using z-score
    let p_value = 2.0 * (1.0 - normal_cdf(z.abs()));

    (u, p_value)
}

/// Normal CDF approximation (for p-value calculation)
fn normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

/// Error function approximation
fn erf(x: f64) -> f64 {
    // Abramowitz and Stegun approximation
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;

    let sign = if x >= 0.0 { 1.0 } else { -1.0 };
    let x = x.abs();

    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();

    sign * y
}

/// Differential expression analysis between selected and unselected cells
/// Returns top marker genes with fold change and p-values
pub fn differential_expression(
    matrix: &crate::matrix::MatrixData,
    selected_cells: &[usize],
) -> Vec<GeneResult> {
    let n_genes = matrix.n_genes;
    let n_cells = matrix.n_cells;

    // Create unselected cells list
    let selected_set: std::collections::HashSet<usize> = 
        selected_cells.iter().copied().collect();
    let unselected: Vec<usize> = (0..n_cells)
        .filter(|i| !selected_set.contains(i))
        .collect();

    if selected_cells.is_empty() || unselected.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::with_capacity(n_genes);

    // Test each gene
    for gene_idx in 0..n_genes {
        let gene_expr = crate::matrix::get_gene_expression(matrix, gene_idx);

        let group1: Vec<f32> = selected_cells
            .iter()
            .map(|&i| gene_expr[i])
            .collect();

        let group2: Vec<f32> = unselected
            .iter()
            .map(|&i| gene_expr[i])
            .collect();

        // Calculate mean expression
        let mean1: f32 = group1.iter().sum::<f32>() / group1.len() as f32;
        let mean2: f32 = group2.iter().sum::<f32>() / group2.len() as f32;

        // Fold change (log2)
        let fold_change = if mean2 > 0.0 {
            (mean1 / mean2).log2()
        } else {
            0.0
        };

        // Run statistical test
        let (_u_stat, p_value) = mann_whitney_u(&group1, &group2);

        results.push(GeneResult {
            gene_idx,
            mean_selected: mean1,
            mean_unselected: mean2,
            fold_change,
            p_value,
        });
    }

    // Sort by p-value (ascending)
    results.sort_by(|a, b| a.p_value.partial_cmp(&b.p_value).unwrap());

    results
}

/// Result for a single gene in differential expression
#[derive(Debug, Clone)]
pub struct GeneResult {
    pub gene_idx: usize,
    pub mean_selected: f32,
    pub mean_unselected: f32,
    pub fold_change: f32,
    pub p_value: f64,
}

/// WASM-exported Mann-Whitney U test
#[wasm_bindgen]
pub fn test_mann_whitney(group1: &[f32], group2: &[f32]) -> Vec<f64> {
    let (u, p) = mann_whitney_u(group1, group2);
    vec![u, p]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mann_whitney_basic() {
        let group1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let group2 = vec![6.0, 7.0, 8.0, 9.0, 10.0];
        
        let (u, p) = mann_whitney_u(&group1, &group2);
        
        // Group2 values are all higher, so p should be small
        assert!(p < 0.05);
        assert!(u < 12.5); // U should be small
    }

    #[test]
    fn test_mann_whitney_same() {
        let group1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let group2 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        
        let (_u, p) = mann_whitney_u(&group1, &group2);
        
        // Groups are identical, p should be high
        assert!(p > 0.5);
    }
}
