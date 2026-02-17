import { Layout } from './components/layout/Layout';
import { LoginView } from './views/LoginView';
import { useAuth } from './hooks/useAuth';
import './styles/theme.css';

function App() {
  const { user, loading, error, login } = useAuth();

  if (loading && !user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={login} error={error} loading={loading} />;
  }

  return <Layout />;
}

export default App;
