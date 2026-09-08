'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig, loadSettings, validRemark } = require('./erp-sku.js');

function temporaryFile(name, value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-sku-test-'));
  const file = path.join(root, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

test('preview config validates without an image', () => {
  const file = temporaryFile('config.json', {
    skus: [{
      name: 'MODEL-X',
      text: { '中文描述': 'MODEL-X 产品描述' },
      select: { '类目': '鼠标' },
      remark: '已核实字段',
    }],
  });
  const result = loadConfig(file, false);
  assert.equal(result.skus.length, 1);
  assert.equal(result.skus[0].image, null);
});

test('submit config refuses a missing image', () => {
  const file = temporaryFile('config.json', { skus: [{ name: 'MODEL-X' }] });
  assert.throws(() => loadConfig(file, true), /缺少产品图片/);
});

test('unknown form fields and long remarks fail closed', () => {
  const unknown = temporaryFile('unknown.json', { skus: [{ name: 'MODEL-X', text: { '未授权字段': 'x' } }] });
  assert.throws(() => loadConfig(unknown, false), /不允许的字段/);
  assert.equal(validRemark('a'.repeat(130)), true);
  assert.equal(validRemark('a'.repeat(131)), false);
});

test('settings require a valid HTTPS ERP URL and preserve configurable labels', () => {
  const file = temporaryFile('settings.json', {
    erp_url: 'https://erp.example.com/new-sku',
    success_status_text: 'Pending review',
  });
  const settings = loadSettings(file);
  assert.equal(settings.erpOrigin, 'https://erp.example.com');
  assert.equal(settings.successStatusText, 'Pending review');
  const insecure = temporaryFile('insecure.json', { erp_url: 'http://erp.example.com/new-sku' });
  assert.throws(() => loadSettings(insecure), /必须使用 HTTPS/);
});
