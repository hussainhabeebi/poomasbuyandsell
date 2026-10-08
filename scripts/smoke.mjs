import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const port=8788,origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--var','ADMIN_EMAILS:qa-admin@example.test'],{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
let logs='';server.stdout.on('data',d=>{logs+=d});server.stderr.on('data',d=>{logs+=d});
try{
 await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error('Worker startup timed out')),25000);const check=setInterval(()=>{if(logs.includes(`Ready on ${origin}`)){clearTimeout(deadline);clearInterval(check);resolve()}},100);server.on('exit',code=>{clearTimeout(deadline);clearInterval(check);reject(new Error('Worker exited '+code))})});
 for(const path of ['/','/properties','/vehicles','/promote','/sell','/guides','/guides/used-vehicle-viewing-checklist','/privacy','/terms','/safety','/robots.txt','/sitemap.xml','/api/market','/images/dubai-building.jpg','/images/suv.jpg']){
 const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,path);const text=await response.text();if(['/','/properties','/vehicles','/promote'].includes(path)){assert.ok(text.includes('<h1'),path+' heading');assert.ok(text.includes('canonical'),path+' canonical')};if(path==='/')assert.ok(!text.includes('temporarily unavailable'));if(path==='/api/market')assert.equal(JSON.parse(text).listings.length,0);console.log('PASS',path);
 }
 for(const path of ['/api/market','/api/upload','/api/ai','/api/checkout']){let r;for(let attempt=0;attempt<3;attempt++){r=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});if(r.status!==503)break;const t=await r.text();if(!t.includes('restarted mid-request'))break;}assert.equal(r.status,401,path);console.log('PASS anonymous write blocked',path)}
 for(const path of ['/guides/nonexistent','/listing/nonexistent']){assert.equal((await fetch(origin+path,{signal:AbortSignal.timeout(10000)})).status,404);console.log('PASS 404',path)}
 console.log('21 HTTP checks passed');
 const users={seller:{'oai-authenticated-user-id':'qa-seller','oai-authenticated-user-email':'qa-seller@example.test'},buyer:{'oai-authenticated-user-id':'qa-buyer','oai-authenticated-user-email':'qa-buyer@example.test'},admin:{'oai-authenticated-user-id':'qa-admin','oai-authenticated-user-email':'qa-admin@example.test'}};
 async function write(payload,user=users.seller,path='/api/market'){
  let response;for(let i=0;i<3;i++){response=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...user},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});if(response.status!==503)break;const text=await response.clone().text();if(!text.includes('restarted mid-request'))break;}return response;
 }
 async function read(path,user){const response=await fetch(origin+path,{headers:user,signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,path);return response.json()}
 const form=new FormData();form.append('file',new Blob([await readFile('public/images/dubai-building.jpg')],{type:'image/jpeg'}),'photo.jpg');
 const upload=await fetch(origin+'/api/upload',{method:'POST',headers:{Origin:origin,...users.seller},body:form});assert.equal(upload.status,201);const photo=(await upload.json()).url;
 const data={title:'Local QA commercial office',category:'property',subtype:'Office',emirate:'Dubai',area:'Business Bay',price:100000,intent:'rent',description:'Local-only QA data: fitted commercial office. Confirm parking and all details with the seller.',sellerName:'QA Seller',phone:'+971501234567',specs:{Area:'1000 sq ft'},images:[photo],video:'',permit:''};
 const create=await write({action:'listing',data});assert.equal(create.status,201);const listing=await create.json();
 assert.equal((await read('/api/market')).listings.length,0);assert.equal((await fetch(origin+photo)).status,404);
 assert.equal((await write({action:'status',listingId:listing.id,status:'published'},users.buyer)).status,400);
 assert.equal((await write({action:'status',listingId:listing.id,status:'published'},users.admin)).status,200);
 const inventory=await read('/api/market');assert.equal(inventory.listings.length,1);for(const key of ['phone','seller_email','owner_id'])assert.equal(key in inventory.listings[0],false);
 assert.equal((await fetch(origin+photo)).status,200);assert.equal((await fetch(origin+'/listing/'+listing.slug)).status,200);
 assert.equal((await write({action:'save',listingId:listing.id,saved:true},users.buyer)).status,200);
 assert.equal((await write({action:'enquiry',data:{listingId:listing.id,phone:'+971501234568',message:'Please arrange a viewing next week.',kind:'viewing'}},users.buyer)).status,200);
 assert.equal((await read('/api/market?scope=me',users.seller)).enquiries.length>=1,true);
 const promotion=await write({action:'promotion',listingId:listing.id,packageId:'reel',notes:'Local QA only'});assert.equal(promotion.status,201);const promotionId=(await promotion.json()).id;
 assert.equal((await write({action:'quote',id:promotionId,amount:100},users.buyer)).status,403);assert.equal((await write({action:'quote',id:promotionId,amount:100},users.admin)).status,200);
 assert.equal((await write({id:promotionId},users.seller,'/api/checkout')).status,503);
 assert.equal((await write({action:'listing',id:listing.id,data:{...data,title:'Updated local QA commercial office'}})).status,201);
 assert.equal((await read('/api/market')).listings.length,0);assert.equal((await fetch(origin+'/listing/'+listing.slug)).status,404);
 assert.equal((await write({action:'status',listingId:listing.id,status:'withdrawn'})).status,200);
 console.log('Seller upload, moderation, public privacy, buyer save/enquiry, promotion quote, absent-key checkout, edit review and withdrawal passed. Local QA data is withdrawn; no production data or payments were created.');
}catch(e){console.error(e);console.error(logs.slice(-5000));process.exitCode=1}finally{server.kill('SIGTERM')}
