/* تست خودکار پروتوتایپ آنبوردینگ — بررسی خطاهای کنسول و جریان گام‌ها */
import { chromium } from "playwright";

const URL = "file:///C:/Users/383/Desktop/personal-finance-pwa/onboarding-prototype/index.html";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  const log = (msg) => console.log(`[${msg}]`);
  const text = async () => (await page.locator("#screen").innerText()).replace(/\n/g, " | ").slice(0, 160);

  await page.goto(URL);
  await sleep(600);
  log("welcome: " + (await text()));

  // شروع
  await page.click("#nextBtn");
  await sleep(400);
  log("living: " + (await text()));

  // ─── تست تغییر تم ───
  const themeBtnVisibleOnLiving = await page.isVisible("#themeBtn");
  log("theme: toggle visible on living = " + themeBtnVisibleOnLiving);
  if (!themeBtnVisibleOnLiving) errors.push("theme: دکمه‌ی تم روی گام living پنهان است");

  await page.click("#themeBtn");
  await sleep(400);
  const afterOn = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  log("theme: after 1st click = " + JSON.stringify(afterOn));
  if (afterOn.theme !== "light") errors.push("theme: بعد از کلیک اول، تم light نشد");
  if (afterOn.bg === "rgb(5, 11, 18)") errors.push("theme: پس‌زمینه بعد از روشن شدن تغییر نکرد");

  await page.click("#themeBtn");
  await sleep(400);
  const afterOff = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  log("theme: after 2nd click = " + JSON.stringify(afterOff));
  if (afterOff.theme !== "dark") errors.push("theme: بعد از کلیک دوم، تم dark نشد");

  // ماندگاری: تم روشن، یک بار روی گام دیگر هم امتحان می‌کنیم
  await page.click("#themeBtn");
  await sleep(300);
  await page.reload();
  await sleep(700);
  const restored = await page.evaluate(() => document.documentElement.dataset.theme);
  log("theme: persisted after reload = " + restored);
  if (restored !== "light") errors.push("theme: تم بعد از reload ذخیره/اعمال نشد");

  // welcome باید دکمه‌ی تم نداشته باشد
  const themeBtnOnWelcome = await page.isVisible("#themeBtn");
  log("theme: toggle visible on welcome = " + themeBtnOnWelcome);
  if (themeBtnOnWelcome) errors.push("theme: دکمه‌ی تم روی welcome باید پنهان باشد");

  // برگشت به dark برای ادامه‌ی مسیر (روی living که دکمه.VISIBLE است)
  await page.evaluate(() => localStorage.removeItem("khanehyar-theme"));
  await page.click("#nextBtn");
  await sleep(400);
  await page.click("#themeBtn"); // light → dark (آیکون هم همگام می‌شود)
  await sleep(300);
  log("living again: " + (await text()));

  // انتخاب آپارتمان
  await page.click('#list [data-id="apartment"]');
  await sleep(200);
  await page.click("#nextBtn");
  await sleep(400);
  log("size: " + (await text()));

  // افزایش اندازه
  await page.click("#stepPlus");
  await sleep(200);
  log("size after +: " + (await text()));

  await page.click("#nextBtn");
  await sleep(400);
  log("goals: " + (await text()));

  // انتخاب ۳ هدف (money, shop, bill) + family برای کارها
  await page.click('#list [data-id="family"]');
  await page.click('#list [data-id="money"]');
  await page.click('#list [data-id="shop"]');
  await page.click('#list [data-id="bill"]');
  await sleep(200);
  log("goals selected: " + (await page.locator(".chip.sel").count()));

  await page.click("#nextBtn");
  await sleep(400);
  log("q-tasks: " + (await text()));

  await page.click('#list [data-id="جارو کشیدن"]');
  await page.click("#nextBtn");
  await sleep(400);
  log("q-bills: " + (await text()));

  await page.click('#list [data-id="elec"]');
  await page.click("#nextBtn");
  await sleep(400);
  log("q-shop: " + (await text()));

  await page.click('#list [data-id="weekly"]');
  await page.click("#nextBtn");
  await sleep(400);
  log("q-finance: " + (await text()));

  await page.click('#seg [data-v="تومان"]');
  await page.click("#nextBtn");
  await sleep(400);
  log("reminders: " + (await text()));

  await page.click('#list [data-id="yes"]');
  await page.click("#nextBtn");
  await sleep(400);
  log("profile: " + (await text()));

  await page.click("#nextBtn");
  await page.waitForSelector("#pFill", { state: "visible" });
  log("personalizing: " + (await text()));

  // صبر تا انیمیشن تموم بشه و گام ساخت حساب بیاد
  await page.waitForSelector("#fName", { state: "visible", timeout: 15000 });
  await sleep(300);
  log("account: " + (await text()));

  // دکمه باید غیرفعال باشه تا رضایت داده شه
  const disabledBefore = await page.isDisabled("#nextBtn");
  log("account: nextBtn disabled before consent = " + disabledBefore);

  // گام ورود داده هم باید دکمه‌ی تم داشته باشد
  const themeOnAccount = await page.isVisible("#themeBtn");
  log("account: theme toggle visible = " + themeOnAccount);
  if (!themeOnAccount) errors.push("theme: دکمه‌ی تم روی گام account باید پنهان نباشد");

  // کلیک روی خود چک‌باکس (نه مرکز label که روی لینک است)
  await page.click(".consent-box");
  await sleep(200);
  const disabledAfter = await page.isDisabled("#nextBtn");
  log("account: nextBtn disabled after consent = " + disabledAfter);

  // ─── تست برگشت و اسکیپ از وسط جریان ───
  await page.click("#backBtn");
  await sleep(300);
  log("back1 (profile?): " + (await text()));
  await page.click("#backBtn");
  await sleep(300);
  log("back2 (reminders?): " + (await text()));

  const skipVisible = await page.isVisible("#skipBtn");
  log("skip visible on reminders = " + skipVisible);
  if (skipVisible) {
    await page.click("#skipBtn");
    await sleep(300);
    log("after skip (profile?): " + (await text()));
  }

  // بازگشت به account و تکمیل
  // توجه: consent در state حفظ شده — چک‌باکس هنوز روشن است
  await page.click("#nextBtn");
  await page.waitForSelector("#pFill", { state: "visible" });
  await page.waitForSelector("#fName", { state: "visible", timeout: 15000 });
  await sleep(300);
  const stillConsented = await page.isVisible("#consentBox.on");
  log("account re-visit: consent persisted = " + stillConsented);
  if (!stillConsented) await page.click(".consent-box");
  await sleep(200);
  await page.click("#nextBtn");
  await sleep(400);
  log("done: " + (await text()));

  await browser.close();

  console.log("\n=== نتیجه ===");
  if (errors.length) {
    console.log("خطاها (" + errors.length + "):");
    errors.forEach((e) => console.log("  - " + e));
    process.exitCode = 1;
  } else {
    console.log("✅ هیچ خطایی نداشت — جریان کامل کار کرد.");
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
