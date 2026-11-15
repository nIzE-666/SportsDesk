import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './tokens.css';
import './kit/kit.css';
import './styles.css';
import './design.css';
import '@fontsource-variable/manrope';
import './productivity.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
