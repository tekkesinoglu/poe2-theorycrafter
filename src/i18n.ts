// Basit i18n: anahtar = Türkçe kaynak metin, değer = İngilizce karşılık.
// `{ad}` biçimindeki yer tutucular t(key, { ad: 1 }) ile doldurulur.
export type Lang = 'tr' | 'en';

const STORAGE_KEY = 'poe2tc.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    /* localStorage kullanılamıyor */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let current: Lang = detect();

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  } catch {
    /* yoksay */
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  const base = current === 'en' ? EN[key] ?? key : key;
  if (!params) return base;
  return base.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? String(params[k]) : m
  );
}

export const EN: Record<string, string> = {
  "Maksimum 8 Ascendancy puanına (4 Major Notable) ulaşıldı.": "Reached the maximum of 8 Ascendancy points (4 Major Notables).",
  "Stat Seçilmedi": "No stat selected",
  "Ağaç yüklendi ({n} düğüm)": "Tree loaded ({n} nodes)",
  "GitHub PoB2 reposundan yama verileri kontrol ediliyor...": "Checking patch data from the PoB2 GitHub repo...",
  "Güncelleme hatası: {err}": "Update error: {err}",
  "Lütfen Stat Ağırlıkları panelinden en az bir stat ekleyin.": "Please add at least one stat in the Stat Weights panel.",
  "Optimizasyon tamamlandı ({name}): {n} puan dağıtıldı.": "Optimization complete ({name}): {n} points allocated.",
  "Optimizasyon hatası: {err}": "Optimization error: {err}",
  "Build kaydedildi: \"{name}\"": "Build saved: \"{name}\"",
  "Build yüklendi: {label} ({n} puan)": "Build loaded: {label} ({n} points)",
  "Paylaşım kodu oluşturuldu ve panoya kopyalandı!": "Share code created and copied to the clipboard!",
  "Paylaşım kodu oluşturuldu (panoya erişim izni yok, kutudan kopyalayın).": "Share code created (no clipboard permission; copy it from the box).",
  "Önce bir kod yapıştırın (POE2TC: veya Path of Building 2 kodu).": "Paste a code first (POE2TC: or a Path of Building 2 code).",
  "Koddaki düğümlerin hiçbiri bu ağaç sürümünde bulunamadı.": "None of the nodes in the code exist in this tree version.",
  "PoB2 build'i yüklendi: {n} düğüm. {ignored} düğüm atlandı (ascendancy/farklı ağaç sürümü).": "PoB2 build loaded: {n} nodes. {ignored} nodes skipped (ascendancy / different tree version).",
  "Kod tanınmadı: POE2TC: veya Path of Building 2 kodu girin.": "Code not recognized: enter a POE2TC: or Path of Building 2 code.",
  "Paylaşım Kodu": "Share Code",
  "Paylaşım kodu çözümlenemedi (bozuk veya eksik kod).": "Could not decode the share code (corrupted or incomplete).",
  "Maksimum {max} pasif puan sınırına ulaşıldı.": "Reached the maximum of {max} passive points.",
  "Sınıf Seçimi": "Class selection",
  "Başlangıç Düğümü": "Start node",
  "Dağılım:": "Allocated:",
  "Pasif Puan Sınırı: {min} - {max}": "Passive point limit: {min} - {max}",
  "En İyi Build'i Çiz": "Draw Best Build",
  "Seçili tüm pasif düğümler sıfırlansın mı?": "Reset all selected passive nodes?",
  "Pasif ağaç sıfırlandı.": "Passive tree reset.",
  "Sıfırla": "Reset",
  "Güncelleniyor...": "Updating...",
  "Patch Güncelle (Ctrl+U)": "Update Patch (Ctrl+U)",
  "Yetenek Ağacı Veritabanı Bulunamadı": "Skill Tree Database Not Found",
  "Path of Building PoE 2 verilerini ve yetenek ağacı görsellerini indirerek planlamaya başlayabilirsiniz.": "Download the Path of Building PoE 2 data and skill tree images to start planning.",
  "Veriler İndiriliyor...": "Downloading data...",
  "Verileri İndir": "Download Data",
  "Ascendancy Seçimi": "Ascendancy selection",
  "/ 8 Puan": "/ 8 Points",
  "Kapat": "Close",
  "2 Puan": "2 Points",
  "Stat Paylaşımı": "Stat Weights",
  "Toplam: %": "Total: %",
  "Eşit Dağıt": "Distribute Evenly",
  "{stat} kaldır": "Remove {stat}",
  "+ Ekle": "+ Add",
  "Bu Dağılımla Build'i Çiz (%100)": "Draw Build With This Split (100%)",
  "Ağaçta düğüm ara": "Search nodes in tree",
  "Ağaçta düğüm / Keystone ara (Enter ile odaklan)...": "Search nodes / Keystones in tree (Enter to focus)...",
  "Odaklan": "Focus",
  "Aramayı temizle": "Clear search",
  "Build & EHP (": "Build & EHP (",
  "Kayıt & Kıyas (": "Saves & Compare (",
  "/8 Puan)": "/8 Points)",
  "Düzenle": "Edit",
  "Ascendancy düğümü seçilmedi": "No Ascendancy node selected",
  "Savunma (Effective HP)": "Defense (Effective HP)",
  "Crit Şansı:": "Crit Chance:",
  "Crit Hasarı:": "Crit Damage:",
  "Sınıf seçip": "Pick a class and press",
  "butonuna basın veya düğümlere tıklayarak puan verin.": "or click nodes to allocate points.",
  "Aktif Skill Gem (": "Active Skill Gem (",
  "yetenek)": "skills)",
  "Örn: Tempest Flurry, Spark, Lightning Arrow...": "e.g. Tempest Flurry, Spark, Lightning Arrow...",
  "Silah & Ekipman Çarpanları": "Weapon & Gear Multipliers",
  "Silah Baz DPS (Max": "Weapon Base DPS (Max",
  "Etkin Seviye:": "Effective Level:",
  "% Taban Hasar": "% Base Damage",
  "Spirit Bütçesi & Aura / Herald": "Spirit Budget & Auras / Heralds",
  "100 Görev +": "100 Quest +",
  "Ağaç/Asc + Ekipman:": "Tree/Asc + Gear:",
  "⚠ Spirit kapasitesi": "⚠ Spirit capacity",
  "puan aşıldı!": "points exceeded!",
  "Toplam DPS:": "Total DPS:",
  "Önerilen Support Gem'ler (Uyum & DPS):": "Recommended Support Gems (Synergy & DPS):",
  "Bu yetenek için uyumlu Support Gem bulunamadı.": "No compatible Support Gems found for this skill.",
  "Öneri": "Suggestion",
  "İki Build Kıyaslama (Compare / Diff)": "Compare Two Builds (Diff)",
  "Aktif Build (": "Current Build (",
  "Aktif Build ({name})": "Current Build ({name})",
  "Mevcut": "Current",
  "Metrik": "Metric",
  "Fark (A-B)": "Diff (A-B)",
  "Tahmini DPS": "Estimated DPS",
  "Crit Şansı": "Crit Chance",
  "Spirit Kap.": "Spirit Cap.",
  "Ortak Düğüm:": "Shared nodes:",
  "Sadece A:": "Only A:",
  "Sadece B:": "Only B:",
  "Mevcut Build'i Kaydet": "Save Current Build",
  "Build adı (ör. Invoker Crit vs ES)...": "Build name (e.g. Invoker Crit vs ES)...",
  "Kaydet (": "Save (",
  "Puan)": "Points)",
  "Build Paylaşım Kodu (Export / Import)": "Build Share Code (Export / Import)",
  "Kodu dışa aktarmak için aşağıya tıklayın veya POE2TC:... / Path of Building 2 kodunu buraya yapıştırın": "Click below to export, or paste a POE2TC:... / Path of Building 2 code here",
  "Kodu Oluştur & Kopyala": "Create & Copy Code",
  "Kodu Yükle": "Import Code",
  "Kayıtlı Build'ler (": "Saved Builds (",
  "Henüz kaydedilmiş bir build yok. Build kaydettiğinde yukarıda otomatik kıyaslama tablosu açılır.": "No saved builds yet. When you save a build, a comparison table opens above automatically.",
  "Hedef:": "Target:",
  "Puan": "Points",
  "Yükle": "Load",
  "\"{name}\" build'i silinsin mi?": "Delete build \"{name}\"?",
  "\"{name}\" silindi.": "\"{name}\" deleted.",
  "Sil": "Delete",
  "Hazır": "Ready",
  "Düğüm #{id}": "Node #{id}",
  "Kaldırılacak:": "Will remove:",
  "puan": "points",
  "puan (Bütçe sınırı": "points (over budget",
  "aşılıyor)": "limit)",
  "puan bağla": "points to connect",
  "Ana ağaca doğrudan bağlı değil": "Not directly connected to the main tree",
  "Dil": "Language",
  "+25% Crit Şansı & +30% Crit Hasarı": "+25% Crit Chance & +30% Crit Damage",
  "+16% More Gem Kalite Çarpanı": "+16% More Gem Quality Multiplier",
  "+15% More Yetenek Hasarı": "+15% More Skill Damage",
  "+35% Crit Şansı": "+35% Crit Chance",
  "Evasion/ES üzerinden +60 Bonus Spirit": "+60 Bonus Spirit from Evasion/ES",
  "Crit ile Direnç Yoksayma (+30% Crit Şansı)": "Ignore Resistances on Crit (+30% Crit Chance)",
  "+25% More Extra Chaos Hasarı": "+25% More Extra Chaos Damage",
  "+40% Crit Hasarı & +20% Crit Şansı": "+40% Crit Damage & +20% Crit Chance",
  "+22% More Shock Hasar Çarpanı": "+22% More Shock Damage Multiplier",
  "+25% More Tekrarlanan Büyü DPS": "+25% More Repeated Spell DPS",
  "+35% Evasion & Yavaşlatma Savunması": "+35% Evasion & Slow Protection",
  "+35% Crit Şansı & +35% Crit Hasarı": "+35% Crit Chance & +35% Crit Damage",
  "+20% More Hız & +35% Evasion": "+20% More Speed & +35% Evasion",
  "+20% More Mesafe Hasarı": "+20% More Range Damage",
  "+40% Crit Şansı & +30% Crit Hasarı": "+40% Crit Chance & +30% Crit Damage",
  "+22% More Çift Zehir DPS": "+22% More Double Poison DPS",
  "+18% More Hareketli Saldırı DPS": "+18% More Moving Attack DPS",
  "+24% More Ağaç Güçlendirmesi & +25% Life": "+24% More Tree Empowerment & +25% Life",
  "+22% More Fiziksel/Kırılma DPS": "+22% More Physical/Break DPS",
  "+45% Crit Hasarı & +25% Crit Şansı": "+45% Crit Damage & +25% Crit Chance",
  "+38% More Spell Lightning Hasarı": "+38% More Spell Lightning Damage",
  "+22% More Attack Hasarı": "+22% More Attack Damage",
  "+15% More Sinerji Hasarı": "+15% More Synergy Damage",
  "0 sonuç": "0 results",
  "Veritabanı kilidi alınamadı": "Could not acquire the database lock",
  "Veritabanı henüz yüklenmedi": "Database not loaded yet",
  "Güncelleme tamamlandı ({n} düğüm, {g} gem)": "Update complete ({n} nodes, {g} gems)",
  "Geçersiz kod (base64 çözülemedi)": "Invalid code (base64 could not be decoded)",
  "Bu bir Path of Building kodu gibi görünmüyor": "This doesn't look like a Path of Building code",
  "Kodda pasif ağaç bilgisi bulunamadı": "No passive tree data found in the code",
  "Seçili pasif ağaçta hiç düğüm yok": "The selected passive tree has no nodes",
  "Kod boş": "Code is empty",
  "Kod çok uzun": "Code is too long",
  "Kod açılamadı (bozuk ya da çok büyük)": "Could not unpack the code (corrupted or too large)",
};
