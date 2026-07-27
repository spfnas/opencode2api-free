var $=function(i){return document.getElementById(i)};

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

function toggleSidebar(){var s=$('sidebar'),o=$('sidebarOverlay');if(s.classList.contains('open')){s.classList.remove('open');o.style.display='none'}else{s.classList.add('open');o.style.display='block'}}

function toast(m,t){var e=$('toast');e.innerHTML='<span>'+(t==='ok'?'✅':'❌')+'</span> '+esc(m);e.className='show';clearTimeout(e._t);e._t=setTimeout(function(){e.className='hiding';setTimeout(function(){e.className=''},250)},3000)}

async function api(u,method,body){var o={method:method||'GET',headers:{'Content-Type':'application/json'}};if(body)o.body=JSON.stringify(body);var r=await fetch(u,o);var d=await r.json();if(!r.ok)throw new Error(d.error||d.message||'HTTP '+r.status);return d}

function closeModal(){$('modal').innerHTML='';$('sidebarOverlay').style.display='none';$('sidebar').classList.remove('open')}

document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()})

// 主题切换：默认暗色，添加 .light 切到亮色
function toggleTheme(){var h=document.documentElement;if(h.classList.contains('light')){h.classList.remove('light');$('themeBtn').textContent='🌙';localStorage.setItem('theme','dark')}else{h.classList.add('light');$('themeBtn').textContent='☀️';localStorage.setItem('theme','light')}}

(function(){var s=localStorage.getItem('theme');if(s==='light'||(!s&&matchMedia('(prefers-color-scheme:light)').matches)){document.documentElement.classList.add('light');$('themeBtn').textContent='☀️'}})();



var currentTab='dashboard';

var titles={dashboard:'📊 仪表盘',audit:'📈 用量审计',keys:'🔑 密钥管理',proxies:'🔄 代理池',sources:'📡 代理源',config:'⚙️ 配置',logs:'📋 日志'};

var loaders={dashboard:fetchDashboard,audit:fetchAudit,keys:fetchKeys,proxies:fetchProxies,sources:fetchSources,config:fetchConfig,logs:fetchLogs};

$('nav').addEventListener('click',function(e){var a=e.target.closest('a[data-tab]');if(!a)return;currentTab=a.dataset.tab;document.querySelectorAll('.tab-panel').forEach(function(p){p.style.display='none'});$('tab-'+currentTab).style.display='';document.querySelectorAll('.sidebar nav a').forEach(function(x){x.classList.remove('active')});a.classList.add('active');$('pageTitle').textContent=titles[currentTab];if(loaders[currentTab])loaders[currentTab]()});



var timers={};

function startRefresh(tab,fn,interval){if(timers[tab])clearInterval(timers[tab]);timers[tab]=setInterval(function(){if(currentTab===tab)fn()},interval)}



async function doAction(path,btn){var orig=btn.innerHTML;btn.innerHTML='<span class="spinner spinner-dark"></span>';btn.disabled=true;try{await api('/api/'+path,'POST',{});toast('已触发 '+path)}catch(e){toast(e.message)}btn.innerHTML=orig;btn.disabled=false;if(currentTab==='dashboard')fetchDashboard()}



/* ===== DASHBOARD ===== */

async function fetchDashboard(){

startRefresh('dashboard',fetchDashboard,10000);

try{var s=await api('/api/status');

var wc=(s.warpStatus==='running'||(s.warpMode==='on'&&s.warpStatus!=='stopped'))?'green':'red';

var wtx=(s.warpStatus==='running'||(s.warpMode==='on'&&s.warpStatus!=='stopped'))?'✅ 运行中':'❌ 未运行';

var rate=s.stats.total>0?((s.stats.success/s.stats.total)*100).toFixed(1)+'%':'—';

var rc=parseFloat(rate)>=90?'green':parseFloat(rate)>=70?'amber':'red';

var pct=s.slotCount>0?((s.slotsReady/s.slotCount)*100):0;

var cands=s.candidatesCount!==undefined?s.candidatesCount:s.candidates||0;

var fbOk=s.fallbackAvailable?'✅ 可用':'❌ 未配置';

var fbAddr=s.fallbackAddr?' <span style="font-size:10px;color:var(--muted)">('+esc(s.fallbackAddr)+')</span>':'';

$('statCards').innerHTML=

'<div class="stat-card"><div class="label">在线槽位</div><div class="value blue">'+s.slotsReady+' / '+s.slotCount+'</div><div class="progress"><div class="progress-bar" style="width:'+pct+'%"></div></div></div>'+

'<div class="stat-card"><div class="label">候选代理</div><div class="value amber">'+cands.toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">备用池</div><div class="value blue">'+(s.releasedCandidatesCount||0).toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">总请求</div><div class="value">'+s.stats.total.toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">成功率</div><div class="value '+rc+'">'+rate+'</div></div>'+

'<div class="stat-card"><div class="label">WARP 状态</div><div class="value '+wc+'" style="font-size:14px">'+wtx+'</div><div class="sub">模式: '+esc(s.warpMode||'off')+'</div></div>'+

'<div class="stat-card"><div class="label">自定义 Fallback</div><div class="value" style="font-size:13px">'+fbOk+fbAddr+'</div></div>';

// Key 槽位状态

var pools=s.pools||[];

$('keySlotWrap').innerHTML=pools.length?'<table><thead><tr><th>Key</th><th>名称</th><th>槽位</th><th>代理地址</th><th>延时</th><th>请求数</th><th>最后使用</th></tr></thead><tbody>'+pools.map(function(p){

var slotsHtml=p.slots&&p.slots.length?p.slots.map(function(sl){return '<code>'+esc(sl.addr)+'</code> <span class="tag tag-'+(sl.latencyMs<500?'green':sl.latencyMs<2000?'amber':'red')+'">'+sl.latencyMs+'ms</span>'}).join('<br>'):'<span style="color:var(--muted)">无</span>';

return '<tr><td><code>'+esc(p.key)+'</code></td><td>'+esc(p.name)+'</td><td><span class="tag tag-'+(p.slots&&p.slots.length?'active':'pending')+'">'+(p.slots?p.slots.length:0)+' / 3</span></td><td style="font-size:12px">'+slotsHtml+'</td><td>'+(p.lastUsedAt?new Date(p.lastUsedAt).toLocaleString():'从未')+'</td><td>'+p.requestCount+'</td></tr>'

}).join('')+'</tbody></table>':'<div style="padding:12px;color:var(--muted)">暂无活跃 Key</div>';

}catch(e){$('statCards').innerHTML='<div class="stat-card" style="color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

fetchModels();fetchDashboardKeys();

}

async function fetchModels(){try{var s=await api('/api/models');$('testModel').innerHTML=s.models&&s.models.length?s.models.map(function(m){return '<option value="'+esc(m.id)+'">'+esc(m.displayName||m.id)+'</option>'}).join(''):'<option>无可用模型</option>'}catch(e){$('testModel').innerHTML='<option>加载失败</option>'}}

async function fetchDashboardKeys(){try{var s=await api('/api/keys');var k=s.keys||[];var enabled=k.filter(function(x){return x.enabled!==false});if(enabled.length){$('testKeySelect').innerHTML=enabled.map(function(x,i){return '<option value="'+esc(x.fullKey||x.key)+'"'+(i===0?' selected':'')+'>'+esc(x.name||x.key.slice(0,8))+'</option>'}).join('')}else{$('testKeySelect').innerHTML='<option value="">无可用密钥</option>'}}catch(e){}}

async function sendTest(){

var btn=$('testBtn'),mod=$('testModel').value,msg=$('testPrompt').value,key=$('testKeySelect').value;

if(!msg){toast('请输入消息');return}

btn.innerHTML='<span class="spinner"></span> 发送中...';btn.disabled=true;var res=$('testResult');

try{var h={'Content-Type':'application/json'};if(key)h['Authorization']='Bearer '+key;

var r=await fetch('/openai/v1/chat/completions',{method:'POST',headers:h,body:JSON.stringify({model:mod,messages:[{role:'user',content:msg}],stream:false})});

var d=await r.json();if(!r.ok)throw new Error(d.error&&d.error.message?d.error.message:JSON.stringify(d));

var content=d.choices&&d.choices[0]?d.choices[0].message.content:JSON.stringify(d);

var usage=d.usage?'\n\n---\nTokens: '+d.usage.total_tokens+' (prompt: '+d.usage.prompt_tokens+', completion: '+d.usage.completion_tokens+')':'';

res.className='test-result test-ok';res.textContent='✅ 成功\n'+content+usage;

}catch(e){res.className='test-result test-err';res.textContent='❌ 错误: '+e.message}

btn.innerHTML='▶️ 发送';btn.disabled=false;

}



/* ===== AUDIT ===== */

async function fetchAudit(){

startRefresh('audit',fetchAudit,30000);

try{var s=await api('/api/audit');var sm=s.summary||{};

$('auditSummary').innerHTML=

'<div class="stat-card"><div class="label">总请求</div><div class="value">'+sm.totalRequests.toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">总Token</div><div class="value">'+sm.totalTokens.toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">输入Token</div><div class="value blue">'+sm.totalPrompt.toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">输出Token</div><div class="value amber">'+sm.totalCompletion.toLocaleString()+'</div></div>'+

'<div class="stat-card"><div class="label">缓存命中率</div><div class="value green">'+(sm.cacheHitRate*100).toFixed(1)+'%</div></div>';

var keys=s.keys||[];

$('auditKeyWrap').innerHTML=keys.length?'<table><thead><tr><th>Key名称</th><th>Key</th><th>请求数</th><th>Token</th><th>最后使用</th></tr></thead><tbody>'+keys.map(function(k){return '<tr><td>'+esc(k.name)+'</td><td><code>'+esc(k.key)+'</code></td><td>'+k.requests.toLocaleString()+'</td><td>'+k.totalTokens.toLocaleString()+'</td><td>'+(k.lastUsedAt?new Date(k.lastUsedAt).toLocaleString():'从未')+'</td></tr>'}).join('')+'</tbody></table>':'<div style="padding:16px;color:var(--muted)">暂无数据</div>';

var models=s.models||[];

$('auditModelWrap').innerHTML=models.length?'<table><thead><tr><th>模型</th><th>请求数</th><th>输入</th><th>输出</th><th>总Token</th><th>缓存</th></tr></thead><tbody>'+models.map(function(m){return '<tr><td><code>'+esc(m.model)+'</code></td><td>'+m.requests.toLocaleString()+'</td><td>'+m.promptTokens.toLocaleString()+'</td><td>'+m.completionTokens.toLocaleString()+'</td><td>'+m.totalTokens.toLocaleString()+'</td><td>'+(m.cacheRead||0).toLocaleString()+'</td></tr>'}).join('')+'</tbody></table>':'<div style="padding:16px;color:var(--muted)">暂无数据</div>';

var days=s.days||[];

$('auditDayWrap').innerHTML=days.length?'<table><thead><tr><th>日期</th><th>请求数</th><th>总Token</th><th>输入</th><th>输出</th><th>缓存</th><th>详情</th></tr></thead><tbody>'+days.map(function(d){return '<tr><td>'+esc(d.date)+'</td><td>'+d.requests.toLocaleString()+'</td><td>'+d.totalTokens.toLocaleString()+'</td><td>'+d.promptTokens.toLocaleString()+'</td><td>'+d.completionTokens.toLocaleString()+'</td><td>'+(d.cacheRead||0).toLocaleString()+'</td><td><button class="btn btn-outline btn-sm" onclick="showAuditDetail(\''+esc(d.date)+'\')">详情</button></td></tr>'}).join('')+'</tbody></table>':'<div style="padding:16px;color:var(--muted)">暂无数据</div>';

}catch(e){$('auditSummary').innerHTML='<div class="stat-card" style="color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

}

function showAuditDetail(date){$('auditDate').value=date;fetchAuditDetail()}

async function fetchAuditDetail(){

var date=$('auditDate').value;if(!date){$('auditDetailWrap').innerHTML='<div style="padding:16px;color:var(--muted)">请选择日期</div>';return}

try{var s=await api('/api/audit/daily?date='+encodeURIComponent(date));

var entries=s.entries||[];

$('auditDetailWrap').innerHTML=entries.length?'<table><thead><tr><th>时间</th><th>模型</th><th>输入</th><th>输出</th><th>总Token</th><th>缓存</th><th>延时</th><th>状态</th></tr></thead><tbody>'+entries.map(function(e){var sc=e.status==='success'?'green':'red';return '<tr><td>'+esc(e.time)+'</td><td><code>'+esc(e.model)+'</code></td><td>'+e.promptTokens.toLocaleString()+'</td><td>'+e.completionTokens.toLocaleString()+'</td><td>'+e.totalTokens.toLocaleString()+'</td><td>'+(e.cacheRead||0).toLocaleString()+'</td><td>'+(e.latencyMs||0)+'ms</td><td><span class="tag tag-'+sc+'">'+esc(e.status)+'</span></td></tr>'}).join('')+'</tbody></table>':'<div style="padding:16px;color:var(--muted)">该日无数据</div>';

}catch(e){$('auditDetailWrap').innerHTML='<div style="padding:16px;color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

}



/* ===== KEYS ===== */

async function fetchKeys(){

startRefresh('keys',fetchKeys,15000);

try{var s=await api('/api/keys');var k=s.keys||[];var now=Date.now();

$('keyTableWrap').innerHTML=k.length?'<table><thead><tr><th>名称</th><th>Key</th><th>状态</th><th>并发</th><th>已用/限额</th><th>Token</th><th>到期</th><th>操作</th></tr></thead><tbody>'+k.map(function(x){

var isDefault=x.name==='默认';

var exp=x.expiresAt?new Date(x.expiresAt).getTime():0;

var st=x.enabled===false?'disabled':(exp&&exp<now)?'expired':'active';

var stLabel={active:'active',disabled:'disabled',expired:'expired'}[st];

var conc=x.maxConcurrency?x.currentConcurrency+'/'+x.maxConcurrency:'∞';

var req=x.maxRequests?x.requestCount+'/'+x.maxRequests:(x.requestCount||0).toString();

var expStr=x.expiresAt?new Date(x.expiresAt).toLocaleDateString():'永不过期';

var acts='<button class="btn btn-outline btn-sm" onclick="showEditKey(\''+esc(x.key)+'\')" title="编辑">✏️</button> ';

acts+='<button class="btn btn-outline btn-sm" onclick="copyKey(\''+esc(x.key||'')+'\')" title="复制">📋</button> ';

if(!isDefault){acts+='<button class="btn btn-outline btn-sm" onclick="toggleKey(\''+esc(x.key)+'\','+(x.enabled!==false)+')" title="'+(x.enabled!==false?'禁用':'启用')+'">'+(x.enabled!==false?'🔒':'🔓')+'</button> '}

if(!isDefault){acts+='<button class="btn btn-red btn-sm" onclick="deleteKey(\''+esc(x.key)+'\')" title="删除">🗑️</button>'}

return '<tr><td>'+esc(x.name||'未命名')+'</td><td><code>'+esc((x.key||'').slice(0,4))+'****</code></td><td><span class="tag tag-'+stLabel+'">'+{active:'active',disabled:'disabled',expired:'expired'}[st]+'</span></td><td>'+conc+'</td><td>'+req+'</td><td>'+(x.totalTokens||0).toLocaleString()+'</td><td>'+expStr+'</td><td style="white-space:nowrap">'+acts+'</td></tr>'

}).join('')+'</tbody></table>':'<div style="padding:16px;color:var(--muted)">暂无密钥</div>';

var sel=$('testKeySelect');if(sel){var cur=sel.value;var enabled=k.filter(function(x){return x.enabled!==false});sel.innerHTML=enabled.length?enabled.map(function(x,i){return '<option value="'+esc(x.fullKey||x.key)+'">'+esc(x.name||x.key.slice(0,8))+'</option>'}).join(''):'<option value="">无可用密钥</option>';sel.value=cur}

}catch(e){$('keyTableWrap').innerHTML='<div style="padding:16px;color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

}

function showAddKey(){

$('modal').innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>➕ 创建密钥</h2><div class="form-group"><label>名称</label><input id="mkName" placeholder="my-key"></div><div class="form-group"><label>最大并发 (0=不限)</label><input id="mkConc" type="number" value="0"></div><div class="form-group"><label>最大请求数 (0=不限)</label><input id="mkReq" type="number" value="0"></div><div class="form-group"><label>到期日期 (留空=永不过期)</label><input id="mkExp" type="date"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary" onclick="createKey()">创建</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div></div></div>';

}

async function createKey(){

var name=$('mkName').value||'未命名';

var conc=parseInt($('mkConc').value)||0;

var req=parseInt($('mkReq').value)||0;

var exp=$('mkExp').value||undefined;

try{var r=await api('/api/keys','POST',{name:name,maxConcurrency:conc,maxRequests:req,expiresAt:exp});

closeModal();

var newKey=r.key||'';

$('modal').innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>✅ 密钥已创建</h2><div style="background:var(--bg);padding:12px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;margin-bottom:10px">'+esc(newKey)+'</div><div style="color:var(--amber);font-size:12px;margin-bottom:14px">⚠️ 关闭此弹窗后无法再查看完整 Key，请立即复制！</div><div style="display:flex;gap:8px"><button class="btn btn-primary" onclick="copyKey(\''+esc(newKey)+'\')">📋 复制 Key</button><button class="btn btn-outline" onclick="closeModal()">关闭</button></div></div></div>';

toast('密钥已创建','ok');fetchKeys();

}catch(e){toast(e.message)}

}

async function toggleKey(key,wasEnabled){

if(wasEnabled&&!confirm('确定禁用该密钥？正在使用该 Key 的请求将被中断'))return;

try{await api('/api/keys/'+encodeURIComponent(key),'PUT',{enabled:!wasEnabled});toast('已更新','ok');fetchKeys()}catch(e){toast(e.message)}

}

async function deleteKey(key){if(!confirm('确定要删除这个密钥吗？'))return;try{await api('/api/keys/'+encodeURIComponent(key),'DELETE');toast('密钥已删除','ok');fetchKeys()}catch(e){toast(e.message)}}

async function copyKey(key){try{await navigator.clipboard.writeText(key);toast('已复制','ok')}catch(e){toast('复制失败: '+e.message)}}

function showEditKey(key){

api('/api/keys').then(function(s){var x=(s.keys||[]).find(function(k){return k.key===key});if(!x)return toast('找不到密钥');

var exp=x.expiresAt?new Date(x.expiresAt).toISOString().split('T')[0]:'';

$('modal').innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>✏️ 编辑密钥</h2><div class="form-group"><label>名称</label><input id="ekName" value="'+esc(x.name||'')+'"></div><div class="form-group"><label>启用</label><select id="ekEnabled"><option value="true"'+(x.enabled!==false?' selected':'')+'>是</option><option value="false"'+(x.enabled===false?' selected':'')+'>否</option></select></div><div class="form-group"><label>最大并发 (0=不限)</label><input id="ekConc" type="number" value="'+(x.maxConcurrency||0)+'"></div><div class="form-group"><label>最大请求数 (0=不限)</label><input id="ekReq" type="number" value="'+(x.maxRequests||0)+'"></div><div class="form-group"><label>到期日期 (留空=永不过期)</label><input id="ekExp" type="date" value="'+exp+'"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary" onclick="updateKey(\''+esc(key)+'\')">保存</button><button class="btn btn-outline btn-sm" onclick="resetReqCount(\''+esc(key)+'\')">🔄 重置调用次数</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div></div></div>';

}).catch(function(e){toast(e.message)});

}

async function resetReqCount(key){

if(!confirm('确定重置该密钥的调用次数？'))return;

try{await api('/api/keys/'+encodeURIComponent(key),'PUT',{resetRequestCount:true});toast('调用次数已重置','ok');showEditKey(key);fetchKeys()}catch(e){toast(e.message)}

}

async function updateKey(key){

var name=$('ekName').value;var enabled=$('ekEnabled').value==='true';

var conc=parseInt($('ekConc').value)||0;var req=parseInt($('ekReq').value)||0;

var exp=$('ekExp')?$('ekExp').value||undefined:undefined;

try{await api('/api/keys/'+encodeURIComponent(key),'PUT',{name:name,enabled:enabled,maxConcurrency:conc,maxRequests:req,expiresAt:exp});closeModal();toast('已更新','ok');fetchKeys()}catch(e){toast(e.message)}

}



/* ===== PROXIES ===== */

var _proxiesPageSize=50;

var _proxiesAll=[];

var _proxiesPage=1;

function _proxyRenderPage(){

var p=_proxiesAll;

var totalPages=Math.ceil(p.length/_proxiesPageSize)||1;

if(_proxiesPage>totalPages)_proxiesPage=totalPages;

if(_proxiesPage<1)_proxiesPage=1;

var start=(_proxiesPage-1)*_proxiesPageSize;

var end=Math.min(start+_proxiesPageSize,p.length);

var page=p.slice(start,end);

var gradeColors={A:'green',B:'blue',C:'amber',D:'red',F:'red'};

var html='';

if(p.length){

html+='<table><thead><tr><th>地址</th><th>协议</th><th>等级</th><th>延时</th><th>状态</th><th>操作</th></tr></thead><tbody>';

html+=page.map(function(x){

var gc=gradeColors[x.quality_grade]||'muted';

var acts='<button class="btn btn-red btn-sm" onclick="delProxy(\''+esc(x.address)+'\')">🗑️</button>';

if(!x.active)acts+=' <button class="btn btn-green btn-sm" onclick="promoteProxy(\''+esc(x.address)+'\')">⬆️</button>';

return '<tr><td><code>'+esc(x.address)+'</code></td><td>'+esc(x.protocol||'http')+'</td><td><span class="tag tag-'+gc+'">'+esc(x.quality_grade||'-')+'</span></td><td>'+(x.latency?x.latency+'ms':'-')+'</td><td><span class="tag tag-'+(x.active?'active':'pending')+'">'+(x.active?'活跃':'空闲')+'</span></td><td>'+acts+'</td></tr>'

}).join('')+'</tbody></table>';

if(totalPages>1){

html+='<div style="display:flex;align-items:center;gap:8px;padding:12px 0;justify-content:center;font-size:13px">';

html+='<button class="btn btn-outline btn-sm" onclick="_proxiesPage=1;_proxyRenderPage()" '+(_proxiesPage<=1?'disabled':'')+'>«</button>';

html+='<button class="btn btn-outline btn-sm" onclick="_proxiesPage=Math.max(1,_proxiesPage-1);_proxyRenderPage()" '+(_proxiesPage<=1?'disabled':'')+'>‹</button>';

html+='<span style="margin:0 8px;color:var(--muted)">第 '+_proxiesPage+'/'+totalPages+' 页（共 '+p.length+' 条）</span>';

html+='<button class="btn btn-outline btn-sm" onclick="_proxiesPage=Math.min(totalPages,_proxiesPage+1);_proxyRenderPage()" '+(_proxiesPage>=totalPages?'disabled':'')+'>›</button>';

html+='<button class="btn btn-outline btn-sm" onclick="_proxiesPage=totalPages;_proxyRenderPage()" '+(_proxiesPage>=totalPages?'disabled':'')+'>»</button>';

html+='</div>';

}

}else{

html='<div style="padding:16px;color:var(--muted)">暂无代理</div>';

}

$('proxyTableWrap').innerHTML=html;

}

async function fetchProxies(){

startRefresh('proxies',fetchProxies,10000);

try{var s=await api('/api/proxies');_proxiesAll=s.proxies||[];_proxiesPage=1;_proxyRenderPage()}catch(e){$('proxyTableWrap').innerHTML='<div style="padding:16px;color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

}

async function delProxy(addr){if(!confirm('确定删除代理 '+addr+'？'))return;try{await api('/api/proxies/'+encodeURIComponent(addr),'DELETE');toast('已删除','ok');fetchProxies()}catch(e){toast(e.message)}}

async function promoteProxy(addr){try{await api('/api/promote','POST',{addr:addr});toast('已提升','ok');fetchProxies()}catch(e){toast(e.message)}}

function showAddProxy(){

$('modal').innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>➕ 批量添加代理</h2><div class="form-group"><label>代理列表 (每行一个)</label><textarea id="proxyList" rows="8" placeholder="http://ip:port&#10;socks5://ip:port"></textarea></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary" onclick="addProxies()">添加</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div></div></div>';

}

async function addProxies(){

var text=$('proxyList').value.trim();if(!text){toast('请输入代理');return}

var list=text.split('\n').map(function(l){return l.trim()}).filter(Boolean);

if(!confirm('将添加 '+list.length+' 个代理，确定继续？'))return;

try{await api('/api/proxies','POST',{proxies:list});closeModal();toast('已添加 '+list.length+' 个代理','ok');fetchProxies()}catch(e){toast(e.message)}

}



/* ===== SOURCES ===== */

async function fetchSources(){

startRefresh('sources',fetchSources,30000);

try{var s=await api('/api/sources');var sr=s.sources||[];

$('sourceTableWrap').innerHTML=sr.length?'<table><thead><tr><th>名称</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody>'+sr.map(function(x){

var stat=x.error?'<span class="tag tag-expired">'+esc(x.error)+'</span>':'<span class="tag tag-active">'+x.count+' 条</span>';

return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.type)+'</td><td>'+stat+'</td><td><button class="btn btn-red btn-sm" onclick="delSource(\''+esc(x.name)+'\')">🗑️</button></td></tr>'

}).join('')+'</tbody></table>':'<div style="padding:16px;color:var(--muted)">暂无数据源</div>';

}catch(e){$('sourceTableWrap').innerHTML='<div style="padding:16px;color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

}

async function delSource(name){if(!confirm('确定删除源 '+name+'？'))return;try{await api('/api/sources/'+encodeURIComponent(name),'DELETE');toast('已删除','ok');fetchSources()}catch(e){toast(e.message)}}

function showAddSource(){

$('modal').innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>➕ 添加代理源</h2><div class="form-group"><label>名称</label><input id="srcName" placeholder="my-source"></div><div class="form-group"><label>URL</label><input id="srcUrl" placeholder="https://..."></div><div class="form-group"><label>类型</label><select id="srcType"><option value="text" selected>text (txt)</option><option value="json">json</option></select></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary" onclick="addSource()">添加</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div></div></div>';

}

async function addSource(){

var name=$('srcName').value,url=$('srcUrl').value,type=$('srcType').value;

if(!name||!url){toast('请填写名称和URL');return}

try{await api('/api/sources','POST',{name:name,url:url,type:type});closeModal();toast('已添加','ok');fetchSources()}catch(e){toast(e.message)}

}



/* ===== CONFIG ===== */

async function fetchConfig(){

try{var c=await api('/api/config');

$('configForm').innerHTML=

'<div class="form-group"><label>槽位数量</label><input id="cfgSlots" type="number" value="'+(c.slotCount||10)+'"></div>'+

'<div class="form-group"><label>WARP 模式</label><select id="cfgWarp"><option value="on"'+(c.warpMode==='on'?' selected':'')+'>on</option><option value="off"'+(c.warpMode==='off'?' selected':'')+'>off</option></select></div>'+

'<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary" onclick="saveConfig()">💾 保存配置</button><button class="btn btn-outline" onclick="reloadConfig()">🔄 热加载配置</button></div>';

if($('cfgWarp')) $('cfgWarp').value=c.warpMode||'off';

if($('fallbackProxyInput')) $('fallbackProxyInput').value=c.fallbackProxy||'';

}catch(e){$('configForm').innerHTML='<div style="color:var(--red)">加载失败: '+esc(e.message)+'</div>'}

}

async function reloadConfig(){try{var r=await api('/api/config/reload','POST');toast('已加载 '+r.candidates+' 候选, '+r.released+' 备用','ok');if(currentTab==='dashboard')fetchDashboard()}catch(e){toast(e.message)}}

async function saveConfig(){

var slotCount=parseInt($('cfgSlots').value)||10;

var warpMode=$('cfgWarp').value;

try{await api('/api/config','POST',{warpMode:warpMode,slotCount:slotCount});toast('配置已保存','ok');fetchConfig();if(currentTab==='dashboard')fetchDashboard()}catch(e){toast(e.message)}

}

async function saveFallbackProxy(){

var fb=$('fallbackProxyInput').value.trim();

try{await api('/api/config','POST',{fallbackProxy:fb});toast('Fallback 代理已保存','ok');testFallbackProxy()}catch(e){toast(e.message)}

}

async function testFallbackProxy(){

var fb=$('fallbackProxyInput').value.trim();

if(!fb){$('fallbackTestResult').innerHTML='<span style="color:var(--red)">请先输入 Fallback 代理地址</span>';return}

try{var r=await api('/api/fallback/test','POST',{address:fb});

$('fallbackTestResult').innerHTML=r.ok?'<span style="color:var(--green)">✅ '+r.address+' 连通 ('+r.latencyMs+'ms)</span>':'<span style="color:var(--red)">❌ '+r.address+' 不可达</span>'}

catch(e){$('fallbackTestResult').innerHTML='<span style="color:var(--red)">❌ 测试失败: '+esc(e.message)+'</span>'}

}



/* ===== LOGS ===== */

async function fetchLogs(){

startRefresh('logs',fetchLogs,10000);

try{var s=await api('/api/logs');$('logBox').textContent=(s.logs||[]).join('\n')||'暂无日志';$('logBox').scrollTop=$('logBox').scrollHeight}catch(e){$('logBox').textContent='加载失败: '+e.message}

}



/* ===== INIT ===== */

fetchDashboard();

fetchProxies();

fetchSources();

