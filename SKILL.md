---
name: keychron-erp-sku
description: 创建 ERP“新增定制全新 SKU”申请；用于从精确型号资料生成配置、校验真实图片，并在用户当前请求或本地自动化策略明确授权后填写和提交。不要用于尾缀 SKU、条码申请或仅查询已有 SKU。
---

# ERP 全新定制 SKU

仅处理 ERP 的“新增定制全新 SKU”。公开版默认只生成和检查预览；实际提交属于外部写入，必须由用户在当前请求中明确授权，或由 `references/local-automation-policy.md` 对可信身份、精确触发条件和单次提交范围作出明确授权。公开仓库不包含该本地策略。

开始前读取 [表单参考](references/erp-form.md) 和本地 `references/project-config.local.json`。若存在 `references/local-automation-policy.md`，同时读取；不存在时不得推定自动提交授权。

## 工作流

1. 解析精确型号；不能从相似型号、系列名或聊天历史补全。若消息只有型号且本地自动化策略明确授权，则把它视为本次单个型号的一次提交授权；否则按公开版默认流程预览。
2. 查当前 SKU/EAN 主表和 ERP 申请列表，确认这是需要新主 SKU 编码的全新组合。若已有主 SKU、已有同型号待审申请、属于尾缀 SKU或判断不清，停止并说明原因。
3. 分别打开该型号的当前电子规格书、配置表和项目资料，提取表单字段并记录来源定位。至少核对类目、品牌、系列、颜色、产品负责人、主控、传感器、开关/微动、编码器、电池、VID/PID、配对名称和认证信息；不适用字段留空，不能确认的字段不猜。
4. 从精确型号的配置表附件、规格书附件或授权项目目录取得真实产品图片。不得使用相似型号图片、网页缩略图、AI 生成图或仅改文件扩展名的伪图片；全新 SKU 提交必须有真实图片。
5. 按 [配置示例](references/config.example.json) 在系统临时目录生成配置。字段与 ERP 选项见 [表单参考](references/erp-form.md)。备注不得超过 130 个字符，未发布产品数据不得写入 Skill 目录。
6. 先用 `--validate-only` 检查配置和图片。无自动提交授权时再运行预览，让用户核对截图；有本地自动提交授权时可直接进入一次 `--submit`，脚本仍会在点击前保存截图。
7. 以 ERP 提交接口返回 2xx、弹窗关闭和列表回读到配置中的成功状态三项作为成功证据；任何一项异常都停止，不自动重试，不把“点击了确定”报告成成功。

## 运行

skill 自带 Node.js 依赖，直接使用系统 `node`：

```bash
node "$HOME/.codex/skills/keychron-erp-sku/scripts/erp-sku.js" \
  --config /absolute/path/to/skus.json \
  --shots /absolute/path/to/screenshots
```

用户当前请求或本地策略明确授权后才可实际提交：

```bash
node "$HOME/.codex/skills/keychron-erp-sku/scripts/erp-sku.js" \
  --config /absolute/path/to/skus.json \
  --shots /absolute/path/to/screenshots \
  --submit
```

可用参数：

- `--profile-directory "Profile 1"`：源 Chrome 配置目录，默认 `Default`。
- `--chrome-data-dir /absolute/path`：Chrome 用户数据根目录，默认当前用户的标准 Chrome 目录。
- `--settings /absolute/path`：ERP 页面本地设置，默认 `references/project-config.local.json`。
- `--erp-url https://...`：临时覆盖本地设置中的 ERP URL；不要把私有 URL 写入公开文件。
- `--no-sandbox`：只在正常启动 Chrome 明确失败且确有必要时使用；默认不关闭 Chrome 沙箱。
- `--list "型号"`：列表回读的搜索关键词。
- `--validate-only`：只检查配置和图片，不启动浏览器。

## 安全边界

- 不因 Skill 被调用而推定用户已同意提交；只有当前请求的明确授权或本地策略精确命中才能使用 `--submit`。
- 自动提交授权只覆盖一个已解析型号的一次尝试；资料缺失、图片缺失、已有记录或结果不确定时立即失效，不能扩大到其他型号或重试。
- 临时 Chrome 配置只复制维持 ERP 登录所需的有限数据，放在权限为 `0700` 的随机临时目录，并在成功、失败、终止时删除。
- 配置中的图片必须是本地常见图片格式；脚本拒绝上传其他文件。
- 不输出 Cookie、Local Storage、POST 响应正文或其他登录数据。
- 不修改 Skill、记忆或本地策略；发现流程变化时向用户报告。

## 本地资料

SKU/EAN 主表、项目表、ERP URL、默认负责人和工作表 ID 只放在被 Git 忽略的本地配置中。全新系列 SKU 编码是否可留空以当前 ERP 流程为准；产品图片为必填。
