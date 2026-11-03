import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RecoveryBoundary } from './components/RecoveryBoundary';
import { installAssetRecovery } from './lib/runtimeRecovery';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
installAssetRecovery();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RecoveryBoundary>
      <App />
    </RecoveryBoundary>
  </React.StrictMode>,
);
