import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Suppress benign Supabase lock errors in development (caused by Zone.js intercepting the internal rejection)
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && (event.reason.name === 'NavigatorLockAcquireTimeoutError' || String(event.reason).includes('NavigatorLockAcquireTimeoutError'))) {
    event.preventDefault();
  }
});

const originalConsoleError = console.error;
console.error = function (...args) {
  const errStr = args.map(a => String(a?.name || a?.message || a)).join(' ');
  if (errStr.includes('NavigatorLockAcquireTimeoutError')) {
    return;
  }
  originalConsoleError.apply(console, args);
};

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
