# Local automation policy example

The public Skill does not grant automatic submission. A deployment may create `local-automation-policy.md` to restrict submission to a narrowly scoped trusted actor and channel. It must not authorize model-only messages.

The policy should state:

- the trusted channel and actor;
- the mandatory trigger: the current message contains an explicit application action, the `SKU` keyword, and a specific product model;
- that bare models, SKU lookups, specification questions, links, paths, and slash commands do not count as requests;
- whether one `--submit` attempt is authorized;
- mandatory evidence, duplicate, image, and result-verification gates;
- that failures and uncertain results must not be retried automatically.

Do not publish identities, private URLs, access tokens, cookies, product records, or credentials in this file.
