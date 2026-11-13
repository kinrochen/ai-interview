import Onboarding from "../Recruitment/Onboarding";
import PageHeader from '../../components/PageHeader';
import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, DatePicker,
  Select, message, Popconfirm, Badge, Tooltip, Typography, Row, Col, Statistic,
  Drawer, Descriptions, Divider
} from 'antd';
import {
  PlusOutlined, MailOutlined, CheckOutlined, CloseOutlined, RollbackOutlined,
  EyeOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined,
  FileTextOutlined, DollarOutlined, EnvironmentOutlined, ClockCircleOutlined,
  RedoOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../utils/request';
import dayjs from 'dayjs';

const { Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;
const { RangePicker } = DatePicker;

interface Offer {
  actual_onboarded_at?: string | null;
  departed_at?: string | null;
  id: string;
  resume_id: string;
  position_id: string;
  candidate_name: string;
  candidate_email: string;
  salary_monthly: number | null;
  salary_annual: number | null;
  salary_structure: string | null;
  position_title: string;
  department: string | null;
  report_to: string | null;
  work_location: string | null;
  work_hours: string | null;
  onboard_date: string | null;
  probation_months: number;
  benefits: string | null;
  bonus: string | null;
  special_terms: string | null;
  notes: string | null;
  valid_until: string | null;
  status: string;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string | null;
  position_info: {
    id: string;
    title: string;
    department: string;
    location: string;
    salary_range: string;
  } | null;
  resume_info: {
    id: string;
    candidate_name: string;
    email: string;
    match_score: number;
  } | null;
}

interface OfferStats {
  total_offers: number;
  pending_offers: number;
  sent_offers: number;
  accepted_offers: number;
  rejected_offers: number;
  expired_offers: number;
  acceptance_rate: number;
  avg_response_days: number | null;
}

const statusConfig: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  pending: { color: 'processing', text: '待发送' },
  sent: { color: 'warning', text: '已发送' },
  accepted: { color: 'success', text: '已接受' },
  rejected: { color: 'error', text: '已拒绝' },
  expired: { color: 'default', text: '已过期' },
  withdrawn: { color: 'default', text: '已撤回' },
  departed: { color: 'default', text: '已离职' },
};

const OffersList: React.FC = () => {
  const navigate = useNavigate();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [stats, setStats] = useState<OfferStats | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
  const [sendModalVisible, setSendModalVisible] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [acceptModalVisible, setAcceptModalVisible] = useState(false);
  
  const [currentOffer, setCurrentOffer] = useState<Offer | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [sendForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [acceptForm] = Form.useForm();

  const [positions, setPositions] = useState<any[]>([]);
  const [resumes, setResumes] = useState<any[]>([]);
  const [selectedResume, setSelectedResume] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', pagination.current.toString());
      params.append('page_size', pagination.pageSize.toString());
      if (statusFilter) params.append('status', statusFilter);
      if (searchText) params.append('search', searchText);

      const response = await request.get(`/offers?${params.toString()}`);
      setOffers(response.items);
      setPagination(prev => ({ ...prev, total: response.total }));
    } catch (error) {
      message.error('获取Offer列表失败');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, statusFilter, searchText]);

  const fetchStats = async () => {
    try {
      const response = await request.get('/offers/stats');
      setStats(response);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchPositions = async () => {
    try {
      const response = await request.get('/positions?page=1&page_size=100');
      const positionsData = Array.isArray(response) ? response : (response.items || []);
      setPositions(positionsData);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    }
  };

  const fetchPassedResumes = async () => {
    try {
      const response = await request.get('/resumes?limit=500');
      const eligibleStatuses = ['interview_passed', 'offer_pending', 'completed'];
      const eligibleResumes = (response || []).filter((r: any) => 
        eligibleStatuses.includes(r.status)
      );
      setResumes(eligibleResumes);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const fetchTemplates = async (positionId?: string) => {
    try {
      const url = positionId 
        ? `/offer-templates?position_id=${positionId}`
        : '/offer-templates';
      const response = await request.get(url);
      setTemplates(response.items || []);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    }
  };

  const applyTemplate = (template: any) => {
    if (!template) return;
    createForm.setFieldsValue({
      salary_monthly: template.salary_monthly,
      salary_annual: template.salary_annual,
      salary_structure: template.salary_structure,
      department: template.department,
      report_to: template.report_to,
      work_location: template.work_location,
      work_hours: template.work_hours,
      probation_months: template.probation_months || 3,
      benefits: template.benefits,
      bonus: template.bonus,
      special_terms: template.special_terms,
      notes: template.notes,
    });
  };

  useEffect(() => {
    fetchOffers();
    fetchStats();
    fetchPositions();
    fetchPassedResumes();
  }, [fetchOffers]);

  const handleCreate = async (values: any) => {
    try {
      const data = {
        ...values,
        onboard_date: values.onboard_date?.toISOString(),
        valid_until: values.valid_until?.toISOString(),
      };
      await request.post('/offers', data);
      message.success('Offer创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败');
    }
  };

  const handleEdit = async (values: any) => {
    if (!currentOffer) return;
    try {
      const data = {
        ...values,
        onboard_date: values.onboard_date?.toISOString(),
        valid_until: values.valid_until?.toISOString(),
      };
      await request.put(`/offers/${currentOffer.id}`, data);
      message.success('Offer更新成功');
      setEditModalVisible(false);
      editForm.resetFields();
      fetchOffers();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '更新失败');
    }
  };

  const handleSend = async (values: any) => {
    if (!currentOffer) return;
    try {
      await request.post(`/offers/${currentOffer.id}/send`, values);
      message.success('Offer发送成功');
      setSendModalVisible(false);
      sendForm.resetFields();
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '发送失败');
    }
  };

  const handleAccept = async (values: any) => {
    if (!currentOffer) return;
    try {
      const data = {
        ...values,
        accepted_onboard_date: values.accepted_onboard_date?.toISOString(),
      };
      await request.post(`/offers/${currentOffer.id}/accept`, data);
      message.success('Offer已接受');
      setAcceptModalVisible(false);
      acceptForm.resetFields();
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '操作失败');
    }
  };

  const handleReject = async (values: any) => {
    if (!currentOffer) return;
    try {
      await request.post(`/offers/${currentOffer.id}/reject`, values);
      message.success('Offer已拒绝');
      setRejectModalVisible(false);
      rejectForm.resetFields();
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '操作失败');
    }
  };

  const handleWithdraw = async (offerId: string) => {
    try {
      await request.post(`/offers/${offerId}/withdraw`);
      message.success('Offer已撤回');
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '撤回失败');
    }
  };

  const handleReopen = async (offerId: string) => {
    try {
      await request.post(`/offers/${offerId}/reopen`);
      message.success('Offer已重新打开');
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '重新打开失败');
    }
  };

  const handleDelete = async (offerId: string) => {
    try {
      await request.delete(`/offers/${offerId}`);
      message.success('Offer已删除');
      fetchOffers();
      fetchStats();
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败');
    }
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的Offer');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个Offer吗？此操作不可恢复。`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/offers/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个Offer`);
          setSelectedRowKeys([]);
          fetchOffers();
          fetchStats();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const handleBatchSend = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要发送的Offer');
      return;
    }
    Modal.confirm({
      title: '确认批量发送',
      content: `确定要发送选中的 ${selectedRowKeys.length} 个Offer吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.post(`/offers/${id}/send`)));
          message.success(`成功发送 ${selectedRowKeys.length} 个Offer`);
          setSelectedRowKeys([]);
          fetchOffers();
          fetchStats();
        } catch (error) {
          message.error('批量发送失败');
        }
      },
    });
  };

  const openEditModal = (offer: Offer) => {
    setCurrentOffer(offer);
    editForm.setFieldsValue({
      ...offer,
      onboard_date: offer.onboard_date ? dayjs(offer.onboard_date) : null,
      valid_until: offer.valid_until ? dayjs(offer.valid_until) : null,
    });
    setEditModalVisible(true);
  };

  const openDetailDrawer = (offer: Offer) => {
    setCurrentOffer(offer);
    setDetailDrawerVisible(true);
  };

  const columns = [
    {
      title: '候选人',
      dataIndex: 'candidate_name',
      key: 'candidate_name',
      render: (text: string, record: Offer) => (
        <div>
          <Text strong>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>{record.candidate_email}</Text>
        </div>
      ),
    },
    {
      title: '岗位',
      dataIndex: 'position_title',
      key: 'position_title',
      render: (text: string, record: Offer) => (
        <div>
          <Text>{text}</Text>
          {record.department && <><br /><Text type="secondary" style={{ fontSize: 12 }}>{record.department}</Text></>}
        </div>
      ),
    },
    {
      title: '薪资',
      key: 'salary',
      render: (_: any, record: Offer) => (
        <div>
          {record.salary_monthly && <Text>月薪 {record.salary_monthly.toLocaleString()}元</Text>}
          {record.salary_annual && <><br /><Text type="secondary">年薪 {record.salary_annual.toLocaleString()}元</Text></>}
          {!record.salary_monthly && !record.salary_annual && <Text type="secondary">未填写</Text>}
        </div>
      ),
    },
    {
      title: '入职日期',
      dataIndex: 'onboard_date',
      key: 'onboard_date',
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD') : <Text type="secondary">待定</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const config = statusConfig[status] || { color: 'default', text: status };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Offer) => (
        <Space size="small">
          <Onboarding offer={record} onChange={fetchOffers} />
          <Tooltip title="查看详情">
            <Button type="text" icon={<EyeOutlined />} onClick={() => openDetailDrawer(record)} />
          </Tooltip>
          {record.status === 'draft' && (
            <>
              <Tooltip title="编辑">
                <Button type="text" icon={<EditOutlined />} onClick={() => openEditModal(record)} />
              </Tooltip>
              <Tooltip title="发送Offer">
                <Button type="text" icon={<MailOutlined />} onClick={() => {
                  setCurrentOffer(record);
                  sendForm.setFieldsValue({ send_email: true, custom_message: '' });
                  setSendModalVisible(true);
                }} />
              </Tooltip>
            </>
          )}
          {record.status === 'sent' && (
            <>
              <Tooltip title="接受">
                <Button type="text" style={{ color: 'var(--success-color)' }} icon={<CheckOutlined />} onClick={() => {
                  setCurrentOffer(record);
                  acceptForm.setFieldsValue({
                    accepted_salary: record.salary_monthly,
                    accepted_onboard_date: record.onboard_date ? dayjs(record.onboard_date) : null,
                    notes: ''
                  });
                  setAcceptModalVisible(true);
                }} />
              </Tooltip>
              <Tooltip title="拒绝">
                <Button type="text" danger icon={<CloseOutlined />} onClick={() => {
                  setCurrentOffer(record);
                  rejectForm.resetFields();
                  setRejectModalVisible(true);
                }} />
              </Tooltip>
            </>
          )}
          {['draft', 'pending', 'sent'].includes(record.status) && (
            <Popconfirm title="确定撤回此Offer？" onConfirm={() => handleWithdraw(record.id)}>
              <Tooltip title="撤回">
                <Button type="text" icon={<RollbackOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          {!record.actual_onboarded_at && ['accepted', 'rejected', 'withdrawn', 'expired'].includes(record.status) && (
            <Popconfirm title="确定重新打开此Offer？重新打开后状态将变为已发送。" onConfirm={() => handleReopen(record.id)}>
              <Tooltip title="重新打开">
                <Button type="text" icon={<RedoOutlined />} style={{ color: '#1890ff' }} />
              </Tooltip>
            </Popconfirm>
          )}
          <Popconfirm title="确定删除此Offer？此操作不可恢复。" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Offer 管理" description="准备录用通知，跟进发送、确认与接受进展。" actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateModalVisible(true); }}>新建 Offer</Button>
      } />

      {stats && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic title="总Offer数" value={stats.total_offers} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic title="待处理" value={stats.pending_offers + stats.sent_offers} valueStyle={{ color: 'var(--warning-color)' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic title="已接受" value={stats.accepted_offers} valueStyle={{ color: 'var(--success-color)' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic 
                title="接受率" 
                value={stats.acceptance_rate} 
                suffix="%" 
                valueStyle={{ color: stats.acceptance_rate >= 50 ? 'var(--success-color)' : 'var(--error-color)' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <Space wrap>
            <Input.Search
              aria-label="搜索候选人或岗位"
              placeholder="搜索候选人/岗位"
              allowClear
              style={{ width: 200 }}
              onSearch={setSearchText}
              onChange={(e) => !e.target.value && setSearchText('')}
            />
            <Select
              aria-label="Offer 状态"
              placeholder="状态筛选"
              allowClear
              style={{ width: 120 }}
              onChange={setStatusFilter}
            >
              {Object.entries(statusConfig).map(([key, value]) => (
                <Option key={key} value={key}>{value.text}</Option>
              ))}
            </Select>
            <Button icon={<ReloadOutlined />} onClick={() => { fetchOffers(); fetchStats(); }}>刷新</Button>
            {selectedRowKeys.length > 0 && (
              <>
                <span style={{ color: '#64748B', lineHeight: '32px' }}>已选 {selectedRowKeys.length} 项</span>
                <Button type="primary" onClick={handleBatchSend}>批量发送</Button>
                <Button danger onClick={handleBatchDelete}>批量删除</Button>
                <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
              </>
            )}
          </Space>

        </div>

        <p className="table-overflow-hint">左右滑动表格查看完整录用通知与操作</p>
        <Table
          scroll={{ x: 1100 }}
          columns={columns}
          dataSource={offers}
          rowKey="id"
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => setPagination(prev => ({ ...prev, current: page, pageSize })),
          }}
        />
      </Card>

      <Modal
        title="新建Offer"
        open={createModalVisible}
        onCancel={() => { setCreateModalVisible(false); setSelectedResume(null); setTemplates([]); }}
        onOk={() => createForm.submit()}
        width={700}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="resume_id" label="选择候选人（通过面试）" rules={[{ required: true }]}>
                <Select 
                  placeholder="选择通过面试的候选人" 
                  showSearch
                  optionFilterProp="children"
                  onChange={async (value) => {
                    const resume = resumes.find(r => r.id === value);
                    if (resume) {
                      setSelectedResume(resume);
                      const position = positions.find(p => p.id === resume.position_id);
                      createForm.setFieldsValue({
                        candidate_name: resume.candidate_name,
                        candidate_email: resume.email,
                        position_id: resume.position_id,
                        position_title: position?.title || resume.position?.title || '',
                        department: position?.department || resume.position?.department || '',
                        work_location: position?.location || resume.position?.location || '',
                      });
                      
                      await fetchTemplates(resume.position_id);
                      try {
                        const defaultTemplate = await request.get(`/offer-templates/default/${resume.position_id}`);
                        if (defaultTemplate) {
                          applyTemplate(defaultTemplate);
                          message.info('已自动填充岗位默认模板');
                        }
                      } catch (e) {
                        console.log('No default template for this position');
                      }
                    }
                  }}
                >
                  {resumes.map(r => (
                    <Option key={r.id} value={r.id}>
                      {r.candidate_name} - {r.position?.title || '未知岗位'} ({r.email})
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="选择Offer模板">
                <Select 
                  placeholder={templates.length > 0 ? "选择模板快速填充（已自动加载默认模板）" : "暂无模板，请先创建Offer模板"}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                  onChange={(value) => {
                    const template = templates.find(t => t.id === value);
                    if (template) {
                      applyTemplate(template);
                      message.success('已应用模板');
                    }
                  }}
                >
                  {templates.map(t => (
                    <Option key={t.id} value={t.id}>
                      {t.name} {t.is_default ? '(默认)' : ''} {t.position_info ? `- ${t.position_info.title}` : '- 通用'}
                    </Option>
                  ))}
                </Select>
                {templates.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    当前岗位暂无模板，可前往 <a onClick={() => window.open('/offers/templates', '_blank')}>Offer模板管理</a> 创建
                  </Text>
                )}
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="candidate_name" label="候选人姓名" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="candidate_email" label="候选人邮箱" rules={[{ required: true }, { type: 'email' }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item name="position_id" hidden>
            <Input />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="position_title" label="岗位名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="department" label="部门">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="salary_monthly" label="月薪(元)">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="salary_annual" label="年薪(元)">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="salary_structure" label="薪资结构说明">
            <TextArea rows={2} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="work_location" label="工作地点">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="work_hours" label="工作时间">
                <Input placeholder="如: 9:00-18:00" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="onboard_date" label="入职日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="probation_months" label="试用期(月)" initialValue={3}>
                <InputNumber style={{ width: '100%' }} min={0} max={12} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="report_to" label="汇报对象">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="valid_until" label="有效期至">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="benefits" label="福利待遇">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="bonus" label="奖金说明">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="special_terms" label="特殊条款">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑Offer"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={() => editForm.submit()}
        width={700}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="salary_monthly" label="月薪(元)">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="salary_annual" label="年薪(元)">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="salary_structure" label="薪资结构说明">
            <TextArea rows={2} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="work_location" label="工作地点">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="work_hours" label="工作时间">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="onboard_date" label="入职日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="probation_months" label="试用期(月)">
                <InputNumber style={{ width: '100%' }} min={0} max={12} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="report_to" label="汇报对象">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="valid_until" label="有效期至">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="benefits" label="福利待遇">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="bonus" label="奖金说明">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="special_terms" label="特殊条款">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="发送Offer"
        open={sendModalVisible}
        onCancel={() => setSendModalVisible(false)}
        onOk={() => sendForm.submit()}
      >
        <Form form={sendForm} layout="vertical" onFinish={handleSend}>
          <Form.Item name="send_email" label="发送邮件通知" valuePropName="checked">
            <Select defaultValue={true}>
              <Option value={true}>是</Option>
              <Option value={false}>否</Option>
            </Select>
          </Form.Item>
          <Form.Item name="custom_message" label="自定义邮件内容">
            <TextArea rows={4} placeholder="可选，添加自定义消息内容" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="接受Offer"
        open={acceptModalVisible}
        onCancel={() => setAcceptModalVisible(false)}
        onOk={() => acceptForm.submit()}
      >
        <Form form={acceptForm} layout="vertical" onFinish={handleAccept}>
          <Form.Item name="accepted_salary" label="确认薪资(月薪)">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="accepted_onboard_date" label="确认入职日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="拒绝Offer"
        open={rejectModalVisible}
        onCancel={() => setRejectModalVisible(false)}
        onOk={() => rejectForm.submit()}
      >
        <Form form={rejectForm} layout="vertical" onFinish={handleReject}>
          <Form.Item name="reason" label="拒绝原因" rules={[{ required: true }]}>
            <Select>
              <Option value="薪资不满意">薪资不满意</Option>
              <Option value="接受其他offer">接受其他offer</Option>
              <Option value="工作地点不满意">工作地点不满意</Option>
              <Option value="个人原因">个人原因</Option>
              <Option value="其他">其他</Option>
            </Select>
          </Form.Item>
          <Form.Item name="feedback" label="候选人反馈">
            <TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="Offer详情"
        placement="right"
        width={600}
        onClose={() => setDetailDrawerVisible(false)}
        open={detailDrawerVisible}
      >
        {currentOffer && (
          <div>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="候选人" span={2}>
                <Text strong>{currentOffer.candidate_name}</Text>
                <br />
                <Text type="secondary">{currentOffer.candidate_email}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="岗位">{currentOffer.position_title}</Descriptions.Item>
              <Descriptions.Item label="部门">{currentOffer.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="月薪">
                {currentOffer.salary_monthly ? `${currentOffer.salary_monthly.toLocaleString()}元` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="年薪">
                {currentOffer.salary_annual ? `${currentOffer.salary_annual.toLocaleString()}元` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="工作地点">{currentOffer.work_location || '-'}</Descriptions.Item>
              <Descriptions.Item label="工作时间">{currentOffer.work_hours || '-'}</Descriptions.Item>
              <Descriptions.Item label="入职日期">
                {currentOffer.onboard_date ? dayjs(currentOffer.onboard_date).format('YYYY-MM-DD') : '待定'}
              </Descriptions.Item>
              <Descriptions.Item label="试用期">{currentOffer.probation_months}个月</Descriptions.Item>
              <Descriptions.Item label="汇报对象">{currentOffer.report_to || '-'}</Descriptions.Item>
              <Descriptions.Item label="有效期至">
                {currentOffer.valid_until ? dayjs(currentOffer.valid_until).format('YYYY-MM-DD') : '长期有效'}
              </Descriptions.Item>
              <Descriptions.Item label="状态" span={2}>
                <Tag color={statusConfig[currentOffer.status]?.color}>
                  {statusConfig[currentOffer.status]?.text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(currentOffer.created_at).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="发送时间">
                {currentOffer.sent_at ? dayjs(currentOffer.sent_at).format('YYYY-MM-DD HH:mm') : '-'}
              </Descriptions.Item>
              {currentOffer.accepted_at && (
                <Descriptions.Item label="接受时间">
                  {dayjs(currentOffer.accepted_at).format('YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
              )}
              {currentOffer.rejected_at && (
                <>
                  <Descriptions.Item label="拒绝时间">
                    {dayjs(currentOffer.rejected_at).format('YYYY-MM-DD HH:mm')}
                  </Descriptions.Item>
                  <Descriptions.Item label="拒绝原因" span={2}>
                    {currentOffer.rejected_reason}
                  </Descriptions.Item>
                </>
              )}
            </Descriptions>

            {currentOffer.salary_structure && (
              <>
                <Divider>薪资结构</Divider>
                <Text>{currentOffer.salary_structure}</Text>
              </>
            )}

            {currentOffer.benefits && (
              <>
                <Divider>福利待遇</Divider>
                <Text>{currentOffer.benefits}</Text>
              </>
            )}

            {currentOffer.bonus && (
              <>
                <Divider>奖金说明</Divider>
                <Text>{currentOffer.bonus}</Text>
              </>
            )}

            {currentOffer.special_terms && (
              <>
                <Divider>特殊条款</Divider>
                <Text>{currentOffer.special_terms}</Text>
              </>
            )}

            {currentOffer.notes && (
              <>
                <Divider>备注</Divider>
                <Text>{currentOffer.notes}</Text>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default OffersList;
