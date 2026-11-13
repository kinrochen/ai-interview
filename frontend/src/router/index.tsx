import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "../components/Layout";
import ProtectedRoute from "../components/ProtectedRoute";
import RouteError, {
  NotFound,
  RouteLoading,
} from "../components/RouteFeedback";

const Login = lazy(() => import("../pages/Login/index"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const PositionsList = lazy(() => import("../pages/Positions/List"));
const PositionForm = lazy(() => import("../pages/Positions/Form"));
const QuestionBanksList = lazy(() => import("../pages/QuestionBanks/List"));
const QuestionBankUpload = lazy(() => import("../pages/QuestionBanks/Upload"));
const ResumesList = lazy(() => import("../pages/Resumes/List"));
const ResumeUpload = lazy(() => import("../pages/Resumes/Upload"));
const ResumeDetail = lazy(() => import("../pages/Resumes/Detail"));
const InterviewsList = lazy(() => import("../pages/Interviews/List"));
const InterviewScore = lazy(() => import("../pages/Recruitment/InterviewWorkspace"));
const Workbench = lazy(() => import("../pages/Recruitment/Workbench"));
const InterviewCalendar = lazy(() => import("../pages/Recruitment/Calendar"));
const QualityBoard = lazy(() => import("../pages/Recruitment/Quality"));
const ArchivedPositions = lazy(() => import("../pages/Recruitment/PositionOperations").then((module) => ({ default: module.ArchivedPositions })));
const InterviewResultPage = lazy(() => import("../pages/Recruitment/ResultEntry"));
const PublicJobDetail = lazy(() => import("../pages/Public/JobDetail"));
const PublicCodingTest = lazy(() => import("../pages/Public/CodingTest"));
const CodingTestsList = lazy(() => import("../pages/CodingTests/List"));
const OffersList = lazy(() => import("../pages/Offers/List"));
const OfferTemplates = lazy(() => import("../pages/Offers/Templates"));
const OfferConfirm = lazy(() => import("../pages/Offers/Confirm"));
const UsersList = lazy(() => import("../pages/Settings/Users"));
const ProfileSettings = lazy(() => import("../pages/Settings/Profile"));
const SystemSettingsPage = lazy(() => import("../pages/Settings/System"));
const PublicReview = lazy(() => import("../pages/Public/Review"));
const WorkflowsList = lazy(() => import("../pages/Workflows/List"));
const WorkflowEditor = lazy(() => import("../pages/Workflows/Editor"));

const router = createBrowserRouter([
  {
    path: "/login",
    element: (
      <Suspense fallback={<RouteLoading />}>
        <Login />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/public/jobs/:id",
    element: (
      <Suspense fallback={<RouteLoading />}>
        <PublicJobDetail />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/public/coding-tests/:token",
    element: (
      <Suspense fallback={<RouteLoading />}>
        <PublicCodingTest />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/offer-confirm/:token",
    element: (
      <Suspense fallback={<RouteLoading />}>
        <OfferConfirm />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/public/review/:resumeId/:reviewerId",
    element: (
      <Suspense fallback={<RouteLoading />}>
        <PublicReview />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "/",
        element: <Navigate to="/dashboard" replace />,
      },
      { path: "workbench", element: <Workbench /> },
      { path: "interviews/calendar", element: <InterviewCalendar /> },
      { path: "recruitment-quality", element: <QualityBoard /> },
      { path: "settings/asr", element: <Navigate to="/settings/system#asr" replace /> },
      { path: "positions/archive", element: <ArchivedPositions /> },
      {
        path: "dashboard",
        element: <Dashboard />,
      },
      {
        path: "positions",
        element: <PositionsList />,
      },
      {
        path: "positions/new",
        element: <PositionForm />,
      },
      {
        path: "positions/:id",
        element: <PositionForm />,
      },
      {
        path: "question-banks",
        element: <QuestionBanksList />,
      },
      {
        path: "question-banks/upload",
        element: <QuestionBankUpload />,
      },
      {
        path: "resumes",
        element: <ResumesList />,
      },
      {
        path: "resumes/upload",
        element: <ResumeUpload />,
      },
      {
        path: "resumes/:id",
        element: <ResumeDetail />,
      },
      {
        path: "interviews",
        element: <InterviewsList />,
      },
      {
        path: "interviews/:id/score",
        element: <InterviewScore />,
      },
      {
        path: "interviews/:id/result",
        element: <InterviewResultPage />,
      },
      {
        path: "coding-tests",
        element: <CodingTestsList />,
      },
      {
        path: "offers",
        element: <OffersList />,
      },
      {
        path: "offers/templates",
        element: <OfferTemplates />,
      },
      {
        path: "settings/users",
        element: <UsersList />,
      },
      {
        path: "settings/profile",
        element: <ProfileSettings />,
      },
      {
        path: "settings/system",
        element: <SystemSettingsPage />,
      },
      {
        path: "workflows",
        element: <WorkflowsList />,
      },
      {
        path: "workflows/:id",
        element: <WorkflowEditor />,
      },
      { path: "*", element: <NotFound /> },
    ].map((route) => ({ ...route, errorElement: <RouteError /> })),
  },
]);

export default router;
