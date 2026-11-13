import {
  Alert,
  Button,
  Calendar,
  Card,
  DatePicker,
  Empty,
  Segmented,
  Spin,
  Switch,
  Tag,
} from "antd";
import { LeftOutlined, RightOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import PageHeader from "../../components/PageHeader";
import { useResource } from "./shared";
import "./style.css";

interface CalendarEvent {
  id: string;
  candidate_name: string;
  position_title: string;
  start: string;
  end: string;
  estimated_end: boolean;
  status: string;
  round: number;
  location: string | null;
}
const statusNames: Record<string, string> = {
  scheduled: "已安排",
  in_progress: "进行中",
  analyzing: "待评价与决策",
  completed: "已完成",
  cancelled: "已取消",
};
export default function InterviewCalendar() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const date = dayjs(params.get("date")).isValid()
    ? dayjs(params.get("date"))
    : dayjs();
  const mode = ["week", "day"].includes(params.get("view") || "")
    ? params.get("view")!
    : "month";
  const mine = params.get("mine") === "true";
  const start =
    mode === "month"
      ? date.startOf("month").startOf("week")
      : mode === "week"
        ? date.startOf("week")
        : date.startOf("day");
  const end =
    mode === "month"
      ? date.endOf("month").endOf("week")
      : mode === "week"
        ? start.add(7, "day")
        : start.add(1, "day");
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    mine: String(mine),
  });
  const { data, error, loading, refresh } = useResource<CalendarEvent[]>(
    `/recruitment/calendar?${query}`,
  );
  function update(values: Record<string, string>) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(values).forEach(([key, value]) => next.set(key, value));
      return next;
    });
  }
  const days = Array.from({ length: mode === "week" ? 7 : 1 }, (_, i) =>
    start.add(i, "day"),
  );
  return (
    <div>
      <PageHeader
        title="面试日历"
        description="按月、周或日查看面试安排，点击候选人进入面试工作区。"
        actions={
          <Link to="/interviews">
            <Button>安排面试</Button>
          </Link>
        }
      />
      <div className="recruitment-toolbar">
        <Segmented
          aria-label="日历视图"
          value={mode}
          options={[
            { value: "month", label: "月" },
            { value: "week", label: "周" },
            { value: "day", label: "日" },
          ]}
          onChange={(view) => update({ view: String(view) })}
        />
        <Button
          aria-label="上一周期"
          icon={<LeftOutlined />}
          onClick={() =>
            update({
              date: date
                .subtract(1, mode as "month" | "week" | "day")
                .format("YYYY-MM-DD"),
            })
          }
        />
        <DatePicker
          allowClear={false}
          value={date}
          onChange={(value) => {
            if (value) update({ date: value.format("YYYY-MM-DD") });
          }}
        />
        <Button
          aria-label="下一周期"
          icon={<RightOutlined />}
          onClick={() =>
            update({
              date: date
                .add(1, mode as "month" | "week" | "day")
                .format("YYYY-MM-DD"),
            })
          }
        />
        <Button onClick={() => update({ date: dayjs().format("YYYY-MM-DD") })}>
          今天
        </Button>
        <Switch
          checked={mine}
          checkedChildren="仅看我的"
          unCheckedChildren="全部可见面试"
          onChange={(value) => update({ mine: String(value) })}
        />
      </div>
      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          action={
            <Button onClick={refresh} icon={<ReloadOutlined />}>
              重试
            </Button>
          }
        />
      )}
      <Spin spinning={loading}>
        <Card className="recruitment-calendar">
          {mode === "month" ? (
            <Calendar
              value={date}
              headerRender={() => null}
              onSelect={(value) => update({ date: value.format("YYYY-MM-DD") })}
              cellRender={(value, info) =>
                info.type === "date" ? (
                  <div>
                    {(data || [])
                      .filter(
                        (e) =>
                          dayjs(e.start).isBefore(value.endOf("day")) &&
                          dayjs(e.end).isAfter(value.startOf("day")),
                      )
                      .map((event) => (
                        <button
                          className="recruitment-calendar-event"
                          key={event.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/interviews/${event.id}/score`);
                          }}
                        >
                          {dayjs(event.start).format("HH:mm")}{" "}
                          {event.candidate_name}
                          {event.status === "cancelled" ? " · 已取消" : ""}
                        </button>
                      ))}
                  </div>
                ) : (
                  info.originNode
                )
              }
            />
          ) : (
            <div className="recruitment-stack">
              {days.map((day) => (
                <section key={day.toISOString()}>
                  <h3>{day.format("MM月DD日 dddd")}</h3>
                  {(data || [])
                    .filter(
                      (e) =>
                        dayjs(e.start).isBefore(day.endOf("day")) &&
                        dayjs(e.end).isAfter(day.startOf("day")),
                    )
                    .map((event) => (
                      <div className="recruitment-task" key={event.id}>
                        <div>
                          <strong>
                            {dayjs(event.start).format("HH:mm")}–
                            {dayjs(event.end).format("HH:mm")}
                          </strong>{" "}
                          {event.estimated_end && <Tag>预计 60 分钟</Tag>}
                          <p>
                            {event.candidate_name} · {event.position_title} · 第{" "}
                            {event.round} 轮
                          </p>
                          <p>
                            {event.location || "地点待确认"}{" "}
                            <Tag>
                              {statusNames[event.status] || event.status}
                            </Tag>
                          </p>
                        </div>
                        <Link to={`/interviews/${event.id}/score`}>
                          查看面试
                        </Link>
                      </div>
                    ))}
                  {!(data || []).some(
                    (e) =>
                      dayjs(e.start).isBefore(day.endOf("day")) &&
                      dayjs(e.end).isAfter(day.startOf("day")),
                  ) && (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="当天暂无面试"
                    />
                  )}
                </section>
              ))}
            </div>
          )}
        </Card>
      </Spin>
    </div>
  );
}
