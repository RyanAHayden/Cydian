// The Worker's entry (wrangler.toml, wrangler.ifizbox.toml): src/index.js's handler only. index.js also exports plain
// values for the tests and node.mjs (HOST_WAIT, PART, ...), and local workerd (`wrangler dev`) refuses to start on a
// module whose named exports aren't handlers.
export { default } from "./src/index.js";
