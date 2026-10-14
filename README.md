# Na Minha Mão — protótipo v1

PWA responsivo para organizar tarefas pelo momento em que ficam liberadas.

## O que já funciona

- Cadastro pergunta se a tarefa está liberada.
- Tarefas bloqueadas ficam em “Aguardando liberação”, com campo para registrar o que falta.
- Ao liberar, registra a data de hoje e solicita prazo, estimativa e recompensa.
- Tarefas liberadas são ordenadas por mais dias na mão; em empate, vence a entrega mais próxima.
- Exibe dias desde a liberação, prazo, tempo estimado e tempo registrado.
- Timer de foco com iniciar/pausar, persistido ao fechar ou atualizar a página.
- Conclusão mostra a recompensa combinada; tarefas concluídas podem ser reabertas.
- Edição de tarefas e exportação de backup JSON.
- Interface responsiva e cache básico para uso offline depois do primeiro carregamento.

## Dados e custo

Esta versão armazena os dados em `localStorage` do navegador. Não envia dados a servidor, não tem login e não sincroniza entre aparelhos. A hospedagem ainda não foi configurada nem publicada. O botão “Exportar backup” baixa uma cópia JSON.

## Teste local

Com Python instalado, abra um terminal nesta pasta e execute:

```text
py -m http.server 8000
```

Depois abra `http://localhost:8000`. Para interromper o servidor, use `Ctrl+C` no terminal.

Em um host HTTPS, o service worker habilita o modo PWA/offline e a instalação pelo navegador.
