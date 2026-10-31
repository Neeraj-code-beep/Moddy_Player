import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';

createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user">
  <AuthProvider><App /></AuthProvider>
  </MotionConfig>,
);
