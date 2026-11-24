use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StatBlock {
    pub flat: HashMap<String, f32>,      // Örn: "maximum Life" -> 15.0
    pub increased: HashMap<String, f32>, // Örn: "Lightning Damage" -> 25.0
    pub more: HashMap<String, f32>,      // Örn: "Attack Speed" -> 10.0 (Çarpımsal)
}

impl StatBlock {
    /// İki StatBlock'u birleştirir (Ağaçtaki tüm düğümleri toplarken kullanılır)
    pub fn add(&mut self, other: &StatBlock) {
        for (k, v) in &other.flat {
            *self.flat.entry(k.clone()).or_insert(0.0) += v;
        }
        for (k, v) in &other.increased {
            *self.increased.entry(k.clone()).or_insert(0.0) += v;
        }
        for (k, v) in &other.more {
            // More çarpanları kümülatif çarpılır: (1 + a/100) * (1 + b/100)
            let current = self.more.entry(k.clone()).or_insert(1.0);
            *current *= 1.0 + (v / 100.0);
        }
    }

    /// Belirli bir hedef (örn: "Lightning Damage" veya "maximum Life") için düğüm puanı üretir
    pub fn evaluate_score(&self, weights: &HashMap<String, f32>) -> f32 {
        let mut score = 0.0;

        for (stat_name, weight) in weights {
            if let Some(&val) = self.flat.get(stat_name) {
                score += val * weight;
            }
            if let Some(&val) = self.increased.get(stat_name) {
                score += val * weight;
            }
            if let Some(&val) = self.more.get(stat_name) {
                // More statlar her zaman çok daha değerlidir
                score += val * weight * 2.5;
            }
        }
        score
    }
}

/// Bir düğümün tüm stat satırlarını okuyup StatBlock'a çevirir
pub fn parse_node_stats(stat_lines: &[String]) -> StatBlock {
    static RE_INC: OnceLock<Regex> = OnceLock::new();
    static RE_MORE: OnceLock<Regex> = OnceLock::new();
    static RE_FLAT: OnceLock<Regex> = OnceLock::new();

    let re_inc = RE_INC.get_or_init(|| Regex::new(r"(?i)^([+-]?\d+(?:\.\d+)?)%\s+increased\s+(.+)$").unwrap());
    let re_more = RE_MORE.get_or_init(|| Regex::new(r"(?i)^([+-]?\d+(?:\.\d+)?)%\s+more\s+(.+)$").unwrap());
    let re_flat = RE_FLAT.get_or_init(|| Regex::new(r"(?i)^([+-]?\d+(?:\.\d+)?)\s+to\s+(.+)$").unwrap());

    let mut block = StatBlock::default();

    for line in stat_lines {
        let trimmed = line.trim();

        if let Some(caps) = re_inc.captures(trimmed) {
            if let Ok(val) = caps[1].parse::<f32>() {
                let key = caps[2].to_lowercase();
                *block.increased.entry(key).or_insert(0.0) += val;
            }
        } else if let Some(caps) = re_more.captures(trimmed) {
            if let Ok(val) = caps[1].parse::<f32>() {
                let key = caps[2].to_lowercase();
                *block.more.entry(key).or_insert(0.0) += val;
            }
        } else if let Some(caps) = re_flat.captures(trimmed) {
            if let Ok(val) = caps[1].parse::<f32>() {
                let key = caps[2].to_lowercase();
                *block.flat.entry(key).or_insert(0.0) += val;
            }
        }
    }

    block
}