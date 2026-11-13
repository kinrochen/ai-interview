import { useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Switch,
  message,
} from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";

export default function Onboarding({
  offer,
  onChange,
}: {
  offer: {
    id: string;
    candidate_name: string;
    status: string;
    actual_onboarded_at?: string | null;
    departed_at?: string | null;
  };
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm<{
    actual_date: Dayjs;
    reason: string;
    release_hc: boolean;
  }>();
  const departure = !!offer.actual_onboarded_at;
  if (offer.departed_at) return <span>已离职</span>;
  if (offer.status !== "accepted") return null;
  async function save() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setError("");
      await request.post(
        `/recruitment/offers/${offer.id}/${departure ? "departure" : "onboarding"}`,
        { ...values, actual_date: values.actual_date.format("YYYY-MM-DD") },
      );
      setOpen(false);
      message.success(departure ? "离职与 HC 处理已登记" : "实际入职已登记");
      onChange();
    } catch (reason) {
      setError(getErrorMessage(reason, "请核对填写内容后重试"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="link"
        onClick={() => {
          form.setFieldsValue({
            actual_date: dayjs(),
            release_hc: true,
            reason: "",
          });
          setError("");
          setOpen(true);
        }}
      >
        {departure ? "登记离职" : "确认入职"}
      </Button>
      <Modal
        title={`${offer.candidate_name} · ${departure ? "登记离职" : "确认实际入职"}`}
        open={open}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onOk={() => void save()}
        confirmLoading={busy}
        okText="确认登记"
        cancelText="取消"
        destroyOnHidden
      >
        {error && <Alert type="error" showIcon title={error} />}
        <Form
          noValidate
          form={form}
          layout="vertical"
          style={{ marginTop: 20 }}
        >
          <Form.Item
            name="actual_date"
            label={departure ? "实际离职日期" : "实际入职日期"}
            rules={[{ required: true, message: "请选择实际日期" }]}
          >
            <DatePicker
              style={{ width: "100%" }}
              disabledDate={(date) =>
                date.isAfter(dayjs(), "day") ||
                (departure &&
                  !!offer.actual_onboarded_at &&
                  date.isBefore(dayjs(offer.actual_onboarded_at), "day"))
              }
            />
          </Form.Item>
          {departure && (
            <>
              <Form.Item
                name="reason"
                label="离职原因"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: "请填写离职原因",
                  },
                ]}
              >
                <Input.TextArea rows={3} maxLength={2000} />
              </Form.Item>
              <Form.Item
                name="release_hc"
                label="释放本次占用的 HC 名额"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </>
          )}
          <p className="recruitment-muted">
            {departure
              ? "释放后本轮可用名额将增加，岗位可由管理员重新开启。"
              : "确认后占用本轮可用招聘名额，名额招满时岗位自动关闭。"}
          </p>
        </Form>
      </Modal>
    </>
  );
}
