



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

---

# Code Analysis Forms
let me describe an code analysis step by step.

- there is a centralized implementation to generate comment: __unit-comment-block__.
  - **an __unit-comment-block__ is atomic element of every summary**. it has its own priority-level, and the point-of-view and the comment of the code.
  - __unit-comment-block__ would be ai-generated, considering linter-based message when     `hybrid` or `ai-powered` is selected. `rule-based` option uses linter-based message only.
  a __unit-comment-block__ *ALWAYS* have a priority-level each. label it regardless of safety. if the comment tells the code have a problem, label the point-of-viewer as well.
  a __unit-comment-block__ is text paragraphs with no-line-break. if a paragraph is enough to break-down, show me with multi-line text.
  - __unit-comment-block__ must be formed of:
    - **priority-level**
        Commit Defender uses a four-level priority system to classify every review comment by urgency. This replaces vague "warning/error" labels with a human-readable acceptance signal.
        | Level | Name | When to use |
        |---|---|---|
        | 🟩 **P0 Praise** | Positive feedback | Code is clean and exemplary — nothing to flag |
        | 🟦 **P1 Info** | Optional improvement | Code works correctly as-is. Better naming, cleaner structure, readability — zero functional impact if skipped |
        | 🟧 **P2 Warning** | Highly recommended fix | Code runs now but carries real risk: potential runtime errors, deprecated APIs, poor error handling, or performance problems |
        | 🟥 **P3 Critical** | Commit blocked | Broken or dangerous right now — syntax errors, import failures, security vulnerabilities, data-loss risk — **must be fixed before committing** |
        
        P3 findings unconditionally block the commit regardless of any other configuration. P0 is only emitted when there is genuinely nothing negative to say about a file.
        
    - **point-of-view**: an author of a __unit-comment-block__. correctness, maintenance, optimization, review-history, security, setting, and the others if existed in `.commit-defender` directory  
      - correctness: coverage, type-checker, nullable or undefined variable detector, empty strings, syntax validator, off-by-one error check, quality test, etc.
      - security: secure-coding guide, explicit security harmfulness detection, api-key or security token detection, authentication problem, username/password detection, injection, and any other secrets and credentials at risk.
      - maintenance: code readability, maintainability, consistency, code-convention, code format, code linting rules, code implementation structure, naming rules, proper comments.
      - optimization: check performance, big-o complexity, N+1 query problem, Memory Leaks, etc.
      - review-history: a feedback from code-reviewer and code-review whitepaper especially at Merge Request.
      - setting: environment variables checker, dev-ops migration validator.
    - **comments**: ai-generated as default, considering linter-based message when `hybrid` or `ai-powered` is selected. `rule-based` option uses linter-based message only.

- a user can read the summary at the following three summary viewer after an analysis has been finished:
  - __line-hover-summary__ on editor panel, code line by line. the __line-hover-summary__ is *ALWAYS* shown even though the __overall-summary__ tells some codes have a problem. show the line comment with `vscode.CommentController` if there is a mention.
  - __overall-summary__ on editor panel: consists of multiple __unit-comment-block__s.
  - __summary-tab__ on bottom panel: shortcuts list of multiple __unit-comment-block__s.

when analyze a file; every analysis is worked on file:
1. linter analysis is executed at first, if hybrid or rule-based. priority-level would be fixed by linter message.
2. ai analysis is executed then, considering linter message and its priority-level if provided. if not, ai would be assign a appropriate priority-level and comment for the code. analysis can be skipped with special code comment: `# CD:skip:<optional-reason>`. only with `# CD:skip` comment AI ignore this code block to prevent commit as blocked. if reason exists, AI consider the mention and determine to block or pass. another skip options are: `# type: ignore` and `#TODO`.
3. the ai-generated analysis comment is an atomic __unit-comment-block__. it has its own priority-level, and the point-of-view and the comment of the code.
4. when all files are analyzed, the __overall-summary__ gather all the __unit-comment-block__s and generate __overall-summary__. list all __unit-comment-block__s, preserving each priority-level, and show analyzed file path list. __overall-summary__ have a single tag of pass/fail, alongside a priority-level that represents all priority-level and the lowest and most dangerous priority-level is selected.
5. now each code file have one or more comments on line. hover the unit comment block line by line. use `vscode.CommentController` and `vscode.comments.createCommentController()` to hover on the line.
6. at the bottom panel, show commit defender's analysis result like `problems` tab does. when click a comment, focus on the file line and focus on the comment.
7. the analysis histories are gathered on left panel.

considering the above, build or refactor the code that generates and shows the summary.
