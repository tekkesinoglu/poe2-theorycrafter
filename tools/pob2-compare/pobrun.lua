-- Runs the app's sample builds through Path of Building 2 (headless) and writes its Life/ES/Armour/Evasion.
-- Env: POB_IN (app_builds.json), POB_OUT (result json), POB_LIMIT (optional). Run from PoB2's src/ directory.
dofile("HeadlessWrapper.lua")
local json = require("dkjson")
local f = assert(io.open(os.getenv("POB_IN"), "r")); local rows = json.decode(f:read("*a")); f:close()
local tree = build.spec and build.spec.tree
local out = {}
local only = tonumber(os.getenv("POB_LIMIT") or "0")
for i, r in ipairs(rows) do
  if only > 0 and i > only then break end
  local classId = 0
  local ok_cls = false
  local t = main.tree[ "0_5" ] or tree
  for id, c in pairs(t.classes) do
    if c.name == r.class then classId = id; ok_cls = true end
  end
  local xml = string.format('<PathOfBuilding2><Build level="90" targetVersion="0_1" className="%s" ascendClassName="None" mainSocketGroup="1"/><Tree activeSpec="1"><Spec title="t" treeVersion="0_5" classId="%d" ascendClassId="0" nodes="%s"/></Tree><Skills/><Items/><Config><CustomModifierBlock title="gear" enabled="true">+450 to maximum Energy Shield\n+1800 to Armour\n+1800 to Evasion Rating</CustomModifierBlock></Config></PathOfBuilding2>',
    r.class, classId, table.concat(r.nodes, ","))
  local okb, err = pcall(loadBuildFromXML, xml, "t")
  local o = {}
  if okb and build.calcsTab and build.calcsTab.mainOutput then
    local mo = build.calcsTab.mainOutput
    for _, k in ipairs{"Life","EnergyShield","Armour","Evasion","TotalEHP","Spirit","SpiritUnreserved","CritChance","PhysicalMaximumHitTaken","Str","Dex","Int"} do o[k] = mo[k] end
  end
  table.insert(out, {class=r.class, preset=r.preset, points=r.points, ok=okb, err=(not okb) and tostring(err) or nil, classId=classId, pob=o})
end
local fo = io.open(os.getenv("POB_OUT"), "w"); fo:write(json.encode(out)); fo:close()
print("done", #out)
