



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


# Analysis Step-by-step
line comment pop-up and total summary not working as i think.
let me describe step by step.

- there is a centralized implementation to generate comment.
- there is a few summary viewer:
  - line hover summary on editor panel, code line by line
  - total summary on editor panel
  - code analysis tab on bottom panel

when analyze a file; every analysis is worked on file:
1. linter analysis is executed at first, if hybrid or rule-based. p-level would be fixed by linter message.
2. ai analysis is executed then, considering linter message and its p-level if provided. if not, ai would be assign a appropriate p-level and comment for the code.
3. the generated analysis comment is an atomic unit comment block. it has its own p-level, and the point-of-viewer - listed on `.commit-defender` directory: correctness, maintenance, optimization, review-history, security, setting, and the others if existed - and the comment of the code.
4. when all files are analyzed, the total summary gather all the comments and generate total summary. considering each comments, preserving each p-level, and show analyzed file path list. total summary have a single tag of pass/fail, alongside a p-level that represents all p-level and the lowest and most dangerous p-level is selected.
5. now each code file have one or more comments on line. hover the unit comment block line by line. use `vscode.CommentController` and `vscode.comments.createCommentController()` to hover the line.
6. at the bottom panel, show commit defender's analysis result like `problems` tab does. when click a comment, focus on the file line and focus on the comment.
7. the analysis histories are gathered on left panel.

considering the above, refactor `comments.ts` and `buildSummaryHtml` and the other modules related with generating and showing the summary.

# Skip Option
if the analysis defines the given code critical and blocked, it can be skipped with special code comment: `# CD:skip:<optional-reason>`. only with `# CD:skip` comment AI ignore this code block to prevent commit as blocked. if reason exists, AI consider the mention and determine to block or pass.
another skip options are: `# type: ignore` and `#TODO`.
