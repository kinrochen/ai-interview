import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Tag,
  message,
} from "antd";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";
import { useResource } from "./shared";

interface Settings {
  provider: string;
  base_url: string;
  model: string;
  has_api_key: boolean;
  configured: boolean;
}
function SettingsForm({
  initial,
  onSaved,
  onRefresh,
  refreshing,
}: {
  initial: Settings;
  onSaved: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [hasKey, setHasKey] = useState(initial.has_api_key);
  const [form] = Form.useForm();
  const provider = Form.useWatch("provider", form) || initial.provider;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setError("");
      await request.put("/interview-workflow/settings/asr", {
        ...values,
        api_key: values.api_key || null,
      });
      message.success("语音转写配置已保存");
      if (values.api_key) setHasKey(true);
      form.setFieldValue("api_key", "");
      onSaved();
    } catch (reason) {
      setError(getErrorMessage(reason, "请检查语音转写配置"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title={
        <Space>
          语音转写配置{initial.configured && <Tag color="success">已配置</Tag>}
        </Space>
      }
      extra={
        <Space>
          <Button onClick={onRefresh} loading={refreshing}>
            刷新
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form="asr-settings-form"
            loading={busy}
          >
            保存
          </Button>
        </Space>
      }
    >
      {error && <Alert type="error" title={error} />}
      {!initial.configured && (
        <Alert
          type="info"
          showIcon
          title="填写 DashScope 密钥后可启用录音自动转写"
          style={{ marginBottom: 20 }}
        />
      )}
      <Form
        id="asr-settings-form"
        name="asr"
        noValidate
        form={form}
        onFinish={() => void save()}
        initialValues={initial}
        layout="vertical"
      >
        <Form.Item name="provider" label="语音转写服务">
          <Select
            options={[
              { value: "dashscope", label: "DashScope" },
              {
                value: "openai_compatible",
                label: "兼容 /audio/transcriptions 的服务",
              },
            ]}
          />
        </Form.Item>
        {provider === "openai_compatible" && (
          <>
            <Form.Item
              name="base_url"
              label="API 基础地址"
              rules={[{ required: true, message: "请填写基础地址" }]}
            >
              <Input placeholder="https://asr.example.com/v1" />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="model"
          label="语音识别模型"
          rules={[{ required: true, message: "请填写模型名称" }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="api_key"
          label="API Key"
          rules={[
            {
              required: provider === "dashscope" && !hasKey,
              message: "请填写 DashScope API Key",
            },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={
              hasKey ? "已配置，留空保留现有密钥" : "填写服务需要的密钥"
            }
          />
        </Form.Item>
      </Form>
    </Card>
  );
}
export default function ASRSettingsCard() {
  const { user } = useAuth();
  const location = useLocation();
  const section = useRef<HTMLElement>(null);
  const { data, error, loading, refresh } = useResource<Settings>(
    "/interview-workflow/settings/asr",
  );
  useEffect(() => {
    if (location.hash !== "#asr" || loading) return;
    const frame = requestAnimationFrame(() => {
      section.current?.focus({ preventScroll: true });
      section.current?.scrollIntoView({ behavior: "instant", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, loading]);
  if (user?.role !== "admin") return null;
  return (
    <section id="asr" ref={section} tabIndex={-1} aria-label="语音转写配置">
      {data ? (
        <SettingsForm
          initial={data}
          onSaved={refresh}
          onRefresh={refresh}
          refreshing={loading}
        />
      ) : (
        <Card title="语音转写配置" loading={loading}>
          {error && (
            <Alert
              type="error"
              showIcon
              title={error}
              action={<Button onClick={refresh}>重试</Button>}
            />
          )}
        </Card>
      )}
      {data && error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={refresh}>重试</Button>}
          style={{ marginTop: 12 }}
        />
      )}
    </section>
  );
}
