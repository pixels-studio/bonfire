export type DiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'context' | 'add' | 'delete'; text: string; line: number };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Rows of a unified diff after the file header. Each code row carries the line number
 * it has in the new file, or in the old one for deleted lines.
 */
export function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of diff.split('\n')) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: 'hunk', text: raw });
    } else if (!inHunk || raw.startsWith('\\')) continue;
    else if (raw.startsWith('+'))
      rows.push({ kind: 'add', text: raw.slice(1), line: newLine++ });
    else if (raw.startsWith('-'))
      rows.push({ kind: 'delete', text: raw.slice(1), line: oldLine++ });
    else if (raw.startsWith(' ')) {
      rows.push({ kind: 'context', text: raw.slice(1), line: newLine++ });
      oldLine++;
    }
  }
  return rows;
}
