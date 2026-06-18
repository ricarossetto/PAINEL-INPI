# Painel INPI

Painel gratuito para acompanhar publicações da Seção V - Marcas da Revista da Propriedade Industrial.

## Como funciona

- O painel é estático e pode rodar no GitHub Pages sem servidor pago.
- A varredura lê o índice oficial da RPI, baixa o XML da Seção V - Marcas e procura os alvos configurados.
- A primeira carga pode ser feita manualmente com as 10 revistas mais recentes.
- A automação semanal roda toda terça-feira às 18:00 no horário de São Paulo, lendo apenas a RPI mais recente.
- As ocorrências ficam em `public/data/inpi-dashboard.json` e aparecem no painel.
- O e-mail é enviado somente se os segredos SMTP forem configurados no GitHub.

## Rodar localmente

```powershell
python scripts/scan_inpi.py --limit 10 --pause 4 --download-retries 8
python -m http.server 8000 -d public
```

Depois acesse `http://localhost:8000`.

## Publicar de graça

1. Crie um repositório no GitHub e envie estes arquivos.
2. Em Settings > Pages, selecione GitHub Actions como fonte.
3. Em Settings > Secrets and variables > Actions, cadastre os segredos de e-mail.
4. Rode o workflow `Atualizar Painel INPI` manualmente na primeira vez. Use `scan_limit=10` para formar a base inicial; depois deixe `scan_limit=1`.

## Segredos para e-mail

Para Gmail, use uma senha de app da conta remetente.

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ricardo.rossetto.adv@gmail.com
SMTP_PASSWORD=senha-de-app-do-gmail
SMTP_FROM=ricardo.rossetto.adv@gmail.com
SMTP_TLS=true
NOTIFY_TO=RICARDO.ROSSETTO.ADV@GMAIL.COM
```

## Filtrar e-mails por monitor

Para enviar e-mails apenas quando um monitor especifico tiver movimentacao, configure `notification.monitorIds` em `public/data/config.json`.

```json
"notification": {
  "monitorIds": ["adv-ricardo-de-luca-rossetto"]
}
```

## Alterar monitoramentos

Edite `public/data/config.json` para adicionar marcas, advogados, requerentes ou termos livres. Cada item pode ter vários termos, e a busca ignora acentos e diferenças simples de pontuação.
