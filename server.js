import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "core-slices.json");
const port = Number(process.env.PORT || 3025);
const statuses = ["待切割", "制片中", "待观察", "已交付"];
const taskSteps = ["取样", "切割", "研磨", "染色", "观察"];
const reprintReasons = ["损坏", "资料变化"];
const returnConditions = ["完好", "破损"];

const seed = {
  samples: [
    {
      id: "CORE-001",
      project: "东岭铜矿薄片",
      borehole: "ZK-17",
      coreBox: "BX-09",
      depth: "128.4-128.8m",
      owner: "陆川",
      status: "制片中",
      delivery: "未交付",
      slices: [
        { id: "SL-001-A", method: "茜素红染色", observation: "", status: "研磨", circulation: "在库", boxPosition: "BX-09-A-03", labelCode: "LB-0001", logs: [{ at: "2026-06-12T10:00:00.000Z", step: "取样", note: "截取含矿化条带位置" }, { at: "2026-06-13T11:20:00.000Z", step: "切割", note: "完成粗切" }] }
      ]
    }
  ],
  labels: [
    { code: "LB-0001", sampleId: "CORE-001", sliceId: "SL-001-A", status: "有效", createdAt: "2026-06-12T10:05:00.000Z", voidedAt: null, replaces: null, replacedBy: null, history: [{ at: "2026-06-12T10:05:00.000Z", event: "绑定", note: "绑定切片 SL-001-A（东岭铜矿薄片）" }] }
  ],
  loans: []
};

function normalize(db) {
  db.labels ||= [];
  db.loans ||= [];
  for (const sample of db.samples || []) {
    sample.delivery ||= "未交付";
    sample.slices ||= [];
    for (const slice of sample.slices) {
      slice.circulation ||= "在库";
      slice.boxPosition ??= "";
      slice.labelCode ??= null;
      slice.logs ||= [];
    }
  }
  return db;
}

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return normalize(JSON.parse(await readFile(dbPath, "utf8")));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function fail(res, status, error, message) { return sendJson(res, status, { error, message }); }
function now() { return new Date().toISOString(); }
function findLabel(db, code) { return db.labels.find(label => label.code === code); }
function findSlice(db, sampleId, sliceId) {
  const sample = db.samples.find(item => item.id === sampleId);
  const slice = sample ? sample.slices.find(item => item.id === sliceId) : null;
  return { sample, slice };
}
function addLabelEvent(label, event, note, extra = {}) {
  label.history.push({ at: now(), event, note, ...extra });
}
function updateSampleStatus(sample) {
  const sliceStatuses = sample.slices.map(slice => slice.status);
  if (sliceStatuses.length && sliceStatuses.every(step => step === "观察")) sample.status = "待观察";
  if (sample.delivery === "已交付") sample.status = "已交付";
  else if (sliceStatuses.some(step => ["取样", "切割", "研磨", "染色"].includes(step))) sample.status = "制片中";
  else sample.status = "待切割";
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>岩芯样本切片实验室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#242822; --muted:#687062; --line:#d7ddd1; --accent:#526f43; --stone:#73706a; --warn:#8a6d1a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:16px; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:390px 1fr; gap:22px; padding:22px 28px; align-items:start; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; margin-top:8px; }
    .side { display:grid; gap:16px; align-content:start; }
    .stats { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; margin:2px 2px 2px 0; }
    .pill.warn { border-color:#c9a227; color:var(--warn); } .pill.out { border-color:#b3543f; color:#b3543f; }
    .slice { border-top:1px solid var(--line); padding-top:10px; display:grid; gap:6px; } .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
    .panels { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
    .item { border-top:1px solid var(--line); padding:8px 0; }
    @media (max-width:950px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .stats{grid-template-columns:1fr 1fr;} .panels{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>岩芯样本切片实验室</h1><div class="meta">样本资料、标签履历、领还登记各走各的接口；一码一片，换绑重排</div></div><button id="reload">刷新</button></header>
  <main>
    <div class="side">
      <form id="form">
        <h2>创建岩芯样本</h2>
        <label>项目</label><input name="project" required>
        <label>钻孔编号</label><input name="borehole" required>
        <label>岩芯箱号</label><input name="coreBox" required>
        <label>取样深度</label><input name="depth" required>
        <label>负责人</label><input name="owner" required>
        <label>初始切片编号</label><input name="sliceId" required>
        <label>染色方法</label><input name="method" required>
        <button>保存样本</button>
      </form>
      <form id="borrowForm">
        <h2>领片登记</h2>
        <div class="meta">观察员凭已绑定切片的标签码领片；未绑定、已借出、隔离中的标签会被拒绝。</div>
        <label>标签码</label><input name="code" required placeholder="如 LB-0001">
        <label>观察员</label><input name="borrower" required>
        <label>用途</label><input name="purpose" placeholder="岩相观察">
        <button>登记领片</button>
      </form>
      <form id="returnForm">
        <h2>归还登记</h2>
        <div class="meta">归还必须登记片况和箱位；破损片自动转补片并隔离，补片完成前不能再领。</div>
        <label>标签码</label><input name="code" required>
        <label>片况</label><select name="condition"><option>完好</option><option>破损</option></select>
        <label>箱位</label><input name="boxPosition" required placeholder="如 BX-09-A-03">
        <label>备注</label><input name="note" placeholder="破损情况、错位说明等">
        <button>登记归还</button>
      </form>
    </div>
    <section>
      <div class="stats" id="stats"></div>
      <div class="grid" id="samples"></div>
      <div class="panels">
        <div class="panel"><h2>标签履历</h2><div class="meta">一码只绑定一片；补打须写明损坏或资料变化，旧码留履历。</div><div id="labels"></div></div>
        <div class="panel"><h2>领还记录</h2><div class="meta">领片、归还、片况、箱位全程留痕。</div><div id="loans"></div></div>
      </div>
    </section>
  </main>
  <script>
    const statuses = ${JSON.stringify(statuses)};
    const steps = ${JSON.stringify(taskSteps)};
    const reprintReasons = ${JSON.stringify(reprintReasons)};
    const form = document.querySelector("#form");
    const borrowForm = document.querySelector("#borrowForm");
    const returnForm = document.querySelector("#returnForm");
    const stats = document.querySelector("#stats");
    const samplesEl = document.querySelector("#samples");
    const labelsEl = document.querySelector("#labels");
    const loansEl = document.querySelector("#loans");
    let samples = [], labels = [], loans = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }
    const safe = fn => async event => { try { await fn(event); } catch (error) { alert(error.message); } };
    const fmt = at => at ? new Date(at).toLocaleString("zh-CN", { hour12: false }) : "";
    function render() {
      const allSlices = samples.flatMap(sample => sample.slices);
      const statDefs = statuses.map(s => [s, samples.filter(item => item.status === s).length])
        .concat([["借出中", allSlices.filter(slice => slice.circulation === "借出").length], ["隔离中", allSlices.filter(slice => slice.circulation === "隔离").length]]);
      stats.innerHTML = statDefs.map(def => '<div class="stat"><span>'+def[0]+'</span><strong>'+def[1]+'</strong></div>').join("");
      samplesEl.innerHTML = samples.map(sample => '<article class="card"><h3>'+sample.project+'</h3><div><span class="pill">'+sample.status+'</span><span class="pill">'+sample.delivery+'</span></div><div class="meta">'+sample.id+' · '+sample.borehole+' · '+sample.coreBox+' · '+sample.depth+' · '+sample.owner+'</div><label>新增切片</label><input data-new-slice="'+sample.id+'" placeholder="切片编号"><input data-method="'+sample.id+'" placeholder="染色方法"><button data-add="'+sample.id+'">添加切片</button>'+sample.slices.map(slice => {
        const key = sample.id+'|'+slice.id;
        const openLoan = loans.find(loan => loan.sampleId === sample.id && loan.sliceId === slice.id && loan.status === "借出中");
        const labelPart = slice.labelCode
          ? '<span class="pill">标签 '+slice.labelCode+'</span>'
          : '<span class="pill warn">未绑定标签</span>';
        const circPart = '<span class="pill'+(slice.circulation === "在库" ? "" : " out")+'">'+slice.circulation+'</span>';
        const boxPart = slice.boxPosition ? '<span class="pill">箱位 '+slice.boxPosition+'</span>' : '';
        const loanPart = openLoan ? '<div class="meta">借出人 '+openLoan.borrower+' · '+fmt(openLoan.borrowedAt)+'</div>' : '';
        const labelCtl = slice.labelCode
          ? '<label>补打换绑（旧码留履历，观察与交付作废重排）</label><input data-newcode="'+key+'" placeholder="新标签码"><select data-reason="'+key+'">'+reprintReasons.map(reason => '<option>'+reason+'</option>').join("")+'</select><button data-reprint="'+key+'">补打换绑</button>'
          : '<label>旧样本补标签（领用前必须登记）</label><input data-bindcode="'+key+'" placeholder="标签码"><button data-bind="'+key+'">登记标签</button>';
        return '<div class="slice"><b>'+slice.id+'</b><div>'+labelPart+circPart+boxPart+'</div><div class="meta">'+slice.method+' · 当前步骤 '+slice.status+'</div>'+loanPart+labelCtl+'<label>记录步骤</label><select data-step="'+key+'">'+steps.map(step => '<option>'+step+'</option>').join("")+'</select><textarea data-note="'+key+'" placeholder="步骤备注或观察结果"></textarea><button data-log="'+key+'">记录步骤</button><div class="meta">'+slice.logs.map(log => log.step+"："+log.note).join(" / ")+'</div></div>';
      }).join("")+'<button data-deliver="'+sample.id+'">标记交付</button></article>';
      }).join("");
      document.querySelectorAll("[data-step]").forEach(sel => {
        const [sampleId, sliceId] = sel.dataset.step.split("|");
        const slice = samples.find(s => s.id === sampleId).slices.find(s => s.id === sliceId);
        sel.value = slice.status;
      });
      labelsEl.innerHTML = labels.map(label => '<div class="item"><b>'+label.code+'</b> <span class="pill'+(label.status === "有效" ? "" : " warn")+'">'+label.status+'</span><div class="meta">'+label.sampleId+' / '+label.sliceId+(label.replaces ? ' · 接替 '+label.replaces : '')+(label.replacedBy ? ' · 由 '+label.replacedBy+' 接替' : '')+'</div><div class="meta">'+label.history.map(h => fmt(h.at)+'　'+h.event+'：'+h.note).join('<br>')+'</div></div>').join("") || '<div class="meta">暂无标签</div>';
      loansEl.innerHTML = loans.map(loan => '<div class="item"><b>'+loan.code+'</b> <span class="pill'+(loan.status === "借出中" ? " out" : "")+'">'+loan.status+'</span><div class="meta">'+loan.borrower+' · '+(loan.purpose || '观察')+' · 领于 '+fmt(loan.borrowedAt)+(loan.returnedAt ? '<br>还于 '+fmt(loan.returnedAt)+' · 片况 '+loan.condition+' · 箱位 '+loan.boxPosition+(loan.note ? ' · '+loan.note : '') : '')+'</div></div>').join("") || '<div class="meta">暂无领还记录</div>';
      document.querySelectorAll("[data-add]").forEach(btn => btn.onclick = safe(async () => {
        const id = btn.dataset.add;
        await api('/api/samples/'+id+'/slices', { method:'POST', body: JSON.stringify({ id: document.querySelector('[data-new-slice="'+id+'"]').value, method: document.querySelector('[data-method="'+id+'"]').value || "未指定" }) });
        await load();
      }));
      document.querySelectorAll("[data-log]").forEach(btn => btn.onclick = safe(async () => {
        const [sampleId, sliceId] = btn.dataset.log.split("|");
        await api('/api/samples/'+sampleId+'/slices/'+sliceId+'/logs', { method:'POST', body: JSON.stringify({ step: document.querySelector('[data-step="'+sampleId+'|'+sliceId+'"]').value, note: document.querySelector('[data-note="'+sampleId+'|'+sliceId+'"]').value || "步骤完成" }) });
        await load();
      }));
      document.querySelectorAll("[data-deliver]").forEach(btn => btn.onclick = safe(async () => { await api('/api/samples/'+btn.dataset.deliver+'/deliver', { method:'POST', body: JSON.stringify({}) }); await load(); }));
      document.querySelectorAll("[data-bind]").forEach(btn => btn.onclick = safe(async () => {
        const [sampleId, sliceId] = btn.dataset.bind.split("|");
        const code = document.querySelector('[data-bindcode="'+btn.dataset.bind+'"]').value;
        await api('/api/labels', { method:'POST', body: JSON.stringify({ code, sampleId, sliceId }) });
        await load();
      }));
      document.querySelectorAll("[data-reprint]").forEach(btn => btn.onclick = safe(async () => {
        const [sampleId, sliceId] = btn.dataset.reprint.split("|");
        const slice = samples.find(s => s.id === sampleId).slices.find(s => s.id === sliceId);
        const newCode = document.querySelector('[data-newcode="'+btn.dataset.reprint+'"]').value;
        const reason = document.querySelector('[data-reason="'+btn.dataset.reprint+'"]').value;
        await api('/api/labels/'+encodeURIComponent(slice.labelCode)+'/reprint', { method:'POST', body: JSON.stringify({ newCode, reason }) });
        await load();
      }));
    }
    async function load(){
      [samples, labels, loans] = await Promise.all([api("/api/samples"), api("/api/labels"), api("/api/loans")]);
      render();
    }
    document.querySelector("#reload").onclick = safe(load);
    form.onsubmit = safe(async event => {
      event.preventDefault();
      await api("/api/samples", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); await load();
    });
    borrowForm.onsubmit = safe(async event => {
      event.preventDefault();
      await api("/api/loans", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(borrowForm).entries())) });
      borrowForm.reset(); await load();
    });
    returnForm.onsubmit = safe(async event => {
      event.preventDefault();
      await api("/api/loans/return", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(returnForm).entries())) });
      returnForm.reset(); await load();
    });
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" });
      return res.end(page);
    }

    // ---------- 样本资料接口 ----------
    if (req.method === "GET" && url.pathname === "/api/samples") return sendJson(res, 200, db.samples);
    if (req.method === "POST" && url.pathname === "/api/samples") {
      const input = await body(req);
      const sample = { id: `CORE-${Date.now()}`, project: input.project, borehole: input.borehole, coreBox: input.coreBox, depth: input.depth, owner: input.owner, status: "待切割", delivery: "未交付", slices: [{ id: input.sliceId, method: input.method, observation: "", status: "取样", circulation: "在库", boxPosition: "", labelCode: null, logs: [{ at: now(), step: "取样", note: "创建初始切片任务" }] }] };
      updateSampleStatus(sample);
      db.samples.unshift(sample);
      await saveDb(db);
      return sendJson(res, 201, sample);
    }
    const addSlice = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices$/);
    if (addSlice && req.method === "POST") {
      const sample = db.samples.find(item => item.id === decodeURIComponent(addSlice[1]));
      if (!sample) return fail(res, 404, "sample_not_found", "样本不存在");
      const input = await body(req);
      sample.slices.push({ id: input.id, method: input.method || "未指定", observation: "", status: "取样", circulation: "在库", boxPosition: "", labelCode: null, logs: [{ at: now(), step: "取样", note: "新增切片任务" }] });
      updateSampleStatus(sample);
      await saveDb(db);
      return sendJson(res, 201, sample);
    }
    const logMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices\/([^/]+)\/logs$/);
    if (logMatch && req.method === "POST") {
      const sample = db.samples.find(item => item.id === decodeURIComponent(logMatch[1]));
      if (!sample) return fail(res, 404, "sample_not_found", "样本不存在");
      const slice = sample.slices.find(item => item.id === decodeURIComponent(logMatch[2]));
      if (!slice) return fail(res, 404, "slice_not_found", "切片不存在");
      const input = await body(req);
      slice.status = input.step;
      if (input.step === "观察") slice.observation = input.note || slice.observation;
      slice.logs.push({ at: now(), step: input.step, note: input.note || "" });
      if (slice.circulation === "隔离" && input.step === "观察") {
        slice.circulation = "在库";
        slice.logs.push({ at: now(), step: "补片", note: "补片完成，解除隔离，可重新领用" });
      }
      updateSampleStatus(sample);
      await saveDb(db);
      return sendJson(res, 200, sample);
    }
    const deliverMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/deliver$/);
    if (deliverMatch && req.method === "POST") {
      const sample = db.samples.find(item => item.id === decodeURIComponent(deliverMatch[1]));
      if (!sample) return fail(res, 404, "sample_not_found", "样本不存在");
      sample.delivery = "已交付";
      updateSampleStatus(sample);
      await saveDb(db);
      return sendJson(res, 200, sample);
    }

    // ---------- 标签事件接口 ----------
    if (req.method === "GET" && url.pathname === "/api/labels") return sendJson(res, 200, db.labels);
    if (req.method === "POST" && url.pathname === "/api/labels") {
      const input = await body(req);
      const code = String(input.code || "").trim();
      if (!code || !input.sampleId || !input.sliceId) return fail(res, 400, "label_fields_required", "标签码、样本、切片必填");
      if (findLabel(db, code)) return fail(res, 409, "label_code_exists", "标签码已存在（含已作废履历），一码只绑定一片，请换新码");
      const { sample, slice } = findSlice(db, input.sampleId, input.sliceId);
      if (!sample || !slice) return fail(res, 404, "slice_not_found", "样本或切片不存在");
      if (slice.labelCode) return fail(res, 409, "slice_already_bound", `该切片已绑定标签 ${slice.labelCode}，请走补打换绑`);
      const label = { code, sampleId: sample.id, sliceId: slice.id, status: "有效", createdAt: now(), voidedAt: null, replaces: null, replacedBy: null, history: [] };
      addLabelEvent(label, "绑定", `绑定切片 ${slice.id}（${sample.project}）`);
      slice.labelCode = code;
      db.labels.unshift(label);
      await saveDb(db);
      return sendJson(res, 201, label);
    }
    const reprintMatch = url.pathname.match(/^\/api\/labels\/([^/]+)\/reprint$/);
    if (reprintMatch && req.method === "POST") {
      const label = findLabel(db, decodeURIComponent(reprintMatch[1]));
      if (!label) return fail(res, 404, "label_not_found", "标签未登记");
      if (label.status !== "有效") return fail(res, 409, "label_void", "旧标签已作废，不能重复补打");
      const input = await body(req);
      const newCode = String(input.newCode || "").trim();
      if (!reprintReasons.includes(input.reason)) return fail(res, 400, "reprint_reason_required", "补打必须写明原因：损坏或资料变化");
      if (!newCode) return fail(res, 400, "new_code_required", "请提供新标签码");
      if (findLabel(db, newCode)) return fail(res, 409, "label_code_exists", "新标签码已存在（含已作废履历），请换新码");
      const { sample, slice } = findSlice(db, label.sampleId, label.sliceId);
      if (!sample || !slice) return fail(res, 404, "slice_not_found", "标签绑定的切片不存在");
      label.status = "已作废";
      label.voidedAt = now();
      label.replacedBy = newCode;
      addLabelEvent(label, "补打作废", `因${input.reason}补打，新标签 ${newCode}${input.note ? `：${input.note}` : ""}`, { reason: input.reason });
      const next = { code: newCode, sampleId: label.sampleId, sliceId: label.sliceId, status: "有效", createdAt: now(), voidedAt: null, replaces: label.code, replacedBy: null, history: [] };
      addLabelEvent(next, "补打绑定", `旧标签 ${label.code} 因${input.reason}作废，换绑本码`);
      slice.labelCode = newCode;
      slice.observation = "";
      if (slice.status === "观察") slice.status = "染色";
      sample.delivery = "未交付";
      slice.logs.push({ at: now(), step: "换绑", note: `标签 ${label.code} 作废，改用 ${newCode}；观察任务与交付结论作废，按新标签重排` });
      updateSampleStatus(sample);
      db.labels.unshift(next);
      await saveDb(db);
      return sendJson(res, 201, next);
    }
    const labelMatch = url.pathname.match(/^\/api\/labels\/([^/]+)$/);
    if (labelMatch && req.method === "GET") {
      const label = findLabel(db, decodeURIComponent(labelMatch[1]));
      if (!label) return fail(res, 404, "label_not_found", "标签未登记");
      return sendJson(res, 200, label);
    }

    // ---------- 领还接口 ----------
    if (req.method === "GET" && url.pathname === "/api/loans") return sendJson(res, 200, db.loans);
    if (req.method === "POST" && url.pathname === "/api/loans") {
      const input = await body(req);
      const code = String(input.code || "").trim();
      const borrower = String(input.borrower || "").trim();
      if (!code || !borrower) return fail(res, 400, "loan_fields_required", "标签码和观察员必填");
      const label = findLabel(db, code);
      if (!label) return fail(res, 404, "label_not_found", "标签未登记，请先在标签接口登记绑定");
      if (label.status !== "有效") return fail(res, 409, "label_not_bound", "标签已作废、未绑定切片，不能领片");
      const { sample, slice } = findSlice(db, label.sampleId, label.sliceId);
      if (!sample || !slice) return fail(res, 404, "slice_not_found", "标签绑定的切片不存在");
      if (slice.circulation === "借出") return fail(res, 409, "slice_on_loan", "切片已借出，归还前不能再领");
      if (slice.circulation === "隔离") return fail(res, 409, "slice_quarantined", "切片破损隔离中，补片完成前不能再领");
      const loan = { id: `LN-${Date.now()}`, code, sampleId: sample.id, sliceId: slice.id, borrower, purpose: input.purpose || "观察", borrowedAt: now(), returnedAt: null, condition: null, boxPosition: null, note: "", status: "借出中" };
      slice.circulation = "借出";
      db.loans.unshift(loan);
      addLabelEvent(label, "领出", `${borrower} 凭标签领片（${loan.purpose}）`);
      await saveDb(db);
      return sendJson(res, 201, loan);
    }
    if (req.method === "POST" && url.pathname === "/api/loans/return") {
      const input = await body(req);
      const code = String(input.code || "").trim();
      if (!code) return fail(res, 400, "code_required", "请提供标签码");
      if (!returnConditions.includes(input.condition)) return fail(res, 400, "condition_required", "归还须登记片况：完好或破损");
      const boxPosition = String(input.boxPosition || "").trim();
      if (!boxPosition) return fail(res, 400, "box_position_required", "归还须登记箱位");
      const loan = db.loans.find(item => item.code === code && item.status === "借出中");
      if (!loan) return fail(res, 404, "open_loan_not_found", "该标签没有未归还的领用记录");
      const { sample, slice } = findSlice(db, loan.sampleId, loan.sliceId);
      if (!sample || !slice) return fail(res, 404, "slice_not_found", "领用记录的切片不存在");
      const label = findLabel(db, code);
      loan.status = "已归还";
      loan.returnedAt = now();
      loan.condition = input.condition;
      loan.boxPosition = boxPosition;
      loan.note = String(input.note || "");
      slice.boxPosition = boxPosition;
      if (input.condition === "完好") {
        slice.circulation = "在库";
        if (label) addLabelEvent(label, "归还", `片况完好，归位 ${boxPosition}`);
      } else {
        slice.circulation = "隔离";
        slice.status = "取样";
        slice.observation = "";
        slice.logs.push({ at: now(), step: "补片", note: `归还破损，转补片重制，完成前不能再领${loan.note ? `：${loan.note}` : ""}` });
        if (label) addLabelEvent(label, "归还", `片况破损，转补片，归位 ${boxPosition}`);
        updateSampleStatus(sample);
      }
      await saveDb(db);
      return sendJson(res, 200, loan);
    }

    sendJson(res, 404, { error: "not_found", message: "接口不存在" });
  } catch (error) {
    sendJson(res, 500, { error: "server_error", message: error.message });
  }
});

server.listen(port, () => console.log(`Core slice lab app listening on http://localhost:${port}`));
