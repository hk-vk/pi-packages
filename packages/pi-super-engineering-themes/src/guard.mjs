// Repair unexpected Pi theme resets using the already constructed palette.
// This path must not query sc, write files, persist settings, or redraw when
// the expected theme is already active. Focus events are opportunistic: not
// every embedded terminal reports them, so use a small in-process fallback.
export function startThemeGuard({ matches, restore, onInput, schedule = cb => {
 const timer=setInterval(cb,100);timer.unref();return ()=>clearInterval(timer);
} }) {
 let closed=false;
 function repair() {
  if(closed || matches())return;
  restore();
 }
 const stopTimer=schedule(repair);
 const stopInput=onInput?.(data=>{
  if(data.includes('\x1b[I'))repair();
  return undefined; // Never eat or modify keyboard/focus input.
 });
 return {repair,stop(){if(closed)return;closed=true;stopTimer();stopInput?.();}};
}
