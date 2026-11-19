// The preview Worker's entry (wrangler.preview.toml): src/index.js's fetch handler only. Local workerd (`wrangler dev`)
// refuses to start on index.js itself, whose named exports include plain values (HOST_WAIT, PART, ...) that it reads
// as handlers.
export { default } from "./src/index.js";
