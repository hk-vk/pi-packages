import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { buildPalette } from './palette.mjs';
export async function installThemes(directory, workspaceTheme, tokens, workspaceId) {
 await mkdir(directory,{recursive:true});
 const result={};
 for(const mode of ['light','dark']) {
  const palette=buildPalette(mode,workspaceTheme,tokens);
  // A global pair races when several Pi terminals belong to different
  // workspaces. Keep each workspace's saved files separate and deterministic.
  const suffix=workspaceId ? '-'+createHash('sha256').update(workspaceId).digest('hex').slice(0,12) : '';
  const name=`super-workspace${suffix}-${mode}`,path=join(directory,`${name}.json`);
  const doc={$schema:'https://pi.dev/schemas/theme.schema.json',name,appearance:mode,colors:palette.colors,export:{pageBg:palette.page,cardBg:palette.colors.userMessageBg,infoBg:palette.colors.customMessageBg}};
  const data=JSON.stringify(doc,null,2)+'\n';
  let previous;try{previous=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous!==data) {
   const temp=path+`.${process.pid}.${randomUUID()}.tmp`;
   try{await writeFile(temp,data,{mode:0o600});await rename(temp,path);}finally{await unlink(temp).catch(()=>{});}
  }
  result[mode]={name,path,colors:palette.colors};
 }
 return result;
}
