import { lazy, Suspense } from "react";
import { Alert, Button } from "antd";
import { Navigate, useParams } from "react-router-dom";
import { RouteLoading } from "../../components/RouteFeedback";
import { useResource } from "./shared";
const LegacyResult = lazy(() => import("../Interviews/Result"));
export default function ResultEntry() {
  const { id } = useParams();
  const { data, error, refresh } = useResource<{
    legacy_completed: boolean;
    state: string;
  }>(`/interview-workflow/${id}`);
  if (error)
    return (
      <Alert
        type="error"
        title={error}
        action={<Button onClick={refresh}>重试</Button>}
      />
    );
  if (!data) return <RouteLoading />;
  if (!data.legacy_completed)
    return <Navigate to={`/interviews/${id}/score`} replace />;
  return (
    <Suspense fallback={<RouteLoading />}>
      <LegacyResult />
    </Suspense>
  );
}
