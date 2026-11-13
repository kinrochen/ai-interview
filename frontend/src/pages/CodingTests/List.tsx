import PageHeader from '../../components/PageHeader';
import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message, Tooltip, Typography, Popconfirm, InputNumber, Divider, Tabs, Empty, Descriptions, Collapse, Radio, Checkbox } from 'antd';
import { PlusOutlined, LinkOutlined, SendOutlined, StopOutlined, EyeOutlined, EditOutlined, ImportOutlined, DeleteOutlined, ArrowLeftOutlined, UserOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, CodeOutlined, FileTextOutlined, RobotOutlined, MinusCircleOutlined, SaveOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeEditor from '../../components/CodeEditor';

const { TextArea } = Input;
const { Text } = Typography;

const starterCodeByLanguage: Record<string, string> = {
  javascript: `function solution() {
  return null;
}
`,
  python: `def solution(*args):
  return None
`,
  java: `public class Solution {
  public static Object solution(Object... args) {
    return null;
  }
}
`,
};

const defaultTestCases = [
  { input: [[1, 2, 3], 3], expected: 2 },
  { input: [[1, 2, 3], 2], expected: 1 }
];

const testTypeLabels: Record<string, { label: string; color: string }> = {
  algorithm: { label: '算法', color: 'blue' },
  choice: { label: '选择题', color: 'green' },
  essay: { label: '简答题', color: 'orange' },
};

const CodingTestsList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importingLeetcode, setImportingLeetcode] = useState(false);
  const [submissionsOpen, setSubmissionsOpen] = useState(false);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [starterCodeLanguage, setStarterCodeLanguage] = useState('javascript');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [questionBanks, setQuestionBanks] = useState<any[]>([]);
  const [testType, setTestType] = useState<string>('algorithm');
  const [editingQuestions, setEditingQuestions] = useState<any[]>([]);
  const [questionsModalOpen, setQuestionsModalOpen] = useState(false);
  const [savingQuestions, setSavingQuestions] = useState(false);

  const fetchList = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await request.get('/coding-tests');
      setData(res);
    } catch (e) {
      if (!silent) message.error('获取笔试列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchQuestionBanks = async () => {
    try {
      const res = await request.get('/question-banks');
      setQuestionBanks(res || []);
    } catch (e) {
      console.error('获取题库列表失败');
    }
  };

  useEffect(() => {
    fetchList();
    fetchQuestionBanks();
  }, []);

  useEffect(() => {
    const hasGenerating = data.some(item => 
      item.test_type !== 'algorithm' && item.question_generation_status === 'generating'
    );
    if (!hasGenerating) return;
    
    const timer = setInterval(() => {
      fetchList(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [data]);

  const handleCreate = () => {
    form.resetFields();
    setEditingId(null);
    setStarterCodeLanguage('javascript');
    setTestType('algorithm');
    form.setFieldsValue({
      leetcode_url: '',
      test_type: 'algorithm',
      language: 'javascript',
      difficulty: 'intermediate',
      status: 'draft',
      starter_code: starterCodeByLanguage.javascript,
      test_cases: JSON.stringify(defaultTestCases, null, 2),
      duration_minutes: 60,
      question_count: 10,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      
      let testCases: any[] = [];
      if (values.test_type === 'algorithm') {
        try {
          testCases = values.test_cases ? JSON.parse(values.test_cases) : [];
        } catch (e) {
          message.error('测试用例 JSON 格式不正确');
          setSubmitting(false);
          return;
        }
      }
      
      const payload: any = {
        title: values.title,
        description: values.description,
        test_type: values.test_type,
        difficulty: values.difficulty,
        duration_minutes: values.duration_minutes,
        status: values.status,
      };

      if (values.test_type === 'algorithm') {
        payload.language = values.language;
        payload.starter_code = values.starter_code;
        payload.test_cases = testCases;
        payload.time_limit_ms = values.time_limit_ms;
        payload.memory_limit_mb = values.memory_limit_mb;
      } else {
        payload.question_bank_id = values.question_bank_id;
      }

      if (editingId) {
        await request.put(`/coding-tests/${editingId}`, payload);
        message.success('更新成功');
        setOpen(false);
        fetchList();
      } else {
        const created = await request.post('/coding-tests', payload);
        message.success('创建成功，正在生成题目...');
        setOpen(false);
        fetchList();
        
        if (values.test_type !== 'algorithm' && values.question_bank_id) {
          try {
            await request.post(`/coding-tests/${created.id}/generate-questions`, null, {
              params: {
                question_bank_id: values.question_bank_id,
                test_type: values.test_type,
                count: values.question_count || 10,
              },
            });
            fetchList();
          } catch (e) {
            console.error('生成题目失败', e);
          }
        }
      }
    } catch (e) {
      if ((e as any)?.errorFields) return;
      message.error(editingId ? '更新失败' : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLanguageChange = (lang: string) => {
    const current = form.getFieldValue('starter_code');
    const prevTemplate = starterCodeByLanguage[starterCodeLanguage] || '';
    const nextTemplate = starterCodeByLanguage[lang] || '';
    if (!current || current === prevTemplate) {
      form.setFieldsValue({ starter_code: nextTemplate });
    }
    setStarterCodeLanguage(lang);
  };

  const handleTestTypeChange = (type: string) => {
    setTestType(type);
    form.setFieldsValue({ test_type: type });
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/public/coding-tests/${token}`;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(url);
        message.success('链接已复制');
      } catch (e) {
        message.info(url);
      }
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        message.success('链接已复制');
      } catch (err) {
        message.info(url);
      }
      document.body.removeChild(textArea);
    }
  };

  const publish = (id: string) => {
    Modal.confirm({
      title: '发布笔试',
      content: '发布后可将链接发送给候选人进行答题。',
      okText: '发布',
      cancelText: '取消',
      onOk: async () => {
        try {
          await request.post(`/coding-tests/${id}/publish`);
          message.success('已发布');
          fetchList();
        } catch (e) {
          message.error('发布失败');
        }
      },
    });
  };

  const close = (id: string) => {
    Modal.confirm({
      title: '关闭笔试',
      content: '关闭后候选人将无法继续进入答题页面。',
      okText: '关闭',
      cancelText: '取消',
      onOk: async () => {
        try {
          await request.post(`/coding-tests/${id}/close`);
          message.success('已关闭');
          fetchList();
        } catch (e) {
          message.error('关闭失败');
        }
      },
    });
  };

  const openSubmissions = async (record: any) => {
    setSelectedTest(record);
    setSelectedSubmission(null);
    setSubmissionsOpen(true);
    setSubmissionsLoading(true);
    try {
      const res = await request.get(`/coding-tests/${record.id}/submissions`);
      setSubmissions(res || []);
    } catch (e) {
      message.error('获取提交列表失败');
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const openSubmissionDetail = async (submissionId: string) => {
    try {
      const res = await request.get(`/coding-tests/submissions/${submissionId}`);
      setSelectedSubmission(res);
    } catch (e) {
      message.error('获取提交详情失败');
    }
  };

  const handleEdit = async (record: any) => {
    try {
      const res = await request.get(`/coding-tests/${record.id}`);
      setEditingId(record.id);
      const type = res.test_type || 'algorithm';
      setTestType(type);
      const lang = res.language || 'javascript';
      setStarterCodeLanguage(lang);
      form.resetFields();
      form.setFieldsValue({
        leetcode_url: '',
        title: res.title,
        description: res.description,
        test_type: type,
        difficulty: res.difficulty || 'intermediate',
        language: lang,
        status: res.status || 'draft',
        time_limit_ms: res.time_limit_ms ?? 3000,
        memory_limit_mb: res.memory_limit_mb ?? 256,
        starter_code: res.starter_code || starterCodeByLanguage[lang] || '',
        test_cases: JSON.stringify(res.test_cases || [], null, 2),
        question_bank_id: res.question_bank_id,
        duration_minutes: res.duration_minutes || 60,
        question_count: res.questions?.length || 10,
      });
      setOpen(true);
    } catch (e) {
      message.error('获取笔试详情失败');
    }
  };

  const importFromLeetCode = async () => {
    const url = form.getFieldValue('leetcode_url');
    if (!url) {
      message.error('请先粘贴力扣题目链接');
      return;
    }
    setImportingLeetcode(true);
    try {
      const res = await request.post('/coding-tests/import/leetcode', { url });
      if (res?.title) form.setFieldsValue({ title: res.title });
      if (res?.description) form.setFieldsValue({ description: res.description });
      if (res?.difficulty) form.setFieldsValue({ difficulty: res.difficulty });
      if (Array.isArray(res?.test_cases)) {
        form.setFieldsValue({ test_cases: JSON.stringify(res.test_cases, null, 2) });
      }
      message.success('已导入题目，可继续修改');
    } catch (e) {
      message.error('导入失败，请检查链接是否可访问');
    } finally {
      setImportingLeetcode(false);
    }
  };

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    {
      title: '类型',
      dataIndex: 'test_type',
      key: 'test_type',
      render: (type: string) => {
        const info = testTypeLabels[type] || { label: type, color: 'default' };
        return <Tag color={info.color} style={{ border: 'none' }}>{info.label}</Tag>;
      },
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      render: (v: string, record: any) => {
        if (record.test_type !== 'algorithm') return '-';
        return v ? v.toUpperCase() : '-';
      },
    },
    {
      title: '时长',
      dataIndex: 'duration_minutes',
      key: 'duration_minutes',
      render: (v: number) => v ? `${v}分钟` : '-',
    },
    {
      title: '题目状态',
      dataIndex: 'question_generation_status',
      key: 'question_generation_status',
      render: (s: string, record: any) => {
        if (record.test_type === 'algorithm') {
          return <Tag color="green" style={{ border: 'none' }}>已完成</Tag>;
        }
        const map: any = {
          pending: { text: '等待生成', color: 'default' },
          generating: { text: '生成中', color: 'processing' },
          completed: { text: '已完成', color: 'green' },
          failed: { text: '生成失败', color: 'red' },
        };
        const info = map[s] || { text: s || '等待生成', color: 'default' };
        return <Tag color={info.color} style={{ border: 'none' }}>{info.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const map: any = {
          draft: { text: '草稿', color: 'default' },
          published: { text: '已发布', color: 'green' },
          closed: { text: '已关闭', color: 'red' },
        };
        const info = map[s] || { text: s, color: 'default' };
        return <Tag color={info.color} style={{ border: 'none' }}>{info.text}</Tag>;
      },
    },
    {
      title: '链接',
      key: 'link',
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="复制链接">
            <Button type="text" icon={<LinkOutlined />} onClick={() => copyLink(record.public_token)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="查看提交">
            <Button type="text" icon={<EyeOutlined style={{ color: '#3B82F6' }} />} onClick={() => openSubmissions(record)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          {record.test_type !== 'algorithm' && record.question_generation_status === 'completed' && (
            <Tooltip title="编辑题目">
              <Button type="text" icon={<FileTextOutlined style={{ color: '#8B5CF6' }} />} onClick={() => openQuestionsEditor(record)} />
            </Tooltip>
          )}
          {record.status !== 'published' && record.status !== 'closed' && (
            <Tooltip title="发布">
              <Button type="text" icon={<SendOutlined style={{ color: '#10B981' }} />} onClick={() => publish(record.id)} />
            </Tooltip>
          )}
          {record.status === 'published' && (
            <Tooltip title="关闭">
              <Button type="text" danger icon={<StopOutlined />} onClick={() => close(record.id)} />
            </Tooltip>
          )}
          <Popconfirm title="确定删除此测试？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/coding-tests/${id}`);
      message.success('删除成功');
      fetchList();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的测试');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个测试吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/coding-tests/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个测试`);
          setSelectedRowKeys([]);
          fetchList();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const handleBatchPublish = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要发布的测试');
      return;
    }
    Modal.confirm({
      title: '确认批量发布',
      content: `确定要发布选中的 ${selectedRowKeys.length} 个测试吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.put(`/coding-tests/${id}`, { status: 'published' })));
          message.success(`成功发布 ${selectedRowKeys.length} 个测试`);
          setSelectedRowKeys([]);
          fetchList();
        } catch (error) {
          message.error('批量发布失败');
        }
      },
    });
  };

  const openQuestionsEditor = async (record: any) => {
    try {
      const res = await request.get(`/coding-tests/${record.id}`);
      setSelectedTest(res);
      setEditingQuestions(res.questions || []);
      setQuestionsModalOpen(true);
    } catch (e) {
      message.error('获取题目失败');
    }
  };

  const handleSaveQuestions = async () => {
    if (!selectedTest) return;
    setSavingQuestions(true);
    try {
      await request.put(`/coding-tests/${selectedTest.id}`, {
        questions: editingQuestions,
      });
      message.success('题目保存成功');
      setQuestionsModalOpen(false);
      fetchList();
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSavingQuestions(false);
    }
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    const newQuestions = [...editingQuestions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setEditingQuestions(newQuestions);
  };

  const updateOption = (qIndex: number, optIndex: number, field: string, value: string) => {
    const newQuestions = [...editingQuestions];
    const options = [...(newQuestions[qIndex].options || [])];
    options[optIndex] = { ...options[optIndex], [field]: value };
    newQuestions[qIndex] = { ...newQuestions[qIndex], options };
    setEditingQuestions(newQuestions);
  };

  const addOption = (qIndex: number) => {
    const newQuestions = [...editingQuestions];
    const options = [...(newQuestions[qIndex].options || [])];
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    const nextLabel = labels[options.length] || String(options.length + 1);
    options.push({ label: nextLabel, text: '' });
    newQuestions[qIndex] = { ...newQuestions[qIndex], options };
    setEditingQuestions(newQuestions);
  };

  const removeOption = (qIndex: number, optIndex: number) => {
    const newQuestions = [...editingQuestions];
    const options = [...(newQuestions[qIndex].options || [])];
    options.splice(optIndex, 1);
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    options.forEach((opt, i) => {
      opt.label = labels[i] || String(i + 1);
    });
    newQuestions[qIndex] = { ...newQuestions[qIndex], options };
    setEditingQuestions(newQuestions);
  };

  const addQuestion = () => {
    const newQ = selectedTest?.test_type === 'choice'
      ? {
          id: `q_${Date.now()}`,
          question: '',
          options: [
            { label: 'A', text: '' },
            { label: 'B', text: '' },
            { label: 'C', text: '' },
            { label: 'D', text: '' },
          ],
          correct_answer: 'A',
          is_multiple: false,
          explanation: '',
          score: 10,
        }
      : {
          id: `q_${Date.now()}`,
          question: '',
          reference_answer: '',
          keywords: [],
          max_score: 10,
        };
    setEditingQuestions([...editingQuestions, newQ]);
  };

  const removeQuestion = (index: number) => {
    const newQuestions = editingQuestions.filter((_, i) => i !== index);
    setEditingQuestions(newQuestions);
  };

  return (
    <div>
      <PageHeader title="笔试管理" description="创建在线编程测评，查看候选人的提交与评估结果。" actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>创建笔试</Button>
      } />
      {selectedRowKeys.length > 0 && <div className="filter-toolbar">
        <Space wrap>
          <span>已选 {selectedRowKeys.length} 项</span>
          <Button onClick={handleBatchPublish}>批量发布</Button>
          <Button danger onClick={handleBatchDelete}>批量删除</Button>
          <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </Space>
      </div>}

      <p className="table-overflow-hint">左右滑动表格查看完整笔试信息与操作</p>
      <Table
        scroll={{ x: 1100 }}
        columns={columns as any}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={{ pageSize: 10, showSizeChanger: true }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
      />

      <Modal
        title={selectedTest ? `提交列表：${selectedTest.title}` : '提交列表'}
        open={submissionsOpen}
        onCancel={() => {
          setSubmissionsOpen(false);
          setSelectedSubmission(null);
        }}
        footer={null}
        width={selectedSubmission ? 1100 : 1000}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        {selectedSubmission ? (
          <div>
            <Button 
              type="text" 
              icon={<ArrowLeftOutlined />} 
              onClick={() => setSelectedSubmission(null)}
              style={{ marginBottom: 16 }}
            >
              返回列表
            </Button>
            
            <Card style={{ borderRadius: 12, marginBottom: 16 }}>
              <Descriptions column={4} size="small">
                <Descriptions.Item label={<><UserOutlined /> 候选人</>}>
                  <Text strong>{selectedSubmission.candidate_name || '-'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="邮箱">
                  {selectedSubmission.candidate_email || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={<><ClockCircleOutlined /> 提交时间</>}>
                  {selectedSubmission.created_at ? new Date(selectedSubmission.created_at).toLocaleString() : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="结果">
                  {selectedSubmission.passed ? (
                    <Tag icon={<CheckCircleOutlined />} color="success">通过</Tag>
                  ) : (
                    <Tag icon={<CloseCircleOutlined />} color="error">未通过</Tag>
                  )}
                </Descriptions.Item>
              </Descriptions>
              <div style={{ marginTop: 12 }}>
                <Space size="large">
                  <span>
                    <Text type="secondary">得分：</Text>
                    <Text strong style={{ fontSize: 20, color: selectedSubmission.passed ? '#52c41a' : '#ff4d4f' }}>
                      {selectedSubmission.score ?? 0}
                    </Text>
                  </span>
                  {selectedSubmission.language && (
                    <span>
                      <Text type="secondary">语言：</Text>
                      <Tag style={{ border: 'none' }}>{selectedSubmission.language.toUpperCase()}</Tag>
                    </span>
                  )}
                </Space>
              </div>
            </Card>

            <Tabs
              defaultActiveKey={selectedSubmission.code ? 'code' : 'answers'}
              items={[
                selectedSubmission.code ? {
                  key: 'code',
                  label: <span><CodeOutlined /> 代码</span>,
                  children: (
                    <CodeEditor
                      value={selectedSubmission.code || ''}
                      language={selectedSubmission.language || 'javascript'}
                      height={400}
                      readOnly
                    />
                  ),
                } : null,
                selectedSubmission.answers ? {
                  key: 'answers',
                  label: <span><FileTextOutlined /> 答题详情</span>,
                  children: (
                    <div style={{ maxHeight: 500, overflow: 'auto' }}>
                      {selectedTest?.questions?.map((q: any, i: number) => {
                        const userAnswer = selectedSubmission.answers.find((a: any) => a.question_id === q.id);
                        const isCorrect = userAnswer?.answer === q.correct_answer;
                        const isChoice = selectedTest?.test_type === 'choice';
                        const isEssay = selectedTest?.test_type === 'essay';
                        
                        const evaluation = selectedSubmission.run_result?.evaluations?.find((e: any) => e.question_id === q.id);
                        const questionScore = evaluation?.score;
                        const maxScore = evaluation?.max_score || q.max_score || 10;
                        
                        return (
                          <Card 
                            key={i} 
                            size="small" 
                            style={{ 
                              marginBottom: 12, 
                              borderLeft: `4px solid ${isChoice ? (isCorrect ? '#10B981' : '#EF4444') : (questionScore !== undefined ? (questionScore >= maxScore * 0.6 ? '#10B981' : '#EF4444') : '#9CA3AF')}`,
                              backgroundColor: isChoice ? (isCorrect ? '#F0FDF4' : '#FEF2F2') : (questionScore !== undefined ? (questionScore >= maxScore * 0.6 ? '#F0FDF4' : '#FEF2F2') : '#F9FAFB')
                            }}
                          >
                            <Space direction="vertical" style={{ width: '100%' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text strong>{i + 1}. {q.question}</Text>
                                {isEssay && questionScore !== undefined && (
                                  <Tag color={questionScore >= maxScore * 0.6 ? 'green' : 'orange'} style={{ border: 'none' }}>
                                    得分: {questionScore}/{maxScore}
                                  </Tag>
                                )}
                              </div>
                              
                              {isChoice && q.options && (
                                <div style={{ marginTop: 8 }}>
                                  {q.options.map((opt: any) => {
                                    const isUserChoice = userAnswer?.answer === opt.label;
                                    const isCorrectOption = q.correct_answer === opt.label;
                                    
                                    return (
                                      <div 
                                        key={opt.label}
                                        style={{
                                          padding: '4px 8px',
                                          marginBottom: 4,
                                          borderRadius: 4,
                                          backgroundColor: isCorrectOption ? '#DCFCE7' : (isUserChoice && !isCorrect ? '#FEE2E2' : 'transparent'),
                                          border: isCorrectOption ? '1px solid #10B981' : (isUserChoice && !isCorrect ? '1px solid #EF4444' : '1px solid transparent')
                                        }}
                                      >
                                        <Space>
                                          <Text strong>{opt.label}.</Text>
                                          <Text>{opt.text}</Text>
                                          {isCorrectOption && <Tag color="green" style={{ marginLeft: 8, border: 'none' }}>正确答案</Tag>}
                                          {isUserChoice && !isCorrect && <Tag color="red" style={{ marginLeft: 8, border: 'none' }}>用户选择</Tag>}
                                        </Space>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {!isChoice && (
                                <div style={{ marginTop: 8 }}>
                                  <div style={{ marginBottom: 8 }}>
                                    <Text type="secondary">用户答案：</Text>
                                    <Text>{userAnswer?.answer || '未作答'}</Text>
                                  </div>
                                  {q.reference_answer && (
                                    <div>
                                      <Text type="secondary">参考答案：</Text>
                                      <Text type="success">{q.reference_answer}</Text>
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {q.explanation && (
                                <div style={{ marginTop: 8, padding: '8px 12px', backgroundColor: '#F3F4F6', borderRadius: 4 }}>
                                  <Text type="secondary">解析：{q.explanation}</Text>
                                </div>
                              )}
                            </Space>
                          </Card>
                        );
                      })}
                    </div>
                  ),
                } : null,
                (selectedTest?.test_type === 'algorithm' || selectedTest?.test_type === 'essay') ? {
                  key: 'ai',
                  label: <span><RobotOutlined /> AI 评价</span>,
                  children: selectedSubmission.ai_evaluation ? (
                    <div style={{ maxHeight: 500, overflow: 'auto', padding: '0 8px' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedSubmission.ai_evaluation}</ReactMarkdown>
                    </div>
                  ) : (
                    <Empty description="暂无 AI 评价" style={{ padding: 40 }} />
                  ),
                } : null,
              ].filter(Boolean) as any}
            />
          </div>
        ) : (
          <Table
            loading={submissionsLoading}
            dataSource={submissions}
            rowKey="id"
            pagination={{ pageSize: 10, showSizeChanger: true }}
            size="middle"
            scroll={{ x: 800 }}
            columns={[
              { 
                title: '候选人', 
                dataIndex: 'candidate_name', 
                key: 'candidate_name',
                width: 120,
                render: (v: string) => <Text strong>{v || '-'}</Text>,
              },
              { 
                title: '邮箱', 
                dataIndex: 'candidate_email', 
                key: 'candidate_email',
                width: 200,
                ellipsis: true,
                render: (v: string) => <Tooltip title={v}>{v || '-'}</Tooltip>,
              },
              {
                title: '得分',
                key: 'score',
                width: 80,
                align: 'center',
                sorter: (a: any, b: any) => (a.score ?? 0) - (b.score ?? 0),
                render: (_: any, r: any) => (
                  <Text strong style={{ fontSize: 15, color: r.passed ? '#52c41a' : '#ff4d4f' }}>
                    {r.score ?? 0}
                  </Text>
                ),
              },
              {
                title: '结果',
                key: 'passed',
                width: 100,
                align: 'center',
                filters: [
                  { text: '通过', value: true },
                  { text: '未通过', value: false },
                ],
                onFilter: (value: any, record: any) => record.passed === value,
                render: (_: any, r: any) => r.passed ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">通过</Tag>
                ) : (
                  <Tag icon={<CloseCircleOutlined />} color="error">未通过</Tag>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 100,
                filters: [
                  { text: '已提交', value: 'submitted' },
                  { text: '评价中', value: 'evaluating' },
                  { text: '已评价', value: 'evaluated' },
                ],
                onFilter: (value: any, record: any) => record.status === value,
                render: (s: string) => {
                  const map: any = {
                    submitted: { text: '已提交', color: 'blue' },
                    evaluating: { text: '评价中', color: 'processing' },
                    evaluated: { text: '已评价', color: 'green' },
                  };
                  const info = map[s] || { text: s, color: 'default' };
                  return <Tag color={info.color} style={{ border: 'none' }}>{info.text}</Tag>;
                },
              },
              {
                title: '提交时间',
                dataIndex: 'created_at',
                key: 'created_at',
                width: 170,
                sorter: (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                render: (v: string) => v ? new Date(v).toLocaleString() : '-',
              },
              {
                title: '操作',
                key: 'action',
                width: 100,
                fixed: 'right' as const,
                render: (_: any, r: any) => (
                  <Button type="link" icon={<EyeOutlined />} onClick={() => openSubmissionDetail(r.id)}>
                    详情
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Modal>

      <Modal
        title={editingId ? '编辑笔试' : '创建笔试'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        okText={editingId ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
        width={820}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="test_type" label="笔试类型" rules={[{ required: true }]}>
            <Select onChange={handleTestTypeChange}>
              <Select.Option value="algorithm">算法题</Select.Option>
              <Select.Option value="choice">选择题</Select.Option>
              <Select.Option value="essay">简答题</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：前端开发笔试" />
          </Form.Item>
          
          <Form.Item name="description" label="描述">
            <TextArea rows={3} placeholder="笔试说明（可选）" />
          </Form.Item>

          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="difficulty" label="难度" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: 'junior', label: '初级' },
                  { value: 'intermediate', label: '中级' },
                  { value: 'senior', label: '高级' },
                ]}
              />
            </Form.Item>
            <Form.Item name="duration_minutes" label="时长(分钟)" style={{ flex: 1 }}>
              <InputNumber min={10} max={180} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: 'draft', label: '草稿' },
                  { value: 'published', label: '发布' },
                ]}
              />
            </Form.Item>
          </Space>

          {testType === 'algorithm' && (
            <>
              <Divider>算法题设置</Divider>
              
              <Form.Item name="leetcode_url" label="力扣题目链接">
                <Space.Compact style={{ width: '100%' }}>
                  <Input placeholder="https://leetcode.cn/problems/two-sum/" />
                  <Button icon={<ImportOutlined />} onClick={importFromLeetCode} loading={importingLeetcode}>一键导入</Button>
                </Space.Compact>
              </Form.Item>
              
              <Form.Item name="language" label="语言">
                <Select
                  options={[
                    { value: 'javascript', label: 'JavaScript' },
                    { value: 'python', label: 'Python' },
                    { value: 'java', label: 'Java' },
                  ]}
                  onChange={handleLanguageChange}
                />
              </Form.Item>
              
              <Space style={{ width: '100%' }} size="large">
                <Form.Item name="time_limit_ms" label="时限(ms)" style={{ flex: 1 }}>
                  <Input placeholder="3000" />
                </Form.Item>
                <Form.Item name="memory_limit_mb" label="内存(MB)" style={{ flex: 1 }}>
                  <Input placeholder="256" />
                </Form.Item>
              </Space>
              
              <Form.Item label="初始代码（必须包含 solution 函数）">
                <Form.Item name="starter_code" noStyle getValueFromEvent={(v) => v}>
                  <CodeEditor language={form.getFieldValue('language') || 'javascript'} height={260} />
                </Form.Item>
              </Form.Item>
              
              <Form.Item name="test_cases" label="测试用例（JSON 数组）" extra="格式：[{ input: [args...], expected: any }, ...]">
                <TextArea rows={6} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }} />
              </Form.Item>
            </>
          )}

          {(testType === 'choice' || testType === 'essay') && (
            <>
              <Divider>题目设置</Divider>
              
              <Space style={{ width: '100%' }} size="large">
                <Form.Item name="question_bank_id" label="题库" rules={[{ required: true, message: '请选择题库' }]} style={{ flex: 1 }}>
                  <Select placeholder="请选择题库">
                    {questionBanks.map((bank: any) => (
                      <Select.Option key={bank.id} value={bank.id}>{bank.name}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item name="question_count" label="题目数量" style={{ flex: 1 }}>
                  <InputNumber min={1} max={50} style={{ width: '100%' }} />
                </Form.Item>
              </Space>
              
              <div style={{ color: '#64748B', fontSize: 13 }}>
                创建后将自动从题库随机抽取题目。如题库中没有对应类型的题目，将抽取题库中的所有题目。
              </div>
            </>
          )}
        </Form>
      </Modal>

      <Modal
        title={`编辑题目 - ${selectedTest?.title || ''}`}
        open={questionsModalOpen}
        onCancel={() => setQuestionsModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setQuestionsModalOpen(false)}>取消</Button>,
          <Button key="add" icon={<PlusOutlined />} onClick={addQuestion}>添加题目</Button>,
          <Button key="save" type="primary" icon={<SaveOutlined />} loading={savingQuestions} onClick={handleSaveQuestions}>保存</Button>,
        ]}
        width={900}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        {editingQuestions.length === 0 ? (
          <Empty description="暂无题目，请点击添加题目按钮添加" />
        ) : (
          <Collapse
            accordion
            items={editingQuestions.map((q, qIndex) => ({
              key: qIndex,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <Tag color="blue" style={{ marginRight: 8 }}>第 {qIndex + 1} 题</Tag>
                    <Text ellipsis style={{ maxWidth: 500 }}>{q.question || '未填写题目'}</Text>
                  </span>
                  <Popconfirm title="确定删除此题目？" onConfirm={() => removeQuestion(qIndex)}>
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </div>
              ),
              children: (
                <div style={{ padding: '0 8px' }}>
                  <Form.Item label="题目内容" required>
                    <TextArea
                      rows={2}
                      value={q.question}
                      onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                      placeholder="请输入题目内容"
                    />
                  </Form.Item>

                  {selectedTest?.test_type === 'choice' && (
                    <>
                      <Form.Item label="选项">
                        <div style={{ marginBottom: 8 }}>
                          {(q.options || []).map((opt: any, optIndex: number) => (
                            <div key={optIndex} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                              <Tag color="blue" style={{ width: 28, textAlign: 'center' }}>{opt.label}</Tag>
                              <Input
                                value={opt.text}
                                onChange={(e) => updateOption(qIndex, optIndex, 'text', e.target.value)}
                                placeholder={`选项 ${opt.label} 内容`}
                                style={{ flex: 1 }}
                              />
                              {(q.options || []).length > 2 && (
                                <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removeOption(qIndex, optIndex)} />
                              )}
                            </div>
                          ))}
                          <Button type="dashed" icon={<PlusOutlined />} onClick={() => addOption(qIndex)} style={{ width: '100%' }}>
                            添加选项
                          </Button>
                        </div>
                      </Form.Item>

                      <Form.Item label="正确答案">
                        <Radio.Group
                          value={q.correct_answer}
                          onChange={(e) => updateQuestion(qIndex, 'correct_answer', e.target.value)}
                        >
                          {(q.options || []).map((opt: any) => (
                            <Radio key={opt.label} value={opt.label}>{opt.label}</Radio>
                          ))}
                        </Radio.Group>
                      </Form.Item>

                      <Form.Item label="题目解析">
                        <TextArea
                          rows={2}
                          value={q.explanation}
                          onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                          placeholder="可选，填写答案解析"
                        />
                      </Form.Item>

                      <Form.Item label="分值">
                        <InputNumber
                          min={1}
                          max={100}
                          value={q.score || 10}
                          onChange={(v) => updateQuestion(qIndex, 'score', v || 10)}
                        />
                      </Form.Item>
                    </>
                  )}

                  {selectedTest?.test_type === 'essay' && (
                    <>
                      <Form.Item label="参考答案">
                        <TextArea
                          rows={3}
                          value={q.reference_answer}
                          onChange={(e) => updateQuestion(qIndex, 'reference_answer', e.target.value)}
                          placeholder="请输入参考答案"
                        />
                      </Form.Item>

                      <Form.Item label="关键词（用于自动评分）">
                        <Select
                          mode="tags"
                          value={q.keywords || []}
                          onChange={(v) => updateQuestion(qIndex, 'keywords', v)}
                          placeholder="输入关键词后按回车添加"
                          style={{ width: '100%' }}
                        />
                      </Form.Item>

                      <Form.Item label="满分">
                        <InputNumber
                          min={1}
                          max={100}
                          value={q.max_score || 10}
                          onChange={(v) => updateQuestion(qIndex, 'max_score', v || 10)}
                        />
                      </Form.Item>
                    </>
                  )}
                </div>
              ),
            }))}
          />
        )}
      </Modal>
    </div>
  );
};

export default CodingTestsList;