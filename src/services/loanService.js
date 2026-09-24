import { badRequest, conflict, notFound } from "../errors.js";
import { recomputeSampleStatus } from "./sampleService.js";

// 领还接口：观察员登记标签后领片；未绑定/已借/隔离拒绝；归还记片况箱位；破损转补片
export class LoanService {
  constructor(store, bus, labelService, sampleService) {
    this.store = store;
    this.bus = bus;
    this.labelService = labelService;
    this.sampleService = sampleService;
  }

  async listLoans() {
    return (await this.store.load()).loans;
  }
  async listReslices() {
    return (await this.store.load()).reslices;
  }
  async listObservers() {
    return (await this.store.load()).observers;
  }
  async listRegistrations() {
    return (await this.store.load()).registrations;
  }

  async registerObserver(input) {
    const db = await this.store.load();
    if (!input.name) throw badRequest("missing_field", "缺少观察员姓名");
    if (db.observers.some(item => item.name === input.name)) {
      throw conflict("observer_exists", "观察员已登记");
    }
    const observer = {
      id: `OBSV-${String(db.observers.length + 1).padStart(3, "0")}`,
      name: input.name,
      createdAt: new Date().toISOString()
    };
    db.observers.push(observer);
    await this.store.save();
    return observer;
  }

  // 登记标签：标签必须存在且已绑片，才能进入领片环节
  async registerLabel(observerId, labelCode) {
    const db = await this.store.load();
    const observer = db.observers.find(item => item.id === observerId || item.name === observerId);
    if (!observer) throw notFound("observer_not_found", "请先登记观察员");
    const label = db.labels.find(item => item.code === labelCode);
    if (!label) throw badRequest("label_not_found", "未绑定标签（查无此码），拒绝登记");
    if (label.status === "未绑定") throw badRequest("label_unbound", "标签未绑定切片，拒绝登记");
    if (label.status === "作废") throw badRequest("label_voided", "标签已作废（旧码留履历），拒绝登记");
    if (label.status === "隔离") throw badRequest("label_quarantined", "标签已隔离，拒绝登记");

    const at = new Date().toISOString();
    let registration = db.registrations.find(
      item => item.observerId === observer.id && item.labelCode === labelCode
    );
    if (!registration) {
      registration = {
        id: `REG-${Date.now()}`,
        observerId: observer.id,
        observerName: observer.name,
        labelCode,
        sliceId: label.sliceId,
        sampleId: label.sampleId,
        at
      };
      db.registrations.push(registration);
    }
    label.history.push({ at, type: "registered_for_loan", note: `观察员 ${observer.name} 登记领片` });
    await this.store.save();
    return registration;
  }

  // 领片
  async checkout(observerId, labelCode) {
    const db = await this.store.load();
    const observer = db.observers.find(item => item.id === observerId || item.name === observerId);
    if (!observer) throw notFound("observer_not_found", "请先登记观察员");

    const label = db.labels.find(item => item.code === labelCode);
    if (!label) throw badRequest("label_not_found", "未绑定标签（查无此码），拒绝领片");
    if (label.status === "未绑定") throw badRequest("label_unbound", "标签未绑定，拒绝领片");
    if (label.status === "隔离") throw badRequest("label_quarantined", "标签已隔离，拒绝领片");
    if (label.status === "作废") throw badRequest("label_voided", "标签已作废，拒绝领片");

    if (db.loans.some(loan => loan.labelCode === labelCode && loan.status === "借出中")) {
      throw conflict("label_on_loan", "该标签切片已借出，尚未归还，拒绝领片");
    }

    const registration = db.registrations.find(
      item => item.observerId === observer.id && item.labelCode === labelCode
    );
    if (!registration) throw badRequest("not_registered", "观察员未登记该标签，先登记再领片");

    // 定位切片：破损片 / 补片未完成，不能再领
    let located = null;
    for (const sample of db.samples) {
      const slice = sample.slices.find(item => item.id === label.sliceId);
      if (slice) located = { sample, slice };
    }
    if (!located) throw notFound("slice_not_found", "标签绑定的切片不存在");
    if (located.slice.damaged) throw conflict("slice_damaged", "破损片转补片，完成前不能再领");
    const openReslice = db.reslices.find(
      order => order.sampleId === located.sample.id && order.status === "待补片"
    );
    if (openReslice) throw conflict("reslice_open", `补片单 ${openReslice.id} 未完成，不能再领`);

    const at = new Date().toISOString();
    const loan = {
      id: `LOAN-${Date.now()}`,
      observerId: observer.id,
      observerName: observer.name,
      labelCode,
      sliceId: located.slice.id,
      sampleId: located.sample.id,
      status: "借出中",
      borrowedAt: at,
      returnedAt: null,
      condition: null,
      boxPosition: null,
      note: ""
    };
    db.loans.push(loan);
    label.history.push({ at, type: "checked_out", note: `${observer.name} 领片` });
    located.sample.history.push({ at, type: "slice_checked_out", note: `${located.slice.id} 由 ${observer.name} 借出` });
    await this.store.save();
    return loan;
  }

  // 归还：记录片况和箱位；破损片转补片
  async returnLoan(loanId, input) {
    const db = await this.store.load();
    const loan = db.loans.find(item => item.id === loanId);
    if (!loan) throw notFound("loan_not_found");
    if (loan.status !== "借出中") throw conflict("loan_not_active", "该领片记录已归还");

    const condition = input.condition || "完好";
    if (!["完好", "破损"].includes(condition)) throw badRequest("invalid_condition", "片况须为 完好 或 破损");
    if (!input.boxPosition) throw badRequest("missing_field", "归还必须记录箱位");

    const at = new Date().toISOString();
    Object.assign(loan, {
      status: "已归还",
      returnedAt: at,
      condition,
      boxPosition: input.boxPosition,
      note: input.note || ""
    });

    const sample = db.samples.find(item => item.id === loan.sampleId);
    const slice = sample?.slices.find(item => item.id === loan.sliceId);
    const label = db.labels.find(item => item.code === loan.labelCode);

    let reslice = null;
    if (condition === "破损") {
      if (slice) slice.damaged = true;
      // 破损片标签隔离，旧码留履历；补片完成后新片另行补标签
      if (label && label.status === "已绑定") {
        label.status = "隔离";
        label.history.push({ at, type: "quarantined", note: "归还片况破损，自动转隔离" });
      }
      reslice = {
        id: `RSL-${Date.now()}`,
        sampleId: loan.sampleId,
        oldSliceId: loan.sliceId,
        oldLabelCode: loan.labelCode,
        status: "待补片",
        createdAt: at,
        completedAt: null,
        newSliceId: null
      };
      db.reslices.push(reslice);
      recomputeSampleStatus(sample);
    }

    sample?.history.push({
      at,
      type: condition === "破损" ? "slice_returned_damaged" : "slice_returned",
      note: `${loan.sliceId} 归还，片况${condition}，箱位 ${input.boxPosition}${reslice ? `，转补片单 ${reslice.id}` : ""}`,
      resliceId: reslice?.id
    });
    await this.store.save();
    return { loan, reslice };
  }

  // 补片完成：新片入库，新标签由标签服务另行绑定，完成后样本可重新领用
  async completeReslice(resliceId, input) {
    const db = await this.store.load();
    const order = db.reslices.find(item => item.id === resliceId);
    if (!order) throw notFound("reslice_not_found");
    if (order.status !== "待补片") throw conflict("reslice_completed", "补片单已完成");
    if (!input?.newSliceId) throw badRequest("missing_field", "缺少新切片编号");

    const sample = await this.sampleService.addReslice(order.sampleId, {
      id: input.newSliceId,
      method: input.method || "未指定",
      resliceId: order.id
    });
    order.status = "已完成";
    order.completedAt = new Date().toISOString();
    order.newSliceId = input.newSliceId;
    await this.store.save();
    return { order, sample };
  }
}
