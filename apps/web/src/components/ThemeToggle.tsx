import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { Button, Tooltip } from '@/components/ui';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Tooltip content={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
      <Button size="icon-sm" variant="ghost" onClick={toggle} aria-label="Alternar tema">
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}
