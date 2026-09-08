# ERP New SKU Codex Skill

A Codex Skill and browser automation helper for preparing and submitting **new customized master SKU** requests from verified model specifications.

中文说明见下方。

## Safety model

- Preview is the public default; calling the Skill alone never authorizes submission.
- `--submit` requires the current message to contain an explicit application action, the `SKU` keyword, and a specific product model. A bare model or an SKU lookup never authorizes submission.
- Existing master SKUs, suffix-only SKUs, duplicate pending requests, missing exact-model evidence, and missing real product images must stop the workflow.
- A submission is successful only when the request returns 2xx, the modal closes, and the list readback shows the configured success state.
- Uncertain submissions are never retried automatically.

This repository contains no ERP credentials, cookies, private URLs, employee identities, source documents, or unreleased product data.

## Install

```bash
git clone https://github.com/SvenKunkka/keychron-erp-sku-skill.git ~/.codex/skills/keychron-erp-sku
cd ~/.codex/skills/keychron-erp-sku
npm ci --omit=dev
```

Create your local settings:

```bash
cp references/project-config.example.json references/project-config.local.json
```

Fill the local file with your authorized ERP URL and organization-specific labels. The file is ignored by Git.

## Prepare a request

Create a configuration based on `references/config.example.json`. Use only facts read from the exact model's current specification/configuration sources and a real product image.

Validate without opening a browser:

```bash
node scripts/erp-sku.js --config /absolute/path/to/skus.json --validate-only
```

Preview without uploading or submitting:

```bash
node scripts/erp-sku.js --config /absolute/path/to/skus.json --shots /absolute/path/to/screenshots
```

Submit only with explicit authorization:

```bash
node scripts/erp-sku.js --config /absolute/path/to/skus.json --shots /absolute/path/to/screenshots --submit
```

## Local automation policy

The public repository ships only `references/local-automation-policy.example.md`. Deployments may create `references/local-automation-policy.md` to restrict the workflow to a trusted actor and channel, but the policy must never weaken the mandatory trigger: explicit application action + `SKU` + specific model. A model-only message cannot trigger submission. Keep the policy narrow and never publish identities, credentials, internal URLs, or product records.

## 中文

这个 Skill 只处理“新增定制全新 SKU”，不处理尾缀 SKU、条码申请或已有 SKU 查询。它会先核对 SKU/EAN 主表、ERP 申请列表、精确型号规格书、配置表和真实产品图片，再生成配置并执行校验。

公开版默认只预览。只有用户当前消息同时包含“申请/新增/新建/创建/提交”等申请动作、`SKU` 和具体型号时，才能使用 `--submit`。只发送型号、查询 SKU 或询问规格都不会触发；本地策略只能进一步收紧，不能取消关键词要求。提交结果不确定时不会自动重试。

## Development

```bash
npm ci
npm test
npm run check
```

## License

MIT
