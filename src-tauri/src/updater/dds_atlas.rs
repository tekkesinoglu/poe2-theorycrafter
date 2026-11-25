//! PoB2 `tree.json` artık simgeleri `*.dds.zst` dosyalarında tutuyor: zstd ile
//! sıkıştırılmış, DX10 başlıklı, BC1 (DXT1) biçiminde **doku dizileri** (her
//! katman bir simge, her katmanın kendi mip zinciri var). `ddsCoords` içindeki
//! tam sayı değer, katmanın 1 tabanlı indeksidir.
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

fn mip_bytes(w: u32, h: u32) -> usize {
    (w.div_ceil(4) as usize) * (h.div_ceil(4) as usize) * 8
}

fn rgb565(c: u16) -> [u8; 3] {
    let r = ((c >> 11) & 0x1F) as u32;
    let g = ((c >> 5) & 0x3F) as u32;
    let b = (c & 0x1F) as u32;
    [
        ((r * 255 + 15) / 31) as u8,
        ((g * 255 + 31) / 63) as u8,
        ((b * 255 + 15) / 31) as u8,
    ]
}

/// BC1 (DXT1) -> RGBA8. `data` en az mip_bytes(w, h) uzunlukta olmalı.
fn decode_bc1(data: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    let bw = w.div_ceil(4) as usize;
    let bh = h.div_ceil(4) as usize;

    for by in 0..bh {
        for bx in 0..bw {
            let o = (by * bw + bx) * 8;
            let c0 = u16::from_le_bytes([data[o], data[o + 1]]);
            let c1 = u16::from_le_bytes([data[o + 2], data[o + 3]]);
            let idx = u32::from_le_bytes([data[o + 4], data[o + 5], data[o + 6], data[o + 7]]);

            let p0 = rgb565(c0);
            let p1 = rgb565(c1);
            let mut pal = [[0u8; 4]; 4];
            pal[0] = [p0[0], p0[1], p0[2], 255];
            pal[1] = [p1[0], p1[1], p1[2], 255];
            if c0 > c1 {
                for i in 0..3 {
                    pal[2][i] = ((2 * p0[i] as u32 + p1[i] as u32) / 3) as u8;
                    pal[3][i] = ((p0[i] as u32 + 2 * p1[i] as u32) / 3) as u8;
                }
                pal[2][3] = 255;
                pal[3][3] = 255;
            } else {
                for i in 0..3 {
                    pal[2][i] = ((p0[i] as u32 + p1[i] as u32) / 2) as u8;
                }
                pal[2][3] = 255;
                pal[3] = [0, 0, 0, 0]; // 1 bit alfa: saydam
            }

            for py in 0..4usize {
                for px in 0..4usize {
                    let x = bx * 4 + px;
                    let y = by * 4 + py;
                    if x >= w as usize || y >= h as usize {
                        continue;
                    }
                    let sel = ((idx >> (2 * (py * 4 + px))) & 3) as usize;
                    let d = (y * w as usize + x) * 4;
                    out[d..d + 4].copy_from_slice(&pal[sel]);
                }
            }
        }
    }
    out
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
    // 71 = BC1_UNORM, 72 = BC1_UNORM_SRGB
    if dxgi != 71 && dxgi != 72 {
        bail!("Desteklenmeyen DXGI biçimi: {dxgi}");
    }
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
        let b = mip_bytes(mip_dim(width, m), mip_dim(height, m));
        if m < level {
            level_off += b;
        }
        stride += b;
    }
    let cell_bytes = mip_bytes(cw, ch);

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
        let rgba = decode_bc1(data, cw, ch);

        let cx = (i as u32 % cols) * cw;
        let cy = (i as u32 / cols) * ch;
        for y in 0..ch as usize {
            let src = y * cw as usize * 4;
            let dst = ((cy as usize + y) * gw as usize + cx as usize) * 4;
            grid[dst..dst + cw as usize * 4].copy_from_slice(&rgba[src..src + cw as usize * 4]);
        }
        cells.insert(layer, AtlasCell { x: cx, y: cy, w: cw, h: ch });
    }

    let img = image::RgbaImage::from_raw(gw, gh, grid).ok_or_else(|| anyhow!("atlas oluşturulamadı"))?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    Ok(Atlas { png, cells })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bc1_solid_and_transparent_blocks() {
        // c0 = saf kırmızı (0xF800) > c1 = 0 -> 4 renkli mod; tüm indeksler 0 => kırmızı
        let red = [0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0];
        let px = decode_bc1(&red, 4, 4);
        assert_eq!(&px[0..4], &[255, 0, 0, 255]);
        assert_eq!(&px[60..64], &[255, 0, 0, 255]);

        // c0 <= c1 ve indeks 3 => saydam siyah
        let transp = [0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF];
        let px = decode_bc1(&transp, 4, 4);
        assert_eq!(&px[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn bc1_non_multiple_of_four_is_cropped() {
        let block = [0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0];
        let px = decode_bc1(&block, 3, 2);
        assert_eq!(px.len(), 3 * 2 * 4);
    }

    #[test]
    fn mip_math() {
        assert_eq!(mip_bytes(64, 64), 2048);
        assert_eq!(mip_bytes(1, 1), 8);
        assert_eq!(mip_dim(64, 7), 1);
        assert_eq!(mip_bytes(43, 43), 11 * 11 * 8);
    }

    #[test]
    fn rejects_garbage() {
        assert!(build_atlas(&[], &[1], 64).is_err());
        assert!(build_atlas(&[1u8; 64], &[1], 64).is_err());
    }
}
