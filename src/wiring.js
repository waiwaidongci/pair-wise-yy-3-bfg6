import http from "node:http";
import { ApiError } from "./errors.js";
import { SampleService } from "./services/sampleService.js";
import { LabelService } from "./services/labelService.js";
import { TaskService } from "./services/taskService.js";
import { LoanService } from "./services/loanService.js";
import { Bus } from "./bus.js";
import { page } from "./page.js";

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

// 三类接口分开实现：样本资料(sampleService) / 标签事件(labelService) / 领还(loanService)；
// 观察任务(taskService) 由标签事件驱动
export function createApp(store, bus = new Bus()) {
  const samples = new SampleService(store, bus);
  const labels = new LabelService(store, bus);
  const tasks = new TaskService(store, bus, labels);
  const loans = new LoanService(store, bus, labels, samples);
  tasks.wire();

  // 换绑后交付结论作废
  bus.on("label:rebound", async ({ oldSliceId, oldCode, newCode }) => {
    await samples.voidDeliveryForSlice(oldSliceId, oldCode, newCode);
    await store.save();
  });

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const p = url.pathname;
      const method = req.method;
      const input = ["POST", "PATCH", "PUT"].includes(method) ? await readBody(req) : {};

      if (method === "GET" && p === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(page);
      }

      // —— 样本资料接口 ——
      if (method === "GET" && p === "/api/samples") return sendJson(res, 200, await samples.list());
      if (method === "POST" && p === "/api/samples") return sendJson(res, 201, await samples.create(input));

      let m = p.match(/^\/api\/samples\/([^/]+)$/);
      if (m && method === "PATCH") return sendJson(res, 200, await samples.updateInfo(m[1], input.patch || input, input.reason));

      m = p.match(/^\/api\/samples\/([^/]+)\/slices$/);
      if (m && method === "POST") return sendJson(res, 201, await samples.addSlice(m[1], input));

      m = p.match(/^\/api\/samples\/([^/]+)\/slices\/([^/]+)\/logs$/);
      if (m && method === "POST") return sendJson(res, 200, await samples.logStep(m[1], m[2], input));

      m = p.match(/^\/api\/samples\/([^/]+)\/deliver$/);
      if (m && method === "POST") return sendJson(res, 201, await samples.markDelivered(m[1], input));

      if (method === "GET" && p === "/api/deliveries") return sendJson(res, 200, await samples.listDeliveries());

      // —— 标签事件接口 ——
      if (method === "GET" && p === "/api/labels") return sendJson(res, 200, await labels.list());
      if (method === "POST" && p === "/api/labels") return sendJson(res, 201, await labels.register(input));

      m = p.match(/^\/api\/labels\/([^/]+)\/bind$/);
      if (m && method === "POST") return sendJson(res, 200, await labels.bind(decodeURIComponent(m[1]), input.sliceId, input.note));

      m = p.match(/^\/api\/labels\/([^/]+)\/reprint$/);
      if (m && method === "POST") return sendJson(res, 200, await labels.reprint(decodeURIComponent(m[1]), input));

      m = p.match(/^\/api\/labels\/([^/]+)\/quarantine$/);
      if (m && method === "POST") return sendJson(res, 200, await labels.quarantine(decodeURIComponent(m[1]), input.reason));

      m = p.match(/^\/api\/labels\/([^/]+)\/release$/);
      if (m && method === "POST") return sendJson(res, 200, await labels.release(decodeURIComponent(m[1]), input.note));

      // —— 观察任务接口 ——
      if (method === "GET" && p === "/api/tasks") return sendJson(res, 200, await tasks.list());
      m = p.match(/^\/api\/tasks\/([^/]+)\/complete$/);
      if (m && method === "POST") return sendJson(res, 200, await tasks.complete(decodeURIComponent(m[1]), input));

      // —— 领还接口 ——
      if (method === "GET" && p === "/api/observers") return sendJson(res, 200, await loans.listObservers());
      if (method === "POST" && p === "/api/observers") return sendJson(res, 201, await loans.registerObserver(input));
      if (method === "GET" && p === "/api/registrations") return sendJson(res, 200, await loans.listRegistrations());

      m = p.match(/^\/api\/observers\/([^/]+)\/register-label$/);
      if (m && method === "POST") {
        return sendJson(res, 201, await loans.registerLabel(decodeURIComponent(m[1]), input.labelCode));
      }

      if (method === "GET" && p === "/api/loans") return sendJson(res, 200, await loans.listLoans());
      if (method === "POST" && p === "/api/loans/checkout") {
        return sendJson(res, 201, await loans.checkout(input.observerId, input.labelCode));
      }
      m = p.match(/^\/api\/loans\/([^/]+)\/return$/);
      if (m && method === "POST") return sendJson(res, 200, await loans.returnLoan(decodeURIComponent(m[1]), input));

      if (method === "GET" && p === "/api/reslices") return sendJson(res, 200, await loans.listReslices());
      m = p.match(/^\/api\/reslices\/([^/]+)\/complete$/);
      if (m && method === "POST") return sendJson(res, 200, await loans.completeReslice(decodeURIComponent(m[1]), input));

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof ApiError) return sendJson(res, error.status, { error: error.code, message: error.message });
      sendJson(res, 500, { error: "internal_error", message: error.message });
    }
  };

  return { handler, services: { samples, labels, tasks, loans }, server: http.createServer(handler) };
}
