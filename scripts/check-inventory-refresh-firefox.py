"""Firefox checks against the local copy workbench's fictional data only."""
import json, os, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

sys.stdout.reconfigure(encoding='utf-8')
directory = Path(__file__).resolve().parents[1] / '.local-test/inventory-refresh'
directory.mkdir(parents=True, exist_ok=True)
base = os.environ.get('KHANEYAR_COPY_ORIGIN', 'http://127.0.0.1:5701')
origin = urlparse(base)
assert origin.hostname == '127.0.0.1' and origin.port in (5701, 5852) and origin.scheme == 'http'
os.environ.setdefault('SE_CACHE_PATH', str(directory.parent/'firefox-webdriver-cache'))
options = Options(); options.binary_location = 'C:/Program Files/Mozilla Firefox/firefox.exe'
options.add_argument('-headless'); options.enable_bidi = True
driver = webdriver.Firefox(options=options, service=Service(log_output=str(directory/'inventory-geckodriver.log'),
    service_args=['--log','fatal'], popen_kw={'creation_flags':subprocess.CREATE_NO_WINDOW}))
driver.set_page_load_timeout(40); driver.set_script_timeout(25)
wait = WebDriverWait(driver, 30); checks=[]
def visible(css): return wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR,css)))
def button(label, parent=''):
    element=wait.until(EC.element_to_be_clickable((By.XPATH,parent+'//button[normalize-space(.)="'+label+'" or @aria-label="'+label+'" or .//span[normalize-space(.)="'+label+'"]]')))
    driver.execute_script('arguments[0].scrollIntoView({block:"center"});',element); element.click()
def edit(element,value):
    wait.until(EC.element_to_be_clickable(element)); element.send_keys(Keys.CONTROL+'a')
    element.send_keys(value if value else Keys.BACKSPACE)
def api(path,method='GET',body=None):
    response=driver.execute_async_script('''const[path,method,body]=arguments,done=arguments[arguments.length-1];
      fetch('/api/v1'+path,{method,...(body===null?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})
      .then(async r=>done({status:r.status,body:r.status===204?null:await r.json()})).catch(e=>done({error:String(e)}));''',path,method,body)
    assert response and 200<=response.get('status',0)<300,(path,response)
    return response['body']
def fresh(scenario='full-owner'):
    request=Request(base+'/__copy/preview',json.dumps({'scenarioId':scenario,'route':'inventory'}).encode(),
        headers={'Origin':base,'Content-Type':'application/json','X-Copy-Workbench-Token':token})
    with urlopen(request,timeout=60) as response: url=json.load(response)['url']
    driver.get(base+url); ready()
def ready():
    wait.until(lambda d:d.execute_script('return window.__COPY_PREVIEW_OBSERVED__===true;')); visible('.inventory-page')
def reload(): driver.get(driver.current_url); ready()
def input_(label): return driver.find_element(By.CSS_SELECTOR,'input[aria-label="'+label+'"]')
def row(title): return driver.find_element(By.XPATH,'//div[contains(@class,"inv-item") and .//b[normalize-space(.)="'+title+'"]]')
def row_button(title,label):
    element=wait.until(EC.element_to_be_clickable((By.XPATH,'//div[contains(@class,"inv-item") and .//b[normalize-space(.)="'+title+'"]]//button[normalize-space(.)="'+label+'" or @aria-label="'+label+'"]')))
    driver.execute_script('arguments[0].scrollIntoView({block:"center"});',element); element.click()
def closed(css): wait.until(lambda d:not d.find_elements(By.CSS_SELECTOR,css))
def quantity(stock): return next(item['quantity'] for item in api('/inventory') if item['id']==stock['id'])
def stock(title='Browser inventory',quantity=1.5,category='cleaning',unit='کیلوگرم'):
    item=api('/inventory','POST',{'title':title,'quantity':quantity,'category':category,'unit':unit}); reload(); return item
def passed(text): checks.append(text); print('PASS: '+text,flush=True)
try:
    driver.get(base); token=driver.execute_script('return window.__COPY_WORKBENCH__.csrfToken;')
    driver.browsing_context.set_viewport(context=driver.current_window_handle,viewport={'width':390,'height':844},device_pixel_ratio=1)
    fresh('empty-owner'); button('افزودن قلم به انبار')
    edit(input_('نام قلم انبار'),'Browser new stock'); edit(input_('واحد قلم انبار'),'بطری بزرگ')
    Select(driver.find_element(By.CSS_SELECTOR,'[aria-label="دستهٔ قلم انبار"]')).select_by_value('cleaning')
    edit(input_('موجودی فعلی انبار'),'-2'); button('افزودن')
    visible('.inv-edit-sheet [role="alert"]'); assert api('/inventory')==[]
    edit(input_('موجودی فعلی انبار'),'1.5'); button('افزودن'); closed('.inv-edit-sheet')
    wait.until(lambda d:len(api('/inventory'))==1)
    saved=api('/inventory')[0]; assert saved['quantity']==1.5 and saved['unit']=='بطری بزرگ' and saved['category']=='cleaning'
    assert 'threshold' not in saved
    assert api('/transactions')==[]
    driver.save_screenshot(str(directory/'inventory-empty-create-mobile.png'))
    passed('Create rejects invalid quantities, preserves custom units and makes no financial record')

    fresh(); zero=stock(title='روغن کوچک',quantity=0,category='oils_sauces')
    edit(input_('جست‌وجوی انبار'),'كوچك'); button('تمام‌شده'); visible('.inv-empty-label')
    assert len(driver.find_elements(By.CSS_SELECTOR,'.inv-item'))==1
    button('تعمیر و نگهداری', '//div[contains(@class,"inv-category-tiles")]'); wait.until(lambda d:'قلمی با این جست‌وجو' in d.find_element(By.CSS_SELECTOR,'.inventory-page').text)
    assert not driver.find_elements(By.XPATH,'//button[normalize-space(.)="کم‌موجود"]')
    button('نمایش همهٔ اقلام'); assert len(driver.find_elements(By.CSS_SELECTOR,'.inv-item'))>1
    driver.save_screenshot(str(directory/'inventory-filters-mobile.png'))
    passed('Persian search, empty stock and category filters work without low-stock controls')

    fresh(); item=stock(); ledger=api('/transactions')
    row_button(item['title'],'مصرف / افزایش'); edit(input_('مقدار تغییر موجودی'),'2.5'); button('ثبت تغییر موجودی')
    visible('.inv-adjust-sheet [role="alert"]'); assert quantity(item)==1.5
    edit(input_('مقدار تغییر موجودی'),'0.5'); driver.save_screenshot(str(directory/'inventory-consume-mobile.png'))
    button('ثبت تغییر موجودی'); closed('.inv-adjust-sheet'); wait.until(lambda d:quantity(item)==1)
    row_button(item['title'],'مصرف / افزایش'); button('افزایش موجودی'); edit(input_('مقدار تغییر موجودی'),'0.25')
    button('ثبت تغییر موجودی'); closed('.inv-adjust-sheet'); wait.until(lambda d:quantity(item)==1.25)
    row_button(item['title'],'یکی اضافه کن'); wait.until(lambda d:quantity(item)==2.25)
    row_button(item['title'],'یکی کم کن'); wait.until(lambda d:quantity(item)==1.25)
    assert api('/transactions')==ledger
    passed('Fractional consumption and increase use relative amounts, block excess consumption and preserve finance')

    listing=api('/shopping/lists','POST',{'title':'Browser replenishment'}); reload()
    row_button(item['title'],'به لیست'); assert input_('مقدار خرید از انبار').get_attribute('value')=='۱'
    Select(driver.find_element(By.CSS_SELECTOR,'[aria-label="لیست خرید مقصد"]')).select_by_value(listing['id'])
    edit(input_('مقدار خرید از انبار'),'1.75'); driver.save_screenshot(str(directory/'inventory-replenish-mobile.png'))
    button('افزودن به لیست'); closed('.inv-send-sheet')
    wait.until(lambda d:len(next(value for value in api('/shopping/lists') if value['id']==listing['id'])['items'])==1)
    pending=next(value for value in api('/shopping/lists') if value['id']==listing['id'])['items']
    assert len(pending)==1 and pending[0]['qty']==1.75 and pending[0]['unit']==item['unit'] and pending[0]['inventory_item_id']==item['id']
    assert quantity(item)==1.25 and api('/transactions')==ledger
    wait.until(lambda d:'Browser replenishment' in row(item['title']).text)
    assert not row(item['title']).find_elements(By.CSS_SELECTOR,'.inv-send')
    passed('Purchase starts at one editable unit; sending preserves quantity, finance and the inventory link')

    # A full result of shopping increases only the selected linked stock.
    api('/shopping/items/'+pending[0]['id']+'/check','POST',{'checked':True})
    api('/shopping/lists/'+listing['id']+'/complete','POST',{'create_transaction':False})
    reload(); assert quantity(item)==3 and api('/transactions')==ledger
    passed('Completing the linked purchase updates the same stock once')

    fresh('empty-owner'); button('افزودن قلم به انبار'); edit(input_('نام قلم انبار'),'Browser editable unit')
    Select(driver.find_element(By.CSS_SELECTOR,'[aria-label="دستهٔ قلم انبار"]')).select_by_value('cleaning')
    chip=driver.find_element(By.XPATH,'//div[contains(@class,"inv-unit-options")]//button[normalize-space(.)="کیلو"]')
    metadata=json.loads(chip.get_attribute('data-copy-sources')); source_id=next(entry['id'] for entry in metadata if entry.get('active',True))
    with urlopen(base+'/__copy/catalog',timeout=60) as response: catalog=json.load(response)
    entry=next(entry for entry in catalog['entries'] if entry['id']==source_id)
    for wording in ['Kilogram','']:
        driver.execute_script('window.postMessage({type:"copy-drafts",drafts:[arguments[0]]},location.origin);',
            {'id':entry['id'],'original':entry['text'],'text':wording,'matchingIds':[entry['id']],'tokens':[]})
        wait.until(lambda d:chip.get_attribute('textContent')==wording)
        chip.click(); assert input_('واحد قلم انبار').get_attribute('value')=='کیلو'
        assert any(source['id']==source_id for source in json.loads(chip.get_attribute('data-copy-sources')))
    driver.execute_script('window.postMessage({type:"copy-drafts",drafts:[]},location.origin);')
    button('افزودن'); closed('.inv-edit-sheet'); wait.until(lambda d:len(api('/inventory'))==1)
    assert api('/inventory')[0]['unit']=='کیلو'
    passed('English and empty unit labels keep source identity and the canonical unit saved by forms')

    fresh(); item=stock(title='Browser offline stock',quantity=2,category='cleaning')
    driver.execute_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));")
    wait.until(lambda d:'بدون اتصال' in d.find_element(By.CSS_SELECTOR,'.inventory-page').text or 'روی این دستگاه' in d.find_element(By.CSS_SELECTOR,'.inventory-page').text)
    row_button(item['title'],'مصرف / افزایش'); edit(input_('مقدار تغییر موجودی'),'0.5'); button('ثبت تغییر موجودی'); closed('.inv-adjust-sheet')
    assert quantity(item)==2
    wait.until(lambda d:'۱٫۵' in row(item['title']).text)
    assert 'در انتظار' in driver.find_element(By.CSS_SELECTOR,'.inventory-page').text
    driver.save_screenshot(str(directory/'inventory-offline-mobile.png'))
    driver.execute_script("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));")
    wait.until(lambda d:quantity(item)==1.5)
    passed('Offline fractional consumption stays on the device and synchronizes once after reconnection')

    report={'passed':True,'browser':'Firefox','fixture_origin':base,'preview_url':driver.current_url,'checks':checks}
    (directory/'firefox-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
except Exception:
    driver.save_screenshot(str(directory/'inventory-failure.png'))
    print(driver.execute_script('return document.body.innerText.slice(-3500);'),flush=True)
    raise
finally: driver.quit()
