import PositionOperations from "../Recruitment/PositionOperations";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import PageHeader from '../../components/PageHeader';
import React, { useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useSearchParams } from 'react-router-dom';
import { Table, Button, Space, message, Modal, Form, Input, Select, Tag, Tooltip, Typography, Drawer, Descriptions, Divider, Progress, Badge, Alert } from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, EyeOutlined, GlobalOutlined, StopOutlined, CopyOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import JDGeneratorModal from '../../components/JDGeneratorModal';
import PositionFields from '../../components/PositionFields';
import type { HiringManager, PositionFormValues } from '../../components/PositionFields';
import { getErrorMessage } from '../../utils/errors';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Title, Text } = Typography;

interface PositionStats {
  total_resumes: number;
  pending_screening: number;
  pending_interview: number;
  interview_completed: number;
  offer_pending: number;
  offer_accepted: number;
  rejected: number;
}

interface QuestionBankBrief {
  id: string;
  name: string;
  category: string;
  question_count: number;
}

interface Position {
  id: string;
  title: string;
  description: string;
  requirements: string | null;
  salary_range: string | null;
  location: string | null;
  department: string | null;
  status: string;
  urgency: string;
  position_type: string;
  headcount: number;
  hiring_manager_id: string | null;
  hiring_manager_name: string | null;
  created_at: string;
  updated_at: string;
  stats: PositionStats;
  linked_question_banks?: QuestionBankBrief[];
}

const urgencyConfig: Record<string, { color: string; text: string }> = {
  low: { color: 'default', text: '低' },
  medium: { color: 'warning', text: '中' },
  high: { color: 'orange', text: '高' },
  urgent: { color: 'red', text: '紧急' },
};

const positionTypeConfig: Record<string, { color: string; text: string }> = {
  full_time: { color: 'blue', text: '全职' },
  part_time: { color: 'cyan', text: '兼职' },
  contract: { color: 'purple', text: '合同' },
  internship: { color: 'green', text: '实习' },
};

const positiveInteger = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const PositionsList: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingRecord, setViewingRecord] = useState<Position | null>(null);
  const [form] = Form.useForm<PositionFormValues>();
  const jdGuidance = Form.useWatch('jd_guidance', form) || '';
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<HiringManager[]>([]);
  const [jdModalVisible, setJdModalVisible] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [searchParams, setSearchParams] = useSearchParams();
  const searchTitle = searchParams.get('title') || '';
  const searchStatus = searchParams.get('status') || undefined;
  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = Math.min(100, positiveInteger(searchParams.get('pageSize'), 10));
  const [composing, setComposing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const saving = useRef(false);
  const dirty = useRef(false);
  const immediateSearch = useRef(false);
  const fetchPositions = () => setRefreshKey((value) => value + 1);
  useBeforeUnload((event) => {
    if (isModalVisible && dirty.current) { event.preventDefault(); event.returnValue = ''; }
  });

  const updateFilters = (values: Record<string, string | undefined>) => {
    setSelectedRowKeys([]);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!('page' in values)) next.set('page', '1');
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    if (composing) return;
    const controller = new AbortController();
    const delay = searchTitle && !immediateSearch.current ? 300 : 0;
    immediateSearch.current = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setListError('');
      try {
        const response = await request.get('/positions/page', {
          params: { title: searchTitle.trim(), status: searchStatus, skip: (page - 1) * pageSize, limit: pageSize },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(response.total / pageSize));
        if (page > lastPage) {
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set('page', String(lastPage));
            return next;
          }, { replace: true });
          return;
        }
        setData(response.items);
        setTotal(response.total);
        const ids = new Set(response.items.map((item: Position) => item.id));
        setSelectedRowKeys((previous) => previous.filter((id) => ids.has(id)));
      } catch (error) {
        if (!controller.signal.aborted) {
          setListError(getErrorMessage(error, '获取岗位列表失败，请重试'));
          setData([]);
          setTotal(0);
          setSelectedRowKeys([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, delay);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchTitle, searchStatus, page, pageSize, refreshKey, composing, setSearchParams]);

  useEffect(() => {
    document.title = '岗位管理 · AI Interview';
    const controller = new AbortController();
    request.get('/auth/users', { signal: controller.signal }).then((users: HiringManager[]) => {
      if (!controller.signal.aborted) setUsers(users);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const handleAdd = () => {
    dirty.current = false;
    setEditingId(null);
    setSaveError('');
    form.resetFields();
    form.setFieldsValue({ status: 'open', urgency: 'medium', position_type: 'full_time', headcount: 1 });
    setIsModalVisible(true);
  };

  const handleEdit = async (record: Position) => {
    try {
      const res = await request.get(`/positions/${record.id}`);
      form.resetFields();
      form.setFieldsValue(res);
      dirty.current = false;
      setEditingId(record.id);
      setSaveError('');
      setIsModalVisible(true);
    } catch (error) {
      message.error(getErrorMessage(error, '获取岗位详情失败'));
    }
  };

  const handleView = async (record: Position) => {
    try {
      const res = await request.get(`/positions/${record.id}`);
      setViewingRecord(res);
      setIsDrawerVisible(true);
    } catch (error) {
      message.error(getErrorMessage(error, '获取岗位详情失败'));
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个岗位吗？',
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.delete(`/positions/${id}`);
          message.success('删除成功');
          fetchPositions();
        } catch (error) {
          message.error(getErrorMessage(error, '删除失败'));
          throw error;
        }
      },
    });
  };

  const handleBatch = (action: 'delete' | 'publish' | 'unpublish') => {
    if (!selectedRowKeys.length || batchBusy) return;
    const ids = [...selectedRowKeys];
    const label = { delete: '删除', publish: '发布', unpublish: '下架' }[action];
    Modal.confirm({
      title: `批量${label}岗位`,
      content: `确定${label}选中的 ${ids.length} 个岗位吗？${action === 'delete' ? '有关联简历或题库的岗位无法删除。' : ''}`,
      okText: label, cancelText: '取消', okType: action === 'delete' ? 'danger' : 'primary',
      onOk: async () => {
        setBatchBusy(true);
        setOperationError('');
        try {
          const results = await Promise.allSettled(ids.map((id) => action === 'delete'
            ? request.delete(`/positions/${id}`)
            : request.put(`/positions/${id}`, { status: action === 'publish' ? 'published' : 'closed' })));
          const failed = results.flatMap((result, index) => result.status === 'rejected' ? [{
            id: ids[index], reason: getErrorMessage(result.reason, '操作失败'),
          }] : []);
          setSelectedRowKeys(failed.map((item) => item.id));
          if (failed.length) {
            setOperationError(`已${label} ${ids.length - failed.length} 个，${failed.length} 个失败：${[...new Set(failed.map((item) => item.reason))].join('；')}`);
          } else message.success(`成功${label} ${ids.length} 个岗位`);
          fetchPositions();
        } finally {
          setBatchBusy(false);
        }
      },
    });
  };

  const handlePublish = async (id: string, publish: boolean) => {
    try {
      await request.put(`/positions/${id}`, { status: publish ? 'published' : 'closed' });
      message.success(publish ? '岗位已发布' : '岗位已下架');
      fetchPositions();
    } catch (error) {
      message.error(getErrorMessage(error, '操作失败'));
    }
  };

  const handleCopyLink = (id: string) => {
    const url = `${window.location.origin}/public/jobs/${id}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        message.success('岗位链接已复制');
      }).catch(() => message.error('复制失败，请检查浏览器剪贴板权限'));
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
        if (!document.execCommand('copy')) throw new Error('copy failed');
        message.success('岗位链接已复制');
      } catch {
        message.error('复制失败');
      }
      document.body.removeChild(textArea);
    }
  };

  const handleOpenJDModal = async () => {
    try {
      const values = await form.validateFields(['title']);
      if (!values.title) {
        message.error('请先填写岗位名称');
        return;
      }
      setJdModalVisible(true);
    } catch {
      message.error('请先填写岗位名称');
    }
  };

  const handleJDConfirm = (description: string, requirements: string) => {
    dirty.current = true;
    form.setFieldsValue({
      description,
      requirements
    });
  };

  const closeEditor = () => {
    if (saving.current) return;
    if (!dirty.current) { setIsModalVisible(false); return; }
    Modal.confirm({
      title: '放弃未保存的岗位内容？', content: '本次修改和已采纳的 JD 内容将丢失。',
      autoFocusButton: 'cancel',
      okText: '放弃修改', cancelText: '继续编辑', okType: 'danger',
      onOk: () => { dirty.current = false; setIsModalVisible(false); },
    });
  };

  const handleOk = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      let values: PositionFormValues;
      try {
        values = await form.validateFields();
      } catch {
        const firstError = form.getFieldsError().find((field) => field.errors.length);
        if (firstError) form.scrollToField(firstError.name, { focus: true });
        return;
      }
      setSubmitting(true);
      setSaveError('');
      const payload = { ...values, title: values.title.trim(), hiring_manager_id: values.hiring_manager_id || null };
      // Generation guidance belongs to the form draft.
      delete payload.jd_guidance;
      if (editingId) await request.put(`/positions/${editingId}`, payload);
      else await request.post('/positions', payload);
      message.success(editingId ? '岗位已保存' : '岗位已创建');
      dirty.current = false;
      setIsModalVisible(false);
      fetchPositions();
    } catch (error) {
      setSaveError(getErrorMessage(error, '保存岗位失败，请重试'));
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  const renderStats = (stats: PositionStats | undefined) => {
    if (!stats) return <Text type="secondary">-</Text>;
    const total = stats.total_resumes || 0;
    if (total === 0) return <Text type="secondary">暂无简历</Text>;
    
    return (
      <Tooltip title={
        <div>
          <div>待筛选: {stats.pending_screening}</div>
          <div>待面试: {stats.pending_interview}</div>
          <div>面试完成: {stats.interview_completed}</div>
          <div>Offer待定: {stats.offer_pending}</div>
          <div>已入职: {stats.offer_accepted}</div>
          <div>已淘汰: {stats.rejected}</div>
        </div>
      }>
        <Space size={4}>
          <Badge count={total} style={{ backgroundColor: '#3B82F6' }} />
          <Progress 
            percent={Math.round((stats.offer_accepted / total) * 100) || 0} 
            size="small" 
            style={{ width: 60 }}
            showInfo={false}
            strokeColor="#10B981"
          />
        </Space>
      </Tooltip>
    );
  };

  const columns = [
    { 
      title: '岗位名称',
      dataIndex: 'title', 
      key: 'title',
      render: (text: string) => <span style={{ fontWeight: 500, color: '#0F172A' }}>{text}</span>
    },
    { title: '部门', dataIndex: 'department', key: 'department', render: (v: string) => v || '-' },
    { 
      title: '类型', 
      dataIndex: 'position_type', 
      key: 'position_type',
      render: (type: string) => {
        const config = positionTypeConfig[type] || { color: 'default', text: type };
        return <Tag color={config.color} style={{ border: 'none' }}>{config.text}</Tag>;
      }
    },
    { 
      title: '紧急度', 
      dataIndex: 'urgency', 
      key: 'urgency',
      render: (urgency: string) => {
        const config = urgencyConfig[urgency] || { color: 'default', text: urgency };
        return <Tag color={config.color} style={{ border: 'none' }}>{config.text}</Tag>;
      }
    },
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => {
        let color = 'default';
        let text = '已关闭';
        if (status === 'open') {
            color = 'warning';
            text = '待发布';
        } else if (status === 'published') {
            color = 'processing';
            text = '招聘中';
        }
        if (status === 'paused') { color = 'warning'; text = '已暂停'; }
        if (status === 'cancelled') { color = 'default'; text = '已取消'; }
        return <Tag color={color} style={{ border: 'none' }}>{text}</Tag>;
      }
    },
    { 
      title: '招聘进度', 
      key: 'stats',
      render: (_: unknown, record: Position) => renderStats(record.stats)
    },
    { 
      title: '创建时间', 
      dataIndex: 'created_at', 
      key: 'created_at',
      render: (date: string) => <span style={{ color: '#64748B' }}>{new Date(date).toLocaleDateString()}</span>
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Position) => (
        <Space size="small">
          <PositionOperations id={record.id} title={record.title} status={record.status} onChange={fetchPositions} />
          <Tooltip title="查看详情">
            <Button aria-label={`查看 ${record.title}`} type="text" icon={<EyeOutlined style={{ color: '#3B82F6' }} />} onClick={() => handleView(record)} />
          </Tooltip>
          {record.status === 'published' ? (
             <Tooltip title="下架岗位">
                <Button aria-label={`下架 ${record.title}`} type="text" icon={<StopOutlined style={{ color: '#EF4444' }} />} onClick={() => handlePublish(record.id, false)} />
             </Tooltip>
          ) : record.status === 'open' ? (
             <Tooltip title="发布岗位">
                <Button aria-label={`发布 ${record.title}`} type="text" icon={<GlobalOutlined style={{ color: '#10B981' }} />} onClick={() => handlePublish(record.id, true)} />
             </Tooltip>
          ) : null}
          {record.status === 'published' && (
             <Tooltip title="复制链接">
                <Button aria-label={`复制 ${record.title} 的链接`} type="text" icon={<CopyOutlined />} onClick={() => handleCopyLink(record.id)} />
             </Tooltip>
          )}
          <Tooltip title="编辑">
            <Button aria-label={`编辑 ${record.title}`} type="text" icon={<EditOutlined style={{ color: '#64748B' }} />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button aria-label={`删除 ${record.title}`} type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="岗位管理" description="维护岗位需求，发布招聘机会并跟进候选人进展。" actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增岗位</Button>
      } />
      {user?.role === "admin" && <div style={{ marginBottom: 16 }}><Link to="/positions/archive">已归档岗位</Link></div>}
      <div className="filter-toolbar">
          <Input 
              placeholder="搜索岗位名称" 
              prefix={<SearchOutlined style={{ color: 'var(--text-tertiary)' }} />}
              style={{ width: 300 }} 
              allowClear
              value={searchTitle}
              aria-label="搜索岗位名称"
              onChange={(event) => updateFilters({ title: event.target.value })}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onPressEnter={(event) => {
                if (!event.nativeEvent.isComposing && !composing) { immediateSearch.current = true; fetchPositions(); }
              }}
          />
          <Select
              placeholder="岗位状态"
              style={{ width: 150 }}
              allowClear
              value={searchStatus}
              aria-label="岗位状态"
              onChange={(value) => updateFilters({ status: value })}
          >
              <Select.Option value="open">待发布</Select.Option>
              <Select.Option value="published">招聘中</Select.Option>
              <Select.Option value="paused">已暂停</Select.Option>
              <Select.Option value="cancelled">已取消</Select.Option>
              <Select.Option value="closed">已关闭</Select.Option>
          </Select>
          {selectedRowKeys.length > 0 && (
            <Space wrap>
              <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
              <Button disabled={batchBusy} onClick={() => handleBatch('publish')} type="primary" ghost>批量发布</Button>
              <Button disabled={batchBusy} onClick={() => handleBatch('unpublish')}>批量下架</Button>
              <Button danger disabled={batchBusy} onClick={() => handleBatch('delete')}>批量删除</Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          )}
      </div>
      
      {listError && <Alert type="error" showIcon title={listError} style={{ marginBottom: 16 }} action={<Button onClick={fetchPositions}>重试</Button>} />}
      {operationError && <Alert type="warning" showIcon title={operationError} style={{ marginBottom: 16 }} closable onClose={() => setOperationError('')} />}
      <p className="table-overflow-hint">左右滑动表格查看完整岗位信息与操作</p>
      <Table
        columns={columns} 
        dataSource={data} 
        loading={loading} 
        rowKey="id" 
        scroll={{ x: 1000 }}
        locale={{ emptyText: listError ? '岗位列表加载失败，请点击重试' : searchTitle || searchStatus ? '没有符合条件的岗位' : '暂无岗位，点击「新增岗位」开始创建' }}
        pagination={{
          current: page, pageSize, total, showSizeChanger: true,
          showTotal: (count) => `共 ${count} 个岗位`,
          onChange: (current, size) => updateFilters({ page: String(size !== pageSize ? 1 : current), pageSize: String(size) }),
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          getTitleCheckboxProps: () => ({ 'aria-label': '选择本页岗位', title: '选择本页岗位' }),
          getCheckboxProps: (record) => ({ 'aria-label': `选择 ${record.title}`, title: record.title }),
        }}
      />

      <Modal
        title={editingId ? '编辑岗位' : '新增岗位'}
        open={isModalVisible}
        onOk={handleOk}
        onCancel={closeEditor}
        maskClosable={false}
        cancelButtonProps={{ disabled: submitting }}
        confirmLoading={submitting}
        width={800}
        centered
        destroyOnHidden
        okText="保存"
        cancelText="取消"
      >
        {saveError && <Alert type="error" showIcon title={saveError} />}
        <Form
          noValidate
          scrollToFirstError
          disabled={submitting}
          onValuesChange={() => { dirty.current = true; }}
          form={form}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
          <PositionFields users={users} onOpenJD={handleOpenJDModal} />
        </Form>
      </Modal>

      {jdModalVisible && <JDGeneratorModal
        visible={jdModalVisible}
        onCancel={() => setJdModalVisible(false)}
        onConfirm={handleJDConfirm}
        title={form.getFieldValue('title') || ''}
        department={form.getFieldValue('department')}
        location={form.getFieldValue('location')}
        salary_range={form.getFieldValue('salary_range')}
        position_type={form.getFieldValue('position_type')}
        current_description={form.getFieldValue('description')}
        current_requirements={form.getFieldValue('requirements')}
        generationRequirements={jdGuidance}
        onGenerationRequirementsChange={(value) => {
          form.setFieldValue('jd_guidance', value);
          dirty.current = true;
        }}
      />}

      <Drawer
        title="岗位详情"
        width={800}
        onClose={() => setIsDrawerVisible(false)}
        open={isDrawerVisible}
        extra={
          <Space>
            <Button onClick={() => {
              setIsDrawerVisible(false);
              if (viewingRecord) handleEdit(viewingRecord);
            }}>编辑</Button>
            <Button type="primary" onClick={() => setIsDrawerVisible(false)}>关闭</Button>
          </Space>
        }
      >
        {viewingRecord && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <Title level={3} style={{ margin: 0 }}>{viewingRecord.title}</Title>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Tag color={viewingRecord.status === 'published' ? 'processing' : 'default'} style={{ border: 'none' }}>
                  {viewingRecord.status === 'published' ? '招聘中' : viewingRecord.status === 'open' ? '待发布' : '已关闭'}
                </Tag>
                <Tag color={urgencyConfig[viewingRecord.urgency]?.color || 'default'} style={{ border: 'none' }}>
                  {urgencyConfig[viewingRecord.urgency]?.text || viewingRecord.urgency}
                </Tag>
                <Tag color={positionTypeConfig[viewingRecord.position_type]?.color || 'default'} style={{ border: 'none' }}>
                  {positionTypeConfig[viewingRecord.position_type]?.text || viewingRecord.position_type}
                </Tag>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  创建于 {new Date(viewingRecord.created_at).toLocaleDateString()}
                </Text>
              </div>
            </div>

            <Descriptions column={2} size="middle" labelStyle={{ color: '#64748B' }} contentStyle={{ fontWeight: 500, color: '#0F172A' }}>
              <Descriptions.Item label="所属部门">{viewingRecord.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="工作地点">{viewingRecord.location || '-'}</Descriptions.Item>
              <Descriptions.Item label="薪资范围">{viewingRecord.salary_range || '-'}</Descriptions.Item>
              <Descriptions.Item label="招聘人数">{viewingRecord.headcount || 1} 人</Descriptions.Item>
              <Descriptions.Item label="招聘负责人">{viewingRecord.hiring_manager_name || '-'}</Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>招聘进度</Title>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">总简历</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#3B82F6' }}>{viewingRecord.stats?.total_resumes || 0}</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">待筛选</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#F59E0B' }}>{viewingRecord.stats?.pending_screening || 0}</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">待面试</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#8B5CF6' }}>{viewingRecord.stats?.pending_interview || 0}</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">已入职</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#10B981' }}>{viewingRecord.stats?.offer_accepted || 0}</div>
                </div>
              </div>
            </div>

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>岗位职责</Title>
              <div style={{ 
                background: '#F8FAFC', 
                padding: '16px', 
                borderRadius: '8px', 
                color: '#334155',
                lineHeight: 1.8
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {viewingRecord.description || '暂无描述'}
                </ReactMarkdown>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>任职要求</Title>
              <div style={{ 
                background: '#F8FAFC', 
                padding: '16px', 
                borderRadius: '8px', 
                color: '#334155',
                lineHeight: 1.8
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {viewingRecord.requirements || '暂无要求'}
                </ReactMarkdown>
              </div>
            </div>

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>关联题库</Title>
              {viewingRecord.linked_question_banks && viewingRecord.linked_question_banks.length > 0 ? (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {viewingRecord.linked_question_banks.map((bank: QuestionBankBrief) => (
                    <div 
                      key={bank.id}
                      style={{ 
                        background: '#F8FAFC', 
                        padding: '12px 16px', 
                        borderRadius: 8,
                        border: '1px solid #E2E8F0',
                        minWidth: 200
                      }}
                    >
                      <div style={{ fontWeight: 500, color: '#0F172A' }}>{bank.name}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <Tag color="blue" style={{ border: 'none', margin: 0 }}>{bank.category}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{bank.question_count} 道题</Text>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ 
                  background: '#F8FAFC', 
                  padding: '16px', 
                  borderRadius: '8px', 
                  color: '#64748B',
                  textAlign: 'center'
                }}>
                  暂无关联题库，可在题库管理中关联到此岗位
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default PositionsList;
