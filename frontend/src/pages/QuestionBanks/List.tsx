import PageHeader from '../../components/PageHeader';
import React, { useEffect, useState } from 'react';
import { Table, Button, Space, message, Tag, Modal, Form, Input, Select, Upload, Tooltip, Typography, Drawer, Divider, Spin } from 'antd';
import { PlusOutlined, UploadOutlined, DeleteOutlined, EyeOutlined, DownloadOutlined, FileWordOutlined, FileTextOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mammoth from 'mammoth';

const { Title, Text } = Typography;

const QuestionBanksList: React.FC = () => {
  const [data, setData] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  // File Preview State
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string>('');

  const fetchQuestionBanks = async () => {
    setLoading(true);
    try {
      const res = await request.get('/question-banks');
      setData(res);
    } catch (error) {
      message.error('获取题库列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchPositions = async () => {
    try {
      const res = await request.get('/positions');
      setPositions(res);
    } catch (error) {
      console.error('获取岗位列表失败');
    }
  };

  useEffect(() => {
    fetchQuestionBanks();
    fetchPositions();
  }, []);

  useEffect(() => {
    if (isDrawerVisible && viewingRecord?.source_file) {
      loadFile(viewingRecord.source_file);
    }
  }, [isDrawerVisible, viewingRecord]);

  const loadFile = async (filePath: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setDocxHtml('');
    const ext = filePath.split('.').pop()?.toLowerCase();
    const url = `/${filePath}`;
    
    try {
      if (ext === 'md' || ext === 'txt') {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const text = await res.text();
        setFileContent(text);
      } else if (ext === 'docx') {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setDocxHtml(result.value);
        if (result.messages.length > 0) {
          console.log('Mammoth warnings:', result.messages);
        }
      }
    } catch (err) {
      console.error('File load error:', err);
      setPreviewError(`文件加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAdd = () => {
    form.resetFields();
    setFileList([]);
    form.setFieldsValue({ category: 'technical', difficulty: 'intermediate' });
    setIsModalVisible(true);
  };

  const handleView = async (record: any) => {
    try {
      const res = await request.get(`/question-banks/${record.id}`);
      setViewingRecord(res);
      setFileContent(null);
      setPreviewError(null);
      setDocxHtml('');
      setIsDrawerVisible(true);
    } catch (error) {
      message.error('获取题库详情失败');
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个题库吗？',
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.delete(`/question-banks/${id}`);
          message.success('删除成功');
          fetchQuestionBanks();
        } catch (error: any) {
          const errorMsg = error?.response?.data?.detail || '删除失败';
          message.error(errorMsg);
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的题库');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个题库吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/question-banks/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个题库`);
          setSelectedRowKeys([]);
          fetchQuestionBanks();
        } catch (error: any) {
          const errorMsg = error?.response?.data?.detail || '批量删除失败';
          message.error(errorMsg);
        }
      },
    });
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (fileList.length === 0) {
        message.error('请上传题库文件');
        return;
      }

      setSubmitting(true);
      const formData = new FormData();
      formData.append('name', values.name);
      formData.append('category', values.category);
      formData.append('difficulty', values.difficulty);
      formData.append('position_id', values.position_id);
      if (values.tags) {
        formData.append('tags', values.tags.join(','));
      }
      formData.append('file', fileList[0]);

      await request.post('/question-banks', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      message.success('上传成功');
      setIsModalVisible(false);
      fetchQuestionBanks();
    } catch (error) {
      // message.error('上传失败');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadProps = {
    onRemove: (file: any) => {
      setFileList([]);
    },
    beforeUpload: (file: any) => {
      setFileList([file]);
      return false;
    },
    fileList,
  };

  const columns = [
    { 
      title: '题库名称', 
      dataIndex: 'name', 
      key: 'name',
      render: (text: string) => <span style={{ fontWeight: 500, color: '#0F172A' }}>{text}</span>
    },
    { 
      title: '分类', 
      dataIndex: 'category', 
      key: 'category',
      render: (category: string) => {
        const colors: Record<string, string> = {
          technical: 'blue',
          management: 'purple',
          hr: 'cyan',
          other: 'default'
        };
        const labels: Record<string, string> = {
          technical: '技术',
          management: '管理',
          hr: '人力资源',
          other: '其他'
        };
        return <Tag color={colors[category] || 'default'} style={{ border: 'none' }}>{labels[category] || category}</Tag>;
      }
    },
    { 
      title: '难度', 
      dataIndex: 'difficulty', 
      key: 'difficulty',
      render: (difficulty: string) => {
        const colors: Record<string, string> = {
          junior: 'green',
          intermediate: 'orange',
          senior: 'red'
        };
        const labels: Record<string, string> = {
          junior: '初级',
          intermediate: '中级',
          senior: '高级'
        };
        return <Tag color={colors[difficulty] || 'default'} style={{ border: 'none' }}>{labels[difficulty] || difficulty}</Tag>;
      }
    },
    { 
      title: '标签', 
      dataIndex: 'tags', 
      key: 'tags',
      render: (tags: string[]) => (
        <>
          {tags && tags.map(tag => (
            <Tag key={tag} style={{ border: 'none', background: '#F1F5F9', color: '#64748B' }}>
              {tag}
            </Tag>
          ))}
        </>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: any) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button type="text" icon={<EyeOutlined style={{ color: '#3B82F6' }} />} onClick={() => handleView(record)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const renderFilePreview = (fileUrl: string) => {
    if (!fileUrl) return <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>暂无文件</div>;
    
    const ext = fileUrl.split('.').pop()?.toLowerCase();
    
    if (previewLoading) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 8, color: '#64748B' }}>加载预览中...</div>
        </div>
      );
    }

    if (previewError) {
      return (
        <div style={{ 
          height: '300px', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#F8FAFC',
          borderRadius: '8px',
          border: '1px dashed #E2E8F0'
        }}>
          <FileWordOutlined style={{ fontSize: '64px', color: '#94A3B8', marginBottom: '16px' }} />
          <Text type="secondary" style={{ marginBottom: '16px' }}>{previewError}</Text>
          <Button type="primary" icon={<DownloadOutlined />} href={fileUrl} download>
            下载文件查看
          </Button>
        </div>
      );
    }

    if (ext === 'pdf') {
      return (
        <iframe 
          src={fileUrl} 
          style={{ width: '100%', height: 'calc(100vh - 250px)', border: 'none', borderRadius: '8px' }} 
          title="PDF Preview"
        />
      );
    }
    
    if (ext === 'md') {
      return (
        <div className="markdown-body" style={{ padding: '24px', background: '#fff', height: 'calc(100vh - 250px)', overflowY: 'auto' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {fileContent || ''}
          </ReactMarkdown>
        </div>
      );
    }

    if (ext === 'txt') {
      return (
        <pre style={{ 
          padding: '24px', 
          background: '#fff', 
          height: 'calc(100vh - 250px)', 
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#334155'
        }}>
          {fileContent || ''}
        </pre>
      );
    }

    if (ext === 'docx') {
      if (previewLoading) {
        return (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Spin size="large" />
            <div style={{ marginTop: 8, color: '#64748B' }}>加载预览中...</div>
          </div>
        );
      }
      if (previewError) {
        return (
          <div style={{ 
            height: '300px', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
          }}>
            <FileWordOutlined style={{ fontSize: '64px', color: '#94A3B8', marginBottom: '16px' }} />
            <Text type="secondary" style={{ marginBottom: '16px' }}>{previewError}</Text>
            <Button type="primary" icon={<DownloadOutlined />} href={fileUrl} download>
              下载文件查看
            </Button>
          </div>
        );
      }
      if (!docxHtml) {
        return (
          <div style={{ 
            height: '300px', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
          }}>
            <FileWordOutlined style={{ fontSize: '64px', color: '#94A3B8', marginBottom: '16px' }} />
            <Text type="secondary" style={{ marginBottom: '16px' }}>Word 文档无法预览，请下载后查看</Text>
            <Button type="primary" icon={<DownloadOutlined />} href={fileUrl} download>
              下载文件查看
            </Button>
          </div>
        );
      }
      return (
        <div 
          style={{ 
            background: '#fff', 
            padding: '24px', 
            minHeight: 'calc(100vh - 250px)', 
            overflowY: 'auto' 
          }}
          dangerouslySetInnerHTML={{ __html: docxHtml }}
        />
      );
    }
    
    // For doc (old format) and others
    let Icon = FileTextOutlined;
    if (ext === 'doc') Icon = FileWordOutlined;
    
    return (
      <div style={{ 
        height: '300px', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#F8FAFC',
        borderRadius: '8px',
        border: '1px dashed #E2E8F0'
      }}>
        <Icon style={{ fontSize: '64px', color: '#94A3B8', marginBottom: '16px' }} />
        <Text type="secondary" style={{ marginBottom: '16px' }}>该文件格式暂不支持在线预览</Text>
        <Button type="primary" icon={<DownloadOutlined />} href={fileUrl} download>
          下载文件查看
        </Button>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="题库管理" description="沉淀专业题目与知识库，为每轮面试做好准备。" actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>上传题库</Button>
      } />
      {selectedRowKeys.length > 0 && <div className="filter-toolbar">
        <span>已选 {selectedRowKeys.length} 项</span><Button danger onClick={handleBatchDelete}>批量删除</Button><Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
      </div>}
      <p className="table-overflow-hint">左右滑动表格查看完整题库信息与操作</p>
      <Table
        scroll={{ x: 960 }}
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

      <Modal
        title="上传题库"
        open={isModalVisible}
        onOk={handleOk}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={submitting}
        width={600}
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
            name="name"
            label="题库名称"
            rules={[{ required: true, message: '请输入题库名称' }]}
          >
            <Input placeholder="例如：Java面试题库2024" size="large" />
          </Form.Item>

          <Form.Item
            name="position_id"
            label="关联岗位"
            rules={[{ required: true, message: '请选择关联岗位' }]}
          >
            <Select placeholder="请选择关联岗位" size="large">
              {positions.map((pos: any) => (
                <Select.Option key={pos.id} value={pos.id}>{pos.title}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Form.Item
              name="category"
              label="分类"
              rules={[{ required: true, message: '请选择分类' }]}
            >
              <Select size="large">
                <Select.Option value="technical">技术</Select.Option>
                <Select.Option value="management">管理</Select.Option>
                <Select.Option value="hr">人力资源</Select.Option>
                <Select.Option value="other">其他</Select.Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="difficulty"
              label="难度"
              rules={[{ required: true, message: '请选择难度' }]}
            >
              <Select size="large">
                <Select.Option value="junior">初级</Select.Option>
                <Select.Option value="intermediate">中级</Select.Option>
                <Select.Option value="senior">高级</Select.Option>
              </Select>
            </Form.Item>
          </div>

          <Form.Item
            name="tags"
            label="标签"
          >
            <Select mode="tags" style={{ width: '100%' }} placeholder="请输入标签，回车确认" size="large" />
          </Form.Item>

          <Form.Item
            name="file"
            label="题库文件"
            rules={[{ required: true, message: '请上传文件' }]}
            extra="支持 PDF, Word, Txt 格式"
          >
            <Upload {...uploadProps} maxCount={1}>
              <Button icon={<UploadOutlined />} size="large">选择文件</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="题库详情"
        width={800}
        onClose={() => setIsDrawerVisible(false)}
        open={isDrawerVisible}
      >
        {viewingRecord && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Title level={3} style={{ margin: 0 }}>{viewingRecord.name}</Title>
                  <div style={{ marginTop: 8 }}>
                    <Tag color="blue">{
                      {
                        technical: '技术',
                        management: '管理',
                        hr: '人力资源',
                        other: '其他'
                      }[viewingRecord.category] || viewingRecord.category
                    }</Tag>
                    <Tag color="orange">{
                      {
                        junior: '初级',
                        intermediate: '中级',
                        senior: '高级'
                      }[viewingRecord.difficulty] || viewingRecord.difficulty
                    }</Tag>
                    {viewingRecord.tags && viewingRecord.tags.map((tag: string) => (
                      <Tag key={tag} style={{ border: 'none', background: '#F1F5F9', color: '#64748B' }}>{tag}</Tag>
                    ))}
                  </div>
                </div>
                {viewingRecord.source_file && (
                   <Button icon={<DownloadOutlined />} href={`/${viewingRecord.source_file}`} download>
                     下载原文件
                   </Button>
                )}
              </div>
            </div>

            <Divider style={{ borderColor: '#E2E8F0' }} />
            
            <Title level={5} style={{ marginBottom: 16 }}>文件预览</Title>
            
            <div style={{ border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
              {renderFilePreview(viewingRecord.source_file ? `/${viewingRecord.source_file}` : '')}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default QuestionBanksList;
