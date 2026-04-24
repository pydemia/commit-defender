



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


when analyze a file; every analysis is worked on file:
1. A code file is splitted to multiple __code-segment__ by repeating a small portion of the previous chunk at the start of the next. It prevents crucial information from being cut in half at boundaries, enhancing retrieval accuracy and ensuring smoother semantic continuity 
2. linter analysis is executed at first, if hybrid or rule-based. priority-level would be fixed cosidering linter message.
3. AI analysis is executed about __code-segment__, considering the given linter messages and its priority-level of the __code-segment__ if provided. AI can use the whole __code-segment__ as contextual information. ai will assign a appropriate priority-level and comment for the __code-segment__. analysis can be skipped if a __code-segment__ contains special code comments: `# CD:skip:<optional-reason>`, `# CD:skip`, `# type: ignore` and `#TODO` AI ignore this __code-segment__ from preventing commit as blocked.
4.  AI generates analysis comment for a __code-segment__ and it is called __unit-comment-block__. it has its own priority-level, and the point-of-view and the comment of the code. an __unit-comment-block__ belongs to a __code-segment__. AI can emphasize the core comments. The alignment format of essential contents of __unit-comment-block__ is:
    ```
    {priority-level} {point-of-view}
    
    {ai-generated comment}
    ```
5. When a __unit-comment-block__ is generated, AI show the __unit-comment-block__ to __line-hover-summary__ at the source __code-segment__. a __line-hover-summary__ is poped up on the first line of a __code-segment__ which is the source of the __unit-comment-block__. 
6. When all requisite __unit-comment-block__ is generated, In __comment-tab__ on the bottom panel of vscode, list all analyzed files and all __unit-comment-block__ is in the nested list.
7. When all requisite __unit-comment-block__ is generated, AI gathers all the __unit-comment-block__ and generates __overall-summary__ for a file. AI can emphasize the core comments. The alignment format of essential contents of __overall-summary__ is:
    ```
    {relative_filepath}
    {representative priority-level of all __unit-comment-block__}
    {ai-generated comment to summarize all __unit-comment-block__}
    ```
8. when all files are analyzed, AI gather all the __overall-summary__ and __unit-comment-block__ and generates __total-summary__. AI can emphasize the core comments. The alignment format of essential contents of __total-summary__ is:
    ```
    {title} {single tag of pass/fail} {representative priority-level of all __overall-summary__}

    Overall Summary
    {list of all __overall-summary__ for all files}

    AI Comments
    - {relative_filepath}
       {list of all __unit-comment-block__ of a file}
    - {relative_filepath}
       {list of all __unit-comment-block__ of a file}
    ...

    Analyzed File List
    - {relative_filepath}
    - {relative_filepath}
    - ...
    ```

9. Each code file have one or more __unit-comment-block__. A __unit-comment-block__ is presented by hovering the __unit-comment-block__ line by line. use `vscode.CommentController` and `vscode.comments.createCommentController()` to hover on the line. An user can read the summary at the following three summary viewer after an analysis has been finished:
  - __line-hover-summary__ on editor panel, for each __code-segment__. A __line-hover-summary__ is *ALWAYS* shown if the __overall-summary__ tells some codes have a problem. show the line comment with `vscode.CommentController` if there is a mention.
  - __total-summary__ on editor panel: consists of all generated  __overall-summary__ and all generated __unit-comment-block__.
  - __comment-tab__ on bottom panel: shortcuts list of multiple __unit-comment-block__ for a file, group by file, like `problems` tab does. when click a comment, focus on the file line and focus on the comment.
10. the analysis histories are gathered on left panel.

- A code file has multiple __code-segment__.
- A __unit-comment-block__ and __code-segment__ are a one-to-one correspondence.
- A __unit-comment-block__ MUST summarize ONLY ONE __code-segment__.
- A __line-hover-summary__ and __unit-comment-block__ are a one-to-one correspondence.
- A __line-hover-summary__ MUST HAVE ONLY ONE __unit-comment-block__.
- A __overall-summary__ and a code file are a one-to-one correspondence. 
- A __overall-summary__ and a __unit-comment-block__ are a one-to-many correspondence.
- A __overall-summary__ summarizes __unit-comment-block__ of a code file.
- A line of __comment-tab__ is a __unit-comment-block__.
- The line of __comment-tab__ is nested and grouped by a code file.
- A __total-summary__ and a code file are one-to-many correspondence.
- A __total-summary__ summarizes __overall-summary__ of all code files.
- A __total-summary__ and __overall-summary__ are one-to-many correspondence.
- A __total-summary__ consists of __overall-summary__ and __unit-comment-block__.
- A __total-summary__ can have multiple __overall-summary__.
- A __total-summary__ can have multiple __unit-comment-block__. __unit-comment-block__ are in a nested list of a file.


considering the above, build or refactor the code that generates and shows the summary.



---

I want to add a service to generate commit message for the staged-file summary command, and a user easily use this generated message when doing a commit.

The convention of commit message MUST be handled with System Prompt for LLM. keep the prompt in the package.

The system prompt for Commit message convention is the following:
```
# Git Commit Message Generation Prompt

Construct a commit message consisting of a title and a body. This supports multiple languages, relies on locale setting: `en`, `ko`, etc.

## Title Rules
- Limit title to 50 characters
- Capitalize the first letter
- Avoid periods and special characters
- Start with a base verb
- Exclude past tense
- Use format: [{type}] {title_text}
- Select one type from the list below:
  - Feature: Add new functionality
  - Improve: Refine business logic or performance
  - Fix: Resolve bugs or issues
  - Doc: Update documentation
  - Refactor: Restructure code without changing behavior
  - Test: Add or update test cases
  - Chore: Update build tasks or package managers

## Body Rules
- Limit total text to 300 characters
- Keep each bullet point under 50 characters
- Focus on what and why instead of how
- Provide clear reasons for code changes
- Write in concise bullet points
- Capitalize the first letter of each line
- Avoid periods and special characters
- Exclude past tense
- Start each line with a base verb

## Output Example
[Improve] Refine user authentication logic

- Validate session tokens before database access
- Enhance security by rotating encryption keys
- Reduce latency in login process

```
