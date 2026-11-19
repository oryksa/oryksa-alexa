"""Live test against https://api.oryksa.com/v1 with a test account key.

The only test that needs the network; `python -m unittest discover` does not run
it. It walks the whole path an Echo would walk: mint a session, read the agent,
ask a real question, and check what Alexa would actually say.

    ORYKSA_API_KEY=oryk_live_... python tests/live.py
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from oryksa_alexa import OryksaApi, lang_of, oryksa_handlers  # noqa: E402

KEY = os.environ.get("ORYKSA_API_KEY", "")
assert KEY.startswith("oryk_live_"), "set ORYKSA_API_KEY to a test account key (oryk_live_...)"


def ok(message: str) -> None:
    print("  ok  " + message)


class FakeBuilder:
    def __init__(self):
        self.speech = None
        self.reprompt = None
        self.directives = []
        self.card = None
        self.should_end_session = None

    def speak(self, text):
        self.speech = text
        return self

    def ask(self, text):
        self.reprompt = text
        return self

    def add_directive(self, d):
        self.directives.append(d)
        return self

    def set_card(self, c):
        self.card = c
        return self

    def set_should_end_session(self, v):
        self.should_end_session = v
        return self

    @property
    def response(self):
        return self


class FakeAttributes:
    def __init__(self, initial=None):
        self.session_attributes = dict(initial or {})


class FakeInput:
    def __init__(self, request_type="IntentRequest", intent=None, slots=None,
                 locale="en-US", apl=False, attributes=None):
        request = {"type": request_type, "locale": locale, "requestId": "amzn1.echo-api.request.live"}
        if intent:
            request["intent"] = {"name": intent, "slots": slots or {}}
        self.request_envelope = {
            "request": request,
            "context": {"System": {
                "user": {"userId": "amzn1.ask.account.LIVETESTPY"},
                "device": {"supportedInterfaces": {"Alexa.Presentation.APL": {}} if apl else {}},
            }},
        }
        self.attributes_manager = FakeAttributes(attributes)
        self.response_builder = FakeBuilder()


def spoken(response) -> str:
    """The words Alexa really says: tags off and the XML entities put back."""
    text = re.sub(r"<[^>]+>", "", response.speech or "")
    for entity, char in (("&apos;", "'"), ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")):
        text = text.replace(entity, char)
    return text.strip()


# ------------------------------------------------------------------ the API

api = OryksaApi(api_key=KEY, timeout=40.0)

import time  # noqa: E402

session = api.create_session(conversation_id="alexa-live-py-%d" % int(time.time()), ttl_minutes=10)
assert session.get("object") == "client_session", session
token = session["client_token"]
assert token.startswith("oryk_cs_"), "the device token must be a client token, never the secret key"
ok("POST /v1/sessions: client token minted, conversation " + session["conversation_id"])

agent = api.agent(token)
assert agent.get("object") == "agent", agent
assert agent.get("name"), "the agent must have a name to speak and to draw"
ok("GET /v1/client/agent: name=%s, photo=%s" % (agent["name"], "yes" if agent.get("photo") else "no"))

reply = api.chat(token, message="In one short sentence, what do you do?", lang="en", platform="alexa")
assert reply.get("status_code") in (200, 202), reply
assert reply.get("status") in ("replied", "pending"), reply
ok("POST /v1/client/chat: HTTP %s %s%s" % (
    reply["status_code"], reply.get("status"),
    (', reply "%s..."' % str(reply.get("reply"))[:55]) if reply.get("reply") else " (still writing)"))

# ---------------------------------------------------- the whole turn, as the Echo gets it

h = oryksa_handlers(api_key=KEY, progressive=False, timeout=40.0, deadline_seconds=40.0)

launch = h["launch"].handle(FakeInput(request_type="LaunchRequest"))
assert launch.speech.startswith("<speak>") and launch.speech.endswith("</speak>")
assert len(spoken(launch)) > 10, "the greeting cannot be empty"
assert launch.reprompt, "without a reprompt the skill closes after the greeting"
ok('LaunchRequest -> "%s..."' % spoken(launch)[:70])

asked = FakeInput(intent="AskIntent", slots={"q": {"value": "what are your opening hours"}})
answer = h["catch_all"].handle(asked)
said = spoken(answer)
assert len(said) > 5, "Alexa would say nothing"
assert not re.search(r"[*#`]", said), "markdown reached the speech: " + said
assert not re.search(r"https?://", said), "an address reached the speech"
assert answer.reprompt, "the conversation must stay open"
assert answer.card, "a card is expected on a screenless device"
ok('AskIntent -> "%s..."' % said[:90])

pt = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "o que você faz"}}, locale="pt-BR"))
assert lang_of("pt-BR") == "br"
assert len(spoken(pt)) > 5, "the Portuguese turn said nothing"
ok('pt-BR -> "%s..."' % spoken(pt)[:90])

show = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hello"}}, apl=True))
assert len(show.directives) == 1, "an Echo Show must get the APL document"
assert show.card is None, "no duplicate card when the screen already shows it"
ok("Echo Show -> APL document rendered")

second = FakeInput(intent="AskIntent", slots={"q": {"value": "and anything else?"}},
                   attributes=asked.attributes_manager.session_attributes)
h["catch_all"].handle(second)
assert (second.attributes_manager.session_attributes["oryksa"]["token"]
        == asked.attributes_manager.session_attributes["oryksa"]["token"]), "the token must be reused"
ok("second turn reused the same client token")

bye = h["stop"].handle(FakeInput(intent="AMAZON.StopIntent"))
assert bye.should_end_session is True
ok('StopIntent -> "%s", session closed' % spoken(bye))

print("\nall live checks passed against https://api.oryksa.com/v1")
