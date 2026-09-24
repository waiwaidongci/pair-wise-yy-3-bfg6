import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { Store } from "../src/store.js";
import { createApp } from "../src/wiring.js";

const dir = mkdtempSync(join(tmpdir(), "core-lab-"));
const store = new Store(join(dir, "db.json"));
const app = createApp(store);
const base = await new Promise(resolve => {
  app.server.listen(0, () => resolve(`http://127.0.0.1:${app.server.address().port}`));
});

async function call(path, opt = {}) {
  const res = await fetch(base + path, {
    method: opt.method || (opt.body ? "POST" : "GET"),
    headers: opt.body ? { "Content-Type": "application/json" } : undefined,
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}

let sampleId, labelA, labelB, observerId, loanId, oldTaskId;

describe("岩芯切片登记领还全流程", () => {
  test("创建样本与切片", async () => {
    const r = await call("/api/samples", {
      body: { project: "测试矿", borehole: "ZK-1", coreBox: "BX-1", depth: "10m", owner: "甲", sliceId: "SL-1", method: "染色A" }
    });
    assert.equal(r.status, 201);
    sampleId = r.data.id;
    assert.equal(r.data.slices[0].damaged, false);
  });

  test("旧样本无标签：未登记标签的观察员直接领片被拒", async () => {
    let r = await call("/api/observers", { body: { name: "观察员甲" } });
    assert.equal(r.status, 201);
    observerId = r.data.id;
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "NOPE" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "label_not_found");
  });

  test("登记标签并绑定一片；重复绑定同片拒绝", async () => {
    let r = await call("/api/labels", { body: { code: "A-1", sliceId: "SL-1" } });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, "已绑定");
    labelA = "A-1";
    r = await call("/api/labels", { body: { code: "A-2", sliceId: "SL-1" } });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, "slice_already_labeled");
  });

  test("未绑定标签不能登记/领片", async () => {
    let r = await call("/api/labels", { body: { code: "U-1" } });
    assert.equal(r.status, 201);
    r = await call(`/api/observers/${observerId}/register-label`, { body: { labelCode: "U-1" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "label_unbound");
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "U-1" } });
    assert.equal(r.status, 400);
  });

  test("未先登记标签不能领片", async () => {
    const r = await call("/api/loans/checkout", { body: { observerId, labelCode: "A-1" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "not_registered");
  });

  test("登记标签后领片成功；重复领片（已借）拒绝", async () => {
    let r = await call(`/api/observers/${observerId}/register-label`, { body: { labelCode: "A-1" } });
    assert.equal(r.status, 201);
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "A-1" } });
    assert.equal(r.status, 201);
    loanId = r.data.id;
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "A-1" } });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, "label_on_loan");
  });

  test("借出中不能补打/隔离", async () => {
    let r = await call("/api/labels/A-1/reprint", { body: { reason: "标签损坏" } });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, "label_on_loan");
    r = await call("/api/labels/A-1/quarantine", { body: { reason: "x" } });
    assert.equal(r.status, 409);
  });

  test("归还未记箱位被拒；完好归还后记录片况箱位", async () => {
    let r = await call(`/api/loans/${loanId}/return`, { body: { condition: "完好" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "missing_field");
    r = await call(`/api/loans/${loanId}/return`, { body: { condition: "完好", boxPosition: "BX-1/A3" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.loan.condition, "完好");
  });

  test("推进到观察步骤，按已绑标签自动排观察任务", async () => {
    const r = await call(`/api/samples/${sampleId}/slices/SL-1/logs`, { body: { step: "观察", note: "进入观察" } });
    assert.equal(r.status, 200);
    const tasks = (await call("/api/tasks")).data;
    const task = tasks.find(t => t.labelCode === "A-1" && t.status === "待观察");
    assert.ok(task);
    oldTaskId = task.id;
  });

  test("完成观察任务并交付；交付结论有效", async () => {
    let r = await call(`/api/tasks/${oldTaskId}/complete`, { body: { result: "见矿化" } });
    assert.equal(r.status, 200);
    r = await call(`/api/samples/${sampleId}/deliver`, { body: { conclusion: "合格" } });
    assert.equal(r.status, 201);
  });

  test("补打换绑（资料变化）：旧码留履历，旧任务与交付作废，按新标签重排", async () => {
    let r = await call("/api/labels/A-1/reprint", {
      body: { reason: "资料变化", newCode: "B-1", samplePatch: { owner: "乙" } }
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.old.status, "作废");
    assert.equal(r.data.old.supersededBy, "B-1");
    assert.equal(r.data.fresh.status, "已绑定");
    assert.equal(r.data.fresh.sliceId, "SL-1");

    const oldTask = (await call("/api/tasks")).data.find(t => t.id === oldTaskId);
    assert.equal(oldTask.status, "作废");
    const newTask = (await call("/api/tasks")).data.find(t => t.labelCode === "B-1" && t.status === "待观察");
    assert.ok(newTask, "按新标签重排了观察任务");

    const sample = (await call("/api/samples")).data.find(s => s.id === sampleId);
    assert.equal(sample.delivery, "未交付", "交付结论作废");
    assert.equal(sample.owner, "乙", "资料变化已同步");
    const deliveries = (await call("/api/deliveries")).data;
    assert.equal(deliveries[0].status, "作废");
  });

  test("旧码（作废）拒绝登记/领片", async () => {
    let r = await call(`/api/observers/${observerId}/register-label`, { body: { labelCode: "A-1" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "label_voided");
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "A-1" } });
    assert.equal(r.status, 400);
  });

  test("隔离标签拒绝领片", async () => {
    let r = await call("/api/labels/B-1/quarantine", { body: { reason: "片盒存疑" } });
    assert.equal(r.status, 200);
    r = await call(`/api/observers/${observerId}/register-label`, { body: { labelCode: "B-1" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "label_quarantined");
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "B-1" } });
    assert.equal(r.status, 400);
    r = await call("/api/labels/B-1/release", { body: {} });
    assert.equal(r.status, 200);
  });

  test("破损归还：片转破损、标签隔离、生成补片单；补片完成前不能再领", async () => {
    await call(`/api/observers/${observerId}/register-label`, { body: { labelCode: "B-1" } });
    let r = await call("/api/loans/checkout", { body: { observerId, labelCode: "B-1" } });
    assert.equal(r.status, 201);
    const id = r.data.id;
    r = await call(`/api/loans/${id}/return`, { body: { condition: "破损", boxPosition: "BX-9/破损格" } });
    assert.equal(r.status, 200);
    const resliceId = r.data.reslice.id;
    assert.ok(resliceId);

    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "B-1" } });
    assert.equal(r.status, 400, "隔离标签拒绝领片");

    // 完成补片 -> 新片
    r = await call(`/api/reslices/${resliceId}/complete`, { body: { newSliceId: "SL-1-R", method: "染色B" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.order.status, "已完成");
  });

  test("补片后新片补标签，推进观察并可重新领用", async () => {
    let r = await call("/api/labels", { body: { code: "C-1", sliceId: "SL-1-R" } });
    assert.equal(r.status, 201);
    r = await call(`/api/samples/${sampleId}/slices/SL-1-R/logs`, { body: { step: "观察", note: "补片观察" } });
    assert.equal(r.status, 200);
    const task = (await call("/api/tasks")).data.find(t => t.labelCode === "C-1");
    assert.ok(task);
    r = await call(`/api/observers/${observerId}/register-label`, { body: { labelCode: "C-1" } });
    assert.equal(r.status, 201);
    r = await call("/api/loans/checkout", { body: { observerId, labelCode: "C-1" } });
    assert.equal(r.status, 201, "补片完成、新标签登记后可重新领用");
  });

  after(() => {
    app.server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
