// Gating operations - point-in-polygon algorithm for lasso selection

use wasm_bindgen::prelude::*;

/// 2D Point
#[derive(Debug, Clone, Copy)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

/// Polygon (closed shape)
#[derive(Debug, Clone)]
pub struct Polygon {
    pub points: Vec<Point>,
}

impl Polygon {
    pub fn new(points: Vec<Point>) -> Self {
        Self { points }
    }
}

/// Ray-casting algorithm for point-in-polygon test
/// This is the algorithm used when a user draws a lasso around cells
pub fn point_in_polygon(point: &Point, polygon: &Polygon) -> bool {
    let mut inside = false;
    let n = polygon.points.len();

    if n < 3 {
        return false; // Not a valid polygon
    }

    let mut j = n - 1;
    for i in 0..n {
        let pi = &polygon.points[i];
        let pj = &polygon.points[j];

        // Check if point is on a horizontal ray from the test point
        if ((pi.y > point.y) != (pj.y > point.y))
            && (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x)
        {
            inside = !inside;
        }

        j = i;
    }

    inside
}

/// Gate cells - returns indices of cells inside polygon
pub fn gate_cells(cells: &[(f32, f32)], polygon: &Polygon) -> Vec<usize> {
    cells
        .iter()
        .enumerate()
        .filter_map(|(i, &(x, y))| {
            let point = Point { x, y };
            if point_in_polygon(&point, polygon) {
                Some(i)
            } else {
                None
            }
        })
        .collect()
}

/// WASM-exported gating function for JS
#[wasm_bindgen]
pub fn gate_points(
    points_x: &[f32],
    points_y: &[f32],
    polygon_x: &[f32],
    polygon_y: &[f32],
) -> Vec<usize> {
    if points_x.len() != points_y.len() {
        return Vec::new();
    }

    let poly_points: Vec<Point> = polygon_x
        .iter()
        .zip(polygon_y.iter())
        .map(|(&x, &y)| Point { x, y })
        .collect();

    let polygon = Polygon::new(poly_points);

    points_x
        .iter()
        .zip(points_y.iter())
        .enumerate()
        .filter_map(|(i, (&x, &y))| {
            let point = Point { x, y };
            if point_in_polygon(&point, &polygon) {
                Some(i)
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_point_in_square() {
        let polygon = Polygon::new(vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 10.0, y: 0.0 },
            Point { x: 10.0, y: 10.0 },
            Point { x: 0.0, y: 10.0 },
        ]);

        assert!(point_in_polygon(&Point { x: 5.0, y: 5.0 }, &polygon));
        assert!(!point_in_polygon(&Point { x: 15.0, y: 5.0 }, &polygon));
        assert!(!point_in_polygon(&Point { x: 5.0, y: 15.0 }, &polygon));
    }

    #[test]
    fn test_point_in_triangle() {
        let polygon = Polygon::new(vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 10.0, y: 0.0 },
            Point { x: 5.0, y: 10.0 },
        ]);

        assert!(point_in_polygon(&Point { x: 5.0, y: 5.0 }, &polygon));
        assert!(!point_in_polygon(&Point { x: 0.0, y: 10.0 }, &polygon));
    }
}
