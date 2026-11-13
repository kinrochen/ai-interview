import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Modal, Typography, message } from 'antd';
import { useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import JDGeneratorModal from '../../components/JDGeneratorModal';
import PositionFields from '../../components/PositionFields';
import type { HiringManager, PositionFormValues } from '../../components/PositionFields';
import { getErrorMessage } from '../../utils/errors';

const PositionForm: React.FC = () => {
  const [form] = Form.useForm<PositionFormValues>();
  const jdGuidance = Form.useWatch('jd_guidance', form) || '';
  const navigate = useNavigate();
  const { id } = useParams();
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(Boolean(id));
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [users, setUsers] = useState<HiringManager[]>([]);
  const [jdModalVisible, setJdModalVisible] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savingRef = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savingRef.current && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload((event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const dialog = Modal.confirm({
      title: '放弃未保存的岗位内容？', content: '离开后，本次修改和已采纳的 JD 内容将丢失。',
      autoFocusButton: 'cancel',
      okText: '放弃修改', cancelText: '继续编辑', okType: 'danger',
      onOk: () => blocker.proceed(), onCancel: () => blocker.reset(),
    });
    return () => dialog.destroy();
  }, [blocker]);

  useEffect(() => {
    document.title = `${id ? '编辑岗位' : '新增岗位'} · AI Interview`;
    const controller = new AbortController();
    request.get('/auth/users', { signal: controller.signal }).then((result: HiringManager[]) => {
      if (!controller.signal.aborted) setUsers(result);
    }).catch(() => undefined);
    if (id) {
      request.get(`/positions/${id}`, { signal: controller.signal }).then((result: PositionFormValues) => {
        if (!controller.signal.aborted) {
          form.setFieldsValue(result);
          setLoadError('');
          setFetching(false);
        }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(getErrorMessage(error, '获取岗位详情失败'));
          setFetching(false);
        }
      });
    }
    return () => controller.abort();
  }, [id, retryKey, form]);

  const handleOpenJDModal = async () => {
    try {
      await form.validateFields(['title']);
      setJdModalVisible(true);
    } catch {
      form.scrollToField('title', { focus: true });
    }
  };

  const onFinish = async (values: PositionFormValues) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const payload = { ...values, title: values.title.trim(), hiring_manager_id: values.hiring_manager_id || null };
      // Generation guidance belongs to the form draft.
      delete payload.jd_guidance;
      if (id) await request.put(`/positions/${id}`, payload);
      else await request.post('/positions', payload);
      message.success(id ? '岗位已保存' : '岗位已创建');
      setDirty(false);
      navigate('/positions');
    } catch (error) {
      setSaveError(getErrorMessage(error, '保存岗位失败，请重试'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <div>
    <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/positions')} disabled={saving} style={{ marginBottom: 24 }}>返回列表</Button>
    <Card loading={fetching}>
      <Typography.Title level={4} style={{ marginBottom: 24 }}>{id ? '编辑岗位' : '新增岗位'}</Typography.Title>
      {loadError && <Alert type="error" showIcon title={loadError} style={{ marginBottom: 16 }} action={<Button onClick={() => setRetryKey((value) => value + 1)}>重试</Button>} />}
      {saveError && <Alert type="error" showIcon title={saveError} style={{ marginBottom: 16 }} />}
      <Form
        noValidate scrollToFirstError form={form} layout="vertical" onFinish={onFinish}
        onValuesChange={() => setDirty(true)} disabled={saving || fetching || Boolean(loadError)}
        initialValues={{ status: 'open', urgency: 'medium', position_type: 'full_time', headcount: 1 }}
        style={{ maxWidth: 800 }}
      >
        <PositionFields users={users} onOpenJD={handleOpenJDModal} />
        <Form.Item style={{ marginTop: 32 }}>
          <Button type="primary" htmlType="submit" loading={saving} size="large">保存岗位</Button>
          <Button style={{ marginLeft: 12 }} onClick={() => navigate('/positions')} size="large">取消</Button>
        </Form.Item>
      </Form>
    </Card>
    {jdModalVisible && <JDGeneratorModal
      visible onCancel={() => setJdModalVisible(false)}
      onConfirm={(description, requirements) => { form.setFieldsValue({ description, requirements }); setDirty(true); }}
      title={form.getFieldValue('title') || ''} department={form.getFieldValue('department')}
      location={form.getFieldValue('location')} salary_range={form.getFieldValue('salary_range')}
      position_type={form.getFieldValue('position_type')}
      current_description={form.getFieldValue('description')} current_requirements={form.getFieldValue('requirements')}
      generationRequirements={jdGuidance}
      onGenerationRequirementsChange={(value) => {
        form.setFieldValue('jd_guidance', value);
        setDirty(true);
      }}
    />}
  </div>;
};

export default PositionForm;
