



good summary but i want some more.
this extension needs .commit-defender directory to have child directory represents category of points of view.
each child directory has a markdown document `SKILL.md`, which contains some guidelines and constraints.
I recommend some categories below. create each directory with the given name and write `SKILL.md` down inside. categories can be added and work any futher.
- code-compiler: type-checker, nullable or undefined variable detector, syntax validator.
- security-guard: secure-coding guide, explicit security harmfulness detection, api-key or security token detection, username/password detection, and any other secrets and credentials at risk.
- code-convention: code format, code linting rules, code implementation structure, naming rules.
- code-review-whitepaper: a feedback from code-reviewer, especially at Merge Request.
- environment-settings: environment variables checker.

And, I need three setting options.
- severity level : users can set the level of the severity of the result so that they control its strictness and harshness. It has five levels: `severe`, `rigorous`, `moderate`, `generous`, `lean`
- richness level: users can set the richness of the result so that they control the quantity of contents and qualities and details of the result. It has five levels:  `colorful`, `chatty`, `moderate`, `simple`, `silent`
- locale: `en` for english, `ko`for 한국어.



Is this extension refers `SKILL.md` from `.commit-defender` directory? it seems not.
I want to revise categories as below:


- correctness: coverage, type-checker, nullable or undefined variable detector, empty strings, syntax validator, off-by-one error check, quality test, etc.
- security: secure-coding guide, explicit security harmfulness detection, api-key or security token detection, authentication problem, username/password detection, injection, and any other secrets and credentials at risk.
- maintenance: code readibility, maintainability, consistency, code-convention, code format, code linting rules, code implementation structure, naming rules, proper comments.
- optimization: check performance, big-o complexity, N+1 query problem, Memory Leaks, etc.
- review-history: a feedback from code-reviewer and code-review whitepaper especially at Merge Request.
- setting: environment variables checker, dev-ops migration validator.