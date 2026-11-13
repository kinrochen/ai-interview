import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Progress,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
} from "antd";
import {
  ArrowRightOutlined,
  BankOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import PageHeader from "../../components/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import request from "../../utils/request";
import "./style.css";

interface DashboardStats {
  active_positions: number;
  pending_resumes: number;
  today_interviews: number;
  total_questions: number;
  trends: {
    active_positions: number;
    pending_resumes: number;
    today_interviews: number;
    total_questions: number;
  };
}

interface Activity {
  id: string;
  title: string;
  time: string;
  status: string;
  avatar_color: string;
  type: string;
}

interface FunnelStage {
  stage: string;
  stage_name: string;
  count: number;
  percentage: number;
}

interface RecruitmentFunnel {
  stages: FunnelStage[];
  total_resumes: number;
  conversion_rate: number;
}

interface PositionAnalytics {
  id: string;
  title: string;
  department: string;
  status: string;
  total_resumes: number;
  pending_screening: number;
  pending_interview: number;
  interview_completed: number;
  offer_sent: number;
  hired: number;
  rejected: number;
  avg_match_score: number | null;
  avg_processing_days: number | null;
  conversion_rate: number;
}

interface InterviewerStats {
  id: string;
  name: string;
  total_interviews: number;
  completed_interviews: number;
  pending_interviews: number;
  completion_rate: number;
  avg_score: number | null;
  score_std: number | null;
  consistency_rating: string;
}

interface TimelineDataPoint {
  date: string;
  resumes_received: number;
  interviews_scheduled: number;
  interviews_completed: number;
  offers_sent: number;
  hires: number;
}

interface OverviewMetrics {
  total_positions: number;
  active_positions: number;
  total_resumes: number;
  pending_resumes: number;
  total_interviews: number;
  completed_interviews: number;
  total_offers: number;
  accepted_offers: number;
  avg_time_to_hire: number | null;
  avg_match_score: number | null;
  interview_pass_rate: number;
  offer_accept_rate: number;
}

interface DashboardData {
  stats: DashboardStats;
  recent_activities: Activity[];
}
interface DashboardSections {
  summary: DashboardData | null;
  funnel: RecruitmentFunnel | null;
  positions: PositionAnalytics[] | null;
  interviewers: InterviewerStats[] | null;
  overview: OverviewMetrics | null;
}
const sectionLabels = [
  "概览与动态",
  "招聘漏斗",
  "岗位分析",
  "面试官分析",
  "核心指标",
];
const series = [
  {
    key: "resumes_received",
    label: "简历接收",
    color: "var(--secondary-color)",
  },
  {
    key: "interviews_scheduled",
    label: "面试安排",
    color: "var(--warning-color)",
  },
  {
    key: "interviews_completed",
    label: "面试完成",
    color: "var(--accent-color)",
  },
  { key: "offers_sent", label: "Offer 发放", color: "var(--primary-color)" },
  { key: "hires", label: "入职", color: "var(--success-color)" },
] as const;
const percentage = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
const decimal = (value: number | null | undefined) =>
  value == null ? "—" : value.toFixed(1);

export default function Dashboard() {
  const { user } = useAuth();
  return user?.role === "interviewer" ? <Navigate to="/workbench" replace /> : <RecruitmentDashboard />;
}

function RecruitmentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DashboardSections>({
    summary: null,
    funnel: null,
    positions: null,
    interviewers: null,
    overview: null,
  });
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState(false);
  const [timelineDays, setTimelineDays] = useState(30);
  const [timelineView, setTimelineView] = useState("chart");
  const canManage = user?.role === "admin" || user?.role === "hr";
  const activeTab = ["positions", "interviewers", "activities"].includes(
    searchParams.get("view") || "",
  )
    ? searchParams.get("view")!
    : "positions";

  useEffect(() => {
    const controller = new AbortController();
    const fetchSections = async () => {
      setLoading(true);
      const responses = await Promise.allSettled([
        request.get("/dashboard/stats", { signal: controller.signal }),
        request.get("/dashboard/funnel", { signal: controller.signal }),
        request.get("/dashboard/positions", { signal: controller.signal }),
        request.get("/dashboard/interviewers", { signal: controller.signal }),
        request.get("/dashboard/overview", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const [summary, funnel, positions, interviewers, overview] = responses;
      setData((previous) => ({
        summary:
          summary.status === "fulfilled" ? summary.value : previous.summary,
        funnel: funnel.status === "fulfilled" ? funnel.value : previous.funnel,
        positions:
          positions.status === "fulfilled"
            ? positions.value.positions
            : previous.positions,
        interviewers:
          interviewers.status === "fulfilled"
            ? interviewers.value.interviewers
            : previous.interviewers,
        overview:
          overview.status === "fulfilled"
            ? overview.value.metrics
            : previous.overview,
      }));
      setErrors(
        responses.flatMap((response, index) =>
          response.status === "rejected" ? [sectionLabels[index]] : [],
        ),
      );
      setUpdatedAt(dayjs().format("HH:mm:ss"));
      setLoading(false);
    };
    void fetchSections();
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchTimeline = async () => {
      setTimelineLoading(true);
      setTimelineError(false);
      // Keep chart geometry stable while replacing the selected date range.
      try {
        const response = await request.get("/dashboard/timeline", {
          params: { days: timelineDays },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setTimeline(response.timeline);
      } catch {
        if (!controller.signal.aborted) setTimelineError(true);
      } finally {
        if (!controller.signal.aborted) setTimelineLoading(false);
      }
    };
    void fetchTimeline();
    return () => controller.abort();
  }, [timelineDays, refreshKey]);

  const refresh = () => setRefreshKey((value) => value + 1);
  const stats = data.summary?.stats;
  const metrics = [
    {
      key: "active_positions" as const,
      title: "开放岗位",
      note: "含待发布与招聘中",
      icon: <BankOutlined />,
      className: "blue",
    },
    {
      key: "pending_resumes" as const,
      title: "待筛选简历",
      note: "等待初筛或团队评审",
      icon: <FileTextOutlined />,
      className: "teal",
    },
    {
      key: "today_interviews" as const,
      title: "今日面试",
      note: "按服务端 UTC 日期统计",
      icon: <TeamOutlined />,
      className: "amber",
    },
    {
      key: "total_questions" as const,
      title: "面试题库",
      note: "已建立的题库数量",
      icon: <BankOutlined />,
      className: "slate",
    },
  ];
  const positionColumns = [
    {
      title: "岗位名称",
      dataIndex: "title",
      render: (title: string, record: PositionAnalytics) => (
        <div className="analysis-name">
          {canManage ? (
            <Link to={`/positions/${record.id}`}>{title}</Link>
          ) : (
            <strong>{title}</strong>
          )}
          <small>{record.department || "未设置部门"}</small>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (status: string) => (
        <Tag
          color={
            status === "published"
              ? "success"
              : status === "open"
                ? "processing"
                : "default"
          }
        >
          {(
            { open: "待发布", published: "招聘中", closed: "已关闭" } as Record<
              string,
              string
            >
          )[status] || status}
        </Tag>
      ),
    },
    {
      title: "简历数",
      dataIndex: "total_resumes",
      sorter: (a: PositionAnalytics, b: PositionAnalytics) =>
        a.total_resumes - b.total_resumes,
    },
    { title: "待初筛", dataIndex: "pending_screening" },
    { title: "待面试", dataIndex: "pending_interview" },
    { title: "已录用", dataIndex: "hired" },
    {
      title: "转化率",
      dataIndex: "conversion_rate",
      render: (value: number) => percentage(value),
    },
  ];
  const interviewerColumns = [
    { title: "面试官", dataIndex: "name" },
    {
      title: "总面试数",
      dataIndex: "total_interviews",
      sorter: (a: InterviewerStats, b: InterviewerStats) =>
        a.total_interviews - b.total_interviews,
    },
    { title: "已完成", dataIndex: "completed_interviews" },
    {
      title: "完成率",
      dataIndex: "completion_rate",
      render: (value: number) => (
        <Progress
          percent={value}
          size="small"
          format={() => percentage(value)}
        />
      ),
    },
    {
      title: "平均评分",
      dataIndex: "avg_score",
      render: (value: number | null) => decimal(value),
    },
    {
      title: "评分一致性",
      dataIndex: "consistency_rating",
      render: (value: string) => <Tag>{value}</Tag>,
    },
  ];
  const unavailable = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="数据暂时不可用，请刷新重试"
    />
  );
  const hasTimelineActivity = timeline.some((item) =>
    series.some((metric) => item[metric.key] > 0),
  );

  const timelineContent = (
    <Spin spinning={timelineLoading}>
      <div className="timeline-content">
        {timelineError ? (
          <div className="timeline-feedback">
            <Alert
              type="error"
              showIcon
              title="趋势数据加载失败"
              description="请重试以获取当前时间范围的数据。"
              action={<Button onClick={refresh}>重试</Button>}
            />
          </div>
        ) : timelineView === "data" ? (
          <Table
            size="small"
            rowKey="date"
            dataSource={timeline}
            scroll={{ x: 780 }}
            pagination={{ pageSize: 7, showSizeChanger: false }}
            columns={[
              { title: "日期", dataIndex: "date" },
              ...series.map((metric) => ({
                title: metric.label,
                dataIndex: metric.key,
              })),
            ]}
          />
        ) : !hasTimelineActivity ? (
          <div className="timeline-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`近 ${timelineDays} 天暂无招聘活动`}
            />
          </div>
        ) : (
          <div
            className="timeline-chart"
            role="img"
            aria-label={`近 ${timelineDays} 天招聘活动趋势，具体数值可在数据表中查看`}
          >
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={timeline}
                margin={{ top: 16, right: 12, left: -20, bottom: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 6"
                  vertical={false}
                  stroke="var(--border-color)"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => dayjs(value).format("MM-DD")}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                  minTickGap={30}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                />
                <Tooltip
                  labelFormatter={(label) =>
                    dayjs(label).format("YYYY年MM月DD日")
                  }
                  contentStyle={{
                    borderRadius: 8,
                    borderColor: "var(--border-color)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
                {series.map((metric) => (
                  <Line
                    key={metric.key}
                    type="monotone"
                    dataKey={metric.key}
                    name={metric.label}
                    stroke={metric.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Spin>
  );

  return (
    <div className="dashboard-page">
      <PageHeader
        title="招聘概览"
        description="掌握招聘进展，让下一步行动更清晰。"
        actions={
          <>
            <Button
              icon={<ReloadOutlined />}
              onClick={refresh}
              loading={loading || timelineLoading}
            >
              刷新数据
            </Button>
            {canManage && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate("/positions/new")}
              >
                新增岗位
              </Button>
            )}
          </>
        }
      />
      {errors.length > 0 && (
        <Alert
          className="dashboard-error"
          type="warning"
          showIcon
          title={`${errors.join("、")}未能更新`}
          description="已有内容保留上次成功结果，暂未获取的数据以横线显示。"
          action={
            <Button onClick={refresh} disabled={loading}>
              重试
            </Button>
          }
        />
      )}
      <div className="dashboard-status" role="status">
        {loading
          ? "正在更新招聘数据…"
          : errors.length
            ? "部分数据更新失败"
            : `数据更新于 ${updatedAt}`}
        <span>组织招聘数据</span>
      </div>
      <Spin spinning={loading}>
        <div className="dashboard-metrics">
          {metrics.map((metric) => (
            <Card key={metric.key} className="metric-card">
              <div className="metric-top">
                <span>{metric.title}</span>
                <span className={`metric-icon ${metric.className}`}>
                  {metric.icon}
                </span>
              </div>
              <div className="metric-value">{stats?.[metric.key] ?? "—"}</div>
              <div className="metric-note">{metric.note}</div>
              <div className="metric-trend">
                近 7 天新建 <strong>{stats?.trends[metric.key] ?? "—"}</strong>
              </div>
            </Card>
          ))}
        </div>
        <div className="dashboard-workspace">
          <Card
            title="招聘进程"
            className="funnel-card"
            extra={
              data.funnel && (
                <span className="card-meta">
                  共 {data.funnel.total_resumes} 份简历
                </span>
              )
            }
          >
            {!data.funnel ? (
              unavailable
            ) : data.funnel.total_resumes === 0 ? (
              <div className="funnel-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有候选人进入招聘流程"
                />
                {canManage && (
                  <Link className="inline-action" to="/resumes/upload">
                    上传第一份简历 <ArrowRightOutlined />
                  </Link>
                )}
              </div>
            ) : (
              <>
                <div className="funnel-stages">
                  {data.funnel.stages.map((stage) => (
                    <div className="funnel-stage" key={stage.stage}>
                      <span>{stage.stage_name}</span>
                      <div className="funnel-track">
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, stage.percentage))}%`,
                          }}
                        />
                      </div>
                      <strong>
                        {stage.count}
                        <small> 人</small>
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="funnel-summary">
                  <span>整体入职转化率</span>
                  <strong>{percentage(data.funnel.conversion_rate)}</strong>
                </div>
              </>
            )}
          </Card>
          <div className="dashboard-side">
            <section
              className="quick-actions"
              aria-labelledby="quick-actions-title"
            >
              <h2 id="quick-actions-title">开始工作</h2>
              {canManage && (
                <Link to="/resumes/upload">
                  <span className="quick-action-icon">
                    <UploadOutlined />
                  </span>
                  <span>
                    <strong>上传候选人简历</strong>
                    <small>解析简历并关联招聘岗位</small>
                  </span>
                  <ArrowRightOutlined />
                </Link>
              )}
              <Link to="/interviews">
                <span className="quick-action-icon">
                  <TeamOutlined />
                </span>
                <span>
                  <strong>{canManage ? "管理面试安排" : "查看面试安排"}</strong>
                  <small>查看面试、评分与结果</small>
                </span>
                <ArrowRightOutlined />
              </Link>
            </section>
            <Card title="核心指标" className="overview-card">
              <div className="overview-metrics">
                <div>
                  <span>面试通过率</span>
                  <strong>
                    {percentage(data.overview?.interview_pass_rate)}
                  </strong>
                </div>
                <div>
                  <span>Offer 接受率</span>
                  <strong>
                    {percentage(data.overview?.offer_accept_rate)}
                  </strong>
                </div>
                <div>
                  <span>平均招聘周期</span>
                  <strong>
                    {decimal(data.overview?.avg_time_to_hire)}
                    <small>
                      {data.overview?.avg_time_to_hire != null ? " 天" : ""}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>平均匹配分</span>
                  <strong>{decimal(data.overview?.avg_match_score)}</strong>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </Spin>
      <Card
        className="timeline-card"
        title="招聘活动趋势"
        extra={
          <Select
            aria-label="趋势时间范围"
            value={timelineDays}
            onChange={setTimelineDays}
            options={[
              { value: 7, label: "近 7 天" },
              { value: 30, label: "近 30 天" },
              { value: 90, label: "近 90 天" },
            ]}
          />
        }
      >
        <Tabs
          activeKey={timelineView}
          onChange={setTimelineView}
          items={[
            {
              key: "chart",
              label: "趋势图",
              children: timelineView === "chart" ? timelineContent : null,
            },
            {
              key: "data",
              label: "数据表",
              children: timelineView === "data" ? timelineContent : null,
            },
          ]}
        />
      </Card>
      <Card className="analysis-card">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            const next = new URLSearchParams(searchParams);
            next.set("view", key);
            setSearchParams(next);
          }}
          items={[
            {
              key: "positions",
              label: "岗位分析",
              children: (
                <Table
                  columns={positionColumns}
                  dataSource={data.positions || []}
                  rowKey="id"
                  loading={loading}
                  scroll={{ x: 760 }}
                  pagination={{ pageSize: 7, showSizeChanger: false }}
                  locale={{
                    emptyText:
                      data.positions === null ? unavailable : "暂无岗位数据",
                  }}
                />
              ),
            },
            {
              key: "interviewers",
              label: "面试官分析",
              children: (
                <Table
                  columns={interviewerColumns}
                  dataSource={data.interviewers || []}
                  rowKey="id"
                  loading={loading}
                  scroll={{ x: 720 }}
                  pagination={{ pageSize: 7, showSizeChanger: false }}
                  locale={{
                    emptyText:
                      data.interviewers === null
                        ? unavailable
                        : "暂无面试官数据",
                  }}
                />
              ),
            },
            {
              key: "activities",
              label: "最新动态",
              children: !data.summary ? (
                unavailable
              ) : data.summary.recent_activities.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无招聘动态"
                />
              ) : (
                <ul className="activity-list">
                  {data.summary.recent_activities.map((activity) => (
                    <li key={`${activity.type}-${activity.id}`}>
                      <span className="activity-icon">
                        {activity.type === "interview" ? (
                          <TeamOutlined />
                        ) : (
                          <FileTextOutlined />
                        )}
                      </span>
                      <div>
                        <strong>{activity.title}</strong>
                        <time dateTime={activity.time}>
                          <ClockCircleOutlined />{" "}
                          {dayjs(activity.time).format("YYYY-MM-DD HH:mm")}
                        </time>
                      </div>
                      <Tag>{activity.status}</Tag>
                    </li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
