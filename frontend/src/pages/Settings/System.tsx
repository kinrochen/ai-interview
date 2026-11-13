import ASRSettingsCard from "../Recruitment/ASRSettings";
import PageHeader from "../../components/PageHeader";
import React, { useEffect, useState, useRef } from 'react';
import { Button, Card, Form, Input, Space, Typography, message, Result, Switch, InputNumber, Divider, Tabs, Alert, Tag, Tooltip } from 'antd';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Text } = Typography;

type SystemSettings = {
  llm_base_url?: string | null;
  llm_model: string;
  llm_api_key_set: boolean;
  llm_api_key_last4?: string | null;
};

type MailSettings = {
  smtp_host?: string | null;
  smtp_port: number;
  smtp_username?: string | null;
  smtp_password_set: boolean;
  mail_from?: string | null;
  mail_from_name: string;
  mail_enabled: boolean;
  frontend_url?: string | null;
};

type PromptConfigItem = {
  system: string;
  user: string;
};

type PromptConfigs = {
  prompts: Record<string, PromptConfigItem>;
};

type PromptVariable = {
  name: string;
  description: string;
};

type PromptVariablesResponse = {
  variables_by_prompt: Record<string, PromptVariable[]>;
  all_variables: Record<string, string>;
};

const promptNames: Record<string, string> = {
  generate_jd: 'JD生成',
  analyze_resume: '简历分析',
  generate_resume_markdown: '简历Markdown生成',
  generate_interview_questions: '面试题目生成',
  generate_interview_evaluation: '面试评价生成',
  generate_interview_evaluation_from_transcript: '转写评价生成',
  generate_coding_test_evaluation: '笔试代码评价',

};

const SystemSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [mailForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);
  const [meta, setMeta] = useState<SystemSettings | null>(null);
  const [mailMeta, setMailMeta] = useState<MailSettings | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [editingMailPassword, setEditingMailPassword] = useState(false);
  const role = (user as any)?.role?.value ?? (user as any)?.role;

  // 提示词配置相关状态
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfigs | null>(null);
  const [activePromptKey, setActivePromptKey] = useState('generate_jd');
  const [promptForm] = Form.useForm();
  const [promptVariables, setPromptVariables] = useState<PromptVariablesResponse | null>(null);
  const userPromptRef = useRef<any>(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = (await request.get('/settings/system')) as SystemSettings;
      setMeta(res);
      form.setFieldsValue({
        llm_base_url: res.llm_base_url || undefined,
        llm_model: res.llm_model || 'qwen3.5-plus',
        llm_api_key: '',
      });
      setEditingKey(false);
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 404) {
        message.error('系统设置接口不存在：请确认后端已更新并重启');
      } else if (status === 403) {
        message.error('无权限访问系统设置');
      } else {
        message.error('获取系统设置失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchMailSettings = async () => {
    setMailLoading(true);
    try {
      const res = (await request.get('/settings/mail')) as MailSettings;
      setMailMeta(res);
      mailForm.setFieldsValue({
        smtp_host: res.smtp_host || undefined,
        smtp_port: res.smtp_port || 465,
        smtp_username: res.smtp_username || undefined,
        smtp_password: '',
        mail_from: res.mail_from || undefined,
        mail_from_name: res.mail_from_name || '招聘系统',
        mail_enabled: res.mail_enabled || false,
        frontend_url: res.frontend_url || undefined,
      });
      setEditingMailPassword(false);
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 404) {
        message.error('邮件设置接口不存在：请确认后端已更新并重启');
      } else if (status === 403) {
        message.error('无权限访问邮件设置');
      } else {
        message.error('获取邮件设置失败');
      }
    } finally {
      setMailLoading(false);
    }
  };

  const fetchPromptConfigs = async () => {
    setPromptLoading(true);
    try {
      const res = (await request.get('/settings/prompts')) as PromptConfigs;
      setPromptConfigs(res);
      // 设置当前选中提示词的表单值
      const currentPrompt = res.prompts[activePromptKey];
      if (currentPrompt) {
        promptForm.setFieldsValue({
          system: currentPrompt.system,
          user: currentPrompt.user,
        });
      }
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 404) {
        message.error('提示词配置接口不存在：请确认后端已更新并重启');
      } else if (status === 403) {
        message.error('无权限访问提示词配置');
      } else {
        message.error('获取提示词配置失败');
      }
    } finally {
      setPromptLoading(false);
    }
  };

  const fetchPromptVariables = async () => {
    try {
      const res = (await request.get('/settings/prompts/variables')) as PromptVariablesResponse;
      setPromptVariables(res);
    } catch (e) {
      console.error('获取提示词变量失败', e);
    }
  };

  const insertVariable = (variableName: string) => {
    const variableText = `{${variableName}}`;
    const textarea = userPromptRef.current?.resizableTextArea?.textArea;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = promptForm.getFieldValue('user') || '';
      const newValue = currentValue.substring(0, start) + variableText + currentValue.substring(end);
      promptForm.setFieldsValue({ user: newValue });
      // 设置光标位置到插入文本之后
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + variableText.length;
      }, 0);
    } else {
      // 如果无法获取 textarea，则追加到末尾
      const currentValue = promptForm.getFieldValue('user') || '';
      promptForm.setFieldsValue({ user: currentValue + variableText });
    }
  };

  useEffect(() => {
    if (role !== 'admin') return;
    fetchSettings();
    fetchMailSettings();
    fetchPromptConfigs();
    fetchPromptVariables();
  }, [role, form, mailForm]);

  // 当切换 Tab 时更新表单值
  useEffect(() => {
    if (promptConfigs && promptConfigs.prompts[activePromptKey]) {
      promptForm.setFieldsValue({
        system: promptConfigs.prompts[activePromptKey].system,
        user: promptConfigs.prompts[activePromptKey].user,
      });
    }
  }, [activePromptKey, promptConfigs, promptForm]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload: any = {
        llm_base_url: values.llm_base_url || null,
        llm_model: values.llm_model,
      };
      if (values.llm_api_key && values.llm_api_key.trim()) {
        payload.llm_api_key = values.llm_api_key.trim();
      }
      setSaving(true);
      await request.put('/settings/system', payload);
      form.setFieldsValue({ llm_api_key: '' });
      await fetchSettings();
      message.success('模型配置已保存');
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 404) {
        message.error('系统设置接口不存在：请确认后端已更新并重启');
      } else if (status === 403) {
        message.error('无权限保存系统设置');
      } else if (status === 400) {
        message.error((e as any)?.response?.data?.detail || '参数不合法');
      } else {
        message.error('保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const saveMail = async () => {
    try {
      const values = await mailForm.validateFields();
      const payload: any = {
        smtp_host: values.smtp_host || null,
        smtp_port: values.smtp_port || 465,
        smtp_username: values.smtp_username || null,
        mail_from: values.mail_from || null,
        mail_from_name: values.mail_from_name || '招聘系统',
        mail_enabled: values.mail_enabled || false,
        frontend_url: values.frontend_url || null,
      };
      if (values.smtp_password && values.smtp_password.trim()) {
        payload.smtp_password = values.smtp_password.trim();
      }
      setMailSaving(true);
      await request.put('/settings/mail', payload);
      mailForm.setFieldsValue({ smtp_password: '' });
      await fetchMailSettings();
      message.success('邮件配置已保存');
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 404) {
        message.error('邮件设置接口不存在：请确认后端已更新并重启');
      } else if (status === 403) {
        message.error('无权限保存邮件设置');
      } else if (status === 400) {
        message.error((e as any)?.response?.data?.detail || '参数不合法');
      } else {
        message.error('保存失败');
      }
    } finally {
      setMailSaving(false);
    }
  };

  const savePrompt = async () => {
    try {
      const values = await promptForm.validateFields();

      // 检查是否存在未知变量
      const userPrompt = values.user || '';
      const variablePattern = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
      const matches = userPrompt.matchAll(variablePattern);
      const usedVariables = Array.from(matches, m => m[1]);

      const allowedVariables = promptVariables?.variables_by_prompt[activePromptKey]?.map(v => v.name) || [];
      const unknownVariables = usedVariables.filter(v => !allowedVariables.includes(v));

      if (unknownVariables.length > 0) {
        message.warning(`提示词中包含未知变量: ${unknownVariables.map(v => `{${v}}`).join(', ')}，请检查是否填写正确`);
        return;
      }

      setPromptSaving(true);
      await request.put(`/settings/prompts/${activePromptKey}`, {
        system: values.system,
        user: values.user,
      });
      await fetchPromptConfigs();
      message.success('提示词配置已保存');
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 404) {
        message.error('提示词配置接口不存在');
      } else if (status === 403) {
        message.error('无权限保存提示词配置');
      } else {
        message.error('保存失败');
      }
    } finally {
      setPromptSaving(false);
    }
  };

  const testMail = async () => {
    try {
      await request.post('/settings/mail/test');
      message.success('邮件配置有效');
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 400) {
        message.error((e as any)?.response?.data?.detail || '邮件配置不完整或未启用');
      } else {
        message.error('测试失败');
      }
    }
  };

  if (role !== 'admin') {
    return (
      <Result
        status="403"
        title="无权限访问"
        subTitle="系统设置仅管理员可配置"
      />
    );
  }

  const promptTabs = Object.keys(promptConfigs?.prompts || {}).map((key) => ({
    key,
    label: promptNames[key] || key,
    children: (
      <Form noValidate form={promptForm} layout="vertical">
        <Alert
          message="注意：修改提示词后立即生效，请谨慎操作"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form.Item
          name="system"
          label="System Prompt"
          rules={[{ required: true, message: '请输入 System Prompt' }]}
        >
          <Input.TextArea
            rows={3}
            placeholder="系统提示词，定义 AI 的角色和行为"
          />
        </Form.Item>
        <Form.Item
          name="user"
          label="User Prompt"
          rules={[{ required: true, message: '请输入 User Prompt' }]}
        >
          <Input.TextArea
            ref={userPromptRef}
            rows={12}
            placeholder="用户提示词模板，包含具体任务指令"
          />
        </Form.Item>
        {/* 可用变量列表 */}
        {promptVariables && promptVariables.variables_by_prompt[key] && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ marginRight: 8 }}>可用变量：</Text>
            <div style={{ marginTop: 8 }}>
              {promptVariables.variables_by_prompt[key].map((variable) => (
                <Tooltip key={variable.name} title={variable.description}>
                  <Tag
                    color="blue"
                    style={{ cursor: 'pointer', marginBottom: 4 }}
                    onClick={() => insertVariable(variable.name)}
                  >
                    {`{${variable.name}}`}
                  </Tag>
                </Tooltip>
              ))}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>点击变量可插入到 User Prompt 中</Text>
          </div>
        )}
        <Button type="primary" onClick={savePrompt} loading={promptSaving}>
          保存当前提示词
        </Button>
      </Form>
    ),
  }));

  return (
    <div>
      <PageHeader title="系统设置" description="配置 AI 模型、语音转写、邮件服务和提示词参数。" />

      <Card
        title="模型配置"
        loading={loading}
        extra={
          <Space>
            <Button onClick={fetchSettings}>刷新</Button>
            <Button type="primary" onClick={save} loading={saving}>保存</Button>
          </Space>
        }
      >
        <Form noValidate form={form} layout="vertical" autoComplete="off">
          <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} />
          <input type="password" name="password" autoComplete="current-password" style={{ display: 'none' }} />
          <Form.Item name="llm_base_url" label="Base URL">
            <Input placeholder="例如：https://dashscope.aliyuncs.com/compatible-mode/v1" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="llm_model"
            label="Model"
            rules={[{ required: true, message: '请输入 Model' }]}
          >
            <Input placeholder="例如：qwen-plus / qwen3.5-plus" autoComplete="off" name="llm_model_field" />
          </Form.Item>

          <Form.Item
            name="llm_api_key"
            label="API Key"
            extra={
              <Space direction="vertical" size={4}>
                <Text type="secondary">
                  {meta?.llm_api_key_set
                    ? `已设置${meta.llm_api_key_last4 ? `（末 4 位：${meta.llm_api_key_last4}）` : ''}，不会回显完整 Key`
                    : '未设置，请先配置 API Key'}
                </Text>
                {meta?.llm_api_key_set && !editingKey ? (
                  <Button type="link" onClick={() => setEditingKey(true)} style={{ padding: 0, height: 'auto' }}>
                    更换 API Key
                  </Button>
                ) : null}
              </Space>
            }
            rules={[
              {
                validator: async (_, value) => {
                  const trimmed = (value || '').trim();
                  if (!meta?.llm_api_key_set) {
                    if (!trimmed) throw new Error('请先配置 API Key');
                    return;
                  }
                  if (editingKey && !trimmed) throw new Error('请输入新的 API Key');
                },
              },
            ]}
          >
            <Input.Password
              placeholder={meta?.llm_api_key_set && !editingKey ? '已设置（不会回显）' : '输入后会覆盖当前 Key'}
              autoComplete="new-password"
              name="llm_api_key_field"
              disabled={!!(meta?.llm_api_key_set && !editingKey)}
            />
          </Form.Item>
        </Form>
      </Card>

      <Divider />
      <ASRSettingsCard />
      <Divider />

      <Card
        title="邮件服务配置"
        loading={mailLoading}
        extra={
          <Space>
            <Button onClick={testMail}>测试连接</Button>
            <Button onClick={fetchMailSettings}>刷新</Button>
            <Button type="primary" onClick={saveMail} loading={mailSaving}>保存</Button>
          </Space>
        }
      >
        <Form noValidate form={mailForm} layout="vertical" autoComplete="off">
          <Form.Item
            name="mail_enabled"
            label="启用邮件通知"
            valuePropName="checked"
            extra={<Text type="secondary">开启后，创建面试和确认结果时会自动发送邮件通知</Text>}
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <Form.Item
            name="smtp_host"
            label="SMTP 服务器地址"
            rules={[{ required: true, message: '请输入 SMTP 服务器地址' }]}
          >
            <Input placeholder="例如：smtp.qq.com" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="smtp_port"
            label="SMTP 端口"
            rules={[{ required: true, message: '请输入 SMTP 端口' }]}
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="通常为 465 或 587" />
          </Form.Item>

          <Form.Item
            name="smtp_username"
            label="SMTP 用户名"
            rules={[{ required: true, message: '请输入 SMTP 用户名' }]}
          >
            <Input placeholder="通常是邮箱地址" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="smtp_password"
            label="SMTP 密码/授权码"
            extra={
              <Space direction="vertical" size={4}>
                <Text type="secondary">
                  {mailMeta?.smtp_password_set
                    ? '已设置密码，不会回显'
                    : '未设置，请输入 SMTP 密码或授权码'}
                </Text>
                {mailMeta?.smtp_password_set && !editingMailPassword ? (
                  <Button type="link" onClick={() => setEditingMailPassword(true)} style={{ padding: 0, height: 'auto' }}>
                    更换密码
                  </Button>
                ) : null}
              </Space>
            }
            rules={[
              {
                validator: async (_, value) => {
                  if (!mailMeta?.smtp_password_set) {
                    if (!(value || '').trim()) throw new Error('请先配置 SMTP 密码');
                    return;
                  }
                  if (editingMailPassword && !(value || '').trim()) throw new Error('请输入新的密码');
                },
              },
            ]}
          >
            <Input.Password
              placeholder={mailMeta?.smtp_password_set && !editingMailPassword ? '已设置（不会回显）' : '输入后会覆盖当前密码'}
              autoComplete="new-password"
              disabled={!!(mailMeta?.smtp_password_set && !editingMailPassword)}
            />
          </Form.Item>

          <Form.Item
            name="mail_from"
            label="发件人邮箱"
            rules={[
              { required: true, message: '请输入发件人邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input placeholder="发件人邮箱地址" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="mail_from_name"
            label="发件人名称"
          >
            <Input placeholder="例如：招聘系统" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="frontend_url"
            label="前端访问地址"
            extra={<Text type="secondary">用于生成邮件中的链接，如Offer确认链接。请填写完整的访问地址，如：https://hr.example.com</Text>}
          >
            <Input placeholder="例如：http://localhost:5173 或 https://hr.example.com" autoComplete="off" />
          </Form.Item>
        </Form>
      </Card>

      <Divider />

      <Card
        title="提示词配置"
        loading={promptLoading}
        extra={
          <Space>
            <Button onClick={fetchPromptConfigs}>刷新</Button>
          </Space>
        }
      >
        <Tabs
          activeKey={activePromptKey}
          onChange={setActivePromptKey}
          items={promptTabs}
        />
      </Card>
    </div>
  );
};

export default SystemSettingsPage;