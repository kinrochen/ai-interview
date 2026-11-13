---
version: alpha
name: AI Interview
description: 招聘团队使用的岗位、候选人与面试管理工作台
colors:
  primary: '#12243C'
  secondary: '#2960E8'
  background: '#F3F6FB'
  surface: '#FFFFFF'
  text-secondary: '#5D6E85'
  border: '#DCE4EF'
  success: '#168465'
  warning: '#B66B0C'
  danger: '#D33F49'
typography:
  sans:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    lineHeight: '1.6'
  mono:
    fontFamily: "'SFMono-Regular', Consolas, monospace"
rounded:
  sm: '8px'
  md: '12px'
  lg: '16px'
spacing:
  form-gap: '20px'
  section-gap: '24px'
components:
  button:
    height: '38px'
  dialog:
    padding: '32px'
---

# AI Interview Design System

## Overview

招聘团队的日常工作台，以清晰的数据、完整的岗位内容和确定的操作结果支撑反复阅读、修改与筛选。2026-11-12 用户明确要求重构原版 5173 前端，采用深海军蓝导航、浅色数据画布、钴蓝操作和克制的青色点缀。科技感来自结构、细线和数据层级。

主要用户为 HR、招聘负责人和面试官。当前界面为简体中文；市场范围没有独立研究证据，不从语言推断地域。桌面处理密集信息，窄屏保持表单、预览和保存按钮可达。JD 助手以并列的「岗位职责 / 任职要求」作为阅读结构，窄屏改为纵向。

运行时 token 保持权威：`frontend/src/index.css` 的 `:root` → `frontend/src/theme.ts` 读取计算样式 → `main.tsx` 的 ConfigProvider 及静态 Modal/message holder → 共享组件；本文件镜像实际值。Ant Design 管理控件交互、焦点和禁用状态，`frontend/src/main.tsx` 提供中文 locale。当前只实现浅色主题。

## Colors

运行时导航颜色由 `--nav-background / --nav-text / --nav-muted / --nav-hover / --nav-selected / --nav-selected-text` 管理，数据表头使用 `--table-header-bg`。青色强调使用 `--accent-color`，蓝色浅底使用 `--accent-soft`。交互控件由 theme.ts 适配，不在页面重复定义独立主题。

`primary` 对应 `--primary-color` 和 `--text-primary`；操作蓝 `secondary` 对应 `--secondary-color`；背景、表面、边框、辅助文字与成功/警告/错误分别对应同名语义 CSS 变量。颜色辅助表达状态，错误必须同时提供文字。

滚动条变量 `--scrollbar-thumb / --scrollbar-thumb-hover / --scrollbar-thumb-active / --scrollbar-track` 位于同一全局样式，所有应用滚动区域继承；高对比模式使用系统颜色。

## Typography

正文使用本机 Inter 或系统字体及中文回退，移除远程字体请求，保持 1.6 行高；JD Markdown 使用 1.8 行高以便核对列表。标题使用相同字体的较大字号及字重，代码使用系统等宽字体。长岗位名称、用户要求和生成内容允许折行。

## Layout

桌面导航宽 236px，收起为 76px，内容区同步调整并保留用户选择。1024px 以下通过模态 Drawer 导航，600px 以下保留当前位置与账户入口。内容区使用自然文档滚动，32px 桌面留白、16px 手机留白。招聘概览采用四列指标、招聘进程与工作入口双栏，窄屏指标两列，其余纵向排列。

共享 PageHeader 使用一个 h1、简短任务说明和清楚的主操作。列表筛选统一放入有边框的工具区，批量操作显示已选数量。密集表格在窄屏水平滚动并展示操作提示。

岗位表单采用 20px 栅格间距，Ant Design `Row/Col` 在小于 576px 时切为单列；段落以 16/24px 分隔。JD 双栏在 640px 以下切单列。岗位表格自身水平滚动，不限制相邻表单的自然高度。弹窗正文内部滚动，底部操作保持可达。

## Elevation & Depth

白色内容区域配浅色边框和低对比阴影。普通卡片悬停保持位置。弹窗由 Ant Design 管理遮罩与焦点。JD 阅读卡片不随悬停移动，避免编辑时内容跳动。

## Shapes

控件 8px，容器 12/16px，状态标签 5px。品牌标识使用边框与青色角点，图标沿用 Ant Design。

## Components

全站导航由 Layout 管理，基于角色显示原有入口，嵌套路由使用最长父路径匹配。PageHeader 管理主要列表的页面层级，RouteFeedback 管理加载和页面错误。登录页提供真实邮箱/密码标签、密码显隐、持久错误和返回原页面。招聘概览使用真实 API 数据，部分接口失败保留其它模块，趋势图同时提供数据表。

共享岗位字段由 `frontend/src/components/PositionFields/index.tsx` 管理，两个编辑入口复用。岗位职责上方提供「岗位要求（辅助 AI 生成 JD）」多行输入，AI 入口紧跟输入区，支持先描述招聘背景、核心技能与经验再生成草稿。Select/Listbox 使用 Ant Design authored popup。JD 助手由 `frontend/src/components/JDGeneratorModal` 管理，Markdown 预览不使用原始 HTML。主操作使用蓝色实心按钮；危险操作有明确文字及确认。

加载使用真实不定进度；禁止虚构百分比。输入框保留键盘焦点和可见错误；textarea 自动增长且禁止手动拖动。忙碌状态禁止重复提交，但提供停止 AI 生成。说明文案必须区分「填入表单」与「保存岗位」。

沿用 Ant Design 图标。减少动态效果时禁用页面入场和悬停位移。所有组件状态由 Ant Design 和 UX-CONTRACT 约束，新增颜色从运行时变量读取。

## Do's and Don'ts

- 保留现有招聘工作台的视觉语言和中文操作词。
- 先核对草稿，再明确采纳和保存。
- 不将未经校验的 JSON、异常堆栈或服务商报错原文展示为岗位内容。
- 不用装饰性动画影响表单阅读、焦点或操作位置。

## 招聘流程界面（2026-11-13）

新增工作台、面试日历、招聘质量与面试工作区沿用现有导航、PageHeader、浅色数据画布、主操作和中文 Ant Design 控件。工作台使用任务卡片与实际数量，日历事件可通过键盘进入面试，密集信息使用可滚动表格。

面试进行中沿用原评分页的左侧简历、右侧逐题面试布局。简历原件与当前题目并排可见，题号导航、追问、参考答案、评分标准和逐题记录属于题目区域，整场笔记位于题目下方。面试资料面板各自管理滚动，页面保留自然滚动。900px 以下通过「面试题与记录 / 候选人简历」切换阅读区域，并保留输入。

面试结束后展示证据与人工操作双栏，简历与逐题记录可展开查看。原文引用使用 `--accent-soft` 与文本边线，定位后保留高亮。录音与分析展示实际状态、已保存分片和执行记录。长转写独立滚动，减少整页定位距离。全屏面试收起站点导航，应用弹窗和焦点管理继续可用。

新模块样式集中在 `frontend/src/pages/Recruitment/style.css`，颜色从 `frontend/src/index.css` 的既有语义变量读取。控件主题继续由 `theme.ts` 适配。错误包含文字反馈与重试操作，流程状态同时提供文字标签。
