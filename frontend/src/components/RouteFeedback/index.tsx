import { useEffect } from "react";
import { Button, Result, Space, Spin } from "antd";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

export function RouteLoading() {
  return (
    <div className="route-feedback" role="status">
      <Spin size="large" />
      <span>正在加载页面…</span>
    </div>
  );
}

export function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请检查链接，或从导航中选择需要的页面。"
      extra={
        <Button type="primary" href="/dashboard">
          返回招聘概览
        </Button>
      }
    />
  );
}

export default function RouteError() {
  const error = useRouteError();
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  useEffect(() => {
    document.title = `${forbidden ? "访问受限" : "页面加载失败"} · AI Interview`;
  }, [forbidden]);
  return (
    <Result
      status={forbidden ? "403" : "error"}
      title={forbidden ? "当前账号没有访问权限" : "页面暂时无法加载"}
      subTitle={
        forbidden
          ? "请联系团队管理员，或返回可以访问的页面。"
          : "请检查网络后重新加载，或返回招聘概览继续工作。"
      }
      extra={
        <Space wrap>
          <Button onClick={() => window.location.reload()}>重新加载</Button>
          <Button type="primary" href="/dashboard">
            返回招聘概览
          </Button>
        </Space>
      }
    />
  );
}
