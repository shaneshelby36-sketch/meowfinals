'use strict';
const trades = [
  { sym:'GOLD',   side:'NO',  exit:'BREAKEVEN',        entry:64, close:64, pnl:0.00,  conf:71, leanIn:91, leanOut:90, hi:80, lo:63  },
  { sym:'GOLD',   side:'NO',  exit:'MODEL_AGAINST',    entry:70, close:27, pnl:-1.72, conf:71, leanIn:91, leanOut:87, hi:78, lo:27  },
  { sym:'GOLD',   side:'NO',  exit:'MODEL_AGAINST',    entry:58, close:30, pnl:-1.40, conf:74, leanIn:99, leanOut:93, hi:70, lo:30  },
  { sym:'GOLD',   side:'YES', exit:'BREAKEVEN',        entry:63, close:63, pnl:0.00,  conf:69, leanIn:75, leanOut:55, hi:88, lo:51  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:57, close:13, pnl:-0.44, conf:71, leanIn:74, leanOut:73, hi:56, lo:13  },
  { sym:'SILVER', side:'NO',  exit:'BREAKEVEN',        entry:60, close:60, pnl:0.00,  conf:77, leanIn:74, leanOut:74, hi:94, lo:59  },
  { sym:'GOLD',   side:'NO',  exit:'BREAKEVEN',        entry:65, close:65, pnl:0.00,  conf:77, leanIn:76, leanOut:75, hi:91, lo:64  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:63, close:7,  pnl:-0.59, conf:71, leanIn:78, leanOut:80, hi:82, lo:62  },
  { sym:'OIL',    side:'NO',  exit:'BREAKEVEN',        entry:68, close:68, pnl:0.00,  conf:71, leanIn:74, leanOut:77, hi:94, lo:64  },
  { sym:'SILVER', side:'YES', exit:'BREAKEVEN',        entry:61, close:61, pnl:0.00,  conf:71, leanIn:78, leanOut:78, hi:67, lo:57  },
  { sym:'OIL',    side:'NO',  exit:'BREAKEVEN',        entry:58, close:58, pnl:0.00,  conf:71, leanIn:74, leanOut:74, hi:75, lo:54  },
  { sym:'OIL',    side:'YES', exit:'BREAKEVEN',        entry:70, close:70, pnl:0.00,  conf:71, leanIn:76, leanOut:78, hi:95, lo:69  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_AGAINST',    entry:69, close:20, pnl:-0.52, conf:71, leanIn:80, leanOut:82, hi:69, lo:24  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_AGAINST',    entry:62, close:22, pnl:-1.29, conf:82, leanIn:81, leanOut:80, hi:69, lo:25  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:68, close:61, pnl:-0.20, conf:71, leanIn:78, leanOut:80, hi:73, lo:50  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_LATE_EXIT',  entry:60, close:42, pnl:-0.86, conf:71, leanIn:84, leanOut:83, hi:59, lo:39  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:68, close:27, pnl:-0.44, conf:82, leanIn:null,leanOut:null,hi:null,lo:null },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:68, close:26, pnl:-1.34, conf:82, leanIn:77, leanOut:78, hi:67, lo:28  },
  { sym:'GOLD',   side:'NO',  exit:'MODEL_AGAINST',    entry:65, close:74, pnl:0.25,  conf:63, leanIn:86, leanOut:84, hi:95, lo:61  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:64, close:2,  pnl:-2.55, conf:63, leanIn:89, leanOut:91, hi:79, lo:18  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_AGAINST',    entry:59, close:69, pnl:0.35,  conf:74, leanIn:88, leanOut:86, hi:86, lo:49  },
  { sym:'OIL',    side:'YES', exit:'TAKE_PROFIT',      entry:63, close:97, pnl:1.28,  conf:74, leanIn:78, leanOut:81, hi:96, lo:59  },
  { sym:'GOLD',   side:'NO',  exit:'MODEL_AGAINST',    entry:61, close:23, pnl:-1.64, conf:74, leanIn:77, leanOut:84, hi:77, lo:27  },
  { sym:'GOLD',   side:'NO',  exit:'TAKE_PROFIT',      entry:65, close:98, pnl:1.25,  conf:74, leanIn:75, leanOut:84, hi:97, lo:62  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:61, close:26, pnl:-0.38, conf:68, leanIn:77, leanOut:80, hi:72, lo:25  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_AGAINST',    entry:71, close:18, pnl:-0.55, conf:63, leanIn:93, leanOut:93, hi:76, lo:17  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:64, close:22, pnl:-1.79, conf:67, leanIn:91, leanOut:94, hi:78, lo:33  },
  { sym:'GOLD',   side:'NO',  exit:'MODEL_AGAINST',    entry:60, close:64, pnl:0.03,  conf:71, leanIn:87, leanOut:79, hi:83, lo:59  },
  { sym:'OIL',    side:'YES', exit:'TAKE_PROFIT',      entry:58, close:98, pnl:1.90,  conf:74, leanIn:90, leanOut:92, hi:97, lo:57  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:59, close:15, pnl:-2.32, conf:69, leanIn:87, leanOut:87, hi:57, lo:18  },
  { sym:'OIL',    side:'YES', exit:'TAKE_PROFIT',      entry:61, close:98, pnl:1.40,  conf:74, leanIn:80, leanOut:87, hi:97, lo:50  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:65, close:69, pnl:0.04,  conf:74, leanIn:82, leanOut:84, hi:89, lo:56  },
  { sym:'OIL',    side:'YES', exit:'TAKE_PROFIT',      entry:62, close:96, pnl:1.28,  conf:77, leanIn:81, leanOut:85, hi:97, lo:58  },
  { sym:'SILVER', side:'YES', exit:'TAKE_PROFIT',      entry:61, close:95, pnl:1.28,  conf:74, leanIn:83, leanOut:89, hi:96, lo:45  },
  { sym:'SILVER', side:'YES', exit:'TAKE_PROFIT',      entry:71, close:96, pnl:0.46,  conf:63, leanIn:78, leanOut:80, hi:98, lo:68  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:57, close:62, pnl:0.05,  conf:63, leanIn:76, leanOut:79, hi:80, lo:56  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_AGAINST',    entry:66, close:43, pnl:-0.52, conf:77, leanIn:75, leanOut:78, hi:77, lo:41  },
  { sym:'OIL',    side:'NO',  exit:'MODEL_AGAINST',    entry:61, close:37, pnl:-0.82, conf:63, leanIn:86, leanOut:86, hi:61, lo:37  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:59, close:46, pnl:-0.49, conf:82, leanIn:80, leanOut:81, hi:83, lo:45  },
  { sym:'GOLD',   side:'YES', exit:'MODEL_AGAINST',    entry:51, close:22, pnl:-0.96, conf:77, leanIn:77, leanOut:76, hi:58, lo:21  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:51, close:66, pnl:0.35,  conf:71, leanIn:76, leanOut:79, hi:83, lo:45  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:70, close:47, pnl:-0.52, conf:77, leanIn:75, leanOut:77, hi:72, lo:40  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:62, close:84, pnl:0.58,  conf:71, leanIn:74, leanOut:76, hi:92, lo:61  },
  { sym:'SILVER', side:'YES', exit:'MODEL_AGAINST',    entry:68, close:75, pnl:0.08,  conf:71, leanIn:75, leanOut:68, hi:89, lo:67  },
  { sym:'GOLD',   side:'NO',  exit:'MODEL_AGAINST',    entry:65, close:47, pnl:-0.22, conf:74, leanIn:76, leanOut:76, hi:65, lo:49  },
  { sym:'OIL',    side:'YES', exit:'MODEL_AGAINST',    entry:61, close:42, pnl:-0.67, conf:77, leanIn:76, leanOut:87, hi:63, lo:44  },
  { sym:'OIL',    side:'NO',  exit:'MODEL_AGAINST',    entry:62, close:6,  pnl:-1.74, conf:63, leanIn:87, leanOut:86, hi:73, lo:25  },
  { sym:'OIL',    side:'NO',  exit:'MODEL_AGAINST',    entry:57, close:42, pnl:-0.55, conf:74, leanIn:81, leanOut:80, hi:55, lo:42  },
  { sym:'OIL',    side:'NO',  exit:'TAKE_PROFIT',      entry:70, close:97, pnl:0.50,  conf:77, leanIn:65, leanOut:70, hi:97, lo:66  },
  { sym:'SILVER', side:'NO',  exit:'MODEL_AGAINST',    entry:62, close:20, pnl:-1.34, conf:77, leanIn:69, leanOut:64, hi:67, lo:20  },
];

const wins  = trades.filter(t => t.pnl > 0);
const losses= trades.filter(t => t.pnl < 0);
const bes   = trades.filter(t => t.pnl === 0);
const totalPnl = trades.reduce((s,t)=>s+t.pnl,0);
const winPnl   = wins.reduce((s,t)=>s+t.pnl,0);
const lossPnl  = losses.reduce((s,t)=>s+t.pnl,0);
const wr = wins.length/(wins.length+losses.length);
const avgWin  = winPnl/wins.length;
const avgLoss = lossPnl/losses.length;

console.log('=== CORE STATS ===');
console.log('Total trades:', trades.length, ' Wins:', wins.length, ' Losses:', losses.length, ' BEs:', bes.length);
console.log('Win rate (excl BE):', (wr*100).toFixed(1)+'%');
console.log('Win rate (incl BE):', ((wins.length/trades.length)*100).toFixed(1)+'%');
console.log('Total PnL:', totalPnl.toFixed(2));
console.log('Total win:', winPnl.toFixed(2), ' Total loss:', lossPnl.toFixed(2));
console.log('Avg win:', avgWin.toFixed(2), ' Avg loss:', avgLoss.toFixed(2));
console.log('R ratio (avgWin/|avgLoss|):', (avgWin/Math.abs(avgLoss)).toFixed(3));
const breakEvenWR = Math.abs(avgLoss)/(avgWin+Math.abs(avgLoss));
console.log('Break-even WR needed:', (breakEvenWR*100).toFixed(1)+'%', '(you need to win this % just to be flat)');

console.log('\n=== BY SYMBOL ===');
for (const s of ['GOLD','SILVER','OIL']) {
  const st=trades.filter(t=>t.sym===s);
  const sw=st.filter(t=>t.pnl>0), sl=st.filter(t=>t.pnl<0), sb=st.filter(t=>t.pnl===0);
  const sp=st.reduce((a,t)=>a+t.pnl,0);
  const swr=sw.length/(sw.length+sl.length);
  console.log(s+': '+st.length+' trades  W/L/BE: '+sw.length+'/'+sl.length+'/'+sb.length+
    '  WR: '+(swr*100).toFixed(1)+'%  PnL: '+sp.toFixed(2));
}

console.log('\n=== BY EXIT TYPE ===');
for (const e of ['TAKE_PROFIT','BREAKEVEN','MODEL_AGAINST','MODEL_LATE_EXIT']) {
  const et=trades.filter(t=>t.exit===e);
  if(!et.length) continue;
  const ew=et.filter(t=>t.pnl>0),el=et.filter(t=>t.pnl<0),eb=et.filter(t=>t.pnl===0);
  const ep=et.reduce((a,t)=>a+t.pnl,0);
  console.log(e+': '+et.length+' trades  W/L/BE: '+ew.length+'/'+el.length+'/'+eb.length+
    '  PnL: '+ep.toFixed(2)+'  AvgPnL: '+(ep/et.length).toFixed(2));
}

console.log('\n=== MODEL_AGAINST DEEP DIVE ===');
const ma=trades.filter(t=>t.exit==='MODEL_AGAINST');
const maW=ma.filter(t=>t.pnl>0),maL=ma.filter(t=>t.pnl<0);
console.log('Total MODEL_AGAINST:', ma.length, ' Green exits:', maW.length, ' Red exits:', maL.length);
console.log('Avg drop (red MA exits) entry->close:', (maL.reduce((a,t)=>a+(t.entry-t.close),0)/maL.length).toFixed(1)+'c');
console.log('Biggest MA losses:');
ma.filter(t=>t.pnl<-0.80).sort((a,b)=>a.pnl-b.pnl)
  .forEach(t=>console.log('  '+t.sym+' '+t.side+' entry:'+t.entry+'c close:'+t.close+'c lean:'+t.leanIn+'->'+t.leanOut+'% hi:'+t.hi+'c pnl:'+t.pnl));

console.log('\n=== PEAK WASTE (hi>=80c, pnl<=0) ===');
const pw=trades.filter(t=>t.hi&&t.hi>=80&&t.pnl<=0);
console.log('Count:', pw.length);
pw.forEach(t=>console.log('  '+t.sym+' '+t.side+' entry:'+t.entry+'c hi:'+t.hi+'c pnl:$'+t.pnl+' exit:'+t.exit));
const peakWastedPnlIfTp = pw.reduce((a,t)=>{
  const potentialGreen = t.hi - t.entry;
  return a + (potentialGreen > 0 ? potentialGreen * 0.01 : 0);
},0);
console.log('Approx dollars left on table (hi-entry * 1 contract est):', peakWastedPnlIfTp.toFixed(2));

console.log('\n=== LEAN AT ENTRY vs OUTCOME ===');
for (const g of [{min:60,max:74,lbl:'Soft 60-74%'},{min:75,max:84,lbl:'Firm 75-84%'},{min:85,max:100,lbl:'Strong 85%+'}]) {
  const gt=trades.filter(t=>t.leanIn&&t.leanIn>=g.min&&t.leanIn<=g.max);
  const gw=gt.filter(t=>t.pnl>0),gl=gt.filter(t=>t.pnl<0),gb=gt.filter(t=>t.pnl===0);
  const gp=gt.reduce((a,t)=>a+t.pnl,0);
  if(!gt.length) continue;
  console.log(g.lbl+': '+gt.length+' trades  W/L/BE: '+gw.length+'/'+gl.length+'/'+gb.length+
    '  PnL: '+gp.toFixed(2)+'  WR: '+((gw.length/(gw.length+gl.length||1))*100).toFixed(1)+'%');
}

console.log('\n=== CONF vs OUTCOME ===');
for (const g of [{min:60,max:69,lbl:'Conf 60-69%'},{min:70,max:74,lbl:'Conf 70-74%'},{min:75,max:82,lbl:'Conf 75-82%'}]) {
  const gt=trades.filter(t=>t.conf>=g.min&&t.conf<=g.max);
  const gw=gt.filter(t=>t.pnl>0),gl=gt.filter(t=>t.pnl<0),gb=gt.filter(t=>t.pnl===0);
  const gp=gt.reduce((a,t)=>a+t.pnl,0);
  console.log(g.lbl+': '+gt.length+' trades  W/L/BE: '+gw.length+'/'+gl.length+'/'+gb.length+
    '  PnL: '+gp.toFixed(2)+'  WR: '+((gw.length/(gw.length+gl.length||1))*100).toFixed(1)+'%');
}

console.log('\n=== FAST WIPES (close <= 30c) ===');
const fw=trades.filter(t=>t.close<=30&&t.pnl<0);
console.log('Count:', fw.length, 'of', losses.length, 'losses ('+((fw.length/losses.length)*100).toFixed(0)+'% of all losses)');
fw.forEach(t=>console.log('  '+t.sym+' '+t.side+' entry:'+t.entry+'c close:'+t.close+'c lean:'+t.leanIn+'% conf:'+t.conf+'%'));
const fwPnl=fw.reduce((a,t)=>a+t.pnl,0);
console.log('Fast wipe total loss:', fwPnl.toFixed(2));
console.log('Rest of losses:', (lossPnl-fwPnl).toFixed(2));
