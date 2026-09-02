"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/ignore/index.js"(exports2, module2) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.*\/|^\.+$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => Object.defineProperty(object, key, { value });
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range) => range.replace(
      REGEX_REGEXP_RANGE,
      (match, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match : EMPTY
    );
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      [
        // remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\?\s+)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // replace (\ ) with ' '
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?)\s/g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*\\\*\\\*\\\//,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${sanitizeRange(range)}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match) => /\/$/.test(match) ? `${match}$` : `${match}(?=$|\\/$)`
      ],
      // trailing wildcard
      [
        /(\^|\\\/)?\\\*$/,
        (_, p1) => {
          const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
          return `${prefix}(?=$|\\/$)`;
        }
      ]
    ];
    var regexCache = /* @__PURE__ */ Object.create(null);
    var makeRegex = (pattern, ignoreCase) => {
      let source = regexCache[pattern];
      if (!source) {
        source = REPLACERS.reduce(
          (prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)),
          pattern
        );
        regexCache[pattern] = source;
      }
      return ignoreCase ? new RegExp(source, "i") : new RegExp(source);
    };
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF);
    var IgnoreRule = class {
      constructor(origin, pattern, negative, regex) {
        this.origin = origin;
        this.pattern = pattern;
        this.negative = negative;
        this.regex = regex;
      }
    };
    var createRule = (pattern, ignoreCase) => {
      const origin = pattern;
      let negative = false;
      if (pattern.indexOf("!") === 0) {
        negative = true;
        pattern = pattern.substr(1);
      }
      pattern = pattern.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regex = makeRegex(pattern, ignoreCase);
      return new IgnoreRule(
        origin,
        pattern,
        negative,
        regex
      );
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path5, originalPath, doThrow) => {
      if (!isString(path5)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path5) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path5)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path5) => REGEX_TEST_INVALID_PATH.test(path5);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore2 = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = [];
        this._ignoreCase = ignoreCase;
        this._allowRelativePaths = allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      _addPattern(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules);
          this._added = true;
          return;
        }
        if (checkPattern(pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._addPattern, this);
        if (this._added) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      //          |           ignored : unignored
      // negative |   0:0   |   0:1   |   1:0   |   1:1
      // -------- | ------- | ------- | ------- | --------
      //     0    |  TEST   |  TEST   |  SKIP   |    X
      //     1    |  TESTIF |  SKIP   |  TEST   |    X
      // - SKIP: always skip
      // - TEST: always test
      // - TESTIF: only test if checkUnignored
      // - X: that never happen
      // @param {boolean} whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // @returns {TestResult} true if a file is ignored
      _testOne(path5, checkUnignored) {
        let ignored = false;
        let unignored = false;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule.regex.test(path5);
          if (matched) {
            ignored = !negative;
            unignored = negative;
          }
        });
        return {
          ignored,
          unignored
        };
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored, slices) {
        const path5 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path5,
          originalPath,
          this._allowRelativePaths ? RETURN_FALSE : throwError
        );
        return this._t(path5, cache, checkUnignored, slices);
      }
      _t(path5, cache, checkUnignored, slices) {
        if (path5 in cache) {
          return cache[path5];
        }
        if (!slices) {
          slices = path5.split(SLASH);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path5] = this._testOne(path5, checkUnignored);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path5] = parent.ignored ? parent : this._testOne(path5, checkUnignored);
      }
      ignores(path5) {
        return this._test(path5, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path5) => !this.ignores(path5);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path5) {
        return this._test(path5, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore2(options);
    var isPathValid = (path5) => checkPath(path5 && checkPath.convert(path5), path5, RETURN_FALSE);
    factory.isPathValid = isPathValid;
    factory.default = factory;
    module2.exports = factory;
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && (process.env && process.env.IGNORE_TEST_WIN32 || process.platform === "win32")
    ) {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGIX_IS_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path5) => REGIX_IS_WINDOWS_PATH_ABSOLUTE.test(path5) || isNotRelative(path5);
    }
  }
});

// src/hook/cli.ts
var import_child_process3 = require("child_process");
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// src/diff.ts
var import_child_process = require("child_process");
var MAX_CONTENT_CHARS = 8e4;
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
function git(repoRoot, args) {
  return new Promise((resolve, reject) => {
    (0, import_child_process.execFile)("git", ["-C", repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err2, stdout, stderr) => {
      if (err2) {
        const e = new Error(`git ${args.join(" ")} failed: ${stderr.trim() || err2.message}`);
        e.code = err2.code;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}
async function getStagedDiff(repoRoot, relPaths) {
  if (relPaths.length === 0) {
    return "";
  }
  let out;
  try {
    out = await git(repoRoot, ["diff", "--cached", "--diff-filter=d", "--", ...relPaths]);
  } catch {
    out = await git(repoRoot, ["diff", "--cached", "--diff-filter=d", EMPTY_TREE, "--", ...relPaths]);
  }
  return truncate(out);
}
function truncate(s) {
  if (s.length <= MAX_CONTENT_CHARS) {
    return s;
  }
  return s.slice(0, MAX_CONTENT_CHARS) + "\n\n[... truncated for token limit ...]";
}

// src/excludeFilter.ts
var import_ignore = __toESM(require_ignore());
function buildIgnore(patterns) {
  const ig = (0, import_ignore.default)();
  if (patterns.length > 0) {
    ig.add(patterns);
  }
  return ig;
}
function applyExcludes(relPaths, patterns) {
  if (patterns.length === 0) {
    return relPaths;
  }
  const ig = buildIgnore(patterns);
  return relPaths.filter((p) => !ig.ignores(p));
}

// src/exitResolver.ts
function resolveExitCode(report) {
  if (report.review.is_error) {
    return 0;
  }
  if (report.review.file_comments.some((c) => c.priority === "P3")) {
    return 1;
  }
  if (report.review.blocking) {
    return 1;
  }
  return 0;
}

// src/skipMarkers.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var PATTERNS = [
  /#\s*CD\s*:\s*skip/i,
  /#\s*type\s*:\s*ignore/,
  /#\s*TODO\b/i
];
function isMarked(line) {
  return PATTERNS.some((re) => re.test(line));
}
function scanFile(absPath) {
  const marked = /* @__PURE__ */ new Set();
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return marked;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isMarked(lines[i])) {
      marked.add(i + 1);
    }
  }
  return marked;
}
function applyMarkers(comments, staged, repoRoot) {
  const skipMap = /* @__PURE__ */ new Map();
  for (const rel of staged) {
    const lines = scanFile(path.join(repoRoot, rel));
    if (lines.size > 0) {
      skipMap.set(rel, lines);
    }
  }
  if (skipMap.size === 0) {
    return comments;
  }
  return comments.filter((c) => !skipMap.get(c.file)?.has(c.line));
}

// src/skills.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function loadSkills(repoRoot) {
  const skillDir = path2.join(repoRoot, ".commit-defender");
  let entries;
  try {
    entries = fs2.readdirSync(skillDir, { withFileTypes: true });
  } catch {
    return "";
  }
  const sections = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillFile = path2.join(skillDir, entry.name, "SKILL.md");
    let content;
    try {
      content = fs2.readFileSync(skillFile, "utf8").trim();
    } catch {
      continue;
    }
    if (!content) {
      continue;
    }
    sections.push(`### [${entry.name}]

${content}`);
  }
  if (sections.length === 0) {
    return "";
  }
  return "## Active Review Skills\n\n" + sections.join("\n\n---\n\n");
}

// src/ai/json.ts
function parseReviewJson(raw) {
  const truncated = !raw.trim().replace(/`+\s*$/, "").endsWith("}");
  const data = robustJson(raw);
  const validPriorities = /* @__PURE__ */ new Set(["P0", "P1", "P2", "P3"]);
  const validCategories = /* @__PURE__ */ new Set([
    "correctness",
    "security",
    "maintenance",
    "optimization",
    "review-history",
    "setting"
  ]);
  const validGrades = /* @__PURE__ */ new Set(["exceptional", "proficient", "adequate", "insufficient", "critical"]);
  const fcRaw = Array.isArray(data?.file_comments) ? data.file_comments : [];
  const file_comments = fcRaw.filter((fc) => fc && typeof fc.file === "string" && typeof fc.comment === "string").map((fc) => {
    const rawPri = String(fc.priority ?? "P1").toUpperCase();
    const rawCat = String(fc.category ?? "").toLowerCase();
    return {
      file: String(fc.file),
      line: Number.isFinite(+fc.line) ? Math.max(0, Math.floor(+fc.line)) : 0,
      comment: String(fc.comment),
      category: validCategories.has(rawCat) ? rawCat : "",
      priority: validPriorities.has(rawPri) ? rawPri : "P1"
    };
  });
  const grade = validGrades.has(String(data?.grade ?? "").toLowerCase()) ? String(data.grade).toLowerCase() : "";
  return {
    summary: typeof data?.summary === "string" ? data.summary : "(no summary)",
    blocking: Boolean(data?.blocking),
    grade,
    file_comments,
    truncated
  };
}
function robustJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
  }
  const stripped = raw.trim().replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
  }
  let depth = 0;
  let start = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      if (start === null) {
        start = i;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== null) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
        }
        start = null;
      }
    }
  }
  const open = raw.indexOf("{");
  if (open !== -1) {
    const repaired = repairTruncated(raw.slice(open));
    try {
      return JSON.parse(repaired);
    } catch {
    }
  }
  throw new Error("No valid JSON found in response");
}
function repairTruncated(text) {
  const stack = [];
  let inString = false;
  let escapeNext = false;
  for (const ch of text) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" && stack[stack.length - 1] === "{") {
      stack.pop();
    } else if (ch === "]" && stack[stack.length - 1] === "[") {
      stack.pop();
    }
  }
  let suffix = inString ? '"' : "";
  for (let i = stack.length - 1; i >= 0; i--) {
    suffix += stack[i] === "{" ? "}" : "]";
  }
  return text + suffix;
}
var P3_PATTERNS = new RegExp(
  [
    "syntax error",
    "syntaxerror",
    "import error",
    "importerror",
    "parse error",
    "cannot be parsed",
    "fails to parse",
    "\uD30C\uC2F1",
    "undefined variable",
    "nameerror",
    "attributeerror",
    "cannot be executed",
    "won't run",
    "will not run",
    "\uC2E4\uD589.*\uBD88\uAC00",
    "\uBD88\uAC00.*\uC2E4\uD589",
    "incomplete (import|statement|expression|syntax)",
    "missing (colon|parenthes|bracket|quote)",
    "security (vulnerabilit|risk|flaw)",
    "\uCDE8\uC57D",
    "injection",
    "secret.*expos",
    "hardcoded.*(key|secret|password|token)",
    "data.?loss",
    "data.?corrupt",
    "unrecoverable",
    "\uBB38\uBC95 \uC624\uB958",
    "\uAD6C\uBB38 \uC624\uB958",
    "\uC784\uD3EC\uD2B8 \uC624\uB958"
  ].join("|"),
  "i"
);
function enforceP3(priority, commentText) {
  if (priority === "P3") {
    return "P3";
  }
  return P3_PATTERNS.test(commentText) ? "P3" : priority;
}

// src/ai/prompt.ts
var SEVERITY_PROMPTS = {
  severe: "Apply the strictest possible review. Flag every deviation from best practice, every style inconsistency, every potential issue no matter how minor. Use all priority levels: P3 (Critical), P2 (Warning), P1 (Info), and P0 (Praise). Zero tolerance \u2014 emit as many findings as warranted.",
  rigorous: "Apply a strict review. Flag most issues including minor style and best-practice deviations. Use P3, P2, and P1. Include P0 Praise only for genuinely exemplary code. Err on the side of raising concerns.",
  moderate: "Apply a balanced review. Flag meaningful issues and genuine best-practice violations. Use P3 and P2 freely. Limit P1 Info to at most 2 per file \u2014 only the most impactful optional improvements. Do not emit P0 Praise unless every aspect of the file is truly exemplary. Do not nitpick trivial style details.",
  generous: "Apply a lenient review. Only flag issues with clear, concrete risk. Use P3 (Critical) and P2 (Warning) only \u2014 do NOT emit P1 Info or P0 Praise. Allow minor imperfections and style deviations without comment.",
  lean: "Apply a minimal review. ONLY flag P3 Critical issues: broken functionality, security vulnerabilities, or data loss risk. Do NOT emit P2, P1, or P0 findings under any circumstances. If there are no P3 issues, return an empty file_comments array."
};
var SEVERITY_MIN_RANK = {
  lean: 3,
  generous: 2,
  moderate: 1,
  rigorous: 1,
  severe: 0
};
var RICHNESS_PROMPTS = {
  colorful: "For each finding, provide an elaborate explanation: describe the problem in depth, give a concrete example of the fix, explain the reasoning, and mention any trade-offs. The summary may be up to 600 words.",
  chatty: "For each finding, provide helpful context and a suggested fix. The summary should be thorough but focused, up to 400 words.",
  moderate: "Provide clear, concise explanations for each finding. Keep the summary under 300 words.",
  simple: "Be brief. One or two sentences per finding. Keep the summary under 150 words.",
  silent: "Output one-line descriptions only. No elaboration, no examples, no context. Keep the summary under 60 words."
};
var LOCALE_PROMPTS = {
  en: "Write all output in English.",
  ko: "\uBAA8\uB4E0 \uCD9C\uB825\uC744 \uD55C\uAD6D\uC5B4\uB85C \uC791\uC131\uD558\uC138\uC694."
};
var COMMENT_SCHEMA = `    {
      "file": "<path relative to repo root, e.g. src/main.py>",
      "line": <1-based line number; 0 for a file-level comment>,
      "category": "<one of: correctness | security | maintenance | optimization | review-history | setting>",
      "priority": "<one of: P0 | P1 | P2 | P3>",
      "comment": "<actionable suggestion, markdown allowed>"
    }`;
var SHARED_RUBRIC = `## Review categories
Every file comment must be tagged with one of these categories:
- **correctness** \u2014 logic errors, type issues, null/undefined safety, off-by-one, missing tests
- **security** \u2014 secrets, injection, broken auth, crypto weaknesses, OWASP Top 10
- **maintenance** \u2014 readability, naming, code conventions, structure, comments
- **optimization** \u2014 performance, complexity, N+1 queries, memory leaks
- **review-history** \u2014 recurring review patterns, MR best practices, knowledge transfer
- **setting** \u2014 env vars, secrets management, deployment config, infrastructure safety

## Acceptance level (priority)
Every comment requires a "priority" field. Before choosing a level, run through the P3 gate first.

### STEP 1 \u2014 P3 gate (check this before anything else)
Assign **P3 Critical \u{1F7E5}** if the issue falls into ANY of these categories \u2014 no exceptions, no downgrading to P2 or P1:
- Syntax error or incomplete statement (e.g. \`from module im\`, \`def foo(\`, missing colon, truncated expression)
- Import that will raise \`ImportError\` or \`SyntaxError\` at parse time
- Undefined variable, missing required argument, wrong number of arguments
- Security vulnerability: hardcoded secret, SQL/command injection, broken auth, path traversal
- Data-loss risk: unguarded \`DELETE\`, file overwrite without backup, destructive operation without confirmation
- Runtime crash that is certain to occur (not "might" \u2014 will)

If ANY of the above applies, the priority is **P3**. Do not reassign to P2 or P1 for any reason.

### STEP 2 \u2014 remaining levels (only when P3 does not apply)
- **P2** Warning \u{1F7E7} \u2014 Code runs but carries real risk: potential (not certain) runtime errors, deprecated APIs, poor error handling, bad performance patterns, maintainability problems likely to cause future bugs. Highly recommended to fix.
- **P1** Info \u{1F7E6} \u2014 Code is syntactically valid, logically correct, with no runtime risk. Purely optional improvement: better naming, cleaner structure, readability.
- **P0** Praise \u{1F7E9} \u2014 Positive feedback ONLY. Use at file level (line 0) when the code is genuinely clean with nothing to flag. Never mix praise with a concern.

## Code quality grade
Assign ONE grade that reflects the overall quality of the reviewed code:
- **exceptional** \u2014 Exemplary code. Clean, secure, well-structured. Best practices throughout. No significant issues.
- **proficient** \u2014 Good code. Minor issues only; nothing blocking.
- **adequate** \u2014 Acceptable code. Notable issues that should be fixed but are not blocking.
- **insufficient** \u2014 Significant problems that need addressing before this can be considered ready.
- **critical** \u2014 Severe issues: security vulnerabilities, data-loss risk, or logic-breaking bugs. Must not be committed as-is.

## Inline skip directives
If any of these markers appear on a line, do not emit any finding for that line \u2014 omit it entirely from \`file_comments\`:
- \`# CD:skip\` \u2014 developer explicitly suppresses review for this line
- \`# CD:skip:<reason>\` \u2014 same suppression; the reason is a human note
- \`# type: ignore\` \u2014 intentional type-checker suppression; skip this line
- \`# TODO\` \u2014 known unfinished work; skip this line

## Core guidelines
- Be direct and specific. Reference file names and line numbers.
- Group related issues together.
- If the code looks good overall, say so clearly with a P0 Praise comment.`;
var OUTPUT_SCHEMA_PREAMBLE = `## Output format
Respond ONLY with a valid JSON object matching this schema:
{
  "summary": "<narrative review, markdown allowed>",
  "blocking": <true if any P3 comment exists, false otherwise>,
  "grade": "<one of: exceptional | proficient | adequate | insufficient | critical>",
  "file_comments": [
${COMMENT_SCHEMA}
  ]
}`;
var BASE_DIFF = `You are commit-defender, an AI code reviewer integrated into a git pre-commit hook.

You are the sole reviewer \u2014 there is no static linter ahead of you. Apply thorough review to all code:
look for logic errors, security issues, architectural problems, and style/maintenance concerns.

${SHARED_RUBRIC}

${OUTPUT_SCHEMA_PREAMBLE}

Rules for file_comments:
- Only reference lines that appear in the provided diff.
- Limit to at most 15 comments total.
- Every comment must include both "category" and "priority" fields.
- Omit the array (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
`;
var BASE_FILE = `You are commit-defender, an AI code reviewer.

You are the sole reviewer \u2014 there is no static linter ahead of you. Apply thorough review to all code:
look for logic errors, security issues, architectural problems, and style/maintenance concerns.

${SHARED_RUBRIC}

${OUTPUT_SCHEMA_PREAMBLE}

Rules for file_comments:
- You may reference any line number in the file \u2014 not limited to changed lines.
- Limit to at most 20 comments total across all files.
- Every comment must include both "category" and "priority" fields.
- Omit the array (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
`;
function buildSystemPrompt(opts) {
  const base = opts.mode === "file" ? BASE_FILE : BASE_DIFF;
  const parts = [base];
  if (opts.skillsText) {
    parts.push(opts.skillsText);
  }
  const modifiers = [
    `- Severity: ${SEVERITY_PROMPTS[opts.severity] ?? SEVERITY_PROMPTS.moderate}`,
    `- Detail level: ${RICHNESS_PROMPTS[opts.richness] ?? RICHNESS_PROMPTS.moderate}`,
    `- Language: ${LOCALE_PROMPTS[opts.locale] ?? LOCALE_PROMPTS.en}`
  ];
  parts.push(`## Review behavior

${modifiers.join("\n")}`);
  return parts.join("\n\n");
}
function buildUserMessage(mode, content) {
  if (mode === "file") {
    return `## File contents

${content || "(no content available)"}

Please review the above and respond with the JSON object as instructed.
`;
  }
  return `## Staged diff

\`\`\`diff
${content || "(no diff available)"}
\`\`\`

Please review the above and respond with the JSON object as instructed.
`;
}

// src/ai/providers.ts
var import_child_process2 = require("child_process");
var import_promises = require("fs/promises");
var import_os = require("os");
var path3 = __toESM(require("path"));
var DEFAULT_OPENAI = "https://api.openai.com/v1";
var DEFAULT_ANTHROPIC = "https://api.anthropic.com/v1";
var DEFAULT_GEMINI = "https://generativelanguage.googleapis.com/v1beta";
async function callProvider(req) {
  switch (req.provider) {
    case "aoai":
      return callAzureOpenAI(req);
    case "openai":
      return callOpenAI(req);
    case "anthropic":
      return callAnthropic(req);
    case "gemini":
      return callGemini(req);
    case "codex":
      return callCodexCli(req);
    case "claudecode":
      return callClaudeCodeCli(req);
    case "geminicli":
      return callGeminiCli(req);
    case "antigravity":
      return callAntigravityCli(req);
    default:
      return { raw: "", error: `Unknown provider: ${req.provider}` };
  }
}
function ctxLine(req) {
  const parts = [`provider=${req.provider}`];
  if (req.model) {
    parts.push(`model=${req.model}`);
  }
  if (req.endpoint) {
    parts.push(`endpoint=${req.endpoint}`);
  }
  if (req.apiVersion && req.provider === "aoai") {
    parts.push(`api_version=${req.apiVersion}`);
  }
  if (req.executablePath && (req.provider === "codex" || req.provider === "claudecode" || req.provider === "geminicli" || req.provider === "antigravity")) {
    parts.push(`executable=${req.executablePath}`);
  }
  return "  Config: " + parts.join(", ");
}
function err(req, msg) {
  return { raw: "", error: `${msg}
${ctxLine(req)}` };
}
async function withTimeout(req, fn) {
  if (req.signal) {
    return fn(req.signal);
  }
  if (!req.timeoutMs) {
    return fn(new AbortController().signal);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
var MAX_CLI_OUTPUT_BYTES = 16 * 1024 * 1024;
var CliProcessError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
};
async function callCodexCli(req) {
  const command = req.executablePath?.trim() || "codex";
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never"
  ];
  if (req.model.trim()) {
    args.push("--model", req.model.trim());
  }
  const prompt = `${req.systemPrompt}

${req.userMessage}`;
  try {
    return await withSchemaFile(req.responseSchema, async (schemaFile) => {
      if (schemaFile) {
        args.push("--output-schema", schemaFile);
      }
      args.push("-");
      const result = await runCli(command, args, prompt, req, process.env);
      if (result.code !== 0) {
        return err(req, cliExitMessage("Codex", result, "Run `codex login`, then retry."));
      }
      const raw = result.stdout.trim();
      if (!raw) {
        return err(req, `Codex CLI returned no final response.${stderrSuffix(result.stderr)}`);
      }
      return { raw };
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw e;
    }
    return err(req, cliStartMessage("Codex", command, e, "`codex login`"));
  }
}
async function callClaudeCodeCli(req) {
  const command = req.executablePath?.trim() || "claude";
  const schema = req.responseSchema ?? { type: "object" };
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--no-chrome",
    "--system-prompt",
    req.systemPrompt
  ];
  if (req.model.trim()) {
    args.push("--model", req.model.trim());
  }
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = env.CLAUDE_AGENT_SDK_CLIENT_APP ?? "commit-defender/2";
  try {
    const result = await runCli(command, args, req.userMessage, req, env);
    if (result.code !== 0) {
      return err(req, cliExitMessage("Claude Code", result, "Run `claude auth login`, then retry."));
    }
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (e) {
      return err(req, `Claude Code returned invalid JSON: ${e.message}${stderrSuffix(result.stderr)}`);
    }
    if (envelope?.structured_output !== void 0) {
      return {
        raw: typeof envelope.structured_output === "string" ? envelope.structured_output.trim() : JSON.stringify(envelope.structured_output)
      };
    }
    if (typeof envelope?.result === "string" && envelope.result.trim()) {
      return { raw: envelope.result.trim() };
    }
    return err(req, `Claude Code response did not contain structured_output or result.${stderrSuffix(result.stderr)}`);
  } catch (e) {
    if (e.name === "AbortError") {
      throw e;
    }
    return err(req, cliStartMessage("Claude Code", command, e, "`claude auth login`"));
  }
}
async function callGeminiCli(req) {
  const command = req.executablePath?.trim() || "gemini";
  const args = [
    "--output-format",
    "json",
    "--approval-mode",
    "plan",
    "--skip-trust",
    "-p",
    req.systemPrompt
  ];
  if (req.model.trim()) {
    args.unshift("--model", req.model.trim());
  }
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GOOGLE_GENAI_USE_VERTEXAI;
  env.GOOGLE_GENAI_USE_GCA = "true";
  try {
    const result = await runCli(command, args, req.userMessage, req, env);
    if (result.code !== 0) {
      return err(req, cliExitMessage("Gemini", result, "Run the Commit Defender Gemini sign-in command, then retry."));
    }
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (e) {
      return err(req, `Gemini CLI returned invalid JSON: ${e.message}${stderrSuffix(result.stderr)}`);
    }
    const raw = typeof envelope?.response === "string" ? envelope.response.trim() : "";
    if (!raw) {
      return err(req, `Gemini CLI response did not contain a response string.${stderrSuffix(result.stderr)}`);
    }
    return { raw };
  } catch (e) {
    if (e.name === "AbortError") {
      throw e;
    }
    return err(req, cliStartMessage("Gemini", command, e, "`gemini` and select Sign in with Google"));
  }
}
async function callAntigravityCli(req) {
  const command = req.executablePath?.trim() || "agy";
  try {
    return await withAntigravityFiles(req, async (promptFile, schemaFile, tempDir) => {
      const args = [
        "--output-format",
        "json",
        "--mode",
        "plan",
        "--disable-slash-commands",
        "--sandbox",
        "--add-dir",
        tempDir,
        "--json-schema",
        schemaFile
      ];
      if (req.model.trim()) {
        args.push("--model", req.model.trim());
      }
      args.push(
        "-p",
        `Read ${promptFile}. Treat its contents as the complete review request and return only the JSON required by the supplied schema.`
      );
      const result = await runCli(command, args, "", req, process.env);
      if (result.code !== 0) {
        return err(req, cliExitMessage("Antigravity", result, "Run the Commit Defender Antigravity sign-in command, then retry."));
      }
      const raw = extractStructuredCliOutput(result.stdout);
      if (!raw) {
        return err(req, `Antigravity CLI returned no structured final response.${stderrSuffix(result.stderr)}`);
      }
      return { raw };
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw e;
    }
    return err(req, cliStartMessage("Antigravity", command, e, "`agy` and complete sign-in"));
  }
}
async function withAntigravityFiles(req, fn) {
  const dir = await (0, import_promises.mkdtemp)(path3.join((0, import_os.tmpdir)(), "commit-defender-agy-"));
  const promptFile = path3.join(dir, "review-request.md");
  const schemaFile = path3.join(dir, "output-schema.json");
  try {
    await Promise.all([
      (0, import_promises.writeFile)(promptFile, `${req.systemPrompt}

${req.userMessage}`, { encoding: "utf8", mode: 384 }),
      (0, import_promises.writeFile)(schemaFile, JSON.stringify(req.responseSchema ?? { type: "object" }), { encoding: "utf8", mode: 384 })
    ]);
    return await fn(promptFile, schemaFile, dir);
  } finally {
    await (0, import_promises.rm)(dir, { recursive: true, force: true }).catch(() => void 0);
  }
}
function extractStructuredCliOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }
  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  for (const candidate of [
    envelope?.structured_output,
    envelope?.structuredOutput,
    envelope?.result,
    envelope?.response,
    envelope?.output
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      return JSON.stringify(candidate);
    }
  }
  if (envelope && typeof envelope === "object") {
    return JSON.stringify(envelope);
  }
  return "";
}
async function withSchemaFile(schema, fn) {
  if (!schema) {
    return fn(void 0);
  }
  const dir = await (0, import_promises.mkdtemp)(path3.join((0, import_os.tmpdir)(), "commit-defender-"));
  const file = path3.join(dir, "output-schema.json");
  try {
    await (0, import_promises.writeFile)(file, JSON.stringify(schema), { encoding: "utf8", mode: 384 });
    return await fn(file);
  } finally {
    await (0, import_promises.rm)(dir, { recursive: true, force: true }).catch(() => void 0);
  }
}
function runCli(command, args, stdin, req, env) {
  return new Promise((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = (0, import_child_process2.spawn)(command, args, {
      cwd: req.workingDirectory || process.cwd(),
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let externallyAborted = false;
    let processError;
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const terminate = () => {
      child.stdin.destroy();
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    const onAbort = () => {
      externallyAborted = true;
      terminate();
    };
    const timer = req.timeoutMs && req.timeoutMs > 0 ? setTimeout(() => {
      processError = new CliProcessError("timeout", `timed out after ${req.timeoutMs} ms`);
      terminate();
    }, req.timeoutMs) : void 0;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      req.signal?.removeEventListener("abort", onAbort);
    };
    req.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_CLI_OUTPUT_BYTES && !processError) {
        processError = new CliProcessError("output", "stdout exceeded the 16 MiB safety limit");
        terminate();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > MAX_CLI_OUTPUT_BYTES && !processError) {
        processError = new CliProcessError("output", "stderr exceeded the 16 MiB safety limit");
        terminate();
      }
    });
    child.on("error", (error) => {
      processError = error.code === "ENOENT" ? new CliProcessError("missing", `executable not found: ${command}`) : error;
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      if (externallyAborted) {
        finishReject(abortError());
        return;
      }
      if (processError) {
        finishReject(processError);
        return;
      }
      settled = true;
      cleanup();
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && !processError) {
        processError = error;
      }
    });
    child.stdin.end(stdin);
  });
}
function abortError() {
  const error = new Error("Cancelled");
  error.name = "AbortError";
  return error;
}
function cliExitMessage(name, result, remediation) {
  const detail = tail(result.stderr || result.stdout);
  return `${name} CLI exited with code ${result.code}${detail ? `: ${detail}` : ""}
${remediation}`;
}
function cliStartMessage(name, command, error, loginCommand) {
  const e = error;
  if (error instanceof CliProcessError && error.kind === "missing") {
    return `${name} CLI executable was not found at "${command}". Install it or set the corresponding Commit Defender path setting.`;
  }
  if (error instanceof CliProcessError && error.kind === "timeout") {
    return `${name} CLI ${error.message}.`;
  }
  return `${name} CLI failed to start: ${e.message}. Verify the executable and run ${loginCommand}.`;
}
function stderrSuffix(stderr) {
  const detail = tail(stderr);
  return detail ? `
CLI stderr: ${detail}` : "";
}
function tail(value, max = 2e3) {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(trimmed.length - max);
}
async function callAzureOpenAI(req) {
  const missing = [];
  if (!req.apiKey) {
    missing.push("commitDefender.apiKey");
  }
  if (!req.endpoint) {
    missing.push("commitDefender.endpoint");
  }
  if (!req.model) {
    missing.push("commitDefender.model");
  }
  if (missing.length > 0) {
    return err(req, `Missing Azure OpenAI settings: ${missing.join(", ")}`);
  }
  const apiVersion = req.apiVersion || "2024-08-01-preview";
  const url = `${req.endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(req.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const tryBody = (withJsonFormat) => ({
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userMessage }
    ],
    max_completion_tokens: req.maxTokens,
    ...withJsonFormat ? { response_format: { type: "json_object" } } : {}
  });
  return withTimeout(req, async (signal) => {
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "api-key": req.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(tryBody(true)),
        signal
      });
    } catch (e) {
      return err(req, `Could not reach Azure OpenAI endpoint: ${e.message}`);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (/response_format|json_object|unsupported/i.test(body)) {
        let retry;
        try {
          retry = await fetch(url, {
            method: "POST",
            headers: { "api-key": req.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify(tryBody(false)),
            signal
          });
        } catch (e) {
          return err(req, `Could not reach Azure OpenAI endpoint: ${e.message}`);
        }
        return parseOpenAIResp(req, retry);
      }
      return openaiHttpError(req, resp, body);
    }
    return parseOpenAIResp(req, resp);
  });
}
async function callOpenAI(req) {
  if (!req.apiKey) {
    return err(req, "Missing OpenAI API key. Set commitDefender.apiKey.");
  }
  const base = (req.endpoint || DEFAULT_OPENAI).replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const model = req.model || "gpt-4o";
  const tryBody = (withJsonFormat) => ({
    model,
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userMessage }
    ],
    max_completion_tokens: req.maxTokens,
    ...withJsonFormat ? { response_format: { type: "json_object" } } : {}
  });
  return withTimeout(req, async (signal) => {
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(tryBody(true)),
        signal
      });
    } catch (e) {
      return err(req, `Could not reach OpenAI API: ${e.message}`);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (/response_format|json_object|unsupported/i.test(body)) {
        let retry;
        try {
          retry = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(tryBody(false)),
            signal
          });
        } catch (e) {
          return err(req, `Could not reach OpenAI API: ${e.message}`);
        }
        return parseOpenAIResp(req, retry);
      }
      return openaiHttpError(req, resp, body);
    }
    return parseOpenAIResp(req, resp);
  });
}
async function parseOpenAIResp(req, resp) {
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return openaiHttpError(req, resp, body);
  }
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return err(req, `Invalid JSON in API response: ${e.message}`);
  }
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    return err(req, `Empty or malformed response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { raw: raw.trim() };
}
function openaiHttpError(req, resp, body) {
  const detail = body.slice(0, 600);
  if (resp.status === 401 || resp.status === 403) {
    return err(req, `Authentication failed (HTTP ${resp.status}): ${detail}`);
  }
  if (resp.status === 429) {
    return err(req, `Rate limit exceeded (HTTP 429): ${detail}`);
  }
  return err(req, `HTTP ${resp.status}: ${detail}`);
}
async function callAnthropic(req) {
  if (!req.apiKey) {
    return err(req, "Missing Anthropic API key. Set commitDefender.apiKey.");
  }
  const base = (req.endpoint || DEFAULT_ANTHROPIC).replace(/\/+$/, "");
  const url = `${base}/messages`;
  const model = req.model || "claude-sonnet-4-6";
  const body = JSON.stringify({
    model,
    max_tokens: req.maxTokens,
    system: req.systemPrompt,
    messages: [{ role: "user", content: req.userMessage }]
  });
  return withTimeout(req, async (signal) => {
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": req.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body,
        signal
      });
    } catch (e) {
      return err(req, `Could not reach Anthropic API: ${e.message}`);
    }
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 600);
      if (resp.status === 401 || resp.status === 403) {
        return err(req, `Anthropic authentication failed (HTTP ${resp.status}): ${detail}`);
      }
      if (resp.status === 429) {
        return err(req, `Anthropic rate limit exceeded (HTTP 429): ${detail}`);
      }
      return err(req, `Anthropic HTTP ${resp.status}: ${detail}`);
    }
    let data;
    try {
      data = await resp.json();
    } catch (e) {
      return err(req, `Invalid JSON in Anthropic response: ${e.message}`);
    }
    const block = Array.isArray(data?.content) ? data.content.find((b) => b?.type === "text") : null;
    const raw = block?.text;
    if (typeof raw !== "string") {
      return err(req, `Empty or malformed Anthropic response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { raw: raw.trim() };
  });
}
async function callGemini(req) {
  if (!req.apiKey) {
    return err(req, "Missing Gemini API key. Set commitDefender.apiKey.");
  }
  const base = (req.endpoint || DEFAULT_GEMINI).replace(/\/+$/, "");
  const model = req.model || "gemini-2.5-flash";
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: req.userMessage }] }],
    generationConfig: {
      maxOutputTokens: req.maxTokens,
      responseMimeType: "application/json"
    }
  });
  return withTimeout(req, async (signal) => {
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal
      });
    } catch (e) {
      return err(req, `Could not reach Gemini API: ${e.message}`);
    }
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 600);
      if (resp.status === 401 || resp.status === 403) {
        return err(req, `Gemini authentication failed (HTTP ${resp.status}): ${detail}`);
      }
      if (resp.status === 429) {
        return err(req, `Gemini rate limit or quota exceeded (HTTP 429): ${detail}`);
      }
      if (resp.status === 404) {
        return err(req, `Gemini model not found (HTTP 404) \u2014 check commitDefender.model: ${detail}`);
      }
      return err(req, `Gemini HTTP ${resp.status}: ${detail}`);
    }
    let data;
    try {
      data = await resp.json();
    } catch (e) {
      return err(req, `Invalid JSON in Gemini response: ${e.message}`);
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    const raw = Array.isArray(parts) ? parts.map((p) => p?.text ?? "").join("") : void 0;
    if (typeof raw !== "string" || !raw.trim()) {
      return err(req, `Empty or malformed Gemini response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { raw: raw.trim() };
  });
}

// src/ai/schemas.ts
var REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    blocking: { type: "boolean" },
    grade: {
      type: "string",
      enum: ["exceptional", "proficient", "adequate", "insufficient", "critical"]
    },
    file_comments: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer", minimum: 0 },
          category: {
            type: "string",
            enum: ["correctness", "security", "maintenance", "optimization", "review-history", "setting"]
          },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          comment: { type: "string" }
        },
        required: ["file", "line", "category", "priority", "comment"],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "blocking", "grade", "file_comments"],
  additionalProperties: false
};

// src/hook/cli.ts
var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
async function main() {
  const repoRoot = process.argv[2] || process.cwd();
  const cfg = readConfig(repoRoot);
  if (!cfg) {
    eprintln("commit-defender: hook config not found \u2014 skipping review.");
    eprintln('  Re-install the hook from VS Code: command "Commit Defender: Install Pre-commit Hook".');
    process.exit(0);
  }
  const stagedAll = listStagedFiles(repoRoot);
  if (stagedAll.length === 0) {
    process.exit(0);
  }
  const staged = applyExcludes(stagedAll.filter((p) => !isBinary(p)), cfg.excludePatterns);
  if (staged.length === 0) {
    process.exit(0);
  }
  const diff = await getStagedDiff(repoRoot, staged);
  if (!diff.trim()) {
    process.exit(0);
  }
  eprintln(`
\u{1F6E1}  commit-defender \u2014 reviewing ${staged.length} staged file(s)\u2026`);
  const skillsText = loadSkills(repoRoot);
  const systemPrompt = buildSystemPrompt({
    mode: "diff",
    severity: cfg.severityLevel,
    richness: cfg.richnessLevel,
    locale: cfg.locale,
    skillsText
  });
  const userMessage = buildUserMessage("diff", diff);
  const resp = await callProvider({
    provider: cfg.aiProvider,
    apiKey: cfg.apiKey,
    endpoint: cfg.endpoint,
    apiVersion: cfg.apiVersion,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    systemPrompt,
    userMessage,
    workingDirectory: repoRoot,
    executablePath: cfg.aiProvider === "codex" ? cfg.codexPath : cfg.aiProvider === "claudecode" ? cfg.claudeCodePath : cfg.aiProvider === "geminicli" ? cfg.geminiCliPath : cfg.aiProvider === "antigravity" ? cfg.antigravityPath : "",
    responseSchema: REVIEW_OUTPUT_SCHEMA,
    timeoutMs: 12e4
  });
  if (resp.error) {
    eprintln(`
\u26A0 AI review unavailable \u2014 commit not blocked.
  ${indent(resp.error, "  ")}`);
    process.exit(0);
  }
  let parsed;
  try {
    parsed = parseReviewJson(resp.raw);
  } catch (e) {
    eprintln(`
\u26A0 Could not parse AI response \u2014 commit not blocked.
  ${e.message}`);
    process.exit(0);
  }
  const minRank = SEVERITY_MIN_RANK[cfg.severityLevel] ?? 1;
  let comments = parsed.file_comments.map((fc) => ({ ...fc, priority: enforceP3(fc.priority, fc.comment) })).filter((fc) => (PRIORITY_RANK[fc.priority] ?? 1) >= minRank);
  comments = applyMarkers(comments, staged, repoRoot);
  const report = {
    schema_version: 1,
    staged_files: staged,
    duration_ms: 0,
    exit_code: 0,
    lint_findings: [],
    review: {
      summary: parsed.summary,
      blocking: parsed.blocking,
      is_error: false,
      file_comments: comments,
      grade: parsed.grade
    }
  };
  const exitCode = resolveExitCode(report);
  printReport(report, exitCode === 1);
  process.exit(exitCode);
}
function readConfig(repoRoot) {
  const file = path4.join(repoRoot, ".commit-defender", "hook.json");
  let text;
  try {
    text = fs3.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return {
    aiProvider: raw.aiProvider ?? "aoai",
    model: raw.model ?? "",
    endpoint: raw.endpoint ?? "",
    apiVersion: raw.apiVersion ?? "2024-08-01-preview",
    apiKey: raw.apiKey ?? "",
    codexPath: raw.codexPath ?? "codex",
    claudeCodePath: raw.claudeCodePath ?? "claude",
    geminiCliPath: raw.geminiCliPath ?? "gemini",
    antigravityPath: raw.antigravityPath ?? "agy",
    maxTokens: Number.isFinite(+raw.maxTokens) ? +raw.maxTokens : 4096,
    severityLevel: raw.severityLevel ?? "moderate",
    richnessLevel: raw.richnessLevel ?? "moderate",
    locale: raw.locale ?? "en",
    excludePatterns: Array.isArray(raw.excludePatterns) ? raw.excludePatterns : [],
    // UX fields aren't read by the hook but the type demands them.
    colorPalette: "theme-adaptive",
    preCommitHook: "enable",
    fileTimeoutSeconds: 0,
    directoryTimeoutSeconds: 0,
    stagedFilesWarnThreshold: 0,
    repoAnalysisWarnThreshold: 0,
    runOnStage: false
  };
}
function listStagedFiles(repoRoot) {
  try {
    const out = (0, import_child_process3.execFileSync)("git", ["-C", repoRoot, "diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      encoding: "utf8"
    });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    eprintln(`commit-defender: git diff failed \u2014 ${e.message}`);
    return [];
  }
}
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
  ".tiff",
  ".tif",
  ".heic",
  ".heif",
  ".avif",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".mp3",
  ".wav",
  ".aac",
  ".flac",
  ".ogg",
  ".m4a",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".ear",
  ".vsix",
  ".whl",
  ".egg",
  ".pyc",
  ".pyo",
  ".pyd",
  ".class",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
  ".bin",
  ".o",
  ".a",
  ".wasm",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".parquet",
  ".arrow",
  ".avro",
  ".pkl",
  ".pickle",
  ".npy",
  ".npz",
  ".lock"
]);
function isBinary(p) {
  const ext = path4.extname(p).toLowerCase();
  return ext.length > 0 && BINARY_EXTENSIONS.has(ext);
}
var PRIORITY_LABEL = {
  P0: "\u{1F7E9} P0 Praise",
  P1: "\u{1F7E6} P1 Info",
  P2: "\u{1F7E7} P2 Warning",
  P3: "\u{1F7E5} P3 Critical"
};
function printReport(report, blocked) {
  const r = report.review;
  eprintln("");
  eprintln("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
  eprintln(blocked ? "  \u{1F6E1}  commit-defender \u2014 BLOCKED" : "  \u{1F6E1}  commit-defender \u2014 PASS");
  if (r.grade) {
    eprintln(`  Grade: ${r.grade}`);
  }
  eprintln("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
  if (r.summary) {
    eprintln("\nSummary:");
    eprintln(indent(r.summary, "  "));
  }
  if (r.file_comments.length > 0) {
    eprintln("\nFindings:");
    const byFile = /* @__PURE__ */ new Map();
    for (const c of r.file_comments) {
      const list = byFile.get(c.file) ?? [];
      list.push(c);
      byFile.set(c.file, list);
    }
    for (const [file, list] of byFile) {
      eprintln(`
  ${file}`);
      list.sort((a, b) => (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1) || a.line - b.line);
      for (const c of list) {
        const label = PRIORITY_LABEL[c.priority] ?? c.priority;
        const where = c.line > 0 ? `:${c.line}` : " (file-level)";
        const cat = c.category ? ` [${c.category}]` : "";
        eprintln(`    ${label}${cat} ${file}${where}`);
        eprintln(indent(c.comment, "      "));
      }
    }
  }
  if (blocked) {
    eprintln("\nThis commit was blocked because at least one P3 Critical finding was raised.");
    eprintln("Fix the issues above and try again, or use `git commit --no-verify` to skip the check.");
  }
  eprintln("");
}
function eprintln(s) {
  process.stderr.write(s + "\n");
}
function indent(text, prefix) {
  return text.split("\n").map((l) => prefix + l).join("\n");
}
main().catch((e) => {
  eprintln(`commit-defender: unexpected error \u2014 ${e.stack ?? e}`);
  process.exit(0);
});
