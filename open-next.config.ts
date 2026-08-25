import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig(),
  // OpenNext shells out to `npm run build` to build the Next app. Since the
  // `build` script now *is* the OpenNext build (so CI's default `npm run build`
  // produces .open-next), that default would recurse forever. Point it at the
  // Next build directly instead.
  buildCommand: "npx next build",
};
