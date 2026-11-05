# ALt.nexo

IDE visual orientada a agentes: canvas infinito com **instâncias reais do Claude Code**, terminais, tarefas, notas, sites e arquivos — conectados por fluxos e salvos permanentemente por projeto.

Uma única base de código atende dois formatos:

| Formato | Como roda | Execução local |
|---|---|---|
| **Desktop (.exe)** | Electron carrega a UI e embute o runtime no processo principal | Sempre disponível |
| **Web** | Navegador abre a mesma UI servida pelo runtime local | Pelo runtime local, com pareamento |

---

## Arquitetura

```
nexo/
├── packages/shared      Tipos de domínio + protocolo WebSocket (usados por todos)
├── apps/runtime         Serviço local: HTTP/WS, SQLite, PTYs, Claude Code, orquestrador, Git, arquivos
├── apps/web             UI React + TypeScript + Vite + React Flow + xterm.js + Tailwind/shadcn
└── apps/desktop         Electron: inicia o runtime, abre a UI, expõe diálogos nativos via preload
```

```
 ┌──────────── UI (React) ────────────┐        ┌─────────────── Runtime (Node) ───────────────┐
 │ Dashboard · Canvas · Inspector     │  REST  │ Repo (SQLite + migrações + backups)          │
 │ xterm.js por nó                    │◄──────►│ ProcessManager (node-pty / ConPTY)           │
 │ Zustand (canvas, undo, autosave)   │   WS   │ Orchestrator (fluxos entre agentes)          │
 └────────────────────────────────────┘        │ FileService (pastas autorizadas) · Git       │
        ▲ preload (só no desktop)              └──────┬──────────────────────────▲────────────┘
        │ diálogos, abrir arquivo/link                │ spawn (PTY)              │ hooks HTTP
                                                      ▼                          │
                                               claude.exe --session-id/--resume --settings <hooks>
```

**Por que Electron (e não Tauri):** o runtime é Node (node-pty, `node:sqlite`) e o Claude Code é uma CLI. Com Electron o *mesmo* runtime roda no modo navegador (`node`) e embutido no desktop, sem sidecar nem duplicação em Rust. Ambos (`node:sqlite` e `node-pty` com prebuilds N-API) funcionam no Electron 44 sem compilação nativa.

### Integração com o Claude Code (somente mecanismos oficiais)

- O executável `claude` instalado na máquina roda num **PTY real**. Login/logout acontecem no próprio Claude Code (`/login` ou `claude auth login`). O ALt.nexo **nunca lê nem armazena credenciais**; o status é consultado com `claude auth status`.
- Cada nó tem um ID de sessão: inicia com `--session-id <uuid>` e retoma com `--resume <uuid>` (só quando a transcrição existe em `~/.claude/projects`).
- Função do agente → `--append-system-prompt`; permissões → `--permission-mode`; modelo → `--model`; nome → `--name`.
- **Estado do agente** vem de **hooks oficiais** (`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`) injetados via `--settings <arquivo>` gerado no diretório de dados — `~/.claude/settings.json` e os arquivos do projeto não são tocados. O hook envia o evento ao runtime por HTTP com um token efêmero.
- A resposta final de cada turno (para fluxos/contexto) vem do hook `Stop` / transcrição JSONL do próprio Claude Code. Nada é simulado.

### Persistência

- SQLite (`node:sqlite`, WAL) em `%APPDATA%\ALt.nexo\nexo.db` — compartilhado entre web e desktop.
- Tabelas: `folders`, `projects`, `workspaces` (viewport + configurações), `nodes`, `edges`, `sessions`, `runs`, `run_steps`, `settings`. Migrações versionadas (`PRAGMA user_version`) com backup automático antes de migrar.
- **Autosave** (700 ms após cada alteração, e no fechamento da janela). Grafo salvo em transação.
- **Histórico de terminal** em `logs/<nó>.log` (rotacionado em 4 MB) — reexibido ao reabrir, mesmo após reiniciar o PC.
- **Recuperação de queda**: na inicialização, sessões que estavam "rodando" viram `interrupted` (retomáveis) e execuções de fluxo pendentes são marcadas como falhas.
- **Backups**: automático diário (14 últimos) + manual em Configurações (`VACUUM INTO`).
- Persistência de canvas ≠ persistência de processos: processos não sobrevivem ao fechamento; o que volta é o layout, o histórico do terminal e a conversa (via `--resume`).

### Conexões e orquestração

| Tipo | Comportamento |
|---|---|
| Referência | Apenas relação visual. Nunca dispara nada. |
| Contexto | Ao concluir, a resposta da origem é anexada ao próximo prompt do destino na execução. Também há "Compartilhar contexto agora" (colar ou enviar). |
| Dependência | O destino só começa após **todas** as origens concluírem. |
| Sequencial | A saída da origem vira a entrada do destino. |
| Paralelo | O destino inicia junto com a origem, com o mesmo prompt. |

Proteções: execução só por ação explícita; ciclos em arestas executáveis são rejeitados antes de iniciar; cada agente participa uma vez por execução; limite de passos configurável; agente ocupado só recebe prompt ao terminar o turno; cancelamento envia `Esc` aos agentes ativos.

**Conflitos entre agentes:** "Isolar em git worktree" cria `../.nexo-worktrees/<repo>-<agente>` num branch `nexo/<agente>` próprio. Sem isolamento, o ALt.nexo avisa quando dois agentes rodam no mesmo diretório.

### Segurança

- O runtime só escuta em `127.0.0.1` e valida `Host` (anti DNS-rebinding) e `Origin`.
- Desktop: token aleatório em memória a cada execução.
- Navegador: o runtime imprime um **link de pareamento** (código efêmero) a cada início; o navegador troca o código por um token de dispositivo e o runtime guarda **apenas o SHA-256** dele. "Revogar" em Configurações invalida todos.
- Arquivos: listar pastas (nomes) é livre para escolher diretórios; **ler/escrever conteúdo** só dentro de pastas autorizadas (diretórios de projetos, de agentes/terminais e as liberadas em Configurações).
- Electron: `contextIsolation`, `sandbox`, sem `nodeIntegration`; `<webview>` de sites sem preload; navegação externa abre no navegador padrão. CSP na UI servida.

---

## Como executar

Pré-requisitos: Node 22.5+ (testado com 22.14), Git, Claude Code instalado (`npm i -g @anthropic-ai/claude-code` ou instalador nativo) e autenticado.

```bash
npm install

# Desenvolvimento (runtime com hot reload + Vite em http://127.0.0.1:5173)
npm run dev            # abra o link "?pair=..." impresso no terminal

# Modo navegador "produção" (build + runtime servindo a UI em http://127.0.0.1:7420)
npm start              # abra o link de pareamento impresso

# Desktop em desenvolvimento
npm run dev:desktop

# Testes do runtime (REST, WS, PTY real, persistência, autorização, ciclos, worktree)
npm test
npm run typecheck
```

Variáveis úteis: `NEXO_DATA_DIR` (diretório de dados), `NEXO_PORT` (porta do runtime web), `NEXO_CLAUDE_PATH` (caminho explícito do `claude`).

## Gerar o .exe

```bash
npm run dist:win
```

Saída em `apps/desktop/release/`:

- `ALt.nexo-Setup-0.1.0.exe` — instalador NSIS (por usuário, permite escolher a pasta, cria atalho).
- `ALt.nexo-Portable-0.1.0.exe` — executável portátil.
- `win-unpacked/ALt.nexo.exe` — app descompactado (útil para testes).

O executável não é assinado com certificado de código; o Windows SmartScreen pode exibir um aviso na primeira execução.

## Uso rápido

1. **Novo projeto** → "Pasta existente" (padrão): o Nexinho lê a pasta e mostra o que é **agente** (`.claude/agents`, skills, comandos, MCP), **cérebro** (CLAUDE.md/AGENTS.md, cofres Obsidian, memória do Claude Code, docs) e **arquivos** (stack, tipos, subprojetos) — e monta o canvas com esses três grupos. Cada subagente vira um Claude iniciado com `--agent`. A aba **Mapa da pasta** no painel lateral relê e adiciona itens depois. Também há "Só ideias", "Nova pasta" e "Clonar Git".
2. No canvas: barra superior, clique direito ou atalhos (`Shift+C` Claude, `Shift+T` terminal, `Shift+K` tarefa, `Shift+N` nota, `Shift+W` site, `Shift+F` arquivo, `Shift+G` grupo).
3. Conecte nós arrastando a partir das bordas; clique na conexão para definir o comportamento.
4. Num agente: **Iniciar** (ou **Retomar**). Na primeira vez numa pasta, o Claude Code pede confirmação de confiança no próprio terminal.
5. Clique direito num agente/tarefa → **Executar fluxo**. Acompanhe na aba **Execuções**.
6. Feche o app quando quiser — ao voltar, o canvas, o zoom, o histórico dos terminais e as sessões retomáveis estarão lá.

Atalhos: `Ctrl+Z/Y` desfazer/refazer · `Ctrl+C/V/D` copiar/colar/duplicar · `Ctrl+G` agrupar · `Shift+L` organizar · `Shift+1` enquadrar · `Delete` excluir · `Espaço+arrastar`/roda para mover · `Ctrl+roda` zoom · `Shift+Esc` sai do modo maximizado.

## Limitações conhecidas

- **Sites no navegador:** páginas com `X-Frame-Options`/CSP bloqueiam `<iframe>`. No desktop o nó usa `<webview>` e funciona.
- **Seleção de texto no terminal com zoom ≠ 100%:** use "Maximizar" para seleção precisa (o xterm é renderizado com transformação de escala dentro do canvas).
- **Contexto/fluxos** usam o texto final de cada turno do agente (hook `Stop`). O conteúdo intermediário (ferramentas) fica no terminal/transcrição.
- **Retomada** depende de o Claude Code ter gravado a transcrição. Se o runtime for iniciado de dentro de outra sessão do Claude Code, o ALt.nexo remove as variáveis herdadas (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, …) para não desligar a gravação.
- Web e desktop compartilham o mesmo banco; use um de cada vez para evitar que um marque as sessões do outro como interrompidas.
- Restauração de backup é manual (substituir `nexo.db` com o app fechado).
