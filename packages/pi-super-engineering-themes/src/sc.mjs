import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
export function scClient({ env=process.env, cwd=process.cwd(), signal }={}) {
 const socket=env.SUPER_ENGINEERING_LOCAL_API_SOCKET || env.SUPERCONDUCTOR_LOCAL_API_SOCKET;
 return args => new Promise((resolve,reject) => {
  execFile('sc', [...(socket?['--socket',socket]:[]),...args], {env,cwd,signal,timeout:2500,maxBuffer:2*1024*1024}, (error,stdout) => {
   if(error)return reject(error);
   try{ const data=JSON.parse(stdout);resolve(data.response ?? data); }catch(error){reject(error);}
  });
 });
}
export async function verifyCaller(sc) {
 const result=await sc(['layout','state','--self','--output','json']);
 return result.targets?.some(t=>t.ok===true && t.managed===true && t.provider_key==='pi') === true;
}
// Resolve the terminal's launch worktree, not the globally selected workspace.
// Hidden terminals must not repaint themselves with another workspace's theme.
export async function sessionWorkspace(sc, cwd) {
 const data=await sc(['workspace','list','--json']);
 const canonical=async value=>{try{return await realpath(value);}catch{return resolve(value);}};
 const target=await canonical(cwd);
 const candidates=[];
 async function visit(value, workspaceId) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string' && isAbsolute(value.path)) {
   const path=await canonical(value.path), rel=relative(path,target);
   if (rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel))) candidates.push({id:workspaceId,length:path.length});
  }
  for(const child of Object.values(value)) {
   if (Array.isArray(child)) {for(const item of child) await visit(item,workspaceId);}
   else if(child && typeof child==='object') await visit(child,workspaceId);
  }
 }
 for(const workspace of data.workspaces ?? []) await visit(workspace,workspace.id);
 candidates.sort((a,b)=>b.length-a.length);
 const matches=new Set(candidates.filter(x=>x.length===candidates[0]?.length).map(x=>x.id));
 if(matches.size!==1)throw new Error('Cannot uniquely identify this terminal workspace');
 const id=[...matches][0];
 return workspaceById(sc,id);
}

export async function workspaceById(sc,id) {
 const detail=await sc(['workspace','get',id,'--json']);
 if(detail.workspace?.id!==id)throw new Error('Workspace identity mismatch');
 return detail.workspace;
}

export async function activeWorkspace(sc) {
 const data=await sc(['workspace','list','--json']);
 const id=data.active_workspace_id;
 if(!id || !data.workspaces?.some(w=>w.id===id))throw new Error('No active workspace');
 const detail=await sc(['workspace','get',id,'--json']);
 if(detail.workspace?.id!==id)throw new Error('Workspace identity mismatch');
 return detail.workspace;
}
