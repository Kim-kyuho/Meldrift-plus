import { describe, expect, it } from "vitest";
import { splitMermaidSections } from "../src/features/markdown/mermaid-sections";

describe("splitMermaidSections", () => {
    it("keeps ordinary Markdown intact", () => {
        expect(splitMermaidSections("")).toEqual([""]);
        expect(splitMermaidSections("# Title\n```js\nconst x = 1;\n```"))
            .toEqual(["# Title\n```js\nconst x = 1;\n```"]);
    });

    it("alternates Markdown and multiple Mermaid sections", () => {
        expect(splitMermaidSections("Intro\n```mermaid\nA-->B\n```\nMiddle\n```mermaid\nB-->C\n```\nEnd"))
            .toEqual(["Intro\n", "A-->B\n", "\nMiddle\n", "B-->C\n", "\nEnd"]);
        expect(splitMermaidSections("```mermaid\n```"))
            .toEqual(["", "", ""]);
    });

    it("preserves header whitespace and CRLF handling", () => {
        expect(splitMermaidSections("```mermaid \t\r\n\n  A-->B\r\n```"))
            .toEqual(["", "  A-->B\r\n", ""]);
    });

    it("leaves invalid headers and unterminated blocks as Markdown", () => {
        const markdown = "```mermaid A-->B```\n```mermaid\nA-->B";
        expect(splitMermaidSections(markdown)).toEqual([markdown]);
        expect(splitMermaidSections("```mermaidX\n```\n```mermaid\nA-->B```"))
            .toEqual(["```mermaidX\n```\n", "A-->B", ""]);
    });

    it("handles long whitespace input without a closing fence", () => {
        const markdown = "```mermaid\n" + "\n ".repeat(200_000);
        expect(splitMermaidSections(markdown)).toEqual([markdown]);
    });

    it("handles many invalid opening fences before a valid block", () => {
        const prefix = "```mermaid ".repeat(20_000);
        expect(splitMermaidSections(prefix + "```mermaid\nA-->B```"))
            .toEqual([prefix, "A-->B", ""]);
    });
});
