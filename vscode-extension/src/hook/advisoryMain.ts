import { advisoryHook } from "./advisoryAdapter.js";
const [state, hook, original, ...args] = process.argv.slice(2);
if (!state || !original || !["pre-commit", "pre-push"].includes(hook))
  process.exitCode = 2;
else
  void advisoryHook(state, hook, original, args).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write(
        "Commit Defender: could not preserve hook input; Git hook failed.\n",
      );
      process.exitCode = 2;
    },
  );
