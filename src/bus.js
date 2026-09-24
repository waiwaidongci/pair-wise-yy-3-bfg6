// 进程内事件总线：标签事件驱动观察任务重排、交付作废、隔离联动
export class Bus {
  constructor() {
    this.handlers = new Map();
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
  }

  async emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) await handler(payload);
  }
}
