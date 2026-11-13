import { Alert, Button, Card, Empty, Spin, Tag } from "antd";
import { CalendarOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import PageHeader from "../../components/PageHeader";
import { useResource } from "./shared";
import "./style.css";

interface Task {
  id: string;
  candidate_name: string;
  position_title: string;
  time: string | null;
  round: number;
}
interface WorkbenchData {
  counts: {
    upcoming: number;
    in_progress: number;
    pending_reviews: number;
    department_reviews: number;
  };
  upcoming: Task[];
  in_progress: Task[];
  pending_reviews: Task[];
  department_reviews: {
    id: string;
    resume_id: string;
    candidate_name: string;
    assigned_at: string;
  }[];
}
function Tasks({ items, empty }: { items: Task[]; empty: string }) {
  return items.length ? (
    items.map((item) => (
      <div className="recruitment-task" key={item.id}>
        <div>
          <strong>{item.candidate_name}</strong> <Tag>第 {item.round} 轮</Tag>
          <p>{item.position_title}</p>
          <p>
            {item.time ? dayjs(item.time).format("MM-DD HH:mm") : "时间待安排"}
          </p>
        </div>
        <Link to={`/interviews/${item.id}/score`}>进入面试</Link>
      </div>
    ))
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
  );
}
export default function Workbench() {
  const { data, loading, error, refresh } = useResource<WorkbenchData>(
    "/recruitment/workbench",
  );
  return (
    <div>
      <PageHeader
        title="我的工作台"
        description="查看分配给你的面试与评审，继续处理待办事项。"
        actions={
          <Link to="/interviews/calendar">
            <Button icon={<CalendarOutlined />}>面试日历</Button>
          </Link>
        }
      />
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button onClick={refresh} icon={<ReloadOutlined />}>
              重试
            </Button>
          }
        />
      )}
      {loading && <Spin aria-label="加载我的工作台" />}
      {data && (
        <>
          <div className="recruitment-metrics">
            {[
              ["即将面试", data.counts.upcoming],
              ["进行中", data.counts.in_progress],
              ["待提交面试评价", data.counts.pending_reviews],
              ["待部门初评", data.counts.department_reviews],
            ].map(([label, count]) => (
              <div className="recruitment-metric" key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
          <div className="recruitment-grid">
            <Card title="待处理的面试">
              <Tasks
                items={[...data.in_progress, ...data.pending_reviews]}
                empty="面试评价已处理完毕"
              />
            </Card>
            <Card
              title="即将开始"
              extra={<Link to="/interviews/calendar">查看全部</Link>}
            >
              <Tasks items={data.upcoming} empty="暂无即将开始的面试" />
            </Card>
            <Card title="部门初评">
              {data.department_reviews.length ? (
                data.department_reviews.map((item) => (
                  <div className="recruitment-task" key={item.id}>
                    <div>
                      <strong>{item.candidate_name}</strong>
                      <p>
                        分配于 {dayjs(item.assigned_at).format("MM-DD HH:mm")}
                      </p>
                    </div>
                    <Link to={`/resumes/${item.resume_id}`}>
                      查看简历并评审
                    </Link>
                  </div>
                ))
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无待评审简历"
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
