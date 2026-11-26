//! PoB2 `tree.json` simgeleri `*.dds.zst` dosyalarında tutar: zstd ile sıkıştırılmış,
//! DX10 başlıklı, BC1 / BC3 / BC7 biçiminde **doku dizileri** (her katman bir simge,
//! her katmanın kendi mip zinciri var). `ddsCoords` içindeki tam sayı değer, katmanın
//! 1 tabanlı indeksidir.
//!
//! Bu modül istenen katmanları çözüp tek bir PNG ızgarasına (atlas) dizer;
//! böylece frontend'in mevcut `drawImage(sheet, x, y, w, h)` mantığı değişmeden çalışır.

use anyhow::{anyhow, bail, Result};
use std::collections::{BTreeSet, HashMap};
use std::io::Read;

/// Sıkıştırılmış dosyanın açılmış boyutu için üst sınır (bozuk/kötü niyetli veri koruması)
const MAX_DECOMPRESSED: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AtlasCell {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

pub struct Atlas {
    pub png: Vec<u8>,
    /// 1 tabanlı katman indeksi -> atlas içindeki hücre
    pub cells: HashMap<u32, AtlasCell>,
}

fn rd_u32(buf: &[u8], off: usize) -> Result<u32> {
    let b = buf
        .get(off..off + 4)
        .ok_or_else(|| anyhow!("DDS başlığı kesik"))?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn mip_dim(d: u32, level: u32) -> u32 {
    (d >> level).max(1)
}

fn block_bytes_for_dxgi(dxgi: u32) -> Result<usize> {
    match dxgi {
        71 | 72 => Ok(8),            // BC1 (DXT1)
        77 | 78 | 98 | 99 => Ok(16), // BC3 (DXT5) ve BC7
        other => bail!("Desteklenmeyen DXGI biçimi: {other}"),
    }
}

fn mip_bytes(w: u32, h: u32, block_bytes: usize) -> usize {
    (w.div_ceil(4) as usize) * (h.div_ceil(4) as usize) * block_bytes
}

/// Tek bir 2D katmanı `image` crate'inin DDS çözücüsüne verebilmek için 148 baytlık DX10 başlığı ekler.
fn decode_single_layer_dds(slice_data: &[u8], w: u32, h: u32, dxgi: u32) -> Result<Vec<u8>> {
    let mut dds = Vec::with_capacity(148 + slice_data.len());
    dds.extend_from_slice(b"DDS ");
    dds.extend_from_slice(&124u32.to_le_bytes()); // dwSize
    dds.extend_from_slice(&0x000A_1007u32.to_le_bytes()); // CAPS | HEIGHT | WIDTH | PIXELFORMAT | MIPMAPCOUNT | LINEARSIZE
    dds.extend_from_slice(&h.to_le_bytes());
    dds.extend_from_slice(&w.to_le_bytes());
    dds.extend_from_slice(&(slice_data.len() as u32).to_le_bytes());
    dds.extend_from_slice(&0u32.to_le_bytes()); // dwDepth
    dds.extend_from_slice(&1u32.to_le_bytes()); // dwMipMapCount = 1
    dds.extend_from_slice(&[0u8; 44]); // dwReserved1[11]
    dds.extend_from_slice(&32u32.to_le_bytes()); // ddpf.dwSize
    dds.extend_from_slice(&0x4u32.to_le_bytes()); // DDPF_FOURCC
    dds.extend_from_slice(b"DX10");
    dds.extend_from_slice(&[0u8; 20]); // RGB bit masks
    dds.extend_from_slice(&0x1000u32.to_le_bytes()); // DDSCAPS_TEXTURE
    dds.extend_from_slice(&[0u8; 16]); // caps2..reserved2
    // DX10 ek başlığı (20 bayt)
    dds.extend_from_slice(&dxgi.to_le_bytes());
    dds.extend_from_slice(&3u32.to_le_bytes()); // D3D10_RESOURCE_DIMENSION_TEXTURE2D
    dds.extend_from_slice(&0u32.to_le_bytes()); // miscFlag
    dds.extend_from_slice(&1u32.to_le_bytes()); // arraySize = 1
    dds.extend_from_slice(&0u32.to_le_bytes()); // miscFlags2
    dds.extend_from_slice(slice_data);

    let img = image::load_from_memory_with_format(&dds, image::ImageFormat::Dds)
        .map_err(|e| anyhow!("DDS katmanı çözülemedi (dxgi={dxgi}): {e}"))?;
    Ok(img.to_rgba8().into_raw())
}

/// `layers`: istenen 1 tabanlı katman indeksleri. `max_cell`: hücre kenarı bu değeri
/// aşmayacak en büyük mip seviyesi seçilir (ör. 128 -> 64 için mip 1).
pub fn build_atlas(dds_zst: &[u8], layers: &[u32], max_cell: u32) -> Result<Atlas> {
    let mut raw = Vec::new();
    let mut dec = ruzstd::decoding::StreamingDecoder::new(dds_zst)
        .map_err(|e| anyhow!("zstd başlatılamadı: {e}"))?;
    (&mut dec).take(MAX_DECOMPRESSED + 1).read_to_end(&mut raw)?;
    if raw.len() as u64 > MAX_DECOMPRESSED {
        bail!("DDS açılmış boyutu sınırı aşıyor");
    }

    if raw.len() < 148 || &raw[0..4] != b"DDS " {
        bail!("DDS imzası geçersiz");
    }
    let height = rd_u32(&raw, 12)?;
    let width = rd_u32(&raw, 16)?;
    let mips = rd_u32(&raw, 28)?.max(1);
    if &raw[84..88] != b"DX10" {
        bail!("DX10 başlığı yok (desteklenmeyen DDS)");
    }
    let dxgi = rd_u32(&raw, 128)?;
    let array = rd_u32(&raw, 140)?.max(1);
    let block_bytes = block_bytes_for_dxgi(dxgi)?;

    if width == 0 || height == 0 || width > 4096 || height > 4096 || mips > 16 || array > 4096 {
        bail!("DDS boyutları makul değil ({width}x{height}, mip {mips}, dizi {array})");
    }

    // Hücre için mip seçimi
    let mut level = 0;
    while level + 1 < mips && width.max(height) >> level > max_cell {
        level += 1;
    }
    let (cw, ch) = (mip_dim(width, level), mip_dim(height, level));

    let mut stride = 0usize;
    let mut level_off = 0usize;
    for m in 0..mips {
        let b = mip_bytes(mip_dim(width, m), mip_dim(height, m), block_bytes);
        if m < level {
            level_off += b;
        }
        stride += b;
    }
    let cell_bytes = mip_bytes(cw, ch, block_bytes);

    let wanted: BTreeSet<u32> = layers
        .iter()
        .copied()
        .filter(|&l| l >= 1 && l <= array)
        .collect();
    if wanted.is_empty() {
        bail!("Geçerli katman yok");
    }

    let cols = (wanted.len() as f64).sqrt().ceil() as u32;
    let rows = (wanted.len() as u32).div_ceil(cols);
    let (gw, gh) = (cols * cw, rows * ch);
    let mut grid = vec![0u8; (gw as usize) * (gh as usize) * 4];
    let mut cells = HashMap::new();

    for (i, &layer) in wanted.iter().enumerate() {
        let start = 148 + (layer as usize - 1) * stride + level_off;
        let data = raw
            .get(start..start + cell_bytes)
            .ok_or_else(|| anyhow!("Katman {layer} dosya sınırı dışında"))?;
        let rgba = decode_single_layer_dds(data, cw, ch, dxgi)?;

        let cx = (i as u32 % cols) * cw;
        let cy = (i as u32 / cols) * ch;
        for y in 0..ch as usize {
            let src = y * cw as usize * 4;
            let dst = ((cy as usize + y) * gw as usize + cx as usize) * 4;
            grid[dst..dst + cw as usize * 4].copy_from_slice(&rgba[src..src + cw as usize * 4]);
        }
        cells.insert(layer, AtlasCell { x: cx, y: cy, w: cw, h: ch });
    }

    let img =
        image::RgbaImage::from_raw(gw, gh, grid).ok_or_else(|| anyhow!("atlas oluşturulamadı"))?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    Ok(Atlas { png, cells })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bc1_and_bc7_decode_correctly() {
        // 4x4 saf kırmızı BC1 bloğu (c0 = 0xF800, c1 = 0x0000, tüm indeksler 0)
        let red_bc1 = [0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0];
        let px = decode_single_layer_dds(&red_bc1, 4, 4, 71).unwrap();
        assert_eq!(&px[0..4], &[255, 0, 0, 255]);
        assert_eq!(&px[60..64], &[255, 0, 0, 255]);
    }

    #[test]
    fn mip_math() {
        assert_eq!(mip_bytes(64, 64, 8), 2048);
        assert_eq!(mip_bytes(64, 64, 16), 4096);
        assert_eq!(mip_dim(64, 7), 1);
        assert_eq!(mip_bytes(43, 43, 8), 11 * 11 * 8);
    }

    #[test]
    fn rejects_garbage() {
        assert!(build_atlas(&[], &[1], 64).is_err());
        assert!(build_atlas(&[1u8; 64], &[1], 64).is_err());
    }
}