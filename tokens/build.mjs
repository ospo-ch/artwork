// Compiles tokens/tokens.json (W3C DTCG) into CSS / SCSS / JS / d.ts,
// regenerates the README colour tables, and syncs the web manifest.
// Run: node tokens/build.mjs   (no dependencies)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => fs.writeFileSync(p, s);

const src = JSON.parse(read(path.join(here, "tokens.json")));

// --- flatten the DTCG tree ----------------------------------------------
function flatten(node, prefix = [], out = []) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("$")) continue;
    if (v && typeof v === "object" && "$value" in v) {
      out.push({ path: [...prefix, k], value: v.$value, description: v.$description || "" });
    } else if (v && typeof v === "object") {
      flatten(v, [...prefix, k], out);
    }
  }
  return out;
}
const tokens = flatten(src);
const byDotted = Object.fromEntries(tokens.map((t) => [t.path.join("."), t]));

const isRef = (s) => typeof s === "string" && s.startsWith("{") && s.endsWith("}");
const refOf = (s) => s.slice(1, -1);
function resolve(value, seen = new Set()) {
  if (!isRef(value)) return value;
  const p = refOf(value);
  if (seen.has(p)) throw new Error("reference cycle at " + p);
  seen.add(p);
  const t = byDotted[p];
  if (!t) throw new Error("unknown reference {" + p + "}");
  return resolve(t.value, seen);
}

const kebab = (t) => t.path.join("-"); // color-red-500
const dotted = (t) => t.path.join("."); // color.red.500
const refKebab = (v) => refOf(v).split(".").join("-");
const hexToRgb = (h) => {
  const n = h.replace("#", "");
  return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
};

// --- emit CSS / SCSS / JS / d.ts ----------------------------------------
const banner = "/* Generated from tokens.json by tokens/build.mjs — do not edit. */";

let css = banner + "\n:root {\n";
for (const t of tokens) {
  const v = isRef(t.value) ? `var(--${refKebab(t.value)})` : t.value;
  css += `  --${kebab(t)}: ${v};\n`;
}
css += "}\n";
write(path.join(here, "tokens.css"), css);

let scss = "// Generated from tokens.json by tokens/build.mjs — do not edit.\n";
for (const t of tokens) {
  const v = isRef(t.value) ? `$${refKebab(t.value)}` : t.value;
  scss += `$${kebab(t)}: ${v};\n`;
}
write(path.join(here, "tokens.scss"), scss);

let js = "// Generated from tokens.json by tokens/build.mjs — do not edit.\nexport const tokens = {\n";
for (const t of tokens) js += `  ${JSON.stringify(kebab(t))}: ${JSON.stringify(resolve(t.value))},\n`;
js += "};\nexport default tokens;\n";
write(path.join(here, "tokens.js"), js);

let dts = "// Generated from tokens.json by tokens/build.mjs — do not edit.\nexport declare const tokens: {\n";
for (const t of tokens) dts += `  ${JSON.stringify(kebab(t))}: string;\n`;
dts += "};\nexport default tokens;\n";
write(path.join(here, "tokens.d.ts"), dts);

// --- classify for the README --------------------------------------------
const core = tokens.filter((t) => !isRef(t.value));
const semantic = tokens.filter((t) => isRef(t.value));
const reds = core.filter((t) => t.path[1] === "red");
const neutrals = core.filter((t) => t.path[1] === "grey" || t.path[1] === "black" || t.path[1] === "white");
const swatch = (t) => `./palette/${kebab(t).replace(/^color-/, "")}.png`; // core only
const hexToCore = Object.fromEntries(core.map((t) => [t.value.toUpperCase(), t]));

const row = (t) => `|![${kebab(t).replace(/^color-/, "")}](${swatch(t)})|\`${dotted(t)}\`|\`${t.value}\`|\`${hexToRgb(t.value)}\`|${t.description}|`;

let md = "### Brand red\n\n";
md += "`color.red.500` is the primary brand colour. The scale provides tints for backgrounds and accessible shades for text.\n\n";
md += "|Colour|Token|HEX|RGB|Notes|\n|---|---|---|---|---|\n";
md += reds.map(row).join("\n") + "\n\n";
md += "### Neutrals\n\n";
md += "|Colour|Token|HEX|RGB|Notes|\n|---|---|---|---|---|\n";
md += neutrals.map(row).join("\n") + "\n\n";
md += "### Semantic tokens\n\n";
md += "Aliases that map intent to a colour in the scale — prefer these in product code.\n\n";
md += "|Colour|Token|Resolves to|HEX|Notes|\n|---|---|---|---|---|\n";
md += semantic
  .map((t) => {
    const hex = resolve(t.value).toUpperCase();
    const cgw = hexToCore[hex];
    return `|![${kebab(cgw).replace(/^color-/, "")}](${swatch(cgw)})|\`${dotted(t)}\`|\`${dotted(byDotted[refOf(t.value)])}\`|\`${hex}\`|${t.description}|`;
  })
  .join("\n") + "\n\n";
md += "> Contrast ratios are WCAG 2.1 against white. `color.red.500` meets AA for large text and UI components (≥3:1) but not body text — use `color.text-link` (red 700) for red text on white.\n";

// inject between markers in README
const readmePath = path.join(root, "README.md");
const BEGIN = "<!-- BEGIN GENERATED COLORS (node tokens/build.mjs) -->";
const END = "<!-- END GENERATED COLORS -->";
let readme = read(readmePath);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}`);
if (!re.test(readme)) throw new Error("README colour markers not found");
readme = readme.replace(re, () => `${BEGIN}\n${md}${END}`);
write(readmePath, readme);

// --- sync the web manifest ----------------------------------------------
const manifestPath = path.join(root, "icons", "site.webmanifest");
const manifest = JSON.parse(read(manifestPath));
manifest.theme_color = resolve("{color.brand}").toUpperCase();
manifest.background_color = resolve("{color.white}").toUpperCase();
write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Built ${tokens.length} tokens → css, scss, js, d.ts; updated README + manifest.`);
