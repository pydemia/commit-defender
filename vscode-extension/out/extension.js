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
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

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
    var checkPath = (path11, originalPath, doThrow) => {
      if (!isString(path11)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path11) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path11)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path11) => REGEX_TEST_INVALID_PATH.test(path11);
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
      _testOne(path11, checkUnignored) {
        let ignored = false;
        let unignored = false;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule.regex.test(path11);
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
        const path11 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path11,
          originalPath,
          this._allowRelativePaths ? RETURN_FALSE : throwError
        );
        return this._t(path11, cache, checkUnignored, slices);
      }
      _t(path11, cache, checkUnignored, slices) {
        if (path11 in cache) {
          return cache[path11];
        }
        if (!slices) {
          slices = path11.split(SLASH);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path11] = this._testOne(path11, checkUnignored);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path11] = parent.ignored ? parent : this._testOne(path11, checkUnignored);
      }
      ignores(path11) {
        return this._test(path11, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path11) => !this.ignores(path11);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path11) {
        return this._test(path11, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore2(options);
    var isPathValid = (path11) => checkPath(path11 && checkPath.convert(path11), path11, RETURN_FALSE);
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
      checkPath.isNotRelative = (path11) => REGIX_IS_WINDOWS_PATH_ABSOLUTE.test(path11) || isNotRelative(path11);
    }
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var fs6 = __toESM(require("fs"));
var path10 = __toESM(require("path"));
var vscode11 = __toESM(require("vscode"));

// src/diff.ts
var import_child_process = require("child_process");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
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
function getFileContents(repoRoot, relPaths) {
  if (relPaths.length === 0) {
    return "";
  }
  const parts = [];
  for (const rel of relPaths) {
    const abs = path.join(repoRoot, rel);
    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const ext = path.extname(rel).replace(/^\./, "");
    parts.push(`### ${rel}

\`\`\`${ext}
${content}
\`\`\``);
  }
  return truncate(parts.join("\n\n"));
}
function truncate(s) {
  if (s.length <= MAX_CONTENT_CHARS) {
    return s;
  }
  return s.slice(0, MAX_CONTENT_CHARS) + "\n\n[... truncated for token limit ...]";
}

// src/skipMarkers.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
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
    text = fs2.readFileSync(absPath, "utf8");
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
function applyMarkers(comments2, staged, repoRoot) {
  const skipMap = /* @__PURE__ */ new Map();
  for (const rel of staged) {
    const lines = scanFile(path2.join(repoRoot, rel));
    if (lines.size > 0) {
      skipMap.set(rel, lines);
    }
  }
  if (skipMap.size === 0) {
    return comments2;
  }
  return comments2.filter((c) => !skipMap.get(c.file)?.has(c.line));
}

// src/skills.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
function loadSkills(repoRoot) {
  const skillDir = path3.join(repoRoot, ".commit-defender");
  let entries;
  try {
    entries = fs3.readdirSync(skillDir, { withFileTypes: true });
  } catch {
    return "";
  }
  const sections = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillFile = path3.join(skillDir, entry.name, "SKILL.md");
    let content;
    try {
      content = fs3.readFileSync(skillFile, "utf8").trim();
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
var COMMIT_MESSAGE_SYSTEM_PROMPT = `# Git Commit Message Generation Prompt

Construct a commit message consisting of a title and a body

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

## Output Format
Respond ONLY with a valid JSON object \u2014 no markdown fences, no extra keys:
{
  "commit_message": "<title>\\n\\n<body>"
}
`;

// src/ai/providers.ts
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

// src/ai/reviewer.ts
var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var GRADE_RANK = {
  exceptional: 5,
  proficient: 4,
  adequate: 3,
  insufficient: 2,
  critical: 1
};
var Reviewer = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  /** Pre-commit / staged scope: send the combined diff in a single call. */
  async reviewDiff(repoRoot, stagedFiles, signal) {
    const start = Date.now();
    try {
      const diff = await getStagedDiff(repoRoot, stagedFiles);
      const review = await this.singleCall({
        repoRoot,
        mode: "diff",
        body: diff,
        signal
      });
      review.file_comments = applyMarkers(review.file_comments, stagedFiles, repoRoot);
      const report = this.assembleReport(stagedFiles, review, Date.now() - start);
      return { report, stderr: "", timedOut: false, cancelled: false };
    } catch (e) {
      if (e.name === "AbortError") {
        return { report: this.emptyReport("Cancelled"), stderr: "", timedOut: false, cancelled: true };
      }
      return { report: this.errorReport(e.message), stderr: "", timedOut: false, cancelled: false };
    }
  }
  /** On-demand scope: one AI call per file, then merge. */
  async reviewFilesSeparately(repoRoot, relPaths, signal, onProgress) {
    const start = Date.now();
    const allComments = [];
    const perFile = [];
    const summaries = [];
    const grades = [];
    let blocking = false;
    const isMeaningful = (s) => Boolean(s) && s !== "(no summary)" && s !== "AI review skipped";
    for (let i = 0; i < relPaths.length; i++) {
      if (signal?.aborted) {
        return { report: this.emptyReport("Cancelled"), stderr: "", timedOut: false, cancelled: true };
      }
      const rel = relPaths[i];
      onProgress?.(i + 1, relPaths.length, rel);
      const content = getFileContents(repoRoot, [rel]);
      let result;
      try {
        result = await this.singleCall({ repoRoot, mode: "file", body: content, signal });
      } catch (e) {
        if (e.name === "AbortError") {
          return { report: this.emptyReport("Cancelled"), stderr: "", timedOut: false, cancelled: true };
        }
        result = this.errorResult(e.message);
      }
      result.file_comments = applyMarkers(result.file_comments, [rel], repoRoot);
      if (result.is_error) {
        const errText = `\u26A0 ${result.summary}`;
        summaries.push(`**\`${rel}\`** \u2014 ${errText}`);
        perFile.push({ file: rel, summary: errText, priority: "P3", blocking: false, grade: result.grade });
        continue;
      }
      blocking = blocking || result.blocking;
      const filePriority = pickFilePriority(result);
      for (const fc of result.file_comments) {
        allComments.push({ ...fc, file: rel });
      }
      if (result.file_comments.length === 0 && isMeaningful(result.summary)) {
        allComments.push({
          file: rel,
          line: 1,
          comment: result.summary,
          category: "",
          priority: filePriority
        });
      }
      grades.push(result.grade);
      if (isMeaningful(result.summary)) {
        summaries.push(`**\`${rel}\`**

${result.summary}`);
        perFile.push({
          file: rel,
          summary: result.summary,
          priority: filePriority,
          blocking: result.blocking,
          grade: result.grade
        });
      }
    }
    const review = summaries.length === 0 && allComments.length === 0 ? { summary: "AI review produced no output.", blocking: false, is_error: false, file_comments: [], grade: "" } : {
      summary: summaries.join("\n\n---\n\n"),
      blocking,
      is_error: false,
      file_comments: allComments,
      grade: worstGrade(grades) || "",
      per_file_summaries: perFile
    };
    const report = this.assembleReport(relPaths, review, Date.now() - start);
    return { report, stderr: "", timedOut: false, cancelled: false };
  }
  /** Generate a conventional commit message from the current staged diff. */
  async generateCommitMessage(repoRoot, signal) {
    let diff;
    try {
      diff = (await git(repoRoot, ["diff", "--cached"])).trim();
    } catch (e) {
      return { commit_message: "", is_error: true, error: `git diff failed: ${e.message}` };
    }
    if (!diff) {
      return { commit_message: "", is_error: true, error: "No staged changes found." };
    }
    const req = this.buildProviderRequest(
      COMMIT_MESSAGE_SYSTEM_PROMPT,
      `Generate a commit message for the following staged diff:

\`\`\`diff
${diff}
\`\`\``,
      Math.min(this.cfg.maxTokens, 512),
      signal
    );
    const resp = await callProvider(req);
    if (resp.error) {
      return { commit_message: "", is_error: true, error: resp.error };
    }
    let parsed;
    try {
      const stripped = resp.raw.trim().replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
      parsed = JSON.parse(stripped);
    } catch (e) {
      return { commit_message: "", is_error: true, error: `Failed to parse model response: ${e.message}` };
    }
    const msg = String(parsed?.commit_message ?? "").trim();
    if (!msg) {
      return { commit_message: "", is_error: true, error: "Model returned an empty commit_message." };
    }
    return { commit_message: msg, is_error: false, error: "" };
  }
  // ── Internals ─────────────────────────────────────────────────────────────
  async singleCall(opts) {
    const skillsText = loadSkills(opts.repoRoot);
    const systemPrompt = buildSystemPrompt({
      mode: opts.mode,
      severity: this.cfg.severityLevel,
      richness: this.cfg.richnessLevel,
      locale: this.cfg.locale,
      skillsText
    });
    const userMessage = buildUserMessage(opts.mode, opts.body);
    const req = this.buildProviderRequest(systemPrompt, userMessage, this.cfg.maxTokens, opts.signal);
    const resp = await callProvider(req);
    if (resp.error) {
      return this.errorResult(resp.error);
    }
    let parsed;
    try {
      parsed = parseReviewJson(resp.raw);
    } catch (e) {
      return this.errorResult(
        `Could not parse AI response as JSON (max_tokens=${this.cfg.maxTokens}). Raw response head: ${resp.raw.slice(0, 200)}`
      );
    }
    const minRank = SEVERITY_MIN_RANK[this.cfg.severityLevel] ?? 1;
    let comments2 = parsed.file_comments.map((fc) => ({
      ...fc,
      priority: enforceP3(fc.priority, fc.comment)
    })).filter((fc) => (PRIORITY_RANK[fc.priority] ?? 1) >= minRank);
    if (this.cfg.severityLevel === "moderate") {
      const counts = /* @__PURE__ */ new Map();
      comments2 = comments2.filter((fc) => {
        if (fc.priority !== "P1") {
          return true;
        }
        const n = (counts.get(fc.file) ?? 0) + 1;
        counts.set(fc.file, n);
        return n <= 2;
      });
    }
    let summary = parsed.summary;
    if (parsed.truncated) {
      summary = `\u26A0 Response truncated (max_tokens=${this.cfg.maxTokens}) \u2014 increase \`commitDefender.maxTokens\` for a complete review.

${summary}`;
    }
    return {
      summary,
      blocking: parsed.blocking,
      is_error: false,
      file_comments: comments2,
      grade: parsed.grade
    };
  }
  buildProviderRequest(systemPrompt, userMessage, maxTokens, signal) {
    return {
      provider: this.cfg.aiProvider,
      apiKey: this.cfg.apiKey,
      endpoint: this.cfg.endpoint,
      apiVersion: this.cfg.apiVersion,
      model: this.cfg.model,
      maxTokens,
      systemPrompt,
      userMessage,
      signal
    };
  }
  assembleReport(stagedFiles, review, durationMs) {
    const exit_code = review.is_error ? 0 : review.file_comments.some((c) => c.priority === "P3") ? 1 : review.blocking ? 1 : 0;
    return {
      schema_version: 1,
      staged_files: stagedFiles,
      duration_ms: durationMs,
      exit_code,
      lint_findings: [],
      review
    };
  }
  emptyReport(summary) {
    return {
      schema_version: 1,
      staged_files: [],
      duration_ms: 0,
      exit_code: 0,
      lint_findings: [],
      review: { summary, blocking: false, is_error: false, file_comments: [], grade: "" }
    };
  }
  errorReport(message) {
    return {
      schema_version: 1,
      staged_files: [],
      duration_ms: 0,
      exit_code: 0,
      lint_findings: [],
      review: this.errorResult(message)
    };
  }
  errorResult(message) {
    return {
      summary: `AI review unavailable: ${message}`,
      blocking: false,
      is_error: true,
      file_comments: [],
      grade: ""
    };
  }
};
function pickFilePriority(result) {
  if (result.file_comments.length > 0) {
    let worst = "P0";
    for (const fc of result.file_comments) {
      if ((PRIORITY_RANK[fc.priority] ?? 1) > (PRIORITY_RANK[worst] ?? 1)) {
        worst = fc.priority;
      }
    }
    return worst;
  }
  if (result.blocking) {
    return "P3";
  }
  if (result.grade === "critical" || result.grade === "insufficient") {
    return "P2";
  }
  return "P1";
}
function worstGrade(grades) {
  let worst = "";
  let worstRank = Number.POSITIVE_INFINITY;
  for (const g of grades) {
    const rank = GRADE_RANK[g];
    if (rank !== void 0 && rank < worstRank) {
      worstRank = rank;
      worst = g;
    }
  }
  return worst;
}

// src/codeLens.ts
var vscode2 = __toESM(require("vscode"));

// src/findingsStore.ts
var path4 = __toESM(require("path"));
var vscode = __toESM(require("vscode"));

// src/types.ts
var PRIORITY_META = {
  P0: { label: "Praise", emoji: "\u{1F7E6}" },
  P1: { label: "Info", emoji: "\u{1F7E9}" },
  P2: { label: "Warning", emoji: "\u{1F7E7}" },
  P3: { label: "Critical", emoji: "\u{1F7E5}" }
};

// src/commentFormatter.ts
var VALID_PRIORITIES = /* @__PURE__ */ new Set(["P0", "P1", "P2", "P3"]);
function hasValidPriority(fc) {
  return VALID_PRIORITIES.has(fc.priority);
}
function severityToPriority(severity) {
  if (severity === "error") {
    return "P3";
  }
  if (severity === "warning") {
    return "P2";
  }
  return "P1";
}
function lintRuleCategory(rule) {
  if (!rule) {
    return "correctness";
  }
  const r = rule.toUpperCase();
  if (/^S\d/.test(r)) {
    return "security";
  }
  if (/^(PERF|C90|FLY)/.test(r)) {
    return "optimization";
  }
  if (/^(E|W|N|D|I|Q|UP|ANN|SIM|ERA|T|ARG|TC|TID|PTH|COM|G|FBT|ISC|ICN|PT|FA|RUF)/.test(r)) {
    return "maintenance";
  }
  return "correctness";
}
function formatCategory(category) {
  if (!category) {
    return "Review";
  }
  return category.charAt(0).toUpperCase() + category.slice(1);
}
var PRIORITY_RANK2 = { P0: 0, P1: 1, P2: 2, P3: 3 };
function metaForBlock(b) {
  const meta = PRIORITY_META[b.priority];
  if (!meta) {
    throw new Error(`CommentBlock has invalid priority: "${b.priority}" (${b.file}:${b.line})`);
  }
  return meta;
}
function normalizeReport(report) {
  const blocks = [];
  for (const f of report.lint_findings) {
    blocks.push({
      file: f.file,
      line: f.line,
      col: f.col,
      priority: severityToPriority(f.severity),
      category: lintRuleCategory(f.rule),
      comment: f.message,
      source: "lint",
      rule: f.rule
    });
  }
  for (const fc of report.review.file_comments) {
    if (!hasValidPriority(fc)) {
      continue;
    }
    blocks.push({
      file: fc.file,
      line: fc.line,
      priority: fc.priority,
      category: fc.category || "",
      comment: fc.comment,
      source: "ai"
    });
  }
  if (blocks.length === 0 && !report.review.is_error && report.review.summary && report.staged_files.length > 0) {
    const priority = report.review.blocking ? "P3" : "P1";
    blocks.push({
      file: report.staged_files[0],
      line: 1,
      priority,
      category: "",
      comment: report.review.summary,
      source: "ai"
    });
  }
  return blocks.sort((a, b) => {
    const ra = PRIORITY_RANK2[a.priority] ?? 1;
    const rb = PRIORITY_RANK2[b.priority] ?? 1;
    if (rb !== ra) {
      return rb - ra;
    }
    if (a.source !== b.source) {
      return a.source === "lint" ? -1 : 1;
    }
    return a.line - b.line;
  });
}
function worstPriority(blocks) {
  let worst;
  let worstRank = -1;
  for (const b of blocks) {
    const r = PRIORITY_RANK2[b.priority] ?? -1;
    if (r > worstRank) {
      worstRank = r;
      worst = b.priority;
    }
  }
  return worst;
}

// src/findingsStore.ts
var FindingsStore = class {
  _data = /* @__PURE__ */ new Map();
  _last;
  /** Fires whenever the store is updated or cleared. */
  onDidChange = new vscode.EventEmitter();
  /** Populate the store from a completed AnalysisReport. */
  update(report, repoRoot) {
    const blocks = normalizeReport(report);
    this._last = { report, repoRoot, blocks };
    this._data.clear();
    for (const b of blocks) {
      if (b.line <= 0) {
        continue;
      }
      const absPath = path4.join(repoRoot, b.file);
      const uriKey = vscode.Uri.file(absPath).toString();
      const set = this._getOrCreate(uriKey);
      const line0 = b.line - 1;
      const bucket = set.byLine.get(line0) ?? [];
      bucket.push(b);
      set.byLine.set(line0, bucket);
    }
    this.onDidChange.fire();
  }
  /** Return findings for a given document URI (string form). */
  get(uri) {
    return this._data.get(uri.toString());
  }
  /** Return the most recent report + repoRoot + blocks, or undefined if none yet. */
  lastReport() {
    return this._last;
  }
  clear() {
    this._data.clear();
    this._last = void 0;
    this.onDidChange.fire();
  }
  _getOrCreate(uriKey) {
    let set = this._data.get(uriKey);
    if (!set) {
      set = { byLine: /* @__PURE__ */ new Map() };
      this._data.set(uriKey, set);
    }
    return set;
  }
};
var findingsStore = new FindingsStore();

// src/codeLens.ts
var SuggestionCodeLensProvider = class {
  _onDidChangeCodeLenses = new vscode2.EventEmitter();
  onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  constructor() {
    findingsStore.onDidChange.event(() => this._onDidChangeCodeLenses.fire());
  }
  provideCodeLenses(document) {
    const set = findingsStore.get(document.uri);
    if (!set) {
      return [];
    }
    const lenses = [];
    for (const [line0, blocks] of set.byLine) {
      if (line0 < 0) {
        continue;
      }
      const worst = blocks.reduce((w, b) => {
        if (!w) {
          return b;
        }
        return (PRIORITY_RANK2[b.priority] ?? 0) > (PRIORITY_RANK2[w.priority] ?? 0) ? b : w;
      }, void 0);
      if (!worst) {
        continue;
      }
      const meta = metaForBlock(worst);
      const count = blocks.length;
      const first = blocks[0].comment.split("\n")[0];
      lenses.push(new vscode2.CodeLens(new vscode2.Range(line0, 0, line0, 0), {
        title: `${meta.emoji} ${count} finding${count > 1 ? "s" : ""}`,
        tooltip: first,
        command: "commitDefender.showLineSuggestion",
        arguments: [document.uri, line0]
      }));
    }
    return lenses;
  }
};

// src/comments.ts
var path5 = __toESM(require("path"));
var vscode3 = __toESM(require("vscode"));
var CommentManager = class {
  threads = [];
  clearAll() {
    this.threads.forEach((t) => t.dispose());
    this.threads = [];
  }
  /** Create one thread per CommentBlock — one unit-comment-block per code segment. */
  apply(blocks, repoRoot, ctrl) {
    this.clearAll();
    for (const b of blocks) {
      if (b.line <= 0) {
        continue;
      }
      this._createThread(ctrl, repoRoot, b);
    }
  }
  /**
   * Render a unit-comment-block per spec:
   *   thread.label → "{emoji} {priority} {label} · {point-of-view}"
   *   author.name  → "Commit Defender" — keeps POV from duplicating in the
   *                  comment header VS Code renders above the body
   *   body         → just the AI-generated comment (no redundant header)
   */
  _createThread(ctrl, repoRoot, b) {
    const uri = vscode3.Uri.file(path5.join(repoRoot, b.file));
    const line = Math.max(0, b.line - 1);
    const range = new vscode3.Range(line, 0, line, 0);
    const meta = metaForBlock(b);
    const pov = b.category && b.priority !== "P0" ? ` \xB7 ${formatCategory(b.category)}` : "";
    const header = `${meta.emoji} ${b.priority} ${meta.label}${pov}`;
    const bodyText = b.source === "lint" && b.rule ? `\`${b.rule}\` \u2014 ${b.comment}` : b.comment;
    const md = new vscode3.MarkdownString(bodyText);
    md.isTrusted = true;
    md.supportHtml = false;
    const comment = {
      author: { name: "Commit Defender" },
      body: md,
      mode: vscode3.CommentMode.Preview
    };
    const thread = ctrl.createCommentThread(uri, range, [comment]);
    thread.label = header;
    thread.collapsibleState = vscode3.CommentThreadCollapsibleState.Expanded;
    thread.canReply = false;
    this.threads.push(thread);
  }
};

// src/config.ts
var vscode4 = __toESM(require("vscode"));
function getConfig() {
  const cfg = vscode4.workspace.getConfiguration("commitDefender");
  return {
    aiProvider: cfg.get("aiProvider") ?? "aoai",
    model: cfg.get("model") ?? "",
    endpoint: cfg.get("endpoint") ?? "",
    apiVersion: cfg.get("apiVersion") ?? "2024-08-01-preview",
    apiKey: cfg.get("apiKey") ?? "",
    maxTokens: cfg.get("maxTokens") ?? 4096,
    severityLevel: cfg.get("severityLevel") ?? "moderate",
    richnessLevel: cfg.get("richnessLevel") ?? "moderate",
    locale: cfg.get("locale") ?? "en",
    excludePatterns: cfg.get("excludePatterns") ?? [],
    colorPalette: cfg.get("colorPalette") ?? "theme-adaptive",
    preCommitHook: cfg.get("preCommitHook") ?? "disable",
    fileTimeoutSeconds: cfg.get("fileTimeoutSeconds") ?? 120,
    directoryTimeoutSeconds: cfg.get("directoryTimeoutSeconds") ?? 360,
    stagedFilesWarnThreshold: cfg.get("stagedFilesWarnThreshold") ?? 20,
    repoAnalysisWarnThreshold: cfg.get("repoAnalysisWarnThreshold") ?? 80,
    runOnStage: cfg.get("runOnStage") ?? true
  };
}

// src/diagnostics.ts
var path6 = __toESM(require("path"));
var vscode5 = __toESM(require("vscode"));
var PRIORITY_SEVERITY = {
  P3: vscode5.DiagnosticSeverity.Error,
  P2: vscode5.DiagnosticSeverity.Warning,
  P1: vscode5.DiagnosticSeverity.Information,
  P0: vscode5.DiagnosticSeverity.Hint
};
function applyDiagnostics(blocks, repoRoot, collection) {
  collection.clear();
  const byFile = /* @__PURE__ */ new Map();
  for (const b of blocks) {
    if (b.line <= 0) {
      continue;
    }
    const list = byFile.get(b.file) ?? [];
    list.push(b);
    byFile.set(b.file, list);
  }
  for (const [relFile, fileBlocks] of byFile) {
    const uri = vscode5.Uri.file(path6.join(repoRoot, relFile));
    const diagnostics = fileBlocks.map((b) => {
      const line = Math.max(0, b.line - 1);
      const col = Math.max(0, (b.col ?? 1) - 1);
      const range = new vscode5.Range(line, col, line, Number.MAX_SAFE_INTEGER);
      const cat = b.category ? formatCategory(b.category) : "";
      const catPart = cat ? `\xB7${cat}` : "";
      const prefix = `[${b.priority}${catPart}]`;
      const body = b.comment.split("\n")[0].trim();
      const message = b.source === "lint" && b.rule ? `${prefix} ${b.rule} \u2014 ${body}` : `${prefix} ${body}`;
      const diag = new vscode5.Diagnostic(range, message, PRIORITY_SEVERITY[b.priority]);
      diag.source = `commit-defender \xB7 ${b.source}`;
      if (b.source === "lint" && b.rule) {
        diag.code = b.rule;
      }
      return diag;
    });
    collection.set(uri, diagnostics);
  }
}

// src/gitHelper.ts
var fs4 = __toESM(require("fs"));
var path7 = __toESM(require("path"));
var import_child_process2 = require("child_process");

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

// src/gitHelper.ts
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  // Images
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
  // Video / audio
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
  // Archives / packages
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
  // Compiled / native binaries
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
  // Fonts
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  // Office / documents
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  // Database / data blobs
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
  // Lock files (auto-generated, not useful to review)
  ".lock"
]);
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "vendor",
  ".tox"
]);
function isBinary(filePath) {
  const ext = path7.extname(filePath).toLowerCase();
  if (!ext) {
    return false;
  }
  return BINARY_EXTENSIONS.has(ext);
}
function filterForAnalysis(files) {
  return files.filter((f) => !isBinary(f));
}
function collectFiles(dirPath, repoRoot, excludePatterns = []) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs4.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".commit-defender") {
          continue;
        }
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        walk(path7.join(dir, entry.name));
      } else if (entry.isFile()) {
        const fullPath = path7.join(dir, entry.name);
        const rel = path7.relative(repoRoot, fullPath);
        if (!rel.startsWith("..") && !isBinary(rel)) {
          results.push(rel);
        }
      }
    }
  }
  walk(dirPath);
  return applyExcludes(results, excludePatterns);
}
function getRepoRoot(cwd) {
  return execGit(["rev-parse", "--show-toplevel"], cwd);
}
async function getStagedFiles(repoRoot, excludePatterns = []) {
  const output = await execGit(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    repoRoot
  );
  const all = output.split("\n").filter(Boolean);
  return applyExcludes(filterForAnalysis(all), excludePatterns);
}
function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = (0, import_child_process2.spawn)("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => stdout += d.toString());
    proc.stderr.on("data", (d) => stderr += d.toString());
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`));
      }
    });
    proc.on("error", reject);
  });
}

// src/historyProvider.ts
var vscode6 = __toESM(require("vscode"));
var HistoryProvider = class {
  _history = [];
  _blocks = [];
  _lastReport;
  _isRunning = false;
  _cfg;
  _emitter = new vscode6.EventEmitter();
  onDidChangeTreeData = this._emitter.event;
  constructor(cfg) {
    this._cfg = cfg;
  }
  // ── State updaters ────────────────────────────────────────────────────────
  push(report, repoRoot, scope, scopeTarget) {
    const grade = report.review.grade || "ungraded";
    const count = report.staged_files.length;
    const entry = {
      id: Date.now().toString(),
      timestamp: /* @__PURE__ */ new Date(),
      report,
      repoRoot,
      label: `${count} file${count !== 1 ? "s" : ""} \xB7 ${grade}`,
      scope,
      scopeTarget
    };
    this._history.unshift(entry);
    if (this._history.length > 20) {
      this._history.pop();
    }
    this._lastReport = report;
    this._emitter.fire(void 0);
  }
  updateFindings(blocks) {
    this._blocks = blocks;
    this._emitter.fire(void 0);
  }
  setRunning(running) {
    this._isRunning = running;
    this._emitter.fire(void 0);
  }
  updateConfig(cfg) {
    this._cfg = cfg;
    this._emitter.fire(void 0);
  }
  clear() {
    this._history = [];
    this._blocks = [];
    this._lastReport = void 0;
    this._emitter.fire(void 0);
  }
  // ── TreeDataProvider ──────────────────────────────────────────────────────
  getTreeItem(node) {
    switch (node.kind) {
      case "section": {
        const collapsed = node.collapsed ? vscode6.TreeItemCollapsibleState.Collapsed : vscode6.TreeItemCollapsibleState.Expanded;
        const item = new vscode6.TreeItem(node.label, collapsed);
        item.iconPath = new vscode6.ThemeIcon(node.icon);
        item.id = node.id;
        return item;
      }
      case "command": {
        const item = new vscode6.TreeItem(node.label);
        item.description = node.desc;
        item.iconPath = new vscode6.ThemeIcon(node.icon);
        item.command = { command: node.command, title: node.label, arguments: node.args };
        item.tooltip = node.desc;
        item.id = node.id;
        return item;
      }
      case "finding": {
        const meta = PRIORITY_META[node.priority];
        const label = `${meta.emoji} ${node.priority} ${meta.label}`;
        const item = new vscode6.TreeItem(`${label}  \xD7${node.count}`);
        item.description = `${node.count} finding${node.count !== 1 ? "s" : ""}`;
        item.iconPath = new vscode6.ThemeIcon(
          node.priority === "P3" ? "error" : node.priority === "P2" ? "warning" : node.priority === "P1" ? "info" : "pass"
        );
        item.command = {
          command: node.priority === "P3" || node.priority === "P2" ? "workbench.panel.markers.view.focus" : "commitDefender.showSummary",
          title: "Show findings"
        };
        item.tooltip = `${node.count} ${meta.label} finding${node.count !== 1 ? "s" : ""}`;
        item.id = node.id;
        return item;
      }
      case "status": {
        const item = new vscode6.TreeItem(node.label);
        item.description = node.value;
        item.iconPath = new vscode6.ThemeIcon(node.icon);
        item.tooltip = node.tooltip ?? `${node.label}: ${node.value}`;
        if (node.command) {
          item.command = { command: node.command, title: node.label };
        }
        item.id = node.id;
        return item;
      }
      case "entry": {
        const e = node.entry;
        const item = new vscode6.TreeItem(e.label, vscode6.TreeItemCollapsibleState.None);
        item.description = `${scopeTag(e.scope)} \xB7 ${formatTime(e.timestamp)}`;
        item.iconPath = new vscode6.ThemeIcon(scopeIcon(e.scope));
        item.tooltip = `${e.timestamp.toLocaleString()}
[${scopeTag(e.scope)}] ${e.report.review.summary.slice(0, 200)}`;
        item.contextValue = "historyEntry";
        item.command = {
          command: "commitDefender.showHistoryEntry",
          title: "Show Summary",
          arguments: [e]
        };
        item.id = node.id;
        return item;
      }
      default: {
        const item = new vscode6.TreeItem(node.label);
        item.iconPath = new vscode6.ThemeIcon(node.icon ?? "info");
        item.id = node.id;
        return item;
      }
    }
  }
  getChildren(node) {
    if (!node) {
      return this._buildRoot();
    }
    if (node.kind === "section") {
      return node.children;
    }
    return [];
  }
  // ── Root builder ──────────────────────────────────────────────────────────
  _buildRoot() {
    return [
      this._buildCommands(),
      this._buildFindings(),
      this._buildSettings(),
      this._buildHistory()
    ];
  }
  // ── Commands section ──────────────────────────────────────────────────────
  _buildCommands() {
    const children = [
      { kind: "command", id: "cmd-commit-msg", label: "Generate Commit Message", desc: "Draft a message from staged diff", icon: "wand", command: "commitDefender.generateCommitMessage" },
      { kind: "command", id: "cmd-analyze", label: "Analyze Staged Files", desc: "Review git staged changes", icon: "checklist", command: "commitDefender.analyze" },
      { kind: "command", id: "cmd-analyze-file", label: "Analyze Current File", desc: "Review the open file", icon: "file-code", command: "commitDefender.analyzeCurrentFile" },
      { kind: "command", id: "cmd-analyze-dir", label: "Analyze Directory\u2026", desc: "Pick a folder to review", icon: "folder", command: "commitDefender.analyzeDirectory" },
      { kind: "command", id: "cmd-analyze-repo", label: "Analyze Repository", desc: "Full repo scan", icon: "repo", command: "commitDefender.analyzeRepository" }
    ];
    if (this._isRunning) {
      children.push(
        { kind: "command", id: "cmd-cancel", label: "Cancel Analysis", desc: "Stop the running analysis", icon: "stop-circle", command: "commitDefender.cancel" }
      );
    }
    children.push(
      { kind: "command", id: "cmd-summary", label: "Show Summary Panel", desc: "Reopen last summary", icon: "preview", command: "commitDefender.showSummary" },
      { kind: "command", id: "cmd-clear", label: "Clear Findings", desc: "Remove all comments & diagnostics", icon: "clear-all", command: "commitDefender.clearFindings" }
    );
    return { kind: "section", id: "sec-commands", label: "Commands", icon: "terminal", children };
  }
  // ── Current Findings section ──────────────────────────────────────────────
  _buildFindings() {
    const children = [];
    if (this._isRunning) {
      children.push({ kind: "empty", id: "findings-running", label: "Analyzing\u2026", icon: "loading~spin" });
    } else if (this._blocks.length === 0) {
      children.push({ kind: "empty", id: "findings-empty", label: "No findings", icon: "check" });
    } else {
      const counts = {};
      for (const b of this._blocks) {
        counts[b.priority] = (counts[b.priority] ?? 0) + 1;
      }
      const passed = this._lastReport?.exit_code === 0;
      const verdict = {
        kind: "status",
        id: "findings-verdict",
        label: passed ? "PASS" : "BLOCKED",
        value: `${this._blocks.length} finding${this._blocks.length !== 1 ? "s" : ""}`,
        icon: passed ? "pass" : "error",
        command: "commitDefender.showSummary",
        tooltip: passed ? "All findings are advisory \u2014 commit is allowed" : "P3 Critical finding blocks the commit"
      };
      children.push(verdict);
      for (const p of ["P3", "P2", "P1", "P0"]) {
        const n = counts[p];
        if (n) {
          children.push({ kind: "finding", id: `findings-${p}`, priority: p, count: n });
        }
      }
    }
    return { kind: "section", id: "sec-findings", label: "Current Findings", icon: "shield", children };
  }
  // ── Settings & Hooks section ──────────────────────────────────────────────
  _buildSettings() {
    const cfg = this._cfg;
    const openSettings = "workbench.action.openSettings";
    const settingsQuery = "@ext:pydemia.commit-defender";
    const hookEnabled = cfg.preCommitHook === "enable";
    const children = [
      {
        kind: "status",
        id: "cfg-provider",
        label: "Provider",
        value: cfg.aiProvider || "(not set)",
        icon: "cloud",
        command: openSettings,
        tooltip: `AI provider: ${cfg.aiProvider}
Click to open settings`
      },
      {
        kind: "status",
        id: "cfg-model",
        label: "Model",
        value: cfg.model || "(not set)",
        icon: "symbol-method",
        command: openSettings,
        tooltip: `Model: ${cfg.model || "not configured"}
Click to open settings`
      },
      {
        kind: "status",
        id: "cfg-severity",
        label: "Severity",
        value: cfg.severityLevel || "moderate",
        icon: "pulse",
        command: openSettings,
        tooltip: `Severity level: ${cfg.severityLevel}
Click to open settings`
      },
      {
        kind: "status",
        id: "cfg-run-on-stage",
        label: "Run on Stage",
        value: cfg.runOnStage ? "enabled" : "disabled",
        icon: cfg.runOnStage ? "eye" : "eye-closed",
        command: openSettings,
        tooltip: `Auto-analyze on git add: ${cfg.runOnStage ? "on" : "off"}
Click to open settings`
      },
      {
        kind: "status",
        id: "cfg-hook",
        label: "Pre-commit Hook",
        value: hookEnabled ? "enabled" : "disabled",
        icon: hookEnabled ? "check" : "circle-slash",
        tooltip: `Git pre-commit hook: ${hookEnabled ? "installed" : "not installed"}`
      },
      hookEnabled ? { kind: "command", id: "cfg-hook-uninstall", label: "Uninstall Pre-commit Hook", desc: "Remove .git/hooks/pre-commit", icon: "trash", command: "commitDefender.uninstallPreCommitHook" } : { kind: "command", id: "cfg-hook-install", label: "Install Pre-commit Hook", desc: "Block commits on P3 findings", icon: "terminal", command: "commitDefender.installPreCommitHook" },
      {
        kind: "command",
        id: "cfg-open-settings",
        label: "Open Settings",
        desc: "All extension settings",
        icon: "gear",
        command: openSettings,
        args: [settingsQuery]
      }
    ];
    return { kind: "section", id: "sec-settings", label: "Settings & Hooks", icon: "settings-gear", collapsed: true, children };
  }
  // ── History section ───────────────────────────────────────────────────────
  _buildHistory() {
    const children = this._history.length > 0 ? this._history.map((e) => ({ kind: "entry", id: `entry-${e.id}`, entry: e })) : [{ kind: "empty", id: "history-empty", label: "No analyses yet" }];
    return { kind: "section", id: "sec-history", label: "History", icon: "history", children, collapsed: false };
  }
};
function scopeIcon(scope) {
  switch (scope) {
    case "staged":
      return "git-commit";
    case "file":
      return "file-code";
    case "directory":
      return "folder";
    case "repository":
      return "repo";
  }
}
function scopeTag(scope) {
  switch (scope) {
    case "staged":
      return "staged";
    case "file":
      return "file";
    case "directory":
      return "dir";
    case "repository":
      return "repo";
  }
}
function formatTime(d) {
  const now = /* @__PURE__ */ new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1e3);
  if (diff < 60) {
    return "just now";
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`;
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`;
  }
  return d.toLocaleDateString();
}

// src/hook/install.ts
var fs5 = __toESM(require("fs"));
var path8 = __toESM(require("path"));
var vscode8 = __toESM(require("vscode"));

// src/outputChannel.ts
var vscode7 = __toESM(require("vscode"));
var _channel;
function getOutputChannel() {
  if (!_channel) {
    _channel = vscode7.window.createOutputChannel("Commit Defender", "ansi");
  }
  return _channel;
}
function disposeOutputChannel() {
  _channel?.dispose();
  _channel = void 0;
}

// src/hook/install.ts
var HOOK_SIGNATURE = "# commit-defender hook v2";
var CONFIG_DIR = ".commit-defender";
var CONFIG_FILE = "hook.json";
var GITIGNORE_LINE = `${CONFIG_DIR}/${CONFIG_FILE}`;
function configToHookJson(cfg) {
  return {
    aiProvider: cfg.aiProvider,
    model: cfg.model,
    endpoint: cfg.endpoint,
    apiVersion: cfg.apiVersion,
    apiKey: cfg.apiKey,
    maxTokens: cfg.maxTokens,
    severityLevel: cfg.severityLevel,
    richnessLevel: cfg.richnessLevel,
    locale: cfg.locale,
    excludePatterns: cfg.excludePatterns
  };
}
function writeHookConfig(repoRoot, cfg) {
  const dir = path8.join(repoRoot, CONFIG_DIR);
  fs5.mkdirSync(dir, { recursive: true });
  const file = path8.join(dir, CONFIG_FILE);
  fs5.writeFileSync(file, JSON.stringify(configToHookJson(cfg), null, 2) + "\n", { mode: 384 });
  ensureGitignored(repoRoot);
}
function ensureGitignored(repoRoot) {
  const gi = path8.join(repoRoot, ".gitignore");
  let text = "";
  try {
    text = fs5.readFileSync(gi, "utf8");
  } catch {
  }
  if (text.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_LINE)) {
    return;
  }
  const sep = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  fs5.writeFileSync(gi, `${text}${sep}# commit-defender (contains API key)
${GITIGNORE_LINE}
`);
}
function buildHookScript(extensionPath) {
  const cliPath = path8.join(extensionPath, "out", "hook-cli.js");
  return [
    "#!/usr/bin/env sh",
    HOOK_SIGNATURE,
    "# Installed by the Commit Defender VS Code extension.",
    "# To bypass (not recommended): git commit --no-verify",
    "",
    "set -e",
    "",
    'REPO_ROOT="$(git rev-parse --show-toplevel)"',
    "",
    "if ! command -v node >/dev/null 2>&1; then",
    '    echo "commit-defender: node not found in PATH \u2014 skipping pre-commit review." >&2',
    "    exit 0",
    "fi",
    "",
    `exec node ${shellQuote(cliPath)} "$REPO_ROOT"`,
    ""
  ].join("\n");
}
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
async function installHook(repoRoot, extensionPath, cfg) {
  const channel = getOutputChannel();
  const hookDir = path8.join(repoRoot, ".git", "hooks");
  const hookPath = path8.join(hookDir, "pre-commit");
  try {
    fs5.mkdirSync(hookDir, { recursive: true });
  } catch (e) {
    vscode8.window.showErrorMessage(`Commit Defender: Cannot create ${hookDir} \u2014 ${e.message}`);
    return;
  }
  let existing = "";
  try {
    existing = fs5.readFileSync(hookPath, "utf8");
  } catch {
  }
  if (existing && !existing.includes(HOOK_SIGNATURE)) {
    const action = await vscode8.window.showWarningMessage(
      "Commit Defender: A pre-commit hook already exists. Replacing it would discard the current contents.",
      { modal: true },
      "Replace",
      "Cancel"
    );
    if (action !== "Replace") {
      channel.appendLine("[Commit Defender] Pre-commit hook install cancelled \u2014 existing hook preserved.");
      return;
    }
    const backup = `${hookPath}.backup-${Date.now()}`;
    try {
      fs5.writeFileSync(backup, existing);
      channel.appendLine(`[Commit Defender] Backed up existing hook to ${backup}`);
    } catch (e) {
      channel.appendLine(`[Commit Defender] Could not back up existing hook: ${e.message}`);
    }
  }
  fs5.writeFileSync(hookPath, buildHookScript(extensionPath), { mode: 493 });
  try {
    fs5.chmodSync(hookPath, 493);
  } catch {
  }
  writeHookConfig(repoRoot, cfg);
  channel.appendLine(`[Commit Defender] Pre-commit hook installed at ${hookPath}`);
  vscode8.window.showInformationMessage(
    "Commit Defender: Pre-commit hook installed. Commits in this repo will be reviewed automatically \u2014 even outside VS Code."
  );
}
async function uninstallHook(repoRoot) {
  const channel = getOutputChannel();
  const hookPath = path8.join(repoRoot, ".git", "hooks", "pre-commit");
  let existing = "";
  try {
    existing = fs5.readFileSync(hookPath, "utf8");
  } catch {
    vscode8.window.showInformationMessage("Commit Defender: No pre-commit hook found.");
    return;
  }
  if (!existing.includes(HOOK_SIGNATURE)) {
    vscode8.window.showInformationMessage(
      "Commit Defender: Pre-commit hook was not installed by Commit Defender \u2014 skipping removal."
    );
    return;
  }
  try {
    fs5.unlinkSync(hookPath);
    channel.appendLine(`[Commit Defender] Removed pre-commit hook at ${hookPath}`);
  } catch (e) {
    vscode8.window.showErrorMessage(`Commit Defender: Could not remove hook \u2014 ${e.message}`);
    return;
  }
  vscode8.window.showInformationMessage("Commit Defender: Pre-commit hook removed.");
}
function hookIsInstalled(repoRoot) {
  try {
    return fs5.readFileSync(path8.join(repoRoot, ".git", "hooks", "pre-commit"), "utf8").includes(HOOK_SIGNATURE);
  } catch {
    return false;
  }
}

// src/panelProvider.ts
var path9 = __toESM(require("path"));
var vscode9 = __toESM(require("vscode"));
var PRIORITY_ICON = {
  P3: "error",
  P2: "warning",
  P1: "info",
  P0: "pass"
};
var PRIORITY_COLOR_ID = {
  P3: "list.errorForeground",
  P2: "list.warningForeground",
  P1: "charts.blue",
  P0: "charts.green"
};
var PRIORITY_EMOJI = {
  P3: "\u{1F7E5}",
  P2: "\u{1F7E7}",
  P1: "\u{1F7E6}",
  P0: "\u{1F7E9}"
};
var URI_SCHEME = "commit-defender-finding";
var PanelProvider = class {
  _blocks = [];
  _repoRoot = "";
  _isRunning = false;
  _emitter = new vscode9.EventEmitter();
  onDidChangeTreeData = this._emitter.event;
  // Map decoration URIs → priority + optional badge so a single
  // FileDecorationProvider can paint every row.
  _decorations = /* @__PURE__ */ new Map();
  _decoEmitter = new vscode9.EventEmitter();
  decorationProvider = {
    onDidChangeFileDecorations: this._decoEmitter.event,
    provideFileDecoration: (uri) => {
      if (uri.scheme !== URI_SCHEME) {
        return void 0;
      }
      const entry = this._decorations.get(uri.toString());
      if (!entry) {
        return void 0;
      }
      return new vscode9.FileDecoration(entry.badge, entry.tooltip);
    }
  };
  updateFindings(blocks, repoRoot) {
    this._blocks = blocks;
    this._repoRoot = repoRoot;
    this._rebuildDecorations();
    this._emitter.fire(void 0);
  }
  setRunning(running) {
    this._isRunning = running;
    this._emitter.fire(void 0);
  }
  clear() {
    const oldUris = Array.from(this._decorations.keys()).map((s) => vscode9.Uri.parse(s));
    this._blocks = [];
    this._repoRoot = "";
    this._decorations.clear();
    if (oldUris.length) {
      this._decoEmitter.fire(oldUris);
    }
    this._emitter.fire(void 0);
  }
  getTreeItem(node) {
    switch (node.kind) {
      case "file": {
        const item = new vscode9.TreeItem(
          path9.basename(node.file),
          vscode9.TreeItemCollapsibleState.Expanded
        );
        item.resourceUri = node.uri;
        const dir = path9.dirname(node.file);
        item.description = `${dir === "." ? "" : dir + "  "}\xB7 ${node.blocks.length} finding${node.blocks.length !== 1 ? "s" : ""}`;
        const worst = worstPriority2(node.blocks);
        const counts = countByPriority(node.blocks);
        item.tooltip = `${node.file} \u2014 ${node.blocks.length} finding${node.blocks.length !== 1 ? "s" : ""}` + (worst ? ` (worst: ${worst})` : "") + summarizeCounts(counts);
        item.iconPath = worst ? new vscode9.ThemeIcon(PRIORITY_ICON[worst], new vscode9.ThemeColor(PRIORITY_COLOR_ID[worst])) : new vscode9.ThemeIcon("file");
        item.id = node.id;
        return item;
      }
      case "block": {
        const b = node.block;
        const meta = PRIORITY_META[b.priority];
        const author = formatCategory(b.category);
        const emoji = PRIORITY_EMOJI[b.priority];
        const body = b.comment.split("\n")[0].trim();
        const ruleTag = b.source === "lint" && b.rule ? `${b.rule} \u2014 ` : "";
        const label = `${emoji} @${author}: ${ruleTag}${body}`;
        const item = new vscode9.TreeItem(label);
        item.resourceUri = node.uri;
        item.iconPath = new vscode9.ThemeIcon(
          PRIORITY_ICON[b.priority],
          new vscode9.ThemeColor(PRIORITY_COLOR_ID[b.priority])
        );
        const lineRef = b.line > 0 ? `Ln ${b.line}${b.col ? `, Col ${b.col}` : ""}` : "file-level";
        item.description = lineRef;
        item.tooltip = new vscode9.MarkdownString(
          `**${meta.emoji} ${b.priority} ${meta.label}** \xB7 _@${author}_

${b.comment}`
        );
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [
            vscode9.Uri.file(node.absPath),
            {
              selection: new vscode9.Range(
                Math.max(0, b.line - 1),
                Math.max(0, (b.col ?? 1) - 1),
                Math.max(0, b.line - 1),
                Math.max(0, (b.col ?? 1) - 1)
              ),
              preserveFocus: false,
              preview: true
            }
          ]
        };
        item.id = node.id;
        return item;
      }
      default: {
        const item = new vscode9.TreeItem(node.label);
        item.iconPath = new vscode9.ThemeIcon(
          this._isRunning ? "loading~spin" : "shield",
          new vscode9.ThemeColor("charts.blue")
        );
        item.id = node.id;
        return item;
      }
    }
  }
  getChildren(node) {
    if (!node) {
      return this._buildRoot();
    }
    if (node.kind === "file") {
      return node.blocks.slice().sort((a, b) => {
        const pr = PRIORITY_RANK2[b.priority] - PRIORITY_RANK2[a.priority];
        if (pr !== 0) {
          return pr;
        }
        return (a.line || 0) - (b.line || 0);
      }).map((b, idx) => {
        const id = `${node.id}::${idx}`;
        return {
          kind: "block",
          id,
          block: b,
          absPath: node.absPath,
          uri: this._blockUri(id)
        };
      });
    }
    return [];
  }
  _buildRoot() {
    if (this._isRunning && this._blocks.length === 0) {
      return [{ kind: "empty", id: "panel-running", label: "Analyzing\u2026" }];
    }
    if (this._blocks.length === 0) {
      return [{ kind: "empty", id: "panel-empty", label: "No Commit Defender findings." }];
    }
    const byFile = /* @__PURE__ */ new Map();
    for (const b of this._blocks) {
      const list = byFile.get(b.file) ?? [];
      list.push(b);
      byFile.set(b.file, list);
    }
    const files = Array.from(byFile.entries()).sort(([fa, ba], [fb, bb]) => {
      const wa = worstPriority2(ba);
      const wb = worstPriority2(bb);
      const ra = wa ? PRIORITY_RANK2[wa] : -1;
      const rb = wb ? PRIORITY_RANK2[wb] : -1;
      if (ra !== rb) {
        return rb - ra;
      }
      return fa.localeCompare(fb);
    });
    return files.map(([file, blocks], idx) => {
      const id = `panel-file-${idx}`;
      return {
        kind: "file",
        id,
        file,
        absPath: path9.join(this._repoRoot, file),
        blocks,
        uri: this._fileUri(id, blocks)
      };
    });
  }
  // ── Decoration plumbing ───────────────────────────────────────────────────
  _fileUri(id, blocks) {
    return vscode9.Uri.from({ scheme: URI_SCHEME, path: `/file/${id}`, query: `n=${blocks.length}` });
  }
  _blockUri(id) {
    return vscode9.Uri.from({ scheme: URI_SCHEME, path: `/block/${encodeURIComponent(id)}` });
  }
  _rebuildDecorations() {
    const oldUris = Array.from(this._decorations.keys()).map((s) => vscode9.Uri.parse(s));
    this._decorations.clear();
    const byFile = /* @__PURE__ */ new Map();
    for (const b of this._blocks) {
      const list = byFile.get(b.file) ?? [];
      list.push(b);
      byFile.set(b.file, list);
    }
    const sortedFiles = Array.from(byFile.entries()).sort(([fa, ba], [fb, bb]) => {
      const wa = worstPriority2(ba);
      const wb = worstPriority2(bb);
      const ra = wa ? PRIORITY_RANK2[wa] : -1;
      const rb = wb ? PRIORITY_RANK2[wb] : -1;
      if (ra !== rb) {
        return rb - ra;
      }
      return fa.localeCompare(fb);
    });
    sortedFiles.forEach(([, blocks], idx) => {
      const worst = worstPriority2(blocks);
      if (!worst) {
        return;
      }
      const fileUri = this._fileUri(`panel-file-${idx}`, blocks);
      this._decorations.set(fileUri.toString(), {
        priority: worst,
        badge: worst.replace("P", ""),
        // "3" / "2" / "1" / "0"
        tooltip: `Worst: ${worst} ${PRIORITY_META[worst].label}`
      });
    });
    sortedFiles.forEach(([, blocks], fileIdx) => {
      const sorted = blocks.slice().sort((a, b) => {
        const pr = PRIORITY_RANK2[b.priority] - PRIORITY_RANK2[a.priority];
        if (pr !== 0) {
          return pr;
        }
        return (a.line || 0) - (b.line || 0);
      });
      sorted.forEach((b, idx) => {
        const id = `panel-file-${fileIdx}::${idx}`;
        const uri = this._blockUri(id);
        const meta = PRIORITY_META[b.priority];
        this._decorations.set(uri.toString(), {
          priority: b.priority,
          badge: b.priority.replace("P", ""),
          tooltip: `${meta.label}${b.category ? ` \xB7 ${formatCategory(b.category)}` : ""}`
        });
      });
    });
    const newUris = Array.from(this._decorations.keys()).map((s) => vscode9.Uri.parse(s));
    const fired = [...oldUris, ...newUris];
    if (fired.length) {
      this._decoEmitter.fire(fired);
    }
  }
};
function worstPriority2(blocks) {
  let worst;
  for (const b of blocks) {
    if (!worst || PRIORITY_RANK2[b.priority] > PRIORITY_RANK2[worst]) {
      worst = b.priority;
    }
  }
  return worst;
}
function countByPriority(blocks) {
  const counts = {};
  for (const b of blocks) {
    counts[b.priority] = (counts[b.priority] ?? 0) + 1;
  }
  return counts;
}
function summarizeCounts(counts) {
  const parts = [];
  for (const p of ["P3", "P2", "P1", "P0"]) {
    const n = counts[p];
    if (n) {
      parts.push(`${p}\xD7${n}`);
    }
  }
  return parts.length ? `
${parts.join(" ")}` : "";
}

// src/statusBar.ts
var vscode10 = __toESM(require("vscode"));
var StatusBarManager = class {
  item;
  constructor() {
    this.item = vscode10.window.createStatusBarItem(vscode10.StatusBarAlignment.Left, 100);
    this.item.command = "commitDefender.analyze";
    this.setIdle();
    this.item.show();
  }
  setIdle(tooltip = "Click to analyze staged files") {
    this.item.text = "$(shield) Commit Defender";
    this.item.tooltip = tooltip;
    this.item.command = "commitDefender.analyze";
    this.item.backgroundColor = void 0;
    this.item.color = void 0;
  }
  setRunning() {
    this.item.text = "$(loading~spin) Analyzing... $(stop-circle)";
    this.item.tooltip = "Commit Defender is running \u2014 click to cancel";
    this.item.command = "commitDefender.cancel";
    this.item.backgroundColor = void 0;
    this.item.color = void 0;
  }
  setProgress(current, total, file) {
    this.item.text = `$(loading~spin) CD: ${current}/${total} \u2014 ${file.split("/").pop()} $(stop-circle)`;
    this.item.tooltip = `Analyzing file ${current} of ${total}: ${file} \u2014 click to cancel`;
    this.item.command = "commitDefender.cancel";
    this.item.backgroundColor = void 0;
    this.item.color = void 0;
  }
  setResult(passed, grade) {
    const gradeLabel = grade ? ` \xB7 ${grade}` : "";
    this.item.command = "commitDefender.analyze";
    if (passed) {
      this.item.text = `$(shield-check) CD: Pass${gradeLabel}`;
      this.item.tooltip = `Commit Defender: passed${grade ? ` (${grade})` : ""}. Click to re-analyze.`;
      this.item.backgroundColor = void 0;
      this.item.color = new vscode10.ThemeColor("terminal.ansiGreen");
    } else {
      this.item.text = `$(shield-x) CD: Blocked${gradeLabel}`;
      this.item.tooltip = `Commit Defender: commit blocked${grade ? ` (${grade})` : ""}. Click to re-analyze.`;
      this.item.backgroundColor = new vscode10.ThemeColor("statusBarItem.errorBackground");
      this.item.color = void 0;
    }
  }
  setError(message) {
    this.item.text = "$(warning) CD: Error";
    this.item.tooltip = `Commit Defender error: ${message}`;
    this.item.command = "commitDefender.analyze";
    this.item.backgroundColor = new vscode10.ThemeColor("statusBarItem.warningBackground");
    this.item.color = void 0;
  }
  dispose() {
    this.item.dispose();
  }
};

// src/palette.ts
var PALETTES = {
  // 1. Theme Adaptive — inherits priorities from active VS Code theme;
  //    categories use VS Code chart colors (yellow/purple) plus fixed hex
  //    for hues VS Code doesn't expose (cyan, indigo, sepia).
  "theme-adaptive": {
    priority: {
      P3: "var(--vscode-errorForeground, #EF4444)",
      P2: "var(--vscode-editorWarning-foreground, #F97316)",
      P1: "var(--vscode-charts-green, #22C55E)",
      P0: "var(--vscode-editorInfo-foreground, #3B82F6)"
    },
    category: {
      security: "var(--vscode-charts-purple, #A855F7)",
      correctness: "var(--vscode-charts-yellow, #D4A017)",
      maintenance: "#06B6D4",
      // cyan
      optimization: "#6366F1",
      // indigo
      setting: "#A0522D",
      // sienna
      "review-history": "var(--vscode-descriptionForeground, #6B7280)"
    }
  },
  // 2. Cobalt9 — electric navy-friendly; categories use cobalt's purple,
  //    yellow, cyan, deep-pink (not P3's hot-pink), olive-tan, steel-gray.
  "cobalt9": {
    priority: { P3: "#FF628C", P2: "#FF9D00", P1: "#3AD900", P0: "#0088FF" },
    category: {
      security: "#AE81FF",
      // cobalt violet
      correctness: "#FFC600",
      // cobalt yellow (distinct from P2 orange)
      maintenance: "#9EFFFF",
      // cobalt cyan
      optimization: "#5C6BC0",
      // indigo (avoids P3 hot-pink clash)
      setting: "#A89A6E",
      // olive-tan
      "review-history": "#5F7E97"
      // steel
    }
  },
  // 3. Tailwind — Tailwind 500 series for categories.
  "tailwind": {
    priority: { P3: "#EF4444", P2: "#F97316", P1: "#22C55E", P0: "#3B82F6" },
    category: {
      security: "#A855F7",
      // purple-500
      correctness: "#FACC15",
      // yellow-400
      maintenance: "#06B6D4",
      // cyan-500
      optimization: "#EC4899",
      // pink-500
      setting: "#92400E",
      // amber-800 (sepia-brown)
      "review-history": "#6B7280"
      // gray-500
    }
  },
  // 4. Pastel Soft — pastel categories that pair with pastel priorities.
  "pastel-soft": {
    priority: { P3: "#F08080", P2: "#FFB26B", P1: "#A8DABD", P0: "#A0C4FF" },
    category: {
      security: "#C9A0DC",
      // pastel lilac
      correctness: "#FFE4B5",
      // pastel cream-gold
      maintenance: "#A0E7E5",
      // pastel cyan
      optimization: "#FFC8DD",
      // pastel pink
      setting: "#D2B48C",
      // tan
      "review-history": "#D3D3D3"
      // light gray
    }
  },
  // 5. Material — Google Material 500 series for categories.
  "material": {
    priority: { P3: "#D50000", P2: "#FF6D00", P1: "#00C853", P0: "#2962FF" },
    category: {
      security: "#9C27B0",
      // purple-500
      correctness: "#FFC107",
      // amber-500
      maintenance: "#00BCD4",
      // cyan-500
      optimization: "#3F51B5",
      // indigo-500
      setting: "#795548",
      // brown-500
      "review-history": "#607D8B"
      // blue-grey-500
    }
  },
  // 6. Solarized — uses solarized's 8-accent palette for categories.
  "solarized": {
    priority: { P3: "#DC322F", P2: "#CB4B16", P1: "#859900", P0: "#268BD2" },
    category: {
      security: "#6C71C4",
      // solarized violet
      correctness: "#B58900",
      // solarized yellow
      maintenance: "#2AA198",
      // solarized cyan
      optimization: "#D33682",
      // solarized magenta
      setting: "#6E4F1F",
      // sepia (custom — solarized has no brown)
      "review-history": "#586E75"
      // base01
    }
  },
  // 7. Muted Modern — Tailwind × Solarized blend; categories follow same
  //    blend rule (Tailwind 600 averaged with Solarized accents).
  "muted-modern": {
    priority: { P3: "#E53B39", P2: "#E25F16", P1: "#53AF2F", P0: "#3086E4" },
    category: {
      security: "#9333EA",
      // muted purple
      correctness: "#CA8A04",
      // muted gold
      maintenance: "#0E7490",
      // dark teal
      optimization: "#4F46E5",
      // indigo
      setting: "#92400E",
      // sepia
      "review-history": "#62707B"
      // slate
    }
  },
  // 8. Nord — uses Nord aurora + frost colors for categories.
  "nord": {
    priority: { P3: "#BF616A", P2: "#D08770", P1: "#A3BE8C", P0: "#5E81AC" },
    category: {
      security: "#B48EAD",
      // aurora purple
      correctness: "#EBCB8B",
      // aurora yellow
      maintenance: "#8FBCBB",
      // frost light cyan
      optimization: "#81A1C1",
      // frost slate-blue
      setting: "#7E5538",
      // sepia (custom — Nord has no brown)
      "review-history": "#4C566A"
      // polar night nord3
    }
  },
  // 9. Dracula — uses Dracula's full ANSI palette for categories.
  "dracula": {
    priority: { P3: "#FF5555", P2: "#FFB86C", P1: "#50FA7B", P0: "#8BE9FD" },
    category: {
      security: "#BD93F9",
      // Dracula purple
      correctness: "#F1FA8C",
      // Dracula yellow
      maintenance: "#94E0F2",
      // softer cyan (P0 already Dracula cyan)
      optimization: "#FF79C6",
      // Dracula pink (distinct hue from P3 red)
      setting: "#A88B4C",
      // sepia (custom)
      "review-history": "#6272A4"
      // Dracula comment
    }
  },
  // 10. Gruvbox — uses Gruvbox's bright variants for categories.
  "gruvbox": {
    priority: { P3: "#FB4934", P2: "#FE8019", P1: "#B8BB26", P0: "#83A598" },
    category: {
      security: "#D3869B",
      // Gruvbox purple-mauve
      correctness: "#FABD2F",
      // Gruvbox yellow
      maintenance: "#8EC07C",
      // Gruvbox aqua
      optimization: "#B16286",
      // Gruvbox magenta
      setting: "#A89984",
      // Gruvbox tan
      "review-history": "#928374"
      // Gruvbox gray
    }
  },
  // 11. CVD Consensus — categories chosen to be CVD-distinguishable from
  //     priorities AND from each other. IBM purple, Okabe yellow, Okabe
  //     bluish-green, Okabe reddish-purple, sienna, gray.
  "cvd-consensus": {
    priority: { P3: "#DD3462", P2: "#E87F01", P1: "#2C7FB8", P0: "#56B4E9" },
    category: {
      security: "#785EF0",
      // IBM purple
      correctness: "#F0E442",
      // Okabe yellow
      maintenance: "#009E73",
      // Okabe bluish-green
      optimization: "#CC79A7",
      // Okabe reddish-purple
      setting: "#8C5E2A",
      // sienna
      "review-history": "#7A7A7A"
      // gray
    }
  },
  // 12. CVD Deep — deeper tones for light-theme readability; categories
  //     deeper too.
  "cvd-deep": {
    priority: { P3: "#A3195B", P2: "#B84A00", P1: "#1F4E8C", P0: "#2C7FB8" },
    category: {
      security: "#5B21B6",
      // deep violet
      correctness: "#A16207",
      // deep gold
      maintenance: "#0F766E",
      // deep teal
      optimization: "#BE185D",
      // deep rose-pink
      setting: "#6E4F1F",
      // sepia
      "review-history": "#4A4A4A"
      // dark gray
    }
  },
  // 13. CVD Vivid — bright/electric for dark themes; categories also bright
  //     but in non-priority hue families.
  "cvd-vivid": {
    priority: { P3: "#FF3399", P2: "#FF8A2A", P1: "#1E90FF", P0: "#66CCFF" },
    category: {
      security: "#B388FF",
      // vivid violet
      correctness: "#FFD700",
      // gold
      maintenance: "#4DD76C",
      // bright green
      optimization: "#9B72FF",
      // lavender-purple
      setting: "#C5A572",
      // gold-tan
      "review-history": "#888888"
      // gray
    }
  },
  // 14. Okabe-Ito — canonical Nature palette uses its own 8-color set for
  //     categories.
  "okabe-ito": {
    priority: { P3: "#D55E00", P2: "#E69F00", P1: "#009E73", P0: "#0072B2" },
    category: {
      security: "#CC79A7",
      // Okabe reddish-purple
      correctness: "#F0E442",
      // Okabe yellow
      maintenance: "#56B4E9",
      // Okabe sky blue (distinct from P0 deep blue)
      optimization: "#785EF0",
      // IBM purple (extends Okabe set)
      setting: "#6E4F1F",
      // sepia
      "review-history": "#999999"
      // gray
    }
  }
};
function resolvePalette(id) {
  return PALETTES[id] ?? PALETTES["theme-adaptive"];
}
function gradeColor(palette, grade) {
  switch (grade) {
    case "exceptional":
      return palette.priority.P0;
    case "proficient":
      return palette.priority.P0;
    case "adequate":
      return palette.priority.P1;
    case "insufficient":
      return palette.priority.P2;
    case "critical":
      return palette.priority.P3;
    default:
      return "var(--vscode-descriptionForeground, #666)";
  }
}

// src/extension.ts
var ALL_FILES = { scheme: "file" };
function activate(context) {
  async function resolveRepoRoot() {
    const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      return void 0;
    }
    try {
      return await getRepoRoot(ws);
    } catch {
      return void 0;
    }
  }
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.installPreCommitHook",
    async () => {
      const repoRoot = await resolveRepoRoot();
      if (!repoRoot) {
        vscode11.window.showWarningMessage("Commit Defender: No git repository found in workspace.");
        return;
      }
      await installHook(repoRoot, context.extensionPath, getConfig());
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.uninstallPreCommitHook",
    async () => {
      const repoRoot = await resolveRepoRoot();
      if (!repoRoot) {
        vscode11.window.showWarningMessage("Commit Defender: No git repository found in workspace.");
        return;
      }
      await uninstallHook(repoRoot);
    }
  ));
  context.subscriptions.push(vscode11.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration("commitDefender")) {
      historyProvider.updateConfig(getConfig());
      const repoRoot = await resolveRepoRoot();
      if (repoRoot && hookIsInstalled(repoRoot)) {
        try {
          writeHookConfig(repoRoot, getConfig());
        } catch (err2) {
          getOutputChannel().appendLine(`[Commit Defender] Could not update hook config: ${err2.message}`);
        }
      }
    }
    if (e.affectsConfiguration("commitDefender.preCommitHook")) {
      const hook = getConfig().preCommitHook;
      if (hook === "enable") {
        vscode11.commands.executeCommand("commitDefender.installPreCommitHook");
      } else {
        vscode11.commands.executeCommand("commitDefender.uninstallPreCommitHook");
      }
    }
    if (e.affectsConfiguration("commitDefender.colorPalette")) {
      const last = findingsStore.lastReport();
      if (last && _summaryPanel) {
        const palette = resolvePalette(getConfig().colorPalette);
        _summaryPanel.webview.html = buildSummaryHtml(last.report, last.repoRoot, palette);
      }
    }
  }));
  const cfg = getConfig();
  if (cfg.preCommitHook === "enable") {
    resolveRepoRoot().then((repoRoot) => {
      if (repoRoot) {
        installHook(repoRoot, context.extensionPath, getConfig());
      }
    });
  }
  const diagnostics = vscode11.languages.createDiagnosticCollection("commit-defender");
  const commentCtrl = vscode11.comments.createCommentController("commit-defender", "Commit Defender");
  const commentManager = new CommentManager();
  const statusBar = new StatusBarManager();
  let currentAbort = null;
  const codeLensProvider = new SuggestionCodeLensProvider();
  const historyProvider = new HistoryProvider(cfg);
  const panelProvider = new PanelProvider();
  const historyView = vscode11.window.createTreeView("commitDefender.history", {
    treeDataProvider: historyProvider,
    showCollapseAll: false
  });
  const panelView = vscode11.window.createTreeView("commitDefender.panelView", {
    treeDataProvider: panelProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(
    diagnostics,
    commentCtrl,
    statusBar.item,
    historyView,
    panelView,
    vscode11.window.registerFileDecorationProvider(panelProvider.decorationProvider),
    vscode11.languages.registerCodeLensProvider(ALL_FILES, codeLensProvider)
  );
  async function analyze(relPaths, repoRoot, scope = "staged", scopeTarget) {
    const cfg2 = getConfig();
    const timeoutSeconds = relPaths.length === 1 ? cfg2.fileTimeoutSeconds : cfg2.directoryTimeoutSeconds;
    const reviewer = new Reviewer(cfg2);
    const abort = new AbortController();
    currentAbort = abort;
    const timeoutHandle = timeoutSeconds > 0 ? setTimeout(() => abort.abort("timeout"), timeoutSeconds * 1e3) : null;
    historyProvider.setRunning(true);
    panelProvider.setRunning(true);
    let result;
    try {
      if (scope === "staged") {
        result = await reviewer.reviewDiff(repoRoot, relPaths, abort.signal);
      } else {
        result = await reviewer.reviewFilesSeparately(
          repoRoot,
          relPaths,
          abort.signal,
          (current, total, file) => statusBar.setProgress(current, total, file)
        );
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      currentAbort = null;
      historyProvider.setRunning(false);
      panelProvider.setRunning(false);
    }
    if (result.cancelled) {
      const reason = abort.signal.reason === "timeout" ? "timed out" : "cancelled";
      statusBar.setIdle(`Analysis ${reason}`);
      vscode11.window.showInformationMessage(`Commit Defender: Analysis ${reason}.`);
      return;
    }
    if (result.report.staged_files.length === 0) {
      statusBar.setIdle("No files analyzed");
      const summary = result.report.review?.summary ?? "No files matched for analysis.";
      const channel = getOutputChannel();
      channel.show(true);
      vscode11.window.showInformationMessage(`Commit Defender: ${summary}`);
      return;
    }
    findingsStore.update(result.report, repoRoot);
    historyProvider.push(result.report, repoRoot, scope, scopeTarget);
    const blocks = findingsStore.lastReport().blocks;
    historyProvider.updateFindings(blocks);
    panelProvider.updateFindings(blocks, repoRoot);
    applyDiagnostics(blocks, repoRoot, diagnostics);
    commentManager.apply(blocks, repoRoot, commentCtrl);
    const passed = result.report.exit_code === 0;
    const isAiError = result.report.review.is_error || /AI review unavailable/i.test(result.report.review.summary);
    if (isAiError) {
      const msg = result.report.review.summary.replace(/^AI review unavailable:\s*/i, "");
      statusBar.setError(msg);
      vscode11.window.showErrorMessage(`Commit Defender: AI review failed \u2014 ${msg}`, "Show Summary", "Show Output").then((action) => {
        if (action === "Show Summary") {
          showSummaryPanel(result.report, repoRoot, context);
        } else if (action === "Show Output") {
          getOutputChannel().show();
        }
      });
    } else {
      statusBar.setResult(passed, result.report.review.grade);
    }
    showSummaryPanel(result.report, repoRoot, context);
    await vscode11.commands.executeCommand("commitDefender.panelView.focus");
    const srcFile = result.report.staged_files[0] ?? relPaths[0];
    if (srcFile) {
      const absPath = path10.join(repoRoot, srcFile);
      await vscode11.window.showTextDocument(vscode11.Uri.file(absPath), {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode11.ViewColumn.One
      });
    }
  }
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.analyzeCurrentFile",
    async (uri) => {
      let filePath;
      if (uri?.scheme === "file") {
        filePath = uri.fsPath;
      } else {
        const editor = vscode11.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== "file") {
          vscode11.window.showWarningMessage("Commit Defender: Open a file in the editor first.");
          return;
        }
        filePath = editor.document.uri.fsPath;
      }
      const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        return;
      }
      statusBar.setRunning();
      try {
        const rawRoot = await getRepoRoot(ws);
        let resolvedRoot = rawRoot;
        let resolvedFile = filePath;
        try {
          resolvedRoot = fs6.realpathSync(rawRoot);
          resolvedFile = fs6.realpathSync(filePath);
        } catch {
        }
        const relPath = path10.relative(resolvedRoot, resolvedFile);
        const channel = getOutputChannel();
        channel.appendLine(`
[Commit Defender] Analyze File:`);
        channel.appendLine(`  file    : ${filePath}`);
        channel.appendLine(`  rawRoot : ${rawRoot}`);
        channel.appendLine(`  relPath : ${relPath || "(empty)"}`);
        if (!relPath || relPath.startsWith("..")) {
          vscode11.window.showWarningMessage("Commit Defender: File is outside the repository.");
          statusBar.setIdle();
          return;
        }
        await analyze([relPath], rawRoot, "file");
      } catch (err2) {
        handleError(err2, statusBar);
      }
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.analyzeDirectory",
    async (uri) => {
      const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        return;
      }
      let rawRoot;
      try {
        rawRoot = await getRepoRoot(ws);
      } catch (err2) {
        handleError(err2, statusBar);
        return;
      }
      const dirPath = uri?.scheme === "file" ? uri.fsPath : await pickDirectory(rawRoot);
      if (!dirPath) {
        return;
      }
      statusBar.setRunning();
      try {
        const cfg2 = getConfig();
        const relPaths = collectFiles(dirPath, rawRoot, cfg2.excludePatterns);
        if (relPaths.length === 0) {
          statusBar.setIdle("No supported files found");
          vscode11.window.showInformationMessage("Commit Defender: No analyzable files found in that directory.");
          return;
        }
        const channel = getOutputChannel();
        channel.appendLine(`
[Commit Defender] Analyze Directory: ${path10.relative(rawRoot, dirPath) || "."}`);
        channel.appendLine(`  ${relPaths.length} file(s) found`);
        await analyze(relPaths, rawRoot, "directory", dirPath);
      } catch (err2) {
        handleError(err2, statusBar);
      }
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.analyze",
    async () => {
      const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode11.window.showWarningMessage("Commit Defender: No workspace folder open.");
        return;
      }
      statusBar.setRunning();
      try {
        const rawRoot = await getRepoRoot(ws);
        const cfg2 = getConfig();
        const staged = await getStagedFiles(rawRoot, cfg2.excludePatterns);
        if (staged.length === 0) {
          statusBar.setIdle("No staged files");
          vscode11.window.showInformationMessage('Commit Defender: No staged files to analyze. Use "Analyze Directory" or "Analyze Repository" for a broader scan.');
          return;
        }
        if (cfg2.stagedFilesWarnThreshold > 0 && staged.length > cfg2.stagedFilesWarnThreshold) {
          const answer = await vscode11.window.showWarningMessage(
            `Commit Defender: ${staged.length} files are staged. Analyzing this many files may take a while.`,
            { modal: true },
            "Proceed to Analyze",
            "Skip",
            "Abort"
          );
          if (answer === "Skip") {
            statusBar.setIdle("Analysis skipped");
            vscode11.window.showInformationMessage("Commit Defender: Analysis skipped.");
            return;
          }
          if (answer === "Abort" || answer === void 0) {
            statusBar.setIdle("Commit aborted");
            vscode11.window.showWarningMessage("Commit Defender: Commit aborted. Fix or unstage files before committing.");
            return;
          }
        }
        const channel = getOutputChannel();
        channel.appendLine(`
[Commit Defender] Analyze Staged Files: ${staged.length} file(s)`);
        await analyze(staged, rawRoot, "staged");
      } catch (err2) {
        handleError(err2, statusBar);
      }
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.analyzeRepository",
    async () => {
      const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        return;
      }
      statusBar.setRunning();
      try {
        const cfg2 = getConfig();
        const rawRoot = await getRepoRoot(ws);
        const allFiles = collectFiles(rawRoot, rawRoot, cfg2.excludePatterns);
        if (allFiles.length === 0) {
          statusBar.setIdle("No files found");
          vscode11.window.showInformationMessage("Commit Defender: No analyzable files found in the repository.");
          return;
        }
        if (cfg2.repoAnalysisWarnThreshold > 0 && allFiles.length > cfg2.repoAnalysisWarnThreshold) {
          const answer = await vscode11.window.showWarningMessage(
            `Commit Defender: Found ${allFiles.length} files. Analyzing the full repository may take a while and only the first ~80K characters of content will be reviewed. Continue?`,
            { modal: true },
            "Analyze"
          );
          if (answer !== "Analyze") {
            statusBar.setIdle();
            return;
          }
        }
        const channel = getOutputChannel();
        channel.appendLine(`
[Commit Defender] Analyze Repository: ${allFiles.length} file(s)`);
        await analyze(allFiles, rawRoot, "repository");
      } catch (err2) {
        handleError(err2, statusBar);
      }
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand("commitDefender.cancel", () => {
    if (currentAbort) {
      currentAbort.abort("user");
      currentAbort = null;
      statusBar.setIdle("Analysis cancelled");
    }
  }));
  context.subscriptions.push(vscode11.commands.registerCommand("commitDefender.clearFindings", () => {
    diagnostics.clear();
    commentManager.clearAll();
    findingsStore.clear();
    historyProvider.clear();
    panelProvider.clear();
    statusBar.setIdle();
  }));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.showLineSuggestion",
    async (uri, line0) => {
      await vscode11.window.showTextDocument(uri, {
        selection: new vscode11.Range(line0, 0, line0, 0),
        preserveFocus: false
      });
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.showSummary",
    () => {
      const last = findingsStore.lastReport();
      if (!last) {
        vscode11.window.showInformationMessage("Commit Defender: No analysis has been run yet.");
        return;
      }
      showSummaryPanel(last.report, last.repoRoot, context);
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.showHistoryEntry",
    (entry) => {
      showSummaryPanel(entry.report, entry.repoRoot, context);
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.reanalyzeHistoryEntry",
    async (arg) => {
      const histEntry = arg?.kind === "entry" ? arg.entry : arg?.report ? arg : void 0;
      if (!histEntry) {
        vscode11.window.showWarningMessage("Commit Defender: Could not read history entry.");
        return;
      }
      const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        return;
      }
      statusBar.setRunning();
      try {
        const cfg2 = getConfig();
        const rawRoot = await getRepoRoot(ws);
        const channel = getOutputChannel();
        switch (histEntry.scope) {
          case "staged": {
            const staged = await getStagedFiles(rawRoot, cfg2.excludePatterns);
            if (staged.length === 0) {
              statusBar.setIdle("No staged files");
              vscode11.window.showInformationMessage("Commit Defender: No staged files to analyze.");
              return;
            }
            channel.appendLine(`
[Commit Defender] Re-analyze (staged): ${staged.length} file(s)`);
            await analyze(staged, rawRoot, "staged");
            break;
          }
          case "file": {
            const files = histEntry.report.staged_files;
            if (!files.length) {
              vscode11.window.showWarningMessage("Commit Defender: No file recorded in this history entry.");
              statusBar.setIdle();
              return;
            }
            channel.appendLine(`
[Commit Defender] Re-analyze (file): ${files[0]}`);
            await analyze(files, histEntry.repoRoot, "file");
            break;
          }
          case "directory": {
            const dirPath = histEntry.scopeTarget;
            if (!dirPath) {
              vscode11.window.showWarningMessage("Commit Defender: No directory recorded in this history entry.");
              statusBar.setIdle();
              return;
            }
            const relPaths = collectFiles(dirPath, rawRoot, cfg2.excludePatterns);
            if (relPaths.length === 0) {
              statusBar.setIdle("No supported files found");
              vscode11.window.showInformationMessage("Commit Defender: No analyzable files found in that directory.");
              return;
            }
            channel.appendLine(`
[Commit Defender] Re-analyze (directory): ${path10.relative(rawRoot, dirPath) || "."}, ${relPaths.length} file(s)`);
            await analyze(relPaths, rawRoot, "directory", dirPath);
            break;
          }
          case "repository": {
            const allFiles = collectFiles(rawRoot, rawRoot, cfg2.excludePatterns);
            if (allFiles.length === 0) {
              statusBar.setIdle("No files found");
              vscode11.window.showInformationMessage("Commit Defender: No analyzable files found in the repository.");
              return;
            }
            channel.appendLine(`
[Commit Defender] Re-analyze (repository): ${allFiles.length} file(s)`);
            await analyze(allFiles, rawRoot, "repository");
            break;
          }
        }
      } catch (err2) {
        handleError(err2, statusBar);
      }
    }
  ));
  context.subscriptions.push(vscode11.commands.registerCommand(
    "commitDefender.generateCommitMessage",
    async () => {
      const ws = vscode11.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode11.window.showWarningMessage("Commit Defender: No workspace folder open.");
        return;
      }
      let repoRoot;
      try {
        repoRoot = await getRepoRoot(ws);
      } catch {
        vscode11.window.showWarningMessage("Commit Defender: No git repository found.");
        return;
      }
      await vscode11.window.withProgress(
        { location: vscode11.ProgressLocation.Notification, title: "Commit Defender: Generating commit message\u2026", cancellable: false },
        async () => {
          const result = await new Reviewer(getConfig()).generateCommitMessage(repoRoot);
          if (result.is_error || !result.commit_message) {
            vscode11.window.showErrorMessage(
              `Commit Defender: ${result.error || "Failed to generate commit message"}`
            );
            return;
          }
          const gitExt = vscode11.extensions.getExtension("vscode.git");
          const gitApi = gitExt?.exports?.getAPI?.(1);
          const repo = gitApi?.getRepository?.(vscode11.Uri.file(repoRoot)) ?? gitApi?.repositories?.[0];
          if (repo?.inputBox) {
            repo.inputBox.value = result.commit_message;
            vscode11.window.showInformationMessage(
              "Commit Defender: Commit message inserted into the Source Control input box."
            );
          } else {
            await vscode11.env.clipboard.writeText(result.commit_message);
            vscode11.window.showInformationMessage(
              "Commit Defender: Commit message copied to clipboard.",
              "Preview"
            ).then((action) => {
              if (action === "Preview") {
                vscode11.window.showInputBox({
                  value: result.commit_message,
                  prompt: "Generated commit message (read-only preview)",
                  ignoreFocusOut: true
                });
              }
            });
          }
        }
      );
    }
  ));
  setupIndexWatcher(context);
}
function deactivate() {
  findingsStore.clear();
  disposeOutputChannel();
}
async function pickDirectory(root) {
  let current = root;
  while (true) {
    const rel = path10.relative(root, current) || ".";
    const label = rel === "." ? "$(root-folder) workspace root" : `$(folder) ${rel}`;
    const items = [];
    items.push({
      label: "$(check) Analyze this directory",
      description: rel,
      alwaysShow: true
    });
    if (current !== root) {
      items.push({ label: "$(arrow-left) ..", description: "Go up one level", alwaysShow: true });
    }
    let subdirs = [];
    try {
      subdirs = fs6.readdirSync(current, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !["node_modules", "__pycache__", ".venv", "venv", "dist", "build", "out"].includes(e.name)).map((e) => e.name).sort();
    } catch {
    }
    for (const name of subdirs) {
      items.push({ label: `$(folder) ${name}`, description: path10.join(rel, name) });
    }
    const picked = await vscode11.window.showQuickPick(items, {
      title: `Commit Defender \u2014 Select directory  [${label}]`,
      placeHolder: 'Navigate or choose "Analyze this directory"'
    });
    if (!picked) {
      return void 0;
    }
    if (picked.label.startsWith("$(check)")) {
      return current;
    }
    if (picked.label.startsWith("$(arrow-left)")) {
      current = path10.dirname(current);
    } else {
      current = path10.join(current, picked.label.replace("$(folder) ", ""));
    }
  }
}
function handleError(err2, statusBar) {
  const message = err2 instanceof Error ? err2.message : String(err2);
  statusBar.setError(message);
  const firstLine = message.split("\n")[0];
  vscode11.window.showErrorMessage(`Commit Defender: ${firstLine}`, "Show Output").then((action) => {
    if (action === "Show Output") {
      getOutputChannel().show();
    }
  });
  const channel = getOutputChannel();
  channel.appendLine(`
[Error] ${message}`);
  channel.show(true);
}
var _summaryPanel;
function showSummaryPanel(report, repoRoot, context) {
  if (_summaryPanel) {
    _summaryPanel.reveal(vscode11.ViewColumn.Beside, true);
  } else {
    _summaryPanel = vscode11.window.createWebviewPanel(
      "commitDefenderSummary",
      "Commit Defender \u2014 Summary",
      { viewColumn: vscode11.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    _summaryPanel.onDidDispose(() => {
      _summaryPanel = void 0;
    }, null, context.subscriptions);
    _summaryPanel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.command === "open") {
          const uri = vscode11.Uri.file(msg.path);
          const line = Math.max(0, (msg.line ?? 1) - 1);
          vscode11.window.showTextDocument(uri, {
            selection: new vscode11.Range(line, 0, line, 0),
            preserveFocus: false
          });
        } else if (msg.command === "showJson") {
          const json = JSON.stringify(report, null, 2);
          const doc = await vscode11.workspace.openTextDocument({ content: json, language: "json" });
          vscode11.window.showTextDocument(doc, { preview: true, preserveFocus: false });
        }
      },
      void 0,
      context.subscriptions
    );
  }
  _summaryPanel.title = "Commit Defender \u2014 Summary";
  const palette = resolvePalette(getConfig().colorPalette);
  _summaryPanel.webview.html = buildSummaryHtml(report, repoRoot, palette);
}
function _renderOverallSummary(review, blocks, repoRoot, palette) {
  const perFile = review.per_file_summaries ?? [];
  if (perFile.length === 0) {
    return `<div class="per-file-summary">${mdToHtml(review.summary)}</div>`;
  }
  const worstByFile = /* @__PURE__ */ new Map();
  for (const b of blocks) {
    const cur = worstByFile.get(b.file);
    if (!cur || PRIORITY_RANK2[b.priority] > PRIORITY_RANK2[cur]) {
      worstByFile.set(b.file, b.priority);
    }
  }
  let html = "";
  for (const pfs of perFile) {
    const priority = worstByFile.get(pfs.file) ?? pfs.priority;
    const pMeta = PRIORITY_META[priority];
    const pColor = palette.priority[priority];
    const badge = pMeta ? `<span class="priority-badge" style="color:${pColor}">${pMeta.emoji} ${priority} ${pMeta.label}</span>` : "";
    const absFile = path10.join(repoRoot, pfs.file);
    html += `<div class="per-file-summary">
      <div class="per-file-header">
        <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#"><code>${esc(pfs.file)}</code></a>
        ${badge}
      </div>
      <div class="per-file-body">${mdToHtml(pfs.summary)}</div>
    </div>`;
  }
  return html;
}
function _renderFileBlocks(blocks, repoRoot, palette) {
  const byFile = /* @__PURE__ */ new Map();
  for (const b of blocks) {
    const list = byFile.get(b.file) ?? [];
    list.push(b);
    byFile.set(b.file, list);
  }
  let html = "";
  for (const [relFile, fileBlocks] of byFile) {
    const absFile = path10.join(repoRoot, relFile);
    html += `<div class="file-block">
      <div class="file-name">
        <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#">${esc(relFile)}</a>
      </div>`;
    for (const b of fileBlocks) {
      const meta = metaForBlock(b);
      const cat = formatCategory(b.category);
      const catSlug = (b.category || "").toLowerCase();
      const pColor = palette.priority[b.priority];
      const pBadge = `<span class="priority-badge" style="color:${pColor}">${meta.emoji} ${b.priority} ${meta.label}</span>`;
      const catBadge = b.priority !== "P0" && b.category ? `<span class="cat cat-${esc(catSlug)}">${esc(cat)}</span>` : "";
      const lineRef = b.line > 0 ? `<a class="line-link" data-path="${esc(absFile)}" data-line="${b.line}" href="#">line ${b.line}</a>` : '<span class="line-label">file-level</span>';
      const bodyHtml = mdToHtml(b.comment);
      html += `<div class="suggestion priority-${esc(b.priority)}">
        <div class="suggestion-header">${pBadge} ${catBadge} &nbsp;${lineRef}</div>
        <div class="suggestion-body">${bodyHtml}</div>
      </div>`;
    }
    html += "</div>";
  }
  return html;
}
function buildSummaryHtml(report, repoRoot, palette) {
  const pal = palette ?? resolvePalette("theme-adaptive");
  const blocks = normalizeReport(report);
  const passed = report.exit_code === 0;
  const grade = report.review.grade;
  const isError = report.review.is_error || /AI review unavailable/i.test(report.review.summary);
  const wp = worstPriority(blocks);
  const wpMeta = wp ? PRIORITY_META[wp] : void 0;
  const headerBadge = isError ? '<span class="badge" style="background:#888">AI ERROR \u26A0</span>' : passed ? '<span class="badge pass">PASS \u2713</span>' : '<span class="badge blocked">BLOCKED \u2717</span>';
  const gradeBadge = grade ? `<span class="badge" style="background:${gradeColor(pal, grade)}">${grade.toUpperCase()}</span>` : "";
  const worstBadge = wpMeta && wp ? `<span class="priority-badge" style="color:${pal.priority[wp]}">${wpMeta.emoji} ${wp} ${wpMeta.label}</span>` : "";
  const metaParts = [
    `${report.staged_files.length} file(s) analyzed`,
    blocks.length > 0 ? `${blocks.length} comment(s)` : "",
    isError ? '<span class="mode-tag" style="background:#c72e2e">ai error</span>' : '<span class="mode-tag">ai-powered</span>',
    `${report.duration_ms} ms`
  ].filter(Boolean);
  let body = `
    <div class="header">
      <div class="header-row">
        <h1>\u{1F6E1} Commit Defender &nbsp;${headerBadge} ${gradeBadge} &nbsp;${worstBadge}</h1>
        <button class="json-btn" id="btnShowJson" title="Open raw JSON report in editor">{ } Raw JSON</button>
      </div>
      <div class="meta">${metaParts.join(" &nbsp;\xB7&nbsp; ")}</div>
    </div>`;
  if (report.review.summary) {
    if (isError) {
      const txt = report.review.summary.replace(/^AI review unavailable:\s*/i, "");
      body += `<section><h2>\u26A0 AI Review Error</h2>
        <div class="summary-error">${mdToHtml(txt)}</div></section>`;
    } else {
      body += `<section><h2>\u{1F4CB} Overall Summary</h2>
        ${_renderOverallSummary(report.review, blocks, repoRoot, pal)}</section>`;
    }
  }
  if (blocks.length > 0) {
    body += "<section><h2>\u{1F4A1} AI Comments</h2>";
    body += _renderFileBlocks(blocks, repoRoot, pal);
    body += "</section>";
  }
  if (report.staged_files.length > 0) {
    body += '<section><h2>\u{1F4C1} Analyzed File List</h2><ul class="file-list">';
    for (const f of report.staged_files) {
      const absFile = path10.join(repoRoot, f);
      body += `<li><a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#"><code>${esc(f)}</code></a></li>`;
    }
    body += "</ul></section>";
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --radius: 6px;
    --cd-p3: ${pal.priority.P3};
    --cd-p2: ${pal.priority.P2};
    --cd-p1: ${pal.priority.P1};
    --cd-p0: ${pal.priority.P0};
    --cd-cat-security:        ${pal.category.security};
    --cd-cat-correctness:     ${pal.category.correctness};
    --cd-cat-maintenance:     ${pal.category.maintenance};
    --cd-cat-optimization:    ${pal.category.optimization};
    --cd-cat-setting:         ${pal.category.setting};
    --cd-cat-review-history:  ${pal.category["review-history"]};
  }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
    line-height: 1.65;
    max-width: 960px;
  }
  h1 { font-size: 1.3em; margin: 0 0 6px; }
  h2 { font-size: 1em; font-weight: 600; margin: 1.8em 0 0.6em;
       border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
  a  { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textBlockQuote-background);
    padding: 1px 5px; border-radius: 3px; font-size: 0.88em;
  }
  .header { margin-bottom: 1.4em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 4px; }
  .badge {
    display: inline-block; padding: 2px 12px; border-radius: 4px;
    font-size: 0.78em; font-weight: 700; margin-left: 8px; vertical-align: middle;
  }
  .badge.pass    { background: #2d7d46; color: #fff; }
  .badge.blocked { background: var(--vscode-statusBarItem-errorBackground, #c72e2e); color: #fff; }
  .mode-tag { display: inline-block; font-size: 0.78em; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); vertical-align: middle; }
  .file-block { margin-bottom: 1.2em; }
  .file-name { font-size: 0.88em; font-weight: 600; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
  .suggestion {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 8px 14px; margin: 5px 0;
  }
  .suggestion-header { font-size: 0.85em; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .priority-badge { font-weight: 600; white-space: nowrap; }
  .suggestion.priority-P3 { border-left: 3px solid var(--cd-p3); padding-left: 8px; }
  .suggestion.priority-P2 { border-left: 3px solid var(--cd-p2); padding-left: 8px; }
  .suggestion.priority-P1 { border-left: 3px solid var(--cd-p1); padding-left: 8px; }
  .suggestion.priority-P0 { border-left: 3px solid var(--cd-p0); padding-left: 8px; }
  .suggestion-body p { margin: 4px 0; }
  .line-label { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
  .cat {
    display: inline-block; font-size: 0.72em; font-weight: 600;
    padding: 1px 6px; border-radius: 3px; margin-left: 6px;
    vertical-align: middle; text-transform: uppercase;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .cat-security       { background: var(--cd-cat-security);        color: #fff; }
  .cat-correctness    { background: var(--cd-cat-correctness);     color: #fff; }
  .cat-maintenance    { background: var(--cd-cat-maintenance);     color: #fff; }
  .cat-optimization   { background: var(--cd-cat-optimization);    color: #fff; }
  .cat-setting        { background: var(--cd-cat-setting);         color: #fff; }
  .cat-review-history { background: var(--cd-cat-review-history);  color: #fff; }
  .file-list { margin: 4px 0; padding-left: 20px; }
  .file-list li { margin: 2px 0; font-size: 0.88em; }
  .summary-text p { margin: 6px 0; }
  .per-file-summary {
    padding: 10px 0;
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  .per-file-summary:last-child { border-bottom: none; }
  .per-file-header {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 6px; flex-wrap: wrap;
  }
  .per-file-header code {
    font-size: 0.9em;
    background: var(--vscode-textBlockQuote-background);
  }
  .per-file-body p { margin: 4px 0; }
  .summary-error {
    background: var(--vscode-inputValidation-errorBackground, rgba(199,46,46,0.15));
    border-left: 3px solid var(--vscode-errorForeground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 10px 14px;
  }
  section { margin-bottom: 1.6em; }
  .header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .header-row h1 { margin: 0; flex: 1; }
  .json-btn {
    cursor: pointer;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.78em;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    white-space: nowrap;
  }
  .json-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-path]');
    if (link) {
      e.preventDefault();
      vscode.postMessage({
        command: 'open',
        path: link.dataset.path,
        line: parseInt(link.dataset.line || '1', 10),
      });
      return;
    }
    if (e.target && e.target.id === 'btnShowJson') {
      vscode.postMessage({ command: 'showJson' });
    }
  });
</script>
</body>
</html>`;
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function mdToHtml(md) {
  const inline = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const blocks = md.split(/\n{2,}/);
  return blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.startsWith("### ")) {
      return `<h4>${inline(trimmed.slice(4))}</h4>`;
    }
    if (trimmed.startsWith("## ")) {
      return `<h3>${inline(trimmed.slice(3))}</h3>`;
    }
    if (trimmed.startsWith("# ")) {
      return `<h2>${inline(trimmed.slice(2))}</h2>`;
    }
    if (trimmed === "---") {
      return "<hr>";
    }
    const lines = trimmed.split("\n");
    if (lines.every((l) => l.trimStart().startsWith("- "))) {
      const items = lines.map((l) => `<li>${inline(l.trimStart().slice(2))}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).filter(Boolean).join("");
}
function setupIndexWatcher(context) {
  const cfg = getConfig();
  if (!cfg.runOnStage) {
    return;
  }
  const ws = vscode11.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) {
    return;
  }
  const indexPattern = new vscode11.RelativePattern(
    vscode11.Uri.file(path10.join(ws.fsPath, ".git")),
    "index"
  );
  const watcher = vscode11.workspace.createFileSystemWatcher(indexPattern, false, false, true);
  let debounce;
  const trigger = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => vscode11.commands.executeCommand("commitDefender.analyze"), 2e3);
  };
  watcher.onDidChange(trigger);
  watcher.onDidCreate(trigger);
  context.subscriptions.push(watcher);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
