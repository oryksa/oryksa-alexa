/**
 * The whole skill. Drop this in an Alexa-hosted skill (Node) or your own Lambda,
 * set ORYKSA_API_KEY, and your AI employee answers on the Echo.
 *
 *   npm install @oryksa/alexa ask-sdk-core
 *
 * The secret key stays here, in the Lambda. The device never sees it.
 */
import { createHandler } from "@oryksa/alexa";

export const handler = await createHandler({
  apiKey: process.env.ORYKSA_API_KEY,

  // Optional. With account linking on, this turns Alexa's access token into who
  // the customer is, so the AI never asks for their e-mail or phone again.
  // Either point at your identity provider's userinfo endpoint:
  //   userInfoUrl: "https://auth.example.com/oauth2/userinfo",
  // or resolve it yourself:
  //   resolveCustomer: async (accessToken) => {
  //     const me = await myApi.whoAmI(accessToken);
  //     return { email: me.email, phone: me.phone, name: me.firstName };
  //   },

  onError: (e) => console.error("[oryksa]", e && e.message),
});
