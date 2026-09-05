import { APP_VERSION } from '../version.js';
function stable(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  const keys=Object.keys(value).sort();
  return `{${keys.map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

async function sha256Text(text){
  const data=new TextEncoder().encode(String(text));
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function sha256Bytes(bytes){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export class CacheGraphEngine {
  constructor(){this.reset();}
  reset(file=null){this.file=file;this.sourceKeyPromise=null;this.nodes=new Map();this.active=[];}
  async sourceKey(){
    if(this.sourceKeyPromise)return this.sourceKeyPromise;
    this.sourceKeyPromise=(async()=>{
      if(!this.file)return 'source:none';
      const slice=1024*1024, size=Number(this.file.size||0);
      const head=await this.file.slice(0,Math.min(slice,size)).arrayBuffer();
      const tail=await this.file.slice(Math.max(0,size-slice),size).arrayBuffer();
      const headHash=await sha256Bytes(head),tailHash=await sha256Bytes(tail);
      return sha256Text(stable({name:this.file.name||'',size,lastModified:Number(this.file.lastModified||0),type:this.file.type||'',headHash,tailHash}));
    })();
    return this.sourceKeyPromise;
  }
  async keyFor({parentKey,stageId,engineVersion=APP_VERSION,modelSHA256=null,settings=null,metadata=null,algorithmVersion='1'}){
    return sha256Text(stable({parentKey,stageId,engineVersion,modelSHA256:modelSHA256||'unversioned',settings,metadata,algorithmVersion}));
  }
  remember(node){if(node?.nodeKey)this.nodes.set(node.nodeKey,node);}
  get(nodeKey){return this.nodes.get(nodeKey)||null;}
  activate(node){this.remember(node);this.active.push(node.nodeKey);}
  rewind(index){if(index<0)return[];return this.active.splice(index);}
  undo(){return this.active.pop()||null;}
  currentKey(){return this.active.at(-1)||null;}
  snapshot(){return{active:[...this.active],nodes:this.nodes.size};}
}

export {stable as stableCacheStringify,sha256Text};
