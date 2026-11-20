async (page) => {
  const checks = [];
  await page.goto('http://127.0.0.1:5700/support');
  await page.getByRole('heading', { name: 'ورود پشتیبانی', exact: true }).waitFor();
  await page.evaluate(() => { const input=document.createElement('input');input.type='file';input.id='operator-login-file';input.hidden=true;document.body.append(input); });
  const input=page.locator('#operator-login-file');
  await input.setInputFiles('C:/Users/383/Desktop/personal-finance-pwa/.local-test/support-panel-login.txt');
  const credentials=await input.evaluate(async element=>await element.files[0].text());
  await input.evaluate(element=>element.remove());
  await page.getByLabel('نام کاربری پشتیبانی').fill(credentials.match(/^Username: (.+)$/m)[1].trim());
  await page.getByLabel('رمز پشتیبانی').fill(credentials.match(/^Password: (.+)$/m)[1].trim());
  await page.getByRole('button',{name:'ورود به پنل',exact:true}).click();
  await page.getByRole('heading',{name:'نمای کلی',exact:true}).waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'آمار استفاده',exact:true}).click();
  await page.getByRole('heading',{name:'تعداد فعلی رکوردها',exact:true}).waitFor();
  const scope=await page.evaluate(async()=>{
    const response=await fetch('/api/v1/support/usage',{credentials:'include',cache:'no-store'});
    const data=await response.json();
    const keys=JSON.stringify(data);
    return {status:response.status,privateDimensions:/"(?:member_id|family_id|support_code|amount|note|title|phone|password|raw_text)"\s*:/.test(keys),
      recordsAreCounts:Object.values(data.records).every(value=>Number.isInteger(value)&&value>=0),modules:data.modules.length,days:data.daily.length};
  });
  if (scope.status!==200 || scope.privateDimensions || !scope.recordsAreCounts || scope.modules!==21 || scope.days!==7) throw new Error('Anonymous usage projection is invalid.');
  checks.push('Read-only anonymous module metrics and exact global record counts');
  await page.locator('.support-period select').selectOption('30');
  await page.getByRole('heading',{name:'تعداد فعلی رکوردها',exact:true}).waitFor();
  await page.locator('.support-show-empty input').check();
  await page.waitForFunction(()=>document.querySelectorAll('.support-user-list tbody tr').length===21);
  checks.push('Thirty-day period and all module rows');
  await page.getByRole('navigation').getByRole('button',{name:'پیگیری کاربران',exact:true}).click();
  await page.locator('tbody tr').first().waitFor();
  await page.getByRole('columnheader',{name:'آخرین ورود موفق',exact:true}).waitFor();
  await page.getByRole('columnheader',{name:'مرحله و علت پیگیری',exact:true}).waitFor();
  await page.getByText('سابقهٔ این زمان ثبت نشده',{exact:true}).first().waitFor();
  checks.push('Registration stages and explicit unknown historical times');
  await page.setViewportSize({width:390,height:920});
  if (!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)) throw new Error('Mobile roster overflows.');
  await page.getByRole('navigation').getByRole('button',{name:'آمار استفاده',exact:true}).click();
  await page.getByRole('heading',{name:'تعداد فعلی رکوردها',exact:true}).waitFor();
  if (!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)) throw new Error('Mobile usage page overflows.');
  await page.screenshot({path:'C:/Users/383/Desktop/personal-finance-pwa/.local-test/support-usage-mobile.png',fullPage:true});
  checks.push('Firefox mobile navigation, metrics and table layout');
  await page.getByRole('button',{name:'خروج از پنل',exact:true}).click();
  await page.getByRole('heading',{name:'ورود پشتیبانی',exact:true}).waitFor();
  if (await page.locator('tbody,.support-metrics,.support-record-metrics').count()) throw new Error('Support data remained after logout.');
  checks.push('Logout clears usage and user metadata');
  return {passed:true,checks};
}
