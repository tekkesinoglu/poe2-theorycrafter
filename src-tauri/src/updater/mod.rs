pub mod models;

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::ImageFormat;
use mlua::Lua;
use models::{ClassStart, GameDatabase, GemData, PassiveNode, PassiveTree, SpriteRect};
use reqwest::Client;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

const REPO_META_URL: &str = "https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2";

pub struct DataUpdater {
    client: Client,
    data_dir: PathBuf,
}

impl DataUpdater {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let client = Client::builder()
            .user_agent("PoE2-Theorycrafter-Builder")
            .build()
            .expect("HTTP client oluşturulamadı");

        Self {
            client,
            data_dir: app_data_dir,
        }
    }

    async fn fetch_repo_info(&self) -> Result<(String, String)> {
        let meta: Value = self
            .client
            .get(REPO_META_URL)
            .send()
            .await?
            .error_for_status()
            .context("GitHub depo bilgisi alınamadı")?
            .json()
            .await?;

        let branch = meta["default_branch"]
            .as_str()
            .unwrap_or("dev")
            .to_string();

        let commit_url = format!("{}/commits/{}", REPO_META_URL, branch);
        let commit_resp: Value = self
            .client
            .get(&commit_url)
            .send()
            .await?
            .error_for_status()
            .context("Son commit bilgisi alınamadı")?
            .json()
            .await?;

        let sha = commit_resp["sha"]
            .as_str()
            .context("Commit SHA bulunamadı")?
            .to_string();

        Ok((branch, sha))
    }

    async fn detect_latest_tree_folder(&self, branch: &str) -> Result<String> {
        let url = format!("{}/contents/src/TreeData?ref={}", REPO_META_URL, branch);
        let items: Vec<Value> = self
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()
            .context("TreeData klasör listesi alınamadı")?
            .json()
            .await?;

        let mut folders: Vec<String> = items
            .into_iter()
            .filter(|item| item["type"].as_str() == Some("dir"))
            .filter_map(|item| item["name"].as_str().map(String::from))
            .filter(|name| name.chars().next().map_or(false, |c| c.is_ascii_digit()))
            .collect();

        folders.sort();
        folders
            .pop()
            .context("TreeData altında geçerli bir sürüm klasörü bulunamadı")
    }

    async fn fetch_sprite_as_png_data_url(
        &self,
        raw_base: &str,
        folder: &str,
        filename: &str,
    ) -> Option<String> {
        let clean_name = filename
            .split('?')
            .next()
            .unwrap_or(filename)
            .trim_start_matches('/');

        let candidates = [
            format!("{}/src/TreeData/{}/{}", raw_base, folder, clean_name),
            format!("{}/src/{}", raw_base, clean_name),
            format!("{}/{}", raw_base, clean_name),
        ];

        for url in &candidates {
            if let Ok(resp) = self.client.get(url).send().await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        if clean_name.to_lowercase().ends_with(".png") {
                            return Some(format!("data:image/png;base64,{}", BASE64.encode(&bytes)));
                        }
                        if let Ok(img) = image::load_from_memory_with_format(&bytes, ImageFormat::Dds)
                            .or_else(|_| image::load_from_memory(&bytes))
                        {
                            let mut png_buf = Cursor::new(Vec::new());
                            if img.write_to(&mut png_buf, ImageFormat::Png).is_ok() {
                                return Some(format!(
                                    "data:image/png;base64,{}",
                                    BASE64.encode(png_buf.into_inner())
                                ));
                            }
                        }
                    }
                }
            }
        }
        None
    }

    pub async fn sync_game_data(&self, force: bool) -> Result<GameDatabase> {
        fs::create_dir_all(&self.data_dir)?;
        let bin_path = self.data_dir.join("game_data.bin");
        let (branch, latest_hash) = self.fetch_repo_info().await?;

        if !force && bin_path.exists() {
            if let Ok(bytes) = fs::read(&bin_path) {
                if let Ok(db) = bincode::deserialize::<GameDatabase>(&bytes) {
                    if db.version_hash == latest_hash && !db.tree.classes.is_empty() {
                        return Ok(db);
                    }
                }
            }
        }

        let raw_base = format!(
            "https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/{}",
            branch
        );

        let latest_folder = self.detect_latest_tree_folder(&branch).await?;
        let tree_url = format!("{}/src/TreeData/{}/tree.json", raw_base, latest_folder);
        let tree_raw: Value = self
            .client
            .get(&tree_url)
            .send()
            .await?
            .error_for_status()
            .with_context(|| format!("tree.json indirilemedi: {}", tree_url))?
            .json()
            .await
            .context("tree.json JSON formatında ayrıştırılamadı")?;

        let mut tree = self.parse_passive_tree(&tree_raw)?;

        let needed_files: HashSet<String> = tree
            .nodes
            .values()
            .filter_map(|n| n.icon.as_ref().map(|ic| ic.filename.clone()))
            .collect();

        let mut sprite_sheets = HashMap::new();
        for fname in needed_files {
            if let Some(data_url) = self
                .fetch_sprite_as_png_data_url(&raw_base, &latest_folder, &fname)
                .await
            {
                sprite_sheets.insert(fname, data_url);
            }
        }
        tree.sprite_sheets = sprite_sheets;

        let gems_url = format!("{}/src/Data/Gems.lua", raw_base);
        let gems = match self.client.get(&gems_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(lua_code) = resp.text().await {
                    self.parse_gems_lua(&lua_code).unwrap_or_default()
                } else {
                    HashMap::new()
                }
            }
            _ => HashMap::new(),
        };

        let db = GameDatabase {
            version_hash: latest_hash,
            tree,
            gems,
        };

        let encoded = bincode::serialize(&db)?;
        fs::write(&bin_path, encoded)?;

        Ok(db)
    }

    fn build_icon_lookup(raw: &Value) -> HashMap<String, SpriteRect> {
        let mut lookup = HashMap::new();
        let Some(sprites_obj) = raw["sprites"].as_object() else {
            return lookup;
        };

        let preferred_groups = [
            "normalActive",
            "notableActive",
            "keystoneActive",
            "normalInactive",
            "notableInactive",
            "keystoneInactive",
            "mastery",
        ];

        let mut ordered_keys: Vec<&String> = sprites_obj.keys().collect();
        ordered_keys.sort_by_key(|k| {
            preferred_groups
                .iter()
                .position(|&p| p == k.as_str())
                .unwrap_or(99)
        });

        for group_key in ordered_keys {
            let Some(group_val) = sprites_obj.get(group_key) else { continue };
            let zoom_levels = ["0.3835", "0.2972", "0.2109", "0.1246", "1"];
            let sheet_entry = zoom_levels
                .iter()
                .find_map(|z| group_val.get(*z))
                .or_else(|| group_val.as_object().and_then(|o| o.values().next()));

            let Some(sheet) = sheet_entry else { continue };
            let Some(filename) = sheet["filename"].as_str() else { continue };
            let Some(coords) = sheet["coords"].as_object() else { continue };

            for (icon_path, rect_val) in coords {
                if lookup.contains_key(icon_path) {
                    continue;
                }
                let x = rect_val["x"].as_u64().unwrap_or(0) as u32;
                let y = rect_val["y"].as_u64().unwrap_or(0) as u32;
                let w = rect_val["w"].as_u64().unwrap_or(0) as u32;
                let h = rect_val["h"].as_u64().unwrap_or(0) as u32;

                if w > 0 && h > 0 {
                    lookup.insert(
                        icon_path.clone(),
                        SpriteRect {
                            filename: filename.to_string(),
                            x,
                            y,
                            w,
                            h,
                        },
                    );
                }
            }
        }

        lookup
    }

    fn parse_passive_tree(&self, raw: &Value) -> Result<PassiveTree> {
        let mut nodes = HashMap::new();
        let mut adjacency: HashMap<u32, HashSet<u32>> = HashMap::new();
        let icon_lookup = Self::build_icon_lookup(raw);

        let orbit_radii: Vec<f32> = raw["constants"]["orbitRadii"]
            .as_array()
            .map(|arr| arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect())
            .unwrap_or_else(|| vec![0.0, 82.0, 162.0, 335.0, 493.0, 662.0, 846.0]);

        let skills_per_orbit: Vec<usize> = raw["constants"]["skillsPerOrbit"]
            .as_array()
            .map(|arr| arr.iter().map(|v| v.as_u64().unwrap_or(1) as usize).collect())
            .unwrap_or_else(|| vec![1, 6, 16, 16, 40, 72, 72]);

        let orbit_angles: Vec<Vec<f32>> = raw["constants"]["orbitAnglesByOrbit"]
            .as_array()
            .map(|orbits| {
                orbits
                    .iter()
                    .map(|angles| {
                        angles
                            .as_array()
                            .map(|a| a.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect())
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();

        let extract_id = |val: &Value| -> Option<u32> {
            val.as_u64()
                .map(|n| n as u32)
                .or_else(|| val.as_str().and_then(|s| s.parse().ok()))
                .or_else(|| {
                    val.get("id").and_then(|v| {
                        v.as_u64()
                            .map(|n| n as u32)
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    })
                })
        };

        if let Some(raw_nodes) = raw["nodes"].as_object() {
            for (id_str, node_val) in raw_nodes {
                let Ok(id) = id_str.parse::<u32>() else { continue };

                for field in ["out", "in", "connections"] {
                    if let Some(arr) = node_val[field].as_array() {
                        for item in arr {
                            if let Some(tid) = extract_id(item) {
                                if tid != id {
                                    adjacency.entry(id).or_default().insert(tid);
                                    adjacency.entry(tid).or_default().insert(id);
                                }
                            }
                        }
                    } else if let Some(obj) = node_val[field].as_object() {
                        for (k, item) in obj {
                            if let Some(tid) = k.parse::<u32>().ok().or_else(|| extract_id(item)) {
                                if tid != id {
                                    adjacency.entry(id).or_default().insert(tid);
                                    adjacency.entry(tid).or_default().insert(id);
                                }
                            }
                        }
                    }
                }

                if node_val["isMastery"].as_bool().unwrap_or(false)
                    || node_val["isProxy"].as_bool().unwrap_or(false)
                {
                    continue;
                }

                let grp_key = node_val["group"]
                    .as_u64()
                    .map(|n| n.to_string())
                    .or_else(|| node_val["group"].as_str().map(String::from));

                let mut x = node_val["x"].as_f64().unwrap_or(0.0) as f32;
                let mut y = node_val["y"].as_f64().unwrap_or(0.0) as f32;

                if let Some(ref key) = grp_key {
                    let grp_opt = raw["groups"].get(key).or_else(|| {
                        key.parse::<usize>()
                            .ok()
                            .and_then(|idx| raw["groups"].get(idx))
                    });

                    if let Some(grp) = grp_opt {
                        let gx = grp["x"].as_f64().unwrap_or(0.0) as f32;
                        let gy = grp["y"].as_f64().unwrap_or(0.0) as f32;
                        let orbit = node_val["orbit"]
                            .as_u64()
                            .or_else(|| node_val["orbit"].as_str().and_then(|s| s.parse().ok()))
                            .unwrap_or(0) as usize;
                        let orbit_idx = node_val["orbitIndex"]
                            .as_u64()
                            .or_else(|| node_val["orbitIndex"].as_str().and_then(|s| s.parse().ok()))
                            .unwrap_or(0) as usize;

                        let radius = orbit_radii.get(orbit).copied().unwrap_or(0.0);
                        let angle = orbit_angles
                            .get(orbit)
                            .and_then(|angles| angles.get(orbit_idx))
                            .copied()
                            .unwrap_or_else(|| {
                                let count = skills_per_orbit.get(orbit).copied().unwrap_or(1).max(1);
                                2.0 * std::f32::consts::PI * (orbit_idx as f32) / (count as f32)
                            });

                        x = gx + radius * angle.sin();
                        y = gy - radius * angle.cos();
                    }
                }

                if x.abs() < 1.0 && y.abs() < 1.0 {
                    continue;
                }

                let name = node_val["name"].as_str().unwrap_or("").to_string();
                let stats = node_val["stats"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default();

                let icon = node_val["icon"]
                    .as_str()
                    .and_then(|path| icon_lookup.get(path).cloned());

                nodes.insert(
                    id,
                    PassiveNode {
                        id,
                        name,
                        stats,
                        is_keystone: node_val["isKeystone"].as_bool().unwrap_or(false),
                        is_notable: node_val["isNotable"].as_bool().unwrap_or(false),
                        is_attribute_choice: node_val["isAttribute"].as_bool().unwrap_or(false),
                        x,
                        y,
                        neighbors: Vec::new(),
                        icon,
                    },
                );
            }

            let valid_ids: HashSet<u32> = nodes.keys().copied().collect();
            for (id, node) in nodes.iter_mut() {
                if let Some(nbrs) = adjacency.get(id) {
                    node.neighbors = nbrs
                        .iter()
                        .copied()
                        .filter(|target_id| valid_ids.contains(target_id))
                        .collect();
                }
            }
        }

        let mut classes = Vec::new();
        if let Some(raw_nodes) = raw["nodes"].as_object() {
            for (id_str, node_val) in raw_nodes {
                let Ok(id) = id_str.parse::<u32>() else { continue };
                let class_idx_opt = node_val["classStartIndex"].as_u64().or_else(|| {
                    node_val["classes"]
                        .as_array()
                        .and_then(|arr| arr.first())
                        .and_then(|v| v.as_u64())
                });

                if let Some(class_idx) = class_idx_opt {
                    let name = raw["classes"]
                        .get(class_idx as usize)
                        .and_then(|c| c["name"].as_str())
                        .unwrap_or("Class")
                        .to_string();

                    let start_id = if nodes.get(&id).map_or(false, |n| !n.neighbors.is_empty()) {
                        Some(id)
                    } else {
                        adjacency.get(&id).and_then(|nbrs| {
                            nbrs.iter()
                                .copied()
                                .find(|nid| nodes.get(nid).map_or(false, |n| !n.neighbors.is_empty()))
                        })
                    };

                    if let Some(sid) = start_id {
                        classes.push(ClassStart {
                            name,
                            start_node_id: sid,
                        });
                    }
                }
            }
        }

        if classes.is_empty() {
            let class_angles: [(&str, f32); 6] = [
                ("Warrior", std::f32::consts::PI * 0.5),
                ("Mercenary", std::f32::consts::PI * 0.16),
                ("Ranger", -std::f32::consts::PI * 0.16),
                ("Monk", -std::f32::consts::PI * 0.5),
                ("Sorceress", -std::f32::consts::PI * 0.83),
                ("Witch", std::f32::consts::PI * 0.83),
            ];

            for (cname, target_angle) in class_angles {
                let best = nodes
                    .values()
                    .filter(|n| !n.neighbors.is_empty())
                    .filter(|n| {
                        let r = (n.x * n.x + n.y * n.y).sqrt();
                        r > 300.0 && r < 2800.0
                    })
                    .min_by(|a, b| {
                        let ang_a = a.x.atan2(-a.y);
                        let ang_b = b.x.atan2(-b.y);
                        let diff_a = (ang_a - target_angle).sin().hypot((ang_a - target_angle).cos() - 1.0);
                        let diff_b = (ang_b - target_angle).sin().hypot((ang_b - target_angle).cos() - 1.0);
                        diff_a.partial_cmp(&diff_b).unwrap_or(std::cmp::Ordering::Equal)
                    });

                if let Some(node) = best {
                    classes.push(ClassStart {
                        name: cname.to_string(),
                        start_node_id: node.id,
                    });
                }
            }
        }

        classes.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(PassiveTree {
            nodes,
            classes,
            sprite_sheets: HashMap::new(),
        })
    }

    fn parse_gems_lua(&self, lua_source: &str) -> Result<HashMap<String, GemData>> {
        let lua = Lua::new();
        let gems_table: mlua::Table = lua.load(lua_source).eval()?;
        let mut gems = HashMap::new();

        for pair in gems_table.pairs::<String, mlua::Table>() {
            let (id, data) = pair?;
            let name: String = data.get("name").unwrap_or_default();
            if name.is_empty() {
                continue;
            }

            let is_support: bool = data.get("support").unwrap_or(false);
            let spirit_cost: u32 = data.get("spiritCost").unwrap_or(0);

            let mut tags = Vec::new();
            if let Ok(tags_table) = data.get::<&str, mlua::Table>("tags") {
                for tag_pair in tags_table.pairs::<String, bool>() {
                    if let Ok((tag_name, is_active)) = tag_pair {
                        if is_active {
                            tags.push(tag_name);
                        }
                    }
                }
            }

            gems.insert(
                id.clone(),
                GemData {
                    id,
                    name,
                    is_support,
                    tags,
                    spirit_cost,
                    str_req_weight: data.get("reqStr").unwrap_or(0.0),
                    dex_req_weight: data.get("reqDex").unwrap_or(0.0),
                    int_req_weight: data.get("reqInt").unwrap_or(0.0),
                },
            );
        }

        Ok(gems)
    }
}