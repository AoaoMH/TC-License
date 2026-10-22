import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/dialogs';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <DialogProvider>
        <App />
      </DialogProvider>
    </React.StrictMode>
  );
}
