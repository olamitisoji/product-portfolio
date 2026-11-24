# Soji Agboola personal website

[Visit the portfolio](https://soji-agboola-portfolio.boileditem.chatgpt.site)

This directory is an earlier version of my portfolio. It includes five project case studies, a career timeline and essays from Reality Checks. The linked website has the current design, stories and project results.

## Run locally

From this folder:

```sh
python3 -m http.server 3010 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:3010. No installation, API keys, or database required. Check the JavaScript with `node --check dist/script.js`.

## Edit

- `dist/index.html`: homepage and project links.
- `dist/styles.css`: typography, colors, responsive layout and motion preferences.
- `dist/script.js`: filters, mobile menu and email-copy behavior.
- `dist/work/*/index.html`: case studies.
- `dist/assets/`: Soji’s supplied portrait (without photo metadata), an original monogram, and a screenshot of the synthetic Sortward simulator.

Deploy `dist/` on a static host. This public copy omits the original hosting account identity; create your own Site when deploying a fork.

## Boundaries and verification

The Echo page in this snapshot predates the completed internal interview on a WhatsApp test number. The updated record covers voice notes, follow-up questions, pause and resume, completion and transcript retrieval. Sortward uses fictional warehouse data. I built the prototypes with AI coding assistance. [Echo verification record](../docs/VERIFICATION.md)

Six pages checked for local links, asset paths, unique IDs, heading structure and image alternatives. Browser checks covered a 390px mobile layout, desktop layout, project filters, menu and Escape behavior, and case navigation. This is a presentation website, not another AI service.
