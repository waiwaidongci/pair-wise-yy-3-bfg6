import { badRequest, conflict, notFound } from "../errors.js";

export function recomputeSampleStatus(sample) {
  if (sample.delivery === "已交付") {
    sample.status = "已交付";
    return;
  }
  const steps = sample.slices.map(slice => slice.status);
  if (steps.length && steps.every(step => step === "观察")) sample.status = "待观察";
  else if (steps.some(step => ["取样", "切割", "研磨", "染色"].includes(step))) sample.status = "制片中";
  else sample.status = "待切割";
}

export class SampleService {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
  }

  async list() {
    return (await this.store.load()).samples;
  }

  async get(sampleId) {
    const db = await this.store.load();
    const sample = db.samples.find(item => item.id === sampleId);
    if (!sample) throw notFound("sample_not_found");
    return sample;
  }

  findSlice(sample, sliceId) {
    return sample.slices.find(item => item.id === sliceId);
  }

  async locateSlice(sliceLabelRef) {
    const db = await this.store.load();
    for (const sample of db.samples) {
      const slice = sample.slices.find(item => item.id === sliceLabelRef);
      if (slice) return { sample, slice };
    }
    throw notFound("slice_not_found");
  }

  async create(input) {
    const db = await this.store.load();
    for (const field of ["project", "borehole", "coreBox", "depth", "owner", "sliceId", "method"]) {
      if (!input[field]) throw badRequest("missing_field", `缺少字段 ${field}`);
    }
    const exists = db.samples.some(sample => sample.slices.some(slice => slice.id === input.sliceId));
    if (exists) throw conflict("slice_id_exists", "切片编号已存在");
    const sample = {
      id: `CORE-${Date.now()}`,
      project: input.project,
      borehole: input.borehole,
      coreBox: input.coreBox,
      depth: input.depth,
      owner: input.owner,
      status: "待切割",
      delivery: "未交付",
      history: [
        { at: new Date().toISOString(), type: "sample_created", note: "创建样本及初始切片", by: input.owner }
      ],
      slices: [
        {
          id: input.sliceId,
          method: input.method,
          observation: "",
          status: "取样",
          damaged: false,
          logs: [{ at: new Date().toISOString(), step: "取样", note: "创建初始切片任务" }]
        }
      ]
    };
    recomputeSampleStatus(sample);
    db.samples.unshift(sample);
    await this.store.save();
    return sample;
  }

  async addSlice(sampleId, input) {
    const db = await this.store.load();
    const sample = await this.get(sampleId);
    if (!input.id) throw badRequest("missing_field", "缺少切片编号");
    if (this.findSlice(sample, input.id)) throw conflict("slice_id_exists", "切片编号已存在");
    sample.slices.push({
      id: input.id,
      method: input.method || "未指定",
      observation: "",
      status: "取样",
      damaged: false,
      logs: [{ at: new Date().toISOString(), step: "取样", note: "新增切片任务" }]
    });
    sample.history.push({ at: new Date().toISOString(), type: "slice_added", note: `新增切片 ${input.id}` });
    recomputeSampleStatus(sample);
    await this.store.save();
    return sample;
  }

  // 补片完成：新切片加入样本（新标签在标签服务另行登记/绑定）
  async addReslice(sampleId, input) {
    const sample = await this.get(sampleId);
    if (!input.id) throw badRequest("missing_field", "缺少新切片编号");
    if (this.findSlice(sample, input.id)) throw conflict("slice_id_exists", "切片编号已存在");
    sample.slices.push({
      id: input.id,
      method: input.method || "未指定",
      observation: "",
      status: "取样",
      damaged: false,
      logs: [{ at: new Date().toISOString(), step: "取样", note: `补片（补片单 ${input.resliceId || ""}）` }]
    });
    sample.history.push({
      at: new Date().toISOString(),
      type: "reslice_added",
      note: `破损补片完成，新切片 ${input.id}`,
      resliceId: input.resliceId
    });
    recomputeSampleStatus(sample);
    await this.store.save();
    return sample;
  }

  async logStep(sampleId, sliceId, input) {
    const sample = await this.get(sampleId);
    const slice = this.findSlice(sample, sliceId);
    if (!slice) throw notFound("slice_not_found");
    if (slice.damaged) throw badRequest("slice_damaged", "破损片不能继续制片，需走补片流程");
    if (!input.step) throw badRequest("missing_field", "缺少步骤");
    slice.status = input.step;
    if (input.step === "观察") slice.observation = input.note || slice.observation;
    slice.logs.push({ at: new Date().toISOString(), step: input.step, note: input.note || "" });
    sample.history.push({ at: new Date().toISOString(), type: "step_logged", note: `${sliceId} 进入 ${input.step}` });
    recomputeSampleStatus(sample);
    if (input.step === "观察") {
      await this.bus.emit("slice:observation-ready", { sampleId, sliceId: slice.id });
    }
    await this.store.save();
    return sample;
  }

  // 样本资料变化（标签补打时的"资料变化"原因）
  async updateInfo(sampleId, patch, reason) {
    const sample = await this.get(sampleId);
    const fields = ["project", "borehole", "coreBox", "depth", "owner"];
    const changed = [];
    for (const field of fields) {
      if (patch[field] !== undefined && patch[field] !== sample[field]) {
        changed.push(`${field}: ${sample[field]} → ${patch[field]}`);
        sample[field] = patch[field];
      }
    }
    if (!changed.length) throw badRequest("no_change", "没有资料变化");
    sample.history.push({
      at: new Date().toISOString(),
      type: "info_changed",
      note: changed.join("；"),
      reason: reason || "资料变化"
    });
    await this.store.save();
    return sample;
  }

  async markDelivered(sampleId, input) {
    const db = await this.store.load();
    const sample = await this.get(sampleId);
    if (sample.delivery === "已交付") throw conflict("already_delivered", "样本已交付");
    const record = {
      id: `DLV-${Date.now()}`,
      sampleId,
      conclusion: input?.conclusion || "",
      at: new Date().toISOString(),
      status: "有效"
    };
    db.deliveries.push(record);
    sample.delivery = "已交付";
    sample.history.push({ at: record.at, type: "delivered", note: `交付 ${record.id}`, deliveryId: record.id });
    recomputeSampleStatus(sample);
    await this.store.save();
    return record;
  }

  // 换绑后交付结论作废
  async voidDeliveryForSlice(sliceId, oldLabelCode, newLabelCode) {
    const db = await this.store.load();
    const at = new Date().toISOString();
    for (const delivery of db.deliveries) {
      if (delivery.sampleId && delivery.status === "有效") {
        const sample = db.samples.find(item => item.id === delivery.sampleId);
        if (sample && sample.slices.some(slice => slice.id === sliceId)) {
          delivery.status = "作废";
          delivery.voidedAt = at;
          delivery.voidReason = `标签换绑 ${oldLabelCode} → ${newLabelCode}`;
          sample.delivery = "未交付";
          sample.history.push({
            at,
            type: "delivery_voided",
            note: `交付结论 ${delivery.id} 随标签换绑作废`,
            deliveryId: delivery.id
          });
          recomputeSampleStatus(sample);
        }
      }
    }
  }

  listDeliveries() {
    return this.store.load().then(db => db.deliveries);
  }
}
