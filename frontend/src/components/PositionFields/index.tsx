import { Button, Col, Form, Input, InputNumber, Row, Select } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { JD_TEXT_LIMIT } from '../../utils/jdStream';

export interface HiringManager {
  id: string;
  full_name: string;
  email: string;
}

export interface PositionFormValues {
  title: string;
  department?: string;
  location?: string;
  salary_range?: string;
  headcount: number;
  position_type: string;
  urgency: string;
  hiring_manager_id?: string | null;
  description: string;
  requirements?: string;
  jd_guidance?: string;
  status: string;
}

export default function PositionFields({ users, onOpenJD }: { users: HiringManager[]; onOpenJD: () => void }) {
  return <>
    <Form.Item name="title" label="岗位名称" rules={[{ required: true, whitespace: true, message: '请输入岗位名称' }]}>
      <Input placeholder="例如：高级前端工程师" maxLength={200} size="large" />
    </Form.Item>
    <Row gutter={20}>
      <Col xs={24} sm={12}><Form.Item name="department" label="所属部门">
        <Input placeholder="例如：研发部" maxLength={200} size="large" />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="location" label="工作地点">
        <Input placeholder="例如：北京" maxLength={200} size="large" />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="salary_range" label="薪资范围">
        <Input placeholder="例如：20k-30k" maxLength={200} size="large" />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="headcount" label="招聘人数" rules={[{ required: true, type: 'integer', min: 1, message: '请输入至少 1 人的整数人数' }]}>
        <InputNumber min={1} precision={0} placeholder="1" size="large" style={{ width: '100%' }} />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="position_type" label="岗位类型">
        <Select size="large" options={[
          { value: 'full_time', label: '全职' }, { value: 'part_time', label: '兼职' },
          { value: 'contract', label: '合同' }, { value: 'internship', label: '实习' },
        ]} />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="urgency" label="紧急程度">
        <Select size="large" options={[
          { value: 'low', label: '低' }, { value: 'medium', label: '中' },
          { value: 'high', label: '高' }, { value: 'urgent', label: '紧急' },
        ]} />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="hiring_manager_id" label="招聘负责人">
        <Select size="large" allowClear placeholder="选择招聘负责人" showSearch optionFilterProp="label"
          options={users.map((user) => ({ value: user.id, label: `${user.full_name} (${user.email})` }))} />
      </Form.Item></Col>
      <Col xs={24} sm={12}><Form.Item name="status" label="状态">
        <Select size="large" options={[
          { value: 'open', label: '待发布' }, { value: 'published', label: '招聘中' }, { value: 'closed', label: '已关闭' }, { value: 'paused', label: '已暂停' }, { value: 'cancelled', label: '已取消' },
        ]} />
      </Form.Item></Col>
    </Row>
    <Form.Item name="jd_guidance" label="岗位要求（辅助 AI 生成 JD）"
      extra={<Button type="link" icon={<RobotOutlined />} onClick={onOpenJD}>AI 生成 / 优化 JD</Button>}
      rules={[{ max: JD_TEXT_LIMIT, message: `岗位要求最多 ${JD_TEXT_LIMIT} 字` }]}>
      <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }}
        placeholder="描述你想招聘什么样的人，例如负责企业级 AI 应用开发，需要熟悉 Python、RAG 和大模型接口，有项目落地经验。可补充工作重点、必备技能和加分项。"
        showCount maxLength={JD_TEXT_LIMIT} style={{ resize: 'none' }} />
    </Form.Item>
    <Form.Item name="description" label="岗位职责"
      rules={[{ required: true, whitespace: true, message: '请输入岗位职责' }, { max: JD_TEXT_LIMIT, message: `岗位职责最多 ${JD_TEXT_LIMIT} 字` }]}>
      <Input.TextArea autoSize={{ minRows: 5, maxRows: 16 }} placeholder="请输入详细的岗位职责描述" showCount maxLength={JD_TEXT_LIMIT} style={{ resize: 'none' }} />
    </Form.Item>
    <Form.Item name="requirements" label="任职要求" rules={[{ max: JD_TEXT_LIMIT, message: `任职要求最多 ${JD_TEXT_LIMIT} 字` }]}>
      <Input.TextArea autoSize={{ minRows: 5, maxRows: 16 }} placeholder="请输入任职资格要求" showCount maxLength={JD_TEXT_LIMIT} style={{ resize: 'none' }} />
    </Form.Item>
  </>;
}
