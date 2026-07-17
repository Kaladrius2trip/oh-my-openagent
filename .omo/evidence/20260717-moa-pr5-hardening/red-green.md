# Red and green record

| Behavior | Red commit and observation | Green commit and observation |
| --- | --- | --- |
| Doctor | `a6e76c7d1`: 4 failures, check not registered. | `b835b2b3f`: 4 pass. |
| Disabled command schema | `fc7a4576d`: parse returned false. | `acb6d5ec5`: 1 pass and schema regenerated. |
| Injection boundary and sanitizer | `f2b7fd7e4`: missing untrusted block and diagnostic. | `f36dac7b0`: prompt and acceptance suites pass. |
| Prompt security revision metadata | `fb97d9285`: expected 1.1, received 1. | `f36dac7b0`: base and envelope versions 1.1. |
| Eval harness | `b7520e1d8`: script missing and nested tsconfig coverage absent. | `6e81b4aa2`: harness and script typecheck tests pass. |
