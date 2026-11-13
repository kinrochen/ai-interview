import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Timeline,
  message,
} from "antd";
import { ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import PageHeader from "../../components/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";
import { useResource } from "./shared";
import "./style.css";

interface Flow {
  id: string;
  candidate_name: string;
  position_id: string;
  position_title: string;
  cycle: number;
  stage_label: string;
  state: string;
  started_at: string | null;
  due_at: string | null;
  owner_name: string;
  link: string;
  history: {
    label: string;
    started_at: string;
    completed_at: string | null;
    due_at: string | null;
    on_time: boolean | null;
  }[];
  evidence: {
    id: string;
    type: string;
    subject: string;
    at: string;
    details: Record<string, unknown>;
  }[];
}
interface QualityData {
  items: Flow[];
  total: number;
  counts: Record<string, number>;
  eligible_phases: number;
  on_time_phases: number;
}
const states: Record<string, { label: string; color: string }> = {
  on_track: { label: "时限内", color: "success" },
  overdue: { label: "已超时", color: "error" },
  waiting: { label: "等待中", color: "processing" },
  unknown: { label: "时间依据待补充", color: "default" },
  completed: { label: "已结束", color: "default" },
};
const ruleLabels: Record<string, string> = {
  screening: "简历初筛",
  assign_review: "分配部门初评",
  hr_decision: "HR 综合决策",
  schedule: "安排面试",
  human_review: "人工评价",
  final_decision: "最终决策",
  offer_send: "发送 Offer",
  onboarding: "实际入职确认",
};
const eventLabels: Record<string, string> = {
  created: "创建记录",
  updated: "更新流程",
  followup: "跟进备注",
  departure: "登记离职",
  recording_end_forced: "管理员结束异常录音",
};
export default function QualityBoard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Flow | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [scope, setScope] = useState<string>();
  const [policyError, setPolicyError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [rulesForm] = Form.useForm();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = [10, 20, 50].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : 10;
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  query.set("page_size", String(pageSize));
  const { data, error, loading, refresh } = useResource<QualityData>(
    `/recruitment/quality?${query}`,
  );
  const {
    data: options,
    error: optionsError,
    refresh: refreshOptions,
  } = useResource<{
    positions: { value: string; label: string }[];
    owners: { value: string; label: string }[];
  }>("/recruitment/quality/options");
  const [noteError, setNoteError] = useState("");
  function filter(values: Record<string, string>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        Object.entries(values).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        );
        if (!values.page) next.set("page", "1");
        return next;
      },
      { replace: true },
    );
  }
  async function openPolicy(positionId?: string) {
    setScope(positionId);
    setPolicyOpen(true);
    setPolicyError("");
    setBusy(true);
    try {
      const response = await request.get("/recruitment/quality/policy", {
        params: { position_id: positionId },
      });
      rulesForm.setFieldsValue(response.rules);
    } catch (reason) {
      setPolicyError(getErrorMessage(reason, "时限配置加载失败"));
    } finally {
      setBusy(false);
    }
  }
  async function savePolicy() {
    try {
      const rules = await rulesForm.validateFields();
      setBusy(true);
      setPolicyError("");
      await request.put("/recruitment/quality/policy", {
        rules,
        position_id: scope || null,
      });
      setPolicyOpen(false);
      message.success("工作日时限已保存");
      refresh();
    } catch (reason) {
      setPolicyError(getErrorMessage(reason, "请检查配置后重试"));
    } finally {
      setBusy(false);
    }
  }
  async function saveNote() {
    if (!selected || !note.trim()) return;
    setBusy(true);
    setNoteError("");
    try {
      await request.post(`/recruitment/quality/${selected.id}/followups`, {
        text: note,
      });
      setNote("");
      setSelected(null);
      refresh();
      message.success("跟进备注已记录");
    } catch (reason) {
      setNoteError(getErrorMessage(reason, "备注保存失败"));
    } finally {
      setBusy(false);
    }
  }
  if (user?.role === "interviewer")
    return <Alert type="info" title="招聘质量看板由 HR 和管理员维护" />;
  return (
    <div>
      <PageHeader
        title="招聘过程质量"
        description="依据真实操作记录计算工作日时限，跟进候选人当前待办与处理历史。"
        actions={
          user?.role === "admin" && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => void openPolicy()}
            >
              全局时限
            </Button>
          )
        }
      />
      <div className="recruitment-metrics">
        {["overdue", "on_track", "waiting", "unknown"].map((key) => (
          <div className="recruitment-metric" key={key}>
            <span>{states[key].label}</span>
            <strong>{data?.counts[key] ?? "—"}</strong>
          </div>
        ))}
        <div className="recruitment-metric">
          <span>有依据的已完成阶段按时率</span>
          <strong>
            {data?.eligible_phases
              ? `${Math.round((data.on_time_phases / data.eligible_phases) * 100)}%`
              : "—"}
          </strong>
          <small>{data?.eligible_phases ?? 0} 个可核对阶段</small>
        </div>
      </div>
      {optionsError && (
        <Alert
          type="error"
          title={optionsError}
          action={<Button onClick={refreshOptions}>重试筛选项</Button>}
        />
      )}
      <div className="recruitment-toolbar">
        <Select
          aria-label="筛选岗位"
          placeholder="全部岗位"
          allowClear
          showSearch
          optionFilterProp="label"
          value={params.get("position_id") || undefined}
          options={options?.positions || []}
          style={{ width: 200 }}
          onChange={(value) => filter({ position_id: value || "" })}
        />
        <Select
          aria-label="筛选负责人"
          placeholder="全部负责人"
          allowClear
          showSearch
          optionFilterProp="label"
          value={params.get("owner_id") || undefined}
          options={options?.owners || []}
          style={{ width: 180 }}
          onChange={(value) => filter({ owner_id: value || "" })}
        />
        <DatePicker.RangePicker
          aria-label="候选人投递日期范围"
          value={
            params.get("from_date") && params.get("to_date")
              ? [dayjs(params.get("from_date")), dayjs(params.get("to_date"))]
              : null
          }
          onChange={(values) =>
            filter({
              from_date: values?.[0]?.format("YYYY-MM-DD") || "",
              to_date: values?.[1]?.format("YYYY-MM-DD") || "",
            })
          }
        />
        <Input.Search
          aria-label="搜索候选人"
          placeholder="搜索候选人，回车查询"
          allowClear
          defaultValue={params.get("q") || ""}
          style={{ width: 280 }}
          onSearch={(q) => filter({ q })}
        />
        <Select
          aria-label="流程状态"
          placeholder="全部状态"
          allowClear
          value={params.get("state") || undefined}
          style={{ width: 190 }}
          options={Object.entries(states).map(([value, config]) => ({
            value,
            label: config.label,
          }))}
          onChange={(state) => filter({ state: state || "" })}
        />
        <Switch
          checked={params.get("mine") === "true"}
          checkedChildren="我的待办"
          unCheckedChildren="全部负责人"
          onChange={(value) => filter({ mine: String(value) })}
        />
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
      </div>
      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          action={<Button onClick={refresh}>重试</Button>}
        />
      )}
      <Card>
        <Table<Flow>
          rowKey="id"
          loading={loading}
          dataSource={data?.items || []}
          scroll={{ x: 920 }}
          locale={{ emptyText: <Empty description="当前筛选下暂无候选流程" /> }}
          columns={[
            {
              title: "候选人 / 岗位",
              render: (_, row) => (
                <>
                  <Link to={`/resumes/${row.id}`}>{row.candidate_name}</Link>
                  <p className="recruitment-muted">
                    {row.position_title} · 第 {row.cycle} 轮招聘
                  </p>
                </>
              ),
            },
            { title: "当前待办", dataIndex: "stage_label" },
            { title: "负责人", dataIndex: "owner_name" },
            {
              title: "流程状态",
              render: (_, row) => (
                <Tag color={states[row.state]?.color}>
                  {states[row.state]?.label}
                </Tag>
              ),
            },
            {
              title: "截止时间",
              render: (_, row) =>
                row.due_at ? dayjs(row.due_at).format("MM-DD HH:mm") : "—",
            },
            {
              title: "操作",
              render: (_, row) => (
                <>
                  <Link to={row.link}>处理待办</Link>
                  <Button
                    type="link"
                    onClick={() => {
                      setSelected(row);
                      setNote("");
                      setNoteError("");
                    }}
                  >
                    记录与证据
                  </Button>
                </>
              ),
            },
          ]}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onChange: (p, size) =>
              filter({ page: String(p), page_size: String(size) }),
          }}
        />
      </Card>
      <Drawer
        title={`${selected?.candidate_name || ""} · 流程证据`}
        open={!!selected}
        onClose={() => setSelected(null)}
        size={640}
      >
        {selected && (
          <div className="recruitment-stack">
            <Link to={selected.link}>
              <Button type="primary">前往处理 {selected.stage_label}</Button>
            </Link>
            <Button onClick={() => void openPolicy(selected.position_id)}>
              配置此岗位时限
            </Button>
            <Alert
              type="info"
              title="时限按中国法定工作日计算。历史时间或年度日历依据缺失时显示待补充。"
            />
            <Timeline
              items={selected.history.map((h, i) => ({
                key: i,
                color:
                  h.on_time === false
                    ? "red"
                    : h.on_time === true
                      ? "green"
                      : "gray",
                content: (
                  <>
                    <strong>{h.label}</strong>
                    <p>
                      {dayjs(h.started_at).format("MM-DD HH:mm")}{" "}
                      {h.completed_at
                        ? `至 ${dayjs(h.completed_at).format("MM-DD HH:mm")}`
                        : "开始"}
                      {h.on_time === true
                        ? " · 按时完成"
                        : h.on_time === false
                          ? " · 超时完成"
                          : ""}
                    </p>
                  </>
                ),
              }))}
            />
            <h3>操作记录</h3>
            {selected.evidence.map((event) => (
              <article key={event.id}>
                <strong>{eventLabels[event.type] || event.type}</strong>
                <p>{dayjs(event.at).format("YYYY-MM-DD HH:mm:ss")}</p>
                <pre className="recruitment-pre">
                  {JSON.stringify(event.details, null, 2)}
                </pre>
              </article>
            ))}
            {!selected.evidence.length && (
              <Empty description="功能启用后的操作将在此保留记录" />
            )}
            <Input.TextArea
              aria-label="跟进备注"
              rows={4}
              maxLength={2000}
              showCount
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="填写跟进情况"
            />
            {noteError && <Alert type="error" title={noteError} />}
            <Button
              loading={busy}
              disabled={!note.trim()}
              onClick={() => void saveNote()}
            >
              保存跟进备注
            </Button>
          </div>
        )}
      </Drawer>
      <Modal
        title={scope ? "岗位工作日时限" : "全局工作日时限"}
        open={policyOpen}
        onCancel={() => {
          if (!busy) setPolicyOpen(false);
        }}
        onOk={() => void savePolicy()}
        confirmLoading={busy}
        okText="保存时限"
        cancelText="取消"
        destroyOnHidden
      >
        {policyError && <Alert type="error" title={policyError} />}
        <Form
          noValidate
          form={rulesForm}
          layout="vertical"
          disabled={busy}
          style={{ marginTop: 20 }}
        >
          <div className="recruitment-score-grid">
            {Object.entries(ruleLabels).map(([key, label]) => (
              <Form.Item
                key={key}
                name={key}
                label={`${label}（工作日）`}
                rules={[{ required: true, message: "请填写工作日数" }]}
              >
                <InputNumber
                  min={1}
                  max={60}
                  precision={0}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            ))}
          </div>
        </Form>
      </Modal>
    </div>
  );
}
