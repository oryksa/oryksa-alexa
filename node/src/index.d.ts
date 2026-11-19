/**
 * @oryksa/alexa - put your ORYKSA AI employee inside your own Alexa skill.
 * Docs: https://developer.oryksa.com
 */

export declare const VERSION: string;

/** Alexa's own locales. Alexa has no pt-PT, so Portuguese is pt-BR. */
export declare const SUPPORTED_LOCALES: readonly string[];

export declare class OryksaError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>);
}

/** The language the ORYKSA API expects, from an Alexa locale. */
export declare function langOf(locale?: string): "pt" | "br" | "en" | "es";

/** One of the skill's own sentences (help, reprompt, bye, error, thinking, empty). */
export declare function textFor(locale: string, key: string): string;

/** Pick a sentence out of a per-language map; pt and br answer for each other. */
export declare function pickSentence(canned: string | Record<string, string> | undefined, lang: string): string;

/** The sentence to send to the AI, taken from the request's slots or its intent. */
export declare function utteranceOf(
  request: unknown,
  locale: string,
  extra?: Record<string, string | Record<string, string>>
): string;

/** Strip markdown and addresses, escape XML, cut at a sentence. */
export declare function toSsml(text: string, opts?: { maxChars?: number }): string;
export declare function escapeSsml(s: string): string;

/** A conversation id the server accepts, stable for the same Alexa user. */
export declare function conversationIdFor(userId: string, prefix?: string): string;

export declare function sendProgressive(handlerInput: any, speech: string, fetchImpl?: typeof fetch): Promise<boolean>;
export declare function aplSupported(handlerInput: any): boolean;
export declare function aplDirective(opts: { title?: string; body?: string; image?: string | null }): Record<string, unknown>;

export interface ClientSession {
  object: "client_session";
  client_token: string;
  conversation_id: string;
  expires_at: string;
}

export interface ChatReply {
  /** The HTTP code: 200 when the reply is there, 202 while the AI is writing. */
  statusCode: number;
  /** The body's own field: "replied" or "pending". */
  status?: "replied" | "pending";
  object?: "chat_reply";
  conversation_id?: string;
  reply?: string | null;
  hint?: string;
}

export interface AgentLook {
  object?: "agent";
  name?: string;
  business?: string | null;
  gender?: "male" | "female";
  avatar?: string;
  photo?: string;
  greeting?: Record<string, string> | string;
  suggestions?: Record<string, string[]>;
  language?: string | null;
  voice?: string | null;
  conversation_id?: string;
}

export interface OryksaApiOptions {
  /** The secret key (oryk_live_...). Keep it in the Lambda, never on the device. */
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export declare class OryksaApi {
  constructor(opts: OryksaApiOptions);
  createSession(opts?: {
    conversationId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    ttlMinutes?: number;
  }): Promise<ClientSession>;
  chat(clientToken: string, opts: { message: string; lang?: string; platform?: string; appContext?: Record<string, unknown> }): Promise<ChatReply>;
  messages(clientToken: string): Promise<{ object: "conversation"; id: string; messages: { role: string; content: string }[] }>;
  agent(clientToken: string): Promise<AgentLook>;
}

export interface OryksaAlexaOptions extends Partial<OryksaApiOptions> {
  /** Pass your own client instead of a key (handy in tests). */
  api?: OryksaApi | Record<string, any>;
  bridge?: OryksaBridge;
  /** Say "one moment" while the AI writes, to beat Alexa's 8 second limit. Default true. */
  progressive?: boolean;
  /** Draw the answer on Echo Show, or send a card. Default true. */
  card?: boolean;
  pollIntervalMs?: number;
  answerDeadlineMs?: number;
  sessionTtlMinutes?: number;
  conversationPrefix?: string;
  customerName?: string;
  /** Account linking: turn Alexa's access token into who the customer is. */
  resolveCustomer?: (accessToken: string) => Promise<{ email?: string; phone?: string; name?: string }>;
  /** Or let the identity provider do it: its OIDC userinfo endpoint. */
  userInfoUrl?: string;
  /** Map your own slotless intents to the sentence a person would have said:
   *  { InboxIntent: { pt: "tenho mensagens novas", en: "do I have new messages" } } */
  intentSentences?: Record<string, string | Record<string, string>>;
  skillId?: string;
  onError?: (error: unknown) => void;
}

export declare class OryksaBridge {
  constructor(opts?: OryksaAlexaOptions);
  api: OryksaApi;
  localeOf(handlerInput: any): string;
  token(handlerInput: any): Promise<{ token: string; conversationId: string; expiresAt: string; linked: boolean }>;
  agent(handlerInput: any): Promise<AgentLook>;
  ask(handlerInput: any, message: string): Promise<string>;
  reply(handlerInput: any, message: string, opts?: { endSession?: boolean }): Promise<unknown>;
}

export interface RequestHandlerLike {
  canHandle(handlerInput: any): boolean | Promise<boolean>;
  handle(handlerInput: any, error?: unknown): unknown | Promise<unknown>;
}

export declare function oryksaHandlers(opts?: OryksaAlexaOptions): {
  bridge: OryksaBridge;
  launch: RequestHandlerLike;
  help: RequestHandlerLike;
  stop: RequestHandlerLike;
  catchAll: RequestHandlerLike;
  sessionEnded: RequestHandlerLike;
  errorHandler: RequestHandlerLike;
  requestHandlers: RequestHandlerLike[];
};

/** The whole skill in one line. Needs ask-sdk-core. */
export declare function createHandler(opts?: OryksaAlexaOptions): Promise<(event: any, context: any) => any>;
