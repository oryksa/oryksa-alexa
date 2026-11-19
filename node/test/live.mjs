/* Live test against https://api.oryksa.com/v1 with a test account key.
 * This is the only test that needs the network; `npm test` does not run it.
 *
 *   ORYKSA_API_KEY=oryk_live_... node test/live.mjs
 *
 * It walks the whole path an Echo would walk: mint a session, read the agent,
 * ask a real question, and check what Alexa would actually say.
 */
import assert from "node:assert/strict";
import { OryksaApi, oryksaHandlers, langOf } from "../src/index.js";

const key = process.env.ORYKSA_API_KEY || "";
assert.ok(key.startsWith("oryk_live_"), "set ORYKSA_API_KEY to a test account key (oryk_live_...)");

const ok = (m) => console.log("  ok  " + m);
/* The words Alexa really says: tags off and the XML entities put back, which is
 * what the voice engine does before it speaks. */
const spoken = (r) => String(r.outputSpeech || "")
  .replace(/<[^>]+>/g, "")
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .trim();

/* ------------------------------------------------- the Alexa side, faked */

function responseBuilder() {
  const r = { outputSpeech: null, reprompt: null, directives: [], card: null, shouldEndSession: undefined };
  const b = {
    speak(s) { r.outputSpeech = s; return b; },
    reprompt(s) { r.reprompt = s; return b; },
    addDirective(d) { r.directives.push(d); return b; },
    withStandardCard(title, text, small, large) { r.card = { title, text, small, large }; return b; },
    withShouldEndSession(v) { r.shouldEndSession = v; return b; },
    getResponse() { return r; },
  };
  return b;
}

function input({ type = "IntentRequest", intent, slots = {}, locale = "en-US", apl = false, attributes = {} } = {}) {
  let store = { ...attributes };
  return {
    requestEnvelope: {
      request: { type, locale, requestId: "amzn1.echo-api.request.live", ...(intent ? { intent: { name: intent, slots } } : {}) },
      context: { System: {
        user: { userId: "amzn1.ask.account.LIVETEST" },
        device: { supportedInterfaces: apl ? { "Alexa.Presentation.APL": {} } : {} },
      } },
    },
    attributesManager: { getSessionAttributes: () => store, setSessionAttributes: (a) => { store = a; } },
    responseBuilder: responseBuilder(),
    store: () => store,
  };
}

/* ------------------------------------------------------------- the API itself */

const api = new OryksaApi({ apiKey: key, timeoutMs: 40000 });

const session = await api.createSession({ conversationId: "alexa-live-" + Date.now().toString(36), ttlMinutes: 10 });
assert.equal(session.object, "client_session");
assert.ok(session.client_token.startsWith("oryk_cs_"), "the device token must be a client token, never the secret key");
assert.ok(Date.parse(session.expires_at) > Date.now());
ok("POST /v1/sessions: client token minted, conversation " + session.conversation_id);

const agent = await api.agent(session.client_token);
assert.equal(agent.object, "agent");
assert.ok(agent.name, "the agent must have a name to speak and to draw");
ok("GET /v1/client/agent: name=" + agent.name + ", photo=" + (agent.photo ? "yes" : "no"));

const reply = await api.chat(session.client_token, { message: "In one short sentence, what do you do?", lang: "en", platform: "alexa" });
assert.ok([200, 202].includes(reply.statusCode), "unexpected HTTP status " + reply.statusCode);
assert.ok(["replied", "pending"].includes(reply.status), "unexpected body status " + reply.status);
ok("POST /v1/client/chat: HTTP " + reply.statusCode + " " + reply.status + (reply.reply ? ', reply "' + String(reply.reply).slice(0, 60) + '..."' : " (still writing)"));

/* ------------------------------------- the whole turn, as the Echo would get it */

const handlers = oryksaHandlers({ apiKey: key, progressive: false, timeoutMs: 40000, answerDeadlineMs: 40000 });

const launch = await handlers.launch.handle(input({ type: "LaunchRequest" }));
assert.ok(launch.outputSpeech.startsWith("<speak>") && launch.outputSpeech.endsWith("</speak>"));
assert.ok(spoken(launch).length > 10, "the greeting cannot be empty");
assert.ok(launch.reprompt, "without a reprompt the skill closes after the greeting");
ok('LaunchRequest -> "' + spoken(launch).slice(0, 70) + '..."');

const asked = input({ intent: "AskIntent", slots: { q: { value: "what are your opening hours" } } });
const answer = await handlers.catchAll.handle(asked);
assert.ok(answer.outputSpeech.startsWith("<speak>"), answer.outputSpeech);
assert.ok(spoken(answer).length > 5, "Alexa would say nothing");
assert.ok(!/[*#`]/.test(spoken(answer)), "markdown reached the speech: " + spoken(answer));
assert.ok(!/https?:\/\//.test(spoken(answer)), "an address reached the speech");
assert.ok(answer.reprompt, "the conversation must stay open");
assert.ok(answer.card && answer.card.title, "a card is expected on a screenless device");
ok('AskIntent -> "' + spoken(answer).slice(0, 90) + '..."');

const pt = await handlers.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "o que você faz" } }, locale: "pt-BR" }));
assert.equal(langOf("pt-BR"), "br");
assert.ok(spoken(pt).length > 5, "the Portuguese turn said nothing");
ok('pt-BR -> "' + spoken(pt).slice(0, 90) + '..."');

const show = await handlers.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hello" } }, apl: true }));
assert.equal(show.directives.length, 1, "an Echo Show must get the APL document");
assert.equal(show.directives[0].type, "Alexa.Presentation.APL.RenderDocument");
assert.equal(show.card, null, "no duplicate card when the screen already shows it");
ok("Echo Show -> APL document rendered");

const second = input({ intent: "AskIntent", slots: { q: { value: "and anything else?" } }, attributes: asked.store() });
await handlers.catchAll.handle(second);
assert.equal(second.store().oryksa.token, asked.store().oryksa.token, "the token must be reused, not minted again");
ok("second turn reused the same client token");

const bye = await handlers.stop.handle(input({ intent: "AMAZON.StopIntent" }));
assert.equal(bye.shouldEndSession, true);
ok('StopIntent -> "' + spoken(bye) + '", session closed');

console.log("\nall live checks passed against https://api.oryksa.com/v1");
