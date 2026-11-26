//! Path of Building 2 (PoB2) paylaşım kodlarını çözer.
//!
//! Biçim: `zlib(deflate(XML))` -> URL-güvenli base64 (`-`/`_`). XML kökü `<PathOfBuilding2>`;
//! pasif ağaç `<Tree activeSpec="N"><Spec ... nodes="1,2,3"/></Tree>` içinde tutulur.

use miniz_oxide::inflate::decompress_to_vec_zlib_with_limit;
use serde::Serialize;

/// Açılmış XML için üst sınır (zip-bomb koruması)
const MAX_XML_BYTES: usize = 8 * 1024 * 1024;
/// Kod uzunluğu için üst sınır
const MAX_CODE_CHARS: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct Pob2Import {
    pub class_name: String,
    pub ascendancy_name: String,
    pub level: u32,
    pub spec_title: String,
    pub node_ids: Vec<u32>,
}

fn decode_b64(code: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let cleaned: String = code
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    let cleaned = cleaned.trim_end_matches('=');
    base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(cleaned)
        .map_err(|_| "Geçersiz kod (base64 çözülemedi)".to_string())
}

fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Bir etiketin içeriğinden (`Name a="b" c='d'`) ad ve öznitelikleri çıkarır.
fn parse_tag(inner: &str) -> (String, Vec<(String, String)>) {
    let inner = inner.trim().trim_end_matches('/').trim();
    let name_end = inner
        .find(|c: char| c.is_whitespace())
        .unwrap_or(inner.len());
    let name = inner[..name_end].to_string();
    let mut attrs = Vec::new();
    let b: Vec<char> = inner[name_end..].chars().collect();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && b[i].is_whitespace() {
            i += 1;
        }
        let ks = i;
        while i < b.len() && b[i] != '=' && !b[i].is_whitespace() {
            i += 1;
        }
        let key: String = b[ks..i].iter().collect();
        while i < b.len() && b[i].is_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] != '=' {
            continue;
        }
        i += 1;
        while i < b.len() && b[i].is_whitespace() {
            i += 1;
        }
        if i >= b.len() || (b[i] != '"' && b[i] != '\'') {
            continue;
        }
        let q = b[i];
        i += 1;
        let vs = i;
        while i < b.len() && b[i] != q {
            i += 1;
        }
        let val: String = b[vs..i].iter().collect();
        i += 1;
        if !key.is_empty() {
            attrs.push((key, unescape(&val)));
        }
    }
    (name, attrs)
}

fn attr<'a>(attrs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    attrs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// Etiketleri sırayla (ad, öznitelikler) olarak döndürür; yorum/işlem yönergelerini atlar.
fn scan_tags(xml: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(p) = rest.find('<') {
        rest = &rest[p + 1..];
        if rest.starts_with("!--") {
            match rest.find("-->") {
                Some(e) => rest = &rest[e + 3..],
                None => break,
            }
            continue;
        }
        let Some(end) = rest.find('>') else { break };
        let inner = &rest[..end];
        rest = &rest[end + 1..];
        if inner.starts_with('/') || inner.starts_with('?') || inner.starts_with('!') {
            continue;
        }
        out.push(parse_tag(inner));
    }
    out
}

fn parse_node_list(s: &str) -> Vec<u32> {
    let mut seen = std::collections::HashSet::new();
    s.split(',')
        .filter_map(|t| t.trim().parse::<u32>().ok())
        .filter(|id| seen.insert(*id))
        .collect()
}

pub fn parse_pob2_xml(xml: &str) -> Result<Pob2Import, String> {
    let tags = scan_tags(xml);
    if !tags.iter().any(|(n, _)| n == "PathOfBuilding2" || n == "PathOfBuilding") {
        return Err("Bu bir Path of Building kodu gibi görünmüyor".into());
    }
    let mut res = Pob2Import::default();
    if let Some((_, a)) = tags.iter().find(|(n, _)| n == "Build") {
        res.class_name = attr(a, "className").unwrap_or("").to_string();
        res.ascendancy_name = attr(a, "ascendClassName").unwrap_or("").to_string();
        res.level = attr(a, "level").and_then(|v| v.parse().ok()).unwrap_or(0);
    }
    let active: usize = tags
        .iter()
        .find(|(n, _)| n == "Tree")
        .and_then(|(_, a)| attr(a, "activeSpec"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    let specs: Vec<&Vec<(String, String)>> = tags
        .iter()
        .filter(|(n, _)| n == "Spec")
        .map(|(_, a)| a)
        .collect();
    if specs.is_empty() {
        return Err("Kodda pasif ağaç bilgisi bulunamadı".into());
    }
    let spec = specs
        .get(active.saturating_sub(1))
        .copied()
        .unwrap_or(specs[0]);
    res.spec_title = attr(spec, "title").unwrap_or("").to_string();
    res.node_ids = parse_node_list(attr(spec, "nodes").unwrap_or(""));
    if res.node_ids.is_empty() {
        return Err("Seçili pasif ağaçta hiç düğüm yok".into());
    }
    Ok(res)
}

pub fn decode_pob2_code(code: &str) -> Result<Pob2Import, String> {
    let code = code.trim();
    if code.is_empty() {
        return Err("Kod boş".into());
    }
    if code.len() > MAX_CODE_CHARS {
        return Err("Kod çok uzun".into());
    }
    let bytes = decode_b64(code)?;
    let xml = decompress_to_vec_zlib_with_limit(&bytes, MAX_XML_BYTES)
        .map_err(|_| "Kod açılamadı (bozuk ya da çok büyük)".to_string())?;
    let xml = String::from_utf8_lossy(&xml);
    parse_pob2_xml(&xml)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn encode(xml: &str) -> String {
        let z = miniz_oxide::deflate::compress_to_vec_zlib(xml.as_bytes(), 6);
        base64::engine::general_purpose::STANDARD
            .encode(z)
            .replace('+', "-")
            .replace('/', "_")
    }

    const XML: &str = r#"<?xml version="1.0"?>
<PathOfBuilding2>
  <Build level="92" className="Witch" ascendClassName="Infernalist" targetVersion="0_1">
    <PlayerStat stat="Life" value="1"/>
  </Build>
  <!-- <Spec nodes="999"/> -->
  <Tree activeSpec="2">
    <Spec title="Leveling" classId="3" nodes="1,2,3"/>
    <Spec title="Endgame &amp; more" classId="3" ascendClassId="1" nodes="10, 20,20,x,30" masteryEffects="{1,2}">
      <Sockets/>
    </Spec>
  </Tree>
</PathOfBuilding2>"#;

    #[test]
    fn roundtrip_picks_active_spec() {
        let r = decode_pob2_code(&encode(XML)).unwrap();
        assert_eq!(r.class_name, "Witch");
        assert_eq!(r.ascendancy_name, "Infernalist");
        assert_eq!(r.level, 92);
        assert_eq!(r.spec_title, "Endgame & more");
        assert_eq!(r.node_ids, vec![10, 20, 30]);
    }

    #[test]
    fn tolerates_whitespace_padding_and_bad_active() {
        let xml = XML.replace("activeSpec=\"2\"", "activeSpec=\"9\"");
        let code = format!("  {}=\n", encode(&xml).chars().collect::<Vec<_>>().chunks(40).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("\n"));
        let r = decode_pob2_code(&code).unwrap();
        assert_eq!(r.node_ids, vec![1, 2, 3]);
    }

    #[test]
    fn rejects_garbage_without_panic() {
        for bad in ["", "   ", "POE2TC:abcd", "!!!!", "aGVsbG8", "eJwDAAAAAAE"] {
            assert!(decode_pob2_code(bad).is_err(), "{bad}");
        }
        assert!(decode_pob2_code(&encode("<html><Spec nodes=\"1\"/></html>")).is_err());
        assert!(decode_pob2_code(&encode("<PathOfBuilding2><Tree/></PathOfBuilding2>")).is_err());
        assert!(parse_pob2_xml("<PathOfBuilding2><Spec nodes=\"\"/>").is_err());
        assert!(parse_pob2_xml("<PathOfBuilding2><Spec nodes=\"1").is_ok() == false);
    }

    #[test]
    fn zip_bomb_is_rejected() {
        let big = "a".repeat(MAX_XML_BYTES + 1024);
        assert!(decode_pob2_code(&encode(&big)).is_err());
    }
}
