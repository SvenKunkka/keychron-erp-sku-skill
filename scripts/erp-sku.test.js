'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig, loadSettings, validateSubmissionIntent, validRemark } = require('./erp-sku.js');

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

test('submission intent requires action, SKU keyword and every exact model', () => {
  assert.equal(validateSubmissionIntent('申请 V5U-W1 的 SKU', ['V5U-W1']), true);
  assert.equal(validateSubmissionIntent('帮我新增 G6 的全新 sku', ['G6']), true);
  assert.equal(validateSubmissionIntent('提交 Q19 HE SKU 申请', ['Q19 HE']), true);

  assert.throws(() => validateSubmissionIntent('V5U-W1', ['V5U-W1']), /申请动作/);
  assert.throws(() => validateSubmissionIntent('查询 G6 的 SKU', ['G6']), /申请动作/);
  assert.throws(() => validateSubmissionIntent('如何申请 G6 SKU', ['G6']), /咨询或查询/);
  assert.throws(() => validateSubmissionIntent('申请 G6', ['G6']), /SKU 关键词/);
  assert.throws(() => validateSubmissionIntent('申请 G6 SKU', ['Q19 HE']), /未明确包含配置型号/);
});
