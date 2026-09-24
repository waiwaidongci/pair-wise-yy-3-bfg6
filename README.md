# 岩芯切片登记领还系统

解决片盒手写片号贴错、回来认不回样本的问题：**一个标签码只绑一片**，登记与领还全流程联动。

## 运行

```bash
npm start        # http://localhost:3025
npm test         # 接口端到端测试（15 个用例）
```

数据存于 `data/core-slices.json`（旧版数据文件启动时自动迁移）。可用 `DB_PATH` 指定别的文件、`PORT` 指定端口。

## 核心规则

- **一码一片**：标签码唯一绑定一片；同片不能挂第二个有效标签。
- **补打**：原因限「标签损坏 / 资料变化」（资料变化可同步改样本资料）。旧码置「作废」但**保留完整履历**（含 `supersededBy` 指向新码），可换绑原片或纠正到别的片。
- **换绑联动**：换绑后该标签名下的**观察任务作废、样本交付结论作废**，按新标签自动**重排观察任务**。
- **登记才能领片**：观察员先登记，再登记标签（标签须存在且已绑片），最后领片。**未绑定、已借出、隔离、作废**标签一律拒绝。
- **归还**：必须记录**片况（完好/破损）与箱位**；破损片自动标记破损、标签转隔离、生成**补片单**；补片完成前该样本不能再领。
- **旧样本补标签**：无标签的旧片可登记标签时直接绑片或事后 `bind`；未补标签不排观察任务、不能领用。

## 三类接口分别实现

| 模块 | 文件 | 职责 |
|---|---|---|
| 样本资料 | `src/services/sampleService.js` | 样本/切片 CRUD、步骤、资料变化、交付结论 |
| 标签事件 | `src/services/labelService.js` | 登记、绑片、补打换绑、隔离/解除、履历 |
| 领还 | `src/services/loanService.js` | 观察员、标签登记、领片、归还、补片单 |
| 观察任务 | `src/services/taskService.js` | 由标签事件驱动：排入/作废/重排 |

模块间通过 `src/bus.js` 事件总线联动（`label:bound`、`label:rebound`、`slice:observation-ready`）。

## 主要接口

```
# 样本资料
GET/POST  /api/samples
PATCH     /api/samples/:id                      # 资料变化
POST      /api/samples/:id/slices               # 加切片
POST      /api/samples/:id/slices/:sid/logs     # 步骤记录（到"观察"自动排任务）
POST      /api/samples/:id/deliver              # 交付（换绑后自动作废）
GET       /api/deliveries

# 标签事件
GET/POST  /api/labels                           # 登记，body 可带 sliceId 直接绑片
POST      /api/labels/:code/bind                # 未绑定标签绑片（旧样本补标签）
POST      /api/labels/:code/reprint             # 补打 {reason, newCode?, sliceId?, samplePatch?}
POST      /api/labels/:code/quarantine          # 隔离
POST      /api/labels/:code/release             # 解除隔离
GET       /api/labels                           # 含每个标签完整 history 履历

# 观察任务
GET       /api/tasks
POST      /api/tasks/:id/complete

# 领还
POST/GET  /api/observers                        # 观察员登记
POST      /api/observers/:id/register-label     # 登记标签（未绑定/隔离/作废被拒）
GET       /api/registrations
POST      /api/loans/checkout                   # {observerId,labelCode}
GET       /api/loans
POST      /api/loans/:id/return                 # {condition:完好|破损, boxPosition, note?}
GET       /api/reslices
POST      /api/reslices/:id/complete            # {newSliceId, method?}
```

错误统一返回 `{ error, message }`，语义码包括 `label_not_found / label_unbound / label_on_loan / label_quarantined / label_voided / not_registered / slice_damaged / reslice_open` 等。
