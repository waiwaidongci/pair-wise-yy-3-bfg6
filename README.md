# 岩芯样本切片实验室

运行：

```bash
npm start
```

访问 `http://localhost:3025`。

三套接口分别实现：

- **样本资料** `/api/samples`：样本创建、切片任务、步骤记录、交付统计。
- **标签事件** `/api/labels`：登记绑定（一码只绑定一片，旧码永不复用）、`POST /api/labels/:code/reprint` 补打换绑（必须写明「损坏」或「资料变化」，旧码留履历；换绑后观察任务和交付结论作废，按新标签重排）、`GET /api/labels/:code` 查履历。
- **领还** `/api/loans`：`POST /api/loans` 凭标签领片（未绑定、已借出、隔离中的标签拒绝；旧样本须先补标签）；`POST /api/loans/return` 归还（必录片况和箱位，破损片转补片并隔离，补片完成前不能再领，补片步骤走到「观察」自动解除隔离）。
