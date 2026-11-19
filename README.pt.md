<p align="center"><img src="https://app.oryksa.com/static/oryksa_logo.png" width="300" alt="ORYKSA"></p>

# oryksa-alexa

[![English](https://img.shields.io/badge/English-30363d?style=for-the-badge)](README.md) [![Português](https://img.shields.io/badge/Portugu%C3%AAs-0891b2?style=for-the-badge)](README.pt.md)

Põe a tua **colaboradora de IA da ORYKSA** dentro da **tua própria skill da Alexa**. Um só handler apanha tudo: o que o cliente disser no Echo chega à IA que já conhece o teu negócio, e a resposta volta em voz. O mesmo cérebro do WhatsApp, do chat do site e da tua app.

* Documentação: https://developer.oryksa.com/pt/sdks
* API: `https://api.oryksa.com/v1`

Dois pacotes, o mesmo comportamento:

| | Pacote | Para |
|---|---|---|
| Node | `@oryksa/alexa` | `ask-sdk-core`, skill alojada na Amazon (Node) ou a tua Lambda |
| Python | `oryksa-alexa` | `ask-sdk`, skill alojada na Amazon (Python) ou a tua Lambda |

## Instalar

```bash
npm install @oryksa/alexa ask-sdk-core
```

```bash
pip install "oryksa-alexa[skill]"
```

## A skill inteira

```js
import { createHandler } from "@oryksa/alexa";

export const handler = await createHandler({ apiKey: process.env.ORYKSA_API_KEY });
```

```python
import os
from oryksa_alexa import create_skill

handler = create_skill(api_key=os.environ["ORYKSA_API_KEY"]).lambda_handler()
```

É tudo. Cria a chave em **developer.oryksa.com > Chaves**, põe-na na Lambda como `ORYKSA_API_KEY` e carrega o modelo de interação que está em [`interaction-model/`](interaction-model). A chave secreta fica na Lambda; o aparelho nunca a vê.

## O que já vem resolvido

**Tudo o que o cliente diz chega à IA.** A Alexa só entrega intents, nunca a fala em cru, por isso o texto livre viaja num slot `AMAZON.SearchQuery`. O modelo deste repositório é o da skill ORYKSA já certificada, por isso herdas frases que passaram pela revisão da Amazon. O handler que apanha tudo tira o texto de qualquer slot de qualquer intent; os atalhos (agenda, mensagens, créditos, e-mail) viram a frase que uma pessoa teria dito, em cada idioma.

**O limite de 8 segundos da Alexa está tratado.** Enquanto a IA escreve, a skill manda uma resposta progressiva e a Alexa diz "um momento". Se a API responder `202` porque a resposta ainda está a ser gerada, o SDK volta a ler a conversa até a resposta chegar. A Alexa nunca fica calada: se tudo falhar, ela diz que não conseguiu e mantém a conversa aberta.

**A resposta é preparada para ser falada.** O markdown é retirado, para a Alexa não ler asteriscos em voz alta. As palavras dos links ficam e os endereços saem. Os cinco caracteres de XML são escapados, para a resposta nunca rebentar. Uma resposta longa é cortada num ponto final, nunca a meio de uma palavra.

**A conversa fica aberta.** Cada turno leva um reprompt, por isso a skill não fecha depois de uma pergunta. É criada uma sessão ORYKSA por sessão da Alexa, não por turno, e o mesmo utilizador do Echo mantém a mesma conversa de uma vez para a outra.

**Echo Show.** A resposta é desenhada com primitivas APL (1.9, sem `alexa-layouts`, por isso aparece em todos os Echo Show) com o nome e a fotografia da tua IA, lidos de `GET /v1/client/agent`. Os aparelhos sem ecrã recebem um cartão na app da Alexa.

**Idiomas.** Só os idiomas que a Alexa tem: `en-US`, `en-GB`, `en-AU`, `en-CA`, `en-IN`, `es-ES`, `es-MX`, `es-US`, `pt-BR`. A Alexa não tem `pt-PT`, por isso o português é `pt-BR`. O idioma do aparelho decide o idioma da resposta.

## Ligação de conta (opcional)

Sem ela a skill funciona e a IA pede os contactos quando precisa. Com ela, a IA já sabe quem está a falar e não volta a pedir.

Liga a ligação de conta na consola de programador da Alexa contra o teu próprio provedor OAuth 2.0 e deixa o provedor verificar o token:

```js
export const handler = await createHandler({
  apiKey: process.env.ORYKSA_API_KEY,
  userInfoUrl: "https://auth.exemplo.com/oauth2/userinfo",
});
```

```python
handler = create_skill(
    api_key=os.environ["ORYKSA_API_KEY"],
    user_info_url="https://auth.exemplo.com/oauth2/userinfo",
).lambda_handler()
```

Ou resolve tu, se as tuas contas não estiverem atrás de OIDC:

```js
resolveCustomer: async (accessToken) => {
  const eu = await aMinhaApi.quemSou(accessToken);
  return { email: eu.email, phone: eu.telefone, name: eu.primeiroNome };
}
```

O `email` e o `phone` vão no `POST /v1/sessions`, e é isso que diz à IA que o cliente está autenticado. O token de acesso nunca é descodificado localmente, nunca vai para registos e nunca é enviado à ORYKSA.

## Peça por peça

Para juntar a IA a uma skill que já tens, usa os handlers um a um em vez do `createHandler`:

```js
import { SkillBuilders } from "ask-sdk-core";
import { oryksaHandlers } from "@oryksa/alexa";

const oryksa = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });

export const handler = SkillBuilders.custom()
  .addRequestHandlers(OMeuHandlerDeEncomendas, ...oryksa.requestHandlers)
  .addErrorHandlers(oryksa.errorHandler)
  .lambda();
```

Põe os teus handlers **antes** do `oryksa.requestHandlers`: o que apanha tudo responde ao que sobra, por isso nada depois dele chega a ser usado.

Ou chama tu, de dentro de um handler teu:

```js
const { bridge } = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });
return bridge.reply(handlerInput, "o cliente perguntou pela encomenda " + numero);
```

## Opções

| Opção (Node / Python) | Por omissão | O que faz |
|---|---|---|
| `apiKey` / `api_key` | obrigatória | A tua chave secreta, `oryk_live_...`. Fica na Lambda. |
| `progressive` | `true` | Dizer "um momento" enquanto a IA escreve. |
| `card` | `true` | Desenhar no Echo Show, ou mandar cartão. |
| `answerDeadlineMs` / `deadline_seconds` | 24 s | Quanto esperar por uma resposta lenta. |
| `pollIntervalMs` / `poll_seconds` | 0,9 s | De quanto em quanto voltar a ler a conversa. |
| `sessionTtlMinutes` / `session_ttl_minutes` | 1440 | Validade do token de cliente. |
| `userInfoUrl` / `user_info_url` | nenhum | Ligação de conta por OIDC. |
| `resolveCustomer` / `resolve_customer` | nenhum | Ligação de conta à tua maneira. |
| `conversationPrefix` / `conversation_prefix` | `alexa` | Prefixo do id da conversa. |
| `onError` / `on_error` | nenhum | Chamado com tudo o que falhe. |
| `baseUrl` / `base_url` | `https://api.oryksa.com/v1` | A API. |

## Testes

Sem rede, sem conta, sem instalar nada:

```bash
cd node && npm test
cd python && python -m unittest discover -s tests -v
```

## Autor

Feito pela equipa ORYKSA.

* Site: https://oryksa.com
* Programadores: https://developer.oryksa.com
* X: https://x.com/oryksaai
* Instagram: https://instagram.com/oryksaai
* YouTube: https://youtube.com/@oryksaai

Licença MIT.
