import re
from collections import defaultdict

trades_raw = [
    (1,  'BNB',    'NO',  'TAKE_PROFIT',         0.73, 0.86, 4.38, 6, 64, 65, 66, 7.4, '1m43s', 'paper', +0.78),
    (2,  'ETH',    'NO',  'TAKE_PROFIT',         0.84, 0.97, 4.20, 5, 72, 67, 53, 7.4, '4m27s', 'paper', +0.65),
    (3,  'SOL',    'NO',  'MODEL_HARD_STOP',     0.86, 0.67, 4.30, 5, 64, 66, 66, 7.5, '23s',   'paper', -0.95),
    (4,  'BTC',    'NO',  'TAKE_PROFIT',         0.83, 0.93, 4.98, 6, 74, 73, 74, 7.3, '1m29s', 'paper', +0.60),
    (5,  'GOLD',   'NO',  'MODEL_HARD_STOP',     0.90, 0.27, 2.70, 3, 63, 79, 61, 7.5, '4m35s', 'paper', -1.89),
    (6,  'XRP',    'NO',  'TAKE_PROFIT',         0.77, 0.89, 4.62, 6, 78, 69, 69, 7.5, '50s',   'paper', +0.72),
    (7,  'SOL',    'NO',  'MODEL_HARD_STOP',     0.70, 0.53, 4.90, 7, 86, 67, 67, 7.0, '24s',   'paper', -1.19),
    (8,  'ZEC',    'YES', 'BREAKEVEN',           0.87, 0.87, 4.35, 5, 71, 72, 71, 3.6, '1m8s',  'paper', 0.00),
    (9,  'ZEC',    'YES', 'MODEL_HARD_STOP',     0.82, 0.65, 4.92, 6, 62, 79, 77, 6.7, '1m32s', 'paper', -1.02),
    (10, 'SILVER', 'NO',  'TAKE_PROFIT',         0.83, 0.96, 3.32, 4, 69, 75, 75, 4.9, '1m22s', 'paper', +0.52),
    (11, 'NATGAS', 'YES', 'TAKE_PROFIT',         0.87, 0.96, 3.48, 4, 63, 98, 97, 7.5, '2m14s', 'paper', +0.36),
    (12, 'GOLD',   'NO',  'MODEL_LATE_EXIT',     0.84, 0.69, 3.36, 4, 71, 65, 65, 3.3, '49s',   'paper', -0.60),
    (13, 'SILVER', 'NO',  'TAKE_PROFIT',         0.88, 0.96, 2.64, 3, 69, 70, 75, 5.8, '1m43s', 'paper', +0.24),
    (14, 'BTC',    'YES', 'MODEL_HARD_STOP',     0.90, 0.56, 4.50, 5, 71, 75, 58, 6.7, '1m53s', 'live',  -1.82),
    (15, 'XRP',    'YES', 'BREAKEVEN',           0.89, 0.93, 4.45, 5, 67, 69, 70, 7.5, '5m',    'live',  +0.15),
    (16, 'BTC',    'NO',  'MODEL_SLIP',          0.75, 0.71, 4.50, 6, 71, 73, 52, 7.5, '1m39s', 'live',  -0.41),
    (17, 'ETH',    'NO',  'BREAKEVEN',           0.81, 0.92, 4.05, 5, 81, 66, 66, 4.3, '1m48s', 'live',  +0.47),
    (18, 'XRP',    'NO',  'MODEL_LATE_EXIT',     0.88, 0.82, 4.40, 5, 72, 70, 70, 5.5, '2m58s', 'live',  -0.39),
    (19, 'ETH',    'NO',  'TAKE_PROFIT',         0.74, 0.87, 4.44, 6, 75, 68, 68, 7.5, '1m42s', 'live',  +0.65),
    (20, 'ZEC',    'NO',  'TAKE_PROFIT',         0.88, 0.97, 4.40, 5, 72, 80, 74, 7.5, '2m43s', 'live',  +0.40),
    (21, 'BTC',    'YES', 'MODEL_RAPID_ADVERSE', 0.72, 0.62, 4.32, 6, 74, 74, 50, 5.0, '21s',   'live',  -0.78),
    (22, 'XRP',    'YES', 'MODEL_HARD_STOP',     0.72, 0.49, 4.32, 6, 72, 71, 71, 7.5, '43s',   'live',  -1.57),
    (23, 'ZEC',    'NO',  'TAKE_PROFIT',         0.83, 0.91, 0.83, 1, None,None,None,None,'',   'live',  +0.06),
    (24, 'XRP',    'NO',  'MODEL_RAPID_ADVERSE', 0.89, 0.46, 4.45, 5, 80, 69, 50, 7.5, '4m16s', 'live',  -2.27),
    (25, 'ZEC',    'NO',  'TAKE_PROFIT',         0.83, 0.85, 3.32, 4, 80, 80, 74, 7.5, '2m42s', 'live',  0.00),
    (26, 'XRP',    'NO',  'TAKE_PROFIT',         0.74, 0.89, 4.44, 6, 80, 70, 71, 5.1, '1m38s', 'live',  +0.78),
    (27, 'BTC',    'NO',  'MODEL_HARD_STOP',     0.75, 0.52, 4.50, 6, 82, 62, 62, 7.5, '1m5s',  'live',  -1.56),
    (28, 'XRP',    'NO',  'MODEL_HARD_STOP',     0.90, 0.68, 4.50, 5, 78, 71, 71, 7.5, '53s',   'live',  -1.21),
    (29, 'BNB',    'NO',  'TAKE_PROFIT',         0.74, 0.78, 4.44, 6, 60, 63, 63, 7.5, '2m1s',  'live',  +0.09),
    (30, 'ZEC',    'YES', 'TAKE_PROFIT',         0.90, 0.97, 4.50, 5, 72, 77, 77, 7.5, '2m35s', 'live',  +0.31),
    (31, 'NATGAS', 'NO',  'BREAKEVEN',           0.81, 0.95, 0.81, 1, 63, 69, 99, 5.8, '',      'live',  +0.12),
    (32, 'XRP',    'YES', 'TAKE_PROFIT',         0.84, 0.94, 4.20, 5, 73, 71, 64, 6.2, '',      'live',  +0.43),
    (33, 'BNB',    'YES', 'MODEL_HARD_STOP',     0.73, 0.57, 4.38, 6, 64, 64, 63, 7.5, '51s',   'live',  -1.14),
    (34, 'BTC',    'YES', 'BREAKEVEN',           0.84, 0.95, 4.20, 5, 74, 75, 59, 7.5, '',      'live',  +0.48),
    (35, 'GOLD',   'YES', 'MODEL_HARD_STOP',     0.81, 0.71, 3.24, 4, 69, 70, 60, 6.6, '',      'live',  -0.50),
    (36, 'SILVER', 'YES', 'BREAKEVEN',           0.84, 0.94, 3.36, 4, 63, 81, 88, 5.8, '',      'live',  +0.34),
    (37, 'NATGAS', 'NO',  'TAKE_PROFIT',         0.71, 0.86, 0.71, 1, 69, 69, 69, 7.5, '',      'live',  +0.13),
    (38, 'XRP',    'NO',  'TAKE_PROFIT',         0.79, 0.91, 4.74, 6, 75, 70, 63, 7.4, '',      'live',  +0.62),
    (39, 'BTC',    'NO',  'MODEL_SLIP',          0.81, 0.80, 4.86, 6, 82, 74, 50, 5.7, '',      'live',  -0.19),
    (40, 'BNB',    'YES', 'TAKE_PROFIT',         0.73, 0.97, 4.38, 6, 62, 63, 59, 6.6, '',      'live',  +1.35),
    (41, 'GOLD',   'YES', 'TAKE_PROFIT',         0.79, 0.95, 3.16, 4, 63, 69, 69, 7.5, '',      'live',  +0.58),
    (42, 'BTC',    'NO',  'MODEL_STAGNATION',    0.90, 0.82, 4.50, 5, 82, 74, 50, 6.6, '',      'live',  -0.48),
    (43, 'XRP',    'NO',  'MODEL_HARD_STOP',     0.88, 0.48, 4.50, 5, 80, 69, 57, None,'',      'live',  -2.13),
    (44, 'NATGAS', 'NO',  'MODEL_HARD_STOP',     0.77, 0.58, 3.08, 4, 71, 62, 62, 3.2, '',      'live',  -0.88),
    (45, 'XRP',    'NO',  'TAKE_PROFIT',         0.90, 0.97, 4.50, 5, 62, 71, 71, 4.2, '',      'live',  +0.31),
    (46, 'SILVER', 'YES', 'TAKE_PROFIT',         0.82, 0.98, 3.28, 4, 63, 76, 76, 5.7, '',      'live',  +0.59),
    (47, 'XRP',    'NO',  'MODEL_HARD_STOP',     0.93, 0.79, 4.65, 5, 78, 72, 72, 7.5, '',      'live',  -0.78),
    (48, 'XRP',    'NO',  'TAKE_PROFIT',         0.74, 0.92, 4.44, 6, 75, 64, 63, 3.3, '',      'live',  +0.97),
    (49, 'GOLD',   'YES', 'MODEL_HARD_STOP',     0.89, 0.72, 2.67, 3, 63, 89, 61, 5.8, '',      'live',  -0.57),
    (50, 'ZEC',    'NO',  'TAKE_PROFIT',         0.62, 0.72, 3.72, 6, 80, 70, 72, 5.8, '',      'live',  +0.42),
]

def parse_hold(s):
    if not s or s == '':
        return None
    s = s.strip()
    if s == '5m':
        return 300
    m = re.match(r'(\d+)m(\d+)s', s)
    if m:
        return int(m.group(1))*60 + int(m.group(2))
    m = re.match(r'(\d+)s', s)
    if m:
        return int(m.group(1))
    return None

pnl_list = [t[14] for t in trades_raw]
total_pnl = sum(pnl_list)
wins = [p for p in pnl_list if p > 0]
losses = [p for p in pnl_list if p < 0]
breakevens = [p for p in pnl_list if p == 0]
win_rate = len(wins)/len(pnl_list)*100
avg_win = sum(wins)/len(wins)
avg_loss = sum(losses)/len(losses)
profit_factor = sum(wins)/abs(sum(losses))

print('='*60)
print('1. OVERALL STATS')
print('='*60)
print(f'Total Trades:  {len(trades_raw)}')
print(f'Total P&L:     ${total_pnl:.2f}')
print(f'Winners:       {len(wins)} | Losers: {len(losses)} | Breakeven: {len(breakevens)}')
print(f'Win Rate:      {win_rate:.1f}%  (breakeven counted as non-win)')
print(f'Avg Win:       +${avg_win:.2f}')
print(f'Avg Loss:      ${avg_loss:.2f}')
print(f'Profit Factor: {profit_factor:.2f}')

print()
print('='*60)
print('2. BY EXIT TYPE')
print('='*60)
exit_groups = defaultdict(list)
for t in trades_raw:
    exit_groups[t[3]].append(t[14])
for etype in ['TAKE_PROFIT','MODEL_HARD_STOP','MODEL_RAPID_ADVERSE','MODEL_LATE_EXIT','MODEL_SLIP','MODEL_STAGNATION','BREAKEVEN']:
    ps = exit_groups[etype]
    tot = sum(ps)
    ws = [p for p in ps if p > 0]
    ls = [p for p in ps if p < 0]
    wr = len(ws)/len(ps)*100 if ps else 0
    avg_l = sum(ls)/len(ls) if ls else 0
    print(f'{etype}: n={len(ps)}, total={tot:+.2f}, win_rate={wr:.0f}%, avg_loss={avg_l:.2f}')

print()
print('='*60)
print('3. BY ASSET')
print('='*60)
asset_groups = defaultdict(list)
for t in trades_raw:
    asset_groups[t[1]].append(t[14])
for sym in ['BTC','ETH','SOL','XRP','BNB','ZEC','GOLD','SILVER','NATGAS']:
    ps = asset_groups[sym]
    tot = sum(ps)
    ws = [p for p in ps if p > 0]
    wr = len(ws)/len(ps)*100
    print(f'{sym}: n={len(ps)}, total={tot:+.2f}, win_rate={wr:.0f}%')

print()
print('='*60)
print('4. BY SIDE')
print('='*60)
side_groups = defaultdict(list)
for t in trades_raw:
    side_groups[t[2]].append(t[14])
for side in ['YES','NO']:
    ps = side_groups[side]
    tot = sum(ps)
    ws = [p for p in ps if p > 0]
    wr = len(ws)/len(ps)*100
    print(f'{side}: n={len(ps)}, total={tot:+.2f}, win_rate={wr:.0f}%')

print()
print('='*60)
print('5. ENTRY PRICE ANALYSIS')
print('='*60)
winner_entries = [t[4] for t in trades_raw if t[14] > 0]
loser_entries  = [t[4] for t in trades_raw if t[14] < 0]
print(f'Avg entry price - Winners: {sum(winner_entries)/len(winner_entries)*100:.1f}c')
print(f'Avg entry price - Losers:  {sum(loser_entries)/len(loser_entries)*100:.1f}c')
print(f'Winners entry range: {min(winner_entries)*100:.0f}c - {max(winner_entries)*100:.0f}c')
print(f'Losers  entry range: {min(loser_entries)*100:.0f}c - {max(loser_entries)*100:.0f}c')
high_entry_losers = [t for t in trades_raw if t[14] < 0 and t[4] >= 0.85]
print(f'High-entry (>=85c) losers: {len(high_entry_losers)}, total pnl={sum(t[14] for t in high_entry_losers):+.2f}')

print()
print('='*60)
print('6. CONFIDENCE ANALYSIS')
print('='*60)
buckets = [('<65', 0, 65), ('65-70', 65, 70), ('70-75', 70, 75), ('75-80', 75, 80), ('80+', 80, 101)]
for label, lo, hi in buckets:
    ts = [t for t in trades_raw if t[8] is not None and lo <= t[8] < hi]
    ps = [t[14] for t in ts]
    ws = [p for p in ps if p > 0]
    ls = [p for p in ps if p < 0]
    wr = len(ws)/len(ps)*100 if ps else 0
    tot = sum(ps)
    aw = sum(ws)/len(ws) if ws else 0
    al = sum(ls)/len(ls) if ls else 0
    print(f'Conf {label}%: n={len(ts)}, win_rate={wr:.0f}%, total_pnl={tot:+.2f}, avg_win={aw:+.2f}, avg_loss={al:.2f}')

print()
print('='*60)
print('7. LEAN ANALYSIS')
print('='*60)
hard_stops = [t for t in trades_raw if t[3]=='MODEL_HARD_STOP' and t[9] is not None]
winners_lean = [t for t in trades_raw if t[14]>0 and t[9] is not None]
all_losers_lean = [t for t in trades_raw if t[14]<0 and t[9] is not None]
print(f'Hard Stops - avg starting lean: {sum(t[9] for t in hard_stops)/len(hard_stops):.1f}%')
print(f'Winners    - avg starting lean: {sum(t[9] for t in winners_lean)/len(winners_lean):.1f}%')
print(f'All Losers - avg starting lean: {sum(t[9] for t in all_losers_lean)/len(all_losers_lean):.1f}%')
print()
print('Hard Stop lean detail (start lean -> end lean):')
for t in hard_stops:
    print(f'  #{t[0]:2d} {t[1]:<7} {t[2]}: lean {t[9]:3d}%->  {t[10]:3d}%  pnl={t[14]:+.2f}')
lean_held = [t for t in hard_stops if t[10] is not None and abs(t[9]-t[10]) <= 2]
lean_collapsed = [t for t in hard_stops if t[10] is not None and t[9]-t[10] > 10]
print(f'\nHard stops where lean HELD (within 2pts): n={len(lean_held)}, total={sum(t[14] for t in lean_held):+.2f}')
print(f'Hard stops where lean COLLAPSED (>10pts drop): n={len(lean_collapsed)}, total={sum(t[14] for t in lean_collapsed):+.2f}')

print()
print('='*60)
print('8. FAST LOSERS (hold < 60s)')
print('='*60)
fast_losers = []
for t in trades_raw:
    hold_s = parse_hold(t[12])
    if hold_s is not None and hold_s < 60 and t[14] < 0:
        fast_losers.append((t, hold_s))
        print(f'  #{t[0]:2d} {t[1]:<7} {t[2]} {t[3]}: {t[12]} ({hold_s}s), entry={t[4]*100:.0f}c->exit={t[5]*100:.0f}c, pnl={t[14]:+.2f}')
print(f'Total fast losers (<60s): {len(fast_losers)}, total pnl={sum(t[0][14] for t in fast_losers):+.2f}')

print()
print('='*60)
print('9. LOSS DRIVER DEEP DIVE')
print('='*60)
all_hard_stops = [t for t in trades_raw if t[3]=='MODEL_HARD_STOP']
print(f'MODEL_HARD_STOP total: n={len(all_hard_stops)}, pnl={sum(t[14] for t in all_hard_stops):+.2f}')
print()
xrp_trades = [t for t in trades_raw if t[1]=='XRP']
xrp_hs = [t for t in xrp_trades if t[3]=='MODEL_HARD_STOP']
xrp_wins = [t for t in xrp_trades if t[14]>0]
print(f'XRP total: n={len(xrp_trades)}, pnl={sum(t[14] for t in xrp_trades):+.2f}')
print(f'XRP HARD_STOPs: n={len(xrp_hs)}, pnl={sum(t[14] for t in xrp_hs):+.2f}')
print()
# High entry hard stops
hi_entry_hs = [t for t in all_hard_stops if t[4]>=0.85]
print(f'HARD_STOP with entry >=85c: n={len(hi_entry_hs)}, total={sum(t[14] for t in hi_entry_hs):+.2f}')
for t in hi_entry_hs:
    print(f'  #{t[0]:2d} {t[1]:<7}: entry={t[4]*100:.0f}c->exit={t[5]*100:.0f}c  drop={abs(t[4]-t[5])*100:.0f}c  pnl={t[14]:+.2f}')
print()
# Rapid adverse
ra = [t for t in trades_raw if t[3]=='MODEL_RAPID_ADVERSE']
print(f'MODEL_RAPID_ADVERSE: n={len(ra)}, pnl={sum(t[14] for t in ra):+.2f}')
for t in ra:
    print(f'  #{t[0]:2d} {t[1]:<7}: entry={t[4]*100:.0f}c->exit={t[5]*100:.0f}c  lean_drop={t[9]-t[10] if t[9] and t[10] else "N/A"}pts  pnl={t[14]:+.2f}')
print()
# summary of all losses
print('All losses ranked by severity:')
all_losses = [(t[14], t) for t in trades_raw if t[14]<0]
all_losses.sort()
for p, t in all_losses:
    print(f'  #{t[0]:2d} {t[1]:<7} {t[2]} {t[3]}: pnl={p:+.2f}')
