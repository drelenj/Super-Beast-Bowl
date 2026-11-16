#!/usr/bin/env python3
"""npm run build:roster  -> data/rosters.json  (validated; fails loudly).

Source: NBL_2026-27_Opening_Night_Rosters_CANON_OVR_morphology_physical.xlsx
        (default path .scratch/roster_physical.xlsx, or pass a path / set ROSTER_XLSX).
Canon fields are copied verbatim. OVR and the nine physical ratings are LOCKED canon: never
regenerated or adjusted here. `jersey` is an ARCADE PLACEHOLDER (workbook has none).
"""
import sys, os, json, hashlib
import openpyxl
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('ROSTER_XLSX', os.path.join(ROOT, '.scratch', 'roster_physical.xlsx'))
def die(msg):
    print('ROSTER BUILD FAILED: ' + msg, file=sys.stderr); sys.exit(1)
if not os.path.exists(src): die('workbook not found at ' + src)
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
rows = list(wb['All 712 Players'].iter_rows(values_only=True))
hdr = list(rows[0])
need = ['Franchise','Player ID','Player','Position','Age','YOE','Pre-camp OVR','OVR change','Opening-day OVR','Camp score','Readiness','Role familiarity','Opening-night role','Formation','Salary (M MEL)','Development outcome','Ancestry','Ancestry class','Height source tribe','Physique','Height (in)','Height (m)','Mass (lb)','Mass (kg)','Arm span (in)','Arm span (m)','Standing reach (in)','Standing reach (m)','Speed (rating)','Strength (rating)','Jumping (rating)','Acceleration (rating)','Agility (rating)','Balance (rating)','Throw Power (rating)','Stamina (rating)','Durability (rating)','Primary attributes','Secondary attributes','Secondary slot shortfall']
for c in need:
    if c not in hdr: die('missing column: ' + c)
PHYS = [('speed','Speed (rating)'),('strength','Strength (rating)'),('jumping','Jumping (rating)'),('acceleration','Acceleration (rating)'),('agility','Agility (rating)'),('balance','Balance (rating)'),('throwPower','Throw Power (rating)'),('stamina','Stamina (rating)'),('durability','Durability (rating)')]
teams, ids, errors = {}, set(), []
for r in rows[1:]:
    if not r[0]: continue
    d = dict(zip(hdr, r)); pid = d['Player ID']
    if pid in ids: errors.append('duplicate id ' + str(pid))
    ids.add(pid)
    phys = {}
    for k, col in PHYS:
        v = d[col]
        if not isinstance(v, int) or isinstance(v, bool) or v < 65 or v > 100: errors.append('%s %s out of range/not integer: %r' % (pid, col, v))
        phys[k] = v
    for col in ('Height (m)', 'Height (in)', 'Mass (kg)', 'Arm span (m)', 'Standing reach (m)'):
        if not isinstance(d[col], (int, float)) or d[col] <= 0: errors.append('%s missing %s' % (pid, col))
    if not isinstance(d['Opening-day OVR'], int): errors.append('%s OVR not integer' % pid)
    teams.setdefault(d['Franchise'], []).append({
        'id': pid, 'name': d['Player'], 'pos': d['Position'], 'age': d['Age'], 'yoe': d['YOE'],
        'ovrPreCamp': d['Pre-camp OVR'], 'ovrChange': d['OVR change'], 'ovr': d['Opening-day OVR'],
        'campScore': d['Camp score'], 'readiness': d['Readiness'], 'roleFamiliarity': d['Role familiarity'],
        'role': d['Opening-night role'], 'formation': d['Formation'], 'salaryMMEL': d['Salary (M MEL)'],
        'development': d['Development outcome'],
        'ancestry': d['Ancestry'], 'ancestryClass': d['Ancestry class'], 'heightTribe': d['Height source tribe'],
        'physique': d['Physique'], 'heightIn': d['Height (in)'], 'heightM': d['Height (m)'],
        'massLb': d['Mass (lb)'], 'massKg': d['Mass (kg)'], 'armSpanIn': d['Arm span (in)'], 'armSpanM': d['Arm span (m)'],
        'reachIn': d['Standing reach (in)'], 'reachM': d['Standing reach (m)'],
        'phys': phys, 'primary': d['Primary attributes'], 'secondary': d['Secondary attributes'],
        'shortfall': d['Secondary slot shortfall']})
n = sum(len(v) for v in teams.values())
if n != 712: errors.append('expected 712 players, got %d' % n)
if len(ids) != 712: errors.append('expected 712 unique ids, got %d' % len(ids))
if len(teams) != 26: errors.append('expected 26 franchises, got %d' % len(teams))
out = []
for fr, players in teams.items():
    st = [p for p in players if p['role'] == 'Projected starter']
    if len(st) != 12 or sum(p['pos'] == 'KPR' for p in st) != 1 or sum(p['pos'] == 'ARC' for p in st) != 1:
        errors.append('%s: starters %d (need 12 with 1 KPR + 1 ARC)' % (fr, len(st)))
    used = set()
    for p in sorted(players, key=lambda p: p['id']):
        j = int(hashlib.md5(p['id'].encode()).hexdigest(), 16) % 99 + 1
        while j in used: j = j % 99 + 1
        used.add(j); p['jersey'] = j
    out.append({'franchise': fr, 'formation': st[0]['formation'] if st else None, 'registered': len(players), 'players': players})
if errors: die('%d validation errors:\n  ' % len(errors) + '\n  '.join(errors[:40]))
out.sort(key=lambda t: t['franchise'])
json.dump({'_source': os.path.basename(src) + ' (sheet "All 712 Players")',
           '_note': 'Canon fields verbatim. OVR and phys ratings are LOCKED canon. jersey = ARCADE PLACEHOLDER.',
           'version': 'roster-morph-1.0/phys-1.0', 'teams': out},
          open(os.path.join(ROOT, 'data', 'rosters.json'), 'w', encoding='utf-8'), ensure_ascii=False)
hs = [p['heightIn'] for t in out for p in t['players']]; ms = [p['massKg'] for t in out for p in t['players']]
print('roster OK: 26 franchises, 712 unique ids, ratings 65-100 integers, heights %.1f-%.1f in, mass %.0f-%.0f kg' % (min(hs), max(hs), min(ms), max(ms)))
