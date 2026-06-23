export interface ParsedDiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  lnOld?: number;
  lnNew?: number;
}

export interface ParsedHunk {
  header: string;
  lines: ParsedDiffLine[];
}

export interface ParsedFileDiff {
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
  isBinary: boolean;
}

export function parseGitDiff(diffText: string | null | undefined): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  if (!diffText) return files;

  const lines = diffText.split(/\r?\n/);
  let currentFile: ParsedFileDiff | null = null;
  let currentHunk: ParsedHunk | null = null;

  let lnOld = 0;
  let lnNew = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Standard git diff header start
    if (line.startsWith('diff --git ')) {
      // e.g., "diff --git a/src/index.css b/src/index.css"
      // or renames: "diff --git a/old b/new"
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      let filePath = '';
      if (match) {
        filePath = match[2];
      } else {
        // Fallback: split on space and remove prefixes
        const parts = line.split(' ');
        if (parts.length >= 4) {
          filePath = parts[3].replace(/^b\//, '');
        } else {
          filePath = 'unknown_file';
        }
      }

      currentFile = {
        filePath,
        changeType: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [],
        isBinary: false,
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;

    // Check file change types
    if (line.startsWith('new file mode ')) {
      currentFile.changeType = 'added';
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      currentFile.changeType = 'deleted';
      continue;
    }

    if (line.startsWith('Binary files ')) {
      currentFile.isBinary = true;
      continue;
    }

    if (line.startsWith('--- ')) {
      if (line.includes('/dev/null')) {
        currentFile.changeType = 'added';
      }
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (line.includes('/dev/null')) {
        currentFile.changeType = 'deleted';
      }
      // Overwrite file path with the real target path if it starts with b/
      const pathMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (pathMatch) {
        currentFile.filePath = pathMatch[1];
      }
      continue;
    }

    if (line.startsWith('index ') || line.startsWith('similarity ') || line.startsWith('rename ')) {
      continue;
    }

    if (line.startsWith('@@ ')) {
      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        lnOld = parseInt(match[1], 10);
        lnNew = parseInt(match[2], 10);
      }
      currentHunk = {
        header: line,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'added',
          content: line.slice(1),
          lnNew: lnNew++,
        });
        currentFile.additions++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'removed',
          content: line.slice(1),
          lnOld: lnOld++,
        });
        currentFile.deletions++;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({
          type: 'context',
          content: line.startsWith(' ') ? line.slice(1) : line,
          lnOld: lnOld++,
          lnNew: lnNew++,
        });
      } else if (line.startsWith('\\ No newline at end of file')) {
        // Ignore or add as metadata. Here, we skip to avoid displaying raw git warnings as code lines.
      }
    }
  }

  return files;
}
