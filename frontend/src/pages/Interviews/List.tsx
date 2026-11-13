import PageHeader from '../../components/PageHeader';
import React, { useEffect, useState } from 'react';
import { Table, Button, Space, message, Tag, Modal, Tooltip, Select, Input, Form, DatePicker, InputNumber, Row, Col, Checkbox, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, PlayCircleOutlined, EyeOutlined, StopOutlined, TeamOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const { Text } = Typography;

const InterviewsList: React.FC = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [interviewerNameMap, setInterviewerNameMap] = useState<Record<string, string>>({});
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  
  const [selectResumeModalVisible, setSelectResumeModalVisible] = useState(false);
  const [pendingInterviewResumes, setPendingInterviewResumes] = useState<any[]>([]);
  const [loadingResumes, setLoadingResumes] = useState(false);
  const [selectedResume, setSelectedResume] = useState<any>(null);
  const [interviewModalVisible, setInterviewModalVisible] = useState(false);
  const [existingInterviews, setExistingInterviews] = useState<any[]>([]);
  const [interviewers, setInterviewers] = useState([]);
  const [questionBanks, setQuestionBanks] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [interviewForm] = Form.useForm();
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailContent, setEmailContent] = useState<any>(null);
  const [pendingInterviewData, setPendingInterviewData] = useState<any>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailForm] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const navigate = useNavigate();
  const { user } = useAuth();

  // 判断是否可以取消面试（仅 HR/Admin 可见）
  const canCancelInterview = user?.role === 'admin' || user?.role === 'hr';
  // 判断是否可以删除面试（仅 HR/Admin 可见）
  const canDeleteInterview = user?.role === 'admin' || user?.role === 'hr';

  const fetchInterviews = async () => {
    setLoading(true);
    try {
      const res = await request.get('/interviews');
      setData(res);
    } catch (error) {
      message.error('获取面试列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInterviews();
  }, []);

  useEffect(() => {
    request.get('/auth/interviewers')
      .then((res: any) => {
        const map: Record<string, string> = {};
        (res || []).forEach((u: any) => {
          const name = u?.full_name || u?.email || u?.id;
          if (u?.id) map[String(u.id)] = name;
        });
        setInterviewerNameMap(map);
        setInterviewers(res || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    request.get('/question-banks')
      .then((res: any) => {
        setQuestionBanks(res || []);
      })
      .catch(() => {});
  }, []);

  const filteredData = statusFilter ? (data as any[]).filter((i) => i?.status === statusFilter) : data;

  const getInterviewerText = (record: any) => {
    const members = Array.isArray(record?.panel_members) ? record.panel_members : [];
    if (members.length > 0) {
      return members.map((id: any) => interviewerNameMap[String(id)] || String(id)).join('、');
    }
    return record?.interviewer || '-';
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条面试记录吗？此操作不可恢复。',
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.delete(`/interviews/${id}`);
          message.success('删除成功');
          fetchInterviews();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  };

  const handleOpenCancelModal = (id: string) => {
    setSelectedInterviewId(id);
    setCancelReason('');
    setCancelModalVisible(true);
  };

  const handleCancelInterview = async () => {
    if (!selectedInterviewId) return;

    if (!cancelReason.trim()) {
      message.error('请输入取消原因');
      return;
    }

    setCancelling(true);
    try {
      await request.post(`/interviews/${selectedInterviewId}/cancel?reason=${encodeURIComponent(cancelReason)}`);
      message.success('面试已取消');
      setCancelModalVisible(false);
      setCancelReason('');
      setSelectedInterviewId(null);
      fetchInterviews();
    } catch (error) {
      message.error('取消面试失败');
    } finally {
      setCancelling(false);
    }
  };

  const handleOpenSelectResume = async () => {
    setLoadingResumes(true);
    setSelectResumeModalVisible(true);
    try {
      const res = await request.get('/resumes', { params: { status: 'pending_interview' } });
      setPendingInterviewResumes(res || []);
    } catch (error) {
      message.error('获取简历列表失败');
    } finally {
      setLoadingResumes(false);
    }
  };

  const handleSelectResume = (record: any) => {
    setSelectedResume(record);
    setSelectResumeModalVisible(false);
    handleCreateInterviewClick(record);
  };

  const handleCreateInterviewClick = async (record: any) => {
    interviewForm.resetFields();

    try {
      const allInterviews = await request.get('/interviews') as any[];
      const resumeInterviews = allInterviews.filter((i: any) => i.resume_id === record.id);
      setExistingInterviews(resumeInterviews);

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

      const interviewData = {
        resume_id: selectedResume.id,
        position_id: selectedResume.position_id,
        interviewer: '面试小组',
        panel_members: values.panel_members,
        interview_time: values.interview_time ? values.interview_time.toISOString() : new Date().toISOString(),
        interview_end_time: values.interview_end_time?.toISOString() || null,
        question_bank_ids: values.question_bank_ids,
        question_count: values.question_count,
        round: values.round || 1,
        interview_type: values.interview_type || 'onsite',
        interview_category: values.interview_category || 'technical',
        interview_location: values.interview_location,
        meeting_link: values.meeting_link,
        skip_ai_questions: values.skip_ai_questions || false
      };

      setPendingInterviewData(interviewData);

      try {
        const emailPreview = await request.post('/interviews/email-preview', {
          resume_id: selectedResume.id,
          position_id: selectedResume.position_id,
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
        console.error('获取邮件预览失败', error);
        const res = await request.post('/interviews', {
          ...interviewData,
          skip_email: true
        });
        message.success('面试安排成功');
        setInterviewModalVisible(false);
        fetchInterviews();
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

      const res = await request.post('/interviews', {
        ...pendingInterviewData,
        skip_email: true
      });

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
      fetchInterviews();
      navigate(`/interviews/${res.id}/score`);
    } catch (error) {
      message.error('安排面试失败');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCancelPreview = () => {
    setEmailPreviewVisible(false);
    setInterviewModalVisible(true);
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的面试');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个面试吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/interviews/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个面试`);
          setSelectedRowKeys([]);
          fetchInterviews();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const columns = [
    {
      title: '候选人',
      dataIndex: ['resume', 'candidate_name'],
      key: 'candidate_name',
      render: (text: string) => <span style={{ fontWeight: 500, color: '#0F172A' }}>{text || '未知'}</span>
    },
    {
      title: '岗位',
      dataIndex: ['position', 'title'],
      key: 'position',
      render: (text: string) => <span style={{ color: '#64748B' }}>{text || '未知'}</span>
    },
    {
      title: '轮次',
      dataIndex: 'round',
      key: 'round',
      width: 80,
      render: (round: number) => (
        <Tag color="purple" style={{ border: 'none' }}>
          第{round || 1}轮
        </Tag>
      )
    },
    {
      title: '面试官',
      key: 'interviewer',
      render: (_: any, record: any) => {
        const full = getInterviewerText(record);
        return (
          <Tooltip title={full}>
            <span
              style={{
                display: 'inline-block',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom',
              }}
            >
              {full}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '面试时间',
      dataIndex: 'interview_time',
      key: 'interview_time',
      sorter: (a: any, b: any) => {
        const at = a?.interview_time ? new Date(a.interview_time).getTime() : 0;
        const bt = b?.interview_time ? new Date(b.interview_time).getTime() : 0;
        return at - bt;
      },
      render: (time: string) => time ? new Date(time).toLocaleString() : '-'
    },
    {
      title: '总分',
      key: 'total_score',
      render: (_, record: any) => {
        if (!record.scores) return '-';
        const values = Object.values(record.scores) as number[];
        if (values.length === 0) return '-';
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = (sum / values.length).toFixed(1);
        return <span style={{ fontWeight: 600, color: '#0F172A' }}>{avg}</span>;
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const map: Record<string, {text: string, color: string}> = {
          scheduled: { text: '待面试', color: 'blue' },
          in_progress: { text: '面试中', color: 'orange' },
          analyzing: { text: '分析中', color: 'purple' },
          completed: { text: '已完成', color: 'green' },
          cancelled: { text: '已取消', color: 'default' }
        };
        const info = map[status] || { text: status, color: 'default' };
        return <Tag color={info.color} style={{ border: 'none' }}>{info.text}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: any) => {
        // Check if interview is pending confirmation (has scores but status not completed)
        const isPendingConfirmation = record.status !== 'completed' &&
                                      (record.result === 'pending' && record.scores && Object.keys(record.scores).length > 0);

        return (
        <Space size="small">
          {record.status === 'scheduled' && (
            <Tooltip title="开始面试">
              <Button type="text" icon={<PlayCircleOutlined style={{ color: '#3B82F6' }} />} onClick={() => navigate(`/interviews/${record.id}/score`)} />
            </Tooltip>
          )}

          {record.status === 'in_progress' && !isPendingConfirmation && (
            <Tooltip title="继续评分">
              <Button type="text" icon={<PlayCircleOutlined style={{ color: '#F97316' }} />} onClick={() => navigate(`/interviews/${record.id}/score`)} />
            </Tooltip>
          )}

          {(record.status === 'completed' || isPendingConfirmation) && (
             <Tooltip title={isPendingConfirmation ? "确认结果" : "查看结果"}>
               <Button type="text" icon={<EyeOutlined style={{ color: isPendingConfirmation ? '#F59E0B' : '#10B981' }} />} onClick={() => navigate(`/interviews/${record.id}/result`)} />
             </Tooltip>
          )}

          {canCancelInterview && (record.status === 'scheduled' || record.status === 'in_progress') && (
            <Tooltip title="取消面试">
              <Button type="text" danger icon={<StopOutlined />} onClick={() => handleOpenCancelModal(record.id)} />
            </Tooltip>
          )}

          {canDeleteInterview && (
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
            </Tooltip>
          )}
        </Space>
      )},
    },
  ];

  return (
    <div>
      <PageHeader title="面试管理" description="安排面试、记录评估，让团队判断有据可循。" actions={
        canCancelInterview && <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenSelectResume}>安排面试</Button>
      } />
      <div className="filter-toolbar">
        <Space wrap>
          <Select
            aria-label="面试状态"
            placeholder="筛选状态"
            allowClear
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            style={{ width: 160 }}
            options={[
              { value: 'scheduled', label: '待面试' },
              { value: 'in_progress', label: '面试中' },
              { value: 'completed', label: '已完成' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
          {selectedRowKeys.length > 0 && canDeleteInterview && (
            <>
              <span style={{ lineHeight: '32px' }}>已选 {selectedRowKeys.length} 项</span>
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </>
          )}
        </Space>
      </div>
      <p className="table-overflow-hint">左右滑动表格查看完整面试安排与操作</p>
      <Table
        scroll={{ x: 1100 }}
        columns={columns}
        dataSource={filteredData}
        loading={loading}
        rowKey="id"
        pagination={{ pageSize: 10, showSizeChanger: true }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
      />

      {/* 取消面试弹窗 */}
      <Modal
        title="取消面试"
        open={cancelModalVisible}
        onOk={handleCancelInterview}
        onCancel={() => setCancelModalVisible(false)}
        confirmLoading={cancelling}
        okText="确认取消"
        cancelText="返回"
        okButtonProps={{ danger: true }}
      >
        <p style={{ marginBottom: 12, color: '#64748B' }}>请输入取消面试的原因：</p>
        <Input.TextArea
          rows={3}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="请输入取消原因..."
          maxLength={500}
          showCount
        />
      </Modal>

      {/* 选择简历弹窗 */}
      <Modal
        title="选择候选人"
        open={selectResumeModalVisible}
        onCancel={() => setSelectResumeModalVisible(false)}
        footer={null}
        width={900}
        centered
      >
        <Table
          columns={[
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
              title: '操作',
              key: 'action',
              render: (_, record: any) => (
                <Button 
                  type="primary" 
                  icon={<TeamOutlined />} 
                  onClick={() => handleSelectResume(record)}
                >
                  安排面试
                </Button>
              )
            }
          ]}
          dataSource={pendingInterviewResumes}
          loading={loadingResumes}
          rowKey="id"
          pagination={{ pageSize: 5 }}
          locale={{ emptyText: '暂无待面试的候选人' }}
        />
      </Modal>

      {/* 安排面试弹窗 */}
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
        {selectedResume && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <Text strong>候选人：</Text>{selectedResume.candidate_name}
            <br />
            <Text strong>应聘岗位：</Text>{selectedResume.position?.title || '-'}
          </div>
        )}

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

          <Form.Item name="interview_end_time" label="预计结束时间" dependencies={["interview_time"]} rules={[({ getFieldValue }) => ({ validator(_, value) { const start = getFieldValue("interview_time"); return !value || (start && value.isAfter(start)) ? Promise.resolve() : Promise.reject(new Error("结束时间需要晚于开始时间")); } })]}><DatePicker showTime style={{ width: "100%" }} size="large" /></Form.Item>

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

      {/* 邮件预览弹窗 */}
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

export default InterviewsList;
