import { badRequest, conflict, notFound } from "../errors.js";

// 标签状态：已绑定 / 未绑定 / 隔离 / 作废（作废即旧码，留履历）
export class LabelService {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
  }

  async list() {
    return (await this.store.load()).labels;
  }

  async get(code) {
    const db = await this.store.load();
    const label = db.labels.find(item => item.code === code);
    if (!label) throw notFound("label_not_found");
    return label;
  }

  // 当前绑在某片上的有效标签（作废/已换绑的不算）
  activeLabelForSlice(db, sliceId) {
    return db.labels.find(
      item => item.sliceId === sliceId && item.status !== "作废"
    ) || null;
  }

  // 校验目标片存在、未破损、没有其他有效标签占用
  resolveTarget(db, sliceId) {
    let target = null;
    for (const sample of db.samples) {
      const slice = sample.slices.find(item => item.id === sliceId);
      if (slice) {
        target = { sample, slice };
        break;
      }
    }
    if (!target) throw notFound("slice_not_found");
    if (target.slice.damaged) throw badRequest("slice_damaged", "破损片不能绑定标签，请先补片");
    return target;
  }

  async register(input) {
    const db = await this.store.load();
    const code = input.code || `LBL-${String(db.labels.length + 1).padStart(4, "0")}`;
    if (db.labels.some(item => item.code === code)) throw conflict("label_code_exists", "标签码已存在");

    const label = {
      code,
      status: "未绑定",
      sliceId: null,
      sampleId: null,
      boundAt: null,
      supersededBy: null,
      createdAt: new Date().toISOString(),
      history: [{ at: new Date().toISOString(), type: "registered", note: input.note || "登记新标签" }]
    };

    // 登记时可直接绑片（旧样本补标签的常用入口）
    if (input.sliceId) {
      const target = this.resolveTarget(db, input.sliceId);
      if (this.activeLabelForSlice(db, input.sliceId)) {
        throw conflict("slice_already_labeled", "该片已绑定有效标签，如需换码请走补打换绑");
      }
      Object.assign(label, {
        status: "已绑定",
        sliceId: target.slice.id,
        sampleId: target.sample.id,
        boundAt: label.createdAt
      });
      label.history.push({ at: label.createdAt, type: "bound", note: `绑定切片 ${target.slice.id}` });
      target.sample.history.push({ at: label.createdAt, type: "label_bound", note: `标签 ${code} 绑定 ${target.slice.id}` });
    }

    db.labels.push(label);
    if (label.status === "已绑定") {
      await this.bus.emit("label:bound", { code, sampleId: label.sampleId, sliceId: label.sliceId });
    }
    await this.store.save();
    return label;
  }

  // 未绑定标签绑片（旧样本领用前补标签）
  async bind(code, sliceId, note) {
    const db = await this.store.load();
    const label = await this.get(code);
    if (label.status !== "未绑定") throw conflict("label_not_unbound", `标签当前为「${label.status}」，不能绑定`);
    const target = this.resolveTarget(db, sliceId);
    if (this.activeLabelForSlice(db, sliceId)) throw conflict("slice_already_labeled", "该片已绑定有效标签");

    const at = new Date().toISOString();
    label.status = "已绑定";
    label.sliceId = target.slice.id;
    label.sampleId = target.sample.id;
    label.boundAt = at;
    label.history.push({ at, type: "bound", note: note || `绑定切片 ${sliceId}` });
    target.sample.history.push({ at, type: "label_bound", note: `标签 ${code} 绑定 ${sliceId}` });

    await this.bus.emit("label:bound", { code, sampleId: target.sample.id, sliceId });
    await this.store.save();
    return label;
  }

  // 补打：标签损坏或资料变化时换新码。旧码留履历；换绑后任务与交付结论作废，按新标签重排
  async reprint(code, input) {
    const db = await this.store.load();
    const old = await this.get(code);
    if (old.status === "作废") throw conflict("label_voided", "旧码已作废");
    if (old.status === "隔离") throw conflict("label_quarantined", "隔离标签不能补打，请先解除隔离");
    if (db.loans.some(loan => loan.labelCode === code && loan.status === "借出中")) {
      throw conflict("label_on_loan", "标签对应切片借出中，归还后才能补打");
    }
    const reason = input.reason || "标签损坏";
    if (!["标签损坏", "资料变化"].includes(reason)) {
      throw badRequest("invalid_reason", "补打原因须为 标签损坏 或 资料变化");
    }
    const newCode = input.newCode || `LBL-${String(db.labels.length + 1).padStart(4, "0")}`;
    if (db.labels.some(item => item.code === newCode)) throw conflict("label_code_exists", "新标签码已存在");

    const at = new Date().toISOString();
    const oldSliceId = old.sliceId;
    const oldSampleId = old.sampleId;

    // 资料变化时同步改样本资料
    if (reason === "资料变化" && input.samplePatch && oldSampleId) {
      const sample = db.samples.find(item => item.id === oldSampleId);
      for (const field of ["project", "borehole", "coreBox", "depth", "owner"]) {
        if (input.samplePatch[field] !== undefined) sample[field] = input.samplePatch[field];
      }
      sample.history.push({ at, type: "info_changed", note: `随标签 ${code} 补打更新资料`, reason });
    }

    // 换绑目标：默认原片，也可指定新片（片盒贴错纠正）
    const targetSliceId = input.sliceId || oldSliceId;
    if (!targetSliceId) throw badRequest("no_target_slice", "旧标签未绑片，补打须指定切片");
    const target = this.resolveTarget(db, targetSliceId);

    // 旧码留履历
    old.status = "作废";
    old.supersededBy = newCode;
    old.history.push({
      at,
      type: "reprinted",
      note: `补打换绑，原因：${reason}；新码 ${newCode}；目标片 ${targetSliceId}`
    });
    target.sample.history.push({
      at,
      type: "label_rebound",
      note: `标签换绑 ${code} → ${newCode}（${reason}），切片 ${targetSliceId}`
    });

    const fresh = {
      code: newCode,
      status: "已绑定",
      sliceId: target.slice.id,
      sampleId: target.sample.id,
      boundAt: at,
      supersededBy: null,
      createdAt: at,
      history: [
        { at, type: "registered", note: `补打登记，原因：${reason}` },
        { at, type: "reprint_bound", note: `承接 ${code}，绑定切片 ${targetSliceId}` }
      ]
    };
    db.labels.push(fresh);

    // 换绑：观察任务和交付结论作废，按新标签重排
    if (oldSliceId) {
      await this.bus.emit("label:rebound", {
        oldCode: code,
        newCode,
        oldSliceId,
        newSliceId: target.slice.id,
        sampleId: target.sample.id,
        reason
      });
    } else {
      await this.bus.emit("label:bound", { code: newCode, sampleId: target.sample.id, sliceId: target.slice.id });
    }
    await this.store.save();
    return { old: old, fresh };
  }

  async quarantine(code, reason) {
    const label = await this.get(code);
    if (label.status === "作废") throw conflict("label_voided", "作废标签不能隔离");
    if (label.status === "隔离") throw conflict("already_quarantined", "标签已在隔离中");
    const db = await this.store.load();
    if (db.loans.some(loan => loan.labelCode === code && loan.status === "借出中")) {
      throw conflict("label_on_loan", "标签对应切片借出中，归还后才能隔离");
    }
    const at = new Date().toISOString();
    label.status = "隔离";
    label.history.push({ at, type: "quarantined", note: reason || "隔离" });
    const sample = db.samples.find(item => item.id === label.sampleId);
    sample?.history.push({ at, type: "label_quarantined", note: `标签 ${code} 隔离：${reason || ""}` });
    await this.store.save();
    return label;
  }

  async release(code, note) {
    const label = await this.get(code);
    if (label.status !== "隔离") throw conflict("not_quarantined", "标签不在隔离中");
    const at = new Date().toISOString();
    // 隔离解除后回到与片的绑定关系上；若原片已被其他有效标签占用则保持未绑定
    const db = await this.store.load();
    const occupied = db.labels.some(
      item => item.code !== code && item.sliceId === label.sliceId && item.status === "已绑定"
    );
    const stillBound = Boolean(label.sliceId) && !occupied;
    label.status = stillBound ? "已绑定" : "未绑定";
    if (!stillBound) {
      label.sliceId = null;
      label.sampleId = null;
    }
    label.history.push({ at, type: "released", note: note || "解除隔离" });
    await this.store.save();
    return label;
  }
}
