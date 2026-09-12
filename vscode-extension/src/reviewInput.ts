import {
  readReviewFile,
  selectReviewInputs,
  type SourceExclusion,
} from "./sourcePolicy.js";

export interface CapturedFiles {
  files: string[];
  exclusions: SourceExclusion[];
  sources: Map<string, string>;
  readErrors: Map<string, Error>;
}

/** Capture all saved source before execution or progress callbacks can change it. */
export function captureWorkingFiles(
  repoRoot: string,
  files: string[],
  patterns: string[],
): CapturedFiles {
  const selection = selectReviewInputs(repoRoot, files, patterns);
  const sources = new Map<string, string>();
  const readErrors = new Map<string, Error>();
  for (const file of selection.files) {
    try {
      sources.set(file, readReviewFile(repoRoot, file, patterns));
    } catch (error) {
      readErrors.set(file, error as Error);
    }
  }
  return {
    files: selection.files,
    exclusions: selection.excluded,
    sources,
    readErrors,
  };
}
