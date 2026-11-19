/* Pure pieces: locales, SSML, intent to sentence, conversation id, APL.
 * No network, no ask-sdk, no install: node --test test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VERSION, SUPPORTED_LOCALES, langOf, textFor, utteranceOf, toSsml, escapeSsml,
  conversationIdFor, aplDirective, aplSupported, OryksaApi, OryksaError,
} from "../src/index.js";

test("the package version is the ecosystem number", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("only Alexa's own locales, and no pt-PT", () => {
  assert.equal(SUPPORTED_LOCALES.length, 9);
  assert.ok(SUPPORTED_LOCALES.includes("pt-BR"));
  assert.ok(!SUPPORTED_LOCALES.includes("pt-PT"), "Alexa has no pt-PT");
  for (const l of SUPPORTED_LOCALES) assert.match(l, /^[a-z]{2}-[A-Z]{2}$/);
});

test("every Alexa locale maps to a language the API accepts", () => {
  const allowed = new Set(["pt", "br", "en", "es"]);
  for (const l of SUPPORTED_LOCALES) assert.ok(allowed.has(langOf(l)), l);
  assert.equal(langOf("pt-BR"), "br");
  assert.equal(langOf("es-MX"), "es");
  assert.equal(langOf("en-IN"), "en");
  assert.equal(langOf(undefined), "en");
});

test("the four languages all have every sentence, none empty", () => {
  for (const loc of ["en-US", "pt-BR", "es-ES"]) {
    for (const k of ["help", "reprompt", "bye", "error", "thinking", "empty"]) {
      assert.ok(textFor(loc, k).length > 3, `${loc}/${k}`);
    }
  }
  assert.notEqual(textFor("pt-BR", "bye"), textFor("es-ES", "bye"));
});

test("free text comes out of the SearchQuery slot", () => {
  const req = { intent: { name: "AskIntent", slots: { q: { value: "how many orders today" } } } };
  assert.equal(utteranceOf(req, "en-US"), "how many orders today");
});

test("the e-mail body slot is read too", () => {
  const req = { intent: { name: "EmailBodyIntent", slots: { text: { value: "tell him I am on my way" } } } };
  assert.equal(utteranceOf(req, "en-US"), "tell him I am on my way");
});

test("a shortcut intent becomes the sentence a person would say, per language", () => {
  const req = { intent: { name: "AgendaIntent", slots: {} } };
  assert.equal(utteranceOf(req, "en-US"), "what is on my agenda");
  assert.equal(utteranceOf(req, "pt-BR"), "o que tenho na agenda");
  assert.equal(utteranceOf(req, "es-ES"), "qué tengo en mi agenda");
});

test("an unknown slot still gets through", () => {
  const req = { intent: { name: "WhateverIntent", slots: { anything: { value: "the blue one" } } } };
  assert.equal(utteranceOf(req, "en-US"), "the blue one");
});

test("an intent with nothing to say returns empty, never a made-up sentence", () => {
  assert.equal(utteranceOf({ intent: { name: "Nope", slots: {} } }, "en-US"), "");
  assert.equal(utteranceOf({}, "en-US"), "");
  assert.equal(utteranceOf(null, "en-US"), "");
});

test("SSML: markdown is stripped so Alexa does not read asterisks", () => {
  const out = toSsml("**Bold** and *italic* and `code`\n# Title\n- one\n- two");
  assert.ok(!out.includes("*"), out);
  assert.ok(!out.includes("#"), out);
  assert.ok(out.includes("Bold"));
  assert.ok(out.includes("Title"));
});

test("SSML: a link keeps its words and loses the address", () => {
  const out = toSsml("See [our prices](https://oryksa.com/pricing) now");
  assert.ok(out.includes("our prices"), out);
  assert.ok(!out.includes("oryksa.com"), out);
});

test("SSML: a bare address is not read out", () => {
  const out = toSsml("Open https://app.oryksa.com/alexa/connect to link");
  assert.ok(!out.includes("http"), out);
});

test("SSML: the five XML characters are escaped, so the response never breaks", () => {
  const out = toSsml('Tom & Jerry <tag> "quote" it\'s');
  assert.ok(out.includes("&amp;"), out);
  assert.ok(out.includes("&lt;"), out);
  assert.ok(out.includes("&quot;"), out);
  assert.ok(out.includes("&apos;"), out);
  assert.ok(!/[<>"']/.test(out.replace(/&[a-z]+;/g, "")), out);
});

test("SSML: a long answer is cut at a sentence, not mid-word", () => {
  const long = ("This is one sentence. ").repeat(600);
  const out = toSsml(long, { maxChars: 300 });
  assert.ok(out.length <= 300, out.length);
  assert.ok(out.trim().endsWith("."), out.slice(-30));
});

test("SSML: empty and null never blow up", () => {
  assert.equal(toSsml(""), "");
  assert.equal(toSsml(null), "");
  assert.equal(toSsml(undefined), "");
  assert.equal(escapeSsml(null), "");
});

test("the conversation id is accepted by the server and stays the same for the same user", () => {
  const a = conversationIdFor("amzn1.ask.account.EXAMPLEUSERIDFORTESTSONLY000000000");
  const b = conversationIdFor("amzn1.ask.account.EXAMPLEUSERIDFORTESTSONLY000000000");
  assert.equal(a, b, "the same Echo user keeps their history");
  assert.match(a, /^[A-Za-z0-9_-]{1,64}$/, "server rule: letters, digits, _ and -, max 64");
  assert.ok(a.length <= 64);
  assert.notEqual(a, conversationIdFor("amzn1.ask.account.OTHER"));
  assert.match(conversationIdFor(undefined), /^[A-Za-z0-9_-]{1,64}$/);
});

test("APL: the card carries the agent's name, the answer and the photo", () => {
  const d = aplDirective({ title: "Ana", body: "Three orders today.", image: "https://x/p.jpg" });
  assert.equal(d.type, "Alexa.Presentation.APL.RenderDocument");
  assert.equal(d.document.version, "1.9");
  const s = JSON.stringify(d);
  assert.ok(s.includes("Ana"));
  assert.ok(s.includes("Three orders today."));
  assert.ok(s.includes("https://x/p.jpg"));
  assert.ok(!s.includes("alexa-layouts"), "primitives only, so it renders on every Echo Show");
});

test("APL: without a photo the card still renders", () => {
  const d = aplDirective({ title: "Ana", body: "Hello" });
  assert.ok(!JSON.stringify(d).includes('"Image"'));
});

test("APL is only used when the device says it supports it", () => {
  const dev = (si) => ({ requestEnvelope: { context: { System: { device: { supportedInterfaces: si } } } } });
  assert.equal(aplSupported(dev({ "Alexa.Presentation.APL": {} })), true);
  assert.equal(aplSupported(dev({})), false);
  assert.equal(aplSupported({}), false);
});

test("the secret key is required and must be a real ORYKSA key", () => {
  assert.throws(() => new OryksaApi({}), /API key/);
  assert.throws(() => new OryksaApi({ apiKey: "sk-something" }), /oryk_live_/);
  assert.doesNotThrow(() => new OryksaApi({ apiKey: "oryk_live_test", fetch: async () => ({}) }));
});

test("OryksaError keeps the status and the code", () => {
  const e = new OryksaError(429, "rate_limited", "Too many");
  assert.equal(e.status, 429);
  assert.equal(e.code, "rate_limited");
  assert.ok(e instanceof Error);
});

test("the body's own status never clobbers the HTTP code (bug found by the live test)", async () => {
  const fakeFetch = async (url, init) => ({
    ok: true,
    status: 200,
    json: async () => ({ object: "chat_reply", conversation_id: "c1", status: "replied", reply: "Nine orders." }),
  });
  const api = new OryksaApi({ apiKey: "oryk_live_test", fetch: fakeFetch });
  const r = await api.chat("oryk_cs_x", { message: "how many orders" });
  assert.equal(r.statusCode, 200, "the HTTP code must survive");
  assert.equal(r.status, "replied", "the body's own field must survive too");
  assert.equal(r.reply, "Nine orders.");
});

test("202 keeps the HTTP code so the turn knows it has to poll", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 202,
    json: async () => ({ object: "chat_reply", status: "pending", reply: null }),
  });
  const api = new OryksaApi({ apiKey: "oryk_live_test", fetch: fakeFetch });
  const r = await api.chat("oryk_cs_x", { message: "write a long report" });
  assert.equal(r.statusCode, 202);
  assert.equal(r.status, "pending");
  assert.equal(r.reply, null);
});

test("the message, the language and the platform go in the body, the token in the header", async () => {
  let seen = null;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ status: "replied", reply: "ok" }) };
  };
  const api = new OryksaApi({ apiKey: "oryk_live_test", fetch: fakeFetch });
  await api.chat("oryk_cs_sessiontoken", { message: "hi", lang: "br", platform: "alexa" });
  assert.equal(seen.url, "https://api.oryksa.com/v1/client/chat");
  assert.equal(seen.init.headers.Authorization, "Bearer oryk_cs_sessiontoken");
  assert.match(seen.init.headers["X-ORYKSA-SDK"], /^alexa-node\//);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.message, "hi");
  assert.equal(body.lang, "br");
  assert.equal(body.platform, "alexa");
});

test("an API error comes back as OryksaError with its code", async () => {
  const fakeFetch = async () => ({
    ok: false, status: 429,
    json: async () => ({ error: { code: "rate_limited", message: "Too many requests" } }),
  });
  const api = new OryksaApi({ apiKey: "oryk_live_test", fetch: fakeFetch });
  await assert.rejects(() => api.chat("oryk_cs_x", { message: "hi" }), (e) => {
    assert.ok(e instanceof OryksaError);
    assert.equal(e.status, 429);
    assert.equal(e.code, "rate_limited");
    return true;
  });
});

test("every request says who it is, or the edge blocks it", async () => {
  let seen = null;
  const api = new OryksaApi({ apiKey: "oryk_live_test", fetch: async (url, init) => {
    seen = init; return { ok: true, status: 200, json: async () => ({ object: "agent", name: "Ana" }) };
  } });
  await api.agent("oryk_cs_x");
  assert.ok(seen.headers["User-Agent"], "no User-Agent: the request would be blocked");
  assert.match(seen.headers["User-Agent"], /^oryksa-alexa\//);
});
