use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpriteRect {
    pub filename: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveNode {
    pub id: u32,
    pub name: String,
    #[serde(default)]
    pub stats: Vec<String>,
    #[serde(default)]
    pub is_keystone: bool,
    #[serde(default)]
    pub is_notable: bool,
    #[serde(default)]
    pub is_attribute_choice: bool,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub neighbors: Vec<u32>,
    #[serde(default)]
    pub icon: Option<SpriteRect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassStart {
    pub name: String,
    pub start_node_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveTree {
    pub nodes: HashMap<u32, PassiveNode>,
    pub classes: Vec<ClassStart>,
    #[serde(default)]
    pub sprite_sheets: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GemData {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_support: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub spirit_cost: u32,
    #[serde(default)]
    pub str_req_weight: f32,
    #[serde(default)]
    pub dex_req_weight: f32,
    #[serde(default)]
    pub int_req_weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDatabase {
    pub version_hash: String,
    pub tree: PassiveTree,
    pub gems: HashMap<String, GemData>,
}