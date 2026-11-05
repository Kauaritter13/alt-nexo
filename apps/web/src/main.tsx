import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { applyTheme, getStoredTheme } from './lib/theme';

// Aplica o tema salvo antes do primeiro render (evita flash do tema errado).
applyTheme(getStoredTheme());

createRoot(document.getElementById('root')!).render(
  <App />,
);
