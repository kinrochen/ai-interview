import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  message,
} from "antd";
import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";
import { getMaximizedPdfPreviewUrl } from "../../utils/pdfPreview";

export interface InterviewQuestion {
  title?: string;
  content?: string;
  question?: string;
  resume_association?: string;
  reference_answer?: unknown;
  grading_criteria?: unknown;
  follow_up?: string | string[];
  difficulty?: string;
  type?: string;
  [key: string]: unknown;
}
export interface InterviewResume {
  id: string;
  file_path?: string | null;
  raw_text?: string | null;
  parsed_data?: Record<string, unknown> | null;
}
export interface QuestionDraft {
  index: number;
  score: number | null;
  comments: string;
  expected_revision: string;
}

function detailText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(detailText).join("\n");
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${key} ${detailText(item)}`)
      .join("\n");
  return value == null ? "" : String(value);
}

export function ResumePanel({
  name,
  resume,
  position,
}: {
  name: string;
  resume?: InterviewResume | null;
  position?: { description?: string; requirements?: string } | null;
}) {
  const source = resume?.file_path || "";
  const fileUrl = source.startsWith("/") ? source : source ? `/${source}` : "";
  const isPdf = fileUrl.split(/[?#]/)[0].toLowerCase().endsWith(".pdf");
  const parsed = resume?.parsed_data || {};
  const facts = [
    parsed.highest_degree,
    parsed.school,
    parsed.major,
    parsed.years_of_experience == null
      ? null
      : `${parsed.years_of_experience} 年经验`,
  ].filter((value) => typeof value === "string" && value.trim());
  return (
    <Card
      title="候选人简历"
      className="interview-resume-panel"
      extra={
        fileUrl && (
          <Button href={fileUrl} download icon={<DownloadOutlined />}>
            下载简历
          </Button>
        )
      }
    >
      <div className="interview-candidate-summary">
        <strong>{name}</strong>
        {facts.length > 0 && <span>{facts.join(" · ")}</span>}
      </div>
      <Tabs
        defaultActiveKey={isPdf ? "original" : "text"}
        className="interview-resume-tabs"
        items={[
          {
            key: "original",
            label: "简历原件",
            children: isPdf ? (
              <iframe
                src={getMaximizedPdfPreviewUrl(fileUrl)}
                title={`${name}的简历原件`}
                className="interview-resume-frame"
              />
            ) : (
              <div className="interview-material-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    fileUrl
                      ? "此格式可下载查看，解析文本见相邻页签"
                      : "尚未上传简历原件，可查看解析文本"
                  }
                />
              </div>
            ),
          },
          {
            key: "text",
            label: "解析文本",
            children: resume?.raw_text ? (
              <div
                className="interview-resume-text"
                tabIndex={0}
                aria-label="简历解析文本"
              >
                {resume.raw_text}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无简历解析文本"
              />
            ),
          },
          {
            key: "position",
            label: "岗位要求",
            children: (
              <div className="interview-position-context">
                {position?.description && (
                  <section>
                    <h3>岗位职责</h3>
                    <ReactMarkdown>{position.description}</ReactMarkdown>
                  </section>
                )}
                {position?.requirements && (
                  <section>
                    <h3>任职要求</h3>
                    <ReactMarkdown>{position.requirements}</ReactMarkdown>
                  </section>
                )}
                {!position?.description && !position?.requirements && (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无岗位要求"
                  />
                )}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

export function QuestionPanel({
  id,
  questions,
  revision,
  pending,
  canEdit,
  canRecord,
  scores,
  comments,
  drafts,
  saving,
  recordError,
  onDraftChange,
  onSaveRecords,
  onEditorDirty,
  onSaved,
}: {
  id: string;
  questions: (InterviewQuestion | string)[];
  revision: string;
  pending: boolean;
  canEdit: boolean;
  canRecord: boolean;
  scores: Record<string, number>;
  comments: Record<string, string>;
  drafts: Record<number, QuestionDraft>;
  saving: boolean;
  recordError: string;
  onDraftChange: (draft: QuestionDraft) => void;
  onSaveRecords: (index?: number) => Promise<boolean>;
  onEditorDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [editor, setEditor] = useState<{ index: number | null } | null>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editorDirty = useRef(false);
  const editorRevision = useRef(revision);
  const heading = useRef<HTMLHeadingElement>(null);
  const questionScroll = useRef<HTMLDivElement>(null);
  const index = Math.min(selected, Math.max(questions.length - 1, 0));
  const rawQuestion = questions[index];
  const question =
    typeof rawQuestion === "string" ? { content: rawQuestion } : rawQuestion;
  const draft = drafts[index];
  const score = draft ? draft.score : (scores[String(index)] ?? null);
  const comment = draft ? draft.comments : comments[String(index)] || "";
  const recorded = Object.keys(scores).filter(
    (key) => Number(key) < questions.length,
  ).length;

  function selectQuestion(next: number) {
    setSelected(next);
    requestAnimationFrame(() => {
      questionScroll.current?.scrollTo({ top: 0, behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    });
  }
  function closeEditor() {
    setEditor(null);
    editorDirty.current = false;
    onEditorDirty(false);
    setError("");
  }
  function cancelEditor() {
    if (!editorDirty.current) return closeEditor();
    Modal.confirm({
      title: "放弃题目修改",
      content: "关闭后将放弃当前未保存的题目内容。",
      okText: "放弃修改",
      cancelText: "继续编辑",
      onOk: closeEditor,
    });
  }
  async function openEditor(editIndex: number | null) {
    if (!(await onSaveRecords())) return;
    const original = editIndex === null ? {} : questions[editIndex];
    const values =
      typeof original === "string" ? { content: original } : original;
    form.resetFields();
    form.setFieldsValue({
      ...values,
      content: values.content || values.question || "",
      reference_answer: detailText(values.reference_answer),
      grading_criteria: detailText(values.grading_criteria),
      follow_up: detailText(values.follow_up),
      difficulty: values.difficulty || "intermediate",
      type: values.type || "technical",
    });
    editorRevision.current = revision;
    editorDirty.current = false;
    onEditorDirty(false);
    setError("");
    setEditor({ index: editIndex });
  }
  async function saveQuestion() {
    if (!editor) return;
    try {
      const values = await form.validateFields();
      setBusy(true);
      setError("");
      const previous = editor.index === null ? {} : questions[editor.index];
      const original = typeof previous === "string" ? {} : previous;
      await request.patch(`/interview-workflow/${id}/questions`, {
        action: editor.index === null ? "add" : "update",
        index: editor.index,
        question: {
          ...original,
          ...values,
          reference_answer:
            values.reference_answer === detailText(original.reference_answer)
              ? original.reference_answer
              : values.reference_answer,
          grading_criteria:
            values.grading_criteria === detailText(original.grading_criteria)
              ? original.grading_criteria
              : values.grading_criteria,
          follow_up:
            values.follow_up
              ?.split("\n")
              .filter((line: string) => line.trim()) || [],
        },
        expected_revision: editorRevision.current,
      });
      if (editor.index === null) setSelected(questions.length);
      closeEditor();
      message.success("面试题已保存");
      onSaved();
    } catch (reason) {
      setError(getErrorMessage(reason, "面试题保存失败，请检查后重试"));
    } finally {
      setBusy(false);
    }
  }
  function deleteQuestion() {
    Modal.confirm({
      title: `删除第 ${index + 1} 题`,
      content: "该题及对应的逐题记录将一起移除。其余题目与记录按顺序保留。",
      okText: "删除题目",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        if (!(await onSaveRecords())) throw new Error("请先保存逐题记录");
        try {
          setBusy(true);
          await request.patch(`/interview-workflow/${id}/questions`, {
            action: "delete",
            index,
            expected_revision: revision,
          });
          setSelected(Math.max(0, index - 1));
          setError("");
          onSaved();
          message.success("面试题已删除");
        } catch (reason) {
          setError(getErrorMessage(reason, "删除题目失败，请重试"));
          throw reason;
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <>
      <Card
        title="面试题目"
        className="interview-question-panel"
        extra={
          canEdit &&
          !pending && (
            <Button
              icon={<PlusOutlined />}
              disabled={busy || saving}
              onClick={() => void openEditor(null)}
            >
              添加题目
            </Button>
          )
        }
      >
        {error && !editor && <Alert type="error" title={error} />}
        {pending ? (
          <div className="interview-material-empty" role="status">
            <Spin />
            <p>面试题正在生成，可先查看简历</p>
            <Button onClick={onSaved}>刷新题目</Button>
          </div>
        ) : question ? (
          <>
            <nav className="interview-question-nav" aria-label="面试题导航">
              <div className="interview-question-numbers">
                {questions.map((_, questionIndex) => (
                  <Button
                    key={questionIndex}
                    type={index === questionIndex ? "primary" : "default"}
                    aria-current={index === questionIndex ? "step" : undefined}
                    aria-label={`第 ${questionIndex + 1} 题${scores[String(questionIndex)] != null ? "，已记录评分" : ""}`}
                    onClick={() => selectQuestion(questionIndex)}
                    icon={
                      scores[String(questionIndex)] != null ? (
                        <CheckOutlined />
                      ) : undefined
                    }
                  >
                    {questionIndex + 1}
                    {drafts[questionIndex] && (
                      <span
                        className="interview-draft-dot"
                        aria-label="有未保存记录"
                      />
                    )}
                  </Button>
                ))}
              </div>
              <span className="recruitment-muted">
                已评分 {recorded} / {questions.length}
              </span>
            </nav>
            <div className="interview-question-scroll" ref={questionScroll}>
              <div className="interview-question-heading">
                <div>
                  <Tag>
                    第 {index + 1} / {questions.length} 题
                  </Tag>
                  {question.difficulty && (
                    <Tag>
                      {{ junior: "初级", intermediate: "中级", senior: "高级" }[
                        question.difficulty
                      ] || question.difficulty}
                    </Tag>
                  )}
                  <h2 ref={heading} tabIndex={-1}>
                    {question.title || `面试题 ${index + 1}`}
                  </h2>
                </div>
                {canEdit && (
                  <Space size={0}>
                    <Button
                      aria-label="编辑当前题目"
                      title="编辑题目"
                      icon={<EditOutlined />}
                      type="text"
                      disabled={busy || saving}
                      onClick={() => void openEditor(index)}
                    />
                    <Button
                      aria-label="删除当前题目"
                      title="删除题目"
                      icon={<DeleteOutlined />}
                      type="text"
                      danger
                      disabled={busy || saving}
                      onClick={deleteQuestion}
                    />
                  </Space>
                )}
              </div>
              <div className="interview-question-content">
                <ReactMarkdown>
                  {question.content || question.question || ""}
                </ReactMarkdown>
              </div>
              {question.resume_association && (
                <section className="interview-resume-association">
                  <h3>简历关联</h3>
                  <p>{question.resume_association}</p>
                </section>
              )}
              {question.follow_up && detailText(question.follow_up) && (
                <section className="interview-follow-up">
                  <h3>追问方向</h3>
                  <ul>
                    {(Array.isArray(question.follow_up)
                      ? question.follow_up
                      : [question.follow_up]
                    ).map((item, followIndex) => (
                      <li key={followIndex}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}
              <Collapse
                size="small"
                className="interview-question-reference"
                items={[
                  {
                    key: "answer",
                    label: "参考答案",
                    children: (
                      <ReactMarkdown>
                        {detailText(question.reference_answer) ||
                          "暂无参考答案"}
                      </ReactMarkdown>
                    ),
                  },
                  {
                    key: "criteria",
                    label: "评分标准",
                    children: (
                      <ReactMarkdown>
                        {detailText(question.grading_criteria) ||
                          "暂无评分标准"}
                      </ReactMarkdown>
                    ),
                  },
                ]}
              />
              {(canRecord || score !== null || comment) && (
                <section
                  className="interview-question-record"
                  aria-label="当前题目记录"
                >
                  <h3>本题记录</h3>
                  {recordError && <Alert type="error" title={recordError} />}
                  {draft && draft.expected_revision !== revision && (
                    <Alert
                      type="warning"
                      title="面试题已更新，请核对本题与待保存记录"
                      action={
                        <Button
                          onClick={() =>
                            onDraftChange({
                              ...draft,
                              expected_revision: revision,
                            })
                          }
                        >
                          已核对，保留记录
                        </Button>
                      }
                    />
                  )}
                  <div className="interview-question-record-fields">
                    <div>
                      <label htmlFor="question-score">评分（0–10）</label>
                      <InputNumber
                        id="question-score"
                        min={0}
                        max={10}
                        precision={0}
                        value={score}
                        disabled={!canRecord || saving}
                        onChange={(value) =>
                          onDraftChange({
                            index,
                            score: value,
                            comments: comment,
                            expected_revision:
                              draft?.expected_revision || revision,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="question-comment">回答要点与评语</label>
                      <Input.TextArea
                        id="question-comment"
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        maxLength={5000}
                        value={comment}
                        disabled={!canRecord || saving}
                        onChange={(event) =>
                          onDraftChange({
                            index,
                            score,
                            comments: event.target.value,
                            expected_revision:
                              draft?.expected_revision || revision,
                          })
                        }
                        placeholder="记录本题回答、评分依据和待核实内容"
                      />
                    </div>
                  </div>
                  {canRecord && (
                    <div className="interview-question-record-actions">
                      <span role="status" className="recruitment-muted">
                        {draft
                          ? "本题记录待保存"
                          : score !== null || comment
                            ? "本题记录已保存"
                            : "尚未记录"}
                      </span>
                      <Button
                        loading={saving}
                        disabled={!draft}
                        onClick={() => void onSaveRecords(index)}
                      >
                        保存本题记录
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </div>
            <div className="interview-question-pagination">
              <Button
                icon={<LeftOutlined />}
                disabled={index === 0}
                onClick={() => selectQuestion(index - 1)}
              >
                上一题
              </Button>
              {Object.keys(drafts).length > 0 && (
                <Button loading={saving} onClick={() => void onSaveRecords()}>
                  保存全部记录
                </Button>
              )}
              <Button
                icon={<RightOutlined />}
                disabled={index === questions.length - 1}
                onClick={() => selectQuestion(index + 1)}
              >
                下一题
              </Button>
            </div>
          </>
        ) : (
          <div className="interview-material-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="本场暂未配置面试题"
            />
            {canEdit && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => void openEditor(null)}
              >
                添加第一道题
              </Button>
            )}
          </div>
        )}
      </Card>
      <Modal
        title={editor?.index === null ? "添加面试题" : "编辑面试题"}
        open={editor !== null}
        onCancel={() => {
          if (!busy) cancelEditor();
        }}
        onOk={() => void saveQuestion()}
        okText="保存题目"
        cancelText="取消"
        confirmLoading={busy}
        styles={{ body: { maxHeight: "65dvh", overflowY: "auto" } }}
        afterOpenChange={(open) => {
          if (open) form.focusField("content");
        }}
      >
        {error && <Alert type="error" title={error} />}
        <Form
          noValidate
          form={form}
          layout="vertical"
          name="interview-question"
          onValuesChange={() => {
            editorDirty.current = true;
            onEditorDirty(true);
          }}
        >
          <Form.Item name="title" label="题目标题">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="content"
            label="问题内容"
            rules={[
              { required: true, whitespace: true, message: "请填写问题内容" },
            ]}
          >
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <Form.Item name="resume_association" label="简历关联">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item name="follow_up" label="追问方向（每行一个）">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item name="reference_answer" label="参考答案">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <Form.Item name="grading_criteria" label="评分标准">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <div className="recruitment-score-grid">
            <Form.Item name="difficulty" label="难度">
              <Select
                options={[
                  { value: "junior", label: "初级" },
                  { value: "intermediate", label: "中级" },
                  { value: "senior", label: "高级" },
                ]}
              />
            </Form.Item>
            <Form.Item name="type" label="类型">
              <Select
                options={[
                  { value: "technical", label: "技术" },
                  { value: "project", label: "项目" },
                  { value: "behavioral", label: "行为" },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
