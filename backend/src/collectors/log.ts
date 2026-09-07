import type { JournalReader } from '../journal/journalctl.js';
import { shortenLogLine } from '../journal/parse.js';
import { unitExists } from '../util/fs.js';

export interface LogSection {
  unit: string;
  /** Newest first — the page cannot scroll a fresh text to the bottom */
  lines: string[];
  /** Set instead of lines when the journal could not be read */
  problem?: 'missingUnit' | 'unreadable' | 'empty';
  detail?: string;
}

/** The last journal lines of every configured unit, plain text, newest first. */
export async function collectLog(
  journal: JournalReader,
  units: string[],
  /** null: the source is a file, there is no unit whose absence would mean anything */
  unitDirs: string[] | null,
  maxLines: number,
): Promise<LogSection[]> {
  const sections: LogSection[] = [];
  for (const unit of units) {
    if (unitDirs && !(await unitExists(unit, unitDirs))) {
      sections.push({ unit, lines: [], problem: 'missingUnit' });
      continue;
    }
    const r = await journal.tail(unit, maxLines);
    if (!r.ok) {
      sections.push({ unit, lines: [], problem: 'unreadable', detail: r.error });
      continue;
    }
    const lines = r.lines.map(shortenLogLine).reverse();
    sections.push(lines.length ? { unit, lines } : { unit, lines, problem: 'empty' });
  }
  return sections;
}

/** The log panel's text: one unit plain, several with a header each. */
export function renderLogText(sections: LogSection[]): string {
  const render = (s: LogSection) => {
    switch (s.problem) {
      case 'missingUnit':
        return `[no unit '${s.unit}' found]`;
      case 'unreadable':
        return `[log not readable: ${s.detail ?? 'no access to the journal'}]`;
      case 'empty':
        return '[no entries]';
      default:
        return s.lines.join('\n');
    }
  };
  if (!sections.length) return '[no log source configured]';
  if (sections.length === 1) return render(sections[0]!);
  return sections.map((s) => `--- ${s.unit} ---\n${render(s)}`).join('\n\n');
}
