<p align="center"><img src="https://app.oryksa.com/static/oryksa_logo.png" width="300" alt="ORYKSA"></p>

# oryksa-alexa

[![English](https://img.shields.io/badge/English-30363d?style=for-the-badge)](README.md) [![Português](https://img.shields.io/badge/Portugu%C3%AAs-30363d?style=for-the-badge)](README.pt.md) [![Español](https://img.shields.io/badge/Espa%C3%B1ol-30363d?style=for-the-badge)](README.es.md) [![Français](https://img.shields.io/badge/Fran%C3%A7ais-0891b2?style=for-the-badge)](README.fr.md)

Mettez votre **employé IA ORYKSA** dans **votre propre skill Alexa**. Un seul handler récupère tout : ce que le client dit à l'Echo parvient à l'IA qui connaît déjà votre entreprise, et la réponse revient en voix. Le même cerveau que WhatsApp, le chat du site web et votre app.

* Documentation : https://developer.oryksa.com/fr/sdks
* API : `https://api.oryksa.com/v1`

Deux paquets, le même comportement :

| | Paquet | Pour |
|---|---|---|
| Node | `@oryksa/alexa` | `ask-sdk-core`, Alexa-hosted (Node) ou votre propre Lambda |
| Python | `oryksa-alexa` | `ask-sdk`, Alexa-hosted (Python) ou votre propre Lambda |

## Installer

```bash
npm install @oryksa/alexa ask-sdk-core
```

```bash
pip install "oryksa-alexa[skill]"
```

## La skill complète

```js
import { createHandler } from "@oryksa/alexa";

export const handler = await createHandler({ apiKey: process.env.ORYKSA_API_KEY });
```

```python
import os
from oryksa_alexa import create_skill

handler = create_skill(api_key=os.environ["ORYKSA_API_KEY"]).lambda_handler()
```

C'est tout. Créez la clé sur **developer.oryksa.com > Keys**, mettez-la dans la Lambda sous `ORYKSA_API_KEY` et téléversez le modèle d'interaction depuis [`interaction-model/`](interaction-model). La clé secrète reste dans la Lambda ; l'appareil ne la voit jamais.

## Ce que vous obtenez

**Tout ce que dit le client parvient à l'IA.** Alexa ne vous donne que des intents, jamais la parole brute, donc le texte libre voyage dans un slot `AMAZON.SearchQuery`. Le modèle de ce dépôt est celui de la skill ORYKSA certifiée, vous héritez donc de formulations qui ont déjà passé la validation d'Amazon. Le handler général prend le texte de n'importe quel slot de n'importe quel intent ; les intents raccourcis (agenda, messages, crédits, e-mail) deviennent la phrase qu'une personne aurait dite, dans chaque langue.

**La limite de 8 secondes d'Alexa est gérée.** Pendant que l'IA écrit, la skill envoie une réponse progressive pour qu'Alexa dise « un instant ». Si l'API répond `202` parce que la réponse est encore en cours de génération, le SDK relit la conversation jusqu'à l'arrivée de la réponse. Alexa n'est jamais laissée muette : si tout échoue, elle le dit et garde la session ouverte.

**La réponse est rendue prononçable.** Le Markdown est retiré pour qu'Alexa ne lise pas les astérisques à voix haute, les libellés des liens sont conservés tandis que les adresses sont supprimées, les cinq caractères XML sont échappés pour que la réponse ne casse jamais, et une longue réponse est coupée à un point plutôt qu'au milieu d'un mot.

**La conversation reste ouverte.** Chaque tour porte un reprompt, la skill ne se ferme donc pas après une question. Une session ORYKSA est créée par session Alexa, pas par tour, et le même utilisateur de l'Echo garde la même conversation d'une session à l'autre.

**Echo Show.** La réponse est dessinée avec des primitives APL (1.9, sans `alexa-layouts`, elle s'affiche donc sur tous les Echo Show) avec le nom et la photo de votre IA, lus depuis `GET /v1/client/agent`. Les appareils sans écran reçoivent une carte dans l'app Alexa.

**Langues.** Les locales propres à Alexa : `en-US`, `en-GB`, `en-AU`, `en-CA`, `en-IN`, `es-ES`, `es-MX`, `es-US`, `pt-BR`. Alexa n'a pas de `pt-PT`, le portugais est donc `pt-BR`. La locale de l'appareil décide de la langue de la réponse.

## Association de compte (facultative)

Sans elle, la skill fonctionne et l'IA demande les coordonnées quand elle en a besoin. Avec elle, l'IA sait déjà qui parle et ne le redemande jamais.

Activez l'association de compte dans la console développeur Alexa avec votre propre fournisseur OAuth 2.0, puis laissez le fournisseur vérifier le jeton pour vous :

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

Ou résolvez-le vous-même, si vos comptes ne se trouvent pas derrière OIDC :

```js
resolveCustomer: async (accessToken) => {
  const me = await myApi.whoAmI(accessToken);
  return { email: me.email, phone: me.phone, name: me.firstName };
}
```

L'`email` et le `phone` sont transmis à `POST /v1/sessions`, ce qui indique à l'IA que le client est connecté. Le jeton d'accès n'est jamais décodé localement, jamais journalisé et jamais envoyé à ORYKSA.

## Pièce par pièce

Pour ajouter l'IA à une skill que vous avez déjà, prenez les handlers un par un au lieu de `createHandler` :

```js
import { SkillBuilders } from "ask-sdk-core";
import { oryksaHandlers } from "@oryksa/alexa";

const oryksa = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });

export const handler = SkillBuilders.custom()
  .addRequestHandlers(MyOwnOrderHandler, ...oryksa.requestHandlers)
  .addErrorHandlers(oryksa.errorHandler)
  .lambda();
```

Placez vos propres handlers **avant** `oryksa.requestHandlers` : le handler général répond à tout ce qui reste, donc rien de ce qui vient après n'est jamais atteint.

Ou pilotez-le vous-même depuis l'un de vos handlers :

```js
const { bridge } = oryksaHandlers({ apiKey: process.env.ORYKSA_API_KEY });
return bridge.reply(handlerInput, "the customer asked about order " + orderId);
```

## Vos propres intents raccourcis

Un intent raccourci à vous (« lis mes nouveaux messages », « combien ai-je gagné ce mois-ci ») n'a pas de
slot, il n'y a donc aucun texte à envoyer à l'IA. Donnez-lui la phrase qu'une personne aurait dite :

```js
oryksaHandlers({
  apiKey: process.env.ORYKSA_API_KEY,
  intentSentences: {
    InboxIntent: { pt: "tenho mensagens novas", en: "do I have new messages" },
    EarningsIntent: { pt: "quanto ganhei este mês", en: "how much did I earn this month" },
  },
});
```

Un slot l'emporte toujours sur la table : les mots du client passent en premier. `pt` et `br` se répondent
mutuellement, car tous deux sont du portugais.

## Options

| Option (Node / Python) | Par défaut | Ce qu'elle fait |
|---|---|---|
| `apiKey` / `api_key` | obligatoire | Votre clé secrète, `oryk_live_...`. Gardez-la dans la Lambda. |
| `progressive` | `true` | Dit « un instant » pendant que l'IA écrit. |
| `card` | `true` | Dessine sur Echo Show, ou envoie une carte. |
| `lang` | selon l'appareil | Force la langue dans laquelle l'IA répond : `pt`, `br`, `en` ou `es`. Alexa n'a pas de `pt-PT`, une entreprise portugaise utilise donc la locale `pt-BR` et définit `lang: "pt"`. |
| `intentSentences` / `intent_sentences` | aucune | Associe vos propres intents sans slot à la phrase qu'une personne aurait dite. |
| `answerDeadlineMs` / `deadline_seconds` | 24 s | Combien de temps attendre une réponse lente. |
| `pollIntervalMs` / `poll_seconds` | 0,9 s | À quelle fréquence relire la conversation. |
| `sessionTtlMinutes` / `session_ttl_minutes` | 1440 | Durée de vie du jeton client. |
| `userInfoUrl` / `user_info_url` | aucune | Association de compte via OIDC. |
| `resolveCustomer` / `resolve_customer` | aucune | Association de compte à votre façon. |
| `conversationPrefix` / `conversation_prefix` | `alexa` | Préfixe de l'identifiant de conversation. |
| `onError` / `on_error` | aucune | Appelée avec tout ce qui se passe mal. |
| `baseUrl` / `base_url` | `https://api.oryksa.com/v1` | L'API. |

## Tests

Pas de réseau, pas de compte, rien à installer :

```bash
cd node && npm test
cd python && python -m unittest discover -s tests -v
```

## Auteur

Créé par l'équipe ORYKSA.

* Site : https://oryksa.com
* Développeurs : https://developer.oryksa.com
* X : https://x.com/oryksaai
* Instagram : https://instagram.com/oryksaai
* YouTube : https://youtube.com/@ORYKSA

Licence MIT.
