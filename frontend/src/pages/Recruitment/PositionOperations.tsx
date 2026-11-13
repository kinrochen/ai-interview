import PageHeader from "../../components/PageHeader";
import { Link } from "react-router-dom";
import { useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Timeline,
  message,
} from "antd";
import { useAuth } from "../../contexts/AuthContext";
import dayjs from "dayjs";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";
import { useResource } from "./shared";
import "./style.css";

interface Slot {
  id: string;
  number: number;
  status: string;
  candidate_name: string | null;
  onboarded_at: string | null;
  departed_at: string | null;
}
interface HC {
  cycle: number;
  target: number;
  occupied: number;
  employed: number;
  available: number;
  cumulative_onboarded: number;
  slots: Slot[];
  history: { at: string; type: string; details: Record<string, unknown> }[];
}
const actionLabels: Record<string, string> = {
  pause: "暂停招聘",
  resume: "恢复招聘",
  close: "关闭招聘",
  cancel: "取消招聘",
  reopen: "重新开启",
  archive: "归档岗位",
  restore: "恢复岗位",
};
interface ActionProps {
  id: string;
  action: string;
  onDone: () => void;
}
function LifecycleAction({ id, action, onDone }: ActionProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm();
  async function submit() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setError("");
      await request.post(`/recruitment/positions/${id}/action`, {
        action,
        ...values,
      });
      setOpen(false);
      onDone();
      message.success(`${actionLabels[action]}成功`);
    } catch (reason) {
      setError(getErrorMessage(reason, "请检查操作内容后重试"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        danger={["cancel", "archive"].includes(action)}
        onClick={() => {
          setOpen(true);
          setError("");
          form.resetFields();
        }}
      >
        {actionLabels[action]}
      </Button>
      <Modal
        title={actionLabels[action]}
        open={open}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onOk={() => void submit()}
        confirmLoading={busy}
        okText="确认"
        cancelText="取消"
      >
        {error && <Alert type="error" showIcon title={error} />}
        <Form
          noValidate
          form={form}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="reason"
            label="操作原因"
            rules={[
              { required: true, whitespace: true, message: "请填写操作原因" },
            ]}
          >
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
          {["reopen", "restore"].includes(action) && (
            <>
              <Form.Item
                name="new_cycle"
                label="开启新的招聘轮次"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <p className="recruitment-muted">
                开启新轮次会建立新的 HC
                名额，原轮次的候选人与入职记录保留在历史中。
              </p>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
function PositionDetail({
  id,
  title,
  status,
  onDone,
}: {
  id: string;
  title: string;
  status: string;
  onDone: () => void;
}) {
  const { data, error, refresh } = useResource<HC>(
    `/recruitment/positions/${id}/hc`,
  );
  const { user } = useAuth();
  const actions =
    status === "published"
      ? ["pause", "close", "cancel"]
      : status === "paused"
        ? ["resume", "close", "cancel"]
        : ["closed", "cancelled"].includes(status) && user?.role === "admin"
          ? ["reopen"]
          : status === "open"
            ? ["cancel"]
            : [];
  return (
    <div className="recruitment-stack">
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={refresh}>重试</Button>}
        />
      )}
      {data && (
        <>
          <Descriptions
            title={title}
            column={2}
            items={[
              { key: "cycle", label: "招聘轮次", children: data.cycle },
              { key: "target", label: "目标人数", children: data.target },
              { key: "occupied", label: "占用名额", children: data.occupied },
              { key: "employed", label: "本轮在职", children: data.employed },
              { key: "available", label: "可用名额", children: data.available },
              {
                key: "all",
                label: "本轮累计入职",
                children: data.cumulative_onboarded,
              },
            ]}
          />
          <Space wrap>
            {[...actions, "archive"].map((action) => (
              <LifecycleAction
                key={action}
                id={id}
                action={action}
                onDone={onDone}
              />
            ))}
          </Space>
          <Table<Slot>
            rowKey="id"
            pagination={false}
            dataSource={data.slots}
            scroll={{ x: 450 }}
            columns={[
              { title: "名额", dataIndex: "number" },
              {
                title: "候选人",
                render: (_, s) => s.candidate_name || "待入职",
              },
              {
                title: "状态",
                render: (_, s) => (
                  <Tag>
                    {s.status === "active"
                      ? "可用"
                      : s.status === "occupied"
                        ? s.departed_at
                          ? "离职后保留占用"
                          : "已入职"
                        : s.status === "historical"
                          ? "离职已释放"
                          : "已取消"}
                  </Tag>
                ),
              },
              {
                title: "入职日期",
                render: (_, s) =>
                  s.onboarded_at
                    ? dayjs(s.onboarded_at).format("YYYY-MM-DD")
                    : "—",
              },
            ]}
          />
          <h3>岗位操作历史</h3>
          <Timeline
            items={data.history.map((event, index) => ({
              key: index,
              content: (
                <>
                  <strong>
                    {actionLabels[event.type.replace("position_", "")] ||
                      (event.type === "position_filled"
                        ? "HC 已招满"
                        : event.type === "created"
                          ? "创建岗位"
                          : "更新岗位")}
                  </strong>
                  <p>{dayjs(event.at).format("YYYY-MM-DD HH:mm")}</p>
                  <pre className="recruitment-pre">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </>
              ),
            }))}
          />
        </>
      )}
    </div>
  );
}
export default function PositionOperations({
  id,
  title,
  status,
  onChange,
}: {
  id: string;
  title: string;
  status: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="link"
        onClick={() => setOpen(true)}
        aria-label={`管理 ${title} 的招聘名额`}
      >
        名额与状态
      </Button>
      <Drawer
        title="招聘名额与生命周期"
        open={open}
        onClose={() => setOpen(false)}
        size={700}
        destroyOnHidden
      >
        {open && (
          <PositionDetail
            id={id}
            title={title}
            status={status}
            onDone={() => {
              setOpen(false);
              onChange();
            }}
          />
        )}
      </Drawer>
    </>
  );
}
export function ArchivedPositions() {
  const { data, error, refresh } = useResource<
    { id: string; title: string; cycle: number; archived_at: string }[]
  >("/recruitment/archived-positions");
  return (
    <div>
      <PageHeader
        title="已归档岗位"
        description="查看归档记录，恢复需要继续招聘的岗位。"
        actions={
          <Link to="/positions">
            <Button>返回岗位管理</Button>
          </Link>
        }
      />
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={refresh}>重试</Button>}
        />
      )}
      <Table
        rowKey="id"
        dataSource={data || []}
        locale={{ emptyText: <Empty description="暂无归档岗位" /> }}
        columns={[
          { title: "岗位", dataIndex: "title" },
          { title: "轮次", dataIndex: "cycle" },
          {
            title: "归档时间",
            render: (_, row) =>
              dayjs(row.archived_at).format("YYYY-MM-DD HH:mm"),
          },
          {
            title: "操作",
            render: (_, row) => (
              <LifecycleAction id={row.id} action="restore" onDone={refresh} />
            ),
          },
        ]}
      />
    </div>
  );
}
