# Jornadas do sistema

Cada arquivo `J-NNNN.md` descreve um comportamento que o sistema **precisa** ter,
em linguagem de negócio. O conjunto de jornadas aprovadas é o contrato do sistema.

| Campo | Valores |
| --- | --- |
| `dimensao` | `funcional`, `integracao`, `operacao`, `seguranca` |
| `criticidade` | `critica` ou `normal` (ambas bloqueiam a liberação quando falham) |
| `frequencia` | `cada_mudanca`, `diaria`, `semanal` (ex.: restaurar backup toda semana) |
| `status` | `rascunho` → `aprovada` → `homologada`; ou `retirada` (com `motivo_retirada`) |
| `teste` | arquivo de teste que contém a marca `@J-NNNN` e verifica o resultado |
| `aprovada_hash` | impressão digital do texto aprovado (`ai-engineering journey seal J-NNNN`) |

- Só o dono aprova, homologa ou retira uma jornada. A aprovação vale quando o dono
  aprova a mudança no pull request protegido; a impressão digital apenas detecta
  qualquer alteração posterior do texto.
- "Verde" e "comprovada" não se escrevem à mão: são calculados pelo portão
  (`ai-engineering gate`) a partir das execuções reais.
- Mínimo para P2/P3: ao menos uma jornada aprovada de cada dimensão, inclusive
  operação ("e se der errado?": backup restaura, alerta dispara, dá para voltar
  à versão anterior) e segurança (quem não pode, não vê nem altera).
- Marque com `@pos-deploy` no título do teste apenas jornadas seguras para rodar
  contra produção (sem efeitos reais, como vendas ou e-mails).
