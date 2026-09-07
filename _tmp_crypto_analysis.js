'use strict';
const trades = [
  { sym:'BTC', side:'YES', exit:'MODEL_STAGNATION', entry:82, close:59, pnl:-0.77, conf:82, leanIn:69, leanOut:50, hi:84, lo:63, mode:'live' },
  { sym:'ETH', side:'YES', exit:'MODEL_AGAINST',    entry:83, close:70, pnl:-0.46, conf:86, leanIn:66, leanOut:50, hi:86, lo:83, mode:'live' },
  { sym:'BNB', side:'NO',  exit:'MODEL_AGAINST',    entry:63, close:42, pnl:-1.46, conf:70, leanIn:75, leanOut:74, hi:68, lo:35, mode:'live' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:75, close:89, pnl:+0.48, conf:80, leanIn:74, leanOut:75, hi:78, lo:66, mode:'live' },
  { sym:'BTC', side:'YES', exit:'MODEL_AGAINST',    entry:86, close:65, pnl:-1.17, conf:82, leanIn:79, leanOut:51, hi:84, lo:64, mode:'live' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:80, close:91, pnl:+0.56, conf:77, leanIn:77, leanOut:77, hi:84, lo:80, mode:'live' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:84, close:78, pnl:-0.41, conf:81, leanIn:74, leanOut:74, hi:82, lo:73, mode:'live' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:77, close:86, pnl:+0.42, conf:80, leanIn:77, leanOut:77, hi:80, lo:71, mode:'live' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:80, close:84, pnl:+0.11, conf:76, leanIn:79, leanOut:79, hi:86, lo:79, mode:'live' },
  { sym:'ETH', side:'YES', exit:'MODEL_AGAINST',    entry:79, close:76, pnl:-0.33, conf:86, leanIn:71, leanOut:67, hi:79, lo:75, mode:'live' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:70, close:92, pnl:+1.40, conf:72, leanIn:81, leanOut:81, hi:93, lo:68, mode:'live' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:63, close:76, pnl:+0.60, conf:76, leanIn:79, leanOut:79, hi:77, lo:65, mode:'live' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:76, close:85, pnl:+0.41, conf:74, leanIn:76, leanOut:77, hi:81, lo:74, mode:'live' },
  { sym:'BTC', side:'NO',  exit:'MODEL_AGAINST',    entry:73, close:69, pnl:-0.41, conf:76, leanIn:78, leanOut:78, hi:77, lo:68, mode:'live' },
  { sym:'BNB', side:'NO',  exit:'MODEL_AGAINST',    entry:84, close:73, pnl:-0.67, conf:86, leanIn:77, leanOut:75, hi:83, lo:75, mode:'live' },
  { sym:'BTC', side:'NO',  exit:'TAKE_PROFIT',      entry:72, close:80, pnl:+0.33, conf:82, leanIn:77, leanOut:62, hi:77, lo:65, mode:'live' },
  { sym:'BNB', side:'NO',  exit:'MODEL_AGAINST',    entry:64, close:49, pnl:-1.11, conf:70, leanIn:78, leanOut:77, hi:67, lo:46, mode:'live' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:75, close:81, pnl:+0.22, conf:77, leanIn:78, leanOut:79, hi:80, lo:69, mode:'live' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:64, close:74, pnl:+0.42, conf:76, leanIn:79, leanOut:78, hi:73, lo:72, mode:'live' },
  { sym:'ETH', side:'YES', exit:'MODEL_AGAINST',    entry:75, close:71, pnl:-0.41, conf:73, leanIn:70, leanOut:67, hi:74, lo:69, mode:'live' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:81, close:64, pnl:-1.18, conf:72, leanIn:73, leanOut:67, hi:80, lo:57, mode:'live' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:82, close:93, pnl:+0.66, conf:80, leanIn:76, leanOut:77, hi:93, lo:81, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:78, close:92, pnl:+0.84, conf:81, leanIn:73, leanOut:76, hi:92, lo:77, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:80, close:83, pnl:+0.18, conf:82, leanIn:76, leanOut:76, hi:83, lo:74, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:84, close:87, pnl:+0.15, conf:86, leanIn:79, leanOut:79, hi:87, lo:82, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:78, close:77, pnl:-0.06, conf:72, leanIn:77, leanOut:79, hi:77, lo:71, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'MODEL_AGAINST',    entry:75, close:27, pnl:-2.88, conf:77, leanIn:80, leanOut:66, hi:77, lo:27, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:77, close:81, pnl:+0.24, conf:72, leanIn:70, leanOut:70, hi:81, lo:74, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:84, close:90, pnl:+0.30, conf:78, leanIn:75, leanOut:75, hi:90, lo:83, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:71, close:65, pnl:-0.42, conf:80, leanIn:74, leanOut:71, hi:65, lo:64, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:75, close:79, pnl:+0.24, conf:86, leanIn:77, leanOut:77, hi:79, lo:69, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:74, close:71, pnl:-0.18, conf:72, leanIn:73, leanOut:70, hi:73, lo:66, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:70, close:62, pnl:-0.56, conf:72, leanIn:74, leanOut:71, hi:65, lo:57, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'MODEL_AGAINST',    entry:74, close:66, pnl:-0.48, conf:78, leanIn:78, leanOut:76, hi:73, lo:66, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'BREAKEVEN',        entry:84, close:84, pnl:0.00,  conf:71, leanIn:78, leanOut:65, hi:86, lo:79, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:77, close:90, pnl:+0.78, conf:86, leanIn:71, leanOut:74, hi:90, lo:74, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:71, close:75, pnl:+0.28, conf:74, leanIn:75, leanOut:75, hi:75, lo:70, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:77, close:83, pnl:+0.36, conf:77, leanIn:76, leanOut:76, hi:83, lo:76, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:79, close:87, pnl:+0.48, conf:71, leanIn:77, leanOut:66, hi:87, lo:78, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'MODEL_AGAINST',    entry:84, close:80, pnl:-0.20, conf:82, leanIn:79, leanOut:79, hi:83, lo:78, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'MODEL_AGAINST',    entry:75, close:64, pnl:-0.66, conf:76, leanIn:80, leanOut:80, hi:74, lo:57, mode:'paper' },
  { sym:'BNB', side:'YES', exit:'TAKE_PROFIT',      entry:75, close:84, pnl:+0.54, conf:80, leanIn:79, leanOut:77, hi:84, lo:68, mode:'paper' },
  { sym:'BTC', side:'YES', exit:'TAKE_PROFIT',      entry:73, close:81, pnl:+0.48, conf:82, leanIn:78, leanOut:79, hi:81, lo:72, mode:'paper' },
  { sym:'BNB', side:'NO',  exit:'TAKE_PROFIT',      entry:79, close:82, pnl:+0.18, conf:86, leanIn:72, leanOut:72, hi:82, lo:77, mode:'paper' },
  { sym:'BNB', side:'NO',  exit:'TAKE_PROFIT',      entry:80, close:85, pnl:+0.30, conf:70, leanIn:75, leanOut:77, hi:85, lo:75, mode:'paper' },
  { sym:'BNB', side:'NO',  exit:'TAKE_PROFIT',      entry:72, close:77, pnl:+0.30, conf:72, leanIn:74, leanOut:75, hi:77, lo:68, mode:'paper' },
  { sym:'BTC', side:'NO',  exit:'MODEL_AGAINST',    entry:79, close:74, pnl:-0.30, conf:82, leanIn:77, leanOut:76, hi:78, lo:71, mode:'paper' },
];

const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),bes=trades.filter(t=>t.pnl===0);
const totalPnl=trades.reduce((s,t)=>s+t.pnl,0);
console.log('=== ALL CRYPTO ===');
console.log('Trades:',trades.length,'W/L/BE:'+wins.length+'/'+losses.length+'/'+bes.length,'WR:'+(wins.length/(wins.length+losses.length)*100).toFixed(1)+'%');
console.log('Total PnL: $'+totalPnl.toFixed(2),'  AvgW:$'+(wins.reduce((s,t)=>s+t.pnl,0)/wins.length).toFixed(2),'AvgL:$'+(losses.reduce((s,t)=>s+t.pnl,0)/losses.length).toFixed(2));

console.log('\n=== BY SYMBOL ===');
for(const s of['BTC','ETH','BNB']){
  const st=trades.filter(t=>t.sym===s);
  const sw=st.filter(t=>t.pnl>0),sl=st.filter(t=>t.pnl<0),sb=st.filter(t=>t.pnl===0);
  const sp=st.reduce((a,t)=>a+t.pnl,0);
  const aw=sw.length?sw.reduce((a,t)=>a+t.pnl,0)/sw.length:0;
  const al=sl.length?sl.reduce((a,t)=>a+t.pnl,0)/sl.length:0;
  console.log(s+': '+st.length+' W/L/BE:'+sw.length+'/'+sl.length+'/'+sb.length+' WR:'+(sw.length/(sw.length+sl.length)*100).toFixed(0)+'% PnL:$'+sp.toFixed(2)+' avgW:$'+aw.toFixed(2)+' avgL:$'+al.toFixed(2));
}

console.log('\n=== LEAN BUCKET ===');
for(const [lbl,min,max] of[['<70',0,69],['70-74',70,74],['75-79',75,79],['80+',80,99]]){
  const g=trades.filter(t=>t.leanIn>=min&&t.leanIn<=max);
  const gw=g.filter(t=>t.pnl>0),gl=g.filter(t=>t.pnl<0);
  const gp=g.reduce((a,t)=>a+t.pnl,0);
  console.log(lbl+'%: '+g.length+' W/L:'+gw.length+'/'+gl.length+' WR:'+(gw.length/(gw.length+gl.length||1)*100).toFixed(0)+'% PnL:$'+gp.toFixed(2));
}

console.log('\n=== CONF BUCKET ===');
for(const [lbl,min,max] of[['60-72',60,72],['73-79',73,79],['80+',80,99]]){
  const g=trades.filter(t=>t.conf>=min&&t.conf<=max);
  const gw=g.filter(t=>t.pnl>0),gl=g.filter(t=>t.pnl<0);
  const gp=g.reduce((a,t)=>a+t.pnl,0);
  console.log(lbl+'%: '+g.length+' W/L:'+gw.length+'/'+gl.length+' WR:'+(gw.length/(gw.length+gl.length||1)*100).toFixed(0)+'% PnL:$'+gp.toFixed(2));
}

console.log('\n=== ENTRY PRICE BUCKET ===');
for(const [lbl,min,max] of[['<70c',0,69],['70-75c',70,75],['76-82c',76,82],['83c+',83,99]]){
  const g=trades.filter(t=>t.entry>=min&&t.entry<=max);
  const gw=g.filter(t=>t.pnl>0),gl=g.filter(t=>t.pnl<0);
  const gp=g.reduce((a,t)=>a+t.pnl,0);
  console.log(lbl+': '+g.length+' W/L:'+gw.length+'/'+gl.length+' WR:'+(gw.length/(gw.length+gl.length||1)*100).toFixed(0)+'% PnL:$'+gp.toFixed(2));
}

console.log('\n=== HI NEVER CLEARED ENTRY (price went against from start) ===');
trades.filter(t=>t.hi<t.entry&&t.pnl<0).forEach(t=>console.log(t.sym,t.side,'entry:'+t.entry+'c hi:'+t.hi+'c lean:'+t.leanIn+'%->'+t.leanOut+'% pnl:$'+t.pnl,t.mode));

console.log('\n=== LOSSES DETAIL ===');
losses.sort((a,b)=>a.pnl-b.pnl).forEach(t=>{
  const hiVsEntry = t.hi>=t.entry ? '+'+( t.hi-t.entry)+'c ok' : '-'+(t.entry-t.hi)+'c NEVER';
  console.log(t.sym,t.side,t.exit.padEnd(20),'entry:'+t.entry+' lean:'+t.leanIn+'->'+t.leanOut+'% conf:'+t.conf+'% hi:'+hiVsEntry+' drop:'+(t.entry-t.close)+'c pnl:$'+t.pnl,t.mode);
});
