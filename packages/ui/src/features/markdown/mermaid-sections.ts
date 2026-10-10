export function splitMermaidSections(markdown: string): string[] {
    const sections: string[] = [];
    const openingFence = "```mermaid";
    let sectionStart = 0;
    let searchStart = 0;

    while (searchStart < markdown.length) {
        const opening = markdown.indexOf(openingFence, searchStart);
        if (opening === -1) {
            break;
        }

        let headerEnd = opening + openingFence.length;
        let contentStart = -1;
        while (headerEnd < markdown.length && /\s/.test(markdown[headerEnd])) {
            if (markdown[headerEnd] === "\n") {
                contentStart = headerEnd + 1;
            }
            headerEnd += 1;
        }

        if (contentStart === -1) {
            searchStart = headerEnd;
            continue;
        }

        const closing = markdown.indexOf("```", contentStart);
        if (closing === -1) {
            break;
        }

        sections.push(markdown.slice(sectionStart, opening), markdown.slice(contentStart, closing));
        sectionStart = closing + 3;
        searchStart = sectionStart;
    }

    sections.push(markdown.slice(sectionStart));
    return sections;
}
