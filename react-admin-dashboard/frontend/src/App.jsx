import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CollectionPage from './pages/CollectionPage.jsx';
import ActivityLogPage from './pages/ActivityLogPage.jsx';
import DatamodelPage from './pages/DatamodelPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="activity" element={<ActivityLogPage />} />
        <Route path="datamodel" element={<AdminRoute><DatamodelPage /></AdminRoute>} />
        <Route path="users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        <Route path=":collection" element={<CollectionPage />}>
          <Route path=":id" />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
