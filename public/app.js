/* ============================================================
   opencode-free-gate · app.js (对接本地 API)
   ============================================================ */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function toast(msg, type) {
  const el = $('toast');
  if (!el) return;
  el.innerHTML = `<span class="material-symbols-outlined text-[18px] ${type === 'ok' ? 'text-success' : 'text-error'}">${type === 'ok' ? 'check_circle' : 'error'}</span> ${esc(msg)}`;
  el.className = 'fixed bottom-7 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-6 py-3 rounded-xl shadow-2xl bg-[#111827] text-white text-sm font-medium';
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.className = 'fixed bottom-7 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-6 py-3 rounded-xl shadow-2xl bg-[#111827] text-white text-sm font-medium opacity-0 pointer-events-none transition-all duration-300';
  }, 3000);
}
async function api(u, method, body) {
  const o = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (body) o.body = JSON.stringify(body);
  const r = await fetch(u, o);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || d.message || 'HTTP ' + r.status);
  return d;
}
function toggleSidebar() {
  const s = $('sidebar'), o = $('sidebarOverlay');
  if (!s) return;
  if (s.classList.contains('open')) { s.classList.remove('open'); if(o)o.style.display='none'; }
  else { s.classList.add('open'); if(o)o.style.display='block'; }
}
function closeSidebar() {
  const s = $('sidebar'), o = $('sidebarOverlay');
  if(s)s.classList.remove('open'); if(o)o.style.display='none';
}
function closeModal() {
  const m = $('modal'), o = $('sidebarOverlay'), s = $('sidebar');
  if(m)m.innerHTML=''; if(m)m.classList.add('hidden');
  if(o)o.style.display='none'; if(s)s.classList.remove('open');
}
function showModal(html) {
  const m = $('modal');
  if (!m) return;
  m.innerHTML = `<div class="absolute inset-0 bg-black/30 backdrop-blur-sm" onclick="closeModal()"></div><div class="relative bg-surface rounded-2xl shadow-2xl w-[480px] max-w-[92vw] max-h-[85vh] overflow-y-auto p-6 animate-modal-in">${html}</div>`;
  const o = $('sidebarOverlay'); if(o)o.style.display='none';
  m.classList.remove('hidden');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function toggleTheme() {
  const h = document.documentElement, btn = $('themeBtn');
  if (h.classList.contains('dark')) {
    h.classList.remove('dark'); h.classList.add('light');
    if(btn)btn.innerHTML='<span class="material-symbols-outlined text-xl">dark_mode</span>';
    localStorage.setItem('theme','light');
  } else {
    h.classList.remove('light'); h.classList.add('dark');
    if(btn)btn.innerHTML='<span class="material-symbols-outlined text-xl">light_mode</span>';
    localStorage.setItem('theme','dark');
  }
}
(function(){
  const s = localStorage.getItem('theme');
  if (s === 'dark' || (!s && matchMedia('(prefers-color-scheme:dark)').matches)) {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    const btn = $('themeBtn'); if(btn)btn.innerHTML='<span class="material-symbols-outlined text-xl">light_mode</span>';
  }
})();

let currentTab = 'dashboard';
const titles = { dashboard:'仪表盘', audit:'用量审计', keys:'密钥管理', proxies:'代理池', sources:'代理源', config:'系统配置', logs:'系统日志' };
const loaders = { dashboard: fetchDashboard, audit: fetchAudit, keys: fetchKeys, proxies: fetchProxies, sources: fetchSources, config: fetchConfig, logs: fetchLogs };

document.addEventListener('DOMContentLoaded', function() {
  const nav = $('nav');
  if(nav) nav.addEventListener('click', function(e) {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    currentTab = a.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    const panel = $('tab-' + currentTab); if(panel) panel.classList.remove('hidden');
    document.querySelectorAll('#nav [data-tab]').forEach(x => {
      x.classList.remove('bg-primary-container','text-on-primary-container','font-medium');
      x.classList.add('text-secondary');
    });
    a.classList.remove('text-secondary');
    a.classList.add('bg-primary-container','text-on-primary-container','font-medium');
    const pt = $('pageTitle'); if(pt) pt.textContent = titles[currentTab];
    if (loaders[currentTab]) loaders[currentTab]();
  });
  const first = document.querySelector('#nav [data-tab="dashboard"]');
  if(first) { first.classList.remove('text-secondary'); first.classList.add('bg-primary-container','text-on-primary-container','font-medium'); }
  setTimeout(() => { if(loaders.dashboard) loaders.dashboard(); }, 100);
});

const timers = {};
function startRefresh(tab, fn, interval) {
  if (timers[tab]) clearInterval(timers[tab]);
  timers[tab] = setInterval(() => { if (currentTab === tab) fn(); }, interval);
}

async function doAction(path, btn) {
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">sync</span>';
  btn.disabled = true;
  try { await api('/api/' + path, 'POST', {}); toast('操作成功: '+path, 'ok'); }
  catch (e) { toast('操作失败: '+e.message, 'err'); }
  btn.innerHTML = orig; btn.disabled = false;
  if (currentTab === 'dashboard') fetchDashboard();
}

function statCard(icon, label, value, sub, color) {
  const colors = { primary:'bg-primary/10 text-primary', success:'bg-success/10 text-success', warning:'bg-warning/10 text-warning', info:'bg-info/10 text-info', red:'bg-error/10 text-error' };
  const c = colors[color] || colors.primary;
  return `<div class="bg-surface rounded-xl border border-border p-5 ambient-shadow hover:shadow-md hover:border-primary/30 transition-all">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-9 h-9 rounded-full ${c} flex items-center justify-center"><span class="material-symbols-outlined text-lg">${icon}</span></div>
        <span class="text-label-md text-secondary">${esc(label)}</span>
      </div>
      <div class="flex items-end gap-2 mt-2">
        <span class="text-display-lg text-on-surface font-bold tracking-tight">${esc(value == null ? '0' : String(value))}</span>
        ${sub != null ? `<span class="text-body-md text-secondary mb-1">/ ${esc(String(sub))}</span>` : ''}
      </div>
    </div>`;
}
function badge(text, type) {
  const t = { green:'bg-success/10 text-success', amber:'bg-warning/10 text-warning', red:'bg-error/10 text-error', blue:'bg-info/10 text-info', gray:'bg-surface-container-high text-secondary', active:'bg-success/10 text-success', pending:'bg-warning/10 text-warning', disabled:'bg-surface-container-high text-secondary' };
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-label-md font-medium ${t[type] || t.gray}">${esc(text)}</span>`;
}
function renderTable(headers, rows, emptyMsg) {
  if (!rows || !rows.length) return `<div class="text-center py-12"><span class="material-symbols-outlined text-5xl text-secondary/30 block mb-3">database</span><p class="text-body-md text-secondary">${esc(emptyMsg || '暂无数据')}</p></div>`;
  return `<table class="w-full text-body-md"><thead><tr class="border-b border-outline-variant bg-surface-container-low">${headers.map(h => `<th class="text-left px-4 py-3 text-label-md text-secondary font-semibold">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}
function statRow(cells) {
  return `<tr class="border-b border-outline-variant hover:bg-surface-container-low transition-colors">${cells.map(c => `<td class="px-4 py-3">${c}</td>`).join('')}</tr>`;
}
function skeletonCards(count) {
  let h = '';
  for(let i=0;i<count;i++) h += `<div class="bg-surface rounded-xl border border-border p-5 ambient-shadow animate-pulse"><div class="h-3 w-20 bg-surface-container-high rounded mb-3"></div><div class="h-7 w-14 bg-surface-container-high rounded"></div></div>`;
  return h;
}

/* ===== DASHBOARD ===== */
async function fetchDashboard() {
  startRefresh('dashboard', fetchDashboard, 10000);
  try {
    const s = await api('/api/status');
    const st = s.stats || {};
    const sc = $('statCards');
    if(sc) sc.innerHTML = statCard('key','API Key 总数', s.totalApiKeys||0, null, 'primary') + statCard('speed','活跃 Key', s.activeKeys||0, s.maxActiveKeys||20, 'info') + statCard('bar_chart','请求总数', st.total||0, null, 'warning') + statCard('public','代理池规模', s.candidatesCount||0, null, 'success');
    const ws = $('warpStatus');
    if(ws) ws.innerHTML = `<span class="w-2 h-2 rounded-full ${s.warpAvailable?'bg-success':'bg-muted'}"></span> ${esc(s.warpStatus||'unknown')}`;
    const pools = s.pools || [];
    const ksc = $('keySlotCount'); if(ksc) ksc.textContent = pools.length + ' 个活跃 Key';
    const ksw = $('keySlotWrap');
    if(ksw) {
      if(pools.length) {
        ksw.innerHTML = renderTable(['Key','名称','槽位','代理地址','延时','质量','请求数','最后使用'],
          pools.map(p => statRow([
            `<code class="text-mono-md px-1.5 py-0.5 bg-surface-container-high rounded">${esc(p.key)}</code>`, esc(p.name||''),
            badge((p.slots?p.slots.length:0)+' / 3', (p.slots&&p.slots.length)?'active':'pending'),
            `<span class="text-sm">${p.slots&&p.slots.length ? p.slots.map(sl => `<code class="text-mono-md px-1.5 py-0.5 bg-surface-container-high rounded">${esc(sl.addr)}</code>`).join('<br>') : '<span class="text-secondary">无</span>'}</span>`,
            p.slots&&p.slots.length ? p.slots.map(sl => badge(sl.latencyMs+'ms', sl.latencyMs<500?'green':sl.latencyMs<2000?'amber':'red')).join('<br>') : '-',
            p.slots&&p.slots.length ? p.slots.map(sl => badge(sl.grade||'C', sl.grade==='S'?'green':sl.grade==='A'?'blue':'gray')).join('<br>') : '-',
            p.requestCount||0, p.lastUsedAt ? new Date(p.lastUsedAt).toLocaleString('zh-CN') : '从未'
          ]))
        );
      } else {
        ksw.innerHTML = `<div class="text-center py-12"><span class="material-symbols-outlined text-5xl text-secondary/30 block mb-3">lan</span><p class="text-body-md text-secondary">暂无活跃 Key</p></div>`;
      }
    }
    fetchModels(); fetchDashboardKeys();
  } catch(e) { const sc = $('statCards'); if(sc) sc.innerHTML = skeletonCards(4); }
}

async function fetchModels() {
  try {
    const s = await api('/api/models');
    const el = $('testModel'); if(!el) return;
    const prev = el.value || localStorage.getItem('lastTestModel') || '';
    el.innerHTML = s.models && s.models.length ? s.models.map(m => `<option value="${esc(m.id)}">${esc(m.id)}</option>`).join('') : '<option>无可用模型</option>';
    if (prev && s.models && s.models.some(m => m.id === prev)) {
      el.value = prev;
    }
    localStorage.setItem('lastTestModel', el.value || '');
    el.addEventListener('change', () => localStorage.setItem('lastTestModel', el.value));
  } catch(_) { const el = $('testModel'); if(el) el.innerHTML = '<option>加载失败</option>'; }
}

async function fetchDashboardKeys() {
  try {
    const s = await api('/api/keys');
    const k = s.keys || [];
    const enabled = k.filter(x => x.enabled !== false);
    const el = $('testKeySelect'); if(!el) return;
    el.innerHTML = enabled.length ? enabled.map((x,i) => `<option value="${esc(x.fullKey||x.key)}"${i===0?' selected':''}>${esc(x.name||x.key.slice(0,8))}</option>`).join('') : '<option value="">无可用密钥</option>';
  } catch(_) {}
}

async function sendTest() {
  const btn = $('testBtn'), mod = $('testModel'), msg = $('testPrompt'), key = $('testKeySelect'), streamCb = $('testStream');
  if (!btn||!mod||!msg||!key) return;
  if (!msg.value) { toast('请输入消息','err'); return; }
  btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">sync</span> 发送中...'; btn.disabled = true;
  const res = $('testResult');
  if (!res) return;
  res.className = 'mt-3 p-3 rounded-2xl bg-surface-container-low border border-border text-body-md max-h-96 overflow-y-auto font-mono whitespace-pre-wrap';
  res.innerHTML = '<span class="text-secondary animate-pulse">等待响应...</span>';

  const useStream = streamCb ? streamCb.checked : false;
  try {
    const h = {'Content-Type':'application/json'};
    if(key.value) h['Authorization'] = 'Bearer '+key.value;

    if (useStream) {
      // === 流式模式 ===
      const resp = await fetch('/openai/v1/chat/completions', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({model:mod.value,messages:[{role:'user',content:msg.value}],stream:true})
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let usageInfo = '';
      res.innerHTML = '';
      const outDiv = res;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
            if (chunk.usage) {
              const u = chunk.usage;
              usageInfo = `\n\n—— 结束 ——\nTokens: ${u.total_tokens || u.totalTokens || '?'} (prompt: ${u.prompt_tokens || u.promptTokens || '?'}, completion: ${u.completion_tokens || u.completionTokens || '?'})`;
            }
            outDiv.innerHTML = esc(content) + (usageInfo ? `<span class="text-secondary/60 block mt-3 pt-2 border-t border-border text-label-md">${usageInfo}</span>` : '');
          } catch {}
        }
      }
      // 处理可能的剩余 buffer
      if (!usageInfo && content) {
        outDiv.innerHTML = esc(content) + `<span class="text-secondary/60 block mt-3 pt-2 border-t border-border text-label-md">—— 流式结束 ——</span>`;
      }
    } else {
      // === 非流式模式 ===
      const r = await fetch('/openai/v1/chat/completions',{method:'POST',headers:h,body:JSON.stringify({model:mod.value,messages:[{role:'user',content:msg.value}],stream:false})});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error&&d.error.message?d.error.message:JSON.stringify(d));
      const content = d.choices&&d.choices[0]?d.choices[0].message.content:JSON.stringify(d);
      const usage = d.usage?`Tokens: ${d.usage.total_tokens} (prompt: ${d.usage.prompt_tokens}, completion: ${d.usage.completion_tokens})`:'';
      res.innerHTML = `<span class="flex items-center gap-1 text-success mb-1"><span class="material-symbols-outlined text-lg">check_circle</span> 成功</span>` + esc(content) + (usage ? `<span class="text-secondary/60 block mt-2 pt-2 border-t border-border text-label-md">${usage}</span>` : '');
    }
  } catch(e) {
    res.className = 'mt-3 p-3 rounded-2xl bg-error/5 border border-error/30 text-body-md whitespace-pre-wrap';
    res.innerHTML = `<span class="flex items-center gap-1 text-error mb-1"><span class="material-symbols-outlined text-lg">error</span> 错误</span><code class="text-mono-md">${esc(e.message)}</code>`;
  }
  btn.innerHTML = '<span class="material-symbols-outlined text-lg">send</span> 发送测试'; btn.disabled = false;
}

/* ===== AUDIT ===== */
async function fetchAudit() {
  try {
    const s = await api('/api/audit');
    const sum = s.summary || {};
    const ac = $('auditCards');
    if(ac) ac.innerHTML = statCard('bar_chart','总请求', sum.totalRequests||0, null, 'primary') + statCard('token','总 Token', sum.totalTokens||0, null, 'success') + statCard('data_usage','Prompt', sum.totalPrompt||0, 'Completion: '+(sum.totalCompletion||0), 'info') + `<div class="bg-surface rounded-xl border border-border p-5 ambient-shadow hover:shadow-md hover:border-primary/30 transition-all"><div class="flex items-center gap-3 mb-2"><div class="w-9 h-9 rounded-full bg-warning/10 text-warning flex items-center justify-center"><span class="material-symbols-outlined text-lg">cached</span></div><span class="text-label-md text-secondary">缓存命中率</span></div><div class="flex items-end gap-1 mt-2"><span class="text-display-lg text-on-surface font-bold tracking-tight">${(sum.cacheHitRate||0)*100}</span><span class="text-title-md text-secondary mb-1">%</span></div></div>`;
    const at = $('auditTable');
    if(at) {
      const days = s.days || [];
      if(days.length) {
        at.innerHTML = renderTable(['日期','请求数','Token','Prompt','Completion','缓存读取'], days.map(d => statRow([d.date||'-', d.requests||0, d.totalTokens||0, d.promptTokens||0, d.completionTokens||0, d.cacheRead||0])));
      } else {
        at.innerHTML = `<div class="text-center py-12"><span class="material-symbols-outlined text-5xl text-secondary/30 block mb-3">bar_chart</span><p class="text-body-md text-secondary">暂无调用记录</p></div>`;
      }
    }
  } catch(e) { const ac = $('auditCards'); if(ac) ac.innerHTML = skeletonCards(4); }
}

/* ===== KEYS ===== */
let allKeys = [];
async function fetchKeys() {
  try { const s = await api('/api/keys'); allKeys = s.keys || []; renderKeys(allKeys); }
  catch(e) { const kc = $('keyCards'); if(kc) kc.innerHTML = skeletonCards(4); }
}
function filterKeys() {
  const q = ($('keySearch')||{}).value||'';
  const f = allKeys.filter(k => (k.name||'').toLowerCase().includes(q)||(k.key||'').toLowerCase().includes(q)||(k.fullKey||'').toLowerCase().includes(q));
  renderKeys(f, q);
}
function renderKeys(keys, q) {
  const total = keys.length, enabled = keys.filter(k => k.enabled!==false).length, disabled = total - enabled;
  const expired = keys.filter(k => k.expiresAt>0&&k.expiresAt<Date.now()).length;
  const kc = $('keyCards');
  if(kc) kc.innerHTML = statCard('vpn_key','密钥总数', total, null, 'primary') + statCard('check_circle','已启用', enabled, null, 'success') + statCard('block','已禁用', disabled, null, 'red') + statCard('schedule','已过期', expired, null, 'warning');
  const kt = $('keyTable'); if(!kt) return;
  kt.innerHTML = renderTable(['Key','名称','状态','并发','总请求','总 Token','到期时间','操作'],
    keys.map(k => {
      const isExpired = k.expiresAt>0&&k.expiresAt<Date.now();
      const status = isExpired?'expired':(k.enabled!==false?'active':'disabled');
      const statusLabel = isExpired?'已过期':(k.enabled!==false?'已启用':'已禁用');
      return statRow([
        `<code class="text-mono-md px-1.5 py-0.5 bg-surface-container-high rounded">${esc(k.fullKey||k.key)}</code>`, esc(k.name||'-'), badge(statusLabel, status), k.maxConcurrency||'-', k.totalRequests||0, k.totalTokens||0,
        k.expiresAt?new Date(k.expiresAt).toLocaleString('zh-CN'):'永不',
        `<div class="flex gap-1"><button onclick="editKey('${k.key}')" class="flex items-center justify-center w-8 h-8 rounded-2xl text-secondary hover:bg-surface-container-high hover:text-primary transition-colors cursor-pointer"><span class="material-symbols-outlined text-[18px]">edit</span></button>`+
        `<button onclick="toggleKey('${k.key}')" class="flex items-center justify-center w-8 h-8 rounded-2xl text-secondary hover:bg-surface-container-high ${k.enabled!==false?'hover:text-warning':'hover:text-success'} transition-colors cursor-pointer"><span class="material-symbols-outlined text-[18px]">${k.enabled!==false?'pause':'play_arrow'}</span></button>`+
        `<button onclick="deleteKey('${k.key}')" class="flex items-center justify-center w-8 h-8 rounded-2xl text-secondary hover:bg-surface-container-high hover:text-error transition-colors cursor-pointer"><span class="material-symbols-outlined text-[18px]">delete</span></button></div>`
      ]);
    }), q?'未找到匹配「'+esc(q)+'」的密钥':'暂无密钥，点击上方「创建密钥」添加'
  );
}

function showCreateKey() {
  showModal(`<h3 class="text-headline-sm font-bold text-on-surface mb-5 flex items-center gap-2"><span class="material-symbols-outlined text-primary">add_circle</span> 创建新密钥</h3>
    <div class="space-y-4">
      <div><label class="text-label-md text-secondary block mb-1.5">名称</label><input id="newKeyName" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" placeholder="例如：开发环境密钥"/></div>
      <div><label class="text-label-md text-secondary block mb-1.5">并发限制</label><input id="newKeyConcurrency" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" type="number" value="3"/></div>
      <div><label class="text-label-md text-secondary block mb-1.5">最大请求数</label><input id="newKeyMaxReqs" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" type="number" placeholder="0 表示不限"/></div>
      <div><label class="text-label-md text-secondary block mb-1.5">过期时间</label><input id="newKeyExpires" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" type="datetime-local"/></div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="createKey()" class="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-2xl text-label-md hover:bg-primary-container transition-colors shadow-sm active:scale-[0.98] cursor-pointer"><span class="material-symbols-outlined text-lg">add</span> 创建</button>
      <button onclick="closeModal()" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-border text-secondary rounded-2xl text-label-md hover:border-primary hover:text-primary transition-colors cursor-pointer">取消</button>
    </div>`);
}
async function createKey() {
  const name = ($('newKeyName')||{}).value||'';
  const concurrency = parseInt(($('newKeyConcurrency')||{}).value)||3;
  const maxReqs = ($('newKeyMaxReqs')||{}).value ? parseInt($('newKeyMaxReqs').value) : 0;
  const expires = ($('newKeyExpires')||{}).value ? new Date($('newKeyExpires').value).getTime() : 0;
  try { await api('/api/keys','POST',{name, maxConcurrency:concurrency, maxRequests:maxReqs, expiresAt:expires}); toast('密钥创建成功','ok'); closeModal(); fetchKeys(); }
  catch(e) { toast('创建失败: '+e.message,'err'); }
}
function editKey(keyId) {
  const k = allKeys.find(x => x.key === keyId); if(!k) return;
  showModal(`<h3 class="text-headline-sm font-bold text-on-surface mb-5 flex items-center gap-2"><span class="material-symbols-outlined text-primary">edit</span> 编辑密钥</h3>
    <div class="space-y-4">
      <div><label class="text-label-md text-secondary block mb-1.5">Key</label><code class="block px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-mono-md">${esc(k.fullKey||k.key)}</code></div>
      <div><label class="text-label-md text-secondary block mb-1.5">名称</label><input id="editKeyName" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" value="${esc(k.name||'')}"/></div>
      <div><label class="flex items-center gap-2 cursor-pointer"><input id="editKeyEnabled" type="checkbox" class="w-4 h-4 rounded border-border text-primary focus:ring-primary/20" ${k.enabled!==false?'checked':''}/><span class="text-body-md text-secondary">启用此密钥</span></label></div>
      <div><label class="text-label-md text-secondary block mb-1.5">并发限制</label><input id="editKeyConcurrency" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" type="number" value="${k.maxConcurrency||3}"/></div>
      <div><label class="text-label-md text-secondary block mb-1.5">最大请求数</label><input id="editKeyMaxReqs" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" type="number" value="${k.maxRequests||0}" placeholder="0 表示不限"/></div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="doEditKey('${keyId}')" class="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-2xl text-label-md hover:bg-primary-container transition-colors shadow-sm active:scale-[0.98] cursor-pointer"><span class="material-symbols-outlined text-lg">save</span> 保存</button>
      <button onclick="closeModal()" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-border text-secondary rounded-2xl text-label-md hover:border-primary hover:text-primary transition-colors cursor-pointer">取消</button>
    </div>`);
}
async function doEditKey(keyId) {
  const name = ($('editKeyName')||{}).value||'';
  const enabled = ($('editKeyEnabled')||{}).checked !== false;
  const concurrency = parseInt(($('editKeyConcurrency')||{}).value)||3;
  const maxReqs = ($('editKeyMaxReqs')||{}).value ? parseInt($('editKeyMaxReqs').value) : 0;
  try { await api('/api/keys/'+keyId,'PUT',{name, enabled, maxConcurrency:concurrency, maxRequests:maxReqs}); toast('密钥更新成功','ok'); closeModal(); fetchKeys(); }
  catch(e) { toast('更新失败: '+e.message,'err'); }
}
async function toggleKey(keyId) {
  try {
    const k = allKeys.find(x => x.key === keyId);
    await api('/api/keys/'+keyId,'PUT',{enabled: !k || k.enabled === false});
    toast('密钥状态已切换','ok'); fetchKeys();
  } catch(e) { toast('操作失败: '+e.message,'err'); }
}
async function deleteKey(keyId) {
  if(!confirm('确定删除此密钥？不可撤销。')) return;
  try { await api('/api/keys/'+keyId,'DELETE'); toast('密钥已删除','ok'); fetchKeys(); }
  catch(e) { toast('删除失败: '+e.message,'err'); }
}

/* ===== PROXIES ===== */
async function fetchProxies() {
  startRefresh('proxies', fetchProxies, 15000);
  try {
    const s = await api('/api/proxies');
    const list = s.proxies || [];
    const pc = $('proxyCards');
    if(pc) pc.innerHTML = statCard('router','代理总数', s.count||0, null, 'primary') + statCard('check_circle','已锁定', list.filter(x=>x.lockedBy).length||0, null, 'success') + statCard('error','空闲', list.filter(x=>!x.lockedBy).length||0, null, 'info') + statCard('electrical_services','备用池', s.releasedCount||0, null, 'warning');
    const pt = $('proxyTable');
    if(pt) {
      if(list.length) {
        pt.innerHTML = renderTable(['地址','协议','质量','延迟','状态','操作'],
          list.slice(0,100).map(p => statRow([
            `<code class="text-mono-md">${esc(p.address)}</code>`, esc(p.protocol||'http'),
            badge(p.quality_grade||'C', p.quality_grade==='S'?'green':p.quality_grade==='A'?'blue':'gray'),
            (p.latency||'-')+'ms', p.lockedBy ? badge('已锁定','active') : badge('空闲','gray'),
            `<button onclick="promoteProxy('${esc(p.address)}')" class="flex items-center justify-center w-8 h-8 rounded-2xl text-secondary hover:bg-surface-container-high hover:text-primary transition-colors cursor-pointer" title="提升优先级"><span class="material-symbols-outlined text-[18px]">arrow_upward</span></button>`
          ]))
        );
      } else {
        pt.innerHTML = `<div class="text-center py-12"><span class="material-symbols-outlined text-5xl text-secondary/30 block mb-3">router</span><p class="text-body-md text-secondary">暂无代理数据</p></div>`;
      }
    }
  } catch(e) { const pc = $('proxyCards'); if(pc) pc.innerHTML = skeletonCards(4); }
}
async function promoteProxy(addr) {
  try { await api('/api/promote','POST',{addr}); toast('代理已提升优先级','ok'); fetchProxies(); }
  catch(e) { toast('操作失败: '+e.message,'err'); }
}

function showImportProxies() {
  showModal(`<h3 class="text-headline-sm font-bold text-on-surface mb-5 flex items-center gap-2"><span class="material-symbols-outlined text-primary">playlist_add</span> 批量导入代理</h3>
    <p class="text-body-md text-secondary mb-4">每行一个代理地址，支持格式：<code class="text-mono-md bg-surface-container-low px-2 py-0.5 rounded-lg">http://host:port</code> <code class="text-mono-md bg-surface-container-low px-2 py-0.5 rounded-lg">socks5://host:port</code></p>
    <textarea id="importProxyText" class="w-full h-44 px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-mono-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none resize-y" placeholder="socks5://1.2.3.4:1080&#10;http://5.6.7.8:3128&#10;socks5://9.10.11.12:1080"></textarea>
    <p id="importProxyStatus" class="text-label-md text-secondary mt-2 hidden"></p>
    <div class="flex gap-3 mt-5">
      <button onclick="importProxies()" id="importProxyBtn" class="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-2xl text-label-md hover:bg-primary-container transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"><span class="material-symbols-outlined text-lg">upload</span> 导入</button>
      <button onclick="closeModal()" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-border text-secondary rounded-2xl text-label-md hover:border-primary hover:text-primary transition-colors cursor-pointer">取消</button>
    </div>`);
}

async function importProxies() {
  const btn = $('importProxyBtn');
  const ta = $('importProxyText');
  const st = $('importProxyStatus');
  if (!btn || !ta) return;
  const lines = ta.value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (!lines.length) { toast('请输入代理地址','err'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">sync</span> 导入中...';
  if (st) { st.className = 'text-label-md text-secondary mt-2'; st.textContent = ''; }
  try {
    // 分批导入，每批 50 个
    const batchSize = 50;
    let total = 0;
    for (let i = 0; i < lines.length; i += batchSize) {
      const batch = lines.slice(i, i + batchSize);
      const r = await api('/api/proxies', 'POST', { proxies: batch });
      total += r.count || 0;
      if (st) st.textContent = `进度: ${Math.min(i+batchSize, lines.length)}/${lines.length} (已添加 ${total} 个)`;
    }
    if (st) st.className = 'text-label-md text-success mt-2';
    toast(`导入完成: 共 ${total} 个代理已添加`,'ok');
    closeModal();
    fetchProxies();
  } catch(e) {
    toast('导入失败: '+e.message,'err');
    if (st) { st.className = 'text-label-md text-error mt-2'; st.textContent = '失败: '+e.message; }
  }
  btn.disabled = false;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg">upload</span> 导入';
}

/* ===== SOURCES ===== */
async function fetchSources() {
  try {
    const s = await api('/api/sources');
    const list = s.sources || [];
    const st = $('sourceTable');
    if(!st) return;
    if(list.length) {
      st.innerHTML = renderTable(['名称','类型','代理数','状态','操作'],
        list.map(src => statRow([
          esc(src.name||''),
          esc(src.type||'scraper'),
          src.count||0,
          src.error ? badge('异常','red') : badge('正常','green'),
          `<button onclick="deleteSource('${esc(src.name)}')" class="flex items-center justify-center w-8 h-8 rounded-2xl text-secondary hover:bg-error/10 hover:text-error transition-colors cursor-pointer" title="删除"><span class="material-symbols-outlined text-[18px]">delete</span></button>`
        ]))
      );
    } else {
      st.innerHTML = `<div class="text-center py-12"><span class="material-symbols-outlined text-5xl text-secondary/30 block mb-3">source</span><p class="text-body-md text-secondary">暂无代理源，点击上方「添加源」开始</p></div>`;
    }
  } catch(e) { const st = $('sourceTable'); if(st) st.innerHTML = `<div class="text-center py-12"><p class="text-error">加载失败: ${esc(e.message)}</p></div>`; }
}

function showAddSource() {
  showModal(`<h3 class="text-headline-sm font-bold text-on-surface mb-5 flex items-center gap-2"><span class="material-symbols-outlined text-primary">add_circle</span> 添加代理源</h3>
    <div class="space-y-4">
      <div>
        <label class="text-label-md text-secondary block mb-1.5" for="srcName">名称</label>
        <input id="srcName" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" placeholder="例如: my-proxy-source"/>
      </div>
      <div>
        <label class="text-label-md text-secondary block mb-1.5" for="srcUrl">URL</label>
        <input id="srcUrl" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none font-mono text-mono-md" placeholder="https://example.com/proxies.txt"/>
      </div>
      <div>
        <label class="text-label-md text-secondary block mb-1.5" for="srcType">类型</label>
        <select id="srcType" class="w-full px-3 py-2 bg-surface-container-low border border-border rounded-2xl text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none">
          <option value="text">text（纯文本，每行一个）</option>
          <option value="json">json（JSON 数组格式）</option>
          <option value="scraper">scraper（页面抓取）</option>
        </select>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="addSource()" id="addSrcBtn" class="flex-1 flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2.5 rounded-2xl text-label-md hover:bg-primary-container transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"><span class="material-symbols-outlined text-lg">add</span> 添加</button>
      <button onclick="closeModal()" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface border border-border text-secondary rounded-2xl text-label-md hover:border-primary hover:text-primary transition-colors cursor-pointer">取消</button>
    </div>`);
}

async function addSource() {
  const btn = $('addSrcBtn');
  const name = $('srcName')?.value.trim();
  const url = $('srcUrl')?.value.trim();
  const type = $('srcType')?.value || 'text';
  if (!btn || !name || !url) { toast('名称和 URL 必填','err'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">sync</span> 添加中...';
  try {
    await api('/api/sources', 'POST', { name, url, type });
    toast(`代理源 "${name}" 已添加`,'ok');
    closeModal();
    fetchSources();
  } catch(e) {
    toast('添加失败: '+e.message,'err');
  }
  btn.disabled = false;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg">add</span> 添加';
}

async function deleteSource(name) {
  if (!confirm(`确定要删除代理源「${name}」吗？`)) return;
  try {
    await api('/api/sources/'+encodeURIComponent(name), 'DELETE');
    toast(`代理源 "${name}" 已删除`,'ok');
    fetchSources();
  } catch(e) {
    toast('删除失败: '+e.message,'err');
  }
}

/* ===== CONFIG ===== */
async function fetchConfig() {
  try {
    const s = await api('/api/config');
    const cfg = $('cfgPort'); if(cfg) cfg.value = s.port||'13339';
    const cc = $('cfgConcurrency'); if(cc) cc.value = s.maxActiveKeys||20;
    const cs = $('cfgSlotCount'); if(cs) cs.value = s.slotCount||3;
    const cw = $('cfgWarpMode'); if(cw) cw.value = s.warpMode||'off';
    const cf = $('cfgFallback'); if(cf) cf.value = s.fallbackProxy||'';
    const cr = $('cfgRefreshMs'); if(cr) cr.value = s.proxyRefreshMs||300000;
    toast('配置已加载','ok');
  } catch(e) { toast('加载配置失败: '+e.message,'err'); }
}
async function saveConfig() {
  const btn = $('cfgSaveBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[18px]">sync</span> 保存中...';
  try {
    const port = parseInt(($('cfgPort')||{}).value);
    const maxActiveKeys = parseInt(($('cfgConcurrency')||{}).value);
    const slotCount = parseInt(($('cfgSlotCount')||{}).value);
    const refreshMs = parseInt(($('cfgRefreshMs')||{}).value);
    const warpMode = ($('cfgWarpMode')||{}).value;
    const fallback = ($('cfgFallback')||{}).value;
    // 前端校验
    const errors = [];
    if (!port || port < 1 || port > 65535) errors.push('端口范围 1-65535');
    if (!maxActiveKeys || maxActiveKeys < 1 || maxActiveKeys > 100) errors.push('Key 数范围 1-100');
    if (!slotCount || slotCount < 1 || slotCount > 20) errors.push('槽位数范围 1-20');
    if (!refreshMs || refreshMs < 5000 || refreshMs > 600000) errors.push('刷新间隔 5000-600000ms');
    if (fallback && !/^socks5:\/\/.+/.test(fallback)) errors.push('Fallback 格式: socks5://host:port');
    if (errors.length) {
      toast('校验失败: ' + errors.join('; '), 'err');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span> 保存配置';
      return;
    }
    const body = { port, maxActiveKeys, slotCount, warpMode, fallbackProxy: fallback, proxyRefreshMs: refreshMs };
    await api('/api/config','POST', body);
    toast('配置已保存','ok');
    fetchConfig();
  } catch(e) {
    toast('保存失败: '+e.message,'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span> 保存配置';
  }
}

/* ===== LOGS ===== */
async function fetchLogs() {
  startRefresh('logs', fetchLogs, 10000);
  try {
    const s = await api('/api/logs');
    const lb = $('logBox'); if(!lb) return;
    lb.textContent = (s.logs||[]).join('\n')||'暂无日志';
    lb.scrollTop = lb.scrollHeight;
  } catch(e) { const lb = $('logBox'); if(lb) lb.textContent = '加载失败: '+e.message; }
}

/* ===== INIT ===== */
setTimeout(() => { fetchProxies(); fetchSources(); }, 200);
