// Browser regression checks with isolated, mocked API data. No live records or AI calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:5173';
let browserProcess;
let browserDataDir;
const output = process.env.UI_TEST_OUTPUT || '/tmp/ai-interview-positions-ui';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = []; }
  async open() {
    await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', ({ data }) => {
      const item = JSON.parse(data);
      if (item.id) {
        const pending = this.pending.get(item.id);
        if (!pending) return;
        this.pending.delete(item.id);
        clearTimeout(pending.timer);
        if (item.error) pending.reject(new Error(item.error.message)); else pending.resolve(item.result || {});
      } else for (const listener of this.listeners) listener(item);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

const emptyStats = { total_resumes: 0, pending_screening: 0, pending_interview: 0, interview_completed: 0, offer_pending: 0, offer_accepted: 0, rejected: 0 };
const initial = (id, title) => ({ id, title, description: '- 现有岗位职责', requirements: '- 现有任职要求', department: '研发部', location: '上海', salary_range: '20k-30k', headcount: 1, urgency: 'medium', position_type: 'full_time', status: 'open', hiring_manager_id: null, hiring_manager_name: null, stats: emptyStats, created_at: '2026-11-11T01:00:00Z', updated_at: '2026-11-11T01:00:00Z', linked_question_banks: [] });
const state = {
  positions: [initial('position-one', '测试后端工程师'), initial('position-two', '测试产品经理')],
  dashboardFailure: false, timelineDelay: false, loginFailure: true, userRole: 'hr',
  requests: [], aiMode: 'success', aiDelay: 0, saveFail: false,
  draft: { description: '- 负责招聘产品研发\n- 推进跨团队协作', requirements: '- 熟悉 React 和 TypeScript\n- 能独立编写测试' },
};
const sse = (data) => `data: ${JSON.stringify(data)}\n\n`;

async function main() {
  let debugPort = process.env.CHROME_DEBUG_PORT;
  if (!debugPort) {
    browserDataDir = await mkdtemp('/tmp/ai-interview-ui-chrome-');
    browserProcess = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${browserDataDir}`, 'about:blank',
    ], { stdio: 'ignore' });
    let launchError;
    browserProcess.on('error', (error) => { launchError = error; });
    const deadline = Date.now() + 15000;
    while (!debugPort && Date.now() < deadline) {
      if (launchError) throw launchError;
      debugPort = await readFile(`${browserDataDir}/DevToolsActivePort`, 'utf8').then((text) => text.split('\n')[0]).catch(() => undefined);
      if (!debugPort) await pause(100);
    }
    if (!debugPort) throw new Error('Could not start headless Chrome; set CHROME_PATH or CHROME_DEBUG_PORT');
  }
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((res) => res.json());
  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.open();
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const failures = [];
  const checks = [];
  cdp.listeners.push((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.method === 'Runtime.exceptionThrown') failures.push(event.params.exceptionDetails.text);
    if (event.method !== 'Fetch.requestPaused') return;
    void (async () => {
      const { requestId, request } = event.params;
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api/, '');
      const payload = request.postData ? (path === '/auth/token' ? request.postData : JSON.parse(request.postData)) : null;
      state.requests.push({ method: request.method, path, payload, search: url.search });
      let body;
      let status = 200;
      let contentType = 'application/json';
      if (path === '/auth/me') body = { id: 'ui-user', full_name: '测试 HR', email: 'ui@example.test', role: state.userRole };
      else if (path === '/auth/token') {
        if (state.loginFailure) { status = 401; body = { detail: 'Incorrect username or password' }; }
        else body = { access_token: 'isolated-ui-test', token_type: 'bearer' };
      }
      else if (path === '/auth/users') body = [];
      else if (path === '/dashboard/stats') body = { stats: { active_positions: 4, pending_resumes: 12, today_interviews: 3, total_questions: 8, trends: { active_positions: 2, pending_resumes: 6, today_interviews: 7, total_questions: 1 } }, recent_activities: [] };
      else if (path === '/dashboard/funnel') body = { total_resumes: 20, conversion_rate: 10, stages: [{ stage: 'received', stage_name: '简历投递', count: 20, percentage: 100 }, { stage: 'interview', stage_name: '面试完成', count: 5, percentage: 25 }, { stage: 'hired', stage_name: '入职', count: 2, percentage: 10 }] };
      else if (path === '/dashboard/positions') {
        if (state.dashboardFailure) { status = 503; body = { detail: 'Test section unavailable' }; }
        else body = { positions: [] };
      }
      else if (path === '/dashboard/interviewers') body = { interviewers: [] };
      else if (path === '/dashboard/overview') body = { metrics: { interview_pass_rate: 0, offer_accept_rate: 0, avg_time_to_hire: 0, avg_match_score: 0 } };
      else if (path === '/dashboard/timeline') {
        const days = Number(url.searchParams.get('days'));
        if (state.timelineDelay && days === 7) await pause(1000);
        body = { timeline: [{ date: '2026-11-12', resumes_received: days, interviews_scheduled: 2, interviews_completed: 1, offers_sent: 1, hires: 0 }] };
      }
      else if (path === '/positions/page') {
        const filtered = state.positions.filter((item) => (!url.searchParams.get('title') || item.title.includes(url.searchParams.get('title'))) && (!url.searchParams.get('status') || item.status === url.searchParams.get('status')));
        body = { items: filtered.slice(Number(url.searchParams.get('skip')), Number(url.searchParams.get('skip')) + Number(url.searchParams.get('limit'))), total: filtered.length };
      } else if (path.endsWith('-jd-stream')) {
        const mode = state.aiMode;
        const draft = { ...state.draft };
        const delay = state.aiDelay;
        contentType = 'text/event-stream';
        if (delay) await pause(delay);
        body = mode === 'error' ? sse({ error: 'AI 测试错误，请重试' }) : mode === 'unauthorized' ? { detail: 'Not authenticated' } : sse({ content: JSON.stringify(draft) }) + sse({ done: true, ...draft });
        if (mode === 'unauthorized') { status = 401; contentType = 'application/json'; }
      } else if (path === '/positions' && request.method === 'POST') {
        if (state.saveFail) { status = 500; body = { detail: '保存暂时不可用，请重试' }; }
        else { body = { ...initial(`created-${state.positions.length}`, payload.title), ...payload }; state.positions.push(body); }
      } else if (path.startsWith('/positions/')) {
        const id = path.split('/').pop();
        const item = state.positions.find((entry) => entry.id === id);
        if (request.method === 'DELETE') {
          if (id === 'position-two') { status = 400; body = { detail: '无法删除该岗位，存在 1 份关联简历' }; }
          else { state.positions = state.positions.filter((entry) => entry.id !== id); body = item; }
        } else if (request.method === 'PUT') { Object.assign(item, payload); body = item; }
        else body = item;
      } else { status = 404; body = { detail: `Unhandled mock: ${path}` }; }
      await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: contentType }], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') }).catch(() => undefined);
    })().catch((error) => failures.push(error.message));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const waitFor = async (expression, description) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
    throw new Error(`UI timeout: ${description}\n${await evaluate('document.body.innerText.slice(-5000)')}`);
  };
  const click = async (selector) => {
    await waitFor(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled || !el.getBoundingClientRect().height) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`, `control ${selector}`);
  };
  const textClick = async (text, selector = 'button') => {
    await waitFor(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.getBoundingClientRect().height && el.textContent.replace(/\\s/g,'') === ${JSON.stringify(text.replace(/\s/g, ''))}); if (!el || el.disabled || !el.getBoundingClientRect().height) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`, `button ${text}`);
  };
  const fill = async (selector, value) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing input'); el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await pause(50);
  };
  const waitDraft = () => waitFor(`document.querySelector('.jd-markdown')?.textContent.includes(${JSON.stringify(state.draft.description.split('\n')[0].slice(2))}) && !document.querySelector('.jd-draft-grid')?.getAttribute('aria-busy')?.includes('true')`, 'draft ready');
  const screenshot = async (name) => {
    await pause(400);
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`${output}/${name}.png`, Buffer.from(image.data, 'base64'));
  };
  try {
    await mkdir(output, { recursive: true });
    await rm(`${output}/results.json`, { force: true });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: `${appUrl}/api/*`, requestStage: 'Request' }] });
    const authScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'localStorage.setItem("token", "isolated-ui-test");' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${appUrl}/positions` });
    await waitFor('document.body.innerText.includes("测试后端工程师")', 'position list');
    assert.equal(await evaluate('document.querySelector("[aria-label=查找页面]") === null'), true);
    await screenshot('positions-without-page-search');
    await textClick('新增岗位');
    await fill('#title', '测试 AI 前端工程师');
    await fill('#department', '产品研发部');
    await fill('#location', '上海');
    await fill('#salary_range', '25k-35k');
    const initialGuidance = '负责企业级 AI 产品前端研发，需要熟悉 React 和 TypeScript。\n有产品交付经验，能够推动跨团队协作。';
    const generationGuidance = `${initialGuidance}\n不限制学历，强调测试能力。`;
    await fill('#jd_guidance', initialGuidance);
    assert.equal(await evaluate('document.querySelector(".ant-modal form").noValidate'), true);
    assert.equal(await evaluate('document.querySelectorAll(".ant-modal select").length'), 0);
    await evaluate('document.querySelector("#jd_guidance").scrollIntoView({block:"center"})');
    await screenshot('position-guidance');
    await textClick('AI 生成 / 优化 JD');
    await waitFor('document.querySelector("#jd-keywords")', 'JD assistant');
    assert.equal(state.requests.filter((item) => item.path.endsWith('-jd-stream')).length, 0, 'opening must not automatically request AI');
    assert.equal(await evaluate('document.querySelector("#jd-keywords").value'), initialGuidance);
    await fill('#jd-keywords', generationGuidance);
    await textClick('取消', '.jd-assistant button');
    await waitFor('!document.querySelector("#jd-keywords")', 'assistant closes');
    assert.equal(await evaluate('document.querySelector("#jd_guidance").value'), generationGuidance);
    await textClick('AI 生成 / 优化 JD');
    await waitFor('document.querySelector("#jd-keywords")', 'reopen assistant');
    assert.equal(await evaluate('document.querySelector("#jd-keywords").value'), generationGuidance);
    checks.push('guidance: multiline form input, assistant synchronization and close/reopen retention');
    await textClick('开始生成');
    await waitDraft();
    const firstAi = state.requests.find((item) => item.path === '/positions/generate-jd-stream').payload;
    assert.equal(firstAi.title, '测试 AI 前端工程师');
    assert.equal(firstAi.keywords, generationGuidance);
    assert.equal(firstAi.salary_range, '25k-35k');
    checks.push('generation: explicit start, metadata, requirements and Markdown preview');
    await screenshot('jd-desktop');

    await textClick('编辑', '.jd-assistant .ant-segmented-item');
    await fill('textarea[aria-label="编辑岗位职责"]', '- 手动修改后的职责');
    await fill('#jd-revision', '增加性能优化职责');
    const callsBeforeComposition = state.requests.length;
    await evaluate(`document.querySelector('#jd-revision').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', isComposing:true, bubbles:true}))`);
    await pause(150);
    assert.equal(state.requests.length, callsBeforeComposition, 'IME Enter must not send');
    state.aiMode = 'error';
    await textClick('按要求修改');
    await waitFor('document.querySelector(".jd-feedback")?.textContent.includes("AI 测试错误")', 'revision error');
    assert.equal(await evaluate('document.querySelector("#jd-revision").value'), '增加性能优化职责');
    assert.equal(await evaluate('document.querySelector("textarea[aria-label=编辑岗位职责]").value'), '- 手动修改后的职责');
    state.aiMode = 'success';
    state.draft = { description: '- 负责性能优化和前端研发', requirements: '- 熟悉 React 性能分析' };
    await textClick('按要求修改');
    await waitDraft();
    const revision = state.requests.filter((item) => item.path === '/positions/chat-jd-stream').at(-1).payload;
    assert.equal(revision.current_description, '- 手动修改后的职责');
    assert.equal(revision.messages.length, 1);
    assert.equal(revision.location, '上海');
    assert.equal(revision.keywords, generationGuidance);
    checks.push('revision: manual edits, IME, error preservation and retry context');

    state.aiDelay = 1200;
    state.draft = { description: '- 不应覆盖的迟到内容', requirements: '- 不应覆盖的迟到要求' };
    await textClick('生成新版本');
    await waitFor('document.body.innerText.includes("停止生成")', 'stop control');
    await textClick('停止生成');
    await pause(1400);
    assert.ok(await evaluate('document.querySelector(".jd-markdown").textContent.includes("负责性能优化")'));
    state.aiDelay = 0;
    checks.push('cancel: late responses cannot overwrite the retained draft');

    await textClick('恢复上一版');
    assert.ok(await evaluate('document.querySelector(".jd-markdown").textContent.includes("手动修改后的职责")'));
    state.draft = { description: '- 最终确认的岗位职责', requirements: '- 最终确认的任职要求' };
    await textClick('生成新版本');
    await waitDraft();
    await textClick('采纳并填入表单');
    await waitFor('!document.querySelector("#jd-keywords")', 'adopt closes assistant');
    assert.equal(await evaluate('document.querySelector("#description").value'), state.draft.description);
    assert.equal(state.requests.filter((item) => item.method === 'POST' && item.path === '/positions').length, 0);
    state.saveFail = true;
    await textClick('保存');
    await waitFor('document.body.innerText.includes("保存暂时不可用")', 'save error');
    assert.equal(await evaluate('document.querySelector("#description").value'), state.draft.description);
    assert.equal(await evaluate('document.querySelector("#jd_guidance").value'), generationGuidance);
    state.saveFail = false;
    await textClick('保存');
    await waitFor('document.querySelector(".ant-table-tbody")?.textContent.includes("测试 AI 前端工程师")', 'saved position');
    const savedPosition = state.requests.filter((item) => item.method === 'POST' && item.path === '/positions').at(-1).payload;
    assert.equal('jd_guidance' in savedPosition, false);
    assert.equal(savedPosition.requirements, state.draft.requirements);
    checks.push('adopt/save: explicit persistence, failure recovery and successful create');

    await click('button[aria-label="编辑 测试后端工程师"]');
    await waitFor('document.querySelector("#title")?.value === "测试后端工程师"', 'edit position');
    assert.equal(await evaluate('document.querySelector("#jd_guidance").value'), '');
    await textClick('AI 生成 / 优化 JD');
    await waitFor('document.querySelector(".jd-markdown")?.textContent.includes("现有岗位职责")', 'existing draft');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await pause(300);
    const layout = await evaluate(`(() => { const modal = document.querySelector('.jd-assistant').getBoundingClientRect(); const grid = getComputedStyle(document.querySelector('.jd-draft-grid')); return {left:modal.left,right:modal.right,width:innerWidth,columns:grid.gridTemplateColumns}; })()`);
    assert.ok(layout.left >= 0 && layout.right <= layout.width + 1);
    assert.ok(!layout.columns.includes(' '), 'narrow draft must use one column');
    await screenshot('jd-mobile');
    checks.push('responsive: 390px, single-column draft, accessible actions and reduced motion');
    await textClick('取消', '.jd-assistant button');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await pause(400);
    await evaluate('document.querySelector(".ant-modal [role=combobox]").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await waitFor('document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")?.getBoundingClientRect().width > 0', 'authored popup');
    await pause(250);
    const popupWidths = await evaluate(`(() => { const trigger = document.querySelector('.ant-modal [role=combobox]').closest('.ant-select').getBoundingClientRect(); const popup = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getBoundingClientRect(); return {trigger:trigger.width,popup:popup.width}; })()`);
    assert.ok(Math.abs(popupWidths.trigger - popupWidths.popup) <= 1, `popup matches trigger width: ${JSON.stringify(popupWidths)}`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await fill('#title', '未保存的岗位修改');
    await textClick('取消', '.ant-modal button');
    await textClick('继续编辑', '.ant-modal-confirm button');
    assert.equal(await evaluate('document.querySelector("#title").value'), '未保存的岗位修改');
    await textClick('取消', '.ant-modal button');
    await textClick('放弃修改', '.ant-modal-confirm button');
    await waitFor('!document.querySelector("#title")', 'discard closes edit form');
    checks.push('unsaved form: cancel can retain edits or explicitly discard them');

    await click('.ant-table-thead input[type="checkbox"]');
    await textClick('批量删除');
    await textClick('删除', '.ant-modal-confirm button');
    await waitFor('document.body.innerText.includes("1 个失败")', 'partial batch failure');
    assert.ok(state.positions.some((item) => item.id === 'position-two'));
    assert.ok(!state.positions.some((item) => item.id === 'position-one'));
    checks.push('bulk delete: exact success/failure counts and retained failed selection');

    await send('Page.navigate', { url: `${appUrl}/positions/new` });
    await waitFor('document.querySelector("#title") && document.body.innerText.includes("保存岗位")', 'standalone form');
    await fill('#title', '独立表单岗位');
    const standaloneGuidance = '需要熟悉 Python、RAG 和大模型接口。\n重点关注 AI 产品落地和测试能力。';
    await fill('#jd_guidance', standaloneGuidance);
    assert.equal(await evaluate('document.querySelector("form").noValidate'), true);
    await textClick('返回列表');
    await textClick('继续编辑', '.ant-modal-confirm button');
    assert.equal(await evaluate('location.pathname'), '/positions/new');
    await textClick('AI 生成 / 优化 JD');
    await waitFor(`document.querySelector("#jd-keywords")?.value === ${JSON.stringify(standaloneGuidance)}`, 'standalone guidance ready');
    assert.equal(await evaluate('document.querySelector("#jd-keywords").value'), standaloneGuidance);
    await textClick('开始生成');
    await waitDraft();
    assert.equal(state.requests.filter((item) => item.path === '/positions/generate-jd-stream').at(-1).payload.keywords, standaloneGuidance);
    await textClick('采纳并填入表单');
    await textClick('保存岗位');
    await waitFor('location.pathname === "/positions" && document.body.innerText.includes("独立表单岗位")', 'standalone save');
    assert.equal('jd_guidance' in state.requests.filter((item) => item.method === 'POST' && item.path === '/positions').at(-1).payload, false);
    checks.push('standalone form: same AI flow and save destination');
    // The shared shell must resize the content area with its desktop rail.
    const beforeCollapse = await evaluate('document.querySelector(".app-main").getBoundingClientRect().left');
    await click('button[aria-label="收起导航"]');
    await pause(300);
    assert.ok(await evaluate('document.querySelector(".app-main").getBoundingClientRect().left') < beforeCollapse);
    await click('button[aria-label="展开导航"]');
    await waitFor('document.title === "岗位管理 · AI Interview"', 'route-specific title');
    checks.push('shell: desktop collapse, restored content geometry and route titles');

    state.dashboardFailure = true;
    await textClick('招聘概览', '.app-sidebar a');
    await waitFor('document.body.innerText.includes("岗位分析未能更新") && document.querySelector(".metric-value")?.textContent === "4"', 'partial dashboard recovery');
    assert.equal(await evaluate('document.querySelector(".overview-metrics strong").textContent'), '0.0%');
    assert.equal(await evaluate('document.querySelectorAll(".overview-metrics strong")[2].textContent'), '0.0 天');
    state.dashboardFailure = false;
    await textClick('重试');
    await waitFor('!document.body.innerText.includes("岗位分析未能更新")', 'section retry');
    await screenshot('dashboard-desktop');
    checks.push('dashboard: section failure keeps successful data, zero values and explicit retry');

    state.timelineDelay = true;
    await evaluate('document.querySelector("[aria-label=趋势时间范围]").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await textClick('近 7 天', '.ant-select-item-option-content');
    await pause(100);
    await evaluate('document.querySelector("[aria-label=趋势时间范围]").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await textClick('近 90 天', '.ant-select-item-option-content');
    await textClick('数据表', '[role="tab"]');
    await waitFor('document.querySelector(".timeline-content .ant-table-tbody")?.textContent.includes("90")', 'latest timeline result');
    await pause(1200);
    assert.ok(await evaluate('document.querySelector(".timeline-content .ant-table-tbody").textContent.includes("90")'));
    checks.push('dashboard: range changes cancel stale responses and expose accessible table values');

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
    await evaluate('document.querySelector("button[aria-label=打开导航]").focus()');
    await click('button[aria-label="打开导航"]');
    await waitFor('document.querySelector(".ant-drawer-open")', 'mobile navigation');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".navigation-drawer")).backgroundColor'), await evaluate('getComputedStyle(document.querySelector(".app-sidebar")).backgroundColor'), 'mobile drawer keeps the dark navigation surface');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor('!document.querySelector(".ant-drawer-open")', 'Escape closes mobile navigation');
    await waitFor('document.activeElement?.getAttribute("aria-label") === "打开导航"', 'drawer restores trigger focus');
    await screenshot('dashboard-mobile');
    checks.push('shell: 390px reflow, mobile drawer and Escape keyboard dismissal');

    await send('Page.navigate', { url: `${appUrl}/missing-ui-page` });
    await waitFor('document.body.innerText.includes("页面不存在") && document.querySelector("nav[aria-label=主导航]")', '404 retains navigation');
    assert.equal(await evaluate('document.title'), '页面不存在 · AI Interview');
    await textClick('返回招聘概览', 'a');
    await waitFor('document.querySelector("h1")?.textContent === "招聘概览"', '404 recovery');
    checks.push('routes: localized 404 keeps navigation and offers a working return path');

    state.userRole = 'interviewer';
    await send('Page.navigate', { url: `${appUrl}/dashboard` });
    await waitFor('document.querySelector(".account-copy small")?.textContent === "面试官"', 'interviewer navigation');
    assert.equal(await evaluate('[...document.querySelectorAll(".app-sidebar a")].some(link => link.getAttribute("href") === "/positions")'), false);
    assert.equal(await evaluate('[...document.querySelectorAll(".quick-actions a")].some(link => link.getAttribute("href") === "/resumes/upload")'), false);
    assert.ok(await evaluate('[...document.querySelectorAll(".app-sidebar a")].some(link => link.getAttribute("href") === "/interviews")'));
    state.userRole = 'hr';
    checks.push('roles: interviewer navigation preserves role-specific destinations and actions');

    // Start without a session to exercise return-to-page and login recovery.
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: authScript.identifier });
    await evaluate('localStorage.removeItem("token")');
    await send('Page.navigate', { url: `${appUrl}/positions?title=独立表单岗位` });
    await waitFor('location.pathname === "/login" && document.querySelector("#login_email")', 'login redirect');
    assert.equal(await evaluate('document.querySelector("form").noValidate'), true);
    await fill('#login_email', 'ui@example.test');
    await fill('#login_password', 'isolated-test-password');
    await click('button[aria-label="显示密码"]');
    assert.equal(await evaluate('document.querySelector("#login_password").type'), 'text');
    await click('button[aria-label="隐藏密码"]');
    await textClick('登录工作台');
    await waitFor('document.body.innerText.includes("邮箱或密码不正确")', 'persistent login error');
    assert.equal(await evaluate('document.querySelector("#login_email").value'), 'ui@example.test');
    state.loginFailure = false;
    await textClick('登录工作台');
    await waitFor('location.pathname === "/positions" && new URLSearchParams(location.search).get("title") === "独立表单岗位"', 'return to protected destination');
    checks.push('login: labeled fields, password reveal, persistent error, retry and return-to-page');

    assert.deepEqual(failures, []);
    await writeFile(`${output}/results.json`, JSON.stringify({ passed: checks, browserExceptions: failures }, null, 2));
    console.log(JSON.stringify({ passed: checks, output }, null, 2));
  } catch (error) {
    await screenshot('failure').catch(() => undefined);
    console.error(await evaluate('document.body.innerText.slice(-5000)').catch(() => 'Browser unavailable'));
    throw error;
  } finally {
    await cdp.send('Target.disposeBrowserContext', { browserContextId });
    cdp.ws.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  browserProcess?.kill('SIGTERM');
  if (browserDataDir) await rm(browserDataDir, { recursive: true, force: true }).catch(() => undefined);
});
