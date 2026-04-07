/**
 * Entry point for standalone tool preview/development
 * This file is only used when running `npm run dev` independently.
 * In Module Federation, Tool.tsx is loaded directly by the host app.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolContextProvider, type ToolContextValue } from '@appmirror/ui-kit';
import Tool from './Tool';
import { PasswordGate } from './components/PasswordGate';
import './index.css';

// In-memory store for standalone preview
const store: Record<string, unknown> = {};

// Mock context for standalone development preview
const mockContext: ToolContextValue = {
  projectId: 'preview-project',
  projectName: 'Feature Forge Preview',
  projectLogo: '',
  projectColor: '#6366f1',
  projectConfig: {},
  projects: [{ id: 'preview-project', name: 'Feature Forge Preview' }],
  userId: 'dev-user',
  userEmail: 'dev@featureforge.local',
  canEdit: true,
  canAdmin: true,
  api: {
    get: async <T = unknown,>(path: string) => (store[path] ?? { data: [] }) as T,
    post: async <T = unknown,>(path: string, data?: unknown) => { store[path] = data; return data as T; },
    put: async <T = unknown,>(path: string, data?: unknown) => { store[path] = data; return data as T; },
    patch: async <T = unknown,>(path: string, data?: unknown) => { store[path] = data; return data as T; },
    delete: async <T = unknown,>(path: string) => { delete store[path]; return {} as T; },
  },
  showToast: (message: string, type?: 'success' | 'error' | 'info') => {
    console.log(`[Toast ${type || 'info'}]: ${message}`);
  },
  navigate: (path: string) => {
    console.log(`[Navigate]: ${path}`);
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <ToolContextProvider value={mockContext}>
        <Tool />
      </ToolContextProvider>
    </PasswordGate>
  </StrictMode>
);
