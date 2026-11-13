import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import "./index.css";
import { AuthProvider } from "./contexts/AuthContext";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { appTheme } from "./theme";

ConfigProvider.config({
  holderRender: (children) => (
    <ConfigProvider locale={zhCN} theme={appTheme}>
      {children}
    </ConfigProvider>
  ),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ConfigProvider>
  </StrictMode>,
);
