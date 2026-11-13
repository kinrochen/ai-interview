# UX Contract

本契约覆盖导航框架、登录、招聘概览、岗位管理、JD 助手和招聘过程工作流。简历、面试、笔试、Offer、题库及工作流列表共享新的页面标题、表格和响应式表现，其既有业务操作按原有 API 执行。视觉约束见 [DESIGN.md](DESIGN.md)。

## Product context

招聘团队使用简体中文工作台，目标为可读、可编辑、可恢复的招聘操作。日期显示使用 zh-CN；现有 API 返回无时区日期，本次不改变存储约定。无支付或法律文案变更。无日语或日本市场相关需求。可访问性目标为 WCAG 2.2 AA，已有站点框架的历史问题不在本次全部迁移。

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| 岗位功能及用户 | README.md | 产品说明 | 2026-11-11 |
| 岗位写入和 AI 权限 | backend/app/routes/positions.py；backend/app/core/security.py | API 权限实现 | 2026-11-11 |
| 发布状态和数据结构 | backend/app/models/models.py；backend/app/schemas/position.py | API / 数据模型 | 2026-11-11 |
| 删除关联约束 | backend/app/services/position_service.py | 领域服务实现 | 2026-11-11 |
| 外部 AI 数据处理 | SECURITY.md | 部署安全策略 | 2026-11-11 |
| 面试资料、成员逐题草稿与归档 | backend/app/services/interview_workflow.py；backend/app/routes/interview_workflow.py；frontend/src/pages/Interviews/Score.tsx | API / 原有业务交互 | 2026-11-13 |

## Visual contract

运行时 token 源为 frontend/src/index.css，DESIGN.md 镜像已实现的值；当前浅色主题，Ant Design 中文 locale。theme.ts 从运行时 CSS 读取值并适配 ConfigProvider，静态 Modal/message 使用同一配置。共享组件及 CSS 约束控件表现。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | Ant Design Table，Positions/List.tsx 受控选择 | 本契约与分页 API | 当前页选项 | 浏览器批量部分失败回归 |
| Select/Listbox | Ant Design Select | PositionFields 与本契约 | authored | 浏览器 popup、Escape |
| Form | Ant Design Form + components/PositionFields | position schema 与本契约 | 列表弹窗 / 独立路由 | 两入口创建和失败恢复 |
| Scrollbar | frontend/src/index.css 全局样式 | DESIGN.md | 弹窗 stable gutter | 窄屏截图、样式检查 |
| Toast | Ant Design message | 本契约 | 成功 / 信息 / 错误 | 浏览器成功反馈 |
| CRUD | positions 路由与 position_service | API 与本契约 | 弹窗关闭 / 返回岗位列表 | 浏览器 CRUD 及后端测试 |

## Dataset navigation

岗位管理使用 `/positions/page` 的 skip/limit 服务端分页，默认 10 项，最大 100 项。旧 `/positions` 数组接口继续服务原有下拉框消费者。搜索词、状态、页号和每页条数放在 URL，搜索防抖 300ms，清空或明确 Enter 立即请求，中文输入法组合期间不发起搜索。取消旧请求，旧结果不得覆盖新筛选。

筛选和翻页清除选择，批量范围为当前页已选岗位。删除后越界页自动回到有效末页。列表失败显示持久错误及重试按钮，空列表和无匹配结果提供不同提示。

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create/Edit | 保存岗位 | 禁止重复提交 | 关闭编辑弹窗或返回列表 | 岗位已创建/已保存 | 保留所有字段，显示服务端错误 | Ant Design 弹窗返回触发点 | positions.py |
| Generate JD | 用户点击开始生成/生成新版本 | 可停止，保留原草稿 | 当前助手 | 生成成功后提示检查和保存 | 保留草稿与要求，可重试 | 不强制滚动 | ai_service.py |
| Revise JD | 按要求修改或非输入法 Enter | 与生成互斥 | 当前助手 | 仅在有效结果后提示更新 | 修改要求留在输入框 | 返回修改输入 | ai_service.py |
| Adopt JD | 采纳并填入表单 | 同步回填 | 关闭助手 | 提示仍需保存岗位 | 无有效完整内容不可采纳 | 恢复表单焦点 | JDGeneratorModal |
| Delete | 删除确认 | 等待服务端 | 当前列表 | 成功后刷新 | 关联约束错误保留，允许取消 | 原触发点 | position_service.py |
| Bulk action | 明确已选数量后确认 | 禁止重复批量操作 | 当前列表 | 完成数和失败数 | 失败项保持选择并显示原因 | 表格继续可操作 | position_service.py |

## Overlays and feedback

使用 Ant Design Modal/Drawer，禁止浏览器原生 alert/confirm。JD 助手位于编辑弹窗之上（z-index 1100），使用组件库管理焦点。助手内容可滚动，页脚保持可达，窄屏预览单列。临界错误在窗口内保持可见；toast 仅作已完成操作的确认。

采纳只改表单草稿，不自动写入或发布岗位。生成新版本保留上一版供恢复。关闭助手取消当前请求；关闭后旧响应不得污染下一次打开的内容。列表编辑弹窗关闭前确认放弃未保存内容；独立表单拦截未保存的路由离开并提示，页面卸载使用 beforeunload 的原生生命周期机制。

## Async and resilience

服务端返回内容、错误、完成 SSE 事件。完成事件只在职责和要求均为非空字符串且每项不超过 2000 字时发送。空 choices 数据包忽略；输出被截断、无内容、非法 JSON、服务认证及限流错误均不得伪装为成功。非流式失败返回 502。

客户端缓存未完成事件行，使用流式 UTF-8 解码，只收到有效完成事件才替换草稿。服务端读取超时 90s，浏览器总超时 120s，不自动重试收费生成。失败不清空草稿或修改意见；取消和新请求用独立 AbortController 隔离。会话过期在助手内提示重新登录并保留当前窗口内容。JD 请求在浏览器中执行，生成结果写入表单草稿，持久化由保存岗位完成。

聊天只接受 user/assistant 消息，保留实际已成功生成的 JSON 上下文并限制历史长度。模型配置与 JD 模板沿用系统设置；补充岗位类型和现有草稿变量。未提供的信息不虚构为薪资福利承诺或硬性学历门槛。

## Validation and permissions

两个编辑入口复用 PositionFields。职责必须非空；招聘人数至少 1 且为整数；JD 两项长度与 AI 输出一致。控件提供 label、首个错误定位、noValidate、自动增长 textarea。清空招聘负责人发送显式 null；后端在创建与修改时验证负责人存在。

后端权限是最终依据，AI 生成和修改仅允许已有 HR/Admin 角色；前端收到 403 显示明确权限提示。剪贴板失败提供反馈，不将复制失败报告为成功。图标按钮提供岗位对象和动作的可访问名称。

## Verification

- 后端：`cd backend && venv/bin/python -m pytest -q`。
- 前端流式分片：`npm --prefix frontend run test:jd`，需要 Node.js 22.18+ 的 TypeScript 类型擦除。
- 类型和构建：`npm --prefix frontend run build`。
- 岗位范围 lint：运行 eslint 对 Positions、JDGeneratorModal、PositionFields、jdStream、errors。
- 浏览器：启动前端后运行 `node scripts/test-positions-ui.mjs`；脚本默认启动临时无头 Chrome（也可指定 CHROME_PATH 或 CHROME_DEBUG_PORT），创建隔离 context，模拟 API，不改真实业务数据，不调用收费 AI。
- 浏览器覆盖：两个入口的创建/编辑、失败重试、批量删除部分失败、AI 取消和迟到响应、中文输入法、390px 预览、reduced motion、Select popup 和 Escape。
- 输出位于 `/tmp/ai-interview-positions-ui`，包括结果 JSON 和截图。

### 本次验证结果（2026-11-11）

后端 119 项测试、前端流式分片 21 项测试、8 组隔离浏览器流程及岗位相关 ESLint 均通过。用户明确授权后，当前模型实际完成一次 JD 生成及一次修改，均通过结果校验；未保存或发布岗位。

全仓库 ESLint 在未改动模块中仍有 442 项错误和 20 项警告；岗位相关路径没有报告错误。DESIGN.md 官方 lint 为 0 errors。

技能静态严格扫描的原始 JSON 保留在 `/tmp/ai-interview-premium-audit.json`，报告的 14 项为组件识别误报：12 项把 Ant Design `Form.Item` 视为独立 HTML form，2 项把 Ant Design `Select` 视为 native select。两个实际 HTML form 的 `noValidate`、不存在 native select、authored popup 的宽度和键盘 Escape 均由浏览器回归断言验证。未为消除误报修改组件权限或降低交互约束。

## Migration status

本次用共享字段消除岗位两个入口的重复校验和布局；用 jdStream 统一生成与修改的 SSE 读取。其它旧页面继续沿用已有契约，后续应按业务范围逐步验证。未更改发布状态、删除约束或数据保留政策。


## Navigation and route behavior

2026-11-12 用户指定重构原版 5173。导航依工作台、招聘管理、评估与协作、系统配置组织，菜单角色条件沿用原 Layout，后端继续负责权限校验。桌面收起偏好存于 sidebar-collapsed，正文左边距同步变化。窄屏使用 Ant Design Drawer，Escape 关闭并恢复触发点焦点，选择页面后关闭导航。

顶部栏展示页面位置和账户菜单，页面导航通过侧栏与窄屏抽屉完成。父级 breadcrumb 可以返回所属列表，当前页面为纯文本。客户端路径变化后聚焦主内容区并回到顶部，筛选 query 变化保留输入焦点。所有原有路由保留，页面模块按路由延迟加载，加载时导航持续可用。

### Route document title policy

内部页面与登录页标题为「页面名称 · AI Interview」，嵌套详情、编辑和评分有明确标题。公开候选人页面沿用其现有内容。标题中不含候选人姓名、令牌或其它个人资料。

### Route error / 403 page behavior

未知内部路由显示中文 404 并提供招聘概览入口。内部页面渲染或模块加载错误由子路由 errorElement 展示恢复选项，保留导航。明确的路由 403 显示访问受限，提供返回与重新加载。API 403 继续由各业务页面处理。

## Login contract

邮箱和密码有可点击标签，使用 username/current-password autocomplete，密码默认隐藏且显隐按钮支持键盘。Ant Design Form 提供校验与首错定位，提交期间防止重复请求。认证或网络错误持续显示并保留输入。token 返回后必须成功获取 /auth/me 才完成登录，失败清除会话并显示可重试提示。通过受保护路由进入登录时，成功后返回安全站内原路径及筛选参数，否则进入招聘概览。业务来源为现有 auth/token、auth/me 与 AuthContext。

## Dashboard contract

沿用 backend/app/routes/dashboard.py 及 dashboard_service.py 的六个只读接口。概览与动态、漏斗、岗位分析、面试官分析、核心指标独立处理成功和失败，失败模块保留上次成功内容并显示局部更新失败说明，初次未取得值以横线显示。用户可以明确刷新和重试，无自动付费或写入操作。

数字 0 保持真实显示，null 表示未知。开放岗位包含待发布及招聘中，近 7 天数字为新建数量，今日面试按现有服务端 UTC 日期统计。趋势时间范围变化取消旧请求，失败显示恢复提示，避免将前一个范围的数据解释为新范围。折线图与数据表展示同一组已返回数值，图表禁用入场动画。岗位/面试官/动态页签通过 view 参数保存。

## Frontend migration ledger

| Surface | Canonical target | Scope and risk | Status | Evidence |
|---|---|---|---|---|
| 全局控件和样式 | index.css → theme.ts → Ant Design | 控件状态与中文 locale，低风险视觉修改 | verified | 构建及真实浏览器 |
| 导航与账户菜单 | Layout + Ant Menu/Drawer/Dropdown | 路由定位、窄屏与键盘，中风险 | verified | 隔离浏览器与真实浏览器 |
| 登录 | Ant Form + AuthContext | 失败恢复和返回原路径，中风险 | verified | 隔离认证接口回归 |
| 招聘概览 | Dashboard + Ant Card/Table/Tabs | 只读、部分失败与旧请求，中风险 | verified | 隔离数据失败及迟到响应 |
| 岗位/JD | PositionFields/JDGeneratorModal | 保留两入口及完整 CRUD，中风险 | verified | 原 8 组回归 |
| 简历/面试/笔试/题库/Offer/工作流列表 | PageHeader + Ant Table | 标题、动作位置、窄屏表格，低风险 | verified | 页面渲染巡检 |
| 旧业务弹窗和详情页 | 原有 Ant Design + 全局 theme | 保持现有服务接口，逐流程验收尚未全部完成 | existing | 此次覆盖常用页面及岗位流程 |

回退可按 Layout、Login、Dashboard 或列表视觉切片恢复代码及对应 token，保留业务 API 和数据兼容。新入口使用已有共享组件，旧视图只有在对应流程通过验收后再移除专用样式。未增加功能开关或数据迁移。


### 前端重构验证结果（2026-11-12）

- `npm --prefix frontend run build` 通过，页面模块已按路由拆分。构建日志位于 `/private/tmp/ai-interview-redesign-build.log`，部分历史模块仍有超过 500 kB 的产物警告。
- `npm --prefix frontend run test:jd` 通过 21 项。
- `cd backend && venv/bin/python -m pytest -q` 通过 119 项，第三方及现有 API 产生 31 项弃用警告。
- `node scripts/test-positions-ui.mjs` 通过 15 组，使用临时 Chrome 和模拟接口，覆盖原有 8 组岗位/JD 流程、侧栏折叠、局部接口失败、趋势迟到响应、390px 布局、深色导航背景、抽屉 Escape 和焦点恢复、404、面试官导航和登录失败恢复。结果在 `/tmp/ai-interview-positions-ui/results.json`。
- Layout、PageHeader、ProtectedRoute、RouteFeedback、Login、Dashboard、theme、main、router 及原岗位/JD 范围 ESLint 通过。全仓库 ESLint 的检查快照为 412 errors、20 warnings，集中在旧业务代码，原始 JSON 位于 `/private/tmp/ai-interview-redesign-eslint.json`。
- 官方 `designmd lint DESIGN.md` 返回 0 errors、5 个镜像 token 引用 warning，未增加 npm 项目依赖。
- 严格技能审计原始结果位于 `/private/tmp/ai-interview-redesign-audit.json`。19 项已人工核对，15 项来自将 Ant Design Form.Item 或 TS 泛型 Form 识别为无校验原生 form，3 项来自将 Ant Design Select 识别为 native select，1 项来自无法追踪 Dropdown 给账户按钮注入的事件。真实浏览器确认账户菜单可以打开、退出和重新登录，岗位 Select 外框与 popup 均为 150px，页面没有 native select，隔离回归断言实际 form.noValidate。所有权和审计规则保持原设置。
- 真实浏览器检查了登录、招聘概览、岗位、简历、面试、Offer、题库、笔试、工作流列表。验证主导航 ArrowDown/Enter、真实登录、侧栏联动、窄屏导航和页面重排。复杂旧详情与业务弹窗的所有分支尚未做全量业务回归。

原版服务使用 5173 前端与 8001 后端，重构后的原页面可直接访问。视觉切片的状态更新为已验证，旧业务模块的完整迁移继续按表中范围记录。


## JD generation guidance

2026-11-12 用户要求在新增岗位使用 AI 生成 JD 时，先填写一段岗位要求辅助生成。PositionFields 提供可选的多行「岗位要求（辅助 AI 生成 JD）」输入，最多 2000 字，AI 入口位于该输入下方。列表弹窗和独立路由共用该字段。

辅助要求通过 jd_guidance 保留在当前编辑草稿，JD 助手与岗位表单使用同一个受控值。关闭后重新打开助手仍显示最新要求，生成失败、停止和重试保留要求。新增或切换到其它岗位时重新初始化草稿。生成和继续修改都通过现有 keywords 参数发送，后端追加的模型上下文使用 additional_requirements，支持完整多行文本。保存岗位时以最终采纳的职责和任职要求作为业务内容。

专项验证覆盖主表单输入、助手同步与关闭重开、生成和修改请求中的完整要求、生成内容回填、两个新增入口、保存失败重试及切换岗位后的草稿重置。16 组隔离浏览器流程、21 项前端单元测试、121 项后端测试、岗位/JD 范围 ESLint 和生产构建通过。后端新增两项断言分别验证生成和修改时，完整多行要求进入模型上下文。

测试使用模拟 AI 接口与临时 Chrome。浏览器连接工具在本次会话超时，使用仓库已有隔离浏览器回归和截图核验界面。构建与后端日志分别位于 `/private/tmp/ai-interview-jd-guidance-build.log` 和 `/private/tmp/ai-interview-jd-guidance-pytest.log`。

专项严格静态审计输出位于 `/private/tmp/ai-interview-jd-guidance-audit.json`。原有组件识别误报加上新增 Form.Item 的同类误报共 20 项，其中 16 项为 Form 识别、3 项为 Select 识别、1 项为 Dropdown 事件追踪。新增字段使用 Ant Design Form.Item，实际 form 的 noValidate 与模型参数传递由浏览器和后端回归验证。

## 招聘过程工作流（2026-11-13）

五组功能接入原版单企业架构。原始业务记录通过增量迁移保留，新增字段与操作历史用于后续流程追踪。

### 工作台与日历

`/workbench` 汇总当前用户的面试、未提交人工评价和部门初评。面试官登录后进入此入口。即将开始区域列出最近十场，日历可继续查看完整日期范围。`/interviews/calendar` 提供月、周、日视图，日期、视图和我的面试筛选写入 URL。后端按实际成员关系限制面试官可见范围。历史记录缺少结束时间时，日历标记预计 60 分钟。

### 岗位与实际入职

岗位行的「名额与状态」展示当前招聘轮次、目标名额、占用、当前在职、可用与本轮累计入职。暂停、恢复、关闭、取消、重开、归档和恢复保留操作原因与历史。管理员可在重开时开启新轮次。

Offer 已接受后，可确认实际入职日期。服务端锁定岗位，在同一事务中分配 HC、记录入职和更新候选人状态。重复确认同一日期返回原结果。最后一个名额分配完成后岗位自动关闭。离职登记记录实际日期、原因及是否释放名额，历史入职与离职证据保留。重开与删除限制保护已入职记录。

### 面试工作区

`/interviews/:id/score` 统一处理开始、录音、结束、证据分析、人工评价和最终决策。成员可编辑自己的进行中笔记。结束后成员可查看笔记，补充记录以追加方式保存。结束面试时保存当前未提交笔记。

2026-11-13 用户要求基于原版评分页优化面试过程。进行中恢复左侧简历、右侧逐题面试。简历提供 PDF 原件、下载、解析文本和岗位要求。题目按原有顺序逐题呈现，保留题目标题、简历关联、追问、参考答案与评分标准，支持题号、上一题和下一题。题目生成期间保持简历可读，提供刷新入口。

现场逐题评分与评语复用原有 InterviewPanel.scores / comments，由成员独立保存。切题保留待保存草稿，失败保留输入，结束时先保存逐题记录与整场笔记。进行中成员读取自己的记录，结束后共享权限沿用面试笔记契约。逐题保存后继续面试，面试结束后提交六维综合评价。后台通过题目版本校验阻止迟到修改，冲突时保留草稿供成员核对。

添加、修改、删除题目沿用原题目结构和服务。删除时同步调整已有逐题评分、评语、转写与音频引用的序号。结束后题目和逐题记录归档。全屏模式保持弹窗可见，Escape 和退出全屏可恢复。窄屏默认显示面试题与记录，可切换简历，两个区域持续保留组件状态。

录音由成员主动启动。服务端维护 45 秒录音租约，浏览器每十秒续租，单场同时拥有一个录音会话。浏览器按五秒分片，通过 IndexedDB 保留待上传内容，失败后可在同一浏览器恢复上传。相同会话与序号的相同内容重复上传具有幂等性。单片上限 20 MB，整场上限 2 GB。结束前检查分片完整性和上传状态。

录音保存在鉴权私有目录。ASR 与证据分析任务保存在数据库，使用版本、执行租约和最多三次重试，进程重启后可恢复，旧任务结果不能覆盖新版本。TXT / VTT 支持 UTF-8、UTF-8 BOM 和 GB18030，最大 5 MB。纯文本转写在界面隐藏合成的内部定位范围。长转写全部分段分析，每条显示的引用均匹配对应原文，无法核对的引用不用于评分。

六个评分维度沿用技术匹配、问题解决、学习能力、工程意识、沟通协作与团队匹配，权重分别为 35、20、15、15、10、5。人工评分为 0–10 分。全部成员提交人工评价后，HR 或管理员可记录最终决策。评分、评价修订、决策依据和修正历史均保留。首次录用、淘汰和下一轮决策沿用系统邮件设置发送结果通知。

最终决策后的证据与评价归档。已进入后续面试或有效 Offer 流程时，服务端提示到相应业务环节处理。历史已完成面试保留原版报告入口，迁移保留已有结果与实际已知时间。进行中录音和未提交内容的离开操作提供确认。

### 简历解析

保留已填写的姓名、电话和邮箱，从原文补齐缺失信息，并将经过核对的身份同步到结构化结果。AI 为空、格式错误和有效分数缺失会进入真实重试，达到重试次数后展示失败状态。重新解析保留已填写身份，以版本号隔离过期任务。服务启动恢复等待解析的记录。

### 招聘质量

`/recruitment-quality` 根据事务内操作历史计算当前待办，支持岗位、负责人、投递日期、状态和我的待办筛选，服务端分页。缺少历史阶段起始时间时显示「时间依据待补充」。等待候选人或部门评价单列为等待状态。

工作日按中国法定调休日历计算，当前依赖覆盖 2004–2026，超出可用年份时显示时间依据待补充。初筛、分配初评、安排面试和发送 Offer 默认各两工作日，HR 决策、人工面试评价、最终决策和入职确认各一工作日。管理员可配置全局时限，岗位负责人可配置岗位时限。版本按阶段开始时生效的配置计算，已有历史阶段可继续核对。按时率仅纳入具有开始、完成和时限依据的阶段。

跟进备注单独保留，完成状态由实际业务动作推进。新流程失败时保留表单内容并显示可重试反馈。新增页面复用现有 CSS token、Ant Design 中文控件、键盘焦点与窄屏布局。

### 验证入口

新增后端回归位于 `backend/tests/test_recruitment_features.py`，包含实际音频分段合成、迁移、名额约束、证据校验、权限和任务版本。浏览器脚本 `scripts/test-recruitment-ui.mjs` 使用隔离 API 与合成麦克风验证完整流程，输出 `/tmp/ai-interview-recruitment-ui/results.json` 与桌面、390px 截图。

### 录音恢复与会话结束

服务端持久化录音会话的开始顺序、录音成员和保存确认。恢复上传按最初的会话顺序合成音频，各会话内按分片序号排序。相同内容的重传续租并保持分片数一致。麦克风授权成功后申请录音租约，连接续租失败时浏览器停止录音并保留待上传内容。

原录音窗口中断且连接已过期时，录音成员恢复分片后可确认上次录音已保存。存在待确认会话时，普通结束提示成员先完成恢复。管理员可明确选择异常结束，并保留操作与最终录音来源记录。分片缺失时提示导入完整转写以继续评价。

DashScope 密钥可在「系统设置」的语音转写配置中填写并保存。当前用户选择使用 DashScope，真实自动转写需完成密钥配置。服务配置缺失时保留可回放录音并显示配置入口。模型证据分析已使用合成文本对当前模型服务进行一次真实验证。

### 系统设置中的语音转写（用户确认）

语音转写配置位于 `/settings/system#asr`，排列在模型配置之后、邮件服务配置之前。侧边栏的系统配置分组通过「系统设置」统一进入。旧的 `/settings/asr` 地址跳转到对应配置区域。面试工作区的配置链接使用同一地址。

语音转写拥有独立的保存与刷新操作，使用独立表单和接口维护服务、模型与密钥。保存后密钥输入清空，以已配置状态反馈结果。

### 本轮验证结果（2026-11-13）

- 后端完整回归通过 157 项，前端 JD 单元测试通过 21 项，生产构建通过。构建有超过 500 kB 的产物提示，后端有 31 项弃用提示。日志保存在 `/private/tmp/ai-interview-five-features-20261113/final-pytest.log`、`final-jd.log` 和 `final-build.log`。
- 岗位与原界面隔离浏览器回归通过 16 组，新增招聘流程通过 11 组。新增回归覆盖录音中断恢复、VTT 文件输入、评价与决策、HC 与实际入职、失败草稿保留，以及系统设置中的 DashScope 配置保存、密钥清空和旧地址跳转。浏览器接口使用模拟数据与合成麦克风。
- 招聘新模块、导航、概览、岗位和 JD 相关范围 ESLint 通过，`git diff --check` 通过。系统设置的既有业务代码继续保留其原有检查范围。
- 原版实际数据库已升级到 `k1m2n3o4p5q6`，既有岗位 1 条、简历 1 条、面试 0 条和 Offer 0 条的数量核对一致。只读验证的工作台、质量、日历、HC、配置与概览接口均返回 200，5173 前端可访问。迁移演练的临时数据库已清理，迁移前备份留在本轮临时目录。
- 严格静态审计原始输出为 67 项，人工记录在 `/private/tmp/ai-interview-five-features-20261113/premium-audit-reviewed.json`。64 项涉及 Ant Design Form.Item、泛型 Form、Select 和父级交互组件的静态识别，实际表单校验、选择器及按钮动作由浏览器回归核对。扫描 Settings 目录同时覆盖了相邻旧页面，其中 Profile 的两个表单和 Users 的一个表单尚未显式声明 noValidate，本轮未修改这些页面。原始结果保存在同目录 `premium-audit.json`。
- 实际模型证据分析使用合成文本完成一次验证。当前 DashScope 密钥尚未填写，真实语音转写待完成配置后验证。

### 原评分页布局恢复验证（2026-11-13）

- 后端完整回归通过 162 项，包含新增的简历上下文、逐题草稿权限、零分保存、题目版本冲突、删除序号重排和归档约束。JD 前端单元测试通过 21 项，Recruitment 模块 ESLint、类型检查与生产构建通过。
- 原岗位与导航浏览器回归通过 16 组，招聘浏览器回归通过 16 组。使用模拟接口、有效示例 PDF 与合成麦克风，检查简历与题目并排、完整题目结构、题号切换、逐题保存失败恢复、添加修改删除、全屏弹窗与标签焦点、Escape、390px 阅读切换、结束时保存草稿和取消后的只读笔记。截图位于 `/tmp/ai-interview-recruitment-ui/interview-in-progress-desktop.png` 和 `interview-in-progress-mobile.png`。
- 实际服务只读核对一场进行中的面试，工作区返回简历和五道完整题目，简历原件与前端均返回 200。
- DESIGN.md 官方 lint 返回 0 errors 和 5 项 token 镜像引用提示。严格静态扫描为 77 项，其中新增 10 项均涉及 Form.Item 与 Ant Design Select 的组件识别。人工核对及相邻旧表单的记录保存在 `/private/tmp/ai-interview-interview-layout-20261113/premium-audit-reviewed.json`。
- 本轮构建、测试、ESLint、静态审计与修改前源码备份集中保存在 `/private/tmp/ai-interview-interview-layout-20261113`。`git diff --check` 通过。
