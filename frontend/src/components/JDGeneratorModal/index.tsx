import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Modal, Segmented, Space, Spin, Tag, Typography, message } from 'antd';
import { CheckOutlined, ReloadOutlined, SendOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import request from '../../utils/request';
import { getErrorMessage } from '../../utils/errors';
import { JD_TEXT_LIMIT, parseJDDraft, readJDStream } from '../../utils/jdStream';
import type { JDDraft } from '../../utils/jdStream';
import './style.css';

const { Text } = Typography;

interface JDGeneratorModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (description: string, requirements: string) => void;
  title: string;
  department?: string;
  location?: string;
  salary_range?: string;
  position_type?: string;
  current_description?: string;
  current_requirements?: string;
  generationRequirements: string;
  onGenerationRequirementsChange: (value: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const positionTypes: Record<string, string> = {
  full_time: '全职', part_time: '兼职', contract: '合同', internship: '实习',
};

const JDGeneratorModal: React.FC<JDGeneratorModalProps> = (props) => {
  const [draft, setDraft] = useState<JDDraft>({
    description: props.current_description || '',
    requirements: props.current_requirements || '',
  });
  const [previousDraft, setPreviousDraft] = useState<JDDraft | null>(null);
  const keywords = props.generationRequirements;
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [operation, setOperation] = useState<'generate' | 'revise' | null>(null);
  const [mode, setMode] = useState('预览');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [received, setReceived] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const chatRef = useRef<HTMLTextAreaElement>(null);
  const busy = operation !== null;
  const hasDraft = Boolean(draft.description || draft.requirements);
  const canConfirm = Boolean(draft.description.trim() && draft.requirements.trim())
    && draft.description.length <= JD_TEXT_LIMIT && draft.requirements.length <= JD_TEXT_LIMIT;

  useEffect(() => () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  const stop = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setOperation(null);
    setNotice('已停止生成，当前草稿已保留。');
  };

  const close = () => {
    activeRequest.current?.abort();
    props.onCancel();
  };

  const run = async (kind: 'generate' | 'revise') => {
    if (activeRequest.current) return;
    const instruction = chatInput.trim();
    if (kind === 'revise' && !instruction) return;
    if (!props.title.trim()) {
      setError('请先填写岗位名称');
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    setOperation(kind);
    setError('');
    setNotice('');
    setReceived(0);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120000);

    try {
      const context = {
        title: props.title.trim(), department: props.department || '',
        location: props.location || '', salary_range: props.salary_range || '',
        position_type: props.position_type || null, keywords,
        current_description: draft.description, current_requirements: draft.requirements,
      };
      const history: ChatMessage[] = [...chatMessages, { role: 'user', content: instruction }];
      const token = localStorage.getItem('token');
      const response = await fetch(`${String(request.defaults.baseURL).replace(/\/$/, '')}/positions/${kind === 'generate' ? 'generate-jd-stream' : 'chat-jd-stream'}`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(kind === 'generate' ? context : { ...context, messages: history.slice(-39) }),
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('登录已过期，请重新登录后重试。当前草稿仍保留在此窗口。');
        if (response.status === 403) throw new Error('当前账号没有生成 JD 的权限，请联系管理员');
        const detail = await response.json().catch(() => null);
        throw new Error(getErrorMessage(detail, `AI 请求失败（${response.status}），请重试`));
      }
      const result = await readJDStream(response, setReceived);
      if (activeRequest.current !== controller || controller.signal.aborted) return;
      setPreviousDraft({ ...draft });
      setDraft(result);
      setMode('预览');
      if (kind === 'generate') {
        setChatMessages([]);
      } else {
        setChatMessages([...history, { role: 'assistant' as const, content: JSON.stringify(result) }].slice(-38));
        setChatInput('');
      }
      setNotice('草稿已更新，请检查后采纳。采纳后仍需保存岗位。');
    } catch (failure) {
      if (activeRequest.current !== controller) return;
      if (timedOut) setError('AI 生成超时，当前草稿已保留，请稍后重试或精简要求');
      else if (!controller.signal.aborted) setError(getErrorMessage(failure, 'AI 生成失败，当前草稿已保留，请重试'));
    } finally {
      window.clearTimeout(timer);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setOperation(null);
        if (kind === 'revise') chatRef.current?.focus();
      }
    }
  };

  const confirm = () => {
    try {
      const result = parseJDDraft(draft);
      props.onConfirm(result.description, result.requirements);
      message.success('已填入表单，请保存岗位');
      close();
    } catch (failure) {
      setError(getErrorMessage(failure, '请检查岗位职责和任职要求'));
    }
  };

  return (
    <Modal
      title="AI 岗位 JD 助手"
      open={props.visible}
      onCancel={close}
      width={900}
      zIndex={1100}
      className="jd-assistant"
      styles={{ body: { maxHeight: 'min(68vh, 760px)', overflowY: 'auto', scrollbarGutter: 'stable' } }}
      footer={
        <Space wrap>
          {previousDraft && <Button icon={<UndoOutlined />} disabled={busy} onClick={() => {
            setDraft(previousDraft);
            setPreviousDraft(null);
            setChatMessages([]);
            setError('');
            setNotice('已恢复上一版草稿。');
          }}>恢复上一版</Button>}
          {busy ? <Button icon={<StopOutlined />} onClick={stop}>停止生成</Button> : (
            <Button icon={<ReloadOutlined />} onClick={() => void run('generate')}>
              {hasDraft ? '生成新版本' : '开始生成'}
            </Button>
          )}
          <Button onClick={close}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} disabled={busy || !canConfirm} onClick={confirm}>
            采纳并填入表单
          </Button>
        </Space>
      }
    >
      <div className="jd-context">
        <Text strong>{props.title}</Text>
        <Space wrap size={[4, 8]}>
          {[props.department, props.location, props.salary_range, positionTypes[props.position_type || '']].filter(Boolean)
            .map((label, index) => <Tag key={`${label}-${index}`}>{label}</Tag>)}
        </Space>
        <Text type="secondary">结合填写的岗位要求、岗位信息和现有内容生成草稿，检查并采纳后保存岗位。</Text>
      </div>
      <div className="jd-instructions">
        <label htmlFor="jd-keywords">岗位要求（辅助 AI 生成 JD）</label>
        <Input.TextArea
          id="jd-keywords" value={keywords} onChange={(event) => props.onGenerationRequirementsChange(event.target.value)}
          placeholder="例如：面向企业客户，重点要求 React 和 TypeScript，强调跨团队协作；不限制学历。"
          autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} showCount disabled={busy}
          style={{ resize: 'none' }}
        />
      </div>
      {error && <Alert type="error" showIcon title={error} className="jd-feedback" />}
      <div role="status" aria-live="polite" className="jd-status">
        {busy ? <Space><Spin size="small" /><Text>{operation === 'revise' ? '正在按修改意见更新草稿' : '正在生成岗位职责和任职要求'}{received > 0 ? '，已收到内容…' : '…'}</Text></Space> : <Text type="secondary">{notice}</Text>}
      </div>
      {hasDraft ? <>
        <div className="jd-preview-toolbar">
          <Text strong>当前草稿</Text>
          <Segmented aria-label="草稿查看方式" value={mode} onChange={setMode} options={['预览', '编辑']} disabled={busy} />
        </div>
        <div className="jd-draft-grid" aria-busy={busy}>
          {([['description', '岗位职责'], ['requirements', '任职要求']] as const).map(([field, label]) => (
            <Card key={field} title={label} size="small">
              {mode === '编辑' ? <Input.TextArea
                aria-label={`编辑${label}`} value={draft[field]} disabled={busy}
                autoSize={{ minRows: 8, maxRows: 16 }} maxLength={JD_TEXT_LIMIT} showCount
                style={{ resize: 'none' }}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              /> : <div className="jd-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft[field] || '暂无内容，请生成或编辑补充。'}</ReactMarkdown></div>}
            </Card>
          ))}
        </div>
        <div className="jd-revision">
          <label htmlFor="jd-revision">继续修改</label>
          {chatMessages.length > 0 && <div className="jd-history">
            {chatMessages.map((entry, index) => <p key={index}><Text type="secondary">{entry.role === 'user' ? '修改要求：' : 'AI：'}</Text>{entry.role === 'user' ? entry.content : '已按要求更新草稿。'}</p>)}
          </div>}
          <Input.TextArea
            ref={(element) => { chatRef.current = element?.resizableTextArea?.textArea || null; }}
            id="jd-revision" value={chatInput} onChange={(event) => setChatInput(event.target.value)}
            placeholder="例如：将职责精简到 5 条，区分必备技能和加分项。Enter 发送，Shift+Enter 换行。"
            autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} showCount disabled={busy}
            style={{ resize: 'none' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                void run('revise');
              }
            }}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={() => void run('revise')} disabled={busy || !chatInput.trim()}>
            按要求修改
          </Button>
        </div>
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="补充招聘要求后，点击「开始生成」查看 JD 草稿。" />}
    </Modal>
  );
};

export default JDGeneratorModal;
