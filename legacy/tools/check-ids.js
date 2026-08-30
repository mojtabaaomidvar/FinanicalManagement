/* بررسی تطابق id های HTML با ارجاعات app.js */
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
const js = fs.readFileSync(__dirname + "/../js/app.js", "utf8");

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const jsIds = new Set(
  [...js.matchAll(/\$\("#([a-zA-Z0-9-]+)"\)/g)].map((m) => m[1]),
);

const missing = [...jsIds].filter((id) => !htmlIds.has(id));
console.log("HTML ids:", htmlIds.size);
console.log("JS # refs:", jsIds.size);
console.log("missing in HTML:", missing.length ? missing : "NONE");

/* بررسی کلاس‌های hidden در CSS */
const css = fs.readFileSync(__dirname + "/../css/style.css", "utf8");
[
  "otp-input",
  "otp-desc",
  "otp-dev-hint",
  "invite-box",
  "invite-sheet",
  "invite-qr-wrap",
  "invite-link-row",
  "invite-link-label",
  "invite-actions",
  "invite-title",
  "invite-sub",
  "auth-form",
  "seg-control",
].forEach((c) => {
  console.log("CSS ." + c + ":", css.includes("." + c) ? "OK" : "MISSING");
});
