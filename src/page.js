export const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>岩芯切片登记领还</title>
<style>
:root{--bg:#f1f3ef;--panel:#fff;--ink:#242822;--muted:#687062;--line:#d7ddd1;--accent:#526f43;--warn:#9a5b2e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Arial,"PingFang SC",sans-serif}
header{padding:20px 28px;background:#fff;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
h1{margin:0;font-size:24px}main{padding:20px 28px;display:grid;gap:18px;grid-template-columns:1fr 1fr}
section{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px}section.wide{grid-column:1/-1}
h2{margin:0 0 12px;font-size:17px}label{display:block;margin:8px 0 4px;color:var(--muted);font-size:12px}
input,select,textarea{width:100%;border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit;background:#fff}
button{border:0;border-radius:6px;background:var(--accent);color:#fff;padding:7px 10px;font-weight:700;cursor:pointer;font-size:13px}
button.ghost{background:#eef1ea;color:var(--ink);border:1px solid var(--line)}button.warn{background:var(--warn)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.row>div{flex:1;min-width:120px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:12px}
.pill.已绑定,.pill.已交付,.pill.已归还,.pill.已完成{background:#e9f0e3}.pill.未绑定{background:#f2f2f0}
.pill.隔离,.pill.借出中,.pill.待补片,.pill.作废{background:#f6e6da;color:var(--warn)}
.pill.待观察{background:#e6ecf3}.meta{color:var(--muted);font-size:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px}
.slice{border-top:1px dashed var(--line);margin-top:8px;padding-top:8px;font-size:13px}
.hist{font-size:12px;color:var(--muted);max-height:90px;overflow:auto;margin-top:6px}
.toast{position:fixed;right:20px;bottom:20px;background:#242822;color:#fff;padding:10px 14px;border-radius:8px;display:none;max-width:60%}
@media(max-width:900px){main{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><div><h1>岩芯切片登记领还</h1><div class="meta">一样片一标签码 · 补打留履历换绑重排 · 登记领片 / 归还记箱位 / 破损转补片</div></div><button id="reload">刷新</button></header>
<main>
  <section class="wide">
    <h2>登记样本（样本资料接口）</h2>
    <form id="sampleForm" class="row">
      <div><label>项目</label><input name="project" required></div>
      <div><label>钻孔</label><input name="borehole" required></div>
      <div><label>岩芯箱号</label><input name="coreBox" required></div>
      <div><label>深度</label><input name="depth" required></div>
      <div><label>负责人</label><input name="owner" required></div>
      <div><label>切片编号</label><input name="sliceId" required></div>
      <div><label>染色方法</label><input name="method" required></div>
      <div><button>保存样本</button></div>
    </form>
  </section>

  <section class="wide"><h2>样本与切片</h2><div id="samples"></div></section>

  <section>
    <h2>标签事件</h2>
    <div class="row">
      <div><label>标签码（留空自动生成）</label><input id="lblCode" placeholder="LBL-0001"></div>
      <div><label>直接绑片（旧样本补标签）</label><input id="lblSlice" placeholder="切片编号，可空"></div>
      <div><button id="lblRegister">登记标签</button></div>
    </div>
    <table><thead><tr><th>标签码</th><th>状态</th><th>绑定切片</th><th>履历</th><th>操作</th></tr></thead><tbody id="labels"></tbody></table>
  </section>

  <section>
    <h2>观察员与领还</h2>
    <div class="row">
      <div><label>观察员姓名</label><input id="obsName"></div>
      <div><button id="obsAdd">登记观察员</button></div>
    </div>
    <div class="row" style="margin-top:8px">
      <div><label>观察员</label><select id="obsSel"></select></div>
      <div><label>标签码</label><input id="obsLabel"></div>
      <div><button id="regLabel">登记标签</button></div>
      <div><button class="ghost" id="checkout">领片</button></div>
    </div>
    <table style="margin-top:10px"><thead><tr><th>领片单</th><th>观察员</th><th>标签/切片</th><th>状态</th><th>片况/箱位</th><th>操作</th></tr></thead><tbody id="loans"></tbody></table>
    <h2 style="margin-top:14px">补片单</h2>
    <table><thead><tr><th>单号</th><th>样本</th><th>破损片</th><th>旧标签</th><th>状态</th><th>操作</th></tr></thead><tbody id="reslices"></tbody></table>
  </section>

  <section>
    <h2>观察任务（换绑后旧任务作废、按新标签重排）</h2>
    <table><thead><tr><th>任务</th><th>样本/切片</th><th>标签码</th><th>状态</th><th>操作</th></tr></thead><tbody id="tasks"></tbody></table>
    <h2 style="margin-top:14px">交付结论</h2>
    <table><thead><tr><th>交付单</th><th>样本</th><th>时间</th><th>状态</th></tr></thead><tbody id="deliveries"></tbody></table>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>
let S={samples:[],labels:[],observers:[],loans:[],tasks:[],deliveries:[],reslices:[],registrations:[]};
const $=s=>document.querySelector(s);
function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';setTimeout(()=>e.style.display='none',2600)}
async function api(path,opt){
  const res=await fetch(path,opt?{method:opt.method||'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(opt.body||{})}:undefined);
  const data=await res.json();
  if(!res.ok)throw new Error((data.message||data.error));
  return data;
}
async function load(){
  const [samples,labels,observers,loans,tasks,deliveries,reslices,registrations]=await Promise.all([
    api('/api/samples'),api('/api/labels'),api('/api/observers'),api('/api/loans'),
    api('/api/tasks'),api('/api/deliveries'),api('/api/reslices'),api('/api/registrations')]);
  S={samples,labels,observers,loans,tasks,deliveries,reslices,registrations};render();
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
const steps=['取样','切割','研磨','染色','观察'];

function renderSamples(){
  $('#samples').innerHTML=S.samples.map(sm=>'<div class="card"><b>'+esc(sm.project)+'</b> <span class="pill '+esc(sm.status)+'">'+esc(sm.status)+'</span> '+
    '<span class="pill '+(sm.delivery==='已交付'?'已交付':'')+'">'+esc(sm.delivery)+'</span>'+
    '<div class="meta">'+esc(sm.id)+' · '+esc(sm.borehole)+' · '+esc(sm.coreBox)+' · '+esc(sm.depth)+' · '+esc(sm.owner)+'</div>'+
    sm.slices.map(sl=>{
      const lbl=S.labels.find(l=>l.sliceId===sl.id&&l.status!=='作废');
      return '<div class="slice"><b>'+esc(sl.id)+'</b>'+(sl.damaged?' <span class="pill 作废">破损</span>':'')+
        '<div class="meta">'+esc(sl.method)+' · 步骤 '+esc(sl.status)+(lbl?' · 标签 '+esc(lbl.code):' · <b>无标签（旧样本领用前需补标签）</b>')+'</div>'+
        '<div class="row"><div><select data-step="'+sm.id+'|'+sl.id+'">'+steps.map(x=>'<option '+(x===sl.status?'selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
        '<div style="flex:2"><input data-note="'+sm.id+'|'+sl.id+'" placeholder="步骤备注 / 观察结论"></div>'+
        '<div><button data-log="'+sm.id+'|'+sl.id+'">记录步骤</button></div></div></div>';
    }).join('')+
    '<div class="row" style="margin-top:8px"><div><input data-addslice="'+sm.id+'" placeholder="新增切片编号"></div>'+
    '<div><input data-addmethod="'+sm.id+'" placeholder="染色方法"></div><div><button class="ghost" data-add="'+sm.id+'">加切片</button></div>'+
    '<div><button data-deliver="'+sm.id+'">标记交付</button></div></div></div>').join('');
  document.querySelectorAll('[data-log]').forEach(b=>b.onclick=async()=>{
    const [sid,slid]=b.dataset.log.split('|');
    await act('/api/samples/'+sid+'/slices/'+slid+'/logs',{body:{step:document.querySelector('[data-step="'+sid+'|'+slid+'"]').value,note:document.querySelector('[data-note="'+sid+'|'+slid+'"]').value}});});
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{
    const sid=b.dataset.add;
    await act('/api/samples/'+sid+'/slices',{body:{id:document.querySelector('[data-addslice="'+sid+'"]').value,method:document.querySelector('[data-addmethod="'+sid+'"]').value||'未指定'}});});
  document.querySelectorAll('[data-deliver]').forEach(b=>b.onclick=async()=>{
    const c=prompt('交付结论（可空）','')||'';await act('/api/samples/'+b.dataset.deliver+'/deliver',{body:{conclusion:c}});});
}

function renderLabels(){
  $('#labels').innerHTML=S.labels.map(l=>'<tr><td><b>'+esc(l.code)+'</b>'+(l.supersededBy?'<div class="meta">已换为 '+esc(l.supersededBy)+'</div>':'')+'</td>'+
    '<td><span class="pill '+esc(l.status)+'">'+esc(l.status)+'</span></td><td>'+esc(l.sliceId||'—')+'</td>'+
    '<td class="hist">'+l.history.slice(-3).map(h=>esc(h.type)+' '+esc(h.note)).join('<br>')+'</td>'+
    '<td>'+labelActions(l)+'</td></tr>').join('');
}
function labelActions(l){
  const a=[];
  if(l.status==='未绑定')a.push('<button data-bind="'+esc(l.code)+'">绑片</button>');
  if(l.status==='已绑定'){a.push('<button data-reprint="'+esc(l.code)+'">补打换绑</button>');a.push('<button class="warn" data-quar="'+esc(l.code)+'">隔离</button>');}
  if(l.status==='隔离')a.push('<button class="ghost" data-rel="'+esc(l.code)+'">解除隔离</button>');
  return a.join(' ');
}

function renderLoans(){
  $('#obsSel').innerHTML='<option value="">选择观察员</option>'+S.observers.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join('');
  $('#loans').innerHTML=S.loans.map(n=>'<tr><td>'+esc(n.id)+'</td><td>'+esc(n.observerName)+'</td><td>'+esc(n.labelCode)+'<br><span class="meta">'+esc(n.sliceId)+'</span></td>'+
    '<td><span class="pill '+esc(n.status)+'">'+esc(n.status)+'</span></td><td>'+(n.condition?esc(n.condition)+' · '+esc(n.boxPosition):'—')+'</td>'+
    '<td>'+(n.status==='借出中'?'<button data-ret="'+esc(n.id)+'">归还</button>':'')+'</td></tr>').join('');
  $('#reslices').innerHTML=S.reslices.map(r=>'<tr><td>'+esc(r.id)+'</td><td>'+esc(r.sampleId)+'</td><td>'+esc(r.oldSliceId)+'</td><td>'+esc(r.oldLabelCode)+'</td>'+
    '<td><span class="pill '+esc(r.status)+'">'+esc(r.status)+'</span>'+(r.newSliceId?' → '+esc(r.newSliceId):'')+'</td>'+
    '<td>'+(r.status==='待补片'?'<button data-rsl="'+esc(r.id)+'">补片完成</button>':'')+'</td></tr>').join('');
}

function renderTasks(){
  $('#tasks').innerHTML=S.tasks.map(t=>'<tr><td>'+esc(t.id)+'</td><td>'+esc(t.sampleId)+'<br><span class="meta">'+esc(t.sliceId)+'</span></td><td><b>'+esc(t.labelCode)+'</b></td>'+
    '<td><span class="pill '+esc(t.status)+'">'+esc(t.status)+'</span>'+(t.voidReason?'<div class="meta">'+esc(t.voidReason)+'</div>':'')+'</td>'+
    '<td>'+(t.status==='待观察'?'<button data-done="'+esc(t.id)+'">提交结论</button>':'')+'</td></tr>').join('');
  $('#deliveries').innerHTML=S.deliveries.map(d=>'<tr><td>'+esc(d.id)+'</td><td>'+esc(d.sampleId)+'</td><td class="meta">'+esc(d.at)+'</td><td><span class="pill '+(d.status==='有效'?'已绑定':'作废')+'">'+esc(d.status)+'</span>'+(d.voidReason?'<div class="meta">'+esc(d.voidReason)+'</div>':'')+'</td></tr>').join('');
}

function render(){renderSamples();renderLabels();renderLoans();renderTasks()}

async function act(path,opt){try{await api(path,opt);await load()}catch(e){toast('✗ '+e.message)}}

$('#sampleForm').onsubmit=async e=>{e.preventDefault();await act('/api/samples',{body:Object.fromEntries(new FormData($('#sampleForm').entries()))});$('#sampleForm').reset()};
$('#lblRegister').onclick=()=>act('/api/labels',{body:{code:$('#lblCode').value||undefined,sliceId:$('#lblSlice').value||undefined}});
$('#obsAdd').onclick=()=>act('/api/observers',{body:{name:$('#obsName').value.trim()}});
$('#regLabel').onclick=()=>act('/api/observers/'+$('#obsSel').value+'/register-label',{body:{labelCode:$('#obsLabel').value.trim()}});
$('#checkout').onclick=()=>act('/api/loans/checkout',{body:{observerId:$('#obsSel').value,labelCode:$('#obsLabel').value.trim()}});
$('#reload').onclick=load;

document.addEventListener('click',async e=>{
  const b=e.target;
  if(b.dataset.bind){const s=prompt('绑定到切片编号');if(s)await act('/api/labels/'+b.dataset.bind+'/bind',{body:{sliceId:s}})}
  if(b.dataset.reprint){const reason=confirm('确定 = 标签损坏；取消后请再选「资料变化」。确认补打？')?'标签损坏':(prompt('补打原因（资料变化请输入：资料变化）','资料变化')||'标签损坏');
    const target=prompt('换绑到切片编号（留空表示原片）','')||undefined;const nc=prompt('新标签码（留空自动生成）','')||undefined;
    await act('/api/labels/'+b.dataset.reprint+'/reprint',{body:{reason,sliceId:target,newCode:nc}})}
  if(b.dataset.quar){const r=prompt('隔离原因','')||'隔离';await act('/api/labels/'+b.dataset.quar+'/quarantine',{body:{reason:r}})}
  if(b.dataset.rel)await act('/api/labels/'+b.dataset.rel+'/release',{body:{}});
  if(b.dataset.ret){const box=prompt('归还箱位');if(box){const damaged=confirm('确定=片况完好；取消=片况破损（将转补片）');await act('/api/loans/'+b.dataset.ret+'/return',{body:{boxPosition:box,condition:damaged?'完好':'破损'}})}}
  if(b.dataset.rsl){const ns=prompt('新切片编号');if(ns)await act('/api/reslices/'+b.dataset.rsl+'/complete',{body:{newSliceId:ns,method:prompt('染色方法')||'未指定'}})}
  if(b.dataset.done){const r=prompt('观察结论');if(r!==null)await act('/api/tasks/'+b.dataset.done+'/complete',{body:{result:r}})}
});
load();
</script>
</body>
</html>`;
