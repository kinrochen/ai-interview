import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Segmented,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Timeline,
  Upload,
  message,
} from "antd";
import {
  AudioOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  ClockCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Link, useBeforeUnload, useBlocker, useParams } from "react-router-dom";
import dayjs from "dayjs";
import PageHeader from "../../components/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";
import {
  useResource,
  dimensions,
  recommendations,
  decisionOptions,
} from "./shared";
import { useRecording } from "./recording";
import {
  ResumePanel,
  QuestionPanel,
  type InterviewQuestion,
  type InterviewResume,
  type QuestionDraft,
} from "./InterviewMaterials";
import "./style.css";

interface Evidence {
  segment_id: string;
  quote: string;
  start?: number;
  end?: number;
}
interface Review {
  interviewer_id: string;
  name: string;
  note?: string;
  supplements?: { text: string; at: string }[];
  scores?: Record<string, number>;
  comments?: string;
  recommendation?: string;
  submitted_at?: string;
  question_scores?: Record<string, number>;
  question_comments?: Record<string, string>;
}
interface Workspace {
  id: string;
  candidate_name: string;
  position_title: string;
  round: number;
  scheduled_at: string;
  started_at: string | null;
  ended_at: string | null;
  state: string;
  status: string;
  legacy_completed: boolean;
  questions: (InterviewQuestion | string)[];
  questions_revision?: string;
  questions_pending?: boolean;
  resume?: InterviewResume | null;
  position?: { description?: string; requirements?: string } | null;
  is_member: boolean;
  can_start?: boolean;
  recording_owner_id: string | null;
  recording_active?: boolean;
  pending_recording_sessions?: {
    id: string;
    owner_id: string;
    owner_name: string;
  }[];
  chunk_count: number;
  audio_available: boolean;
  asr_configured?: boolean;
  transcript: {
    text: string;
    has_timestamps: boolean;
    segments: {
      id: string;
      start: number;
      end: number;
      text: string;
      speaker?: string;
    }[];
    warnings?: string[];
  } | null;
  analysis_status: string;
  analysis_error: string | null;
  analysis_revision: number;
  analysis: {
    dimensions: {
      key: string;
      label: string;
      score: number | null;
      assessment: string;
      evidence: Evidence[];
    }[];
    segments_analyzed: number;
    coverage_weight: number;
    method: string;
  } | null;
  reviews: Review[];
  final_decision_at: string | null;
  result: string;
  decision_history: {
    old: string;
    result: string;
    reason: string;
    actor: string;
    at: string;
  }[];
  tasks: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    revision: number;
    error: string | null;
  }[];
}
const analysisLabels: Record<string, string> = {
  pending: "等待录音或转写",
  no_audio: "待导入转写",
  queued: "等待分析",
  transcribing: "语音转写中",
  analyzing: "证据分析中",
  retry_wait: "等待自动重试",
  failed: "处理失败",
  completed: "分析完成",
  recording_incomplete: "需导入转写",
  superseded: "已归档",
};
const stateLabels: Record<string, string> = {
  scheduled: "尚未开始",
  in_progress: "面试进行中",
  ended: "面试已结束",
  cancelled: "已取消",
};
function NoteEditor({
  id,
  initial,
  ended,
  onSaved,
  onDraftChange,
}: {
  id: string;
  initial: string;
  ended: boolean;
  onSaved: () => void;
  onDraftChange: (text: string) => void;
}) {
  const [text, setText] = useState(ended ? "" : initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await request.put(`/interview-workflow/${id}/note`, {
        text,
        supplement: ended,
      });
      if (ended) setText("");
      message.success("笔记已保存");
      onSaved();
    } catch (reason) {
      setError(getErrorMessage(reason, "笔记保存失败"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="recruitment-stack">
      {error && <Alert type="error" title={error} />}
      <Input.TextArea
        aria-label={ended ? "补充面试笔记" : "我的面试笔记"}
        autoSize={{ minRows: 3, maxRows: 8 }}
        maxLength={20000}
        showCount
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onDraftChange(e.target.value);
        }}
        placeholder={
          ended
            ? "补充面试观察，保存后保留追加记录"
            : "记录候选人回答与现场观察，面试结束后成员可查看"
        }
      />
      <Button
        loading={busy}
        onClick={() => void save()}
        disabled={ended && !text.trim()}
      >
        {ended ? "追加笔记" : "保存我的笔记"}
      </Button>
    </div>
  );
}
function HumanReview({
  id,
  initial,
  onSaved,
  onDirty,
}: {
  id: string;
  initial?: Review;
  onSaved: () => void;
  onDirty: () => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    try {
      const body = await form.validateFields();
      setBusy(true);
      setError("");
      await request.put(`/interview-workflow/${id}/review`, body);
      message.success("人工评价已提交");
      onSaved();
    } catch (reason) {
      setError(getErrorMessage(reason, "请检查评价后重试"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Form
      noValidate
      form={form}
      onValuesChange={onDirty}
      onFinish={() => void submit()}
      layout="vertical"
      initialValues={{
        scores: initial?.scores,
        comments: initial?.comments,
        recommendation: initial?.recommendation,
      }}
    >
      {error && <Alert type="error" showIcon title={error} />}
      <div className="recruitment-score-grid">
        {dimensions.map((dimension) => (
          <Form.Item
            key={dimension.key}
            name={["scores", dimension.key]}
            label={`${dimension.label}（0–10）`}
            rules={[{ required: true, message: "请填写评分" }]}
          >
            <InputNumber
              min={0}
              max={10}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
        ))}
      </div>
      <Form.Item
        name="comments"
        label="评价依据"
        rules={[
          { required: true, whitespace: true, message: "请填写评价依据" },
        ]}
      >
        <Input.TextArea rows={5} maxLength={20000} />
      </Form.Item>
      <Form.Item
        name="recommendation"
        label="面试建议"
        rules={[{ required: true, message: "请选择面试建议" }]}
      >
        <Select options={recommendations} />
      </Form.Item>
      <Button type="primary" loading={busy} onClick={() => void submit()}>
        {initial?.submitted_at ? "更新人工评价" : "提交人工评价"}
      </Button>
    </Form>
  );
}
export default function InterviewWorkspace() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data, error, loading, refresh } = useResource<Workspace>(
    `/interview-workflow/${id}`,
  );
  const capture = useRecording(id, user?.id || "", refresh);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelForm] = Form.useForm();
  const [notesDirty, setNotesDirty] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [questionDrafts, setQuestionDrafts] = useState<
    Record<number, QuestionDraft>
  >({});
  const [questionEditorDirty, setQuestionEditorDirty] = useState(false);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [mobileMaterial, setMobileMaterial] = useState("guide");
  const [fullscreen, setFullscreen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const noteDraft = useRef("");
  const [evidenceTab, setEvidenceTab] = useState("analysis");
  const shouldWarn =
    capture.recording ||
    capture.busy ||
    capture.pending > 0 ||
    notesDirty ||
    reviewDirty ||
    questionEditorDirty ||
    Object.keys(questionDrafts).length > 0;
  useBeforeUnload((event) => {
    if (shouldWarn) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && shouldWarn,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const dialog = Modal.confirm({
      title: "离开面试工作区",
      content:
        "录音将停止，待上传分片保存在当前浏览器。未保存的逐题记录、笔记和评价需要保存后再离开。",
      okText: "离开页面",
      cancelText: "继续编辑",
      onCancel: () => blocker.reset(),
      onOk: () => blocker.proceed(),
    });
    return () => dialog.destroy();
  }, [blocker]);
  const [decisionForm] = Form.useForm();
  const [highlight, setHighlight] = useState<string>();
  const [audioUrl, setAudioUrl] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentsRef = useRef<HTMLDivElement>(null);
  const finalized = !!data?.final_decision_at || !!data?.legacy_completed;
  const editable = !finalized && data?.state !== "cancelled";
  const ended = data?.state === "ended";
  const ownReview = data?.reviews.find((r) => r.interviewer_id === user?.id);
  const manager = user?.role === "admin" || user?.role === "hr";
  const pendingReviews =
    data?.reviews.filter((r) => !r.submitted_at).length || 0;
  useEffect(() => {
    if (
      !data ||
      !["queued", "transcribing", "analyzing", "retry_wait"].includes(
        data.analysis_status,
      )
    )
      return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [data, refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!data?.audio_available) return;
    let cancelled = false;
    let url = "";
    request
      .get(`/interview-workflow/${id}/audio`, {
        responseType: "blob",
        timeout: 60000,
      })
      .then((blob: Blob) => {
        if (!cancelled) {
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) setOperationError("录音加载失败，可刷新页面重试");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, data?.audio_available]);
  useEffect(() => {
    const sync = () =>
      setFullscreen(document.fullscreenElement === document.documentElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!data?.started_at) return;
    const started = /(?:Z|[+-]\d{2}:\d{2})$/.test(data.started_at)
      ? data.started_at
      : `${data.started_at}Z`;
    const update = () =>
      setElapsed(
        Math.max(0, Math.floor((Date.now() - Date.parse(started)) / 1000)),
      );
    update();
    if (data.state !== "in_progress") return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [data?.started_at, data?.state]);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setOperationError("浏览器未能进入全屏，可继续在当前页面面试");
    }
  }
  async function saveQuestionRecords(index?: number) {
    const pending = Object.values(questionDrafts).filter(
      (draft) => index === undefined || draft.index === index,
    );
    if (!pending.length) return true;
    setRecordSaving(true);
    setRecordError("");
    try {
      for (const draft of pending) {
        await request.put(`/interview-workflow/${id}/question-review`, draft);
        setQuestionDrafts((current) => {
          if (current[draft.index] !== draft) return current;
          const next = { ...current };
          delete next[draft.index];
          return next;
        });
      }
      refresh();
      return true;
    } catch (reason) {
      setRecordError(getErrorMessage(reason, "逐题记录保存失败，内容已保留"));
      return false;
    } finally {
      setRecordSaving(false);
    }
  }
  async function saveInterviewDrafts() {
    if (!(await saveQuestionRecords())) throw new Error("逐题记录保存失败");
    if (notesDirty) {
      await request.put(`/interview-workflow/${id}/note`, {
        text: noteDraft.current,
        supplement: false,
      });
      setNotesDirty(false);
    }
  }
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setOperationError("");
    try {
      await request.post(`/interview-workflow/${id}/${path}`, body);
      refresh();
      return true;
    } catch (reason) {
      setOperationError(getErrorMessage(reason, "操作未完成，请重试"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function endInterview() {
    Modal.confirm({
      title: "结束本场面试",
      content: data?.chunk_count
        ? "已上传录音将进入转写与证据分析，随后可提交人工评价。"
        : "当前没有录音，结束后可导入转写并提交人工评价。",
      okText: "结束面试",
      cancelText: "继续面试",
      onOk: async () => {
        await saveInterviewDrafts();
        const latest: Workspace = await request.get(
          `/interview-workflow/${id}`,
        );
        if (!(await action("end", { expected_chunks: latest.chunk_count })))
          throw new Error("结束失败");
      },
    });
  }
  function confirmRecoveredSession(sessionId: string) {
    Modal.confirm({
      title: "确认上次录音已保存",
      content:
        "请确认此浏览器及原录音窗口的分片已经恢复上传，确认后将关闭该录音会话。",
      okText: "确认保存",
      cancelText: "继续检查",
      onOk: async () => {
        if (
          !(await action("recording/claim", { session_id: sessionId })) ||
          !(await action("recording/release", { session_id: sessionId }))
        )
          throw new Error("录音会话确认失败");
      },
    });
  }
  function forceEnd() {
    Modal.confirm({
      title: "结束异常面试",
      content:
        "将以服务器已保存的分片作为最终录音。请确认现场面试已结束，并由录音成员完成恢复上传。",
      okText: "确认结束",
      cancelText: "继续检查",
      onOk: async () => {
        await saveInterviewDrafts();
        const latest: Workspace = await request.get(
          `/interview-workflow/${id}`,
        );
        if (
          !(await action("end", {
            expected_chunks: latest.chunk_count,
            force: true,
          }))
        )
          throw new Error("结束失败");
      },
    });
  }
  async function importTranscript(file: File) {
    setBusy(true);
    setOperationError("");
    const form = new FormData();
    form.append("file", file);
    try {
      await request.post(`/interview-workflow/${id}/transcript`, form, {
        timeout: 60000,
      });
      message.success("转写已导入，等待证据分析");
      refresh();
    } catch (reason) {
      setOperationError(getErrorMessage(reason, "转写导入失败"));
    } finally {
      setBusy(false);
    }
    return false;
  }
  function seek(evidence: Evidence) {
    setHighlight(evidence.segment_id);
    setEvidenceTab("transcript");
    requestAnimationFrame(() => {
      const target = segmentsRef.current?.querySelector<HTMLElement>(
        `[data-segment="${CSS.escape(evidence.segment_id)}"]`,
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
    });
    if (
      audioRef.current &&
      data?.transcript?.has_timestamps &&
      evidence.start !== undefined
    )
      audioRef.current.currentTime = evidence.start;
  }
  async function decide() {
    try {
      const values = await decisionForm.validateFields();
      if (await action("decision", values)) {
        setDecisionOpen(false);
        message.success("最终决策已记录");
      }
    } catch {
      /* Ant Form shows field errors. */
    }
  }
  async function cancelInterview() {
    try {
      const values = await cancelForm.validateFields();
      setBusy(true);
      setOperationError("");
      await saveInterviewDrafts();
      await request.post(`/interviews/${id}/cancel`, null, {
        params: { reason: values.reason },
      });
      setCancelOpen(false);
      refresh();
      message.success("面试已取消");
    } catch (reason) {
      setOperationError(getErrorMessage(reason, "取消面试失败，请检查后重试"));
    } finally {
      setBusy(false);
    }
  }
  if (loading && !data) return <Spin aria-label="加载面试工作区" />;
  if (!data)
    return (
      <Alert
        type="error"
        title={error || "面试加载失败"}
        action={<Button onClick={refresh}>重试</Button>}
      />
    );
  const materials = (
    <div className="interview-materials-area" data-mobile-view={mobileMaterial}>
      <div className="interview-mobile-material-switch">
        <Segmented
          block
          aria-label="面试资料切换"
          value={mobileMaterial}
          onChange={(value) => setMobileMaterial(String(value))}
          options={[
            { value: "guide", label: "面试题与记录" },
            { value: "resume", label: "候选人简历" },
          ]}
        />
      </div>
      <div className="interview-resume-column">
        <ResumePanel
          name={data.candidate_name}
          resume={data.resume}
          position={data.position}
        />
      </div>
      <div className="interview-guide-column">
        <QuestionPanel
          id={id}
          questions={data.questions}
          revision={data.questions_revision || ""}
          pending={!!data.questions_pending}
          canEdit={editable && !ended && (data.is_member || manager)}
          canRecord={editable && data.is_member && data.state === "in_progress"}
          scores={ownReview?.question_scores || {}}
          comments={ownReview?.question_comments || {}}
          drafts={questionDrafts}
          saving={recordSaving}
          recordError={recordError}
          onDraftChange={(draft) =>
            setQuestionDrafts((current) => ({
              ...current,
              [draft.index]: draft,
            }))
          }
          onSaveRecords={saveQuestionRecords}
          onEditorDirty={setQuestionEditorDirty}
          onSaved={refresh}
        />
        {!ended && (
          <Card title="现场笔记" size="small" className="interview-live-notes">
            {data.is_member && editable && data.state === "in_progress" ? (
              <NoteEditor
                key={id}
                id={id}
                initial={ownReview?.note || ""}
                onDraftChange={(text) => {
                  noteDraft.current = text;
                  setNotesDirty(true);
                }}
                ended={false}
                onSaved={() => {
                  setNotesDirty(false);
                  refresh();
                }}
              />
            ) : ownReview?.note ? (
              <p className="recruitment-pre">{ownReview.note}</p>
            ) : (
              <p className="recruitment-muted">
                {data.state === "scheduled"
                  ? "开始面试后可记录现场笔记"
                  : data.state === "cancelled"
                    ? "面试已取消"
                    : "本场成员可记录面试笔记"}
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
  const elapsedTime = [
    Math.floor(elapsed / 3600),
    Math.floor((elapsed % 3600) / 60),
    elapsed % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return (
    <div className="interview-room">
      <PageHeader
        title={`${data.candidate_name} · 面试工作区`}
        description={`${data.position_title} · 第 ${data.round} 轮 · ${stateLabels[data.state] || data.state}`}
        actions={
          <Space wrap>
            <Link to="/interviews">
              <Button>返回面试列表</Button>
            </Link>
            <Button
              onClick={() => void toggleFullscreen()}
              icon={
                fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
              }
            >
              {fullscreen ? "退出全屏" : "全屏面试"}
            </Button>
            <Button onClick={refresh} icon={<ReloadOutlined />}>
              刷新
            </Button>
            <Link to="/interviews/calendar">
              <Button>面试日历</Button>
            </Link>
          </Space>
        }
      />
      <div className="recruitment-stack">
        {error && <Alert type="error" title={error} />}
        {operationError && (
          <Alert type="error" showIcon title={operationError} />
        )}
        {data.legacy_completed && (
          <Alert
            type="info"
            title="历史面试记录已归档"
            description={
              <Link to={`/interviews/${id}/result`}>查看原评分与分析报告</Link>
            }
          />
        )}
        {data.final_decision_at && (
          <Alert
            type="success"
            showIcon
            title={`最终决策 · ${decisionOptions.find((r) => r.value === data.result)?.label || data.result}`}
            description={dayjs(data.final_decision_at).format(
              "YYYY-MM-DD HH:mm",
            )}
          />
        )}
        <Card size="small" className="interview-session-toolbar">
          <div className="recruitment-toolbar">
            <Tag
              color={data.state === "in_progress" ? "processing" : "default"}
            >
              {stateLabels[data.state]}
            </Tag>
            {data.state === "in_progress" && (
              <span className="interview-elapsed" aria-label="面试用时">
                <ClockCircleOutlined /> {elapsedTime}
              </span>
            )}
            {data.started_at && (
              <span>开始于 {dayjs(data.started_at).format("MM-DD HH:mm")}</span>
            )}
            {data.ended_at && (
              <span>结束于 {dayjs(data.ended_at).format("MM-DD HH:mm")}</span>
            )}
            {(data.can_start ?? data.is_member) &&
              editable &&
              data.state === "scheduled" && (
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() => void action("start")}
                >
                  {data.reviews.length ? "开始面试" : "接手并开始面试"}
                </Button>
              )}
            {data.is_member && editable && data.state === "in_progress" && (
              <>
                <Button
                  type={capture.recording ? "default" : "primary"}
                  danger={capture.recording}
                  icon={
                    capture.recording ? (
                      <PauseCircleOutlined />
                    ) : (
                      <AudioOutlined />
                    )
                  }
                  loading={capture.busy}
                  onClick={() =>
                    void (capture.recording ? capture.stop() : capture.start())
                  }
                >
                  {capture.recording ? "停止并保存录音" : "开始录音"}
                </Button>
                <Button
                  loading={busy}
                  disabled={
                    capture.recording ||
                    capture.busy ||
                    capture.pending > 0 ||
                    recordSaving
                  }
                  onClick={endInterview}
                >
                  结束面试
                </Button>
              </>
            )}
            {user?.role === "admin" &&
              editable &&
              data.state === "in_progress" && (
                <Button
                  disabled={
                    capture.recording ||
                    capture.busy ||
                    capture.pending > 0 ||
                    recordSaving
                  }
                  onClick={forceEnd}
                >
                  异常结束
                </Button>
              )}
            {manager &&
              editable &&
              data.reviews.length === 0 &&
              data.state !== "scheduled" && (
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() => void action("take-over")}
                >
                  接手并评审
                </Button>
              )}
            {capture.pending > 0 && (
              <Button
                loading={capture.busy}
                disabled={capture.recording || !editable}
                onClick={() => void capture.recover()}
              >
                恢复上传 {capture.pending} 个分片
              </Button>
            )}
            <span className="recruitment-muted">
              已保存 {data.chunk_count} 个录音分片
            </span>
            {manager &&
              editable &&
              ["scheduled", "in_progress"].includes(data.state) && (
                <Button
                  danger
                  type="text"
                  disabled={
                    capture.recording ||
                    capture.busy ||
                    capture.pending > 0 ||
                    recordSaving
                  }
                  onClick={() => {
                    cancelForm.resetFields();
                    setOperationError("");
                    setCancelOpen(true);
                  }}
                >
                  取消面试
                </Button>
              )}
          </div>
          {data.asr_configured === false && editable && (
            <p className="interview-recording-hint">
              录音可保存并回放。自动转写需要配置语音服务，结束后也可导入转写。
              {user?.role === "admin" && (
                <Link to="/settings/system#asr">配置语音服务</Link>
              )}
            </p>
          )}
          {capture.error && (
            <Alert type="error" showIcon title={capture.error} />
          )}
          {data.recording_owner_id && data.recording_owner_id !== user?.id && (
            <Alert
              type="info"
              title={
                data.recording_active
                  ? "另一位面试官正在录音"
                  : "上次录音连接已过期，可接手录音"
              }
            />
          )}
          {data.state === "in_progress" &&
            data.recording_active === false &&
            (data.pending_recording_sessions?.length || 0) > 0 && (
              <Alert
                type="warning"
                showIcon
                title="录音会话待确认保存"
                description={
                  <Space direction="vertical">
                    {data.pending_recording_sessions?.map((session) => (
                      <span key={session.id}>
                        {session.owner_name}
                        {session.owner_id === user?.id && (
                          <Button
                            type="link"
                            disabled={capture.pending > 0 || capture.busy}
                            onClick={() => confirmRecoveredSession(session.id)}
                          >
                            确认上次录音已保存
                          </Button>
                        )}
                      </span>
                    ))}
                  </Space>
                }
              />
            )}
        </Card>
        {ended ? (
          <Collapse
            className="interview-archived-materials"
            items={[
              {
                key: "materials",
                label: "简历与逐题记录",
                children: materials,
              },
            ]}
          />
        ) : (
          materials
        )}
        {ended && (
          <div className="recruitment-workspace">
            <div className="recruitment-stack">
              <Card
                title="面试证据"
                extra={
                  <Tag
                    color={
                      data.analysis_status === "failed" ? "error" : "processing"
                    }
                  >
                    {analysisLabels[data.analysis_status] ||
                      data.analysis_status}
                  </Tag>
                }
              >
                <Space wrap style={{ marginBottom: 16 }}>
                  {ended && editable && (
                    <>
                      <Upload
                        openFileDialogOnClick
                        accept=".txt,.vtt"
                        beforeUpload={(file) => importTranscript(file)}
                        showUploadList={false}
                        disabled={busy}
                      >
                        <Button icon={<UploadOutlined />} loading={busy}>
                          导入 / 更新转写
                        </Button>
                      </Upload>
                      <Button
                        loading={busy}
                        disabled={
                          [
                            "queued",
                            "transcribing",
                            "analyzing",
                            "retry_wait",
                          ].includes(data.analysis_status) ||
                          (!data.transcript && !data.chunk_count)
                        }
                        onClick={() => void action("analysis/retry")}
                      >
                        重新分析
                      </Button>
                    </>
                  )}
                </Space>
                {data.analysis_error && (
                  <Alert type="error" title={data.analysis_error} />
                )}
                {data.transcript?.warnings?.map((warning) => (
                  <Alert
                    key={warning}
                    type="info"
                    title={warning}
                    style={{ marginBottom: 12 }}
                  />
                ))}
                {audioUrl && (
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    style={{ width: "100%", marginBottom: 16 }}
                  />
                )}
                <Tabs
                  activeKey={evidenceTab}
                  onChange={setEvidenceTab}
                  items={[
                    {
                      key: "analysis",
                      label: "AI 证据分析",
                      children: data.analysis ? (
                        <div className="recruitment-stack">
                          <p className="recruitment-muted">
                            已分析 {data.analysis.segments_analyzed}{" "}
                            段，具有证据的维度权重{" "}
                            {data.analysis.coverage_weight}% ·{" "}
                            {data.analysis.method}
                          </p>
                          {data.analysis.dimensions.map((dimension) => (
                            <section key={dimension.key}>
                              <h3>
                                {dimension.label}{" "}
                                <Tag>
                                  {dimension.score === null
                                    ? "证据不足"
                                    : `${dimension.score} / 10`}
                                </Tag>
                              </h3>
                              <p className="recruitment-pre">
                                {dimension.assessment}
                              </p>
                              {dimension.evidence.map((evidence, index) => (
                                <blockquote
                                  className="recruitment-evidence"
                                  key={index}
                                >
                                  {evidence.quote}
                                  <br />
                                  <Button
                                    type="link"
                                    onClick={() => seek(evidence)}
                                  >
                                    {data.transcript?.has_timestamps
                                      ? `定位原文 ${Math.floor(evidence.start || 0)} 秒`
                                      : "定位原文"}
                                  </Button>
                                </blockquote>
                              ))}
                            </section>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          description={
                            data.state === "scheduled"
                              ? "开始面试后可录音，结束后生成证据分析"
                              : data.analysis_status === "no_audio"
                                ? "导入 TXT / VTT 转写即可生成分析"
                                : "转写与分析结果将在这里展示"
                          }
                        />
                      ),
                    },
                    {
                      key: "transcript",
                      label: "完整转写",
                      forceRender: true,
                      children: (
                        <div
                          className="recruitment-transcript"
                          ref={segmentsRef}
                        >
                          {data.transcript?.segments.map((segment) => (
                            <article
                              key={segment.id}
                              tabIndex={-1}
                              data-segment={segment.id}
                              data-highlight={highlight === segment.id}
                            >
                              <span className="recruitment-muted">
                                {segment.speaker || "发言"}{" "}
                                {data.transcript?.has_timestamps
                                  ? `${Math.floor(segment.start)} 秒`
                                  : ""}
                              </span>
                              <p className="recruitment-pre">{segment.text}</p>
                            </article>
                          ))}
                          {!data.transcript && <Empty description="暂无转写" />}
                        </div>
                      ),
                    },
                    {
                      key: "jobs",
                      label: "处理记录",
                      children: (
                        <Table
                          rowKey="id"
                          size="small"
                          pagination={false}
                          dataSource={data.tasks}
                          columns={[
                            { title: "版本", dataIndex: "revision" },
                            {
                              title: "任务",
                              render: (_, t) =>
                                t.kind === "asr" ? "语音转写" : "证据分析",
                            },
                            {
                              title: "状态",
                              render: (_, task) =>
                                ({
                                  queued: "等待执行",
                                  running: "处理中",
                                  retry_wait: "等待重试",
                                  completed: "已完成",
                                  failed: "失败",
                                  superseded: "旧版本",
                                })[task.status] || task.status,
                            },
                            { title: "执行次数", dataIndex: "attempts" },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </Card>
            </div>
            <div className="recruitment-stack">
              <Card title={ended ? "面试笔记与补充" : "我的面试笔记"}>
                {data.is_member &&
                  editable &&
                  ["in_progress", "ended"].includes(data.state) && (
                    <NoteEditor
                      key={`${id}-${ended}`}
                      id={id}
                      initial={ownReview?.note || ""}
                      onDraftChange={(text) => {
                        noteDraft.current = text;
                        setNotesDirty(true);
                      }}
                      ended={ended}
                      onSaved={() => {
                        setNotesDirty(false);
                        refresh();
                      }}
                    />
                  )}
                {ended &&
                  data.reviews.map((review) => (
                    <section key={review.interviewer_id}>
                      <h4>{review.name}</h4>
                      <p className="recruitment-pre">
                        {review.note || "暂无笔记"}
                      </p>
                      {review.supplements?.map((note, index) => (
                        <blockquote
                          className="recruitment-evidence"
                          key={index}
                        >
                          <small>
                            {dayjs(note.at).format("MM-DD HH:mm")} 补充
                          </small>
                          <p>{note.text}</p>
                        </blockquote>
                      ))}
                    </section>
                  ))}
                {!ended && !data.is_member && (
                  <p className="recruitment-muted">面试结束后可查看成员笔记</p>
                )}
              </Card>
              <Card title="人工评价">
                {ended && data.is_member && editable && (
                  <HumanReview
                    id={id}
                    initial={ownReview}
                    onDirty={() => setReviewDirty(true)}
                    onSaved={() => {
                      setReviewDirty(false);
                      refresh();
                    }}
                  />
                )}
                <div style={{ marginTop: 20 }}>
                  {data.reviews.map((review) => (
                    <div
                      className="recruitment-task"
                      key={review.interviewer_id}
                    >
                      <div>
                        <strong>{review.name}</strong>
                        <Tag
                          color={review.submitted_at ? "success" : "default"}
                        >
                          {review.submitted_at ? "已提交" : "待提交"}
                        </Tag>
                        {ended && review.comments && (
                          <>
                            <p className="recruitment-pre">{review.comments}</p>
                            <p>
                              {
                                recommendations.find(
                                  (r) => r.value === review.recommendation,
                                )?.label
                              }
                            </p>
                            {review.scores && (
                              <p>
                                {dimensions
                                  .map(
                                    (d) =>
                                      `${d.label} ${review.scores![d.key]}`,
                                  )
                                  .join(" · ")}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!ended && <p>结束面试后提交人工评价</p>}
              </Card>
              {manager && ended && !data.legacy_completed && (
                <Card title="最终决策">
                  <p>
                    {pendingReviews
                      ? `还有 ${pendingReviews} 位面试官待提交评价`
                      : data.final_decision_at
                        ? "已记录最终决策，修正时需填写依据"
                        : "面试官评价已齐备，可记录最终决策"}
                  </p>
                  <Button
                    type="primary"
                    disabled={
                      pendingReviews > 0 ||
                      !data.reviews.length ||
                      reviewDirty ||
                      notesDirty
                    }
                    onClick={() => {
                      setOperationError("");
                      decisionForm.resetFields();
                      setDecisionOpen(true);
                    }}
                  >
                    {data.final_decision_at ? "修正最终决策" : "记录最终决策"}
                  </Button>
                </Card>
              )}
              {data.decision_history.length > 0 && (
                <Card title="决策历史">
                  <Timeline
                    items={data.decision_history.map((decision, index) => ({
                      key: index,
                      content: (
                        <>
                          <Tag>
                            {
                              recommendations.find(
                                (r) => r.value === decision.result,
                              )?.label
                            }
                          </Tag>
                          <p>{decision.reason}</p>
                          <small>
                            {dayjs(decision.at).format("YYYY-MM-DD HH:mm")}
                          </small>
                        </>
                      ),
                    }))}
                  />
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
      <Modal
        title="取消本场面试"
        open={cancelOpen}
        onCancel={() => {
          if (!busy) setCancelOpen(false);
        }}
        onOk={() => void cancelInterview()}
        confirmLoading={busy}
        okText="取消面试"
        okButtonProps={{ danger: true }}
        cancelText="继续面试"
      >
        <p>已保存的简历、题目、逐题记录和笔记将保留。</p>
        {operationError && <Alert type="error" title={operationError} />}
        <Form
          noValidate
          form={cancelForm}
          layout="vertical"
          name="cancel-interview"
        >
          <Form.Item
            name="reason"
            label="取消原因"
            rules={[
              { required: true, whitespace: true, message: "请填写取消原因" },
            ]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={2000}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="记录最终决策"
        open={decisionOpen}
        onCancel={() => {
          if (!busy) setDecisionOpen(false);
        }}
        onOk={() => void decide()}
        confirmLoading={busy}
        okText="确认决策"
        cancelText="取消"
      >
        {operationError && <Alert type="error" title={operationError} />}
        {!data.final_decision_at && (
          <p className="recruitment-muted">
            首次录用、淘汰或下一轮决策将按系统邮件设置发送结果通知。
          </p>
        )}
        <Form
          noValidate
          form={decisionForm}
          layout="vertical"
          style={{ marginTop: 20 }}
        >
          <Form.Item
            name="result"
            label="最终结论"
            rules={[{ required: true, message: "请选择结论" }]}
          >
            <Select options={decisionOptions} />
          </Form.Item>
          <Form.Item
            name="reason"
            label="决策依据 / 修正原因"
            rules={[
              { required: true, whitespace: true, message: "请填写依据" },
            ]}
          >
            <Input.TextArea rows={4} maxLength={5000} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
