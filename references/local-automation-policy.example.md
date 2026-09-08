# Local automation policy example

The public Skill does not grant automatic submission. A deployment may create `local-automation-policy.md` to authorize a narrowly scoped trusted actor and trigger.

The policy should state:

- the trusted channel and actor;
- the exact message shape that counts as a request;
- whether one `--submit` attempt is authorized;
- mandatory evidence, duplicate, image, and result-verification gates;
- that failures and uncertain results must not be retried automatically.

Do not publish identities, private URLs, access tokens, cookies, product records, or credentials in this file.
