import PageHeader from '../../components/PageHeader';
import React, { useEffect, useState, useRef } from 'react';
import { Table, Button, Space, message, Tag, Modal, Tooltip, Typography, Form, Select, Upload, Input, DatePicker, InputNumber, Card, Row, Col, Checkbox } from 'antd';
import { PlusOutlined, EyeOutlined, TeamOutlined, DeleteOutlined, UploadOutlined, ReloadOutlined, CloseCircleOutlined, SearchOutlined, UndoOutlined, SolutionOutlined, SyncOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

import { useAuth } from '../../contexts/AuthContext';

const ResumesList: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState([]);
  const [questionBanks, setQuestionBanks] = useState([]);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [interviewModalVisible, setInterviewModalVisible] = useState(false);
  const [interviewRecord, setInterviewRecord] = useState<any>(null);
  const [existingInterviews, setExistingInterviews] = useState<any[]>([]);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailContent, setEmailContent] = useState<any>(null);
  const [createdInterviewId, setCreatedInterviewId] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailForm] = Form.useForm();
  const [pendingInterviewData, setPendingInterviewData] = useState<any>(null);

  const [fileList, setFileList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  
  const [form] = Form.useForm();
  const [interviewForm] = Form.useForm();
  
  const navigate = useNavigate();

  const [searchName, setSearchName] = useState('');
  const [searchStatus, setSearchStatus] = useState<string | undefined>(undefined);

  const fetchResumes = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: any = {};
      if (searchName) params.candidate_name = searchName;
      if (searchStatus) params.status = searchStatus;

      // 如果是面试官，只显示被指派给自己的简历
      if (user?.role === 'interviewer') {
        params.reviewer_id = user.id;
      }

      const res = await request.get('/resumes', { params });
      setData(res);

      // 检查是否有正在解析中的简历
      const hasProcessing = res.some((r: any) => r.parse_status === 'processing');
      setPollingEnabled(hasProcessing);
    } catch (error) {
      if (!silent) message.error('获取简历列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 轮询检查解析状态
  useEffect(() => {
    if (pollingEnabled) {
      pollingRef.current = setInterval(() => {
        fetchResumes(true);
      }, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [pollingEnabled]);

  const fetchPositions = async () => {
    try {
      const res = await request.get('/positions');
      setPositions(res);
    } catch (error) {
      console.error('获取岗位列表失败');
    }
  };

  const fetchQuestionBanks = async () => {
    try {
      const res = await request.get('/question-banks');
      setQuestionBanks(res);
    } catch (error) {
      console.error('获取题库列表失败');
    }
  };

  const [interviewers, setInterviewers] = useState([]);

  const fetchInterviewers = async () => {
    try {
      const res = await request.get('/auth/interviewers');
      setInterviewers(res);
    } catch (error) {
      console.error('获取面试官列表失败');
    }
  };

  useEffect(() => {
    fetchResumes();
    fetchPositions();
    fetchQuestionBanks();
    fetchInterviewers();
  }, []);

  const handleSearch = () => {
    fetchResumes();
  };

  const handleReset = () => {
    setSearchName('');
    setSearchStatus(undefined);
    setLoading(true);
    request.get('/resumes')
      .then(res => {
        setData(res);
        const hasProcessing = res.some((r: any) => r.parse_status === 'processing');
        setPollingEnabled(hasProcessing);
      })
      .catch(() => message.error('获取简历列表失败'))
      .finally(() => setLoading(false));
  };

  const handleCreateInterviewClick = async (record: any) => {
    setInterviewRecord(record);
    interviewForm.resetFields();

    // 获取该候选人已有的面试记录
    try {
      const allInterviews = await request.get('/interviews') as any[];
      const resumeInterviews = allInterviews.filter((i: any) => i.resume_id === record.id);
      setExistingInterviews(resumeInterviews);

      // 检查是否已被录用
      const hiredInterview = resumeInterviews.find((i: any) => i.result === 'hired');
      if (hiredInterview) {
        message.warning('该候选人已被录用，无法安排下一轮面试');
        return;
      }

      // 自动设置下一轮轮次
      const maxRound = resumeInterviews.reduce((max: number, i: any) => Math.max(max, i.round || 1), 0);
      interviewForm.setFieldsValue({
        question_count: 5,
        interview_type: 'onsite',
        interview_category: 'technical',
        round: maxRound + 1
      });
    } catch (error) {
      console.error('获取面试记录失败', error);
      interviewForm.setFieldsValue({
        question_count: 5,
        interview_type: 'onsite',
        round: 1
      });
    }

    setInterviewModalVisible(true);
  };

  const handleInterviewOk = async () => {
    try {
      const values = await interviewForm.validateFields();
      setSubmitting(true);

      // 准备面试数据
      const interviewData = {
        resume_id: interviewRecord.id,
        position_id: interviewRecord.position_id,
        interviewer: '面试小组',
        panel_members: values.panel_members,
        interview_time: values.interview_time ? values.interview_time.toISOString() : new Date().toISOString(),
        question_bank_ids: values.question_bank_ids,
        question_count: values.question_count,
        round: values.round || 1,
        interview_type: values.interview_type || 'onsite',
        interview_category: values.interview_category || 'technical',
        interview_location: values.interview_location,
        meeting_link: values.meeting_link,
        skip_ai_questions: values.skip_ai_questions || false
      };

      // 保存数据供后续创建
      setPendingInterviewData(interviewData);

      // 获取邮件预览（不创建面试）
      try {
        const emailPreview = await request.post('/interviews/email-preview', {
          resume_id: interviewRecord.id,
          position_id: interviewRecord.position_id,
          interview_time: values.interview_time ? values.interview_time.toISOString() : null,
          round: values.round || 1,
          interview_type: values.interview_type || 'onsite',
          interview_category: values.interview_category || 'technical',
          interview_location: values.interview_location,
          meeting_link: values.meeting_link
        });

        setEmailContent(emailPreview);
        emailForm.setFieldsValue({
          subject: emailPreview.subject,
          content: emailPreview.content,
          send_email: true
        });
        setInterviewModalVisible(false);
        setEmailPreviewVisible(true);
      } catch (error) {
        // 如果获取邮件预览失败，直接创建面试
        console.error('获取邮件预览失败', error);
        const res = await request.post('/interviews', {
          ...interviewData,
          skip_email: true
        });
        message.success('面试安排成功');
        navigate(`/interviews/${res.id}/score`);
      }
    } catch (error) {
      message.error('安排面试失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAndSend = async () => {
    try {
      const values = await emailForm.validateFields();
      setSendingEmail(true);

      // 创建面试
      const res = await request.post('/interviews', {
        ...pendingInterviewData,
        skip_email: true  // 稍后手动发送
      });

      setCreatedInterviewId(res.id);

      // 如果勾选发送邮件，则发送
      if (values.send_email && res.id) {
        try {
          await request.post(`/interviews/${res.id}/send-email`, {
            subject: values.subject,
            content: values.content
          });
          message.success('面试安排成功，邮件已发送');
        } catch (error) {
          message.warning('面试安排成功，但邮件发送失败');
        }
      } else {
        message.success('面试安排成功');
      }

      setEmailPreviewVisible(false);
      navigate(`/interviews/${res.id}/score`);
    } catch (error) {
      message.error('安排面试失败');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCancelPreview = () => {
    setEmailPreviewVisible(false);
    // 返回面试表单
    setInterviewModalVisible(true);
  };

  const handleReject = (id: string) => {
    Modal.confirm({
      title: '确认淘汰',
      content: '确定要淘汰这份简历吗？',
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.put(`/resumes/${id}`, { status: 'rejected' });
          message.success('已标记为淘汰');
          fetchResumes();
        } catch (error) {
          message.error('操作失败');
        }
      },
    });
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这份简历吗？此操作不可恢复。',
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.delete(`/resumes/${id}`);
          message.success('删除成功');
          fetchResumes();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的简历');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 份简历吗？此操作不可恢复。`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/resumes/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 份简历`);
          setSelectedRowKeys([]);
          fetchResumes();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const handleBatchReject = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要淘汰的简历');
      return;
    }
    Modal.confirm({
      title: '确认批量淘汰',
      content: `确定要淘汰选中的 ${selectedRowKeys.length} 份简历吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => 
            request.post(`/resumes/${id}/confirm-rejection`, null, {
              params: { reason_category: 'other', reason_detail: '批量淘汰' }
            })
          ));
          message.success(`成功淘汰 ${selectedRowKeys.length} 份简历`);
          setSelectedRowKeys([]);
          fetchResumes();
        } catch (error) {
          message.error('批量淘汰失败');
        }
      },
    });
  };

  const handleReparse = (record: any) => {
    Modal.confirm({
      title: '重新解析简历',
      content: '将重新调用 AI 解析该简历，并覆盖现有解析结果。',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await request.post(`/resumes/${record.id}/reparse`);
          message.success('已开始重新解析');
          fetchResumes();
        } catch (error) {
          message.error('重新解析失败');
        }
      },
    });
  };

  const handleRestore = (id: string) => {
    Modal.confirm({
      title: '确认恢复',
      content: '确定要恢复这份简历吗？恢复后状态将变为“待评审”。',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await request.put(`/resumes/${id}`, { status: 'pending_review' });
          message.success('已恢复简历状态');
          fetchResumes();
        } catch (error) {
          message.error('操作失败');
        }
      },
    });
  };

  const handleUploadClick = () => {
    form.resetFields();
    setFileList([]);
    setIsModalVisible(true);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (fileList.length === 0) {
        message.error('请上传简历文件');
        return;
      }

      setSubmitting(true);
      
      // Determine if single or batch upload
      if (fileList.length === 1) {
        const formData = new FormData();
        formData.append('position_id', values.position_id);
        formData.append('file', fileList[0]);
        await request.post('/resumes', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        message.success('简历上传成功，AI正在解析中...');
      } else {
        const formData = new FormData();
        formData.append('position_id', values.position_id);
        fileList.forEach(file => {
          formData.append('files', file);
        });
        await request.post('/resumes/batch', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        message.success(`成功上传 ${fileList.length} 份简历，AI正在解析中...`);
      }

      setIsModalVisible(false);
      fetchResumes();
    } catch (error) {
      message.error('上传失败');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadProps = {
    onRemove: (file: any) => {
      setFileList((prev) => {
        const index = prev.indexOf(file);
        const newFileList = prev.slice();
        newFileList.splice(index, 1);
        return newFileList;
      });
    },
    beforeUpload: (file: any) => {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        message.error('只允许上传 PDF 格式的文件');
        return Upload.LIST_IGNORE;
      }
      setFileList((prev) => [...prev, file]);
      return false;
    },
    fileList,
    multiple: true,
    accept: '.pdf'
  };

  const columns = [
    { 
      title: '候选人', 
      dataIndex: 'candidate_name', 
      key: 'candidate_name',
      render: (text: string) => <span style={{ fontWeight: 500, color: '#0F172A' }}>{text || '解析中...'}</span>
    },
    { title: '联系方式', dataIndex: 'contact', key: 'contact' },
    { title: '应聘岗位', dataIndex: ['position', 'title'], key: 'position' },
    { 
      title: '匹配度', 
      dataIndex: 'match_score', 
      key: 'match_score', 
      sorter: (a: any, b: any) => a.match_score - b.match_score,
      render: (score: number) => (
        <span style={{ 
          color: score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444',
          fontWeight: 600 
        }}>
          {score > 0 ? `${score}分` : '-'}
        </span>
      )
    },
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string, record: any) => {
        if (record?.parse_status === 'failed') {
          const tag = <Tag color="error">解析失败</Tag>;
          return record?.parse_error ? <Tooltip title={record.parse_error}>{tag}</Tooltip> : tag;
        }
        if (record?.parse_status === 'processing') {
          return <Tag color="processing">解析中</Tag>;
        }
        let color = 'default';
        let text = status;
        switch(status) {
          case 'pending_screening': color = 'warning'; text = '待初筛'; break;
          case 'pending_review': color = 'warning'; text = '待评审'; break;
          case 'pending_dept_review': color = 'cyan'; text = '待部门评审'; break;
          case 'pending_hr_decision': color = 'purple'; text = '待HR决策'; break;
          case 'auto_rejected_pending_review': color = 'orange'; text = 'AI建议淘汰'; break;
          case 'pending_interview': color = 'geekblue'; text = '待面试'; break;
          case 'interview_passed': color = 'lime'; text = '面试通过'; break;
          case 'interview_failed': color = 'magenta'; text = '面试未通过'; break;
          case 'offer_pending': color = 'blue'; text = 'Offer待确认'; break;
          case 'offer_accepted': color = 'success'; text = '已接受Offer'; break;
          case 'offer_rejected': color = 'error'; text = '已拒绝Offer'; break;
          case 'waitlist': color = 'gold'; text = '备选'; break;
          case 'departed': color = 'default'; text = '已离职'; break;
          case 'completed': color = 'success'; text = '已入职'; break;
          case 'rejected': color = 'error'; text = '已淘汰'; break;
          case 'hired': color = 'success'; text = '已录用'; break;
          default: break;
        }
        return <Tag color={color}>{text}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: any) => {
        // 面试官只能查看和评审
        if (user?.role === 'interviewer') {
          return (
            <Space size="small">
              <Button type="primary" icon={<EyeOutlined />} onClick={() => navigate(`/resumes/${record.id}`)}>
                查看并评审
              </Button>
            </Space>
          );
        }

        // HR和管理员的操作
        // 只有初审通过（pending_interview）才能安排面试
        const canScheduleInterview = record.status === 'pending_interview';
        // 可以进行评审操作的状态
        const canReview = ['pending_review', 'pending_dept_review', 'pending_hr_decision', 'auto_rejected_pending_review'].includes(record.status);

        return (
          <Space size="small">
            <Tooltip title="查看详情">
              <Button type="text" icon={<EyeOutlined style={{ color: '#3B82F6' }} />} onClick={() => navigate(`/resumes/${record.id}`)} />
            </Tooltip>
            {/* Only Admin and HR can schedule interviews - only after initial review passed */}
            {(user?.role === 'admin' || user?.role === 'hr') && canScheduleInterview && (
              <Tooltip title="安排面试">
                <Button type="text" icon={<TeamOutlined style={{ color: '#10B981' }} />} onClick={() => handleCreateInterviewClick(record)} />
              </Tooltip>
            )}
            {/* 如果可以评审，显示评审入口提示 */}
            {(user?.role === 'admin' || user?.role === 'hr') && canReview && (
              <Tooltip title="进入评审">
                <Button type="text" icon={<SolutionOutlined style={{ color: '#8B5CF6' }} />} onClick={() => navigate(`/resumes/${record.id}`)} />
              </Tooltip>
            )}
            {record.status === 'rejected' && (
              <Tooltip title="恢复">
                 <Button type="text" icon={<UndoOutlined />} onClick={() => handleRestore(record.id)} />
              </Tooltip>
            )}
            {(user?.role === 'admin' || user?.role === 'hr') && (
              <Tooltip title="重新解析">
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => handleReparse(record)}
                  disabled={record?.parse_status === 'processing'}
                />
              </Tooltip>
            )}
            {record.status !== 'rejected' && record.status !== 'completed' && (
              <Tooltip title="淘汰">
                 <Button type="text" danger icon={<CloseCircleOutlined />} onClick={() => handleReject(record.id)} />
              </Tooltip>
            )}
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={user?.role === 'interviewer' ? '我的待评审' : '简历管理'}
        description={user?.role === 'interviewer' ? '查看被指派给您的候选人简历，完成专业评审。' : '集中管理候选人，从简历解析到面试评估。'}
        actions={
          <Space wrap>
          {user?.role !== 'interviewer' && (
            <>
              <Button icon={pollingEnabled ? <SyncOutlined spin /> : <ReloadOutlined />} onClick={() => fetchResumes()}>
                {pollingEnabled ? '解析中...' : '刷新'}
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleUploadClick} size="large" style={{ borderRadius: '8px' }}>上传简历</Button>
            </>
          )}
          {user?.role === 'interviewer' && (
            <Button icon={pollingEnabled ? <SyncOutlined spin /> : <ReloadOutlined />} onClick={() => fetchResumes()}>
              {pollingEnabled ? '解析中...' : '刷新'}
            </Button>
          )}
        </Space>
        } />

      {user?.role !== 'interviewer' && (
        <div className="filter-toolbar">
          <Form layout="inline" noValidate>
            <Form.Item label="候选人">
              <Input
                placeholder="请输入姓名"
                aria-label="候选人姓名"
                onPressEnter={(event) => { if (!event.nativeEvent.isComposing) handleSearch(); }}
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                style={{ width: 200 }}
                allowClear
              />
            </Form.Item>
            <Form.Item label="状态">
              <Select
                placeholder="请选择状态"
                aria-label="简历状态"
                value={searchStatus}
                onChange={val => setSearchStatus(val)}
                style={{ width: 150 }}
                allowClear
              >
                <Select.Option value="pending_screening">待初筛</Select.Option>
                <Select.Option value="pending_review">待评审</Select.Option>
                <Select.Option value="pending_dept_review">待部门评审</Select.Option>
                <Select.Option value="pending_hr_decision">待HR决策</Select.Option>
                <Select.Option value="auto_rejected_pending_review">AI建议淘汰</Select.Option>
                <Select.Option value="pending_interview">待面试</Select.Option>
                <Select.Option value="interview_passed">面试通过</Select.Option>
                <Select.Option value="interview_failed">面试未通过</Select.Option>
                <Select.Option value="offer_pending">Offer待确认</Select.Option>
                <Select.Option value="offer_accepted">已接受Offer</Select.Option>
                <Select.Option value="offer_rejected">已拒绝Offer</Select.Option>
                <Select.Option value="waitlist">备选</Select.Option>
                <Select.Option value="completed">已入职</Select.Option>
                <Select.Option value="departed">已离职</Select.Option>
                <Select.Option value="rejected">已淘汰</Select.Option>
                <Select.Option value="hired">已录用</Select.Option>
              </Select>
            </Form.Item>
            {selectedRowKeys.length > 0 && (
              <>
                <Form.Item>
                  <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
                </Form.Item>
                <Form.Item>
                  <Button danger onClick={handleBatchReject}>批量淘汰</Button>
                </Form.Item>
                <Form.Item>
                  <Button danger onClick={handleBatchDelete}>批量删除</Button>
                </Form.Item>
                <Form.Item>
                  <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
                </Form.Item>
              </>
            )}
            <Form.Item>
              <Space>
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
                <Button onClick={handleReset}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        </div>
      )}

      <p className="table-overflow-hint">左右滑动表格查看完整候选人信息与操作</p>
      <Table 
        scroll={{ x: 1200 }}
        columns={columns} 
        dataSource={data} 
        loading={loading} 
        rowKey="id" 
        pagination={{ pageSize: 10, showSizeChanger: true }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
      />

      {/* Upload Modal */}
      <Modal
        title="上传简历"
        open={isModalVisible}
        onOk={handleOk}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={submitting}
        width={500}
        centered
        destroyOnClose
        okText="上传"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
          <Form.Item
            name="position_id"
            label="应聘岗位"
            rules={[{ required: true, message: '请选择应聘岗位' }]}
          >
            <Select placeholder="请选择应聘岗位" size="large">
              {positions.map((pos: any) => (
                <Select.Option key={pos.id} value={pos.id}>{pos.title}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="file"
            label="简历文件"
            rules={[{ required: true, message: '请上传简历文件' }]}
            extra="仅支持 PDF 格式，可批量上传"
          >
            <Upload {...uploadProps} maxCount={10}>
              <Button icon={<UploadOutlined />} size="large">选择文件（可多选）</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Interview Modal */}
      <Modal
        title="安排面试"
        open={interviewModalVisible}
        onOk={handleInterviewOk}
        onCancel={() => setInterviewModalVisible(false)}
        confirmLoading={submitting}
        width={700}
        centered
        destroyOnClose
        okText="确认"
        cancelText="取消"
      >
        {/* 显示已有面试记录 */}
        {existingInterviews.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <Text strong>该候选人已有 {existingInterviews.length} 轮面试：</Text>
            <div style={{ marginTop: 8 }}>
              {existingInterviews.map((i: any) => (
                <Tag key={i.id} color={i.status === 'completed' ? 'green' : 'blue'}>
                  第{i.round || 1}轮 - {i.status === 'completed' ? '已完成' : '待面试'}
                </Tag>
              ))}
            </div>
          </div>
        )}

        <Form
          form={interviewForm}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="round"
                label="面试轮次"
                rules={[{ required: true, message: '请选择面试轮次' }]}
              >
                <Select placeholder="选择轮次" size="large">
                  <Select.Option value={1}>第1轮面试</Select.Option>
                  <Select.Option value={2}>第2轮面试</Select.Option>
                  <Select.Option value={3}>第3轮面试</Select.Option>
                  <Select.Option value={4}>第4轮面试</Select.Option>
                  <Select.Option value={5}>第5轮面试</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="interview_category"
                label="面试类型"
                rules={[{ required: true, message: '请选择面试类型' }]}
                extra="不同类型会生成不同侧重点的面试题"
              >
                <Select placeholder="选择面试类型" size="large">
                  <Select.Option value="hr">HR面</Select.Option>
                  <Select.Option value="technical">技术面</Select.Option>
                  <Select.Option value="manager">主管面</Select.Option>
                  <Select.Option value="ceo">CEO面</Select.Option>
                  <Select.Option value="comprehensive">综合面</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="interview_type"
                label="面试形式"
                rules={[{ required: true, message: '请选择面试形式' }]}
              >
                <Select placeholder="选择面试形式" size="large">
                  <Select.Option value="onsite">现场面试</Select.Option>
                  <Select.Option value="video">视频面试</Select.Option>
                  <Select.Option value="phone">电话面试</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="panel_members"
            label="面试官"
            rules={[{ required: true, message: '请选择面试官' }]}
            extra="选择参与此次面试的面试官（可多选）"
          >
            <Select
              mode="multiple"
              placeholder="选择面试官"
              size="large"
              style={{ width: '100%' }}
            >
              {interviewers.map((user: any) => (
                <Select.Option key={user.id} value={user.id}>{user.full_name || user.email}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="interview_time"
            label="面试时间"
          >
            <DatePicker showTime style={{ width: '100%' }} size="large" />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.interview_type !== currentValues.interview_type}
          >
            {({ getFieldValue }) => {
              const interviewType = getFieldValue('interview_type');
              return (
                <>
                  {interviewType === 'onsite' && (
                    <Form.Item
                      name="interview_location"
                      label="面试地点"
                    >
                      <Input placeholder="请输入面试地点，如：北京市朝阳区xxx大厦A座10层" size="large" />
                    </Form.Item>
                  )}
                  {interviewType === 'video' && (
                    <Form.Item
                      name="meeting_link"
                      label="会议链接"
                    >
                      <Input placeholder="请输入视频会议链接，如：https://meeting.xxx.com/xxx" size="large" />
                    </Form.Item>
                  )}
                </>
              );
            }}
          </Form.Item>

          <Form.Item
            name="skip_ai_questions"
            valuePropName="checked"
            initialValue={false}
            extra="勾选后将跳过AI生成面试题，您可以稍后手动添加题目"
          >
            <Checkbox>跳过AI生成面试题</Checkbox>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.skip_ai_questions !== currentValues.skip_ai_questions}
          >
            {({ getFieldValue }) =>
              !getFieldValue('skip_ai_questions') ? (
                <>
                  <Form.Item
                    name="question_bank_ids"
                    label="参考题库"
                    extra="选择题库后，AI 将参考题库内容生成更精准的面试题"
                  >
                    <Select
                      mode="multiple"
                      placeholder="选择参考题库"
                      size="large"
                      style={{ width: '100%' }}
                    >
                      {questionBanks.map((qb: any) => (
                        <Select.Option key={qb.id} value={qb.id}>{qb.name}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="question_count"
                    label="生成题目数量"
                    initialValue={5}
                  >
                    <InputNumber min={1} max={20} size="large" style={{ width: '100%' }} />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 邮件预览模态框 */}
      <Modal
        title="邮件预览"
        open={emailPreviewVisible}
        onCancel={handleCancelPreview}
        width={800}
        centered
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={handleCancelPreview}>
            取消
          </Button>,
          <Button key="confirm" type="primary" loading={sendingEmail} onClick={handleConfirmAndSend}>
            确认
          </Button>
        ]}
      >
        {emailContent && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <p><strong>收件人：</strong>{emailContent.to_email}</p>
            <p><strong>候选人：</strong>{emailContent.candidate_name}</p>
          </div>
        )}

        <Form form={emailForm} layout="vertical">
          <Form.Item
            name="subject"
            label="邮件主题"
            rules={[{ required: true, message: '请输入邮件主题' }]}
          >
            <Input placeholder="邮件主题" size="large" />
          </Form.Item>

          <Form.Item
            name="content"
            label="邮件内容"
            rules={[{ required: true, message: '请输入邮件内容' }]}
          >
            <Input.TextArea
              rows={10}
              placeholder="邮件内容（支持 HTML 格式）"
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>

          <Form.Item
            label="邮件预览"
          >
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                padding: 16,
                maxHeight: 300,
                overflow: 'auto',
                background: '#fff'
              }}
              dangerouslySetInnerHTML={{ __html: emailForm.getFieldValue('content') || '' }}
            />
          </Form.Item>

          <Form.Item
            name="send_email"
            valuePropName="checked"
            initialValue={true}
          >
            <Checkbox>发送邮件通知候选人</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ResumesList;
