/*!
 * @oryksa/alexa - put your ORYKSA AI employee inside your own Alexa skill.
 *
 * One catch-all handler sends whatever the customer said to the ORYKSA API and
 * speaks the answer back. Works with ask-sdk-core on Lambda or on your own HTTPS
 * endpoint. Docs: https://developer.oryksa.com   License: MIT
 */

import { createHash } from "node:crypto";

export const VERSION = "1.2.79";
const DEFAULT_BASE = "https://api.oryksa.com/v1";
const SDK_HEADER = "alexa-node/" + VERSION;
// Every request says who it is. The edge in front of the API blocks anonymous
// or generic clients outright (Cloudflare 1010), as the Python side proved.
const USER_AGENT = "oryksa-alexa/" + VERSION + " (+https://developer.oryksa.com)";

/* --------------------------------------------------------------- errors */

export class OryksaError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "OryksaError";
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/* --------------------------------------------------------------- locales
 * Alexa's own locales only. Alexa has no pt-PT, so Portuguese is pt-BR.
 * The ORYKSA API takes pt | br | en | es (see /v1/client/chat, field `lang`).
 */

export const SUPPORTED_LOCALES = [
  "en-US", "en-GB", "en-AU", "en-CA", "en-IN",
  "es-ES", "es-MX", "es-US",
  "pt-BR",
];

export function langOf(locale) {
  const l = String(locale || "en-US").toLowerCase();
  if (l.startsWith("pt")) return "br";
  if (l.startsWith("es")) return "es";
  return "en";
}

/* What the skill says when it has to speak on its own. Four languages, no
 * hardcoded text anywhere else in this file. */
const TXT = {
  en: {
    help: "Ask me anything, or say stop to leave.",
    reprompt: "What else can I help you with?",
    bye: "Goodbye.",
    error: "Sorry, I could not answer that right now. Please try again.",
    thinking: "One moment, I am checking that for you.",
    empty: "I did not catch that. Could you say it again?",
  },
  br: {
    help: "Pode me perguntar o que quiser, ou dizer pare para sair.",
    reprompt: "Em que mais posso ajudar?",
    bye: "Até logo.",
    error: "Não consegui responder agora. Tente de novo, por favor.",
    thinking: "Um momento, estou verificando isso para você.",
    empty: "Não entendi. Pode repetir?",
  },
  pt: {
    help: "Pergunte-me o que quiser, ou diga pare para sair.",
    reprompt: "Em que mais posso ajudar?",
    bye: "Até logo.",
    error: "Não consegui responder agora. Tente de novo, por favor.",
    thinking: "Um momento, estou a verificar isso.",
    empty: "Não percebi. Pode repetir?",
  },
  es: {
    help: "Pregúntame lo que quieras, o di para para salir.",
    reprompt: "¿En qué más puedo ayudarte?",
    bye: "Hasta luego.",
    error: "No he podido responder ahora. Inténtalo de nuevo, por favor.",
    thinking: "Un momento, lo estoy comprobando.",
    empty: "No te he entendido. ¿Puedes repetirlo?",
  },
};

export function textFor(locale, key) {
  const t = TXT[langOf(locale)] || TXT.en;
  return t[key] || TXT.en[key] || "";
}

/* ----------------------------------------------------- intent to sentence
 * The certified ORYKSA skill model carries free text in a single
 * AMAZON.SearchQuery slot (AskIntent.q, EmailBodyIntent.text). Everything the
 * customer says arrives there. The named intents are shortcuts, so each one
 * becomes the sentence a person would have said.
 */

const SLOT_NAMES = ["q", "text", "query", "question", "message"];

const INTENT_SENTENCE = {
  SummaryIntent: { en: "give me a summary of today", br: "me dá um resumo de hoje", pt: "dá-me um resumo de hoje", es: "dame un resumen de hoy" },
  AgendaIntent: { en: "what is on my agenda", br: "o que tenho na agenda", pt: "o que tenho na agenda", es: "qué tengo en mi agenda" },
  MessagesIntent: { en: "read my latest messages", br: "lê minhas últimas mensagens", pt: "lê as minhas últimas mensagens", es: "lee mis últimos mensajes" },
  CreditsIntent: { en: "how many credits do I have left", br: "quantos créditos eu tenho", pt: "quantos créditos tenho", es: "cuántos créditos me quedan" },
  EmailIntent: { en: "do I have new e-mails", br: "tenho e-mails novos", pt: "tenho e-mails novos", es: "tengo correos nuevos" },
  CalendarIntent: { en: "what is next on my calendar", br: "qual é o meu próximo compromisso", pt: "qual é o meu próximo compromisso", es: "cuál es mi próxima cita" },
};

/**
 * Pick a sentence out of a per-language map.
 *
 * Alexa has no pt-PT, so Portugal runs on pt-BR. Both are Portuguese, so a map
 * written with `pt` still answers a `br` device and the other way round.
 */
export function pickSentence(canned, lang) {
  if (!canned) return "";
  if (typeof canned === "string") return canned;
  const order = lang === "br" ? ["br", "pt"] : lang === "pt" ? ["pt", "br"] : [lang];
  for (const k of order) if (canned[k]) return canned[k];
  return canned.en || canned.pt || canned.br || "";
}

/**
 * Build the sentence to send to the AI from an Alexa request.
 *
 * `extra` lets a skill map its own slotless intents to a sentence, which is how
 * a shortcut like "read my new messages" reaches an AI that only speaks prose:
 *
 *   { InboxIntent: { pt: "tenho mensagens novas", en: "do I have new messages" } }
 */
export function utteranceOf(req, locale, extra) {
  const lang = langOf(locale);
  const intent = req && req.intent;
  if (!intent) return "";
  const slots = intent.slots || {};
  for (const n of SLOT_NAMES) {
    const v = slots[n] && String(slots[n].value || "").trim();
    if (v) return v;
  }
  for (const k of Object.keys(slots)) {
    const v = String(slots[k].value || "").trim();
    if (v) return v;
  }
  const canned = (extra && extra[intent.name]) || INTENT_SENTENCE[intent.name];
  return pickSentence(canned, lang);
}

/* --------------------------------------------------------------- SSML
 * The AI writes for the eye (markdown, links, lists). Alexa reads out loud, so
 * the text is stripped down and escaped before it goes into <speak>.
 */

export function toSsml(text, { maxChars = 7000 } = {}) {
  let s = String(text == null ? "" : text);
  s = s.replace(/```[\s\S]*?```/g, " ");                    // code blocks
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");              // images
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");          // links keep the label
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, "");                 // headings
  s = s.replace(/(\*\*|__|\*|_|`)/g, "");                   // bold, italic, code
  s = s.replace(/^\s*[-*+]\s+/gm, "");                      // bullets
  s = s.replace(/https?:\/\/\S+/g, "");                     // bare urls
  s = s.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (s.length > maxChars) {
    s = s.slice(0, maxChars);
    const cut = Math.max(s.lastIndexOf("."), s.lastIndexOf("!"), s.lastIndexOf("?"));
    if (cut > maxChars * 0.5) s = s.slice(0, cut + 1);
  }
  return escapeSsml(s);
}

export function escapeSsml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ----------------------------------------------- stable conversation id
 * conversation_id must match /^[A-Za-z0-9_-]{1,64}$/ on the server, and the
 * Alexa userId has dots in it. The hash is stable, so the same Echo user keeps
 * the same ORYKSA conversation across sessions.
 */

export function conversationIdFor(userId, prefix = "alexa") {
  const h = createHash("sha256").update(String(userId || "anon")).digest("hex");
  return (prefix + "-" + h).slice(0, 64);
}

/* --------------------------------------------------------------- API client */

async function request(base, token, method, path, body, fetchImpl, timeoutMs) {
  const f = fetchImpl || globalThis.fetch;
  if (!f) throw new Error("fetch is not available: pass { fetch } in the options (Node < 18).");
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await f(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-ORYKSA-SDK": SDK_HEADER,
        "User-Agent": USER_AGENT,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok && res.status !== 202) {
    const e = (data && data.error) || {};
    const { code, message, ...extra } = e;
    throw new OryksaError(res.status, code || "http_" + res.status,
      message || "Request failed with HTTP " + res.status, extra);
  }
  return { status: res.status, data };
}

/**
 * Talks to the ORYKSA public API. The secret key only ever leaves your Lambda,
 * never the device: it is used to mint a short-lived client token per customer.
 */
export class OryksaApi {
  constructor({ apiKey, baseUrl, fetch, timeoutMs } = {}) {
    if (!apiKey || !String(apiKey).startsWith("oryk_live_")) {
      throw new Error("An ORYKSA API key (oryk_live_...) is required. Create one at developer.oryksa.com.");
    }
    this._key = apiKey;
    this._base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this._fetch = fetch;
    this._timeout = timeoutMs || 20000;
  }

  /** POST /v1/sessions -> { client_token, conversation_id, expires_at } */
  async createSession({ conversationId, customerName, customerEmail, customerPhone, ttlMinutes = 1440 } = {}) {
    const { data } = await request(this._base, this._key, "POST", "/sessions", {
      conversation_id: conversationId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      ttl_minutes: ttlMinutes,
    }, this._fetch, this._timeout);
    return data;
  }

  /** POST /v1/client/chat -> 200 { status:'replied', reply } or 202 { status:'pending' }
   * The HTTP code comes back as `statusCode`: the body has its own `status`
   * field ("replied" / "pending") and the two must not collide. */
  async chat(clientToken, { message, lang, platform = "alexa", appContext } = {}) {
    const { status, data } = await request(this._base, clientToken, "POST", "/client/chat", {
      message, lang, platform, app_context: appContext,
    }, this._fetch, this._timeout);
    return { ...(data || {}), statusCode: status };
  }

  /** GET /v1/client/messages -> { messages: [{role, content}] } */
  async messages(clientToken) {
    const { data } = await request(this._base, clientToken, "GET", "/client/messages", undefined, this._fetch, this._timeout);
    return data;
  }

  /** GET /v1/client/agent -> name, photo, greeting, suggestions, language... */
  async agent(clientToken) {
    const { data } = await request(this._base, clientToken, "GET", "/client/agent", undefined, this._fetch, this._timeout);
    return data;
  }
}

/* --------------------------------------------------- progressive response
 * Alexa cuts the turn off at about 8 seconds. A progressive response buys the
 * time: Alexa says "one moment" while the AI is still writing. It is sent to
 * the endpoint that came in the request, with the token that came in the
 * request, and a failure here never breaks the answer.
 */

export async function sendProgressive(handlerInput, speech, fetchImpl) {
  try {
    const env = handlerInput && handlerInput.requestEnvelope;
    const sys = env && env.context && env.context.System;
    const token = sys && sys.apiAccessToken;
    const endpoint = sys && sys.apiEndpoint;
    const requestId = env && env.request && env.request.requestId;
    if (!token || !endpoint || !requestId) return false;
    const f = fetchImpl || globalThis.fetch;
    if (!f) return false;
    const res = await f(endpoint.replace(/\/$/, "") + "/v1/directives", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        header: { requestId },
        directive: { type: "VoicePlayer.Speak", speech: "<speak>" + escapeSsml(speech) + "</speak>" },
      }),
    });
    return !!(res && (res.ok || res.status === 204));
  } catch (_) {
    return false;
  }
}

/* --------------------------------------------------------------- APL card
 * Primitives only (APL 1.9, no alexa-layouts), so it renders on every Echo
 * Show without an extra import. Shown only when the device says it can.
 */

export function aplSupported(handlerInput) {
  try {
    const si = handlerInput.requestEnvelope.context.System.device.supportedInterfaces || {};
    // The device sends the interface as a key; its value may be an empty
    // object, so presence is what counts, not truthiness.
    return Object.prototype.hasOwnProperty.call(si, "Alexa.Presentation.APL");
  } catch (_) {
    return false;
  }
}

export function aplDirective({ title, body, image }) {
  return {
    type: "Alexa.Presentation.APL.RenderDocument",
    token: "oryksa-reply",
    document: {
      type: "APL",
      version: "1.9",
      mainTemplate: {
        parameters: ["payload"],
        items: [{
          type: "Container",
          width: "100vw",
          height: "100vh",
          direction: "row",
          alignItems: "center",
          paddingLeft: "6vw",
          paddingRight: "6vw",
          items: [
            ...(image ? [{
              type: "Image",
              source: image,
              width: "22vh",
              height: "22vh",
              scale: "best-fill",
              borderRadius: "11vh",
              paddingRight: "4vw",
            }] : []),
            {
              type: "Container",
              grow: 1,
              items: [
                { type: "Text", text: String(title || ""), fontSize: "5vh", fontWeight: "700", maxLines: 1 },
                { type: "Text", text: String(body || ""), fontSize: "3.6vh", maxLines: 7, paddingTop: "1vh" },
              ],
            },
          ],
        }],
      },
    },
  };
}

/* --------------------------------------------------------- customer identity
 * Account linking is optional. When the customer has linked their account,
 * Alexa sends an access token: it is handed to the identity provider's own
 * userinfo endpoint, which verifies it and returns who they are. The e-mail and
 * phone then reach ORYKSA, so the AI never asks for contact details again.
 * The token is never decoded locally and never logged.
 */

async function resolveCustomer(opts, accessToken, fetchImpl) {
  if (!accessToken) return {};
  if (typeof opts.resolveCustomer === "function") {
    try {
      return (await opts.resolveCustomer(accessToken)) || {};
    } catch (_) {
      return {};
    }
  }
  if (!opts.userInfoUrl) return {};
  try {
    const f = fetchImpl || globalThis.fetch;
    const res = await f(opts.userInfoUrl, { headers: { Authorization: "Bearer " + accessToken } });
    if (!res || !res.ok) return {};
    const d = (await res.json()) || {};
    return {
      email: d.email || d.mail || undefined,
      phone: d.phone_number || d.phone || undefined,
      name: d.name || d.given_name || undefined,
    };
  } catch (_) {
    return {};
  }
}

/* --------------------------------------------------------------- the bridge */

const ATTR = "oryksa";

function attrs(handlerInput) {
  try { return handlerInput.attributesManager.getSessionAttributes() || {}; } catch (_) { return {}; }
}
function setAttrs(handlerInput, a) {
  try { handlerInput.attributesManager.setSessionAttributes(a); } catch (_) { /* no store, fine */ }
}

/**
 * Keeps one ORYKSA client session per Alexa session and answers one turn.
 */
export class OryksaBridge {
  constructor(opts = {}) {
    this.opts = opts;
    this.api = opts.api || new OryksaApi(opts);
    this.pollMs = opts.pollIntervalMs || 900;
    this.deadlineMs = opts.answerDeadlineMs || 24000;
    this.progressive = opts.progressive !== false;
    this.card = opts.card !== false;
  }

  localeOf(handlerInput) {
    try { return handlerInput.requestEnvelope.request.locale || "en-US"; } catch (_) { return "en-US"; }
  }

  /** The client token for this Alexa session, minted once and reused. */
  async token(handlerInput) {
    const a = attrs(handlerInput);
    const kept = a[ATTR];
    if (kept && kept.token && kept.expiresAt && Date.parse(kept.expiresAt) - Date.now() > 60000) {
      return kept;
    }
    const env = handlerInput.requestEnvelope;
    const user = (env.context && env.context.System && env.context.System.user) || {};
    const who = await resolveCustomer(this.opts, user.accessToken, this.opts.fetch);
    const s = await this.api.createSession({
      conversationId: conversationIdFor(user.userId, this.opts.conversationPrefix),
      customerName: who.name || this.opts.customerName,
      customerEmail: who.email,
      customerPhone: who.phone,
      ttlMinutes: this.opts.sessionTtlMinutes || 1440,
    });
    const next = { token: s.client_token, conversationId: s.conversation_id, expiresAt: s.expires_at, linked: !!who.email || !!who.phone };
    a[ATTR] = next;
    setAttrs(handlerInput, a);
    return next;
  }

  /** The agent's name and photo, read once per Alexa session. */
  async agent(handlerInput) {
    const a = attrs(handlerInput);
    if (a[ATTR] && a[ATTR].agent) return a[ATTR].agent;
    const t = await this.token(handlerInput);
    let ag = {};
    try { ag = (await this.api.agent(t.token)) || {}; } catch (_) { ag = {}; }
    const keep = { name: ag.name, photo: ag.photo || ag.avatar, greeting: ag.greeting, suggestions: ag.suggestions, language: ag.language };
    const a2 = attrs(handlerInput);
    a2[ATTR] = { ...(a2[ATTR] || {}), agent: keep };
    setAttrs(handlerInput, a2);
    return keep;
  }

  /** Send one sentence, wait for the answer, poll if the server is still writing. */
  async ask(handlerInput, message) {
    const locale = this.localeOf(handlerInput);
    const t = await this.token(handlerInput);
    const started = Date.now();
    let progressive = null;
    if (this.progressive) {
      progressive = sendProgressive(handlerInput, textFor(locale, "thinking"), this.opts.fetch);
    }
    const r = await this.api.chat(t.token, { message, lang: langOf(locale), platform: "alexa" });
    if (progressive) { try { await progressive; } catch (_) { /* never breaks the turn */ } }
    if (r.statusCode === 200 && r.reply) return String(r.reply);

    // 202: the AI is still writing. Read the conversation until the answer lands.
    let lastSeen = null;
    while (Date.now() - started < this.deadlineMs) {
      await new Promise((ok) => setTimeout(ok, this.pollMs));
      let conv;
      try { conv = await this.api.messages(t.token); } catch (_) { conv = null; }
      const msgs = (conv && conv.messages) || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant" && msgs[i].content) { lastSeen = String(msgs[i].content); break; }
      }
      if (lastSeen) return lastSeen;
    }
    return "";
  }

  /** One turn, start to finish: ask, speak, keep the session open, draw the card. */
  async reply(handlerInput, message, { endSession = false } = {}) {
    const locale = this.localeOf(handlerInput);
    const b = handlerInput.responseBuilder;
    let text = "";
    try {
      text = await this.ask(handlerInput, message);
    } catch (e) {
      text = "";
      if (typeof this.opts.onError === "function") { try { this.opts.onError(e); } catch (_) {} }
    }
    if (!text) text = textFor(locale, "error");
    b.speak("<speak>" + toSsml(text) + "</speak>");
    if (!endSession) b.reprompt("<speak>" + escapeSsml(textFor(locale, "reprompt")) + "</speak>");
    if (this.card) {
      let ag = {};
      try { ag = await this.agent(handlerInput); } catch (_) { ag = {}; }
      const title = ag.name || "ORYKSA";
      if (aplSupported(handlerInput)) {
        b.addDirective(aplDirective({ title, body: text, image: ag.photo }));
      } else {
        b.withStandardCard(title, text, ag.photo, ag.photo);
      }
    }
    if (endSession) b.withShouldEndSession(true);
    return b.getResponse();
  }
}

/* --------------------------------------------------------------- handlers
 * Plain ask-sdk-core shaped objects: { canHandle, handle }. No import needed to
 * build or test them, so they also drop into an existing skill one by one.
 */

export function oryksaHandlers(opts = {}) {
  const bridge = opts.bridge || new OryksaBridge(opts);
  const sentences = opts.intentSentences || null;
  const type = (h) => { try { return h.requestEnvelope.request.type; } catch (_) { return ""; } };
  const intent = (h) => { try { return h.requestEnvelope.request.intent.name; } catch (_) { return ""; } };
  const locale = (h) => bridge.localeOf(h);

  const launch = {
    canHandle: (h) => type(h) === "LaunchRequest",
    handle: async (h) => {
      const lang = langOf(locale(h));
      let ag = {};
      try { ag = await bridge.agent(h); } catch (_) { ag = {}; }
      const g = ag.greeting || {};
      const hello = (typeof g === "object" ? (g[lang] || g.en || g.pt) : g) || "";
      const name = ag.name || "ORYKSA";
      const text = hello || (lang === "en" ? `Hello, I am ${name}. ${TXT.en.help}`
        : lang === "es" ? `Hola, soy ${name}. ${TXT.es.help}`
        : `Olá, eu sou ${name}. ${TXT.br.help}`);
      const b = h.responseBuilder
        .speak("<speak>" + toSsml(text) + "</speak>")
        .reprompt("<speak>" + escapeSsml(textFor(locale(h), "reprompt")) + "</speak>");
      if (bridge.card) {
        if (aplSupported(h)) b.addDirective(aplDirective({ title: name, body: text, image: ag.photo }));
        else b.withStandardCard(name, text, ag.photo, ag.photo);
      }
      return b.getResponse();
    },
  };

  const stop = {
    canHandle: (h) => type(h) === "IntentRequest" && ["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.PauseIntent"].includes(intent(h)),
    handle: (h) => h.responseBuilder
      .speak("<speak>" + escapeSsml(textFor(locale(h), "bye")) + "</speak>")
      .withShouldEndSession(true)
      .getResponse(),
  };

  const help = {
    canHandle: (h) => type(h) === "IntentRequest" && intent(h) === "AMAZON.HelpIntent",
    handle: (h) => bridge.reply(h, utteranceOf(h.requestEnvelope.request, locale(h), sentences) || textFor(locale(h), "help")),
  };

  /** Everything else the customer says goes to the AI, whatever intent it hit. */
  const catchAll = {
    canHandle: (h) => type(h) === "IntentRequest" && !["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.PauseIntent", "AMAZON.HelpIntent"].includes(intent(h)),
    handle: async (h) => {
      const said = utteranceOf(h.requestEnvelope.request, locale(h), sentences);
      if (!said) {
        return h.responseBuilder
          .speak("<speak>" + escapeSsml(textFor(locale(h), "empty")) + "</speak>")
          .reprompt("<speak>" + escapeSsml(textFor(locale(h), "reprompt")) + "</speak>")
          .getResponse();
      }
      return bridge.reply(h, said);
    },
  };

  const sessionEnded = {
    canHandle: (h) => type(h) === "SessionEndedRequest",
    handle: (h) => h.responseBuilder.getResponse(),
  };

  const errorHandler = {
    canHandle: () => true,
    handle: (h, error) => {
      if (typeof opts.onError === "function") { try { opts.onError(error); } catch (_) {} }
      return h.responseBuilder
        .speak("<speak>" + escapeSsml(textFor(locale(h), "error")) + "</speak>")
        .reprompt("<speak>" + escapeSsml(textFor(locale(h), "reprompt")) + "</speak>")
        .getResponse();
    },
  };

  return { bridge, launch, help, stop, catchAll, sessionEnded, errorHandler,
    requestHandlers: [launch, stop, help, catchAll, sessionEnded] };
}

/**
 * The whole skill in one line. Needs ask-sdk-core, loaded only here so the rest
 * of this package works (and tests run) without it.
 *
 *   export const handler = await createHandler({ apiKey: process.env.ORYKSA_API_KEY });
 */
export async function createHandler(opts = {}) {
  const { SkillBuilders } = await import("ask-sdk-core");
  const h = oryksaHandlers(opts);
  let b = SkillBuilders.custom().addRequestHandlers(...h.requestHandlers).addErrorHandlers(h.errorHandler);
  if (opts.skillId) b = b.withSkillId(opts.skillId);
  return b.lambda();
}

export default { OryksaApi, OryksaBridge, oryksaHandlers, createHandler, VERSION };
