/* Each handler, end to end, against a fake ORYKSA API and a fake Alexa
 * responseBuilder. What is checked is the final response envelope: what Alexa
 * would actually say. No network, no ask-sdk, no install.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { oryksaHandlers, OryksaApi, OryksaBridge } from "../src/index.js";

/* ------------------------------------------------- a responseBuilder double */

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

function input({ type = "IntentRequest", intent, slots = {}, locale = "en-US", apl = false,
                 accessToken, userId = "amzn1.ask.account.TESTUSER", attributes = {} } = {}) {
  let store = { ...attributes };
  return {
    requestEnvelope: {
      request: { type, locale, requestId: "amzn1.echo-api.request.1", ...(intent ? { intent: { name: intent, slots } } : {}) },
      context: {
        System: {
          user: { userId, ...(accessToken ? { accessToken } : {}) },
          device: { supportedInterfaces: apl ? { "Alexa.Presentation.APL": {} } : {} },
          apiEndpoint: "https://api.eu.amazonalexa.com",
          apiAccessToken: "alexa-api-token",
        },
      },
    },
    attributesManager: {
      getSessionAttributes: () => store,
      setSessionAttributes: (a) => { store = a; },
    },
    responseBuilder: responseBuilder(),
    _store: () => store,
  };
}

/* ------------------------------------------------------- a fake ORYKSA API */

function fakeApi({ reply = "You have three orders today.", pending = false, agent, fail = false, calls } = {}) {
  const log = calls || [];
  return {
    log,
    api: {
      async createSession(args) {
        log.push(["createSession", args]);
        return { object: "client_session", client_token: "oryk_cs_faketoken", conversation_id: args.conversationId,
                 expires_at: new Date(Date.now() + 86400000).toISOString() };
      },
      async chat(token, body) {
        log.push(["chat", token, body]);
        if (fail) throw new Error("network down");
        if (pending) return { object: "chat_reply", status: "pending", reply: null, statusCode: 202 };
        return { object: "chat_reply", status: "replied", reply, statusCode: 200 };
      },
      async messages(token) {
        log.push(["messages", token]);
        return { object: "conversation", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: reply }] };
      },
      async agent(token) {
        log.push(["agent", token]);
        return agent || { object: "agent", name: "Ana", photo: "https://oryksa.com/p.jpg",
                          greeting: { en: "Hello, I am Ana.", br: "Olá, eu sou a Ana." } };
      },
    },
  };
}

function build(opts = {}) {
  const f = fakeApi(opts);
  const h = oryksaHandlers({ api: f.api, apiKey: "oryk_live_test", progressive: false, ...opts });
  return { ...h, log: f.log };
}

/* ------------------------------------------------------------------ LaunchRequest */

test("LaunchRequest: speaks the agent's own greeting and keeps the session open", async () => {
  const h = build();
  const i = input({ type: "LaunchRequest" });
  assert.equal(h.launch.canHandle(i), true);
  const r = await h.launch.handle(i);
  assert.ok(r.outputSpeech.startsWith("<speak>") && r.outputSpeech.endsWith("</speak>"), r.outputSpeech);
  assert.ok(r.outputSpeech.includes("Ana"), r.outputSpeech);
  assert.ok(r.reprompt, "without a reprompt Alexa closes the skill");
  assert.notEqual(r.shouldEndSession, true);
});

test("LaunchRequest in Portuguese speaks Portuguese", async () => {
  const h = build();
  const r = await h.launch.handle(input({ type: "LaunchRequest", locale: "pt-BR" }));
  assert.ok(r.outputSpeech.includes("Olá"), r.outputSpeech);
});

test("LaunchRequest without a greeting from the server still says something useful", async () => {
  const h = build({ agent: { name: "Bia", photo: null, greeting: {} } });
  const r = await h.launch.handle(input({ type: "LaunchRequest", locale: "pt-BR" }));
  assert.ok(r.outputSpeech.includes("Bia"), r.outputSpeech);
  assert.ok(r.outputSpeech.length > 20);
});

/* ------------------------------------------------------------------- catch-all */

test("catch-all: what the customer said reaches the AI, and the answer is spoken", async () => {
  const h = build();
  const i = input({ intent: "AskIntent", slots: { q: { value: "how many orders today" } } });
  assert.equal(h.catchAll.canHandle(i), true);
  const r = await h.catchAll.handle(i);
  const chat = h.log.find((c) => c[0] === "chat");
  assert.equal(chat[2].message, "how many orders today");
  assert.equal(chat[2].platform, "alexa", "the server must see this came from Alexa");
  assert.equal(chat[2].lang, "en");
  assert.ok(r.outputSpeech.includes("three orders"), r.outputSpeech);
  assert.ok(r.reprompt, "the conversation stays open");
});

test("catch-all: any intent in the skill goes to the AI, not just AskIntent", async () => {
  const h = build();
  const i = input({ intent: "SomethingTheCustomerAdded", slots: { whatever: { value: "cancel my order" } } });
  assert.equal(h.catchAll.canHandle(i), true);
  await h.catchAll.handle(i);
  assert.equal(h.log.find((c) => c[0] === "chat")[2].message, "cancel my order");
});

test("catch-all: the shortcut intents of the certified model carry a real sentence", async () => {
  const h = build();
  await h.catchAll.handle(input({ intent: "AgendaIntent", locale: "pt-BR" }));
  assert.equal(h.log.find((c) => c[0] === "chat")[2].message, "o que tenho na agenda");
});

test("catch-all: heard nothing, asks again and never calls the API", async () => {
  const h = build();
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: {} }));
  assert.equal(h.log.filter((c) => c[0] === "chat").length, 0, "no empty message is sent");
  assert.ok(r.outputSpeech.length > 10);
  assert.ok(r.reprompt);
});

test("catch-all: the language follows the locale of the device", async () => {
  const h = build();
  await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "oi" } }, locale: "pt-BR" }));
  assert.equal(h.log.find((c) => c[0] === "chat")[2].lang, "br");
  const h2 = build();
  await h2.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hola" } }, locale: "es-MX" }));
  assert.equal(h2.log.find((c) => c[0] === "chat")[2].lang, "es");
});

/* ----------------------------------------------------------- the 8 second limit */

test("202 pending: the answer is polled and still spoken", async () => {
  const h = build({ pending: true, pollIntervalMs: 5, answerDeadlineMs: 2000 });
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "write a long report" } } }));
  assert.ok(h.log.some((c) => c[0] === "messages"), "it must read the conversation back");
  assert.ok(r.outputSpeech.includes("three orders"), r.outputSpeech);
});

test("202 pending and the answer never lands: says so instead of going silent", async () => {
  const api = {
    createSession: async () => ({ client_token: "oryk_cs_x", conversation_id: "c", expires_at: new Date(Date.now() + 9e5).toISOString() }),
    chat: async () => ({ status: "pending", reply: null, statusCode: 202 }),
    messages: async () => ({ messages: [{ role: "user", content: "hi" }] }),
    agent: async () => ({ name: "Ana" }),
  };
  const h = oryksaHandlers({ api, progressive: false, pollIntervalMs: 5, answerDeadlineMs: 60 });
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "x" } } }));
  assert.ok(r.outputSpeech.includes("<speak>"), r.outputSpeech);
  assert.ok(r.outputSpeech.replace(/<[^>]+>/g, "").trim().length > 10, "Alexa must never answer with silence");
  assert.ok(r.reprompt);
});

/* ------------------------------------------------------------------ the session */

test("the client token is minted once and reused on the next turn", async () => {
  const h = build();
  const i = input({ intent: "AskIntent", slots: { q: { value: "one" } } });
  await h.catchAll.handle(i);
  const i2 = input({ intent: "AskIntent", slots: { q: { value: "two" } }, attributes: i._store() });
  i2.responseBuilder = i.responseBuilder;
  await h.catchAll.handle(i2);
  assert.equal(h.log.filter((c) => c[0] === "createSession").length, 1, "one session per Alexa session, not per turn");
});

test("the same Echo user keeps the same ORYKSA conversation", async () => {
  const h = build();
  await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "a" } }, userId: "amzn1.ask.account.SAME" }));
  const h2 = build();
  await h2.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "b" } }, userId: "amzn1.ask.account.SAME" }));
  const c1 = h.log.find((c) => c[0] === "createSession")[1].conversationId;
  const c2 = h2.log.find((c) => c[0] === "createSession")[1].conversationId;
  assert.equal(c1, c2);
  assert.match(c1, /^[A-Za-z0-9_-]{1,64}$/);
});

/* -------------------------------------------------------------- account linking */

test("not linked: no contact details are sent", async () => {
  const h = build();
  await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } } }));
  const s = h.log.find((c) => c[0] === "createSession")[1];
  assert.equal(s.customerEmail, undefined);
  assert.equal(s.customerPhone, undefined);
});

test("linked: the e-mail and phone from the identity provider reach ORYKSA", async () => {
  const seen = [];
  const h = build({
    resolveCustomer: async (token) => { seen.push(token); return { email: "ana@cliente.com", phone: "+351912345678", name: "Ana" }; },
  });
  await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } }, accessToken: "linked-token" }));
  assert.deepEqual(seen, ["linked-token"]);
  const s = h.log.find((c) => c[0] === "createSession")[1];
  assert.equal(s.customerEmail, "ana@cliente.com");
  assert.equal(s.customerPhone, "+351912345678");
  assert.equal(s.customerName, "Ana");
});

test("linked but the identity provider is down: the skill still answers", async () => {
  const h = build({ resolveCustomer: async () => { throw new Error("idp down"); } });
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } }, accessToken: "t" }));
  assert.ok(r.outputSpeech.includes("three orders"), r.outputSpeech);
});

test("the access token is never put in the message sent to ORYKSA", async () => {
  const h = build({ resolveCustomer: async () => ({ email: "a@b.c" }) });
  await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } }, accessToken: "SECRET-TOKEN" }));
  assert.ok(!JSON.stringify(h.log.filter((c) => c[0] === "chat")).includes("SECRET-TOKEN"));
});

/* ------------------------------------------------------------------- the screen */

test("on an Echo Show the answer is drawn with the agent's photo", async () => {
  const h = build();
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } }, apl: true }));
  assert.equal(r.directives.length, 1);
  assert.equal(r.directives[0].type, "Alexa.Presentation.APL.RenderDocument");
  const s = JSON.stringify(r.directives[0]);
  assert.ok(s.includes("Ana"));
  assert.ok(s.includes("https://oryksa.com/p.jpg"));
  assert.equal(r.card, null, "no duplicate card when the screen already shows it");
});

test("on a screenless Echo it falls back to a card in the app", async () => {
  const h = build();
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } }, apl: false }));
  assert.equal(r.directives.length, 0);
  assert.equal(r.card.title, "Ana");
  assert.ok(r.card.text.includes("three orders"));
});

test("the card can be turned off", async () => {
  const h = build({ card: false });
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } }, apl: true }));
  assert.equal(r.directives.length, 0);
  assert.equal(r.card, null);
});

/* ----------------------------------------------------------- stop, help, errors */

test("stop and cancel end the session and say goodbye", async () => {
  const h = build();
  for (const name of ["AMAZON.StopIntent", "AMAZON.CancelIntent"]) {
    const i = input({ intent: name });
    assert.equal(h.stop.canHandle(i), true);
    assert.equal(h.catchAll.canHandle(i), false, "stop must not reach the AI");
    const r = await h.stop.handle(i);
    assert.equal(r.shouldEndSession, true);
    assert.ok(r.outputSpeech.length > 10);
  }
});

test("help asks the AI what it can do and keeps the session open", async () => {
  const h = build();
  const i = input({ intent: "AMAZON.HelpIntent" });
  assert.equal(h.help.canHandle(i), true);
  assert.equal(h.catchAll.canHandle(i), false);
  const r = await h.help.handle(i);
  assert.ok(h.log.some((c) => c[0] === "chat"));
  assert.ok(r.reprompt);
  assert.notEqual(r.shouldEndSession, true);
});

test("the API failing never leaves Alexa silent", async () => {
  const errors = [];
  const h = build({ fail: true, onError: (e) => errors.push(e) });
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } } }));
  assert.equal(errors.length, 1);
  assert.ok(r.outputSpeech.replace(/<[^>]+>/g, "").trim().length > 10, r.outputSpeech);
  assert.ok(r.reprompt);
});

test("the error handler catches anything the skill throws", async () => {
  const h = build();
  const r = await h.errorHandler.handle(input({ intent: "X" }), new Error("boom"));
  assert.equal(h.errorHandler.canHandle(), true);
  assert.ok(r.outputSpeech.includes("<speak>"));
  assert.ok(r.reprompt);
});

test("SessionEndedRequest is answered with an empty response, as Alexa requires", async () => {
  const h = build();
  const i = input({ type: "SessionEndedRequest" });
  assert.equal(h.sessionEnded.canHandle(i), true);
  const r = await h.sessionEnded.handle(i);
  assert.equal(r.outputSpeech, null);
});

/* --------------------------------------------------------- progressive response */

test("progressive response: Alexa is told to wait, with the request's own token", async () => {
  const seen = [];
  const f = fakeApi({});
  const h = oryksaHandlers({
    api: f.api, progressive: true,
    fetch: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 204, json: async () => ({}) }; },
  });
  await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } } }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.eu.amazonalexa.com/v1/directives");
  assert.equal(seen[0].init.headers.Authorization, "Bearer alexa-api-token");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.directive.type, "VoicePlayer.Speak");
  assert.equal(body.header.requestId, "amzn1.echo-api.request.1");
  assert.ok(body.directive.speech.startsWith("<speak>"));
});

test("progressive response failing does not stop the answer", async () => {
  const f = fakeApi({});
  const h = oryksaHandlers({ api: f.api, progressive: true, fetch: async () => { throw new Error("no route"); } });
  const r = await h.catchAll.handle(input({ intent: "AskIntent", slots: { q: { value: "hi" } } }));
  assert.ok(r.outputSpeech.includes("three orders"), r.outputSpeech);
});

/* ------------------------------------------------------------------ the wiring */

test("the handler order is the one ask-sdk needs: stop and help before the catch-all", () => {
  const h = build();
  const names = h.requestHandlers;
  assert.equal(names.length, 5);
  assert.ok(names.indexOf(h.stop) < names.indexOf(h.catchAll));
  assert.ok(names.indexOf(h.help) < names.indexOf(h.catchAll));
  assert.ok(names.indexOf(h.launch) < names.indexOf(h.catchAll));
});

test("the bridge can be built from a key alone, without passing an api", () => {
  const b = new OryksaBridge({ apiKey: "oryk_live_test", fetch: async () => ({}) });
  assert.ok(b.api instanceof OryksaApi);
  assert.equal(b.localeOf({ requestEnvelope: { request: { locale: "es-US" } } }), "es-US");
  assert.equal(b.localeOf({}), "en-US");
});
