import { Suspense, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import {
  ApartmentOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ArrowLeftOutlined,
  BankOutlined,
  CodeOutlined,
  DashboardOutlined,
  DownOutlined,
  FileAddOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Link,
  matchPath,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import "./style.css";
import { RouteLoading } from "../RouteFeedback";

const navigation = [
  { path: "/workbench", label: "我的工作台", icon: <CheckSquareOutlined />, group: "工作台" },
  { path: "/interviews/calendar", label: "面试日历", icon: <CalendarOutlined />, group: "工作台" },
  { path: "/recruitment-quality", label: "招聘质量", icon: <CheckSquareOutlined />, group: "工作台", roles: ["admin", "hr"] },
  {
    path: "/dashboard",
    label: "招聘概览",
    roles: ["admin", "hr"],
    icon: <DashboardOutlined />,
    group: "工作台",
  },
  {
    path: "/positions",
    label: "岗位管理",
    icon: <BankOutlined />,
    group: "招聘管理",
    roles: ["admin", "hr"],
  },
  {
    path: "/resumes",
    label: "简历管理",
    icon: <FileTextOutlined />,
    group: "招聘管理",
  },
  {
    path: "/interviews",
    label: "面试管理",
    icon: <TeamOutlined />,
    group: "招聘管理",
  },
  {
    path: "/offers",
    label: "Offer 管理",
    icon: <FileAddOutlined />,
    group: "招聘管理",
    roles: ["admin", "hr"],
  },
  {
    path: "/question-banks",
    label: "题库管理",
    icon: <BankOutlined />,
    group: "评估与协作",
    roles: ["admin", "hr"],
  },
  {
    path: "/coding-tests",
    label: "笔试管理",
    icon: <CodeOutlined />,
    group: "评估与协作",
    roles: ["admin", "hr"],
  },
  {
    path: "/workflows",
    label: "工作流",
    icon: <ApartmentOutlined />,
    group: "评估与协作",
  },
  {
    path: "/offers/templates",
    label: "Offer 模板",
    icon: <FileTextOutlined />,
    group: "系统配置",
    roles: ["admin", "hr"],
  },
  { path: "/settings/system", label: "系统设置", icon: <SettingOutlined />, group: "系统配置", roles: ["admin"] },
  {
    path: "/settings/users",
    label: "用户管理",
    icon: <SettingOutlined />,
    group: "系统配置",
    roles: ["admin"],
  },
];
const roleLabels = { admin: "管理员", hr: "HR", interviewer: "面试官" };

function currentPage(pathname: string) {
  const parent = navigation
    .filter(
      (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  const specialPages: Record<string, string> = {
    "/settings/profile": "个人中心",
    "/settings/system": "系统设置",
    "/positions/new": "新增岗位",
    "/positions/archive": "已归档岗位",
    "/resumes/upload": "上传简历",
    "/question-banks/upload": "上传题库",
  };
  const detailPages: Record<string, string> = {
    "/positions/:id": "编辑岗位",
    "/resumes/:id": "简历详情",
    "/workflows/:id": "工作流编辑",
    "/interviews/:id/score": "面试工作区",
    "/interviews/:id/result": "面试结果",
  };
  const detail = Object.entries(detailPages).find(([pattern]) =>
    matchPath(pattern, pathname),
  );
  const title =
    specialPages[pathname] ||
    detail?.[1] ||
    (parent?.path === pathname ? parent.label : "页面不存在");
  return { parent, title };
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const content = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const { parent, title } = currentPage(location.pathname);
  const items = navigation.filter(
    (item) => !item.roles || item.roles.includes(user?.role || ""),
  );
  const selected = parent?.path || location.pathname;

  useEffect(() => {
    document.title = `${title} · AI Interview`;
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname;
      content.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [location.pathname, title]);

  const navigateTo = (path: string) => {
    setMobileOpen(false);
    navigate(path);
  };
  const menuItems: MenuProps["items"] = [
    ...new Set(items.map((item) => item.group)),
  ].map((group) => ({
    type: "group",
    key: group,
    label: group,
    children: items
      .filter((item) => item.group === group)
      .map((item) => ({
        key: item.path,
        icon: item.icon,
        label: (
          <Link
            to={item.path}
            aria-current={selected === item.path ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
          >
            {item.label}
          </Link>
        ),
        title: item.label,
      })),
  }));
  const userItems: MenuProps["items"] = [
    {
      key: "profile",
      label: "个人中心",
      icon: <UserOutlined />,
      onClick: () => navigateTo("/settings/profile"),
    },
    ...(user?.role === "admin"
      ? [
          {
            key: "settings",
            label: "系统设置",
            icon: <SettingOutlined />,
            onClick: () => navigateTo("/settings/system"),
          },
        ]
      : []),
    { type: "divider" },
    {
      key: "logout",
      label: "退出登录",
      icon: <LogoutOutlined />,
      onClick: () => {
        logout();
        navigate("/login");
      },
    },
  ];
  const brand = (
    <Link
      to="/dashboard"
      className="app-brand"
      onClick={() => setMobileOpen(false)}
      aria-label="AI Interview 招聘概览"
    >
      <span className="brand-mark" aria-hidden="true">
        ai
        <span />
      </span>
      <span className="brand-wordmark">
        AI Interview<small>智能招聘管理系统</small>
      </span>
    </Link>
  );
  const nav = (
    <nav aria-label="主导航">
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selected]}
        items={menuItems}
        inlineCollapsed={collapsed && !!screens.lg}
      />
    </nav>
  );

  return (
    <Layout className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="app-sidebar">
        {brand}
        <div className="sidebar-navigation">{nav}</div>
        <div className="sidebar-footer">
          <Tooltip
            title={collapsed ? "展开导航" : "收起导航"}
            placement="right"
          >
            <Button
              type="text"
              className="sidebar-toggle"
              aria-label={collapsed ? "展开导航" : "收起导航"}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => {
                setCollapsed(!collapsed);
                localStorage.setItem("sidebar-collapsed", String(!collapsed));
              }}
            >
              {!collapsed && "收起导航"}
            </Button>
          </Tooltip>
        </div>
      </aside>
      <Drawer
        title={brand}
        placement="left"
        size={272}
        open={mobileOpen && !screens.lg}
        onClose={() => setMobileOpen(false)}
        className="navigation-drawer"
        closeIcon={<ArrowLeftOutlined aria-label="关闭导航" />}
      >
        {nav}
      </Drawer>
      <Layout className="app-main">
        <header className="app-topbar">
          <div className="topbar-location">
            <Button
              type="text"
              className="mobile-nav-trigger"
              icon={<MenuOutlined />}
              aria-label="打开导航"
              onClick={() => setMobileOpen(true)}
            />
            <Breadcrumb
              aria-label="页面位置"
              items={[
                { title: parent?.group || "系统配置" },
                ...(parent && parent.path !== location.pathname
                  ? [{ title: <Link to={parent.path}>{parent.label}</Link> }]
                  : []),
                { title: <span aria-current="page">{title}</span> },
              ]}
            />
          </div>
          <div className="topbar-actions">
            <Dropdown menu={{ items: userItems }} trigger={["click"]}>
              <Button
                type="text"
                className="account-trigger"
                aria-label="账户菜单"
                aria-haspopup="menu"
              >
                <Avatar size={32} icon={<UserOutlined />} />
                <span className="account-copy">
                  <strong>{user?.full_name || user?.email}</strong>
                  <small>{user ? roleLabels[user.role] : ""}</small>
                </span>
                <DownOutlined className="account-chevron" />
              </Button>
            </Dropdown>
          </div>
        </header>
        <main
          id="main-content"
          ref={content}
          className="app-content"
          tabIndex={-1}
        >
          <div className="page-container">
            <Suspense fallback={<RouteLoading />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </Layout>
    </Layout>
  );
}
