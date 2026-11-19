<p align="center"><img src="https://app.oryksa.com/static/oryksa_logo.png" width="300" alt="ORYKSA"></p>

# oryksa-alexa

[![English](https://img.shields.io/badge/English-0891b2?style=for-the-badge)](README.md) [![Português](https://img.shields.io/badge/Portugu%C3%AAs-30363d?style=for-the-badge)](README.pt.md)

Put your **ORYKSA AI employee** inside **your own Alexa skill**. One catch-all handler: whatever the customer says on the Echo reaches the AI that already knows your business, and the answer comes back as speech. Same brain as WhatsApp, the website chat and your app.

* Docs: https://developer.oryksa.com/en/sdks
* API: `https://api.oryksa.com/v1`

Two packages, one behaviour:

| | Package | For |
|---|---|---|
| Node | `@oryksa/alexa` | `ask-sdk-core`, Alexa-hosted (Node) or your own Lambda |
| Python | `oryksa-alexa` | `ask-sdk`, Alexa-hosted (Python) or your own Lambda |

## Install

```bash
npm install @oryksa/alexa ask-sdk-core
```

```bash
pip install "oryksa-alexa[skill]"
```

## The whole skill

```js
import { createHandler } from "@oryksa/alexa";

export const handler = await createHandler({ apiKey: process.env.ORYKSA_API_KEY });
```

```python
import os
from oryksa_alexa import create_skill

handler = create_skill(api_key=os.environ["ORYKSA_API_KEY"]).lambda_handler()
```

That is it. Create the key at **developer.oryksa.com > Keys**, put it in the Lambda as `ORYKSA_API_KEY`, and upload the interaction model from [`interaction-model/`](interaction-model). The secret key stays in the Lambda; the device never sees it.

## What you get

**Everything the customer says reaches the AI.** Alexa only gives you intents, never raw speech, so free text travels in an `AMAZON.SearchQuery` slot. The model in this repo is the one from the certified ORYKSA skill, so you inherit phrasings that already passed Amazon's review. The catch-all handler takes the text from any slot of any intent; the shortcut intents (agenda, messages, credits, e-mail) become the sentence a person would have said, in each language.

**Alexa's 8 second limit is handled.** While the AI writes, the skill sends a progressive response so Alexa says "one moment". If the API answers `202` because the reply is still being generated, the SDK reads the conversation back until the answer lands. Alexa is never left silent: if everything fails, it says so and keeps the session open.

**The answer is made speakable.** Markdown is stripped so Alexa does not read asterisks out loud, link labels are kept while the addresses are dropped, the five XML characters are escaped so the response never breaks, and a long answer is cut at a full stop instead of mid-word.

**The conversation stays open.** Every turn carries a reprompt, so the skill does not close after one question. One ORYKSA session is minted per Alexa session, not per turn, and the same Echo user keeps the same conversation across sessions.

**Echo Show.** The answer is drawn with APL primitives (1.9, no `alexa-layouts`, so it renders on every Echo Show) with your AI's own name and photo, read from `GET /v1/client/agent`. Devices without a screen get a card in the Alexa app instead.

**Languages.** Alexa's own locales: `en-US`, `en-GB`, `en-AU`, `en-CA`, `en-IN`, `es-ES`, `es-MX`, `es-US`, `pt-BR`. Alexa has no `pt-PT`, so Portuguese is `pt-BR`. The locale of the device decides the language of the answer.

## Account linking (optional)

Without it the skill works and the AI asks for contact details when it needs them. With it, the AI already knows who is speaking and never asks again.

Turn on account linking in the Alexa developer console against your own OAuth 2.0 provider, then let the provider verify the token for you:

```js
export const handler = await createHandler({
  apiKey: process.env.ORYKSA_API_KEY,
  userInfoUrl: "https://auth.example.com/oauth2/userinfo",
});
```

```python
handler = create_skill(
    api_key=os.environ["ORYKSA_API_KEY"],
    user_info_url="https://auth.example.com/oauth2/userinfo",
).lambda_handler()
```

Or resolve it yourself, if your accounts do not live behind OIDC:

```js
resolveCustomer: async (accessToken) => {
  const me = await myApi.whoAmI(accessToken);
  return { email: me.email, phone: me.phone, name: me.firstName };
}
```

The `email` and `phone` are passed to `POST /v1/sessions`, which is what tells the AI the customer is signed in. The access token is never decoded locally, never logged and never sent to ORYKSA.

## Piece by piece

To add the AI to a skill you already have, take the handlers one at a time instead of `createHandler`:

```js
import { SkillBuilders } from "ask-sdk-core";
import { oryksaHandlers } from "@oryksa/alexa";

const oryksa = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });

export const handler = SkillBuilders.custom()
  .addRequestHandlers(MyOwnOrderHandler, ...oryksa.requestHandlers)
  .addErrorHandlers(oryksa.errorHandler)
  .lambda();
```

Put your own handlers **before** `oryksa.requestHandlers`: the catch-all answers anything that is left, so nothing after it is ever reached.

Or drive it yourself from inside one of your handlers:

```js
const { bridge } = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });
return bridge.reply(handlerInput, "the customer asked about order " + orderId);
```

## Your own shortcut intents

A shortcut intent of your own ("read my new messages", "how much did I earn this month") has no
slot, so there is no text to send to the AI. Give it the sentence a person would have said:

```js
oryksaHandlers({
  apiKey: process.env.ORYKSA_API_KEY,
  intentSentences: {
    InboxIntent: { pt: "tenho mensagens novas", en: "do I have new messages" },
    EarningsIntent: { pt: "quanto ganhei este mês", en: "how much did I earn this month" },
  },
});
```

A slot always wins over the map: the customer's own words come first. `pt` and `br` answer for
each other, because both are Portuguese.

## Options

| Option (Node / Python) | Default | What it does |
|---|---|---|
| `apiKey` / `api_key` | required | Your secret key, `oryk_live_...`. Keep it in the Lambda. |
| `progressive` | `true` | Say "one moment" while the AI writes. |
| `card` | `true` | Draw on Echo Show, or send a card. |
| `lang` | from the device | Force the language the AI answers in: `pt`, `br`, `en` or `es`. Alexa has no `pt-PT`, so a Portuguese business runs on the `pt-BR` locale and sets `lang: "pt"`. |
| `intentSentences` / `intent_sentences` | none | Map your own slotless intents to the sentence a person would have said. |
| `answerDeadlineMs` / `deadline_seconds` | 24 s | How long to wait for a slow answer. |
| `pollIntervalMs` / `poll_seconds` | 0.9 s | How often to read the conversation back. |
| `sessionTtlMinutes` / `session_ttl_minutes` | 1440 | Life of the client token. |
| `userInfoUrl` / `user_info_url` | none | Account linking through OIDC. |
| `resolveCustomer` / `resolve_customer` | none | Account linking your own way. |
| `conversationPrefix` / `conversation_prefix` | `alexa` | Prefix of the conversation id. |
| `onError` / `on_error` | none | Called with anything that goes wrong. |
| `baseUrl` / `base_url` | `https://api.oryksa.com/v1` | The API. |

## Tests

No network, no account, nothing to install:

```bash
cd node && npm test
cd python && python -m unittest discover -s tests -v
```

## Author

Built by the ORYKSA team.

* Site: https://oryksa.com
* Developers: https://developer.oryksa.com
* X: https://x.com/oryksaai
* Instagram: https://instagram.com/oryksaai
* YouTube: https://youtube.com/@oryksaai

MIT licensed.
