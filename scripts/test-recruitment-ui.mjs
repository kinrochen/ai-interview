// Isolated browser regression with mock API and a synthetic microphone.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
const output = process.env.UI_TEST_OUTPUT || "/tmp/ai-interview-recruitment-ui";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browserProcess;
let browserDataDir;
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", ({ data }) => {
      const item = JSON.parse(data);
      if (item.id) {
        const pending = this.pending.get(item.id);
        if (!pending) return;
        this.pending.delete(item.id);
        clearTimeout(pending.timer);
        if (item.error)
          pending.reject(new Error(`${pending.method}: ${item.error.message}`));
        else pending.resolve(item.result || {});
      } else for (const listener of this.listeners) listener(item);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
}

const now = () => new Date().toISOString();
const user = {
  id: "ui-user",
  full_name: "测试管理员",
  email: "ui@example.test",
  role: "admin",
};
const stats = {
  total_resumes: 1,
  pending_screening: 0,
  pending_interview: 1,
  interview_completed: 0,
  offer_pending: 0,
  offer_accepted: 0,
  rejected: 0,
};
const position = {
  id: "p1",
  title: "平台工程师",
  description: "岗位职责",
  requirements: "工程经验",
  status: "published",
  department: "研发部",
  headcount: 1,
  urgency: "medium",
  position_type: "full_time",
  created_at: now(),
  updated_at: now(),
  stats,
};
const offer = {
  id: "o1",
  resume_id: "r1",
  position_id: "p1",
  candidate_name: "测试候选人",
  candidate_email: "candidate@example.test",
  status: "accepted",
  position_title: "平台工程师",
  salary_monthly: 20000,
  actual_onboarded_at: null,
  departed_at: null,
  created_at: now(),
  updated_at: now(),
};
const workspace = {
  id: "i1",
  candidate_name: "测试候选人",
  position_title: position.title,
  round: 1,
  scheduled_at: now(),
  state: "scheduled",
  status: "scheduled",
  legacy_completed: false,
  questions: [
    {
      title: "平台项目设计",
      content: "请介绍一个你负责的平台项目。",
      resume_association: "某平台的缓存治理与性能优化",
      follow_up: ["如何定位缓存热点", "如何验证改进结果"],
      reference_answer: "说明系统边界、设计取舍与验证数据。",
      grading_criteria: { 高分: "有完整证据和取舍分析" },
      difficulty: "senior",
      type: "project",
    },
    "如何排查一个接口响应时间突然升高的问题？",
  ],
  questions_revision: "questions-0",
  questions_pending: false,
  resume: {
    id: "r1",
    file_path: "/uploads/resumes/test-candidate.pdf",
    raw_text:
      "测试候选人\n教育经历\n测试大学 · 计算机科学\n项目经历\n负责平台缓存治理与性能优化。",
    parsed_data: {
      school: "测试大学",
      highest_degree: "硕士",
      years_of_experience: 5,
    },
  },
  position: {
    description: "负责平台研发与系统稳定性。",
    requirements: "具备分布式系统和缓存治理经验。",
  },
  is_member: true,
  recording_owner_id: null,
  chunk_count: 0,
  audio_available: false,
  transcript: null,
  analysis_status: "pending",
  analysis_revision: 0,
  analysis: null,
  analysis_error: null,
  reviews: [
    {
      interviewer_id: user.id,
      name: user.full_name,
      submitted_at: null,
      note: "",
      question_scores: {},
      question_comments: {},
    },
  ],
  final_decision_at: null,
  result: "pending",
  decision_history: [],
  tasks: [],
};
const transcript = {
  text: "我使用过 Redis 集群，解决热点缓存问题。",
  has_timestamps: true,
  segments: [
    {
      id: "s1",
      start: 12,
      end: 18,
      text: "我使用过 Redis 集群，解决热点缓存问题。",
      speaker: "候选人",
    },
  ],
  warnings: [],
};
const flow = {
  id: "r1",
  candidate_name: "测试候选人",
  position_id: position.id,
  position_title: position.title,
  cycle: 1,
  stage_label: "HR 综合决策",
  state: "overdue",
  due_at: now(),
  owner_name: user.full_name,
  link: "/resumes/r1",
  history: [
    {
      label: "部门初评",
      started_at: now(),
      completed_at: now(),
      due_at: now(),
      on_time: true,
    },
  ],
  evidence: [
    {
      id: "e1",
      type: "updated",
      at: now(),
      subject: "resumes",
      details: {
        status: { old: "pending_dept_review", new: "pending_hr_decision" },
      },
    },
  ],
};
function resumePdf() {
  const stream =
    "BT /F1 18 Tf 44 760 Td (Test Candidate) Tj 0 -38 Td /F1 12 Tf (Platform engineering and cache performance) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
const requests = [];
const asrSettings = {
  provider: "dashscope",
  model: "paraformer-realtime-v2",
  base_url: "",
  has_api_key: false,
  configured: false,
};
let failChunk = true;
let failFollowup = true;
let failQuestionRecord = true;
let failQuestionUpdate = true;
let questionRevision = 0;
const storedChunks = new Set();
async function mock(path, method, body, url) {
  if (path === "/auth/me") return user;
  if (path === "/auth/users") return [user];
  if (path === "/recruitment/workbench")
    return {
      counts: {
        upcoming: 1,
        in_progress: 0,
        pending_reviews: 0,
        department_reviews: 0,
      },
      upcoming: [
        {
          id: "i1",
          candidate_name: "测试候选人",
          position_title: position.title,
          round: 1,
          time: now(),
        },
      ],
      in_progress: [],
      pending_reviews: [],
      department_reviews: [],
    };
  if (path === "/recruitment/calendar")
    return [
      {
        id: "i1",
        candidate_name: "测试候选人",
        position_title: position.title,
        start: "2026-11-13T01:00:00Z",
        end: "2026-11-13T02:00:00Z",
        estimated_end: true,
        status: workspace.status,
        round: 1,
      },
    ];
  if (path === "/settings/system")
    return {
      llm_model: "test-model",
      llm_api_key_set: true,
      llm_api_key_last4: "test",
    };
  if (path === "/settings/mail")
    return {
      smtp_port: 465,
      smtp_password_set: false,
      mail_enabled: false,
      mail_from_name: "招聘系统",
    };
  if (path === "/settings/prompts")
    return { prompts: { generate_jd: { system: "system", user: "prompt" } } };
  if (path === "/settings/prompts/variables")
    return { variables_by_prompt: {}, all_variables: {} };
  if (path === "/interview-workflow/settings/asr") {
    if (method === "PUT") {
      asrSettings.provider = body.provider;
      asrSettings.model = body.model;
      asrSettings.has_api_key = !!body.api_key || asrSettings.has_api_key;
      asrSettings.configured = asrSettings.has_api_key;
      return { success: true };
    }
    return asrSettings;
  }
  if (path === "/interview-workflow/i1") return workspace;
  if (path === "/interview-workflow/i-cancelled")
    return {
      ...workspace,
      id: "i-cancelled",
      state: "cancelled",
      status: "cancelled",
      final_decision_at: null,
      decision_history: [],
      reviews: [{ ...workspace.reviews[0], note: "已保存的现场面试笔记" }],
    };
  if (path.startsWith("/interview-workflow/i1/")) {
    const action = path.slice("/interview-workflow/i1/".length);
    if (action === "start")
      Object.assign(workspace, {
        state: "in_progress",
        status: "in_progress",
        started_at: now(),
      });
    if (action === "recording/claim") workspace.recording_owner_id = user.id;
    if (action === "recording/release") workspace.recording_owner_id = null;
    if (action === "recording/chunks") {
      if (failChunk) {
        failChunk = false;
        throw { status: 503, detail: "模拟上传中断，稍后恢复" };
      }
      storedChunks.add(
        `${url.searchParams.get("session_id")}:${url.searchParams.get("index")}`,
      );
      workspace.chunk_count = storedChunks.size;
    }
    if (action === "questions") {
      if (body.expected_revision !== workspace.questions_revision)
        throw { status: 409, detail: "面试题已更新，请刷新后重试" };
      if (body.action === "update" && failQuestionUpdate) {
        failQuestionUpdate = false;
        throw { status: 503, detail: "模拟题目保存失败，内容已保留" };
      }
      if (body.action === "add") workspace.questions.push(body.question);
      if (body.action === "update")
        workspace.questions[body.index] = body.question;
      if (body.action === "delete") {
        workspace.questions.splice(body.index, 1);
        for (const field of ["question_scores", "question_comments"]) {
          workspace.reviews[0][field] = Object.fromEntries(
            Object.entries(workspace.reviews[0][field])
              .filter(([key]) => Number(key) !== body.index)
              .map(([key, value]) => [
                String(
                  Number(key) > body.index ? Number(key) - 1 : Number(key),
                ),
                value,
              ]),
          );
        }
      }
      workspace.questions_revision = `questions-${++questionRevision}`;
    }
    if (action === "question-review") {
      if (failQuestionRecord) {
        failQuestionRecord = false;
        throw { status: 503, detail: "模拟逐题记录保存失败，草稿已保留" };
      }
      workspace.reviews[0].question_scores[body.index] = body.score;
      workspace.reviews[0].question_comments[body.index] = body.comments;
    }
    if (action === "note") workspace.reviews[0].note = body.text;
    if (action === "end")
      Object.assign(workspace, {
        state: "ended",
        status: "analyzing",
        ended_at: now(),
        transcript,
        analysis_status: "failed",
        analysis_error: "模拟分析失败，请重试",
        tasks: [
          { id: "t1", kind: "asr", revision: 1, status: "failed", attempts: 3 },
        ],
      });
    if (action === "analysis/retry" || action === "transcript")
      Object.assign(workspace, {
        analysis_status: "completed",
        analysis_error: null,
        transcript,
        analysis: {
          dimensions: [
            {
              key: "technical_fit",
              label: "技术匹配",
              score: 8,
              assessment: "有缓存与问题解决的直接证据",
              evidence: [
                { segment_id: "s1", quote: "Redis 集群", start: 12, end: 18 },
              ],
            },
          ],
          segments_analyzed: 1,
          coverage_weight: 35,
          method: "完整转写分析",
        },
      });
    if (action === "review")
      Object.assign(workspace.reviews[0], { ...body, submitted_at: now() });
    if (action === "decision")
      Object.assign(workspace, {
        final_decision_at: now(),
        status: "completed",
        result: body.result,
        decision_history: [
          { ...body, at: now(), old: "pending", actor: user.id },
        ],
      });
    return { success: true };
  }
  if (path === "/positions/page") return { items: [position], total: 1 };
  if (path === "/positions") return [position];
  if (path === "/recruitment/positions/p1/hc")
    return {
      cycle: 1,
      target: 1,
      occupied: 0,
      employed: 0,
      available: 1,
      cumulative_onboarded: 0,
      slots: [{ id: "slot1", number: 1, status: "active" }],
      history: [{ at: now(), type: "created", details: {} }],
    };
  if (path === "/recruitment/positions/p1/action") {
    position.status = body.action === "pause" ? "paused" : "published";
    return { success: true };
  }
  if (path === "/offers") return { items: [offer], total: 1 };
  if (path === "/offers/stats")
    return {
      total_offers: 1,
      pending_offers: 0,
      sent_offers: 0,
      accepted_offers: 1,
      rejected_offers: 0,
      expired_offers: 0,
      acceptance_rate: 100,
      avg_response_days: 1,
    };
  if (path === "/resumes") return [];
  if (path === "/recruitment/offers/o1/onboarding") {
    offer.actual_onboarded_at = now();
    return { success: true };
  }
  if (path === "/recruitment/offers/o1/departure") {
    offer.departed_at = now();
    offer.status = "departed";
    return { success: true };
  }
  if (path === "/recruitment/quality/options")
    return {
      positions: [{ value: "p1", label: position.title }],
      owners: [{ value: user.id, label: user.full_name }],
    };
  if (path === "/recruitment/quality")
    return {
      items: [flow],
      total: 1,
      counts: { overdue: 1, on_track: 0, waiting: 0, unknown: 0 },
      eligible_phases: 1,
      on_time_phases: 1,
    };
  if (path === "/recruitment/quality/r1/followups") {
    if (failFollowup) {
      failFollowup = false;
      throw { status: 503, detail: "模拟跟进保存失败" };
    }
    flow.evidence.push({
      id: "e2",
      type: "followup",
      at: now(),
      details: { text: body.text },
    });
    return { success: true };
  }
  if (path === "/recruitment/quality/policy")
    return {
      rules: {
        screening: 2,
        assign_review: 2,
        hr_decision: 1,
        schedule: 2,
        human_review: 1,
        final_decision: 1,
        offer_send: 2,
        onboarding: 1,
      },
      version: 1,
    };
  throw { status: 404, detail: `Unhandled mock ${method} ${path}` };
}
async function main() {
  browserDataDir = await mkdtemp("/tmp/ai-interview-recruitment-chrome-");
  browserProcess = spawn(
    process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--remote-debugging-port=0",
      `--user-data-dir=${browserDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let port;
  for (let i = 0; i < 150 && !port; i++) {
    port = await readFile(`${browserDataDir}/DevToolsActivePort`, "utf8")
      .then((t) => t.split("\n")[0])
      .catch(() => undefined);
    if (!port) await pause(100);
  }
  assert.ok(port, "Chrome starts");
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(
    (r) => r.json(),
  );
  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.open();
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const failures = [];
  const checks = [];
  cdp.listeners.push((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.method === "Runtime.exceptionThrown")
      failures.push(
        event.params.exceptionDetails.exception?.description ||
          event.params.exceptionDetails.text,
      );
    if (event.method !== "Fetch.requestPaused") return;
    void (async () => {
      const { requestId, request } = event.params;
      const url = new URL(request.url);
      if (url.pathname === "/uploads/resumes/test-candidate.pdf") {
        await send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/pdf" }],
          body: resumePdf(),
        });
        return;
      }
      const path = url.pathname.replace(/^\/api/, "");
      const body = request.postData?.startsWith("{")
        ? JSON.parse(request.postData)
        : null;
      requests.push({ path, method: request.method, body });
      let result;
      let status = 200;
      try {
        result = await mock(path, request.method, body, url);
      } catch (error) {
        status = error.status || 500;
        result = { detail: error.detail || String(error) };
      }
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64"),
      }).catch(() => undefined);
    })().catch((error) => failures.push(error.message));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result?.value;
  };
  const waitFor = async (expression, description) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(
      `Timeout ${description}\n${await evaluate("document.body.innerText.slice(-7000)")}`,
    );
  };
  const click = (selector) =>
    waitFor(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled || !el.getBoundingClientRect().height) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`,
      selector,
    );
  const textClick = (text, selector = "button") =>
    waitFor(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.getBoundingClientRect().height && el.textContent.replace(/\\s/g,'') === ${JSON.stringify(text.replace(/\s/g, ""))}); if (!el || el.disabled || el.classList.contains('ant-btn-loading')) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`,
      text,
    );
  const fill = async (selector, value) => {
    await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`,
    );
    await pause(60);
  };
  const selectOption = async (selector, label) => {
    const point = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}).closest('.ant-select'); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    const listId = await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-controls')`,
    );
    await textClick(
      label,
      `.ant-select-dropdown:has(#${listId}) .ant-select-item-option-content`,
    );
  };
  const go = (path) => send("Page.navigate", { url: `${appUrl}${path}` });
  const shot = async (name) => {
    await pause(300);
    const png = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${output}/${name}.png`, Buffer.from(png.data, "base64"));
  };
  try {
    await mkdir(output, { recursive: true });
    await rm(`${output}/results.json`, { force: true });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", {
      patterns: [
        { urlPattern: `${appUrl}/api/*`, requestStage: "Request" },
        { urlPattern: `${appUrl}/uploads/resumes/*`, requestStage: "Request" },
      ],
    });
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: 'localStorage.setItem("token", "isolated-recruitment-test");',
    });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await go("/workbench");
    await waitFor(
      'document.querySelector("h1")?.textContent === "我的工作台" && document.body.innerText.includes("测试候选人")',
      "workbench",
    );
    assert.equal(
      await evaluate('!!document.querySelector(".page-switcher")'),
      false,
    );
    await shot("workbench-desktop");
    checks.push("workbench personal tasks and clear entry");
    await go("/interviews/calendar?date=2026-11-13&view=week");
    await waitFor(
      'document.body.innerText.includes("平台工程师") && document.body.innerText.includes("预计 60 分钟")',
      "week calendar",
    );
    await textClick("月", ".ant-segmented-item");
    await waitFor(
      'document.querySelector(".recruitment-calendar-event")',
      "month calendar",
    );
    await shot("calendar-desktop");
    await click(".recruitment-calendar-event");
    await waitFor(
      'document.querySelector("h1")?.textContent.includes("面试工作区")',
      "workspace",
    );
    checks.push("calendar week/month and opening assigned interview");
    await waitFor(
      'document.querySelector("iframe[title=测试候选人的简历原件]") && document.body.innerText.includes("平台项目设计")',
      "restored resume and questions",
    );
    assert.ok(
      await evaluate(
        '(() => { const left = document.querySelector(".interview-resume-panel").getBoundingClientRect(); const right = document.querySelector(".interview-question-panel").getBoundingClientRect(); return Math.abs(left.top - right.top) < 2 && left.right <= right.left; })()',
      ),
    );
    assert.equal(
      await evaluate(
        'Boolean([...document.querySelectorAll(".ant-card-head-title")].find(el => el.textContent === "面试证据"))',
      ),
      false,
    );
    assert.ok(
      await evaluate(
        'document.querySelector("a[download]").getAttribute("href").endsWith("test-candidate.pdf")',
      ),
    );
    await textClick("解析文本", ".interview-resume-tabs .ant-tabs-tab");
    await waitFor(
      'document.querySelector(".interview-resume-text")?.innerText.includes("负责平台缓存治理")',
      "original resume text",
    );
    await textClick("岗位要求", ".interview-resume-tabs .ant-tabs-tab");
    await waitFor(
      'document.querySelector(".interview-position-context")?.innerText.includes("分布式系统")',
      "position requirements",
    );
    await textClick("简历原件", ".interview-resume-tabs .ant-tabs-tab");
    await textClick(
      "参考答案",
      ".interview-question-reference .ant-collapse-header",
    );
    await waitFor(
      'document.body.innerText.includes("说明系统边界")',
      "reference answer disclosure",
    );
    await textClick(
      "评分标准",
      ".interview-question-reference .ant-collapse-header",
    );
    await waitFor(
      'document.body.innerText.includes("有完整证据和取舍分析")',
      "structured grading criteria",
    );
    await textClick("下一题");
    await waitFor(
      'document.querySelector(".interview-question-content")?.innerText.includes("响应时间突然升高")',
      "legacy string question",
    );
    await textClick("上一题");
    checks.push(
      "original resume preview, download, position context and complete per-question guidance",
    );

    await textClick("开始面试");
    await waitFor(
      'document.querySelector("textarea[aria-label=我的面试笔记]")',
      "in progress",
    );
    const fullscreenPoint = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent.replace(/\\s/g, '') === '全屏面试');
      button.scrollIntoView({block:'center', behavior:'instant'});
      const box = button.getBoundingClientRect();
      return {x:box.x+box.width/2,y:box.y+box.height/2};
    })()`);
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...fullscreenPoint,
      });
    await waitFor(
      "document.fullscreenElement === document.documentElement",
      "fullscreen interview",
    );
    await textClick("添加题目");
    await waitFor(
      'Boolean([...document.querySelectorAll(".ant-modal")].find(modal => modal.getBoundingClientRect().height > 0 && modal.contains(document.activeElement)))',
      "fullscreen modal remains visible and focused",
    );
    await click('label[for="interview-question_content"]');
    assert.equal(
      await evaluate("document.activeElement.id"),
      "interview-question_content",
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await waitFor(
      '!document.querySelector(".ant-modal-content")',
      "question modal escape",
    );
    if (await evaluate("Boolean(document.fullscreenElement)"))
      await textClick("退出全屏");
    checks.push(
      "fullscreen interview keeps question dialogs accessible with Escape recovery",
    );
    await fill("#question-score", "0");
    await fill("#question-comment", "第一题回答依据，零分需要保留。");
    await textClick("下一题");
    await fill("#question-score", "8");
    await fill("#question-comment", "第二题能解释诊断路径。");
    await textClick("上一题");
    assert.equal(
      await evaluate('document.querySelector("#question-comment").value'),
      "第一题回答依据，零分需要保留。",
    );
    await textClick("保存全部记录");
    await waitFor(
      'document.body.innerText.includes("模拟逐题记录保存失败")',
      "question draft failure",
    );
    assert.equal(
      await evaluate('document.querySelector("#question-score").value'),
      "0",
    );
    await textClick("保存全部记录");
    await waitFor(
      '!document.body.innerText.includes("保存全部记录")',
      "all question drafts saved",
    );
    assert.equal(workspace.reviews[0].question_scores["0"], 0);
    assert.equal(workspace.reviews[0].question_scores["1"], 8);
    await click('button[aria-label="编辑当前题目"]');
    await waitFor(
      'document.querySelector("#interview-question_content")',
      "question editor",
    );
    await fill("#interview-question_title", "平台设计与故障定位");
    await textClick("保存题目", ".ant-modal button");
    await waitFor(
      'document.body.innerText.includes("模拟题目保存失败")',
      "question save recovery",
    );
    assert.equal(
      await evaluate(
        'document.querySelector("#interview-question_title").value',
      ),
      "平台设计与故障定位",
    );
    await textClick("保存题目", ".ant-modal button");
    await waitFor(
      '!document.querySelector(".ant-modal-content") && document.querySelector(".interview-question-heading h2")?.textContent === "平台设计与故障定位"',
      "question update",
    );
    assert.deepEqual(workspace.questions[0].grading_criteria, {
      高分: "有完整证据和取舍分析",
    });
    await textClick("添加题目");
    await fill("#interview-question_title", "可观测性补充题");
    await fill("#interview-question_content", "如何设计告警与监控指标？");
    await textClick("保存题目", ".ant-modal button");
    await waitFor(
      'document.querySelector(".interview-question-heading h2")?.textContent === "可观测性补充题"',
      "added question selected",
    );
    await click('button[aria-label="删除当前题目"]');
    await textClick("删除题目", ".ant-modal-confirm button");
    await waitFor(
      'document.querySelector(".interview-question-numbers")?.children.length === 2',
      "deleted question",
    );
    await click('button[aria-label="第 1 题，已记录评分"]');
    await evaluate('window.scrollTo({top:0, behavior:"instant"})');
    await pause(3500);
    await shot("interview-in-progress-desktop");
    checks.push(
      "per-question drafts retain zero scores and recover failed saves, question edit/add/delete preserve metadata",
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitFor(
      'getComputedStyle(document.querySelector(".interview-resume-column")).display === "none"',
      "mobile question-first layout",
    );
    await textClick(
      "候选人简历",
      ".interview-mobile-material-switch .ant-segmented-item",
    );
    await waitFor(
      'document.querySelector(".interview-resume-column").getBoundingClientRect().height > 0 && getComputedStyle(document.querySelector(".interview-guide-column")).display === "none"',
      "mobile resume switching",
    );
    await textClick(
      "面试题与记录",
      ".interview-mobile-material-switch .ant-segmented-item",
    );
    assert.ok(
      await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
    );
    await evaluate('window.scrollTo({top:0, behavior:"instant"})');
    await shot("interview-in-progress-mobile");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    checks.push(
      "390px live interview switches resume and question panels without losing records",
    );
    await fill("#question-comment", "结束时自动保存本题记录。");
    await fill(
      "textarea[aria-label=我的面试笔记]",
      "候选人解释了缓存热点的处理依据。",
    );
    await textClick("开始录音");
    await waitFor(
      'document.body.innerText.includes("停止并保存录音")',
      "microphone recording",
    );
    await pause(5400);
    await textClick("停止并保存录音");
    await waitFor(
      'document.body.innerText.includes("恢复上传 1 个分片")',
      "persistent interrupted chunk",
    );
    await textClick("恢复上传 1 个分片");
    await waitFor(
      '!document.body.innerText.includes("恢复上传 1 个分片")',
      "recovered chunk",
    );
    await textClick("结束面试");
    await textClick("结束面试", ".ant-modal-confirm button");
    await waitFor(
      'document.body.innerText.includes("模拟分析失败")',
      "ended with retryable analysis",
    );
    assert.equal(
      workspace.reviews[0].question_comments["0"],
      "结束时自动保存本题记录。",
    );
    assert.ok(
      requests.some(
        (r) => r.path.endsWith("/note") && r.body?.text.includes("缓存热点"),
      ),
    );
    checks.push(
      "synthetic recording, interrupted upload recovery and saved notes at end",
    );
    await textClick("重新分析");
    await waitFor(
      'document.body.innerText.includes("Redis 集群")',
      "analysis evidence",
    );
    await textClick("定位原文 12 秒");
    await waitFor(
      'document.querySelector("[data-highlight=true]")?.getBoundingClientRect().height > 0',
      "visible authoritative quote",
    );
    assert.ok(
      await evaluate(
        'document.querySelector("[data-highlight=true]").textContent.includes("Redis 集群")',
      ),
    );
    checks.push("analysis retry and quote navigation");
    await send("Page.setInterceptFileChooserDialog", { enabled: true });
    await evaluate(
      `window.__uploadInputActivated = false; document.addEventListener('click', (event) => { if (event.target.matches('input[type=file]')) window.__uploadInputActivated = true; }, true)`,
    );
    await pause(500);
    const uploadPoint = await evaluate(
      `(() => { const button = [...document.querySelectorAll('button')].find((el) => el.textContent.replace(/\\s/g, '') === '导入/更新转写'); button.scrollIntoView({block:'center', behavior:'instant'}); const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...uploadPoint,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...uploadPoint,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...uploadPoint,
    });
    await waitFor(
      "window.__uploadInputActivated",
      "upload button activates its file input",
    );
    const { root } = await send("DOM.getDocument");
    const { nodeId: uploadNode } = await send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "input[type=file]",
    });
    const transcriptFile = `${output}/sample.vtt`;
    await writeFile(
      transcriptFile,
      "WEBVTT\n\n00:00:12.000 --> 00:00:18.000\n候选人: 我使用过 Redis 集群。\n",
    );
    await send("DOM.setFileInputFiles", {
      nodeId: uploadNode,
      files: [transcriptFile],
    });
    await waitFor(
      'document.body.innerText.includes("转写已导入")',
      "transcript import",
    );
    assert.ok(
      requests.some(
        (r) => r.path.endsWith("/transcript") && r.method === "POST",
      ),
    );
    checks.push("VTT file-input activation and upload starts analysis");
    assert.equal(await evaluate('!!document.querySelector("select")'), false);
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll("form")].every((form) => form.noValidate)',
      ),
    );

    for (const key of [
      "technical_fit",
      "problem_solving",
      "learning_ability",
      "engineering_mindset",
      "collaboration",
      "culture_fit",
    ])
      await fill(`#scores_${key}`, "8");
    await fill("#comments", "技术能力与原文证据一致，可以进入录用讨论。");
    await selectOption("#recommendation", "通过");
    await textClick("提交人工评价");
    await waitFor(
      'document.body.innerText.includes("面试官评价已齐备")',
      "human review submitted",
    );
    await textClick("记录最终决策");
    await selectOption("#result", "录用");
    await fill("#reason", "综合证据与人工评价，决定录用。");
    await textClick("确认决策", ".ant-modal button");
    await waitFor(
      'document.body.innerText.includes("最终决策 · 录用")',
      "final decision",
    );
    await evaluate("window.scrollTo({ top: 0 })");
    await shot("interview-desktop");
    checks.push("human review and final decision with retained history");
    await go("/positions");
    await waitFor(
      'document.body.innerText.includes("名额与状态")',
      "position management",
    );
    await textClick("名额与状态");
    await waitFor('document.body.innerText.includes("可用名额")', "HC drawer");
    await textClick("暂停招聘");
    await fill("#reason", "等待招聘计划审批");
    await textClick("确认", ".ant-modal button");
    await waitFor(
      '!document.querySelector(".ant-modal-content")',
      "pause saved",
    );
    assert.equal(position.status, "paused");
    checks.push("position HC and lifecycle reason");
    await go("/offers");
    await waitFor(
      'document.body.innerText.includes("确认入职")',
      "onboard offer",
    );
    await textClick("确认入职");
    await textClick("确认登记", ".ant-modal button");
    await waitFor(
      'document.body.innerText.includes("登记离职")',
      "onboard success",
    );
    await textClick("登记离职");
    await fill("#reason", "个人发展");
    await textClick("确认登记", ".ant-modal button");
    await waitFor(
      'document.body.innerText.includes("已离职")',
      "departure success",
    );
    checks.push("actual onboarding and departure with HC release");
    await go("/recruitment-quality");
    await waitFor(
      'document.body.innerText.includes("HR 综合决策")',
      "quality board",
    );
    await textClick("记录与证据");
    await fill("textarea[aria-label=跟进备注]", "已联系负责人确认下一步。");
    await textClick("保存跟进备注");
    await waitFor(
      'document.body.innerText.includes("模拟跟进保存失败")',
      "followup retry",
    );
    assert.equal(
      await evaluate(
        'document.querySelector("textarea[aria-label=跟进备注]").value',
      ),
      "已联系负责人确认下一步。",
    );
    await textClick("保存跟进备注");
    await waitFor(
      '!document.querySelector("textarea[aria-label=跟进备注]")',
      "followup saved",
    );
    await shot("quality-desktop");
    checks.push("quality evidence and failed followup retains draft");
    assert.ok(
      await evaluate(
        'Boolean(document.querySelector("[aria-label=筛选岗位]") && document.querySelector("[aria-label=筛选负责人]"))',
      ),
    );
    await go("/settings/asr");
    await waitFor(
      'document.querySelector("#asr_api_key") && document.querySelector("#asr_model")',
      "ASR settings",
    );
    assert.equal(await evaluate("location.pathname"), "/settings/system");
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll(".app-sidebar a")].some((link) => link.getAttribute("href") === "/settings/asr")',
      ),
      false,
    );
    assert.ok(
      await evaluate(
        'document.body.innerText.includes("模型配置") && document.body.innerText.includes("邮件服务配置")',
      ),
    );
    await fill("#asr_api_key", "synthetic-test-asr-key");
    await textClick("保存", "#asr button");
    await waitFor(
      'document.querySelector("#asr .ant-tag")?.textContent === "已配置"',
      "ASR configuration save",
    );
    assert.equal(
      await evaluate('document.querySelector("#asr_api_key").value'),
      "",
    );
    assert.equal(await evaluate('!!document.querySelector("select")'), false);
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll("form")].every((form) => form.noValidate)',
      ),
    );
    checks.push(
      "system settings embeds DashScope configuration, masks keys and redirects the former entry",
    );

    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await go("/interviews/i1/score");
    await waitFor(
      'document.body.innerText.includes("最终决策 · 录用")',
      "mobile workspace",
    );
    assert.ok(
      await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
    );
    await shot("interview-mobile");
    checks.push("390px workspace and reduced motion");
    await go("/interviews/i-cancelled/score");
    await waitFor(
      'document.body.innerText.includes("已保存的现场面试笔记")',
      "cancelled interview retained notes",
    );
    assert.equal(
      await evaluate(
        'Boolean(document.querySelector("button[aria-label=编辑当前题目]"))',
      ),
      false,
    );
    assert.equal(
      await evaluate(
        'Boolean(document.querySelector("textarea[aria-label=我的面试笔记]"))',
      ),
      false,
    );
    checks.push(
      "cancelled interview keeps saved notes and question records available read-only",
    );
    assert.deepEqual(failures, []);
    await writeFile(
      `${output}/results.json`,
      JSON.stringify(
        {
          passed: checks,
          browserExceptions: failures,
          requests: requests.length,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: checks, output }, null, 2));
  } catch (error) {
    await shot("failure").catch(() => undefined);
    await writeFile(
      `${output}/failed-requests.json`,
      JSON.stringify(requests, null, 2),
    );
    throw error;
  } finally {
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
    cdp.ws.close();
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    browserProcess?.kill("SIGTERM");
    if (browserDataDir)
      await rm(browserDataDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
  });
