"""oryksa-alexa: put your ORYKSA AI employee inside your own Alexa skill.

    from oryksa_alexa import create_skill
    handler = create_skill(api_key=os.environ["ORYKSA_API_KEY"]).lambda_handler()

Docs: https://developer.oryksa.com   License: MIT
"""

from .apl import apl_directive, apl_document, apl_supported
from .client import (
    DEFAULT_BASE,
    SUPPORTED_LOCALES,
    VERSION,
    OryksaApi,
    OryksaError,
    conversation_id_for,
    lang_of,
)
from .handlers import (
    CatchAllHandler,
    HelpHandler,
    LaunchHandler,
    OryksaBridge,
    OryksaErrorHandler,
    SessionEndedHandler,
    StopHandler,
    create_skill,
    oryksa_handlers,
    send_progressive,
)
from .speech import escape_ssml, pick_sentence, text_for, to_ssml, utterance_of

__version__ = VERSION

__all__ = [
    "VERSION", "__version__", "DEFAULT_BASE", "SUPPORTED_LOCALES",
    "OryksaApi", "OryksaError", "lang_of", "conversation_id_for",
    "to_ssml", "escape_ssml", "text_for", "utterance_of", "pick_sentence",
    "apl_supported", "apl_document", "apl_directive",
    "OryksaBridge", "oryksa_handlers", "create_skill", "send_progressive",
    "LaunchHandler", "StopHandler", "HelpHandler", "CatchAllHandler",
    "SessionEndedHandler", "OryksaErrorHandler",
]
