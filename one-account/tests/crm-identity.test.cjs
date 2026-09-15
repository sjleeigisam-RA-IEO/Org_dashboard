'use strict';
// Synthetic credentials and injected RPC/SMTP only. Never reads deployment secrets.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const identity = require('../lib/crm-identity.cjs');
const { createHandler } = require('../api/crm-identity.js');
const { createHandler: createLogout } = require('../api/logout.js');
const HOST = 'identity-tests.example', EMAIL = 'reviewer@igisam.com';
const saved = new Map();
let key, base, parentExpiry;
before(() => {
  for (const name of ['ONE_ACCOUNT_CODE_SCRYPT','ONE_ACCOUNT_SESSION_SECRET']) saved.set(name, process.env[name]);
  const salt = crypto.randomBytes(16), code = crypto.randomBytes(24).toString('base64url');
  process.env.ONE_ACCOUNT_CODE_SCRYPT = `scrypt:${salt.toString('hex')}:${crypto.scryptSync(code,salt,32).toString('hex')}`;
  process.env.ONE_ACCOUNT_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
  key = auth.config().key;
  const session = auth.makeSession(EMAIL, false, key);
  base = session.token; parentExpiry = session.expiresAt;
});
after(() => {
  for (const [name,value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
function response() {
  const headers = {};
  return { statusCode: 0, body: '', headers,
    setHeader(k,v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; },
    writeHead(status, h={}) { this.statusCode=status; for (const [k,v] of Object.entries(h)) this.setHeader(k,v); },
    end(value='') { this.body += value; } };
}
function request({ method='POST', body, token=base, proof, challenge, headers={} }={}) {
  const req=Readable.from([]); req.method=method; req.url='/api/crm-identity';
  req.headers={host:HOST,origin:`https://${HOST}`,'content-type':'application/json',cookie:[token && `${auth.COOKIE}=${token}`,proof && `${identity.COOKIE}=${proof}`,challenge && `${identity.CHALLENGE_COOKIE}=${challenge}`].filter(Boolean).join('; '),...headers};
  req.socket={remoteAddress:'192.0.2.55'};
  if (body!==undefined) req.body=body;
  return req;
}
async function invoke(options={}, dependencies={}) {
  const calls=[], sends=[]; const req=request(options), res=response();
  await createHandler({
    enabled:dependencies.enabled || (()=>true),
    rpc:async(name,args)=>{ calls.push({name,args}); if (!dependencies.rpc) assert.fail('Unexpected RPC'); return dependencies.rpc(name,args); },
    send:async(email,code)=>{ sends.push({email,code}); if (dependencies.send) return dependencies.send(email,code); },
  })(req,res);
  return {req,res,calls,sends,json:JSON.parse(res.body)};
}
const cookies = res => [].concat(res.headers['set-cookie'] || []);
const cookieValue = (res,name) => cookies(res).find(c=>c.startsWith(name+'='))?.slice(name.length+1).split(';')[0];
const cleared = (res,name) => cookies(res).some(c=>c.startsWith(name+'=;') && c.includes('Max-Age=0'));
const verifiedResult = overrides => ({status:'verified',email:EMAIL,auth_method:'email_otp',expires_at:new Date(Date.now()+3600000).toISOString(),...overrides});

test('invalid or missing base sessions fail before RPC or SMTP and clear private cookies',async()=>{
  for(const method of ['GET','POST']) {
    const out=await invoke({method,token:null,body:{action:'request-code'},proof:crypto.randomBytes(32).toString('base64url'),challenge:crypto.randomUUID()});
    assert.equal(out.res.statusCode,401); assert.equal(out.calls.length,0); assert.equal(out.sends.length,0);
    assert.ok(cleared(out.res,identity.COOKIE)); assert.ok(cleared(out.res,identity.CHALLENGE_COOKIE));
  }
});

test('POST requires an exact same-origin header and rejects unsupported methods',async()=>{
  for(const origin of [undefined,'null','https://attacker.example','https://'+HOST+'.attacker.example']) {
    const out=await invoke({body:{action:'request-code'},headers:{origin}});
    assert.equal(out.res.statusCode,403); assert.equal(out.calls.length,0); assert.equal(out.sends.length,0);
  }
  const out=await invoke({method:'DELETE'}); assert.equal(out.res.statusCode,405);
});

test('only action and a six-character verification code are accepted; callers cannot choose identity or challenge',async()=>{
  for(const body of [null,[],{}, {action:'other'}, {action:'request-code',email:'other@igisam.com'}, {action:'request-code',code:'123456'},
    {action:'verify',code:123456},{action:'verify',code:' 123456'},{action:'verify',code:'12345'}, {action:'verify',code:{}},
    {action:'verify',code:'123456',challengeId:crypto.randomUUID()}, {action:'lock',identityVerified:true}]) {
    const out=await invoke({body}); assert.equal(out.res.statusCode,400,JSON.stringify(body)); assert.equal(out.calls.length,0); assert.equal(out.sends.length,0);
  }
});

test('request code binds session email and nonce, stores only digests, and marks sent after SMTP acceptance',async()=>{
  const events=[];
  const out=await invoke({body:{action:'request-code'}},{
    rpc:async(name,{p_action,p_args})=>{assert.equal(name,'oa_crm_identity');events.push(p_action);return p_action==='start'?{status:'pending',expires_at:new Date(Date.now()+600000).toISOString()}:{status:'sent'};},
    send:async()=>events.push('smtp'),
  });
  assert.equal(out.res.statusCode,200); assert.deepEqual(events,['start','smtp','mark_sent']); assert.equal(out.sends.length,1);
  const sent=out.sends[0], args=out.calls[0].args.p_args;
  assert.equal(sent.email,EMAIL); assert.match(sent.code,/^\d{6}$/); assert.equal(args.email,EMAIL);
  assert.equal(args.session_binding,identity.binding(out.req)); assert.equal(args.code_digest,identity.codeDigest(args.challenge_id,args.session_binding,sent.code));
  assert.equal(Date.parse(args.parent_expires_at),parentExpiry*1000);
  assert.match(args.ip_digest,/^[a-f0-9]{64}$/);
  const issued=cookies(out.res).find(c=>c.startsWith(identity.CHALLENGE_COOKIE+'='));
  for(const flag of ['Path=/','HttpOnly','Secure','SameSite=Lax','Max-Age=']) assert.ok(issued.includes(flag));
  assert.equal(cookieValue(out.res,identity.CHALLENGE_COOKIE),args.challenge_id);
  assert.ok(!out.res.body.includes(args.challenge_id)); assert.ok(!out.res.body.includes(sent.code)); assert.equal(cookieValue(out.res,identity.COOKIE),undefined);
  assert.ok(!JSON.stringify(out.calls).includes(`"code":"${sent.code}"`));
});

test('disabled delivery and distributed reservation limits prevent SMTP',async()=>{
  const disabled=await invoke({body:{action:'request-code'}},{enabled:()=>false});
  assert.equal(disabled.res.statusCode,503);assert.equal(disabled.calls.length,0);assert.equal(disabled.sends.length,0);
  for(const result of [{status:'rate_limited',retry_after:90},{status:'denied'},{status:'unexpected'}]) {
    const out=await invoke({body:{action:'request-code'}},{rpc:async()=>result});
    assert.equal(out.res.statusCode,result.status==='rate_limited'?429:result.status==='denied'?403:503);assert.equal(out.sends.length,0);
    if(result.status==='rate_limited') assert.equal(out.res.headers['retry-after'],'90');
  }
});

test('SMTP failure or uncertain mark_sent cancels the pending challenge and never issues a proof',async()=>{
  for(const failSmtp of [true,false]) {
    const out=await invoke({body:{action:'request-code'}},{
      rpc:async(name,{p_action})=>{if(p_action==='start')return{status:'pending',expires_at:new Date(Date.now()+600000).toISOString()};if(p_action==='mark_sent')throw Error('Synthetic DB failure');return{status:'cancelled'};},
      send:async()=>{if(failSmtp)throw Error('Synthetic SMTP failure');},
    });
    assert.equal(out.res.statusCode,502);assert.equal(out.calls.at(-1).args.p_action,'cancel');assert.ok(cleared(out.res,identity.CHALLENGE_COOKIE));
    assert.equal(cookieValue(out.res,identity.COOKIE),undefined);assert.doesNotMatch(out.res.body,/Synthetic|smtp.gmail/);
  }
});

test('status before verification preserves a pending challenge and does not renew the login',async()=>{
  const out=await invoke({method:'GET',challenge:crypto.randomUUID()});
  assert.equal(out.res.statusCode,200);assert.equal(out.json.identityVerified,false);assert.equal(out.calls.length,0);
  assert.equal(cleared(out.res,identity.CHALLENGE_COOKIE),false);assert.equal(cookieValue(out.res,auth.COOKIE),undefined);
});

test('proof status is fetched using hashed cookie and exact session binding, never a client email',async()=>{
  const token=crypto.randomBytes(32).toString('base64url');
  const out=await invoke({method:'GET',proof:token},{rpc:async()=>verifiedResult()});
  assert.equal(out.res.statusCode,200);assert.equal(out.json.identityVerified,true);assert.equal(out.json.canEdit,true);
  assert.deepEqual(out.calls[0].args,{p_action:'status',p_args:{proof_digest:identity.proofDigest(token),session_binding:identity.binding(out.req)}});
  assert.equal(cookies(out.res).length,0);assert.ok(!out.res.body.includes(token));assert.match(out.res.headers['cache-control'],/no-store/);
});

test('wrong identity, wrong method, expired or over-parent proof responses cannot unlock',async()=>{
  for(const result of [verifiedResult({email:'someoneelse@igisam.com'}),verifiedResult({auth_method:'shared_code'}),verifiedResult({expires_at:new Date(Date.now()-1000).toISOString()}),verifiedResult({expires_at:new Date((parentExpiry+60)*1000).toISOString()}),{status:'unverified'}]){
    const out=await invoke({method:'GET',proof:crypto.randomBytes(32).toString('base64url'),challenge:crypto.randomUUID()},{rpc:async()=>result});
    assert.equal(out.json.identityVerified,false);assert.ok(cleared(out.res,identity.COOKIE));assert.equal(cleared(out.res,identity.CHALLENGE_COOKIE),false);
  }
});

test('verification requires one valid HttpOnly challenge cookie, not body or duplicate cookies',async()=>{
  const duplicate=crypto.randomUUID();
  for(const headers of [{}, {cookie:`${auth.COOKIE}=${base}; ${identity.CHALLENGE_COOKIE}=bad`}, {cookie:`${auth.COOKIE}=${base}; ${identity.CHALLENGE_COOKIE}=${duplicate}; ${identity.CHALLENGE_COOKIE}=${duplicate}`}]) {
    const out=await invoke({body:{action:'verify',code:'123456'},headers});assert.equal(out.res.statusCode,400);assert.equal(out.calls.length,0);
  }
});

test('successful verify sends only digests and issues an independent secure proof cookie',async()=>{
  const challenge=crypto.randomUUID();
  const out=await invoke({body:{action:'verify',code:'004321'},challenge},{rpc:async()=>verifiedResult()});
  assert.equal(out.res.statusCode,200);assert.equal(out.json.identityVerified,true);
  const args=out.calls[0].args.p_args, token=cookieValue(out.res,identity.COOKIE);
  assert.equal(out.calls[0].args.p_action,'verify');assert.equal(args.challenge_id,challenge);assert.equal(args.code_digest,identity.codeDigest(challenge,identity.binding(out.req),'004321'));
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(args.proof_digest,identity.proofDigest(token));assert.ok(cleared(out.res,identity.CHALLENGE_COOKIE));
  assert.ok(!out.res.body.includes(token));assert.ok(!out.res.body.includes('004321'));assert.ok(!JSON.stringify(out.calls).includes(token));
  const issued=cookies(out.res).find(c=>c.startsWith(identity.COOKIE+'='));
  for(const flag of ['Path=/','HttpOnly','Secure','SameSite=Lax']) assert.ok(issued.includes(flag));
});

test('incorrect code retains the challenge, while consumed/locked/expired/denied clear it without proof',async()=>{
  for(const status of ['invalid_code','inactive','locked','expired','denied']){
    const out=await invoke({body:{action:'verify',code:'123456'},challenge:crypto.randomUUID()},{rpc:async()=>({status})});
    assert.equal(out.res.statusCode,status==='denied'?403:400);assert.equal(cleared(out.res,identity.CHALLENGE_COOKIE),status!=='invalid_code');assert.equal(cookieValue(out.res,identity.COOKIE),undefined);
  }
});

test('independent same-second basic sessions cannot share identity or OTP bindings',()=>{
  const now=Math.floor(Date.now()/1000), first=auth.makeSession(EMAIL,false,key,now),second=auth.makeSession(EMAIL,false,key,now);
  const firstBinding=identity.binding(request({token:first.token})),secondBinding=identity.binding(request({token:second.token}));
  assert.notEqual(firstBinding,secondBinding);
  const challenge=crypto.randomUUID();assert.notEqual(identity.codeDigest(challenge,firstBinding,'123456'),identity.codeDigest(challenge,secondBinding,'123456'));
});

test('duplicate or malformed proof cookies cannot cause a status RPC',async()=>{
  const token=crypto.randomBytes(32).toString('base64url');
  for(const value of ['bad',token+'!',`${token}; ${identity.COOKIE}=${token}`]) {
    const out=await invoke({method:'GET',headers:{cookie:`${auth.COOKIE}=${base}; ${identity.COOKIE}=${value}`}});assert.equal(out.json.identityVerified,false);assert.equal(out.calls.length,0);
  }
});

test('lock clears cookies even when revocation fails and cannot echo a private RPC error',async()=>{
  const out=await invoke({body:{action:'lock'},proof:crypto.randomBytes(32).toString('base64url'),challenge:crypto.randomUUID()},{rpc:async()=>{throw Error('PRIVATE_DATABASE_ERROR');}});
  assert.equal(out.res.statusCode,503);assert.ok(cleared(out.res,identity.COOKIE));assert.ok(cleared(out.res,identity.CHALLENGE_COOKIE));assert.ok(!out.res.body.includes('PRIVATE_DATABASE_ERROR'));
});

test('logout revokes the proof and cancels the challenge; DB failure cannot keep browser cookies',async()=>{
  for(const fail of [false,true]) {
    const token=crypto.randomBytes(32).toString('base64url'), challenge=crypto.randomUUID(),calls=[];
    const req=request({proof:token,challenge}),res=response();
    await createLogout({rpc:async(name,args)=>{calls.push({name,args});if(fail)throw Error('Synthetic unavailable');return{status:'unverified'};}})(req,res);
    assert.equal(res.statusCode,303);assert.deepEqual(calls.map(c=>c.args.p_action),['revoke','cancel']);
    assert.equal(calls[0].args.p_args.proof_digest,identity.proofDigest(token));assert.equal(calls[0].args.p_args.session_binding,identity.binding(req));
    for(const name of [auth.COOKIE,identity.COOKIE,identity.CHALLENGE_COOKIE]) assert.ok(cleared(res,name));
  }
});

test('logout with invalid base session performs no identity operation but clears local cookies',async()=>{
  const req=request({token:'tampered',proof:crypto.randomBytes(32).toString('base64url'),challenge:crypto.randomUUID()}),res=response();
  await createLogout({rpc:async()=>assert.fail('Invalid base session cannot operate on proof')})(req,res);
  assert.equal(res.statusCode,303);for(const name of [auth.COOKIE,identity.COOKIE,identity.CHALLENGE_COOKIE])assert.ok(cleared(res,name));
});
