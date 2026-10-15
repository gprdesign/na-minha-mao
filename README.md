# Na Minha Mão

PWA responsivo para organizar tarefas pela data em que foram liberadas, com prazo, estimativa, foco e recompensa.

## Recursos

- Cadastro de tarefas liberadas ou aguardando liberação.
- Subtarefas com conclusão individual, progresso e sincronização.
- Contagem de dias desde a liberação, prazo, estimativa, tempo registrado e recompensa.
- Navegação fixa no rodapé; Home destaca a próxima tarefa e resume os estados com barras de progresso, e Tarefas oferece uma lista enxuta por estado.
- Detalhes, timeline de pedidos/comentários com data, hora e origem, além de links anexados.
- Timer de foco, edição, conclusão e reabertura; o backup JSON fica em Configurações.
- Layout responsivo e cache offline básico.

## Sincronização e privacidade

- Sem login, os dados ficam apenas no `localStorage` deste navegador.
- Ao entrar na conta Supabase, tarefas, comentários e links sincronizam entre dispositivos.
- O primeiro envio de dados locais pede confirmação; nada é enviado sem essa confirmação.
- As tabelas usam Row Level Security e cada conta só acessa as próprias linhas.
- `config.js` contém somente a chave publicável, destinada ao navegador. Nunca coloque uma chave secreta do Supabase no código ou no repositório público.
- `supabase/schema.sql` cria as tabelas e políticas do app no projeto Supabase.
- O anexo automático de resumos pelo Zapia exige uma credencial privada de servidor; ela não deve ser publicada no app.

## Teste local

Com Python instalado, abra um terminal nesta pasta e execute:

```text
py -m http.server 8000
```

Depois abra `http://localhost:8000`. Para interromper o servidor, use `Ctrl+C` no terminal.
