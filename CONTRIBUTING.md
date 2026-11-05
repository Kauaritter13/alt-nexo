# Como contribuir

Forks, issues e pull requests são bem-vindos. Dá para mandar em português ou em inglês.

## Rodando o projeto

Você precisa de Node 22.5+, Git e do Claude Code instalado e autenticado.

```bash
npm install
npm run dev    # abra o link "?pair=..." que aparece no terminal
```

## Antes de abrir um pull request

```bash
npm run typecheck
npm test
```

O CI roda esses dois comandos em todo pull request.

- Faça mudanças pequenas e focadas, uma ideia por pull request.
- Se mudar o comportamento, adicione ou ajuste um teste em `apps/runtime/test`.
- Para algo grande, abra uma issue antes para combinarmos o caminho.

## Regras que o projeto segue

- **Só mecanismos oficiais do Claude Code:** CLI, flags e hooks. Nada de simular respostas nem de ler credenciais.
- **Segurança:** o runtime só escuta em `127.0.0.1` e autentica toda requisição. Não enfraqueça essas proteções.
- **Nunca faça commit de segredos**, tokens ou dados pessoais.

## Reportando falhas de segurança

O ALt.nexo executa comandos na sua máquina. Se achar uma falha de segurança, não abra uma issue pública: use a aba **Security** do repositório para reportar em privado.
