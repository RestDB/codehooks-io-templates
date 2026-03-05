import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { BreadcrumbProvider } from './contexts/BreadcrumbContext.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BreadcrumbProvider>
          <ThemeProvider defaultTheme="light" storageKey="theme">
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ThemeProvider>
        </BreadcrumbProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
