import { badRequest, notFound } from "../errors.js";

// 观察任务：一片一码一任务；标签换绑后旧任务作废，按新标签重排
export class TaskService {
  constructor(store, bus, labelService) {
    this.store = store;
    this.bus = bus;
    this.labelService = labelService;
  }

  async list() {
    return (await this.store.load()).tasks;
  }

  async ensureForSlice(sampleId, sliceId, labelCode, note) {
    const db = await this.store.load();
    const sample = db.samples.find(item => item.id === sampleId);
    const slice = sample?.slices.find(item => item.id === sliceId);
    if (!slice) return null;
    if (slice.status !== "观察") return null;
    const existing = db.tasks.find(
      task => task.sliceId === sliceId && task.status === "待观察" && task.labelCode === labelCode
    );
    if (existing) return existing;

    const task = {
      id: `OBS-${Date.now()}-${Math.floor(Math.random() * 90 + 10)}`,
      sampleId,
      sliceId,
      labelCode,
      status: "待观察",
      note: note || "按标签排入观察",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null
    };
    db.tasks.push(task);
    return task;
  }

  // 换绑：旧标签名下未完成的观察任务一律作废
  async voidForLabel(labelCode, newLabelCode) {
    const db = await this.store.load();
    const at = new Date().toISOString();
    for (const task of db.tasks) {
      if (task.labelCode === labelCode && task.status !== "作废") {
        task.status = "作废";
        task.voidedAt = at;
        task.voidReason = `标签换绑 ${labelCode} → ${newLabelCode}`;
      }
    }
  }

  async complete(taskId, input) {
    const db = await this.store.load();
    const task = db.tasks.find(item => item.id === taskId);
    if (!task) throw notFound("task_not_found");
    if (task.status === "作废") throw badRequest("task_voided", "任务已作废，不能提交结论");
    if (task.status === "已完成") throw badRequest("task_completed", "任务已完成");
    task.status = "已完成";
    task.completedAt = new Date().toISOString();
    task.result = input?.result || "";
    const sample = db.samples.find(item => item.id === task.sampleId);
    const slice = sample?.slices.find(item => item.id === task.sliceId);
    if (slice) slice.observation = task.result || slice.observation;
    await this.store.save();
    return task;
  }

  // 标签事件接线（在 wiring 中调用一次）
  wire() {
    this.bus.on("label:bound", async ({ code, sampleId, sliceId }) => {
      await this.ensureForSlice(sampleId, sliceId, code);
      await this.store.save();
    });
    this.bus.on("slice:observation-ready", async ({ sampleId, sliceId }) => {
      const db = await this.store.load();
      const bound = this.labelService.activeLabelForSlice(db, sliceId);
      if (bound) {
        await this.ensureForSlice(sampleId, sliceId, bound.code);
        await this.store.save();
      }
      // 未补标签的旧片：不排观察任务，补标签后由 label:bound 排入
    });
    this.bus.on("label:rebound", async ({ oldCode, newCode, newSliceId, sampleId }) => {
      await this.voidForLabel(oldCode, newCode);
      await this.ensureForSlice(sampleId, newSliceId, newCode, "换绑后按新标签重排");
      await this.store.save();
    });
  }
}
