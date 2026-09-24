import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

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
      history: [],
      slices: [
        {
          id: "SL-001-A",
          method: "茜素红染色",
          observation: "",
          status: "研磨",
          damaged: false,
          logs: [
            { at: "2026-06-12T10:00:00.000Z", step: "取样", note: "截取含矿化条带位置" },
            { at: "2026-06-13T11:20:00.000Z", step: "切割", note: "完成粗切" }
          ]
        }
      ]
    }
  ],
  labels: [],
  observers: [],
  registrations: [],
  loans: [],
  tasks: [],
  deliveries: [],
  reslices: []
};

// 兼容旧版数据文件：补齐新集合与切片字段
function migrate(db) {
  for (const key of Object.keys(seed)) db[key] ??= seed[key];
  for (const sample of db.samples) {
    sample.history ??= [];
    for (const slice of sample.slices) slice.damaged ??= false;
  }
  return db;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.db = null;
  }

  async load() {
    if (!this.db) {
      if (!existsSync(this.file)) {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify(seed, null, 2));
      }
      this.db = migrate(JSON.parse(await readFile(this.file, "utf8")));
    }
    return this.db;
  }

  async save() {
    await writeFile(this.file, JSON.stringify(this.db, null, 2));
  }
}

export { seed };
