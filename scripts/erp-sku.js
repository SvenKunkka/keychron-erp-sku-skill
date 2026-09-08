#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_CHROME_DATA = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const DEFAULT_SETTINGS = path.join(__dirname, '..', 'references', 'project-config.local.json');
const REMARK_LIMIT = 130;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TEXT_FIELDS = new Set(['SKU 编码', '中文描述', '英文描述', '键帽颜色', '主控IC', '轴体']);
const SELECT_FIELDS = new Set(['类目', '单位', '产品负责人', '状态', '品牌', '系列', '类型', '特殊属性', '销售标签', '库存严控']);
const APPLICATION_ACTION = /(申请|新增|新建|创建|提交)/u;
const SKU_KEYWORD = /(^|[^A-Za-z0-9])SKU([^A-Za-z0-9]|$)/iu;
const INFORMATIONAL_INTENT = /(?:如何|怎么|怎样|是否|能否).{0,12}(?:申请|新增|新建|创建|提交)|(?:申请|新增|新建|创建|提交).{0,12}(?:流程|方法|条件|说明)|SKU.{0,12}(?:是什么|有哪些|有没有|多少|列表)/iu;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let activeChrome = null;
let activeProfile = null;

function usage() {
  console.log(`ERP 全新定制 SKU 自动化

用法：
  node erp-sku.js --config /absolute/path/skus.json [--settings FILE] [--shots DIR] [--list KW]
  node erp-sku.js --config /absolute/path/skus.json --submit [--settings FILE] [--shots DIR] [--list KW]

默认模式只预览：不上传图片、不点击“确定”。
实际提交必须显式添加 --submit。

选项：
  --settings FILE           本地 ERP 页面配置，默认 references/project-config.local.json
  --erp-url URL             临时覆盖本地配置中的 ERP URL
  --chrome-data-dir DIR      Chrome 用户数据根目录
  --profile-directory NAME   Chrome 配置目录，默认 Default
  --no-sandbox               仅在必要时关闭 Chrome 沙箱
  --validate-only            只校验配置，不启动浏览器
  --help                     显示帮助`);
}

function loadSettings(settingsPath, erpUrlOverride = '') {
  let settings = {};
  if (settingsPath && fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }
  const erpUrl = erpUrlOverride || settings.erp_url;
  if (!erpUrl || typeof erpUrl !== 'string') {
    throw new Error('缺少 ERP URL；请创建 references/project-config.local.json 或传 --erp-url');
  }
  let parsed;
  try { parsed = new URL(erpUrl); } catch (_) { throw new Error('ERP URL 无效'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('ERP URL 必须使用 HTTPS（本机测试地址除外）');
  }
  const text = (key, fallback) => {
    const value = settings[key] ?? fallback;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`本地设置 ${key} 必须是非空字符串`);
    return value.trim();
  };
  return {
    erpUrl: parsed.toString(),
    erpOrigin: parsed.origin,
    newButtonText: text('new_button_text', '新增定制全新SKU'),
    submitButtonText: text('submit_button_text', '确定'),
    cancelButtonText: text('cancel_button_text', '取消'),
    submitPathContains: text('submit_path_contains', parsed.pathname),
    listRowMarker: text('list_row_marker', '创建时间'),
    successStatusText: text('success_status_text', '待审核'),
  };
}

function argValue(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${name} 缺少取值`);
  return args[i + 1];
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const stat = fs.statSync(source);
  if (stat.isDirectory()) fs.cpSync(source, destination, { recursive: true });
  else fs.copyFileSync(source, destination);
}

function createTemporaryProfile(chromeDataDir, profileDirectory) {
  const sourceProfile = path.join(chromeDataDir, profileDirectory);
  if (!fs.existsSync(sourceProfile)) throw new Error(`找不到 Chrome 配置目录：${sourceProfile}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keychron-erp-sku-'));
  activeProfile = tempRoot;
  fs.chmodSync(tempRoot, 0o700);
  const tempDefault = path.join(tempRoot, 'Default');
  fs.mkdirSync(tempDefault, { recursive: true, mode: 0o700 });

  copyIfPresent(path.join(chromeDataDir, 'Local State'), path.join(tempRoot, 'Local State'));
  for (const name of ['Cookies', 'Cookies-journal', 'Preferences']) {
    copyIfPresent(path.join(sourceProfile, name), path.join(tempDefault, name));
  }
  for (const name of ['Local Storage', 'Session Storage', 'IndexedDB']) {
    copyIfPresent(path.join(sourceProfile, name), path.join(tempDefault, name));
  }
  for (const name of ['Cookies', 'Cookies-journal']) {
    copyIfPresent(path.join(sourceProfile, 'Network', name), path.join(tempDefault, 'Network', name));
  }
  return tempRoot;
}

function cleanupSync() {
  if (activeChrome && activeChrome.pid) {
    try { process.kill(-activeChrome.pid, 'SIGTERM'); } catch (_) {
      try { activeChrome.kill('SIGTERM'); } catch (_) { }
    }
  }
  activeChrome = null;
  if (activeProfile) {
    try { fs.rmSync(activeProfile, { recursive: true, force: true }); } catch (_) { }
  }
  activeProfile = null;
}

process.once('SIGINT', () => { cleanupSync(); process.exit(130); });
process.once('SIGTERM', () => { cleanupSync(); process.exit(143); });
process.once('exit', cleanupSync);

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function startChrome(profilePath, port, noSandbox) {
  if (!fs.existsSync(DEFAULT_CHROME)) throw new Error(`找不到 Google Chrome：${DEFAULT_CHROME}`);
  const flags = [
    `--user-data-dir=${profilePath}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    'about:blank',
  ];
  if (noSandbox) flags.splice(flags.length - 1, 0, '--no-sandbox');

  const child = spawn(DEFAULT_CHROME, flags, { detached: true, stdio: 'ignore' });
  activeChrome = child;
  child.unref();
  for (let i = 0; i < 30; i += 1) {
    await wait(700);
    try {
      const response = await getJSON(`http://127.0.0.1:${port}/json/version`);
      if (response.includes('Browser')) return child;
    } catch (_) { }
  }
  throw new Error('Chrome 调试端口未就绪');
}

function validateFields(values, allowed, groupName) {
  if (values === undefined) return {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${groupName} 必须是对象`);
  for (const [label, value] of Object.entries(values)) {
    if (!allowed.has(label)) throw new Error(`${groupName} 包含不允许的字段：${label}`);
    if (typeof value !== 'string') throw new Error(`${label} 的值必须是字符串`);
  }
  return values;
}

function validateImage(imagePath, configDir, required) {
  if (!imagePath) {
    if (required) throw new Error('实际提交全新 SKU 时必须提供产品图片');
    return null;
  }
  if (typeof imagePath !== 'string') throw new Error('image 必须是文件路径字符串');
  const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(configDir, imagePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) throw new Error(`拒绝上传非图片文件：${resolved}`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`找不到产品图片：${resolved}`);
  const header = fs.readFileSync(resolved).subarray(0, 12);
  const hex = header.toString('hex');
  const signatureOK = hex.startsWith('89504e470d0a1a0a') || hex.startsWith('ffd8ff') ||
    header.toString('ascii', 0, 6) === 'GIF87a' || header.toString('ascii', 0, 6) === 'GIF89a' ||
    (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP');
  if (!signatureOK) throw new Error(`图片内容与支持的图片格式不符：${resolved}`);
  return resolved;
}

function loadConfig(configPath, submitting) {
  if (!configPath) throw new Error('必须指定 --config');
  const resolvedConfig = path.resolve(configPath);
  const configDir = path.dirname(resolvedConfig);
  const config = JSON.parse(fs.readFileSync(resolvedConfig, 'utf8'));
  if (!config || !Array.isArray(config.skus) || config.skus.length === 0) throw new Error('配置至少需要一个 skus 项');

  const sharedImage = validateImage(config.image, configDir, false);
  const skus = config.skus.map((sku, index) => {
    if (!sku || typeof sku !== 'object') throw new Error(`skus[${index}] 必须是对象`);
    if (typeof sku.name !== 'string' || !sku.name.trim()) throw new Error(`skus[${index}].name 不能为空`);
    if (sku.remark !== undefined && typeof sku.remark !== 'string') throw new Error(`${sku.name} 的 remark 必须是字符串`);
    if ((sku.remark || '').length > REMARK_LIMIT) throw new Error(`${sku.name} 的备注超过 ${REMARK_LIMIT} 字，请先精简后再运行`);
    const image = validateImage(sku.image, configDir, false) || sharedImage;
    if (submitting && !image) throw new Error(`${sku.name} 缺少产品图片`);
    return {
      name: sku.name.trim(),
      text: validateFields(sku.text, TEXT_FIELDS, `${sku.name}.text`),
      select: validateFields(sku.select, SELECT_FIELDS, `${sku.name}.select`),
      remark: sku.remark || '',
      image,
    };
  });
  const requestText = typeof config.request_text === 'string' ? config.request_text.trim() : '';
  if (submitting) validateSubmissionIntent(requestText, skus.map(sku => sku.name));
  return { skus, requestText };
}

function validateSubmissionIntent(requestText, modelNames) {
  if (!requestText) throw new Error('提交配置缺少 request_text；必须原样保存当前用户消息');
  if (!APPLICATION_ACTION.test(requestText)) throw new Error('当前消息没有明确的 SKU 申请动作');
  if (!SKU_KEYWORD.test(requestText)) throw new Error('当前消息缺少 SKU 关键词');
  if (INFORMATIONAL_INTENT.test(requestText)) throw new Error('当前消息是咨询或查询，不构成 SKU 提交授权');
  for (const modelName of modelNames) {
    if (!requestText.toUpperCase().includes(modelName.toUpperCase())) {
      throw new Error(`当前消息未明确包含配置型号：${modelName}`);
    }
  }
  return true;
}

function safeShotName(name) {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'sku';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { usage(); return; }
  const submitting = args.includes('--submit');
  if (submitting && args.includes('--dry')) throw new Error('--submit 与 --dry 不能同时使用');

  const configPath = argValue(args, 'config');
  const listKeyword = argValue(args, 'list', '');
  const settingsPath = path.resolve(argValue(args, 'settings', DEFAULT_SETTINGS));
  const erpUrlOverride = argValue(args, 'erp-url', '');
  const shotsDir = path.resolve(argValue(args, 'shots', process.cwd()));
  const chromeDataDir = path.resolve(argValue(args, 'chrome-data-dir', DEFAULT_CHROME_DATA));
  const profileDirectory = argValue(args, 'profile-directory', 'Default');
  if (profileDirectory.includes('/') || profileDirectory.includes('\\') || profileDirectory === '..') {
    throw new Error('--profile-directory 只能是 Chrome 配置目录名称');
  }
  fs.mkdirSync(shotsDir, { recursive: true });
  const config = loadConfig(configPath, submitting);
  if (args.includes('--validate-only')) {
    console.log(`配置校验通过：${config.skus.length} 个全新 SKU，模式=${submitting ? '提交' : '预览'}`);
    return;
  }
  const settings = loadSettings(settingsPath, erpUrlOverride);

  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch (_) {
    throw new Error('缺少 puppeteer-core；请在 skill 目录运行 npm install --omit=dev');
  }

  let browser = null;
  const port = 9500 + Math.floor(Math.random() * 400);
  console.log(submitting ? '[模式] 实际提交' : '[模式] 安全预览（不上传图片、不提交）');

  try {
    createTemporaryProfile(chromeDataDir, profileDirectory);
    await startChrome(activeProfile, port, args.includes('--no-sandbox'));
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
    const page = (await browser.pages())[0];
    const posts = [];

    page.on('response', response => {
      try {
        const request = response.request();
        const url = new URL(response.url());
        if (request.method() === 'POST' && url.origin === settings.erpOrigin) posts.push({ path: url.pathname, status: response.status() });
      } catch (_) { }
    });

    await page.goto(settings.erpUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await wait(2500);
    if (new URL(page.url()).origin !== settings.erpOrigin) throw new Error('ERP 登录态无效或页面发生跨站跳转，请先在 Chrome 登录 ERP');

    const setValue = (label, value) => page.evaluate((fieldLabel, fieldValue) => {
      const modals = Array.from(document.querySelectorAll('nz-modal-container'));
      const root = modals.find(modal => modal.getBoundingClientRect().height > 50) || document.body;
      const items = Array.from(root.querySelectorAll('.ant-form-item, nz-form-item, .form-item'));
      const item = items.find(candidate => (candidate.innerText || '').trim().startsWith(fieldLabel));
      if (!item) return `no-item:${fieldLabel}`;
      const element = item.querySelector('textarea') || item.querySelector('input:not(.ant-select-selection-search-input)');
      if (!element) return `no-input:${fieldLabel}`;
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      element.focus();
      setter.call(element, '');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(element, fieldValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      return 'ok';
    }, label, value);

    const setSelect = async (label, option) => {
      const opened = await page.evaluate(fieldLabel => {
        const modals = Array.from(document.querySelectorAll('nz-modal-container'));
        const root = modals.find(modal => modal.getBoundingClientRect().height > 50) || document.body;
        const items = Array.from(root.querySelectorAll('.ant-form-item, nz-form-item, .form-item'));
        const item = items.find(candidate => (candidate.innerText || '').trim().startsWith(fieldLabel));
        const select = item && item.querySelector('.ant-select');
        if (!select) return false;
        select.click();
        return true;
      }, label);
      if (!opened) return `no-select:${label}`;
      await wait(500);
      await page.keyboard.type(option, { delay: 40 });
      await wait(800);
      const selected = await page.evaluate(expected => {
        for (const dropdown of document.querySelectorAll('.ant-select-dropdown')) {
          if (dropdown.getBoundingClientRect().height < 5) continue;
          for (const item of dropdown.querySelectorAll('.ant-select-item-option, [role=option], nz-option-item')) {
            if ((item.innerText || '').trim() === expected) { item.click(); return true; }
          }
        }
        return false;
      }, option);
      await wait(400);
      return selected ? 'ok' : `no-option:${option}`;
    };

    const modalCount = () => page.evaluate(() => Array.from(document.querySelectorAll('nz-modal-container'))
      .filter(modal => modal.getBoundingClientRect().height > 50).length);

    const clickModalButton = text => page.evaluate(buttonText => {
      const modals = Array.from(document.querySelectorAll('nz-modal-container'));
      const root = modals.find(modal => modal.getBoundingClientRect().height > 50) || document.body;
      const button = Array.from(root.querySelectorAll('button')).find(candidate => (candidate.innerText || '').trim() === buttonText);
      if (!button) return false;
      button.click();
      return true;
    }, text);

    const dumpForm = () => page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('nz-modal-container'));
      const root = modals.find(modal => modal.getBoundingClientRect().height > 50) || document.body;
      return Array.from(root.querySelectorAll('.ant-form-item, nz-form-item, .form-item')).map(item => {
        const lines = (item.innerText || '').split('\n').map(text => text.trim()).filter(Boolean);
        const input = item.querySelector('textarea') || item.querySelector('input:not(.ant-select-selection-search-input)');
        const select = item.querySelector('.ant-select');
        const value = input ? input.value : (select ? (select.innerText || '').trim() : '');
        return `${lines[0] || '?'} = ${value || ''}`;
      }).join('\n');
    });

    const uploadImage = async imagePath => {
      const handle = await page.evaluateHandle(() => {
        const modals = Array.from(document.querySelectorAll('nz-modal-container'));
        const root = modals.find(modal => modal.getBoundingClientRect().height > 50);
        if (!root) return null;
        const labels = Array.from(root.querySelectorAll('*')).reverse();
        const label = labels.find(node => node.children.length === 0 && (node.textContent || '').trim() === '上传图片');
        let parent = label ? label.parentElement : root;
        for (let i = 0; i < 6 && parent; i += 1) {
          const input = parent.querySelector('input[type=file]');
          if (input) return input;
          parent = parent.parentElement;
        }
        return root.querySelector('input[type=file]');
      });
      const element = handle.asElement();
      if (!element) return 'no-file-input';
      await element.uploadFile(imagePath);
      await wait(5000);
      return 'uploaded';
    };

    const openNew = async () => {
      const clicked = await page.evaluate(buttonText => {
        const elements = Array.from(document.querySelectorAll('button, a, span, div'));
        const target = elements.find(element => element.textContent && element.textContent.trim() === buttonText && element.offsetParent !== null);
        if (!target) return false;
        target.click();
        return true;
      }, settings.newButtonText);
      if (!clicked) return false;
      await wait(2500);
      return (await modalCount()) > 0;
    };

    const results = [];
    for (const sku of config.skus) {
      console.log(`\n===== ${sku.name} =====`);
      if (!(await openNew())) throw new Error('未能打开“新增定制全新SKU”弹窗');
      for (const [label, value] of Object.entries(sku.text)) {
        const result = await setValue(label, value);
        console.log(`  ${label}:`, result);
        if (result !== 'ok') throw new Error(`${sku.name} 字段填写失败：${result}`);
      }
      for (const [label, value] of Object.entries(sku.select)) {
        const result = await setSelect(label, value);
        console.log(`  ${label}:`, result);
        if (result !== 'ok') throw new Error(`${sku.name} 下拉选择失败：${result}`);
      }
      const remarkResult = await setValue('备注', sku.remark);
      console.log('  备注:', remarkResult);
      if (remarkResult !== 'ok') throw new Error(`${sku.name} 备注填写失败：${remarkResult}`);

      if (submitting) {
        const uploadResult = await uploadImage(sku.image);
        console.log('  图片:', uploadResult);
        if (uploadResult !== 'uploaded') throw new Error(`${sku.name} 图片上传失败：${uploadResult}`);
      } else {
        console.log('  图片:', sku.image ? '[预览] 已检查本地图片，不上传' : '[预览] 未提供图片；提交前必须补充');
      }

      console.log(`--- ${submitting ? '提交前' : '安全预览'} ---\n${await dumpForm()}`);
      const shotPath = path.join(shotsDir, `sku-${safeShotName(sku.name)}.png`);
      await page.screenshot({ path: shotPath });
      console.log('  截图:', shotPath);

      if (!submitting) {
        const cancelled = await clickModalButton(settings.cancelButtonText);
        await wait(800);
        if (!cancelled || (await modalCount()) > 0) {
          await page.reload({ waitUntil: 'networkidle2' });
          await wait(1500);
        }
        results.push({ name: sku.name, preview: true });
        continue;
      }

      const postStart = posts.length;
      console.log(`  ${settings.submitButtonText}:`, await clickModalButton(settings.submitButtonText));
      await wait(8000);
      const relevantPosts = posts.slice(postStart).filter(post => post.path.includes(settings.submitPathContains));
      const lastPost = relevantPosts[relevantPosts.length - 1];
      const open = await modalCount();
      const ok = open === 0 && lastPost && lastPost.status >= 200 && lastPost.status < 300;
      console.log('  弹窗数(应为0):', open, '| 提交接口:', lastPost || '未捕获');
      results.push({ name: sku.name, ok: Boolean(ok), post: lastPost || null });
      if (!ok) throw new Error(`${sku.name} 提交证据不完整，已停止后续 SKU，需人工确认`);
      await wait(1200);
    }

    if (submitting) {
      await page.reload({ waitUntil: 'networkidle2' });
      await wait(3000);
      for (const sku of config.skus) {
        const keyword = config.skus.length === 1 && listKeyword ? listKeyword : sku.name;
        const rows = await page.evaluate((kw, marker) => {
          const output = new Set();
          document.querySelectorAll('div, tr').forEach(element => {
            const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
            if (text.includes(marker) && text.includes(kw) && text.length < 500) output.add(text);
          });
          return Array.from(output).slice(0, 8);
        }, keyword, settings.listRowMarker);
        console.log(`\n=== 列表回读 ${sku.name} (${rows.length}) ===`);
        rows.forEach(row => console.log(` - ${row}`));
        if (rows.length === 0 || !rows.some(row => row.includes(settings.successStatusText))) {
          throw new Error(`${sku.name} 提交接口成功，但列表未回读到“${settings.successStatusText}”记录，需人工确认`);
        }
      }
    }

    console.log('\n=== 汇总 ===');
    results.forEach(result => console.log(` ${result.name}: ${result.preview ? '预览完成（未上传、未提交）' : '提交成功并已回读'}`));
  } finally {
    if (browser) {
      try { browser.disconnect(); } catch (_) { }
    }
    cleanupSync();
  }
}

if (require.main === module) {
  main().catch(error => {
    cleanupSync();
    console.error(`ERR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { loadConfig, loadSettings, validateImage, validateSubmissionIntent, validRemark: value => typeof value === 'string' && value.length <= REMARK_LIMIT };
