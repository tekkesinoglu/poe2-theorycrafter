# PoB2 accuracy check

Compares the app's passive-tree defence estimates (Life / Energy Shield / Armour / Evasion) with
**Path of Building 2** itself, on the same passive allocations. Neither tool is run with gear: both
use the same flat baseline (ES +450, Armour +1800, Evasion +1800 added as a PoB2 custom modifier),
so only the *tree contribution* is compared.

```bash
# 1. LuaJIT + lua-utf8 (PoB2 needs them), PoB2 sources
git clone https://github.com/LuaJIT/LuaJIT && (cd LuaJIT && git checkout 2460b3ff93a1c955de3d62cfc825de7d68dc272e && make)
git clone --depth 1 --branch 0.1.6 https://github.com/starwing/luautf8 && \
  gcc -O2 -shared -fPIC -ILuaJIT/src luautf8/lutf8lib.c -o luautf8/lua-utf8.so
git clone --depth 1 https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git pob2

# 2. Dump sample builds from the app's optimizer (tree.json from the PoB2 repo)
POBDUMP_OUT=app_builds.json POBDUMP_TREE=pob2/src/TreeData/0_5/tree.json \
  cargo test --manifest-path src-tauri/Cargo.toml --lib pobdump

# 3. Run them in PoB2
cd pob2/src && CI=1 LUA_PATH="../runtime/lua/?.lua;../runtime/lua/?/init.lua;;" LUA_CPATH="../../luautf8/?.so;;" \
  POB_IN=../../app_builds.json POB_OUT=../../pob_results.json ../../LuaJIT/src/luajit ../../tools/pob2-compare/pobrun.lua

# 4. Compare
python3 tools/pob2-compare/cmp.py pob_results.json app_builds.json
```

Result on 72 builds (6 classes x 6 archetypes x 30/80 points), median / 90th-percentile error vs PoB2:

| metric | before | after |
|---|---|---|
| Life | 7.3% / 17.9% | 1.8% / 3.9% |
| Energy Shield | 3.6% / 33.1% | 0.0% / 6.4% |
| Armour | 17.1% / 33.4% | 0.0% / 13.2% |
| Evasion | 17.4% / 43.3% | 0.8% / 9.1% |

Known remaining differences: "+X to any Attribute" choice nodes (the app assumes 1/3 go to Strength),
conditional modifiers (ignored), DPS (depends on weapon/skill/supports, not compared here).
