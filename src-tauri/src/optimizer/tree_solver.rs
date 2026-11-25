#![allow(dead_code)]

use crate::updater::models::{PassiveNode, PassiveTree};
use std::collections::{HashMap, HashSet, VecDeque};

const MAX_EDGE_DISTANCE: f32 = 900.0;

fn is_valid_edge(a: &PassiveNode, b: &PassiveNode) -> bool {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt() <= MAX_EDGE_DISTANCE
}

pub struct TreeOptimizer<'a> {
    tree: &'a PassiveTree,
}

impl<'a> TreeOptimizer<'a> {
    pub fn new(tree: &'a PassiveTree) -> Self {
        Self { tree }
    }

    pub fn solve_optimal_tree(
        &self,
        start_node_id: u32,
        max_points: usize,
        weights: &HashMap<String, f32>,
    ) -> Vec<u32> {
        optimize_tree(self.tree, start_node_id, max_points, weights)
    }
}

pub fn optimize_tree(
    tree: &PassiveTree,
    start_node_id: u32,
    max_points: usize,
    weights: &HashMap<String, f32>,
) -> Vec<u32> {
    if max_points == 0 || !tree.nodes.contains_key(&start_node_id) {
        return Vec::new();
    }

    let mut allocated: Vec<u32> = vec![start_node_id];
    let mut allocated_set: HashSet<u32> = HashSet::new();
    allocated_set.insert(start_node_id);

    // Düğüm bazlı puanları önceden hesapla
    let mut node_scores: HashMap<u32, f32> = HashMap::new();
    for (&id, node) in &tree.nodes {
        node_scores.insert(id, score_node(node, weights));
    }

    while allocated.len() < max_points {
        let remaining_budget = max_points - allocated.len();

        // Mevcut seçili ağaçtan BFS ile erişilebilir aday düğümlere en kısa yolları bul
        let mut queue: VecDeque<u32> = VecDeque::new();
        let mut dist: HashMap<u32, usize> = HashMap::new();
        let mut parent: HashMap<u32, u32> = HashMap::new();

        for &id in &allocated {
            queue.push_back(id);
            dist.insert(id, 0);
        }

        let mut best_target: Option<u32> = None;
        let mut best_ratio: f32 = 0.0;

        while let Some(curr) = queue.pop_front() {
            let d = dist[&curr];
            if d >= remaining_budget || d >= 14 {
                continue;
            }

            let Some(curr_node) = tree.nodes.get(&curr) else {
                continue;
            };

            for &nbr in &curr_node.neighbors {
                if dist.contains_key(&nbr) {
                    continue;
                }
                let Some(nbr_node) = tree.nodes.get(&nbr) else {
                    continue;
                };
                if !is_valid_edge(curr_node, nbr_node) {
                    continue;
                }

                let next_d = d + 1;
                dist.insert(nbr, next_d);
                parent.insert(nbr, curr);
                queue.push_back(nbr);

                if !allocated_set.contains(&nbr) {
                    // Yol üzerindeki tüm yeni düğümlerin toplam puanını adım sayısına böl
                    let mut path_score = 0.0;
                    let mut step = nbr;
                    while !allocated_set.contains(&step) {
                        path_score += node_scores.get(&step).copied().unwrap_or(0.0);
                        if let Some(&p) = parent.get(&step) {
                            step = p;
                        } else {
                            break;
                        }
                    }

                    let ratio = path_score / (next_d as f32);
                    if ratio > best_ratio {
                        best_ratio = ratio;
                        best_target = Some(nbr);
                    }
                }
            }
        }

        // Eğer puanlı hedef kalmadıysa sınırdaki ilk geçerli komşuyu ekle
        let Some(target) = best_target else {
            let mut fallback: Option<u32> = None;
            'outer: for &id in &allocated {
                if let Some(n) = tree.nodes.get(&id) {
                    for &nbr in &n.neighbors {
                        if !allocated_set.contains(&nbr) {
                            if let Some(nbr_node) = tree.nodes.get(&nbr) {
                                if is_valid_edge(n, nbr_node) {
                                    fallback = Some(nbr);
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }
            match fallback {
                Some(f) => {
                    allocated.push(f);
                    allocated_set.insert(f);
                    continue;
                }
                None => break,
            }
        };

        // Hedefe giden yolu kökten hedefe sırayla ekle
        let mut path_to_add: Vec<u32> = Vec::new();
        let mut curr = target;
        while !allocated_set.contains(&curr) {
            path_to_add.push(curr);
            if let Some(&p) = parent.get(&curr) {
                curr = p;
            } else {
                break;
            }
        }
        path_to_add.reverse();

        for node_id in path_to_add {
            if allocated.len() >= max_points {
                break;
            }
            if allocated_set.insert(node_id) {
                allocated.push(node_id);
            }
        }
    }

    allocated
}

fn score_node(node: &PassiveNode, weights: &HashMap<String, f32>) -> f32 {
    let mut total = 0.0;

    for stat in &node.stats {
        let lower = stat.to_lowercase();
        let is_negative = lower.contains("reduced") || lower.contains("less");
        let magnitude = extract_first_number(&lower).unwrap_or(10.0);

        for (key, &w) in weights {
            if w <= 0.0 {
                continue;
            }
            let k = key.to_lowercase();
            let matched = if k == "critical" {
                lower.contains("critical")
            } else if k == "minion" {
                lower.contains("minion")
            } else {
                lower.contains(&k)
            };

            if matched {
                let sign = if is_negative { -1.0 } else { 1.0 };
                total += sign * magnitude * (w / 100.0);
            }
        }
    }

    if node.is_notable && total > 0.0 {
        total *= 1.35;
    }
    if node.is_keystone && total > 0.0 {
        total *= 1.5;
    }

    total
}

fn extract_first_number(s: &str) -> Option<f32> {
    let mut buf = String::new();
    let mut started = false;

    for ch in s.chars() {
        if ch.is_ascii_digit() || (ch == '.' && started) {
            buf.push(ch);
            started = true;
        } else if started {
            break;
        }
    }

    if buf.is_empty() {
        None
    } else {
        buf.parse::<f32>().ok()
    }
}