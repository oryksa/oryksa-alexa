<p align="center"><img src="https://app.oryksa.com/static/oryksa_logo.png" width="300" alt="ORYKSA"></p>

# oryksa-alexa

[![English](https://img.shields.io/badge/English-30363d?style=for-the-badge)](README.md) [![Português](https://img.shields.io/badge/Portugu%C3%AAs-30363d?style=for-the-badge)](README.pt.md) [![Español](https://img.shields.io/badge/Espa%C3%B1ol-0891b2?style=for-the-badge)](README.es.md) [![Français](https://img.shields.io/badge/Fran%C3%A7ais-30363d?style=for-the-badge)](README.fr.md)

Pon a tu **empleado de IA de ORYKSA** dentro de **tu propia skill de Alexa**. Un solo handler lo recoge todo: lo que el cliente diga en el Echo llega a la IA que ya conoce tu negocio, y la respuesta vuelve en voz. El mismo cerebro de WhatsApp, del chat del sitio web y de tu app.

* Documentación: https://developer.oryksa.com/es/sdks
* API: `https://api.oryksa.com/v1`

Dos paquetes, el mismo comportamiento:

| | Paquete | Para |
|---|---|---|
| Node | `@oryksa/alexa` | `ask-sdk-core`, Alexa-hosted (Node) o tu propia Lambda |
| Python | `oryksa-alexa` | `ask-sdk`, Alexa-hosted (Python) o tu propia Lambda |

## Instalar

```bash
npm install @oryksa/alexa ask-sdk-core
```

```bash
pip install "oryksa-alexa[skill]"
```

## La skill completa

```js
import { createHandler } from "@oryksa/alexa";

export const handler = await createHandler({ apiKey: process.env.ORYKSA_API_KEY });
```

```python
import os
from oryksa_alexa import create_skill

handler = create_skill(api_key=os.environ["ORYKSA_API_KEY"]).lambda_handler()
```

Eso es todo. Crea la clave en **developer.oryksa.com > Keys**, ponla en la Lambda como `ORYKSA_API_KEY` y sube el modelo de interacción desde [`interaction-model/`](interaction-model). La clave secreta se queda en la Lambda; el dispositivo nunca la ve.

## Qué obtienes

**Todo lo que dice el cliente llega a la IA.** Alexa solo te da intents, nunca el habla en bruto, así que el texto libre viaja en un slot `AMAZON.SearchQuery`. El modelo de este repositorio es el de la skill certificada de ORYKSA, así que heredas formulaciones que ya pasaron la revisión de Amazon. El handler general toma el texto de cualquier slot de cualquier intent; los intents de atajo (agenda, mensajes, créditos, correo) se convierten en la frase que habría dicho una persona, en cada idioma.

**El límite de 8 segundos de Alexa está resuelto.** Mientras la IA escribe, la skill envía una respuesta progresiva para que Alexa diga "un momento". Si la API responde `202` porque la respuesta aún se está generando, el SDK vuelve a leer la conversación hasta que llega la respuesta. Alexa nunca se queda en silencio: si todo falla, lo dice y mantiene la sesión abierta.

**La respuesta se hace pronunciable.** Se elimina el Markdown para que Alexa no lea asteriscos en voz alta, se conservan los textos de los enlaces y se descartan las direcciones, se escapan los cinco caracteres XML para que la respuesta nunca se rompa, y una respuesta larga se corta en un punto en lugar de a mitad de palabra.

**La conversación sigue abierta.** Cada turno lleva un reprompt, así que la skill no se cierra tras una pregunta. Se crea una sesión ORYKSA por sesión de Alexa, no por turno, y el mismo usuario del Echo mantiene la misma conversación entre sesiones.

**Echo Show.** La respuesta se dibuja con primitivas APL (1.9, sin `alexa-layouts`, así que se ve en todos los Echo Show) con el nombre y la foto de tu IA, leídos de `GET /v1/client/agent`. Los dispositivos sin pantalla reciben una tarjeta en la app de Alexa.

**Idiomas.** Los locales propios de Alexa: `en-US`, `en-GB`, `en-AU`, `en-CA`, `en-IN`, `es-ES`, `es-MX`, `es-US`, `pt-BR`. Alexa no tiene `pt-PT`, así que el portugués es `pt-BR`. El locale del dispositivo decide el idioma de la respuesta.

## Vinculación de cuentas (opcional)

Sin ella la skill funciona y la IA pide los datos de contacto cuando los necesita. Con ella, la IA ya sabe quién habla y nunca vuelve a preguntar.

Activa la vinculación de cuentas en la consola de desarrollador de Alexa con tu propio proveedor OAuth 2.0, y deja que el proveedor verifique el token por ti:

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

O resuélvelo tú mismo, si tus cuentas no viven detrás de OIDC:

```js
resolveCustomer: async (accessToken) => {
  const me = await myApi.whoAmI(accessToken);
  return { email: me.email, phone: me.phone, name: me.firstName };
}
```

El `email` y el `phone` se pasan a `POST /v1/sessions`, que es lo que le dice a la IA que el cliente ha iniciado sesión. El token de acceso nunca se decodifica localmente, nunca se registra y nunca se envía a ORYKSA.

## Pieza por pieza

Para añadir la IA a una skill que ya tienes, toma los handlers de uno en uno en lugar de `createHandler`:

```js
import { SkillBuilders } from "ask-sdk-core";
import { oryksaHandlers } from "@oryksa/alexa";

const oryksa = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });

export const handler = SkillBuilders.custom()
  .addRequestHandlers(MyOwnOrderHandler, ...oryksa.requestHandlers)
  .addErrorHandlers(oryksa.errorHandler)
  .lambda();
```

Pon tus propios handlers **antes** de `oryksa.requestHandlers`: el handler general responde a todo lo que queda, así que nada que venga después se alcanza nunca.

O conduce el proceso tú mismo desde dentro de uno de tus handlers:

```js
const { bridge } = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });
return bridge.reply(handlerInput, "the customer asked about order " + orderId);
```

## Tus propios intents de atajo

Un intent de atajo propio ("lee mis mensajes nuevos", "cuánto gané este mes") no tiene
slot, así que no hay texto que enviar a la IA. Dale la frase que habría dicho una persona:

```js
oryksaHandlers({
  apiKey: process.env.ORYKSA_API_KEY,
  intentSentences: {
    InboxIntent: { pt: "tenho mensagens novas", en: "do I have new messages" },
    EarningsIntent: { pt: "quanto ganhei este mês", en: "how much did I earn this month" },
  },
});
```

Un slot siempre gana al mapa: primero van las palabras del propio cliente. `pt` y `br` se responden
mutuamente, porque ambos son portugués.

## Opciones

| Opción (Node / Python) | Por defecto | Qué hace |
|---|---|---|
| `apiKey` / `api_key` | obligatoria | Tu clave secreta, `oryk_live_...`. Guárdala en la Lambda. |
| `progressive` | `true` | Dice "un momento" mientras la IA escribe. |
| `card` | `true` | Dibuja en Echo Show o envía una tarjeta. |
| `lang` | del dispositivo | Fuerza el idioma en que responde la IA: `pt`, `br`, `en` o `es`. Alexa no tiene `pt-PT`, así que un negocio portugués usa el locale `pt-BR` y define `lang: "pt"`. |
| `intentSentences` / `intent_sentences` | ninguno | Asigna tus propios intents sin slot a la frase que habría dicho una persona. |
| `answerDeadlineMs` / `deadline_seconds` | 24 s | Cuánto esperar una respuesta lenta. |
| `pollIntervalMs` / `poll_seconds` | 0,9 s | Cada cuánto se vuelve a leer la conversación. |
| `sessionTtlMinutes` / `session_ttl_minutes` | 1440 | Vida del token de cliente. |
| `userInfoUrl` / `user_info_url` | ninguno | Vinculación de cuentas mediante OIDC. |
| `resolveCustomer` / `resolve_customer` | ninguno | Vinculación de cuentas a tu manera. |
| `conversationPrefix` / `conversation_prefix` | `alexa` | Prefijo del id de la conversación. |
| `onError` / `on_error` | ninguno | Se llama con cualquier cosa que salga mal. |
| `baseUrl` / `base_url` | `https://api.oryksa.com/v1` | La API. |

## Pruebas

Sin red, sin cuenta, nada que instalar:

```bash
cd node && npm test
cd python && python -m unittest discover -s tests -v
```

## Autor

Creado por el equipo de ORYKSA.

* Sitio web: https://oryksa.com
* Desarrolladores: https://developer.oryksa.com
* X: https://x.com/oryksaai
* Instagram: https://instagram.com/oryksaai
* YouTube: https://youtube.com/@ORYKSA

Licencia MIT.
