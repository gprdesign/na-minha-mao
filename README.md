# Na Minha Mão — protótipo

PWA responsivo para organizar tarefas pelo momento em que ficam liberadas.

## O que já funciona

- Cadastro pergunta se a tarefa está liberada.
- Tarefas bloqueadas ficam em “Aguardando liberação”, com campo para registrar o que falta.
- Ao liberar, registra a data de hoje e solicita prazo, estimativa e recompensa.
- Lista prioriza tarefas com mais dias na mão; em empate, mostra primeiro a entrega mais próxima.
- Visão Kanban com as colunas “Tá na sua mão, bora!” e “Aguardando liberação”.
- Detalhes da tarefa, timeline de pedidos/comentários com data, hora e origem (manual, WhatsApp ou Radar).
- Anexos de links HTTP/HTTPS com nome e acesso em nova aba.
- Timer de foco, edição, conclusão, reabertura e exportação de backup JSON.
- Interface responsiva e cache básico para uso offline depois do primeiro carregamento.

## Dados e integração

A versão atual guarda os dados em `localStorage` do navegador. Não envia tarefas a servidor e não sincroniza entre dispositivos. Comentários marcados como WhatsApp ou Radar são registros manuais; a integração para o Zapia anexar automaticamente resumos de conversas/Radar ainda depende de um backend autenticado.

## Teste local

Com Python instalado, abra um terminal nesta pasta e execute:

```text
py -m http.server 8000
```

Depois abra `http://localhost:8000`. Para interromper o servidor, use `Ctrl+C` no terminal.
