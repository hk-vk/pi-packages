// Pi exposes ctx.ui.theme through a stable proxy, not the underlying Theme.
// Compare rendered tokens, never identity, to avoid reapplying every poll.
export function themeMatches(active, expected, tokens) {
 if (!expected || active.name !== expected.name || active.appearance !== expected.appearance) return false;
 return tokens.every(key => backgroundTokens.includes(key)
  ? active.getBgAnsi(key) === expected.getBgAnsi(key)
  : active.getFgAnsi(key) === expected.getFgAnsi(key));
}
export const backgroundTokens = ['selectedBg','searchMatchBg','userMessageBg','customMessageBg','toolPendingBg','toolSuccessBg','toolErrorBg'];
export function rgb(hex) { return hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x,16)); }
export function hex(values) { return '#'+values.map(x => Math.round(x).toString(16).padStart(2,'0')).join(''); }
export function mix(a,b,t) { return hex(rgb(a).map((v,i) => v*(1-t)+rgb(b)[i]*t)); }
export function contrast(a,b) {
 const lum = c => rgb(c).map(v => {v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
 const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
export function readable(color, backgrounds, dark, minimum = 7) {
 const end=dark?'#ffffff':'#000000';
 for(let i=0;i<=100;i++){ const c=mix(color,end,i/100); if(backgrounds.every(bg=>contrast(c,bg)>=minimum))return c; }
 return end;
}
function hueColor(h,s=0.65,v=0.8) {
 const f=n=>{const k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1));};
 return hex([f(5),f(3),f(1)].map(x=>x*255));
}
export function buildPalette(mode, theme={}, tokens=[]) {
 const dark=mode==='dark', spec=theme[mode] || {};
 const chrome=spec.chrome || {}, accentSpec=spec.accent || chrome;
 const hue=Number.isFinite(accentSpec.hue)?((accentSpec.hue%360)+360)%360:220;
 const raw=hueColor(hue,Math.max(0,Math.min(1,accentSpec.saturation ?? 0.65)),Math.max(0,Math.min(1,accentSpec.brightness ?? 0.8)));
 const unit=(value,fallback)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
 const tint=hueColor(Number.isFinite(chrome.hue)?chrome.hue:hue,unit(chrome.saturation,0.65),unit(chrome.brightness,0.8));
 const chromeStrength=unit(chrome.intensity,0.15)*unit(chrome.alpha,1);
 const page=mix(dark?'#1e1e1e':'#ffffff',tint,chromeStrength*(dark?0.24:0.14));
 const panel=mix(page,tint,0.04+chromeStrength*0.14);
 const highlight=spec.highlight || {};
 const highlightRaw=hueColor(Number.isFinite(highlight.hue)?highlight.hue:hue,unit(highlight.saturation,0.65),unit(highlight.brightness,0.8));
 const prominence=unit(highlight.prominence,0.4);
 const accentStrength=unit(accentSpec.prominence,0.65);
 const accentRaw=mix(spec.accent_style==='harmonized'?mix(raw,tint,0.3):raw,dark?'#b8bcc8':'#525868',dark?0.18:0.32);
 // Keep status surfaces almost neutral; use semantic foreground colors for
 // success/error rather than large green/red washes behind long code output.
 const toolSurface=mix(mix(page,dark?'#ffffff':'#000000',dark?0.035:0.025),tint,chromeStrength*0.025);
 // Give user prompts a visibly separate, restrained surface. A faint chrome
 // wash alone disappears against Super's already tinted terminal background.
 const userSurface=mix(dark?'#343943':'#e1e4eb',tint,0.035+chromeStrength*0.025);
 const bg={selectedBg:mix(page,highlightRaw,0.08+prominence*0.10),searchMatchBg:mix(page,highlightRaw,0.10+prominence*0.10),userMessageBg:userSurface,customMessageBg:mix(panel,accentRaw,0.03+accentStrength*0.05),toolPendingBg:toolSurface,toolSuccessBg:toolSurface,toolErrorBg:toolSurface};
 // Extreme workspace tint settings must not make readable text impossible.
 for (const key of Object.keys(bg)) {
  for (let i=0; i<100 && contrast(bg[key],dark?'#ffffff':'#000000')<7.5; i++) {
   bg[key]=mix(bg[key],dark?'#000000':'#ffffff',0.05);
  }
 }
 const surfaces=[page,...Object.values(bg)];
 const safe=c=>readable(c,surfaces,dark);
 const text=safe(dark?'#e4e6eb':'#202124'),muted=safe(dark?'#b8bdc8':'#484c55');
 const accent=safe(mix(accentRaw,dark?'#d4d4d4':'#242424',(1-accentStrength)*0.3)),green=safe('#329367'),red=safe('#d74e4e'),yellow=safe('#c49a36'),blue=accent,purple=accent;
 const colors=Object.fromEntries(tokens.map(k=>[k,text]));
 Object.assign(colors,bg,{text,muted,dim:muted,accent,border:accent,borderAccent:accent,borderMuted:muted,success:green,error:red,warning:yellow,thinkingText:muted,userMessageText:text,customMessageText:text,customMessageLabel:accent,toolTitle:text,toolOutput:text,searchMatchText:text,scrollbarTrack:muted,scrollbarThumb:accent});
 for(const key of tokens) {
  if(key.startsWith('md')) colors[key]= /Heading|Code|ListBullet/.test(key)?accent:/Link/.test(key)?blue:muted;
  if(key.startsWith('syntax')) colors[key]= /Comment/.test(key)?muted:/Keyword|Type/.test(key)?purple:/String/.test(key)?green:/Number|Function/.test(key)?yellow:text;
  if(key.startsWith('thinking') && key!=='thinkingText') colors[key]=accent;
 }
 Object.assign(colors,{toolDiffAdded:green,toolDiffRemoved:red,toolDiffContext:muted,bashMode:green});
 return {colors,page,appearance:mode};
}
