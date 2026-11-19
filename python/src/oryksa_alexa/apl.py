"""The Echo Show card.

APL primitives only (version 1.9, no alexa-layouts), so it renders on every
Echo Show without importing an extra package. Shown only when the device says
it supports APL.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def apl_supported(handler_input: Any) -> bool:
    try:
        env = getattr(handler_input, "request_envelope", None) or handler_input["request_envelope"]
        system = _dig(env, "context", "system") or _dig(env, "context", "System")
        device = _dig(system, "device") or {}
        interfaces = _dig(device, "supported_interfaces")
        if interfaces is None:
            interfaces = _dig(device, "supportedInterfaces") or {}
        if isinstance(interfaces, dict):
            # The device sends the interface as a key; its value may be an empty
            # object, so presence is what counts, not truthiness.
            return "Alexa.Presentation.APL" in interfaces or "alexa_presentation_apl" in interfaces
        return getattr(interfaces, "alexa_presentation_apl", None) is not None
    except Exception:
        return False


def apl_document(title: str = "", body: str = "", image: Optional[str] = None) -> Dict[str, Any]:
    items = []
    if image:
        items.append({
            "type": "Image",
            "source": str(image),
            "width": "22vh",
            "height": "22vh",
            "scale": "best-fill",
            "borderRadius": "11vh",
            "paddingRight": "4vw",
        })
    items.append({
        "type": "Container",
        "grow": 1,
        "items": [
            {"type": "Text", "text": str(title or ""), "fontSize": "5vh", "fontWeight": "700", "maxLines": 1},
            {"type": "Text", "text": str(body or ""), "fontSize": "3.6vh", "maxLines": 7, "paddingTop": "1vh"},
        ],
    })
    return {
        "type": "APL",
        "version": "1.9",
        "mainTemplate": {
            "parameters": ["payload"],
            "items": [{
                "type": "Container",
                "width": "100vw",
                "height": "100vh",
                "direction": "row",
                "alignItems": "center",
                "paddingLeft": "6vw",
                "paddingRight": "6vw",
                "items": items,
            }],
        },
    }


def apl_directive(title: str = "", body: str = "", image: Optional[str] = None) -> Dict[str, Any]:
    """The raw directive, for a skill that builds its response as a dict."""
    return {
        "type": "Alexa.Presentation.APL.RenderDocument",
        "token": "oryksa-reply",
        "document": apl_document(title, body, image),
    }


def _dig(obj: Any, *names: str):
    cur = obj
    for n in names:
        if cur is None:
            return None
        cur = cur.get(n) if isinstance(cur, dict) else getattr(cur, n, None)
    return cur
