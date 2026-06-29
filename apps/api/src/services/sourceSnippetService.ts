import type { NodeDetails } from "@navix/shared";

type SourceSnippet = {
  text: string;
  lineCount: number;
};

const maxSnippetLines = 240;
const contextBefore = 14;
const contextAfter = 34;

export class SourceSnippetService {
  buildSnippet(source: string, details: NodeDetails): SourceSnippet {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const ranges = new Map<string, [number, number]>();

    this.addHeaderRange(ranges, lines);

    for (const definition of details.indexedDefinitions?.slice(0, 10) ?? []) {
      const matches = this.findDefinitionLines(lines, definition);
      for (const lineIndex of matches.slice(0, 3)) {
        this.addRange(
          ranges,
          Math.max(0, lineIndex - contextBefore),
          Math.min(lines.length - 1, lineIndex + contextAfter)
        );
      }
    }

    if (ranges.size === 0) {
      this.addRange(ranges, 0, Math.min(lines.length - 1, 180));
    }

    const merged = this.mergeRanges([...ranges.values()]);
    const selectedLines: string[] = [];

    for (const [start, end] of merged) {
      if (selectedLines.length >= maxSnippetLines) {
        break;
      }
      if (selectedLines.length > 0) {
        selectedLines.push("...");
      }
      for (let index = start; index <= end && selectedLines.length < maxSnippetLines; index += 1) {
        selectedLines.push(`${String(index + 1).padStart(4, " ")} | ${lines[index] ?? ""}`);
      }
    }

    return {
      text: selectedLines.join("\n"),
      lineCount: selectedLines.filter((line) => line !== "...").length
    };
  }

  private addHeaderRange(ranges: Map<string, [number, number]>, lines: string[]) {
    const headerEnd = Math.min(lines.length - 1, 40);
    if (headerEnd >= 0) {
      this.addRange(ranges, 0, headerEnd);
    }
  }

  private findDefinitionLines(lines: string[], definition: string) {
    const normalizedDefinition = normalizeForSearch(definition);
    if (!normalizedDefinition) {
      return [];
    }

    const matches: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = normalizeForSearch(lines[index] ?? "");
      if (line.includes(normalizedDefinition)) {
        matches.push(index);
      }
    }
    return matches;
  }

  private addRange(ranges: Map<string, [number, number]>, start: number, end: number) {
    ranges.set(`${start}:${end}`, [start, end]);
  }

  private mergeRanges(ranges: Array<[number, number]>) {
    const sorted = ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];

    for (const [start, end] of sorted) {
      const last = merged.at(-1);
      if (!last || start > last[1] + 2) {
        merged.push([start, end]);
      } else {
        last[1] = Math.max(last[1], end);
      }
    }

    return merged;
  }
}

const normalizeForSearch = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};
