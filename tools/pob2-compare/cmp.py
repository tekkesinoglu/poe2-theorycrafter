"""Usage: python3 cmp.py pob_results.json app_builds.json"""
import json, statistics as st, sys
pob = json.load(open(sys.argv[1]))
app = json.load(open(sys.argv[2]))
M={'life':'Life','es':'EnergyShield','armour':'Armour','evasion':'Evasion'}
print("metric   median|err|  p90|err|  rank-concordance  (app vs PoB2 w/ same flat gear base)")
for m,pk in M.items():
    rs=[(a['app'][m],p['pob'][pk]) for a,p in zip(app,pob) if p['ok'] and p['pob'].get(pk)]
    errs=sorted(abs(a-p)/p*100 for a,p in rs)
    conc=tot=0
    for i in range(len(rs)):
        for j in range(i+1,len(rs)):
            da=rs[i][0]-rs[j][0]; dp=rs[i][1]-rs[j][1]
            if da==0 or dp==0: continue
            tot+=1; conc+=(da>0)==(dp>0)
    print(f"{m:8} {st.median(errs):8.1f}%  {errs[int(len(errs)*.9)]:7.1f}%  {conc/tot*100:6.0f}%   n={len(rs)}")
