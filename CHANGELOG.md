# Changelog

## 1.2.79.1 (2026-11-19, later the same day)

Two things the first real customer skill needed, plus one bug that would have
broken every skill built on the template.

- `lang` forces the language the AI answers in. Alexa has no `pt-PT`, so a
  Portuguese business runs on the `pt-BR` locale and would otherwise be answered
  in Brazilian Portuguese.
- `intentSentences` / `intent_sentences` maps a skill's own slotless shortcut
  intents to the sentence a person would have said, so they reach an AI that
  only speaks prose. A slot always wins over the map, and `pt` and `br` answer
  for each other.
- **The skill template answered with nothing.** `ask-sdk`'s `.lambda()` hands
  back a callback-style handler, and the template's wrapper dropped the
  callback. Fixed, and the template now bridges it to a Promise.
- `aplSupported` checked the interface by truthiness; a device sending an empty
  object for it was read as "no screen". It checks for the key now.

## 1.2.79 (2026-11-19)

First version. Two packages, one behaviour.

- Node `@oryksa/alexa` (ask-sdk-core) and Python `oryksa-alexa` (ask-sdk).
- One catch-all handler: whatever the customer says reaches the AI employee,
  whatever intent it hit. Free text is read from the `AMAZON.SearchQuery` slot
  of the certified ORYKSA model; the shortcut intents become the sentence a
  person would have said, in each language.
- Replies come back as SSML: markdown stripped, addresses dropped, the five XML
  characters escaped, long answers cut at a sentence.
- A reprompt on every turn, so the conversation stays open.
- Progressive response ("one moment") to beat Alexa's 8 second limit, plus
  polling when the API answers 202 because the AI is still writing.
- Optional account linking: the access token goes to the identity provider's own
  userinfo endpoint and the e-mail and phone reach ORYKSA, so the AI never asks
  for contact details again. The token is never decoded locally and never logged.
- Echo Show card drawn with APL primitives (1.9, no `alexa-layouts`), with the
  agent's own name and photo from `GET /v1/client/agent`. A card in the Alexa app
  on devices without a screen.
- One ORYKSA session per Alexa session, not per turn. The same Echo user keeps
  the same conversation across sessions.
- Alexa's own locales only: en-US, en-GB, en-AU, en-CA, en-IN, es-ES, es-MX,
  es-US, pt-BR. Alexa has no pt-PT.
- The interaction model of the certified ORYKSA skill is included, reused as is.
- 104 automated tests (54 Node, 50 Python), no network and nothing to install,
  plus one live test per language against `https://api.oryksa.com/v1`.

Three bugs the live test found before anyone shipped on this:

- Python: `urllib` introduces itself as `Python-urllib/3.x` and the edge in front
  of the API answers 403 (Cloudflare 1010). Every request now says who it is.
  Node sends the same header for the same reason.
- Node: the body's own `status` field ("replied" / "pending") was overwriting the
  HTTP code, so a ready answer was treated as still being written. The HTTP code
  now comes back as `statusCode`.
- Python: `urllib.request` has `urlopen`, not `open`, so nothing reached the
  network at all.

Each of the three now has a test that fails if it comes back.
