"""Turning what the AI wrote into what Alexa says.

The AI writes for the eye: markdown, links, lists. Alexa reads out loud, so the
text is stripped down and the five XML characters are escaped before it goes
inside <speak>. Nothing here touches the network.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from .client import lang_of

# What the skill says on its own. Four languages, no hardcoded text elsewhere.
TXT: Dict[str, Dict[str, str]] = {
    "en": {
        "help": "Ask me anything, or say stop to leave.",
        "reprompt": "What else can I help you with?",
        "bye": "Goodbye.",
        "error": "Sorry, I could not answer that right now. Please try again.",
        "thinking": "One moment, I am checking that for you.",
        "empty": "I did not catch that. Could you say it again?",
    },
    "br": {
        "help": "Pode me perguntar o que quiser, ou dizer pare para sair.",
        "reprompt": "Em que mais posso ajudar?",
        "bye": "Até logo.",
        "error": "Não consegui responder agora. Tente de novo, por favor.",
        "thinking": "Um momento, estou verificando isso para você.",
        "empty": "Não entendi. Pode repetir?",
    },
    "pt": {
        "help": "Pergunte-me o que quiser, ou diga pare para sair.",
        "reprompt": "Em que mais posso ajudar?",
        "bye": "Até logo.",
        "error": "Não consegui responder agora. Tente de novo, por favor.",
        "thinking": "Um momento, estou a verificar isso.",
        "empty": "Não percebi. Pode repetir?",
    },
    "es": {
        "help": "Pregúntame lo que quieras, o di para para salir.",
        "reprompt": "¿En qué más puedo ayudarte?",
        "bye": "Hasta luego.",
        "error": "No he podido responder ahora. Inténtalo de nuevo, por favor.",
        "thinking": "Un momento, lo estoy comprobando.",
        "empty": "No te he entendido. ¿Puedes repetirlo?",
    },
}

# The free-text slots of the certified ORYKSA model, in the order they are read.
SLOT_NAMES = ("q", "text", "query", "question", "message")

# A shortcut intent becomes the sentence a person would have said.
INTENT_SENTENCE: Dict[str, Dict[str, str]] = {
    "SummaryIntent": {"en": "give me a summary of today", "br": "me dá um resumo de hoje",
                      "pt": "dá-me um resumo de hoje", "es": "dame un resumen de hoy"},
    "AgendaIntent": {"en": "what is on my agenda", "br": "o que tenho na agenda",
                     "pt": "o que tenho na agenda", "es": "qué tengo en mi agenda"},
    "MessagesIntent": {"en": "read my latest messages", "br": "lê minhas últimas mensagens",
                       "pt": "lê as minhas últimas mensagens", "es": "lee mis últimos mensajes"},
    "CreditsIntent": {"en": "how many credits do I have left", "br": "quantos créditos eu tenho",
                      "pt": "quantos créditos tenho", "es": "cuántos créditos me quedan"},
    "EmailIntent": {"en": "do I have new e-mails", "br": "tenho e-mails novos",
                    "pt": "tenho e-mails novos", "es": "tengo correos nuevos"},
    "CalendarIntent": {"en": "what is next on my calendar", "br": "qual é o meu próximo compromisso",
                       "pt": "qual é o meu próximo compromisso", "es": "cuál es mi próxima cita"},
}


def text_for(locale: Optional[str], key: str) -> str:
    table = TXT.get(lang_of(locale)) or TXT["en"]
    return table.get(key) or TXT["en"].get(key) or ""


def utterance_of(request: Any, locale: Optional[str]) -> str:
    """The sentence to send to the AI, from the request's slots or its intent."""
    intent = _get(request, "intent")
    if not intent:
        return ""
    slots = _get(intent, "slots") or {}
    for name in SLOT_NAMES:
        value = _slot_value(slots, name)
        if value:
            return value
    for name in list(slots.keys() if hasattr(slots, "keys") else []):
        value = _slot_value(slots, name)
        if value:
            return value
    canned = INTENT_SENTENCE.get(_get(intent, "name") or "")
    if canned:
        return canned.get(lang_of(locale)) or canned["en"]
    return ""


def escape_ssml(text: Any) -> str:
    s = "" if text is None else str(text)
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&apos;"))


def to_ssml(text: Any, max_chars: int = 7000) -> str:
    s = "" if text is None else str(text)
    s = re.sub(r"```[\s\S]*?```", " ", s)              # code blocks
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", s)        # images
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)     # links keep the label
    s = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", s)        # headings
    s = re.sub(r"(\*\*|__|\*|_|`)", "", s)             # bold, italic, code
    s = re.sub(r"(?m)^\s*[-*+]\s+", "", s)             # bullets
    s = re.sub(r"https?://\S+", "", s)                 # bare addresses
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{2,}", "\n", s).strip()
    if len(s) > max_chars:
        s = s[:max_chars]
        cut = max(s.rfind("."), s.rfind("!"), s.rfind("?"))
        if cut > max_chars * 0.5:
            s = s[: cut + 1]
    return escape_ssml(s)


def _get(obj: Any, name: str):
    """Read a field whether it came as a dict or as an ask-sdk model object."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _slot_value(slots: Any, name: str) -> str:
    slot = slots.get(name) if isinstance(slots, dict) else _get(slots, name)
    if slot is None:
        return ""
    return str(_get(slot, "value") or "").strip()
