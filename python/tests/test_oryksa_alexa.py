"""Every handler, end to end, against a fake ORYKSA API and a fake Alexa
response builder. What is checked is the final response: what Alexa would
actually say. No network, no ask-sdk, nothing to install.

    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from oryksa_alexa import (  # noqa: E402
    SUPPORTED_LOCALES,
    VERSION,
    OryksaApi,
    OryksaError,
    apl_directive,
    apl_supported,
    conversation_id_for,
    escape_ssml,
    lang_of,
    oryksa_handlers,
    text_for,
    to_ssml,
    utterance_of,
)


# --------------------------------------------------------------- test doubles

class FakeBuilder:
    def __init__(self) -> None:
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

    def add_directive(self, directive):
        self.directives.append(directive)
        return self

    def set_card(self, card):
        self.card = card
        return self

    def set_should_end_session(self, value):
        self.should_end_session = value
        return self

    @property
    def response(self):
        return self


class FakeAttributes:
    def __init__(self, initial=None):
        self.session_attributes = dict(initial or {})


class FakeInput:
    def __init__(self, request_type="IntentRequest", intent=None, slots=None, locale="en-US",
                 apl=False, access_token=None, user_id="amzn1.ask.account.TESTUSER", attributes=None):
        request = {"type": request_type, "locale": locale, "requestId": "amzn1.echo-api.request.1"}
        if intent:
            request["intent"] = {"name": intent, "slots": slots or {}}
        user = {"userId": user_id}
        if access_token:
            user["accessToken"] = access_token
        self.request_envelope = {
            "request": request,
            "context": {
                "System": {
                    "user": user,
                    "device": {"supportedInterfaces": {"Alexa.Presentation.APL": {}} if apl else {}},
                    "apiEndpoint": "https://api.eu.amazonalexa.com",
                    "apiAccessToken": "alexa-api-token",
                }
            },
        }
        self.attributes_manager = FakeAttributes(attributes)
        self.response_builder = FakeBuilder()


class FakeApi:
    def __init__(self, reply="You have three orders today.", pending=False, agent=None, fail=False):
        self.reply_text = reply
        self.pending = pending
        self.agent_data = agent
        self.fail = fail
        self.log = []

    def create_session(self, **kwargs):
        self.log.append(("create_session", kwargs))
        return {"client_token": "oryk_cs_faketoken",
                "conversation_id": kwargs.get("conversation_id"),
                "expires_at": "2099-01-01T00:00:00+00:00"}

    def chat(self, token, message=None, lang=None, platform=None, app_context=None):
        self.log.append(("chat", token, {"message": message, "lang": lang, "platform": platform}))
        if self.fail:
            raise OryksaError(500, "server_error", "down")
        if self.pending:
            return {"status_code": 202, "reply": None}
        return {"status_code": 200, "reply": self.reply_text}

    def messages(self, token):
        self.log.append(("messages", token))
        return {"messages": [{"role": "user", "content": "hi"},
                             {"role": "assistant", "content": self.reply_text}]}

    def agent(self, token):
        self.log.append(("agent", token))
        return self.agent_data or {"name": "Ana", "photo": "https://oryksa.com/p.jpg",
                                   "greeting": {"en": "Hello, I am Ana.", "br": "Olá, eu sou a Ana."}}


def build(**opts):
    api = opts.pop("fake_api", None) or FakeApi(**{k: opts.pop(k) for k in
                                                  ("reply", "pending", "agent", "fail") if k in opts})
    opts.setdefault("progressive", False)
    handlers = oryksa_handlers(api=api, **opts)
    handlers["log"] = api.log
    return handlers


def spoken(response):
    """What Alexa really says, with the SSML tags taken off."""
    import re
    return re.sub(r"<[^>]+>", "", response.speech or "").strip()


# -------------------------------------------------------------- pure pieces

class TestPieces(unittest.TestCase):
    def test_version_is_the_ecosystem_number(self):
        self.assertRegex(VERSION, r"^\d+\.\d+\.\d+$")

    def test_only_alexas_own_locales_and_no_pt_pt(self):
        self.assertEqual(len(SUPPORTED_LOCALES), 9)
        self.assertIn("pt-BR", SUPPORTED_LOCALES)
        self.assertNotIn("pt-PT", SUPPORTED_LOCALES)

    def test_every_locale_maps_to_a_language_the_api_accepts(self):
        for locale in SUPPORTED_LOCALES:
            self.assertIn(lang_of(locale), {"pt", "br", "en", "es"}, locale)
        self.assertEqual(lang_of("pt-BR"), "br")
        self.assertEqual(lang_of("es-MX"), "es")
        self.assertEqual(lang_of(None), "en")

    def test_the_four_languages_all_have_every_sentence(self):
        for locale in ("en-US", "pt-BR", "es-ES"):
            for key in ("help", "reprompt", "bye", "error", "thinking", "empty"):
                self.assertGreater(len(text_for(locale, key)), 3, "%s/%s" % (locale, key))
        self.assertNotEqual(text_for("pt-BR", "bye"), text_for("es-ES", "bye"))

    def test_free_text_comes_out_of_the_search_query_slot(self):
        request = {"intent": {"name": "AskIntent", "slots": {"q": {"value": "how many orders today"}}}}
        self.assertEqual(utterance_of(request, "en-US"), "how many orders today")

    def test_a_shortcut_intent_becomes_a_real_sentence_per_language(self):
        request = {"intent": {"name": "AgendaIntent", "slots": {}}}
        self.assertEqual(utterance_of(request, "en-US"), "what is on my agenda")
        self.assertEqual(utterance_of(request, "pt-BR"), "o que tenho na agenda")
        self.assertEqual(utterance_of(request, "es-ES"), "qué tengo en mi agenda")

    def test_an_unknown_slot_still_gets_through(self):
        request = {"intent": {"name": "Whatever", "slots": {"anything": {"value": "the blue one"}}}}
        self.assertEqual(utterance_of(request, "en-US"), "the blue one")

    def test_nothing_to_say_returns_empty_never_an_invented_sentence(self):
        self.assertEqual(utterance_of({"intent": {"name": "Nope", "slots": {}}}, "en-US"), "")
        self.assertEqual(utterance_of(None, "en-US"), "")

    def test_ssml_strips_markdown_so_alexa_does_not_read_asterisks(self):
        out = to_ssml("**Bold** and *italic* and `code`\n# Title\n- one\n- two")
        self.assertNotIn("*", out)
        self.assertNotIn("#", out)
        self.assertIn("Bold", out)

    def test_ssml_keeps_the_link_words_and_drops_the_address(self):
        out = to_ssml("See [our prices](https://oryksa.com/pricing) now")
        self.assertIn("our prices", out)
        self.assertNotIn("oryksa.com", out)

    def test_ssml_escapes_the_five_xml_characters(self):
        out = to_ssml("Tom & Jerry <tag> \"quote\" it's")
        for entity in ("&amp;", "&lt;", "&quot;", "&apos;"):
            self.assertIn(entity, out)

    def test_ssml_cuts_a_long_answer_at_a_sentence(self):
        out = to_ssml("This is one sentence. " * 600, max_chars=300)
        self.assertLessEqual(len(out), 300)
        self.assertTrue(out.strip().endswith("."))

    def test_ssml_never_blows_up_on_empty(self):
        self.assertEqual(to_ssml(""), "")
        self.assertEqual(to_ssml(None), "")
        self.assertEqual(escape_ssml(None), "")

    def test_conversation_id_is_accepted_by_the_server_and_stable(self):
        a = conversation_id_for("amzn1.ask.account.AFP3ZWPOS2BGJR7OWJZ3DHPKMOMNWY4C")
        b = conversation_id_for("amzn1.ask.account.AFP3ZWPOS2BGJR7OWJZ3DHPKMOMNWY4C")
        self.assertEqual(a, b)
        self.assertRegex(a, r"^[A-Za-z0-9_-]{1,64}$")
        self.assertNotEqual(a, conversation_id_for("amzn1.ask.account.OTHER"))

    def test_apl_card_carries_the_name_the_answer_and_the_photo(self):
        import json
        d = apl_directive("Ana", "Three orders today.", "https://x/p.jpg")
        self.assertEqual(d["type"], "Alexa.Presentation.APL.RenderDocument")
        self.assertEqual(d["document"]["version"], "1.9")
        raw = json.dumps(d)
        self.assertIn("Ana", raw)
        self.assertIn("https://x/p.jpg", raw)
        self.assertNotIn("alexa-layouts", raw)

    def test_apl_is_only_used_when_the_device_supports_it(self):
        self.assertTrue(apl_supported(FakeInput(apl=True)))
        self.assertFalse(apl_supported(FakeInput(apl=False)))
        self.assertFalse(apl_supported(None))

    def test_the_secret_key_is_required_and_must_be_a_real_oryksa_key(self):
        with self.assertRaises(ValueError):
            OryksaApi(api_key=None)
        with self.assertRaises(ValueError):
            OryksaApi(api_key="sk-something")
        OryksaApi(api_key="oryk_live_test")


# ------------------------------------------------------------------ handlers

class TestLaunch(unittest.TestCase):
    def test_speaks_the_agents_own_greeting_and_keeps_the_session_open(self):
        h = build()
        i = FakeInput(request_type="LaunchRequest")
        self.assertTrue(h["launch"].can_handle(i))
        r = h["launch"].handle(i)
        self.assertTrue(r.speech.startswith("<speak>"))
        self.assertIn("Ana", r.speech)
        self.assertIsNotNone(r.reprompt, "without a reprompt Alexa closes the skill")
        self.assertNotEqual(r.should_end_session, True)

    def test_portuguese_locale_speaks_portuguese(self):
        h = build()
        r = h["launch"].handle(FakeInput(request_type="LaunchRequest", locale="pt-BR"))
        self.assertIn("Olá", r.speech)

    def test_without_a_greeting_it_still_says_something_useful(self):
        h = build(agent={"name": "Bia", "photo": None, "greeting": {}})
        r = h["launch"].handle(FakeInput(request_type="LaunchRequest", locale="pt-BR"))
        self.assertIn("Bia", r.speech)
        self.assertGreater(len(spoken(r)), 20)


class TestCatchAll(unittest.TestCase):
    def test_what_the_customer_said_reaches_the_ai_and_is_spoken_back(self):
        h = build()
        i = FakeInput(intent="AskIntent", slots={"q": {"value": "how many orders today"}})
        self.assertTrue(h["catch_all"].can_handle(i))
        r = h["catch_all"].handle(i)
        chat = [c for c in h["log"] if c[0] == "chat"][0]
        self.assertEqual(chat[2]["message"], "how many orders today")
        self.assertEqual(chat[2]["platform"], "alexa")
        self.assertEqual(chat[2]["lang"], "en")
        self.assertIn("three orders", r.speech)
        self.assertIsNotNone(r.reprompt)

    def test_any_intent_in_the_skill_goes_to_the_ai(self):
        h = build()
        i = FakeInput(intent="SomethingTheCustomerAdded", slots={"whatever": {"value": "cancel my order"}})
        self.assertTrue(h["catch_all"].can_handle(i))
        h["catch_all"].handle(i)
        self.assertEqual([c for c in h["log"] if c[0] == "chat"][0][2]["message"], "cancel my order")

    def test_heard_nothing_asks_again_and_never_calls_the_api(self):
        h = build()
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={}))
        self.assertEqual(len([c for c in h["log"] if c[0] == "chat"]), 0)
        self.assertGreater(len(spoken(r)), 10)
        self.assertIsNotNone(r.reprompt)

    def test_the_language_follows_the_device_locale(self):
        h = build()
        h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "oi"}}, locale="pt-BR"))
        self.assertEqual([c for c in h["log"] if c[0] == "chat"][0][2]["lang"], "br")


class TestTheEightSecondLimit(unittest.TestCase):
    def test_pending_answer_is_polled_and_still_spoken(self):
        h = build(pending=True, poll_seconds=0.01, deadline_seconds=2)
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "write a long report"}}))
        self.assertTrue(any(c[0] == "messages" for c in h["log"]))
        self.assertIn("three orders", r.speech)

    def test_an_answer_that_never_lands_says_so_instead_of_going_silent(self):
        class NeverApi(FakeApi):
            def messages(self, token):
                return {"messages": [{"role": "user", "content": "hi"}]}

        h = build(fake_api=NeverApi(pending=True), poll_seconds=0.01, deadline_seconds=0.05)
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "x"}}))
        self.assertGreater(len(spoken(r)), 10, "Alexa must never answer with silence")
        self.assertIsNotNone(r.reprompt)


class TestTheSession(unittest.TestCase):
    def test_the_client_token_is_minted_once_and_reused(self):
        h = build()
        i = FakeInput(intent="AskIntent", slots={"q": {"value": "one"}})
        h["catch_all"].handle(i)
        kept = i.attributes_manager.session_attributes
        i2 = FakeInput(intent="AskIntent", slots={"q": {"value": "two"}}, attributes=kept)
        h["catch_all"].handle(i2)
        self.assertEqual(len([c for c in h["log"] if c[0] == "create_session"]), 1,
                         "one session per Alexa session, not per turn")

    def test_the_same_echo_user_keeps_the_same_conversation(self):
        h1, h2 = build(), build()
        h1["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "a"}}, user_id="amzn1.ask.account.SAME"))
        h2["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "b"}}, user_id="amzn1.ask.account.SAME"))
        c1 = [c for c in h1["log"] if c[0] == "create_session"][0][1]["conversation_id"]
        c2 = [c for c in h2["log"] if c[0] == "create_session"][0][1]["conversation_id"]
        self.assertEqual(c1, c2)


class TestAccountLinking(unittest.TestCase):
    def test_not_linked_sends_no_contact_details(self):
        h = build()
        h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}))
        session = [c for c in h["log"] if c[0] == "create_session"][0][1]
        self.assertIsNone(session["customer_email"])
        self.assertIsNone(session["customer_phone"])

    def test_linked_passes_the_email_and_phone_to_oryksa(self):
        seen = []

        def resolve(token):
            seen.append(token)
            return {"email": "ana@cliente.com", "phone": "+351912345678", "name": "Ana"}

        h = build(resolve_customer=resolve)
        h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}, access_token="linked-token"))
        self.assertEqual(seen, ["linked-token"])
        session = [c for c in h["log"] if c[0] == "create_session"][0][1]
        self.assertEqual(session["customer_email"], "ana@cliente.com")
        self.assertEqual(session["customer_phone"], "+351912345678")

    def test_the_identity_provider_being_down_does_not_stop_the_answer(self):
        def boom(token):
            raise RuntimeError("idp down")

        h = build(resolve_customer=boom)
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}, access_token="t"))
        self.assertIn("three orders", r.speech)

    def test_the_access_token_never_reaches_the_message_sent_to_oryksa(self):
        h = build(resolve_customer=lambda t: {"email": "a@b.c"})
        h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}, access_token="SECRET-TOKEN"))
        self.assertNotIn("SECRET-TOKEN", str([c for c in h["log"] if c[0] == "chat"]))


class TestTheScreen(unittest.TestCase):
    def test_on_an_echo_show_the_answer_is_drawn_with_the_agents_photo(self):
        h = build()
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}, apl=True))
        self.assertEqual(len(r.directives), 1)
        self.assertIsNone(r.card, "no duplicate card when the screen already shows it")
        raw = str(r.directives[0])
        self.assertIn("Ana", raw)
        self.assertIn("https://oryksa.com/p.jpg", raw)
        self.assertIn("three orders", raw)

    def test_on_a_screenless_echo_it_falls_back_to_a_card(self):
        h = build()
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}, apl=False))
        self.assertEqual(r.directives, [])
        self.assertIsNotNone(r.card)
        self.assertIn("Ana", str(r.card))
        self.assertIn("three orders", str(r.card))

    def test_the_card_can_be_turned_off(self):
        h = build(card=False)
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}, apl=True))
        self.assertEqual(r.directives, [])
        self.assertIsNone(r.card)


class TestStopHelpErrors(unittest.TestCase):
    def test_stop_and_cancel_end_the_session(self):
        h = build()
        for name in ("AMAZON.StopIntent", "AMAZON.CancelIntent"):
            i = FakeInput(intent=name)
            self.assertTrue(h["stop"].can_handle(i))
            self.assertFalse(h["catch_all"].can_handle(i), "stop must not reach the AI")
            r = h["stop"].handle(i)
            self.assertTrue(r.should_end_session)
            self.assertGreater(len(spoken(r)), 3)

    def test_help_asks_the_ai_and_keeps_the_session_open(self):
        h = build()
        i = FakeInput(intent="AMAZON.HelpIntent")
        self.assertTrue(h["help"].can_handle(i))
        self.assertFalse(h["catch_all"].can_handle(i))
        r = h["help"].handle(i)
        self.assertTrue(any(c[0] == "chat" for c in h["log"]))
        self.assertIsNotNone(r.reprompt)

    def test_the_api_failing_never_leaves_alexa_silent(self):
        errors = []
        h = build(fail=True, on_error=errors.append)
        r = h["catch_all"].handle(FakeInput(intent="AskIntent", slots={"q": {"value": "hi"}}))
        self.assertEqual(len(errors), 1)
        self.assertGreater(len(spoken(r)), 10)
        self.assertIsNotNone(r.reprompt)

    def test_the_error_handler_catches_anything_the_skill_throws(self):
        h = build()
        self.assertTrue(h["error_handler"].can_handle(FakeInput(), RuntimeError("boom")))
        r = h["error_handler"].handle(FakeInput(), RuntimeError("boom"))
        self.assertIn("<speak>", r.speech)
        self.assertIsNotNone(r.reprompt)

    def test_session_ended_is_answered_with_an_empty_response(self):
        h = build()
        i = FakeInput(request_type="SessionEndedRequest")
        self.assertTrue(h["session_ended"].can_handle(i))
        self.assertIsNone(h["session_ended"].handle(i).speech)


class TestProgressiveResponse(unittest.TestCase):
    def test_alexa_is_told_to_wait_with_the_requests_own_token(self):
        import json as _json

        seen = []

        class FakeOpener:
            def open(self, req, timeout=None):
                seen.append({"url": req.full_url, "headers": dict(req.headers), "body": req.data})

                class R:
                    status = 204

                    def read(self_inner):
                        return b"{}"

                    def __enter__(self_inner):
                        return self_inner

                    def __exit__(self_inner, *a):
                        return False

                return R()

        from oryksa_alexa import send_progressive
        ok = send_progressive(FakeInput(intent="AskIntent"), "one moment", opener=FakeOpener())
        self.assertTrue(ok)
        self.assertEqual(seen[0]["url"], "https://api.eu.amazonalexa.com/v1/directives")
        self.assertEqual(seen[0]["headers"].get("Authorization"), "Bearer alexa-api-token")
        body = _json.loads(seen[0]["body"].decode())
        self.assertEqual(body["directive"]["type"], "VoicePlayer.Speak")
        self.assertEqual(body["header"]["requestId"], "amzn1.echo-api.request.1")

    def test_a_request_without_a_token_is_skipped_quietly(self):
        from oryksa_alexa import send_progressive
        i = FakeInput(intent="AskIntent")
        del i.request_envelope["context"]["System"]["apiAccessToken"]
        self.assertFalse(send_progressive(i, "one moment"))


class TestTheWiring(unittest.TestCase):
    def test_stop_and_help_come_before_the_catch_all(self):
        h = build()
        order = h["request_handlers"]
        self.assertEqual(len(order), 5)
        self.assertLess(order.index(h["stop"]), order.index(h["catch_all"]))
        self.assertLess(order.index(h["help"]), order.index(h["catch_all"]))
        self.assertLess(order.index(h["launch"]), order.index(h["catch_all"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)


class FakeHttpOpener:
    """Stands in for urlopen: records the request and gives back a canned reply."""

    def __init__(self, status=200, payload=None, error=None):
        self.status = status
        self.payload = payload if payload is not None else {}
        self.error = error
        self.seen = []

    def open(self, request, timeout=None):
        self.seen.append({
            "url": request.full_url,
            "method": request.get_method(),
            "headers": dict(request.headers),
            "body": json.loads(request.data.decode()) if request.data else None,
        })
        if self.error is not None:
            raise self.error
        return _FakeResponse(self.status, self.payload)


class _FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self._raw = json.dumps(payload).encode()

    def read(self):
        return self._raw

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestTheHttpLayer(unittest.TestCase):
    """These go through the real client, not a fake api: the HTTP plumbing is
    what the live test caught a bug in."""

    def test_create_session_sends_the_secret_key_and_reads_the_token(self):
        opener = FakeHttpOpener(201, {"object": "client_session", "client_token": "oryk_cs_abc",
                                      "conversation_id": "alexa-x", "expires_at": "2099-01-01T00:00:00+00:00"})
        api = OryksaApi(api_key="oryk_live_test", opener=opener)
        out = api.create_session(conversation_id="alexa-x", customer_email="ana@cliente.com")
        self.assertEqual(out["client_token"], "oryk_cs_abc")
        sent = opener.seen[0]
        self.assertEqual(sent["url"], "https://api.oryksa.com/v1/sessions")
        self.assertEqual(sent["method"], "POST")
        self.assertEqual(sent["headers"].get("Authorization"), "Bearer oryk_live_test")
        self.assertTrue(sent["headers"].get("X-oryksa-sdk", "").startswith("alexa-python/"))
        self.assertEqual(sent["body"]["conversation_id"], "alexa-x")
        self.assertEqual(sent["body"]["customer_email"], "ana@cliente.com")

    def test_chat_keeps_the_http_code_and_the_bodys_own_status_apart(self):
        opener = FakeHttpOpener(200, {"object": "chat_reply", "status": "replied", "reply": "Nine orders."})
        api = OryksaApi(api_key="oryk_live_test", opener=opener)
        out = api.chat("oryk_cs_sessiontoken", message="how many orders", lang="br")
        self.assertEqual(out["status_code"], 200, "the HTTP code must survive")
        self.assertEqual(out["status"], "replied", "the body's own field must survive too")
        self.assertEqual(out["reply"], "Nine orders.")
        sent = opener.seen[0]
        self.assertEqual(sent["url"], "https://api.oryksa.com/v1/client/chat")
        self.assertEqual(sent["headers"].get("Authorization"), "Bearer oryk_cs_sessiontoken",
                         "the device turn uses the client token, never the secret key")
        self.assertEqual(sent["body"]["platform"], "alexa")
        self.assertEqual(sent["body"]["lang"], "br")

    def test_202_comes_back_as_pending(self):
        opener = FakeHttpOpener(202, {"object": "chat_reply", "status": "pending", "reply": None})
        api = OryksaApi(api_key="oryk_live_test", opener=opener)
        out = api.chat("oryk_cs_x", message="write a long report")
        self.assertEqual(out["status_code"], 202)
        self.assertEqual(out["status"], "pending")
        self.assertIsNone(out["reply"])

    def test_an_api_error_becomes_an_oryksa_error_with_its_code(self):
        import urllib.error

        body = json.dumps({"error": {"code": "rate_limited", "message": "Too many requests"}}).encode()
        err = urllib.error.HTTPError("https://api.oryksa.com/v1/client/chat", 429, "Too Many Requests", {}, None)
        err.read = lambda: body
        api = OryksaApi(api_key="oryk_live_test", opener=FakeHttpOpener(error=err))
        with self.assertRaises(OryksaError) as caught:
            api.chat("oryk_cs_x", message="hi")
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(caught.exception.code, "rate_limited")

    def test_the_network_being_down_becomes_a_clear_error(self):
        import urllib.error

        api = OryksaApi(api_key="oryk_live_test", opener=FakeHttpOpener(error=urllib.error.URLError("no route")))
        with self.assertRaises(OryksaError) as caught:
            api.agent("oryk_cs_x")
        self.assertEqual(caught.exception.code, "network_error")

    def test_the_default_opener_is_urlopen_which_exists(self):
        """The live test caught this: urllib.request has urlopen, not open."""
        import urllib.request

        from oryksa_alexa.client import http_open
        self.assertTrue(callable(urllib.request.urlopen))
        self.assertFalse(hasattr(urllib.request, "open"))
        self.assertTrue(callable(http_open))

    def test_every_request_says_who_it_is_or_the_edge_blocks_it(self):
        """The live test caught this: the edge in front of the API answers 403
        (Cloudflare 1010) to the default Python-urllib User-Agent."""
        opener = FakeHttpOpener(200, {"object": "agent", "name": "Ana"})
        api = OryksaApi(api_key="oryk_live_test", opener=opener)
        api.agent("oryk_cs_x")
        ua = opener.seen[0]["headers"].get("User-agent") or opener.seen[0]["headers"].get("User-Agent")
        self.assertTrue(ua, "no User-Agent: the request would be blocked")
        self.assertIn("oryksa-alexa/", ua)
        self.assertNotIn("urllib", ua)


class TestASkillsOwnIntents(unittest.TestCase):
    def test_a_slotless_intent_is_mapped_to_a_sentence_per_language(self):
        sentences = {
            "InboxIntent": {"pt": "tenho mensagens novas", "en": "do I have new messages"},
            "EarningsIntent": {"pt": "quanto ganhei este mês", "en": "how much did I earn this month"},
        }
        h = build(intent_sentences=sentences)
        h["catch_all"].handle(FakeInput(intent="InboxIntent", locale="pt-BR"))
        self.assertEqual([c for c in h["log"] if c[0] == "chat"][0][2]["message"], "tenho mensagens novas")

        h2 = build(intent_sentences=sentences)
        h2["catch_all"].handle(FakeInput(intent="InboxIntent", locale="en-GB"))
        self.assertEqual([c for c in h2["log"] if c[0] == "chat"][0][2]["message"], "do I have new messages")

    def test_a_single_string_works_too(self):
        h = build(intent_sentences={"OrdersIntent": "tenho encomendas novas"})
        h["catch_all"].handle(FakeInput(intent="OrdersIntent", locale="pt-BR"))
        self.assertEqual([c for c in h["log"] if c[0] == "chat"][0][2]["message"], "tenho encomendas novas")

    def test_a_slot_still_wins_because_the_customers_own_words_come_first(self):
        h = build(intent_sentences={"FindIntent": {"pt": "procuro alguém"}})
        h["catch_all"].handle(FakeInput(intent="FindIntent", slots={"service": {"value": "designer de logótipos"}}, locale="pt-BR"))
        self.assertEqual([c for c in h["log"] if c[0] == "chat"][0][2]["message"], "designer de logótipos")

    def test_the_skills_map_overrides_an_oryksa_default_of_the_same_name(self):
        h = build(intent_sentences={"AgendaIntent": {"pt": "que trabalhos tenho hoje"}})
        h["catch_all"].handle(FakeInput(intent="AgendaIntent", locale="pt-BR"))
        self.assertEqual([c for c in h["log"] if c[0] == "chat"][0][2]["message"], "que trabalhos tenho hoje")
