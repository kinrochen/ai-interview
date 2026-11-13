import { useCallback, useEffect, useState } from "react";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";

export function useResource<T>(url: string) {
  const [revision, setRevision] = useState(0);
  const key = `${url}#${revision}`;
  const [state, setState] = useState<{
    key: string;
    url: string;
    data: T | null;
    error: string;
  }>({ key: "", url: "", data: null, error: "" });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    request
      .get(url, { signal: controller.signal })
      .then((data: T) => {
        if (!controller.signal.aborted) setState({ key, url, data, error: "" });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            key,
            url,
            data: previous.url === url ? previous.data : null,
            error: getErrorMessage(reason, "加载失败，请重试"),
          }));
      });
    return () => controller.abort();
  }, [url, key]);
  return {
    data: state.url === url ? state.data : null,
    error: state.key === key ? state.error : "",
    loading: state.key !== key,
    refresh,
  };
}

export const recommendations = [
  { value: "passed", label: "通过" },
  { value: "next_round", label: "进入下一轮" },
  { value: "hired", label: "建议录用" },
  { value: "waitlist", label: "待定" },
  { value: "rejected", label: "不通过" },
];
export const decisionOptions = recommendations.map((item) =>
  item.value === "hired" ? { ...item, label: "录用" } : item,
);

export const dimensions = [
  { key: "technical_fit", label: "技术匹配", weight: 35 },
  { key: "problem_solving", label: "问题解决", weight: 20 },
  { key: "learning_ability", label: "学习能力", weight: 15 },
  { key: "engineering_mindset", label: "工程意识", weight: 15 },
  { key: "collaboration", label: "沟通协作", weight: 10 },
  { key: "culture_fit", label: "团队匹配", weight: 5 },
];
