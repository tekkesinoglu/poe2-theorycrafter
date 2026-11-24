use std::collections::{HashMap, HashSet, VecDeque};
use crate::updater::models::PassiveTree;

pub struct TreeOptimizer<'a> {
    tree: &'a PassiveTree,
}

impl<'a> TreeOptimizer<'a> {
    pub fn new(tree: &'a PassiveTree) -> Self {
        Self { tree }
    }

    pub fn solve_optimal_tree(
        &self,
        tree: &PassiveTree,
        start_node_id: u32,
        max_points: usize,
        weights: &HashMap<String, f32>,
    ) -> Vec<u32> {
        let active_tree = if tree.nodes.is_empty() { self.tree } else { tree };
        optimize_tree(active_tree, start_node_id, max_points, weights)
    }
}

pub fn optimize_tree(
    tree: &PassiveTree,
    start_node_id: u32,
    max_points: usize,
    weights: &HashMap<String, f32>,
) -> Vec<u32> {
    if !tree.nodes.contains_key(&start_node_id) || max_points == 0 {
        return vec![];
    }

    let mut allocated: HashSet<u32> = HashSet::new();
    let mut result: Vec<u32> = Vec::new();

    allocated.insert(start_node_id);
    result.push(start_node_id);

    let score_node = |node_id: u32| -> f32 {
        let Some(node) = tree.nodes.get(&node_id) else { return 0.0 };
        let mut score = 0.01;
        let mut matched_target = false;

        for stat in &node.stats {
            let lower = stat.to_lowercase();
            for (key, weight) in weights {
                let k = key.trim().to_lowercase();
                if !k.is_empty() && lower.contains(&k) {
                    matched_target = true;
                    let num: f32 = lower
                        .split_whitespace()
                        .find_map(|tok| {
                            tok.trim_matches(|c: char| !c.is_numeric() && c != '.')
                                .parse()
                                .ok()
                        })
                        .unwrap_or(5.0);
                    score += num * weight;
                }
            }
        }

        if matched_target {
            if node.is_keystone {
                score += 25.0;
            } else if node.is_notable {
                score += 12.0;
            }
        }

        score
    };

    while result.len() < max_points {
        let remaining = max_points - result.len();

        let mut queue: VecDeque<u32> = VecDeque::new();
        let mut parent: HashMap<u32, u32> = HashMap::new();
        let mut dist: HashMap<u32, usize> = HashMap::new();

        for &id in &allocated {
            queue.push_back(id);
            dist.insert(id, 0);
        }

        let mut best_target: Option<u32> = None;
        let mut best_ratio: f32 = -1.0;

        while let Some(curr) = queue.pop_front() {
            let d = dist[&curr];
            if d >= remaining || d > 12 {
                continue;
            }

            if let Some(node) = tree.nodes.get(&curr) {
                for &nbr in &node.neighbors {
                    if !dist.contains_key(&nbr) {
                        let nd = d + 1;
                        dist.insert(nbr, nd);
                        parent.insert(nbr, curr);
                        queue.push_back(nbr);

                        if !allocated.contains(&nbr) {
                            let ratio = score_node(nbr) / (nd as f32);
                            if ratio > best_ratio {
                                best_ratio = ratio;
                                best_target = Some(nbr);
                            }
                        }
                    }
                }
            }
        }

        let Some(target) = best_target else { break };

        let mut path = Vec::new();
        let mut curr = target;
        while !allocated.contains(&curr) {
            path.push(curr);
            if let Some(&p) = parent.get(&curr) {
                curr = p;
            } else {
                break;
            }
        }
        path.reverse();

        for step_id in path {
            if result.len() >= max_points {
                break;
            }
            if allocated.insert(step_id) {
                result.push(step_id);
            }
        }
    }

    result
}