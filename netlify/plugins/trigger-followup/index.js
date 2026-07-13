// Chains another build when downloadAndOptimizeAssets.ts ran out of time
// budget and left videos unprocessed (it writes .assets-deferred.json).
//
// This runs in onSuccess — after the deploy went live and, because this
// plugin is listed after netlify-plugin-cache in netlify.toml, after the
// public/assets cache was saved. That ordering is the whole point: a
// follow-up build must only ever start from the grown cache of a successful
// build, otherwise it repeats the exact same work (and on failure would loop
// identical builds forever).
import fs from "node:fs";

export const onSuccess = async ({ utils }) => {
  if (!fs.existsSync(".assets-deferred.json")) {
    console.log("No deferred videos - not chaining a follow-up build.");
    return;
  }

  const { deferred } = JSON.parse(
    fs.readFileSync(".assets-deferred.json", "utf-8"),
  );

  const hookUrl = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hookUrl) {
    console.log(
      `${deferred} videos still pending, but NETLIFY_BUILD_HOOK_URL is not set - trigger the next build manually.`,
    );
    return;
  }

  const response = await fetch(hookUrl, { method: "POST" });
  if (response.ok) {
    utils.status.show({
      title: `Follow-up build triggered`,
      summary: `${deferred} videos still pending optimization; chained another build to continue.`,
    });
  } else {
    console.log(`Build hook responded with ${response.status}.`);
  }
};
