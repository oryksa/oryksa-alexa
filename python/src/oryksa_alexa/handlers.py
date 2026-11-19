"""The bridge between Alexa and the ORYKSA AI employee.

One catch-all handler: whatever the customer said goes to the AI and the answer
comes back as speech. Handlers are plain objects with can_handle/handle, the
shape ask-sdk-core expects, so they also drop into an existing skill one at a
time and can be tested without ask-sdk installed.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from typing import Any, Dict, Optional

from .apl import apl_directive, apl_supported
from .client import USER_AGENT, OryksaApi, conversation_id_for, http_open, lang_of
from .speech import escape_ssml, text_for, to_ssml, utterance_of

ATTR = "oryksa"


# --------------------------------------------------------- progressive response

def send_progressive(handler_input: Any, speech: str, opener: Any = None) -> bool:
    """Alexa cuts the turn off at about 8 seconds. This says "one moment" while
    the AI is still writing. It uses the endpoint and the token that came in the
    request, and a failure here never breaks the answer."""
    try:
        env = _env(handler_input)
        system = _dig(env, "context", "system") or _dig(env, "context", "System")
        token = _dig(system, "api_access_token") or _dig(system, "apiAccessToken")
        endpoint = _dig(system, "api_endpoint") or _dig(system, "apiEndpoint")
        request_id = _dig(env, "request", "request_id") or _dig(env, "request", "requestId")
        if not (token and endpoint and request_id):
            return False
        body = json.dumps({
            "header": {"requestId": request_id},
            "directive": {"type": "VoicePlayer.Speak", "speech": "<speak>" + escape_ssml(speech) + "</speak>"},
        }).encode("utf-8")
        req = urllib.request.Request(
            str(endpoint).rstrip("/") + "/v1/directives",
            data=body,
            headers={"Authorization": "Bearer " + str(token), "Content-Type": "application/json",
                     "User-Agent": USER_AGENT},
            method="POST",
        )
        http_open(req, 4.0, opener)
        return True
    except Exception:
        return False


# -------------------------------------------------------------------- identity

def _resolve_customer(opts: Dict[str, Any], access_token: Optional[str], opener: Any = None) -> Dict[str, Any]:
    """Account linking is optional. When the customer has linked their account,
    Alexa sends an access token: it goes to the identity provider's own userinfo
    endpoint, which verifies it and says who they are. The token is never
    decoded locally and never logged."""
    if not access_token:
        return {}
    hook = opts.get("resolve_customer")
    if callable(hook):
        try:
            return hook(access_token) or {}
        except Exception:
            return {}
    url = opts.get("user_info_url")
    if not url:
        return {}
    try:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + access_token,
                                                   "User-Agent": USER_AGENT})
        with http_open(req, 6.0, opener) as res:
            data = json.loads(res.read().decode("utf-8", "replace")) or {}
        return {
            "email": data.get("email") or data.get("mail"),
            "phone": data.get("phone_number") or data.get("phone"),
            "name": data.get("name") or data.get("given_name"),
        }
    except Exception:
        return {}


# ---------------------------------------------------------------------- bridge

class OryksaBridge:
    """Keeps one ORYKSA client session per Alexa session and answers one turn."""

    def __init__(self, **opts: Any) -> None:
        self.opts = opts
        self.api = opts.get("api") or OryksaApi(
            api_key=opts.get("api_key"),
            base_url=opts.get("base_url") or "https://api.oryksa.com/v1",
            timeout=opts.get("timeout", 20.0),
            opener=opts.get("opener"),
        )
        self.poll_seconds = float(opts.get("poll_seconds", 0.9))
        self.deadline_seconds = float(opts.get("deadline_seconds", 24.0))
        self.progressive = opts.get("progressive", True)
        self.card = opts.get("card", True)

    # ----------------------------------------------------------------- pieces

    def locale_of(self, handler_input: Any) -> str:
        return _dig(_env(handler_input), "request", "locale") or "en-US"

    def _attrs(self, handler_input: Any) -> Dict[str, Any]:
        try:
            return handler_input.attributes_manager.session_attributes or {}
        except Exception:
            return {}

    def _set_attrs(self, handler_input: Any, value: Dict[str, Any]) -> None:
        try:
            handler_input.attributes_manager.session_attributes = value
        except Exception:
            pass

    def token(self, handler_input: Any) -> Dict[str, Any]:
        """The client token for this Alexa session, minted once and reused."""
        attrs = self._attrs(handler_input)
        kept = attrs.get(ATTR) or {}
        if kept.get("token") and kept.get("expires_in_epoch", 0) - time.time() > 60:
            return kept
        env = _env(handler_input)
        system = _dig(env, "context", "system") or _dig(env, "context", "System")
        user = _dig(system, "user") or {}
        access_token = _dig(user, "access_token") or _dig(user, "accessToken")
        user_id = _dig(user, "user_id") or _dig(user, "userId")
        who = _resolve_customer(self.opts, access_token, self.opts.get("opener"))
        session = self.api.create_session(
            conversation_id=conversation_id_for(user_id, self.opts.get("conversation_prefix", "alexa")),
            customer_name=who.get("name") or self.opts.get("customer_name"),
            customer_email=who.get("email"),
            customer_phone=who.get("phone"),
            ttl_minutes=int(self.opts.get("session_ttl_minutes", 1440)),
        )
        nxt = {
            "token": session.get("client_token"),
            "conversation_id": session.get("conversation_id"),
            "expires_in_epoch": time.time() + 60 * int(self.opts.get("session_ttl_minutes", 1440)),
            "linked": bool(who.get("email") or who.get("phone")),
        }
        attrs[ATTR] = {**kept, **nxt}
        self._set_attrs(handler_input, attrs)
        return attrs[ATTR]

    def agent(self, handler_input: Any) -> Dict[str, Any]:
        """The agent's name and photo, read once per Alexa session."""
        attrs = self._attrs(handler_input)
        kept = attrs.get(ATTR) or {}
        if kept.get("agent"):
            return kept["agent"]
        tok = self.token(handler_input)
        try:
            found = self.api.agent(tok["token"]) or {}
        except Exception:
            found = {}
        keep = {
            "name": found.get("name"),
            "photo": found.get("photo") or found.get("avatar"),
            "greeting": found.get("greeting"),
            "suggestions": found.get("suggestions"),
            "language": found.get("language"),
        }
        attrs = self._attrs(handler_input)
        attrs[ATTR] = {**(attrs.get(ATTR) or {}), "agent": keep}
        self._set_attrs(handler_input, attrs)
        return keep

    def ask(self, handler_input: Any, message: str) -> str:
        """Send one sentence and wait for the answer, polling if the AI is still
        writing (the API answers 202 while it works)."""
        locale = self.locale_of(handler_input)
        tok = self.token(handler_input)
        started = time.time()
        if self.progressive:
            threading.Thread(
                target=send_progressive,
                args=(handler_input, text_for(locale, "thinking"), self.opts.get("opener")),
                daemon=True,
            ).start()
        reply = self.api.chat(tok["token"], message=message, lang=lang_of(locale), platform="alexa")
        if reply.get("status_code") == 200 and reply.get("reply"):
            return str(reply["reply"])
        while time.time() - started < self.deadline_seconds:
            time.sleep(self.poll_seconds)
            try:
                conv = self.api.messages(tok["token"]) or {}
            except Exception:
                conv = {}
            for msg in reversed(conv.get("messages") or []):
                if msg.get("role") == "assistant" and msg.get("content"):
                    return str(msg["content"])
        return ""

    def reply(self, handler_input: Any, message: str, end_session: bool = False):
        """One turn, start to finish: ask, speak, keep the session open, draw the card."""
        locale = self.locale_of(handler_input)
        builder = handler_input.response_builder
        try:
            text = self.ask(handler_input, message)
        except Exception as e:  # never leave Alexa silent
            text = ""
            hook = self.opts.get("on_error")
            if callable(hook):
                try:
                    hook(e)
                except Exception:
                    pass
        if not text:
            text = text_for(locale, "error")
        builder.speak("<speak>" + to_ssml(text) + "</speak>")
        if not end_session:
            builder.ask("<speak>" + escape_ssml(text_for(locale, "reprompt")) + "</speak>")
        if self.card:
            try:
                ag = self.agent(handler_input)
            except Exception:
                ag = {}
            self._draw(handler_input, builder, ag.get("name") or "ORYKSA", text, ag.get("photo"))
        if end_session:
            builder.set_should_end_session(True)
        return builder.response

    def _draw(self, handler_input: Any, builder: Any, title: str, text: str, image: Optional[str]) -> None:
        """Draw the answer on the device. With ask-sdk installed these are its
        typed objects; without it they are the raw dictionaries Alexa expects,
        so the screen is never left empty just because an import failed."""
        if apl_supported(handler_input):
            builder.add_directive(_render_document(title, text, image) or apl_directive(title, text, image))
            return
        builder.set_card(_standard_card(title, text, image) or _standard_card_dict(title, text, image))


# -------------------------------------------------------------------- handlers

class _Base:
    def __init__(self, bridge: OryksaBridge) -> None:
        self.bridge = bridge

    def _locale(self, handler_input: Any) -> str:
        return self.bridge.locale_of(handler_input)


class LaunchHandler(_Base):
    def can_handle(self, handler_input: Any) -> bool:
        return _request_type(handler_input) == "LaunchRequest"

    def handle(self, handler_input: Any):
        locale = self._locale(handler_input)
        lang = lang_of(locale)
        try:
            ag = self.bridge.agent(handler_input)
        except Exception:
            ag = {}
        name = ag.get("name") or "ORYKSA"
        greeting = ag.get("greeting") or {}
        hello = greeting.get(lang) or greeting.get("en") or greeting.get("pt") if isinstance(greeting, dict) else greeting
        if not hello:
            if lang == "en":
                hello = "Hello, I am %s. %s" % (name, text_for(locale, "help"))
            elif lang == "es":
                hello = "Hola, soy %s. %s" % (name, text_for(locale, "help"))
            else:
                hello = "Olá, eu sou %s. %s" % (name, text_for(locale, "help"))
        builder = handler_input.response_builder
        builder.speak("<speak>" + to_ssml(hello) + "</speak>")
        builder.ask("<speak>" + escape_ssml(text_for(locale, "reprompt")) + "</speak>")
        if self.bridge.card:
            self.bridge._draw(handler_input, builder, name, hello, ag.get("photo"))
        return builder.response


class StopHandler(_Base):
    NAMES = ("AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.PauseIntent")

    def can_handle(self, handler_input: Any) -> bool:
        return _request_type(handler_input) == "IntentRequest" and _intent_name(handler_input) in self.NAMES

    def handle(self, handler_input: Any):
        builder = handler_input.response_builder
        builder.speak("<speak>" + escape_ssml(text_for(self._locale(handler_input), "bye")) + "</speak>")
        builder.set_should_end_session(True)
        return builder.response


class HelpHandler(_Base):
    def can_handle(self, handler_input: Any) -> bool:
        return _request_type(handler_input) == "IntentRequest" and _intent_name(handler_input) == "AMAZON.HelpIntent"

    def handle(self, handler_input: Any):
        locale = self._locale(handler_input)
        said = utterance_of(_dig(_env(handler_input), "request"), locale) or text_for(locale, "help")
        return self.bridge.reply(handler_input, said)


class CatchAllHandler(_Base):
    """Everything else the customer says goes to the AI, whatever intent it hit."""

    SKIP = StopHandler.NAMES + ("AMAZON.HelpIntent",)

    def can_handle(self, handler_input: Any) -> bool:
        return _request_type(handler_input) == "IntentRequest" and _intent_name(handler_input) not in self.SKIP

    def handle(self, handler_input: Any):
        locale = self._locale(handler_input)
        said = utterance_of(_dig(_env(handler_input), "request"), locale)
        if not said:
            builder = handler_input.response_builder
            builder.speak("<speak>" + escape_ssml(text_for(locale, "empty")) + "</speak>")
            builder.ask("<speak>" + escape_ssml(text_for(locale, "reprompt")) + "</speak>")
            return builder.response
        return self.bridge.reply(handler_input, said)


class SessionEndedHandler(_Base):
    def can_handle(self, handler_input: Any) -> bool:
        return _request_type(handler_input) == "SessionEndedRequest"

    def handle(self, handler_input: Any):
        return handler_input.response_builder.response


class OryksaErrorHandler(_Base):
    def can_handle(self, handler_input: Any, exception: Any = None) -> bool:
        return True

    def handle(self, handler_input: Any, exception: Any = None):
        hook = self.bridge.opts.get("on_error")
        if callable(hook):
            try:
                hook(exception)
            except Exception:
                pass
        locale = self._locale(handler_input)
        builder = handler_input.response_builder
        builder.speak("<speak>" + escape_ssml(text_for(locale, "error")) + "</speak>")
        builder.ask("<speak>" + escape_ssml(text_for(locale, "reprompt")) + "</speak>")
        return builder.response


def oryksa_handlers(**opts: Any) -> Dict[str, Any]:
    """Every handler, plus the order ask-sdk needs: stop and help before the catch-all."""
    bridge = opts.pop("bridge", None) or OryksaBridge(**opts)
    launch = LaunchHandler(bridge)
    stop = StopHandler(bridge)
    help_ = HelpHandler(bridge)
    catch_all = CatchAllHandler(bridge)
    ended = SessionEndedHandler(bridge)
    errors = OryksaErrorHandler(bridge)
    return {
        "bridge": bridge,
        "launch": launch,
        "stop": stop,
        "help": help_,
        "catch_all": catch_all,
        "session_ended": ended,
        "error_handler": errors,
        "request_handlers": [launch, stop, help_, catch_all, ended],
    }


def create_skill(**opts: Any):
    """The whole skill in one line. Needs ask-sdk-core, imported only here so the
    rest of this package works (and the tests run) without it.

        handler = create_skill(api_key=os.environ["ORYKSA_API_KEY"]).lambda_handler()
    """
    from ask_sdk_core.skill_builder import SkillBuilder

    built = oryksa_handlers(**opts)
    sb = SkillBuilder()
    for h in built["request_handlers"]:
        sb.add_request_handler(h)
    sb.add_exception_handler(built["error_handler"])
    if opts.get("skill_id"):
        sb.skill_id = opts["skill_id"]
    return sb


# ----------------------------------------------------------------- ask-sdk glue

def _render_document(title: str, text: str, image: Optional[str]):
    try:
        from ask_sdk_model.interfaces.alexa.presentation.apl import RenderDocumentDirective
    except Exception:
        return None
    from .apl import apl_document
    return RenderDocumentDirective(token="oryksa-reply", document=apl_document(title, text, image))


def _standard_card(title: str, text: str, image: Optional[str]):
    try:
        from ask_sdk_model.ui import Image, StandardCard
    except Exception:
        return None
    return StandardCard(
        title=title,
        text=text,
        image=Image(small_image_url=image, large_image_url=image) if image else None,
    )


def _standard_card_dict(title: str, text: str, image: Optional[str]) -> Dict[str, Any]:
    """The same card as a plain dictionary, for a skill that is not using ask-sdk."""
    card: Dict[str, Any] = {"type": "Standard" if image else "Simple",
                            "title": str(title or ""), "text": str(text or "")}
    if image:
        card["image"] = {"smallImageUrl": image, "largeImageUrl": image}
    return card


def _env(handler_input: Any):
    if handler_input is None:
        return None
    env = getattr(handler_input, "request_envelope", None)
    if env is None and isinstance(handler_input, dict):
        env = handler_input.get("request_envelope")
    return env


def _request_type(handler_input: Any) -> str:
    request = _dig(_env(handler_input), "request")
    if request is None:
        return ""
    return _dig(request, "object_type") or _dig(request, "type") or type(request).__name__


def _intent_name(handler_input: Any) -> str:
    return _dig(_env(handler_input), "request", "intent", "name") or ""


def _dig(obj: Any, *names: str):
    cur = obj
    for n in names:
        if cur is None:
            return None
        cur = cur.get(n) if isinstance(cur, dict) else getattr(cur, n, None)
    return cur


# Keep the directive helper reachable for a skill that builds raw dicts.
__all__ = [
    "OryksaBridge", "oryksa_handlers", "create_skill", "send_progressive",
    "LaunchHandler", "StopHandler", "HelpHandler", "CatchAllHandler",
    "SessionEndedHandler", "OryksaErrorHandler", "apl_directive",
]
