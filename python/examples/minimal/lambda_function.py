"""The whole skill. Drop this in an Alexa-hosted skill (Python) or your own
Lambda, set ORYKSA_API_KEY, and your AI employee answers on the Echo.

    pip install oryksa-alexa[skill]

The secret key stays here, in the Lambda. The device never sees it.
"""

import os

from oryksa_alexa import create_skill

skill = create_skill(
    api_key=os.environ["ORYKSA_API_KEY"],

    # Optional. With account linking on, this turns Alexa's access token into
    # who the customer is, so the AI never asks for their e-mail or phone again.
    # Either point at your identity provider's userinfo endpoint:
    #   user_info_url="https://auth.example.com/oauth2/userinfo",
    # or resolve it yourself:
    #   resolve_customer=lambda token: {"email": my_api.who_am_i(token)["email"]},

    on_error=lambda e: print("[oryksa]", e),
)

handler = skill.lambda_handler()
