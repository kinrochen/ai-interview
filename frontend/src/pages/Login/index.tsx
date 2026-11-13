import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Spin } from "antd";
import {
  ArrowRightOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { isAxiosError } from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import request from "../../utils/request";
import "./style.css";

interface LoginValues {
  email: string;
  password: string;
}

export default function Login() {
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const submitting = useRef(false);
  const from = location.state?.from;
  const destination =
    typeof from?.pathname === "string" &&
    from.pathname.startsWith("/") &&
    !from.pathname.startsWith("//") &&
    from.pathname !== "/login"
      ? `${from.pathname}${from.search || ""}${from.hash || ""}`
      : "/dashboard";

  useEffect(() => {
    document.title = "登录 · AI Interview";
  }, []);
  useEffect(() => {
    if (!authLoading && isAuthenticated)
      navigate(destination, { replace: true });
  }, [authLoading, isAuthenticated, navigate, destination]);

  const onFinish = async (values: LoginValues) => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    try {
      const body = new URLSearchParams({
        username: values.email.trim(),
        password: values.password,
      });
      const response = await request.post("/auth/token", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      await login(response.access_token);
      navigate(destination, { replace: true });
    } catch (failure) {
      setError(
        isAxiosError(failure) && failure.response?.status === 401
          ? "邮箱或密码不正确，请检查后重新登录。"
          : "登录暂时未完成，请检查网络后重试。若账号已停用，请联系管理员。",
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section
        className="login-story"
        aria-label="AI Interview 智能招聘管理系统"
      >
        <div className="login-brand">
          <span className="login-brand-mark">
            ai
            <span />
          </span>
          <span>AI Interview</span>
        </div>
        <div className="login-story-content">
          <p className="login-product-label">智能招聘管理系统</p>
          <h1>
            让每一次面试，
            <br />
            都更有依据。
          </h1>
          <p className="login-story-description">
            从岗位需求到录用协作，
            <br />
            让团队专注于发现合适的人才。
          </p>
          <div className="login-pipeline" aria-label="招聘工作流程">
            {["岗位需求", "简历解析", "面试评估", "录用协作"].map((step) => (
              <div key={step}>
                <span aria-hidden="true" />
                {step}
              </div>
            ))}
          </div>
        </div>
        <p className="login-story-footer">
          AI Interview · 招聘团队的协作工作台
        </p>
      </section>
      <section className="login-form-panel" aria-labelledby="login-title">
        <div className="login-form-content">
          <div className="login-mobile-brand">AI Interview</div>
          <span className="login-welcome-icon" aria-hidden="true">
            <LockOutlined />
          </span>
          <h2 id="login-title">欢迎回来</h2>
          <p className="login-form-description">
            登录团队账号，继续今天的招聘工作。
          </p>
          {authLoading ? (
            <div className="login-session-loading" role="status">
              <Spin />
              <span>正在检查登录状态</span>
            </div>
          ) : (
            <Form<LoginValues>
              name="login"
              layout="vertical"
              noValidate
              scrollToFirstError
              onFinish={onFinish}
              disabled={loading}
              requiredMark={false}
            >
              {error && (
                <Alert
                  type="error"
                  showIcon
                  title={error}
                  className="login-error"
                />
              )}
              <Form.Item
                name="email"
                label="邮箱"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: "请输入账号邮箱",
                  },
                  { type: "email", message: "请输入有效的邮箱地址" },
                ]}
              >
                <Input
                  size="large"
                  type="email"
                  autoComplete="username"
                  prefix={<UserOutlined />}
                  placeholder="请输入账号邮箱"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: "请输入密码" }]}
              >
                <Input
                  size="large"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  prefix={<LockOutlined />}
                  placeholder="请输入登录密码"
                  suffix={
                    <Button
                      type="text"
                      size="small"
                      aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                      icon={
                        passwordVisible ? (
                          <EyeInvisibleOutlined />
                        ) : (
                          <EyeOutlined />
                        )
                      }
                      onClick={() => setPasswordVisible(!passwordVisible)}
                    />
                  }
                />
              </Form.Item>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                block
                loading={loading}
                icon={<ArrowRightOutlined />}
                iconPlacement="end"
                className="login-submit"
              >
                登录工作台
              </Button>
              <p className="login-account-help">
                账号由团队管理员分配。无法登录时，请联系管理员。
              </p>
            </Form>
          )}
        </div>
      </section>
    </main>
  );
}
