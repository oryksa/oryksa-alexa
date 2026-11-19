/* ===========================================================================
 *  ORYKSA AI on Alexa: the whole skill.
 *
 *  ONE THING TO DO: paste your ORYKSA key between the quotes below.
 *  You get it at developer.oryksa.com > Keys. It starts with oryk_live_
 *
 *  Then press "Deploy" in the Alexa developer console and talk to your Echo.
 *  Nothing else in this file needs to change.
 * ======================================================================== */

const ORYKSA_API_KEY = "PASTE-YOUR-ORYKSA-KEY-HERE";

/* ===========================================================================
 *  Below this line there is nothing to edit.
 *
 *  @oryksa/alexa is an ES module and an Alexa-hosted skill runs CommonJS, so it
 *  is loaded with a dynamic import. That works on every Node that Lambda runs.
 * ======================================================================== */

const key = process.env.ORYKSA_API_KEY || ORYKSA_API_KEY;

let ready = null;

async function build() {
  if (!key || key.indexOf("oryk_live_") !== 0) {
    throw new Error(
      "Paste your ORYKSA key (oryk_live_...) at the top of lambda/index.js. Get it at developer.oryksa.com > Keys."
    );
  }
  const { createHandler } = await import("@oryksa/alexa");
  return createHandler({
    apiKey: key,
    onError: (e) => console.error("[oryksa]", e && e.message),
  });
}

exports.handler = async function (event, context) {
  if (!ready) ready = build();            // built once, reused while the Lambda is warm
  const lambdaHandler = await ready;
  // ask-sdk's .lambda() hands back a callback-style handler. Dropping the
  // callback makes the skill answer with nothing, so it is bridged here.
  return new Promise((resolve, reject) => {
    lambdaHandler(event, context, (err, res) => (err ? reject(err) : resolve(res)));
  });
};
