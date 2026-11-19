# Your AI employee on Alexa, without writing code

This folder is a complete Alexa skill. You change your name, paste your ORYKSA key, and press Deploy.

You need a free Amazon developer account at <https://developer.amazon.com/alexa/console/ask> and an ORYKSA key from **developer.oryksa.com > Keys**.

## 1. Create the skill

In the Alexa developer console: **Create Skill**.

* Name: your business name
* Primary locale: the language you serve
* Model: **Custom**
* Hosting: **Alexa-hosted (Node.js)**
* Template: **Start from scratch**

## 2. Put these files in

Copy, in the console's Code tab and Build tab:

| From this folder | To |
|---|---|
| `lambda/index.js` | the skill's `lambda/index.js` |
| `lambda/package.json` | the skill's `lambda/package.json` |
| `skill-package/interactionModels/custom/<locale>.json` | Build > JSON Editor, one per language you support |
| `skill-package/skill.json` | Build > Distribution, field by field (the console does not take the file directly on a hosted skill) |

You do not set an endpoint. An Alexa-hosted skill points at its own Lambda by itself, which is why `skill.json` here has no `endpoint`.

## 3. Change two things in the model

Open **Build > JSON Editor** for each language and change:

```json
"invocationName": "oryksa"
```

to the words people will say to call you, for example `"invocationName": "my bakery"`. Amazon's rules for that name:

* two or more words, unless it is your own brand
* all lowercase, no punctuation, no numbers written as digits
* not a word Alexa already uses ("alexa", "echo", "computer", "stop", "help")

Leave everything else in the model alone. The intents and the phrasings came from the ORYKSA skill that Amazon already certified, so they are known to pass review.

## 4. Paste your key

Open `lambda/index.js` and replace one line:

```js
const ORYKSA_API_KEY = "PASTE-YOUR-ORYKSA-KEY-HERE";
```

with your key from developer.oryksa.com, the one that starts with `oryk_live_`.

That key is the only secret in the skill. It stays inside the Lambda. No Echo and no customer ever sees it.

## 5. Deploy and talk to it

Press **Deploy**, then open the **Test** tab, switch it to **Development**, and type or say:

```
open <your invocation name>
```

Then ask a real question about your business. The answer comes from the same AI as your WhatsApp and your website chat.

## 6. Before you submit to Amazon

Amazon reads everything you wrote. Replace every line that still says `REPLACE` or `YOUR BUSINESS NAME`:

* the skill name, the summary and the description
* the example phrases, which must work exactly as written
* your own icons, 108x108 and 512x512, on a public address
* your privacy policy and terms addresses
* the testing instructions, telling the reviewer what to say and giving a test account if you turned account linking on

Then submit it yourself in the console. A skill whose description does not match what it does gets rejected.

## Account linking (optional)

Skip this and the skill works: the AI asks the customer for contact details when it needs them.

Turn it on and the AI knows who is speaking. In **Build > Account Linking**, point it at your own OAuth 2.0 provider, then add one line to `lambda/index.js`, inside `createHandler`:

```js
userInfoUrl: "https://auth.your-site.com/oauth2/userinfo",
```

The customer links their account once in the Alexa app. Their e-mail and phone then reach ORYKSA, and the AI stops asking.

## Something is wrong

| What you see | What it means |
|---|---|
| "Paste your ORYKSA key" in the logs | Step 4 was not done, or the key does not start with `oryk_live_` |
| Alexa says it cannot answer | The key is wrong, or your ORYKSA account has no credits left |
| Alexa does not open the skill | The invocation name is hard to hear. Try it in the Test tab by typing first |
| The answer is cut short | Normal for very long answers: they are cut at a full stop so Alexa does not run past its limit |
