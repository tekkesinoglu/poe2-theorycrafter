# PoE2 Theorycrafter

**English** · [Türkçe](#türkçe)

A desktop app (Tauri 2 + React) for theorycrafting **Path of Exile 2** passive trees. Game data (passive tree, gems, icons) is downloaded from the community [Path of Building PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) repository, so it follows the current patch.

## Features
- Interactive passive tree with real icons, search and Ascendancy selection
- **Draw Best Build**: optimizer that allocates points by your stat weights
- Support gem recommendations, Spirit budget (auras / heralds), EHP and DPS estimates
- Save builds, compare two builds side by side
- Share codes (`POE2TC:`) and **import from Path of Building 2** (paste a PoB2 export code)
- English and Turkish UI

## Install
Download the installer for your OS from the [Releases](../../releases) page. Installers are unsigned, so Windows SmartScreen / macOS Gatekeeper may warn on first launch.

On first launch click **Download Data** (needs internet) to fetch the tree and gem data.

## Importing from Path of Building 2
In PoB2 use *Import/Export Build → Generate*, copy the code, paste it into the *Build Share Code* box and press **Import Code**. Class, Ascendancy and the allocated passives are loaded; nodes that do not exist in the downloaded tree version are skipped and reported.

## Development
```bash
npm ci
npm run tauri dev      # run the app
npm run build          # frontend only
cargo test --manifest-path src-tauri/Cargo.toml
```
Linux needs the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/#linux). Releases are built by GitHub Actions when a `v*` tag is pushed.

DPS/EHP numbers are estimates and are **not** guaranteed to match Path of Building.

## License
MIT — see [LICENSE](LICENSE). Not affiliated with Grinding Gear Games. Path of Exile is a trademark of Grinding Gear Games; game data originates from Path of Building Community (MIT).

---

# Türkçe

**Path of Exile 2** pasif ağacı için masaüstü theorycraft aracı (Tauri 2 + React). Oyun verisi (pasif ağaç, gem'ler, ikonlar) topluluğun [Path of Building PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) deposundan indirilir; güncel yamayı takip eder.

## Özellikler
- Gerçek ikonlu etkileşimli pasif ağaç, arama ve Ascendancy seçimi
- **En İyi Build'i Çiz**: stat ağırlıklarına göre puan dağıtan optimizer
- Support gem önerileri, Spirit bütçesi (aura / herald), EHP ve DPS tahmini
- Build kaydetme ve iki build'i yan yana kıyaslama
- Paylaşım kodu (`POE2TC:`) ve **Path of Building 2'den içe aktarma**
- İngilizce ve Türkçe arayüz

## Kurulum
[Releases](../../releases) sayfasından işletim sisteminize uygun kurulum dosyasını indirin. Kurulum dosyaları imzasızdır; Windows SmartScreen / macOS Gatekeeper ilk açılışta uyarı verebilir.

İlk açılışta **Verileri İndir** düğmesine basın (internet gerekir).

## Path of Building 2'den içe aktarma
PoB2'de *Import/Export Build → Generate* ile kodu kopyalayın, *Build Paylaşım Kodu* kutusuna yapıştırıp **Kodu Yükle**'ye basın. Sınıf, Ascendancy ve seçili pasifler yüklenir; indirilen ağaç sürümünde olmayan düğümler atlanır ve bildirilir.

## Geliştirme
Yukarıdaki komutlara bakın. DPS/EHP değerleri tahmindir; Path of Building ile birebir aynı olması garanti edilmez.

## Lisans
MIT — [LICENSE](LICENSE). Grinding Gear Games ile bağlantılı değildir.
