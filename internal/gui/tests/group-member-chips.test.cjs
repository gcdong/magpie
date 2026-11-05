// Run with Node's test runner and Playwright on the module path; see README.md.
// A routing group's member carried its reasoning levels and whether it sees
// images as chips nobody could change there: the levels were the provider's
// own, edited in its Names, prices & levels, and a model's images the same,
// so a member in a group was not where either was set. The chips are now a
// click on the model's own row: the levels it is offered (with "No reasoning
// field sent" and "All its levels") and whether agents are told it sees
// images, written through /api/provider/efforts, /reasonless and /images,
// with the groups read again and the editor drawn again from the same draft.
// A member that is a group, and a decision or image model, keep chips that
// only say what agents are told. Chromium and WebKit, English and Chinese.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const { reach, pickItem } = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");
const X = { efforts: ["none", "low", "medium", "high", "xhigh", "max"], context: 200000, images: true, own: ["none", "low", "medium", "high", "xhigh", "max"] };
// three members: one whose levels were narrowed, one whose list says it takes
// none, and one the user answered for (it sees)
// the members' ids, and the ids their provider is asked for: a vendor's
// dated spelling, as groupsState's memberInfo.model has it (a chip sends
// that one, never the member's provider/model, provider.splitRef)
const models = [
  { id: "p/six", name: "Six", providerName: "P", icon: "generic", ...X },
  { id: "p/none", name: "None", providerName: "P", icon: "generic", efforts: ["low", "high"], context: 128000 },
  { id: "p/eye", name: "Eye", providerName: "P", icon: "generic", efforts: ["low", "high"], context: 64000, images: true },
];
const vendor = { "p/six": "six-20260101", "p/none": "none-20260101", "p/eye": "eye-20260101" };
const group = () => ({
  id: "g", name: "Mixed", routing: "", ready: true,
  members: models.map((m) => m.id),
  memberInfo: models.map((m) => ({
    id: m.id, ready: true, name: m.name, provider: "p", model: vendor[m.id], icon: "generic", context: m.context, efforts: m.efforts,
    own: m.own, images: !!m.images, ...(m.id === "p/eye" ? { imageSet: true } : {}),
  })),
});

// what each model's own list said, before any chip wrote it
const bases = {};
for (const x of models) bases[x.id] = JSON.parse(JSON.stringify(x));

const words = {
  en: {
    edit: "Edit", save: "Save", follow: "Follow the group",
    levels: "low–high", images: "Accepts images", text: "Text only", none: "No reasoning field sent",
    off: "No reasoning field sent", all: "All its levels", offered: "offered to agents",
  },
  zh: { edit: "编辑", levels: "低–高", images: "支持图片输入", text: "仅文本", off: "不发送推理参数", all: "全部档位", offered: "提供给 Agent" },
  "zh-TW": { edit: "編輯", levels: "低–高", images: "支援圖片輸入", text: "僅文本", off: "不傳送推理參數", all: "全部檔位", offered: "提供給 Agent" },
  ja: { edit: "編集", levels: "低–高", images: "画像入力に対応", text: "テキストのみ", off: "推論パラメータを送信しない", all: "すべてのレベル", offered: "エージェントに提供" },
  de: { edit: "Bearbeiten", levels: "niedrig–hoch", images: "Akzeptiert Bilder", text: "Nur Text", off: "Kein Reasoning-Feld gesendet", all: "Alle seine Stufen", offered: "Agenten angeboten" },
};

function serve(lang, posts, info) {
  const state = { agents: [{ id: "codex", name: "Codex", path: "/test/codex", fields: [] }], profiles: [], settings: { lang, theme: "light" } };
  // what was saved of a model, over what its list said: the backend answers
  // the groups again from the settings the chip wrote
  const now = () => {
    const g = group();
    for (const m of g.memberInfo) {
      const o = info[m.id];
      if (!o) continue;
      Object.assign(m, o);
      if (o.images === false) { delete m.images; m.imagesUnknown = false; }
    }
    return g;
  };
  return async (r) => {
    const url = new URL(r.request().url());
    const json = (data) => r.fulfill({ json: data });
    if (url.pathname === "/boot.js") return r.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:true};` });
    if (url.pathname === "/wails/runtime.js") return r.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json(state);
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/gateway/trace") {
      if (url.searchParams.get("wait")) return new Promise(() => {});
      return json({ mine: true, now: new Date().toISOString(), seq: 1, totals: { requests: 0, rerouted: 0, errors: 0 }, routes: [] });
    }
    if (url.pathname === "/api/gateway/history") return json({ cut: false, days: [], routes: [] });
    if (url.pathname === "/api/groups") return json({ models, pools: [], deciders: [], found: false, groups: [now()] });
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true, url: "http://127.0.0.1:3999" } });
    if (url.pathname.startsWith("/api/provider/")) {
      const body = JSON.parse(r.request().postData() || "{}");
      posts.push({ path: url.pathname, body });
      // the backend's answer is the provider list; the page asks the groups
      // again after it
      // the backend is asked for the provider's own id of the model: a
      // member's "provider/model" is refused (provider.splitRef, serves)
      const m = body.model;
      if (!Object.values(vendor).includes(m)) {
        return r.fulfill({ status: 400, json: { error: `p has no model ${m} (magpie provider p lists them)` } });
      }
      const member = Object.keys(vendor).find((k) => vendor[k] === m), own = models.find((x) => x.id === member).own;
      if (url.pathname.endsWith("/efforts")) {
        info[member] = { efforts: body.efforts.length ? body.efforts : own, reasonless: false };
        models.find((y) => y.id === member).efforts = info[member].efforts;
      } else if (url.pathname.endsWith("/reasonless")) {
        info[member] = { ...(info[member] || {}), efforts: body.reasonless ? [] : own, reasonless: !!body.reasonless };
        // the served catalog offers it no levels either, as provider.Entry's
        // Efforts has none for a model sent no reasoning field
        const x = models.find((y) => y.id === member);
        if (body.reasonless) delete x.efforts; else x.efforts = own;
      } else if (url.pathname.endsWith("/images")) {
        info[member] = { ...(info[member] || {}), images: !!body.images, imageSet: true };
        // groups.models is the served catalog, which follows what was saved
        const x = models.find((y) => y.id === member);
        x.images = !!body.images;
        if (!body.images) delete x.imagesUnknown;
      }
      return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true } });
    }
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await r.fulfill({ body: await fs.readFile(file), contentType });
  };
}

// a member's row, by the whole name its .n > span says (not a part of it)
const rowOf = (page, name) => page.locator(".rt-gedit .fbrow").filter({ has: page.locator(".n > span", { hasText: new RegExp("^" + name + "$") }) });
const option = (page, text) => page.locator("#pop:not([hidden]) #list li:not(.group)", { has: page.locator(".v", { hasText: new RegExp("^" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) });

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of Object.keys(words)) {
    const w = words[lang];
    test(`${engine} ${lang}: a member's levels and images are a click on its chips`, async (t) => {
      const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
      t.after(() => browser.close());
      const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })).newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(60000);
      const errors = [], posts = [], info = {};
      // each test starts from what the models' lists say: the ones before
      // wrote into them
      for (const x of models) {
        const base = bases[x.id];
        for (const k of ["efforts", "images", "imagesUnknown"]) if (k in base) x[k] = base[k]; else delete x[k];
      }
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", serve(lang, posts, info));
      await page.goto("http://magpie.test/?view=routing");
      const card = page.locator(".rt-group", { hasText: "Mixed" });
      await card.waitFor();
      await card.locator("button.text").first().click();
      await page.locator(".rt-gedit .fbrow").first().waitFor();

      // the chips are buttons now, and say what they are
      const levels = rowOf(page, "Six").locator(".minfo .badge.mi-effort");
      assert.equal(await levels.count(), 1, "the levels chip");
      assert.match(await levels.getAttribute("class"), /\bedits\b/, "and it is a click");
      // a member that takes no images has the chip too, struck through: it
      // is where the answer is given and taken back
      const image = rowOf(page, "None").locator(".minfo .badge.mi-img");
      assert.equal(await image.count(), 1, "a member that takes no images still has the chip");
      assert.match(await image.getAttribute("class"), /\boff\b/, "struck through");
      assert.match(await image.getAttribute("class"), /\bedits\b/, "and a click");
      assert((await rowOf(page, "None").locator(".minfo").getAttribute("title")).includes(w.text), "and the tooltip says text only");

      // the level menu: its own levels, none at all, all of them
      await reach(page, levels);
      await levels.click();
      await option(page, w.all).waitFor();
      // no row that says a joined value is the current one: each level's
      // tick says that, and "low+high+max" is no option of this menu
      assert.equal(await page.locator("#pop:not([hidden]) #list li:not(.group)", { has: page.locator(".v", { hasText: "low+high+max" }) }).count(), 0, "no phantom current-value row");
      assert.equal(await option(page, w.off).count(), 1);
      assert.equal(await option(page, "low").count(), 1);
      assert.equal(await option(page, "medium").count(), 1);
      await option(page, w.off).click();
      await page.waitForFunction(() => !!document.querySelector("#pop").hidden);
      assert.equal(posts.at(-1).path, "/api/provider/reasonless");
      assert.equal(posts.at(-1).body.reasonless, true);
      assert.equal(posts.at(-1).body.model, vendor["p/six"], "the provider is asked for its own id, not the member's");
      // the editor is drawn again: the chip says none is sent
      // no levels offered: the levels chip goes, as on the Gateway page, and
      // the tooltip says no reasoning field is sent
      await page.waitForFunction(() => ![...document.querySelectorAll(".rt-gedit .fbrow")].find((r) => r.querySelector(".n > span")?.textContent === "Six")?.querySelector(".minfo .badge.mi-effort"));
      assert.equal(await rowOf(page, "Six").locator(".minfo .badge.mi-effort").count(), 0);
      if (lang === "en") assert((await rowOf(page, "Six").locator(".minfo").getAttribute("title")).includes(w.none), "no reasoning field is sent");

      // its images: a click on the image chip of a member that sees them
      const eye = rowOf(page, "Eye").locator(".minfo .badge.mi-img");
      assert.equal(await eye.count(), 1, "a member that sees has the image chip");
      assert.match(await eye.getAttribute("class"), /\bedits\b/);
      await reach(page, eye);
      await eye.click();
      await page.waitForFunction(() => document.querySelector("#pop").hidden);
      assert.equal(posts.at(-1).path, "/api/provider/images");
      assert.equal(posts.at(-1).body.images, false, "a click answers the other way");
      // it is text only now, and the chip stays, struck through: the answer
      // is taken back where it was given
      await page.waitForFunction(() => [...document.querySelectorAll(".rt-gedit .fbrow")].filter((r) => r.querySelector(".n > span")?.textContent === "Eye").every((r) => { const c = r.querySelector(".minfo .badge.mi-img"); return c && c.classList.contains("off"); }));
      const off = rowOf(page, "Eye").locator(".minfo .badge.mi-img");
      assert.equal(await off.count(), 1, "the chip is still there");
      assert.match(await off.getAttribute("class"), /\boff\b/, "and says it takes none");
      assert.match(await off.getAttribute("class"), /\bedits\b/, "and is still a click");
      assert((await rowOf(page, "Eye").locator(".minfo").getAttribute("title")).includes(w.text), "and says text only");

      // a click on it says it takes them again
      await reach(page, off);
      await off.click();
      await page.waitForFunction(() => document.querySelector("#pop").hidden);
      assert.equal(posts.at(-1).path, "/api/provider/images");
      assert.equal(posts.at(-1).body.images, true, "the answer is taken back");
      await page.waitForFunction(() => { const c = [...document.querySelectorAll(".rt-gedit .fbrow")].find((r) => r.querySelector(".n > span")?.textContent === "Eye")?.querySelector(".minfo .badge.mi-img"); return c && !c.classList.contains("off"); });
      assert.equal(await rowOf(page, "Eye").locator(".minfo .badge.mi-img").count(), 1, "and the picture is back");
      assert.doesNotMatch(await rowOf(page, "Eye").locator(".minfo .badge.mi-img").getAttribute("class"), /\boff\b/, "the chip no longer says it takes none");

      // a group in the group keeps chips that only say what agents are told
      assert.deepEqual(errors, []);
    });
  }
}
