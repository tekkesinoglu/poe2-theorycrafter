pub mod dds_atlas;
pub mod models;

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use models::{ClassStart, GameDatabase, GemData, PassiveNode, PassiveTree, SpriteRect};
use reqwest::Client;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::f32::consts::PI;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// `game_data.bin` içeriğinin biçimi değiştiğinde artırılır (3: BC1/BC3/BC7 + tüm DDS atlasları).
const DATA_FORMAT_VERSION: u32 = 3;

pub struct DataUpdater {
    data_dir: PathBuf,
    client: Client,
}

impl DataUpdater {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let client = Client::builder()
            .user_agent("PoE2-Theorycrafter/0.1")
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            data_dir: app_data_dir,
            client,
        }
    }

    pub async fn sync_game_data(&self, force: bool) -> Result<GameDatabase> {
        fs::create_dir_all(&self.data_dir)?;
        let bin_path = self.data_dir.join("game_data.bin");
        let (branch, upstream_sha) = self.fetch_repo_info().await?;
        let latest_hash = format!("{}#fmt{}", upstream_sha, DATA_FORMAT_VERSION);

        if !force && bin_path.exists() {
            match fs::read(&bin_path) {
                Ok(bytes) => match bincode::deserialize::<GameDatabase>(&bytes) {
                    Ok(db) if db.version_hash == latest_hash && !db.tree.classes.is_empty() => {
                        return Ok(db);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("Bozuk game_data.bin tespit edildi, yeniden indiriliyor: {e}");
                        let _ = fs::remove_file(&bin_path);
                    }
                },
                Err(e) => {
                    eprintln!("game_data.bin okunamadı: {e}");
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

        // Yeni biçim: zstd'li doku dizileri (`*.dds.zst`) -> PNG atlas
        let (dds_files, legacy_files): (Vec<String>, Vec<String>) = needed_files
            .into_iter()
            .partition(|f| f.ends_with(".dds.zst"));
        for atlas_name in dds_files {
            let layers: Vec<u32> = tree
                .nodes
                .values()
                .filter_map(|n| n.icon.as_ref())
                .filter(|ic| ic.filename == atlas_name)
                .map(|ic| ic.x)
                .collect();
            let built = self
                .fetch_dds_atlas(&raw_base, &latest_folder, &atlas_name, &layers)
                .await;
            let sheet_name = atlas_name.replace(".dds.zst", ".png");
            match built {
                Ok(atlas) => {
                    for node in tree.nodes.values_mut() {
                        let Some(ic) = node.icon.as_ref() else { continue };
                        if ic.filename != atlas_name {
                            continue;
                        }
                        node.icon = atlas.cells.get(&ic.x).map(|c| SpriteRect {
                            filename: sheet_name.clone(),
                            x: c.x,
                            y: c.y,
                            w: c.w,
                            h: c.h,
                        });
                    }
                    sprite_sheets.insert(
                        sheet_name,
                        format!("data:image/png;base64,{}", BASE64.encode(&atlas.png)),
                    );
                }
                Err(e) => {
                    eprintln!("Simge atlası atlandı ({atlas_name}): {e:#}");
                    for node in tree.nodes.values_mut() {
                        if node.icon.as_ref().is_some_and(|ic| ic.filename == atlas_name) {
                            node.icon = None;
                        }
                    }
                }
            }
        }

        for fname in legacy_files {
            if let Some(data_url) = self
                .fetch_sprite_as_png_data_url(&raw_base, &latest_folder, &fname)
                .await
            {
                sprite_sheets.insert(fname, data_url);
            }
        }
        tree.sprite_sheets = sprite_sheets;

        let gems_url = format!("{}/src/Data/Gems.lua", raw_base);
        let lua_code = self
            .client
            .get(&gems_url)
            .send()
            .await
            .context("Gems.lua isteği başarısız")?
            .error_for_status()
            .context("Gems.lua HTTP hatası")?
            .text()
            .await
            .context("Gems.lua metni okunamadı")?;

        let gems = self
            .parse_gems_lua(&lua_code)
            .context("Gems.lua ayrıştırılamadı")?;

        let db = GameDatabase {
            version_hash: latest_hash,
            tree,
            gems,
        };

        let encoded = bincode::serialize(&db)?;
        atomic_write(&bin_path, &encoded)?;

        Ok(db)
    }

    async fn fetch_repo_info(&self) -> Result<(String, String)> {
        let repo_url =
            "https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2";
        let repo_json: Value = self
            .client
            .get(repo_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let branch = repo_json["default_branch"]
            .as_str()
            .unwrap_or("dev")
            .to_string();

        let commit_url = format!("{}/commits/{}", repo_url, branch);
        let commit_json: Value = self
            .client
            .get(&commit_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let sha = commit_json["sha"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();

        Ok((branch, sha))
    }

    async fn detect_latest_tree_folder(&self, branch: &str) -> Result<String> {
        let dir_url = format!(
            "https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2/contents/src/TreeData?ref={}",
            branch
        );
        let entries: Value = self
            .client
            .get(&dir_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let mut folders: Vec<String> = entries
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter(|e| e["type"].as_str() == Some("dir"))
                    .filter_map(|e| e["name"].as_str().map(|s| s.to_string()))
                    .filter(|name| name.chars().next().is_some_and(|c| c.is_ascii_digit()))
                    .collect()
            })
            .unwrap_or_default();

        // Sayısal sıralama: "0_10" > "0_9" (alfabetik sıralama bunu yanlış yapardı)
        folders.sort_by_key(|name| {
            name.split('_')
                .map(|p| p.parse::<u32>().unwrap_or(0))
                .collect::<Vec<u32>>()
        });
        Ok(folders.pop().unwrap_or_else(|| "0_1".to_string()))
    }

    async fn fetch_dds_atlas(
        &self,
        raw_base: &str,
        folder: &str,
        atlas_name: &str,
        layers: &[u32],
    ) -> Result<dds_atlas::Atlas> {
        let clean = atlas_name.trim_start_matches('/');
        let url = format!("{}/src/TreeData/{}/{}", raw_base, folder, clean);
        let bytes = self
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()
            .with_context(|| format!("{} indirilemedi", url))?
            .bytes()
            .await?;
        if bytes.len() > 64 * 1024 * 1024 {
            anyhow::bail!("{} beklenenden büyük ({} bayt)", atlas_name, bytes.len());
        }
        dds_atlas::build_atlas(&bytes, layers, 64)
    }

    async fn fetch_sprite_as_png_data_url(
        &self,
        raw_base: &str,
        folder: &str,
        filename: &str,
    ) -> Option<String> {
        let clean = filename.trim_start_matches('/');
        let url = format!("{}/src/TreeData/{}/{}", raw_base, folder, clean);
        let bytes = self.client.get(&url).send().await.ok()?.bytes().await.ok()?;
        let img = image::load_from_memory(&bytes).ok()?;
        let mut png_buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png_buf), image::ImageFormat::Png)
            .ok()?;
        Some(format!("data:image/png;base64,{}", BASE64.encode(&png_buf)))
    }

    fn parse_passive_tree(&self, raw: &Value) -> Result<PassiveTree> {
        let raw_nodes = raw["nodes"]
            .as_object()
            .context("tree.json içinde 'nodes' bulunamadı")?;

        let mut node_group_coords: HashMap<u32, (f32, f32)> = HashMap::new();
        if let Some(groups_arr) = raw["groups"].as_array() {
            for g in groups_arr {
                if g.is_null() {
                    continue;
                }
                let gx = g["x"].as_f64().unwrap_or(0.0) as f32;
                let gy = g["y"].as_f64().unwrap_or(0.0) as f32;
                if let Some(g_nodes) = g["nodes"].as_array() {
                    for nid_val in g_nodes {
                        if let Some(nid) = nid_val
                            .as_u64()
                            .map(|v| v as u32)
                            .or_else(|| nid_val.as_str().and_then(|s| s.parse::<u32>().ok()))
                        {
                            node_group_coords.insert(nid, (gx, gy));
                        }
                    }
                }
            }
        }

        let orbit_radii: Vec<f32> = raw["constants"]["orbitRadii"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                    .collect()
            })
            .unwrap_or_else(|| {
                vec![
                    0.0, 82.0, 162.0, 335.0, 493.0, 662.0, 846.0, 251.0, 1080.0, 1322.0,
                ]
            });

        let skills_per_orbit: Vec<usize> = raw["constants"]["skillsPerOrbit"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|v| v.as_u64().unwrap_or(1) as usize)
                    .collect()
            })
            .unwrap_or_else(|| vec![1, 12, 24, 24, 72, 72, 72, 24, 72, 144]);

        let orbit_angles: Vec<Vec<f32>> = raw["constants"]["orbitAnglesByOrbit"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|sub| {
                        sub.as_array()
                            .map(|angles| {
                                angles
                                    .iter()
                                    .map(|a| a.as_f64().unwrap_or(0.0) as f32)
                                    .collect()
                            })
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut sprite_lookup: HashMap<String, SpriteRect> = HashMap::new();
        if let Some(sprites_obj) = raw["sprites"].as_object() {
            for (_sheet_type, zoom_levels) in sprites_obj {
                let target_zoom = zoom_levels
                    .get("0.3835")
                    .or_else(|| zoom_levels.as_object().and_then(|m| m.values().next()));

                if let Some(sheet_info) = target_zoom {
                    let filename = sheet_info["filename"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    if filename.is_empty() {
                        continue;
                    }
                    if let Some(coords) = sheet_info["coords"].as_object() {
                        for (icon_key, rect) in coords {
                            sprite_lookup.insert(
                                normalize_icon_key(icon_key),
                                SpriteRect {
                                    filename: filename.clone(),
                                    x: rect["x"].as_u64().unwrap_or(0) as u32,
                                    y: rect["y"].as_u64().unwrap_or(0) as u32,
                                    w: rect["w"].as_u64().unwrap_or(0) as u32,
                                    h: rect["h"].as_u64().unwrap_or(0) as u32,
                                },
                            );
                        }
                    }
                }
            }
        }

        // Tüm `*.dds.zst` atlaslarını (skills_, notables_, keystones_, passives_ vb.) kabul et
        let mut dds_lookup: HashMap<String, SpriteRect> = HashMap::new();
        if let Some(dds_obj) = raw["ddsCoords"].as_object() {
            for (atlas, entries) in dds_obj {
                if !atlas.ends_with(".dds.zst") {
                    continue;
                }
                let Some(map) = entries.as_object() else { continue };
                for (icon_key, layer) in map {
                    if let Some(l) = layer.as_u64().and_then(|v| u32::try_from(v).ok()) {
                        dds_lookup.insert(
                            normalize_icon_key(icon_key),
                            SpriteRect {
                                filename: atlas.clone(),
                                x: l,
                                y: 0,
                                w: 0,
                                h: 0,
                            },
                        );
                    }
                }
            }
        }

        let valid_poe2_classes: HashSet<String> = raw["classes"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| c["name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let mut classes: Vec<ClassStart> = Vec::new();
        let mut class_start_ids: HashSet<u32> = HashSet::new();
        let mut nodes: HashMap<u32, PassiveNode> = HashMap::new();
        let mut raw_connections: HashMap<u32, Vec<u32>> = HashMap::new();

        for (id_str, n) in raw_nodes {
            let Ok(id) = id_str.parse::<u32>() else {
                continue;
            };

            if n.get("ascendancyName").and_then(|v| v.as_str()).is_some()
                || n["isAscendancyStart"].as_bool().unwrap_or(false)
            {
                continue;
            }

            if n["isOnlyImage"].as_bool().unwrap_or(false) {
                continue;
            }

            let Some(&(gx, gy)) = node_group_coords.get(&id) else {
                continue;
            };

            if let Some(cs_arr) = n["classesStart"].as_array() {
                for entry in cs_arr {
                    if let Some(cname) = entry.as_str() {
                        if valid_poe2_classes.is_empty() || valid_poe2_classes.contains(cname) {
                            classes.push(ClassStart {
                                name: cname.to_string(),
                                start_node_id: id,
                            });
                            class_start_ids.insert(id);
                        }
                    }
                }
            }

            let orbit = n["orbit"].as_u64().unwrap_or(0) as usize;
            let orbit_idx = n["orbitIndex"].as_u64().unwrap_or(0) as usize;
            let radius = orbit_radii.get(orbit).copied().unwrap_or(0.0);
            let total_in_orbit = skills_per_orbit.get(orbit).copied().unwrap_or(1).max(1);

            let angle = if let Some(custom_angle) = orbit_angles
                .get(orbit)
                .and_then(|list| list.get(orbit_idx))
                .copied()
            {
                custom_angle - (PI / 2.0)
            } else {
                2.0 * PI * (orbit_idx as f32) / (total_in_orbit as f32) - (PI / 2.0)
            };
            let x = gx + radius * angle.cos();
            let y = gy + radius * angle.sin();

            let name = n["name"].as_str().unwrap_or("").to_string();
            let stats: Vec<String> = n["stats"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.as_str().map(|str_val| str_val.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let is_keystone = n["isKeystone"].as_bool().unwrap_or(false);
            let is_notable = n["isNotable"].as_bool().unwrap_or(false);
            let is_attribute_choice = n["isMultipleChoiceOption"].as_bool().unwrap_or(false)
                || n["isMultipleChoice"].as_bool().unwrap_or(false)
                || n["isAttribute"].as_bool().unwrap_or(false);

            let icon = n["icon"].as_str().and_then(|ic| {
                let norm = normalize_icon_key(ic);
                sprite_lookup
                    .get(&norm)
                    .cloned()
                    .or_else(|| dds_lookup.get(&norm).cloned())
            });

            let mut conns = Vec::new();
            if let Some(arr) = n["connections"].as_array() {
                for target in arr {
                    let tid = target
                        .as_u64()
                        .map(|v| v as u32)
                        .or_else(|| target.as_str().and_then(|s| s.parse::<u32>().ok()))
                        .or_else(|| target["id"].as_u64().map(|v| v as u32))
                        .or_else(|| {
                            target["id"]
                                .as_str()
                                .and_then(|s| s.parse::<u32>().ok())
                        });
                    if let Some(target_id) = tid {
                        if target_id != id {
                            conns.push(target_id);
                        }
                    }
                }
            }
            raw_connections.insert(id, conns);

            nodes.insert(
                id,
                PassiveNode {
                    id,
                    name,
                    stats,
                    is_keystone,
                    is_notable,
                    is_attribute_choice,
                    x,
                    y,
                    neighbors: Vec::new(),
                    icon,
                },
            );
        }

        let mut adjacency: HashMap<u32, HashSet<u32>> = HashMap::new();
        for (&from_id, targets) in &raw_connections {
            if !nodes.contains_key(&from_id) {
                continue;
            }
            for &to_id in targets {
                if !nodes.contains_key(&to_id) {
                    continue;
                }
                if class_start_ids.contains(&from_id) && class_start_ids.contains(&to_id) {
                    continue;
                }
                adjacency.entry(from_id).or_default().insert(to_id);
                adjacency.entry(to_id).or_default().insert(from_id);
            }
        }

        for (id, nbr_set) in adjacency {
            if let Some(node) = nodes.get_mut(&id) {
                let mut sorted_nbrs: Vec<u32> = nbr_set.into_iter().collect();
                sorted_nbrs.sort_unstable();
                node.neighbors = sorted_nbrs;
            }
        }

        classes.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(PassiveTree {
            nodes,
            classes,
            sprite_sheets: HashMap::new(),
        })
    }

    fn parse_gems_lua(&self, lua_code: &str) -> Result<HashMap<String, GemData>> {
        let mut gems = HashMap::new();
        let mut current_id: Option<String> = None;
        let mut current_name = String::new();
        let mut is_support = false;
        let mut tags: Vec<String> = Vec::new();
        let mut spirit_cost: u32 = 0;
        let mut str_req_weight: f32 = 0.0;
        let mut dex_req_weight: f32 = 0.0;
        let mut int_req_weight: f32 = 0.0;
        let mut in_tags = false;

        for raw_line in lua_code.lines() {
            let line = raw_line.trim();

            // Çok satırlı `tags = { ... }` bloğunun içindeki satırlar
            if in_tags {
                if line.starts_with('}') {
                    in_tags = false;
                } else if let Some((k, v)) = line.trim_end_matches(',').split_once('=') {
                    let tag_name = k.trim().trim_matches('"');
                    if v.trim() == "true" && !tag_name.is_empty() {
                        // Gerçek veride destek gemleri `support = true` etiketiyle işaretli
                        if tag_name == "support" {
                            is_support = true;
                        }
                        tags.push(tag_name.to_string());
                    }
                }
                continue;
            }

            if line.starts_with("[\"") && line.contains("\"] = {") {
                if let Some(id) = current_id.take() {
                    if !current_name.is_empty() {
                        gems.insert(
                            id.clone(),
                            GemData {
                                id,
                                name: current_name.clone(),
                                is_support,
                                tags: tags.clone(),
                                spirit_cost,
                                str_req_weight,
                                dex_req_weight,
                                int_req_weight,
                            },
                        );
                    }
                }
                if let Some(end_idx) = line[2..].find("\"]") {
                    current_id = Some(line[2..2 + end_idx].to_string());
                    current_name.clear();
                    is_support = false;
                    tags.clear();
                    spirit_cost = 0;
                    str_req_weight = 0.0;
                    dex_req_weight = 0.0;
                    int_req_weight = 0.0;
                    in_tags = false;
                }
            } else if current_id.is_some() {
                if let Some(rest) = line.strip_prefix("name = \"") {
                    if let Some(end_q) = rest.find('"') {
                        current_name = rest[..end_q].to_string();
                    }
                } else if line.starts_with("support = true") {
                    is_support = true;
                } else if let Some(rest) = line.strip_prefix("spiritCost = ") {
                    spirit_cost = rest.trim_end_matches(',').parse::<u32>().unwrap_or(0);
                } else if let Some(rest) = line.strip_prefix("reqStr = ") {
                    str_req_weight = rest.trim_end_matches(',').parse::<f32>().unwrap_or(0.0);
                } else if let Some(rest) = line.strip_prefix("reqDex = ") {
                    dex_req_weight = rest.trim_end_matches(',').parse::<f32>().unwrap_or(0.0);
                } else if let Some(rest) = line.strip_prefix("reqInt = ") {
                    int_req_weight = rest.trim_end_matches(',').parse::<f32>().unwrap_or(0.0);
                } else if line.starts_with("tags = {") && !line.contains('}') {
                    // Gerçek Gems.lua çok satırlı yazıyor: sonraki satırlar okunacak
                    in_tags = true;
                } else if line.starts_with("tags = {") {
                    let inner = line
                        .trim_start_matches("tags = {")
                        .trim_end_matches("},")
                        .trim_end_matches('}');
                    for part in inner.split(',') {
                        let kv: Vec<&str> = part.split('=').collect();
                        if kv.len() == 2 && kv[1].trim() == "true" {
                            let tag_name = kv[0].trim().trim_matches('"').to_string();
                            if !tag_name.is_empty() {
                                tags.push(tag_name);
                            }
                        }
                    }
                }
            }
        }

        if let Some(id) = current_id {
            if !current_name.is_empty() {
                gems.insert(
                    id.clone(),
                    GemData {
                        id,
                        name: current_name,
                        is_support,
                        tags,
                        spirit_cost,
                        str_req_weight,
                        dex_req_weight,
                        int_req_weight,
                    },
                );
            }
        }

        Ok(gems)
    }
}

fn normalize_icon_key(raw: &str) -> String {
    let unified = raw.trim().replace('\\', "/").to_lowercase();
    unified
        .strip_suffix(".dds")
        .or_else(|| unified.strip_suffix(".png"))
        .unwrap_or(&unified)
        .to_string()
}

fn atomic_write(target: &Path, data: &[u8]) -> Result<()> {
    // Eş zamanlı yazımlar aynı .tmp dosyasını ezmesin diye benzersiz geçici ad
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp_path = target.with_extension(format!("tmp.{}.{}", std::process::id(), n));
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(data)?;
    file.sync_all()?;
    fs::rename(&tmp_path, target)?;
    Ok(())
}
#[cfg(test)]
mod regression_tests {
    use super::*;

    /// Gerçek Gems.lua `tags = { ... }` bloğunu çok satırlı yazıyor. Bu ayrıştırılmazsa
    /// hiçbir gemin etiketi olmaz ve destek önerileri sessizce boş kalır.
    #[test]
    fn gems_lua_multiline_and_inline_tags_are_parsed() {
        let lua = r#"
return {
	["Spark"] = {
		name = "Spark",
		reqInt = 100,
		tags = {
			spell = true,
			projectile = true,
			lightning = true,
		},
	},
	["Fork"] = {
		name = "Fork",
		support = true,
		tags = { support = true, projectile = true, },
	},
}
"#;
        let up = DataUpdater::new(std::env::temp_dir().join("poe2tc-regress-gems"));
        let gems = up.parse_gems_lua(lua).unwrap();

        let spark = &gems["Spark"];
        assert!(!spark.is_support);
        for t in ["spell", "projectile", "lightning"] {
            assert!(spark.tags.iter().any(|x| x == t), "Spark etiketi eksik: {t}");
        }

        let fork = &gems["Fork"];
        assert!(fork.is_support);
        assert!(fork.tags.iter().any(|x| x == "projectile"));
    }

    #[test]
    fn gems_lua_garbage_does_not_panic() {
        let up = DataUpdater::new(std::env::temp_dir().join("poe2tc-regress-gems2"));
        for c in ["[\"", "[\"a\"] = {\nname = \"", "[\"a\"] = {\nname = \"x\"\ntags = {\n  = true,\n  b==true,\n"] {
            let _ = up.parse_gems_lua(c);
        }
    }

    /// Eş zamanlı iki yazıcı aynı `.tmp` dosyasını ezmemeli.
    #[test]
    fn atomic_write_is_safe_under_concurrency() {
        let dir = std::env::temp_dir().join(format!("poe2tc-regress-aw-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("game_data.bin");
        for _ in 0..10 {
            let handles: Vec<_> = (0u8..4)
                .map(|i| {
                    let t = target.clone();
                    std::thread::spawn(move || atomic_write(&t, &vec![b'A' + i; 2_000_000]).is_ok())
                })
                .collect();
            for h in handles {
                assert!(h.join().unwrap(), "atomic_write eş zamanlı çağrıda hata verdi");
            }
            let d = std::fs::read(&target).unwrap();
            assert_eq!(d.len(), 2_000_000);
            assert!(d.iter().all(|&b| b == d[0]), "dosya iki yazıcının karışımı");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
/// `tools/pob2-compare` için örnek build'leri JSON'a döker (POBDUMP_OUT / POBDUMP_TREE ayarlı değilse atlanır).
mod pobdump {
    use super::*;
    use crate::engine::stat_parser::{evaluate_build_snapshot, BuildEvaluationRequest};
    use crate::optimizer::tree_solver::optimize_tree;
    use std::collections::HashMap;

    #[test]
    fn dump_builds() {
        let Ok(out) = std::env::var("POBDUMP_OUT") else { return };
        let raw: Value = serde_json::from_str(&std::fs::read_to_string(std::env::var("POBDUMP_TREE").unwrap()).unwrap()).unwrap();
        let u = DataUpdater::new(std::env::temp_dir());
        let tree = u.parse_passive_tree(&raw).unwrap();
        let presets: Vec<(&str, Vec<(&str, f32)>)> = vec![
            ("crit-spell", vec![("Spell Damage", 40.), ("Critical", 35.), ("Cast Speed", 15.), ("Energy Shield", 10.)]),
            ("lightning", vec![("Lightning Damage", 55.), ("Critical", 25.), ("Energy Shield", 20.)]),
            ("attack-speed", vec![("Attack Speed", 40.), ("Physical Damage", 30.), ("Critical", 20.), ("Maximum Life", 10.)]),
            ("minion", vec![("Minion", 60.), ("Maximum Life", 25.), ("Spirit", 15.)]),
            ("tank", vec![("Maximum Life", 50.), ("Armour", 30.), ("Evasion", 20.)]),
            ("es", vec![("Energy Shield", 70.), ("Maximum Life", 10.), ("Spell Damage", 20.)]),
        ];
        let mut rows = Vec::new();
        for c in tree.classes.iter().take(6) {
            for (pid, w) in &presets {
                for &pts in &[30usize, 80] {
                    let weights: HashMap<String, f32> = w.iter().map(|(k, v)| (k.to_string(), *v)).collect();
                    let ids = optimize_tree(&tree, c.start_node_id, pts, &weights);
                    let stats: Vec<String> = ids.iter().filter_map(|i| tree.nodes.get(i)).flat_map(|n| n.stats.clone()).collect();
                    let _ = stats;
                    let req = BuildEvaluationRequest {
                        allocated_ids: ids.clone(), selected_skill_id: None, weapon_base_dps: 0.0,
                        base_gem_level: 20, bonus_skill_levels: 0, gear_spirit: 0,
                        active_spirit_buffs: vec![], active_ascendancy_nodes: vec![], supports: vec![],
                    };
                    let r = evaluate_build_snapshot(&req, &tree.nodes, &HashMap::new());
                    rows.push(serde_json::json!({
                        "class": c.name, "preset": pid, "points": pts, "nodes": ids,
                        "app": {"ehp": r.effective_hp, "life": r.total_life, "es": r.total_es, "armour": r.total_armour,
                                "evasion": r.total_evasion, "crit": r.effective_crit, "spirit": r.max_spirit}
                    }));
                }
            }
        }
        std::fs::write(out, serde_json::to_string(&rows).unwrap()).unwrap();
    }
}
